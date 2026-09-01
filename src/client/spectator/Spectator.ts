import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Room } from "colyseus.js";

import { BOSS, MOB } from "#shared/constants";
import type { ZoneState } from "#shared/net/schema";
import type { ActKind } from "#shared/net/messages";
import { buildZone, type ZoneQuality } from "../world/Zone";
import { NetMobs } from "../combat/MobSystem";
import { LootDrops, makeWeaponMesh } from "../world/LootDrops";
import { RemoteAvatar } from "../entities/RemoteAvatar";
import { Sfx } from "../audio/Sfx";
import type { NetClient } from "../net/NetClient";
import {
  SpectatorCamera,
  type DirectorCtx,
  type CtxPlayer,
  type CtxMob,
} from "./SpectatorCamera";

const TOWN_MUSIC = "/music/town-dion.mp3";
const BOSS_MUSIC = "/music/boss.mp3";
const UP = { x: 0, y: 1, z: 0 };

/** Пресеты качества под слабое железо (TOX3). `?q=potato|low|med|high`. */
export type Quality = "potato" | "low" | "med" | "high";

interface Preset extends ZoneQuality {
  scaling: number; // engine.setHardwareScalingLevel — >1 рендерит в меньшем разрешении
  fpsCap: number; // 0 — без ограничения
  leanMobs: boolean;
}

const PRESETS: Record<Quality, Preset> = {
  // Совсем слабый GPU (Mali-G31): без травы, светлячков, облаков; 2 света;
  // мобы облегчённые (без плашек, полосок HP, ран).
  potato: { scaling: 2.2, grass: 0, fireflies: 0, minLights: true, simpleSky: true, leanMobs: true, fpsCap: 30 },
  low: { scaling: 1.5, grass: 0, fireflies: 0, minLights: true, simpleSky: true, leanMobs: true, fpsCap: 30 },
  med: { scaling: 1.15, grass: 0.5, fireflies: 0.7, leanMobs: false, fpsCap: 0 },
  high: { scaling: 1.0, grass: 1, fireflies: 1, leanMobs: false, fpsCap: 0 },
};

/**
 * Невидимый спектатор для стрима (этап 17, Ф1).
 *
 * Отдельное лёгкое приложение: та же зона, мобы, аватары игроков и лут —
 * но без локального игрока, HUD, боя, рук и голоса. Камерой рулит
 * автономный режиссёр (SpectatorCamera). Дашборд не нужен.
 */
export class Spectator {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly sfx = new Sfx();
  private readonly netMobs: NetMobs;
  private readonly loot: LootDrops;
  private readonly cam: SpectatorCamera;
  private readonly zoneTick: (
    dt: number,
    playerPos: Vector3,
    net?: { hour: number; auto: number } | null,
  ) => void;
  private readonly groundHeight: (x: number, z: number) => number;

  private readonly avatars = new Map<string, RemoteAvatar>();
  private net: NetClient | null = null;
  private bossMusicOn = false;
  private lastFrame = 0;
  private readonly fpsCap: number;
  private readonly fixedSize: { w: number; h: number } | null;
  private readonly reloadSec: number;
  /** Реальная частота вызовов scene.render() (getFps() врёт при кап-скипе). */
  private renderCount = 0;
  private renderRate = 0;
  private rateAt = 0;
  private readonly status: HTMLDivElement;
  private readonly debug: HTMLDivElement | null;

  private readonly _players: CtxPlayer[] = [];
  private readonly _mobs: CtxMob[] = [];

  constructor(
    canvas: HTMLCanvasElement,
    quality: Quality,
    showDebug = false,
    /** Переопределения из URL для подгонки на боксе без пересборки. */
    override: {
      rs?: number;
      fpsCap?: number;
      rw?: number;
      rh?: number;
      raw?: boolean;
      reloadSec?: number;
    } = {},
  ) {
    const preset = PRESETS[quality];
    this.fpsCap = override.fpsCap ?? preset.fpsCap;

    // Фиксированный размер рендера (?rw=1280&rh=720): браузер/Fully Kiosk не
    // будет менять его сам при изменении вьюпорта. Canvas тянется по CSS.
    this.fixedSize = override.rw && override.rh ? { w: override.rw, h: override.rh } : null;
    this.reloadSec = override.reloadSec ?? 600; // проверять новую сборку раз в 10 мин
    if (this.fixedSize) {
      canvas.width = this.fixedSize.w;
      canvas.height = this.fixedSize.h;
    }

    this.engine = new Engine(
      canvas,
      false, // без MSAA — на Mali это дорого
      { stencil: false, antialias: false, powerPreference: "high-performance", doNotHandleContextLost: true },
      false,
    );
    if (this.fixedSize) this.engine.setSize(this.fixedSize.w, this.fixedSize.h);
    else this.engine.setHardwareScalingLevel(override.rs ?? preset.scaling);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.5, 0.7, 0.9, 1);

    const zone = buildZone(this.scene, {
      grass: preset.grass,
      fireflies: preset.fireflies,
      minLights: preset.minLights,
      simpleSky: preset.simpleSky,
    });
    // Aggressive: спектатору не нужны ни пикинг, ни точный bounding — только рендер.
    this.scene.performancePriority = 2;
    this.scene.skipPointerDownPicking = true;
    this.scene.skipPointerUpPicking = true;
    this.scene.skipPointerMovePicking = true;
    this.scene.pointerMovePredicate = () => false;
    this.zoneTick = zone.tick;
    this.groundHeight = zone.groundHeight;

    this.cam = new SpectatorCamera(this.scene, override.raw === true);

    // Мобы и лут — переиспользуем менеджеры игры. Бой спектатору не нужен:
    // цели пустые, репорт попаданий — заглушка.
    this.netMobs = new NetMobs(this.scene, this.sfx, [], () => {}, preset.leanMobs);
    this.loot = new LootDrops(this.scene);

    // Статус связи поверх картинки — на «слепом» боксе иначе не понять, что не так.
    this.status = document.createElement("div");
    this.status.style.cssText =
      "position:fixed;left:0;right:0;top:44%;text-align:center;color:#fff;" +
      "font:600 30px/1.4 system-ui,sans-serif;text-shadow:0 2px 12px #000;" +
      "pointer-events:none;z-index:10";
    this.status.textContent = "ZEP GAME — подключаюсь…";
    document.body.appendChild(this.status);

    // Отладочный счётчик — для замера на TOX3 (?debug=1). В эфире не нужен.
    if (showDebug) {
      this.debug = document.createElement("div");
      this.debug.style.cssText =
        "position:fixed;left:8px;top:8px;color:#0f0;font:13px monospace;" +
        "background:#0008;padding:3px 6px;pointer-events:none;z-index:10";
      document.body.appendChild(this.debug);
    } else {
      this.debug = null;
    }

    // Звук стрима: музыка + позиционные эффекты. На боксе жеста нет —
    // добиваемся включения повторными resume() и по возврату вкладки.
    this.sfx.startMusic(TOWN_MUSIC, 0.05);
    const wake = (): void => this.sfx.resume();
    for (const ev of ["pointerdown", "keydown", "touchstart"] as const) {
      window.addEventListener(ev, wake, { once: true });
    }
    document.addEventListener("visibilitychange", wake);
    void this.sfx.resume();
    let tries = 0;
    const t = setInterval(() => {
      void this.sfx.resume();
      if (++tries > 40) clearInterval(t); // ~20 с
    }, 500);

    window.addEventListener("resize", () => {
      // Фиксированный размер держим жёстко, иначе Fully Kiosk его двигает.
      if (this.fixedSize) this.engine.setSize(this.fixedSize.w, this.fixedSize.h);
      else this.engine.resize();
    });

    this.scene.onBeforeRenderObservable.add(() => this.tick());
  }

  /** Подключиться к миру невидимым наблюдателем и начать рендер. */
  async run(net: NetClient, key: string): Promise<boolean> {
    this.net = net;
    net.onAct = (k, x, y, z) => this.playRemoteAct(k, x, y, z);
    net.onReconnected = (room) => {
      this.attach(room);
      this.setStatus("");
    };
    net.onConnectionLost = () => this.setStatus("ZEP GAME — связь потеряна, переподключаюсь…");

    // Рендерим в любом случае (небо + статус) — картинка на стриме не должна
    // быть чёрной, даже пока сервер не поднялся.
    this.engine.runRenderLoop(() => {
      // Babylon сам пере-ресайзит canvas (ResizeObserver) под вьюпорт —
      // при фиксированном размере каждый кадр возвращаем нужный (no-op, если совпал).
      if (this.fixedSize) {
        this.engine.setSize(this.fixedSize.w, this.fixedSize.h);
      }
      const now = performance.now();
      if (this.fpsCap > 0 && now - this.lastFrame < 1000 / this.fpsCap - 1) return;
      this.lastFrame = now;
      this.renderCount++;
      if (this.rateAt === 0) {
        this.rateAt = now;
      } else if (now - this.rateAt > 1000) {
        this.renderRate = (this.renderCount * 1000) / (now - this.rateAt);
        this.renderCount = 0;
        this.rateAt = now;
      }
      this.scene.render();
    });

    const ok = await net.connectSpectator(key);
    if (!ok) {
      this.setStatus("ZEP GAME — сервер недоступен, перезагрузка…");
      setTimeout(() => location.reload(), 30_000); // Fully Kiosk тоже перезагрузит
      return false;
    }
    this.setStatus("");
    if (net.room) this.attach(net.room);
    void this.watchForUpdates();
    return true;
  }

  /**
   * Раз в `reloadSec` секунд проверяем, не выложили ли новую сборку клиента
   * (серверные изменения подхватываются сами через reconnect). Хэш собранного
   * бандла лежит в /index.html; сменился — перезагружаем страницу, чтобы на
   * «слепом» боксе не приходилось ничего трогать руками. `?reload=0` — выкл.
   */
  private async watchForUpdates(): Promise<void> {
    if (this.reloadSec <= 0) return;
    const bundle = async (): Promise<string | null> => {
      try {
        const html = await fetch(`/?_=${Date.now()}`, { cache: "no-store" }).then((r) => r.text());
        return html.match(/assets\/index-[\w-]+\.js/)?.[0] ?? null;
      } catch {
        return null;
      }
    };
    let known = await bundle();
    setInterval(
      () => {
        void bundle().then((now) => {
          if (!now) return;
          if (!known) {
            known = now;
            return;
          }
          if (now !== known) {
            console.log(`[spectator] новая сборка (${known} → ${now}) — перезагрузка`);
            location.reload();
          }
        });
      },
      Math.max(60, this.reloadSec) * 1000,
    );
  }

  private setStatus(text: string): void {
    this.status.textContent = text;
    this.status.style.display = text ? "block" : "none";
  }

  private attach(room: Room<ZoneState>): void {
    this.netMobs.attach(room);
    this.loot.attach(room);

    for (const a of this.avatars.values()) a.dispose();
    this.avatars.clear();

    const players = room.state.players;
    players.onAdd((p, id) => {
      const av = new RemoteAvatar(this.scene, id, p.nick, p.mode, (cls, tier) =>
        makeWeaponMesh(this.scene, cls, tier),
      );
      av.setMyPvp(false); // спектатор не в PvP — полоски здоровья от боя не нужны
      this.avatars.set(id, av);
    }, true);
    players.onRemove((_p, id) => {
      this.avatars.get(id)?.dispose();
      this.avatars.delete(id);
    });
  }

  private tick(): void {
    const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.1);
    const now = performance.now();
    const room = this.net?.room;

    // Зона (сутки, ветер, светлячки) — «позицию игрока» даём камеры.
    this.zoneTick(dt, this.cam.cam.position, this.net?.worldClock ?? null);

    // Аватары игроков + мобы для режиссёра.
    this._players.length = 0;
    this._mobs.length = 0;
    let boss: DirectorCtx["boss"] = null;
    if (room) {
      const st = room.state;
      st.players.forEach((p, id) => {
        const av = this.avatars.get(id);
        if (!av) return;
        av.push(now, p);
        av.setMyPvp(false);
        av.update(now);
        const head = av.position;
        this._players.push({
          id,
          nick: p.nick,
          pos: new Vector3(head.x, head.y - 0.5, head.z),
          eye: head.clone(),
          forward: av.eyeForward.clone(),
        });
      });

      st.mobs.forEach((m, id) => {
        if (m.dead || m.kind === "shard") return;
        const r = MOB.bodyRadius * (m.scale > 0 ? m.scale : 1);
        const f = new Vector3(Math.sin(m.yaw), 0, Math.cos(m.yaw));
        // «Глаза» моба: перед мордой, чуть выше центра.
        this._mobs.push({
          id,
          kind: m.kind,
          eye: new Vector3(m.x + f.x * r * 0.9, m.y + r * 1.1, m.z + f.z * r * 0.9),
          forward: f,
        });
        if (m.kind === "boss") {
          let aggro = m.windup > 0 || m.charging === 1 || m.enraged === 1;
          st.players.forEach((p) => {
            if (Math.hypot(p.head.x - m.x, p.head.z - m.z) < BOSS.aggroRange) aggro = true;
          });
          boss = { id, pos: new Vector3(m.x, m.y, m.z), aggro };
        }
      });
    }

    // Режиссёр.
    this.cam.update(dt, {
      players: this._players,
      mobs: this._mobs,
      boss,
      groundY: this.groundHeight,
    });

    // Мобы, лут.
    const fwd = this.cam.cam.getForwardRay().direction;
    this.netMobs.update(dt, this.cam.cam.position, fwd);
    this.loot.update(dt);

    // Позиционный звук — из точки камеры в направлении взгляда.
    const p = this.cam.cam.position;
    this.sfx.setListener({ x: p.x, y: p.y, z: p.z }, { x: fwd.x, y: fwd.y, z: fwd.z }, UP);

    this.updateBossMusic();

    if (this.debug) {
      const st = room?.state;
      const dpr = window.devicePixelRatio || 1;
      this.debug.textContent =
        `${this.renderRate.toFixed(0)} fps · рендер ${this.engine.getRenderWidth()}×${this.engine.getRenderHeight()}` +
        ` · дисплей ${screen.width}×${screen.height} · CSS ${innerWidth}×${innerHeight} · dpr ${dpr.toFixed(2)}` +
        ` · игроков ${st?.players.size ?? 0} · ${this.cam.shotKind}`;
    }
  }

  /** Рядом с живым боссом — boss.mp3, вдали / после смерти — обычная. */
  private updateBossMusic(): void {
    const mobs = this.net?.room?.state.mobs;
    if (!mobs) return;
    const c = this.cam.cam.position;
    let near = false;
    mobs.forEach((m) => {
      if (m.kind !== "boss" || m.dead) return;
      const d = Math.hypot(m.x - c.x, m.z - c.z);
      if (d < BOSS.musicRange || (this.bossMusicOn && d < BOSS.musicOut)) near = true;
    });
    if (near === this.bossMusicOn) return;
    this.bossMusicOn = near;
    this.sfx.setMusic(near ? BOSS_MUSIC : TOWN_MUSIC, near ? 0.075 : 0.05);
  }

  /** Звук действия игрока по сети — как в игре, но без своих эффектов. */
  private playRemoteAct(k: ActKind, x: number, y: number, z: number): void {
    const at = { x, y, z };
    switch (k) {
      case "swing":
        this.sfx.swordSwing(at);
        break;
      case "step":
        this.sfx.at(at, () => this.sfx.footstep(0.85));
        break;
      case "drink":
        this.sfx.at(at, () => this.sfx.drink());
        break;
      case "bow":
        this.sfx.at(at, () => this.sfx.bowRelease(0.8));
        break;
      case "arrowHit":
        this.sfx.at(at, () => this.sfx.arrowHit("wood", 0.8));
        break;
      case "hurt":
        this.sfx.at(at, () => this.sfx.playerHurt());
        break;
      case "blockShield":
        this.sfx.at(at, () => this.sfx.block(1));
        break;
      case "blockSword":
        this.sfx.at(at, () => this.sfx.block(0.5));
        break;
    }
  }
}
