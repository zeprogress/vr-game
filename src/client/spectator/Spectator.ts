import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Room } from "colyseus.js";

import { BOSS } from "#shared/constants";
import type { ZoneState } from "#shared/net/schema";
import type { ActKind } from "#shared/net/messages";
import { buildZone, type ZoneQuality } from "../world/Zone";
import { NetMobs } from "../combat/MobSystem";
import { LootDrops, makeWeaponMesh } from "../world/LootDrops";
import { RemoteAvatar } from "../entities/RemoteAvatar";
import { Sfx } from "../audio/Sfx";
import type { NetClient } from "../net/NetClient";
import { SpectatorCamera, type DirectorCtx } from "./SpectatorCamera";

const TOWN_MUSIC = "/music/town-dion.mp3";
const BOSS_MUSIC = "/music/boss.mp3";
const UP = { x: 0, y: 1, z: 0 };

/** Пресеты качества под слабое железо (TOX3). `?q=low|med|high`. */
export type Quality = "low" | "med" | "high";

interface Preset extends ZoneQuality {
  scaling: number; // engine.setHardwareScalingLevel — >1 рендерит в меньшем разрешении
  fxaa: boolean;
  fpsCap: number; // 0 — без ограничения
}

const PRESETS: Record<Quality, Preset> = {
  low: { scaling: 1.6, grass: 0.15, fireflies: 0.3, fxaa: false, fpsCap: 30 },
  med: { scaling: 1.15, grass: 0.5, fireflies: 0.7, fxaa: false, fpsCap: 30 },
  high: { scaling: 1.0, grass: 1, fireflies: 1, fxaa: false, fpsCap: 0 },
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

  private readonly _players: DirectorCtx["players"] = [];

  constructor(canvas: HTMLCanvasElement, quality: Quality) {
    const preset = PRESETS[quality];
    this.fpsCap = preset.fpsCap;

    this.engine = new Engine(canvas, true, { stencil: false, antialias: false });
    this.engine.setHardwareScalingLevel(preset.scaling);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.5, 0.7, 0.9, 1);
    this.scene.skipPointerMovePicking = true;

    const zone = buildZone(this.scene, { grass: preset.grass, fireflies: preset.fireflies });
    this.zoneTick = zone.tick;
    this.groundHeight = zone.groundHeight;

    this.cam = new SpectatorCamera(this.scene);

    // Мобы и лут — переиспользуем менеджеры игры. Бой спектатору не нужен:
    // цели пустые, репорт попаданий — заглушка.
    this.netMobs = new NetMobs(this.scene, this.sfx, [], () => {});
    this.loot = new LootDrops(this.scene);

    // Звук стрима: музыка + позиционные эффекты. resume() — по первому жесту.
    this.sfx.startMusic(TOWN_MUSIC, 0.05);
    const wake = (): void => this.sfx.resume();
    for (const ev of ["pointerdown", "keydown", "touchstart"] as const) {
      window.addEventListener(ev, wake, { once: true });
    }
    // Fully Kiosk / автозапуск: звук может быть разрешён без жеста.
    void this.sfx.resume();

    window.addEventListener("resize", () => this.engine.resize());

    this.scene.onBeforeRenderObservable.add(() => this.tick());
  }

  /** Подключиться к миру невидимым наблюдателем и начать рендер. */
  async run(net: NetClient, key: string): Promise<boolean> {
    this.net = net;
    net.onAct = (k, x, y, z) => this.playRemoteAct(k, x, y, z);
    net.onReconnected = (room) => this.attach(room);

    const ok = await net.connectSpectator(key);
    if (!ok) return false;
    if (net.room) this.attach(net.room);
    this.engine.runRenderLoop(() => {
      if (this.fpsCap > 0) {
        const now = performance.now();
        if (now - this.lastFrame < 1000 / this.fpsCap - 1) return;
        this.lastFrame = now;
      }
      this.scene.render();
    });
    return true;
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

    // Аватары игроков.
    this._players.length = 0;
    let boss: DirectorCtx["boss"] = null;
    if (room) {
      const st = room.state;
      st.players.forEach((p, id) => {
        const av = this.avatars.get(id);
        if (!av) return;
        av.push(now, p);
        av.setMyPvp(false);
        av.update(now);
        this._players.push({ id, pos: av.position.clone(), nick: p.nick });
      });

      // Живой босс + агрит ли он кого-то (тот же признак, что у музыки).
      st.mobs.forEach((m) => {
        if (m.kind !== "boss" || m.dead) return;
        const pos = new Vector3(m.x, m.y, m.z);
        let aggro = m.windup > 0 || m.charging === 1 || m.enraged === 1;
        st.players.forEach((p) => {
          if (Math.hypot(p.head.x - m.x, p.head.z - m.z) < BOSS.aggroRange) aggro = true;
        });
        boss = { pos, aggro };
      });
    }

    // Режиссёр.
    this.cam.update(dt, { players: this._players, boss, groundY: this.groundHeight });

    // Мобы, лут.
    const fwd = this.cam.cam.getForwardRay().direction;
    this.netMobs.update(dt, this.cam.cam.position, fwd);
    this.loot.update(dt);

    // Позиционный звук — из точки камеры в направлении взгляда.
    const p = this.cam.cam.position;
    this.sfx.setListener({ x: p.x, y: p.y, z: p.z }, { x: fwd.x, y: fwd.y, z: fwd.z }, UP);

    this.updateBossMusic();
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
