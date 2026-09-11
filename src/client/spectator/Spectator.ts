import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Room } from "colyseus.js";

import { BOSS, BOT, MOB, daylightAt } from "#shared/constants";
import { CHANGELOG, CHANGELOG_SHOWN, CHANGELOG_HOLD_SEC } from "#shared/changelog";
import type { ZoneState, PlayerState } from "#shared/net/schema";
import type { ActKind, SpecCmd } from "#shared/net/messages";
import { LOADOUT } from "../config/loadout";
import { buildZone } from "../world/Zone";
import { PRESETS, type Quality } from "../config/quality";
import { Overlay, type OverlayCtx } from "./Overlay";
import { NetMobs } from "../combat/MobSystem";
import { LootDrops, makeWeaponMesh } from "../world/LootDrops";
import { preloadWeaponModels } from "../items/weaponModels";
import { RemoteAvatar } from "../entities/RemoteAvatar";
import { WorldCrossFx, CROSS_GREEN, CROSS_ORANGE } from "../ui/WorldCrossFx";
import { HealAuraFx } from "../ui/HealAuraFx";
import { SkillFx } from "../ui/SkillFx";
import { EventBeacon } from "../world/EventBeacon";
import { RenderWatch } from "./RenderWatch";
import { Sfx } from "../audio/Sfx";
import { TOWN_MUSIC, BOSS_MUSIC } from "../audio/playlist";
import { VoiceChat } from "../voice/VoiceChat";
import type { NetClient } from "../net/NetClient";
import { weaponDamage } from "#shared/combat";
import { armorFrac, moveSpeedFor, attackSpeedFor } from "#shared/progression";
import { magicResistFrac, fireboltDamage } from "#shared/magic";
import { ITEMS, weaponDef, type ItemId, type WeaponClass, type WeaponTier } from "#shared/items";
import {
  SpectatorCamera,
  type DirectorCtx,
  type CtxPlayer,
  type CtxMob,
} from "./SpectatorCamera";

const UP = { x: 0, y: 1, z: 0 };
/** См. Game.ts MISS_FX_DELAY — держим то же значение для спектатора. */
const MISS_FX_DELAY = 0.35;
const FORWARD_Z = new Vector3(0, 0, 1);
const TRANSPARENT = new Color4(0, 0, 0, 0);

export type { Quality };

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
  private readonly botLights: import("../world/BotLights").BotLights;
  private readonly healAura: HealAuraFx;
  /** Визуал массовых скиллов ботов (рассекающий удар, град стрел). */
  private readonly skillFx: SkillFx;
  private readonly eventBeacon: EventBeacon;
  /** Гасилка ближних деревьев — приезжает вместе с модулем леса. */
  private fadeTrees: ((x: number, z: number) => void) | null = null;
  private readonly crossFx: WorldCrossFx;
  private readonly _botPos: Vector3[] = [];
  private readonly _botFwd: Vector3[] = [];

  private readonly avatars = new Map<string, RemoteAvatar>();
  private net: NetClient | null = null;
  /** Голос игроков в эфире — включает/выключает пульт (SpecCmd "specVoice"). */
  private voice: VoiceChat | null = null;
  private voiceOn = false;
  /** Кто сейчас говорит — для зелёного огонька в оверлее и над аватаром. */
  private readonly speakingIds = new Set<string>();
  private bossMusicOn = false;
  private lastRaf = 0;
  private rafMs = 16.7; // сглаженный интервал между кадрами rAF (частота экрана)
  private capStep = 0; // счётчик кадров для равномерного кэпа по vsync
  private lastShotReport = 0;
  private lastCamReport = 0;
  private lastVoiceNudge = 0;
  private readonly fpsCap: number;
  private readonly fixedSize: { w: number; h: number } | null;
  private readonly reloadSec: number;
  /** Реальная частота вызовов scene.render() (getFps() врёт при кап-скипе). */
  private renderCount = 0;
  private renderRate = 0;
  private rateAt = 0;
  private readonly status: HTMLDivElement;
  private readonly debug: HTMLDivElement | null;
  private readonly overlay: Overlay | null;
  /** ?obs=1: прозрачная страница, пока нет живой связи с сервером. */
  private readonly obs: boolean;
  private live = false;
  /** performance.now() момента обрыва — держим картинку ещё пару секунд (сетевой чих). */
  private lostAt = 0;
  /** Сторож зависаний картинки + сбор диагностики (см. RenderWatch). */
  private watch: RenderWatch | null = null;

  // Пулы для tick(): режиссёру отдаём переиспользуемые объекты, без аллокаций
  // каждый кадр (иначе минорный GC даёт редкие рывки на телефоне).
  private readonly _players: CtxPlayer[] = [];
  private readonly _mobs: CtxMob[] = [];
  private readonly _playerPool: CtxPlayer[] = [];
  private readonly _mobPool: CtxMob[] = [];
  private readonly _boss = { id: "", pos: new Vector3(), aggro: false };
  private readonly _fwd = new Vector3();

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
      overlay?: boolean;
      obs?: boolean;
    } = {},
  ) {
    const preset = PRESETS[quality];
    // ?obs=1 — режим для OBS Browser Source: пока нет живой связи с сервером
    // (загрузка страницы, рестарт сервера, обрыв) страница прозрачная —
    // можно подложить в OBS слой-заглушку «сервер перезагружается».
    this.obs = override.obs === true;
    // Потолок fps: high — 60, остальные пресеты — 30. `?fpscap=` может только
    // урезать дальше (слабый телефон), но не поднять выше потолка пресета.
    const capMax = quality === "high" ? 60 : 30;
    const requestedCap = override.fpsCap ?? preset.fpsCap;
    this.fpsCap = requestedCap > 0 ? Math.min(requestedCap, capMax) : capMax;

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
      true, // MSAA: перенасыщенный цвет в Twitch оказался не из-за него —
      // баг был и раньше, до включения сглаживания (Android HW-энкодер,
      // известный класс проблем с цветовой матрицей при захвате экрана) —
      // так что сглаживание возвращаем, дело не в нём.
      {
        stencil: false,
        antialias: true,
        powerPreference: "high-performance",
        doNotHandleContextLost: true,
        alpha: this.obs, // прозрачный бэкбуфер только в OBS-режиме
        premultipliedAlpha: false,
      },
      false,
    );
    if (this.fixedSize) this.engine.setSize(this.fixedSize.w, this.fixedSize.h);
    else this.engine.setHardwareScalingLevel(override.rs ?? preset.scaling);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = this.obs
      ? new Color4(0, 0, 0, 0)
      : new Color4(0.5, 0.7, 0.9, 1);
    if (this.obs) {
      // OBS композитит по альфе только если сама страница прозрачна.
      document.documentElement.style.background = "transparent";
      document.body.style.background = "transparent";
    }

    // buildZone красит небо по LOADOUT.world.hour ПРЯМО СЕЙЧАС — а до
    // подключения к серверу (первый кадр рисуем сразу, см. run()) это ещё
    // старое значение с прошлой сессии, часто глубокая ночь (дефолт 2.77).
    // Секунду-две зритель видел ночь, потом её резко сменяло настоящее
    // время с сервера. Пока не подключились — красивее полдень, чем угадывать.
    LOADOUT.world.hour = 12;

    const zone = buildZone(this.scene, {
      grass: preset.grass,
      fireflies: preset.fireflies,
      minLights: preset.minLights,
      simpleSky: preset.simpleSky,
      treeFade: true, // гасим ближние деревья — нужны отдельные меши
    });
    // Спектатору не нужны ни пикинг, ни точный bounding. Но при светлячках
    // набор источников меняется с наступлением ночи, а Aggressive кэширует
    // состояние между кадрами и не пересобирает шейдеры — земля и трава
    // оставались тёмными. Поэтому med/high (со светлячками) — Intermediate.
    this.scene.performancePriority = preset.fireflies && preset.fireflies > 0 ? 1 : 2;
    this.scene.skipPointerDownPicking = true;
    this.scene.skipPointerUpPicking = true;
    this.scene.skipPointerMovePicking = true;
    this.scene.pointerMovePredicate = () => false;
    this.zoneTick = zone.tick;
    this.groundHeight = zone.groundHeight;
    this.botLights = zone.botLights;
    this.crossFx = new WorldCrossFx(this.scene);
    this.healAura = new HealAuraFx(this.scene);
    this.skillFx = new SkillFx(this.scene);
    this.eventBeacon = new EventBeacon(this.scene);
    this.eventBeacon.bindGround(zone.groundHeight);
    // Камера стрима часто идёт вплотную к стволам — ближние деревья гасим,
    // иначе крона закрывает весь кадр (в самой игре этого нет).
    void import("../world/nature").then((m) => {
      m.enableTreeFade();
      this.fadeTrees = m.fadeTreesNear;
    });

    this.cam = new SpectatorCamera(this.scene, override.raw === true);

    // Мобы и лут — переиспользуем менеджеры игры. Бой спектатору не нужен:
    // цели пустые, репорт попаданий — заглушка.
    preloadWeaponModels(this.scene);
    this.netMobs = new NetMobs(this.scene, this.sfx, [], () => {}, preset.leanMobs);
    this.loot = new LootDrops(this.scene);

    // Статус связи поверх картинки — на «слепом» боксе иначе не понять, что не так.
    this.status = document.createElement("div");
    this.status.style.cssText =
      "position:fixed;left:0;right:0;top:44%;text-align:center;color:#fff;" +
      "font:600 30px/1.4 system-ui,sans-serif;text-shadow:0 2px 12px #000;" +
      "pointer-events:none;z-index:10";
    // OBS-режим: своих плашек не рисуем вовсе — заглушку кладёт стример слоем ниже.
    this.status.textContent = this.obs ? "" : "ZEP GAME — подключаюсь…";
    this.status.style.display = this.obs ? "none" : "block";
    document.body.appendChild(this.status);

    // ?debug=1 — ещё и сцена наружу: иначе с прода не заглянуть, какие
    // источники реально попали в шейдер конкретного материала.
    if (showDebug) {
      (window as unknown as { __zep?: unknown }).__zep = {
        scene: this.scene,
        engine: this.engine,
        // Чем кормим подсветку: без этих величин с прода не понять, чей
        // расчёт даёт ноль — часы, дневной свет или сама BotLights.
        state: () => ({
          hour: LOADOUT.world.hour,
          daylight: daylightAt(LOADOUT.world.hour),
          bots: this._botPos.length,
          botLightsNight: (this.botLights as unknown as { night: number }).night,
        }),
      };
    }

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

    // Оверлеи стрима (Ф6): вотермарк, часы, онлайн, «смотрим», HP цели, заставки.
    this.overlay = override.overlay === false ? null : new Overlay();

    // Звук стрима: музыка + позиционные эффекты. На боксе жеста нет —
    // добиваемся включения повторными resume() и по возврату вкладки.
    this.sfx.startMusic(TOWN_MUSIC, 0.07);
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

    // Бросок отсюда улетал бы наружу через scene.render() и обрывал цепочку
    // rAF навсегда (Babylon ставит следующий кадр в очередь В КОНЦЕ цикла) —
    // ровно так картинка и «зависала» при живом оверлее. Ловим и продолжаем.
    this.scene.onBeforeRenderObservable.add(() => {
      try {
        this.tick();
      } catch (e) {
        this.watch?.onError("tick", e);
      }
    });
  }

  /** Подключиться к миру невидимым наблюдателем и начать рендер. */
  async run(net: NetClient, key: string): Promise<boolean> {
    this.net = net;
    net.onAct = (k, x, y, z, id, d) => this.playRemoteAct(k, x, y, z, id, d);
    net.onReconnected = (room) => {
      // Пиры голоса привязаны к старой сессии — пересобираем начисто.
      const wantVoice = this.voiceOn;
      if (this.voice) {
        this.voice.dispose();
        this.voice = null;
        this.voiceOn = false;
        this.speakingIds.clear();
      }
      this.attach(room);
      this.setStatus("");
      this.live = true;
      this.lostAt = 0;
      if (wantVoice) this.setVoice(true);
    };
    net.onConnectionLost = () => {
      this.setStatus("ZEP GAME — связь потеряна, переподключаюсь…");
      this.live = false;
      this.lostAt = performance.now();
    };
    net.onSpecCmd = (cmd) => this.applySpecCmd(cmd);
    net.onRtc = (msg) => void this.voice?.handle(msg);
    net.onVoice = (id, t, d) => this.voice?.onVoicePacket(id, t, d);
    net.onKillFeed = (by, victim) => this.overlay?.pushKill(by, victim);
    net.onBossEvent = (kind, by, loot) => {
      this.overlay?.bossBanner(kind, by, loot);
      if (kind === "down") this.sfx.bossFanfare();
      else this.sfx.bossHorn();
    };
    net.onWorldEvent = (phase, name) => {
      const hunt = name === "Охота";
      if (phase === "start") {
        this.overlay?.showCard(
          hunt ? "Охота на элиту!" : `${name}!`,
          hunt ? "в мире объявился Грибной владыка — редкая добыча" : "мобы лезут волнами — герои сбегаются",
          6,
        );
        this.sfx.bossHorn();
      } else if (phase === "win") {
        this.overlay?.showCard(
          hunt ? "Грибной владыка повержен" : `${name} отражено`,
          "участникам — ×2 опыт и урон + легендарка" + (hunt ? "" : " на 15 мин"),
          6,
        );
        this.sfx.bossFanfare();
      } else {
        this.overlay?.showCard(hunt ? "Грибной владыка ушёл" : `${name} утихло`, "", 4);
      }
    };
    net.onLeaderboard = (rows) => this.overlay?.setLeaderboard(rows);
    net.onBotSay = (id, text) => this.avatars.get(id)?.say(text);
    net.onEmote = (id, emote) => this.avatars.get(id)?.playEmote(emote);

    // Сторож зависаний картинки: ловит симптом (оверлей жив, кадр застыл),
    // перезагружает страницу И собирает отчёт о причине — консоль браузер-
    // источника OBS никто не видит, поэтому отчёт уходит в журнал сервера.
    this.watch = new RenderWatch(
      this.engine,
      this.scene,
      () => this.cam.cam.position,
      () => this.renderRate,
      (text) => this.net?.sendSpecCmd({ t: "diag", text }),
      (text) => this.setStatus(text),
    );
    this.watch.start();

    // Рендерим в любом случае (небо + статус) — картинка на стриме не должна
    // быть чёрной, даже пока сервер не поднялся.
    this.engine.runRenderLoop(() => {
      try {
        this.frame();
      } catch (e) {
        this.watch?.onError("frame", e);
      }
    });

    const ok = await net.connectSpectator(key);
    if (!ok) {
      this.setStatus("ZEP GAME — сервер недоступен, перезагрузка…");
      setTimeout(() => location.reload(), 30_000); // Fully Kiosk тоже перезагрузит
      return false;
    }
    this.setStatus("");
    if (net.room) this.attach(net.room);
    this.live = true;
    this.lostAt = 0;
    void this.watchForUpdates();
    return true;
  }

  /**
   * Один кадр стрима. Вынесен из runRenderLoop, чтобы весь его код был под
   * общим try/catch: непойманный бросок отсюда навсегда обрывал цепочку rAF.
   */
  private frame(): void {
    // Babylon сам пере-ресайзит canvas (ResizeObserver) под вьюпорт —
    // при фиксированном размере каждый кадр возвращаем нужный (no-op, если совпал).
    if (this.fixedSize) {
      this.engine.setSize(this.fixedSize.w, this.fixedSize.h);
    }
    const now = performance.now();

    // Кэп fps — равномерно по частоте экрана: рендерим каждый N-й кадр rAF
    // (60 Гц + кэп 30 → каждый второй, ровно). Ограничение по времени
    // (`now - last < step`) давало рывки: джиттер rAF то пропускал лишний
    // кадр, то нет, и при среднем «30 fps» картина дёргалась.
    if (this.lastRaf > 0) {
      const d = now - this.lastRaf;
      if (d > 4 && d < 100) this.rafMs += (d - this.rafMs) * 0.1;
    }
    this.lastRaf = now;
    if (this.fpsCap > 0) {
      const n = Math.max(1, Math.round(1000 / this.fpsCap / this.rafMs));
      this.capStep = (this.capStep + 1) % n;
      if (this.capStep !== 0) return;
    }

    this.renderCount++;
    if (this.rateAt === 0) {
      this.rateAt = now;
    } else if (now - this.rateAt > 1000) {
      this.renderRate = (this.renderCount * 1000) / (now - this.rateAt);
      this.renderCount = 0;
      this.rateAt = now;
    }

    // OBS-режим: нет живой связи (и прошла пара секунд с обрыва) — не рисуем
    // мир вовсе, отдаём прозрачный кадр. В OBS снизу видно слой-заглушку.
    if (this.obs && !this.live && (this.lostAt === 0 || now - this.lostAt > 2500)) {
      this.overlay?.setShown(false);
      this.engine.clear(TRANSPARENT, true, true);
      // Цикл rAF жив — просто ждём связь. Иначе сторож примет паузу без
      // связи за «цикл рендера встал» и уйдёт в цикл перезагрузок.
      this.watch?.afterRender(now);
      return;
    }
    if (this.obs) this.overlay?.setShown(true);
    this.scene.render();
    // Пробу кадра сторож снимает ИМЕННО здесь, сразу после отрисовки: из
    // setInterval читать бэкбуфер нельзя — там уже может быть что угодно.
    this.watch?.afterRender(now);
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
    // В OBS-режиме своих плашек не рисуем — заглушку кладёт сам стример слоем ниже.
    if (this.obs) return;
    this.status.textContent = text;
    this.status.style.display = text ? "block" : "none";
  }

  /** Команда со стрим-дашборда (этап 17 Ф5). */
  private applySpecCmd(cmd: SpecCmd): void {
    if (cmd.t === "cam") this.cam.forceShot(cmd.shot);
    else if (cmd.t === "auto") this.cam.auto = cmd.on !== 0;
    else if (cmd.t === "bots") {
      this.cam.botsOnly = cmd.on !== 0;
      if (cmd.on !== 0) this.cam.auto = true; // режим имеет смысл только с авто
    }
    else if (cmd.t === "card") this.overlay?.showCard(cmd.title, cmd.sub ?? "", cmd.secs ?? 0);
    else if (cmd.t === "overlay") this.overlay?.setConfig(cmd.patch);
    else if (cmd.t === "specVoice") this.setVoice(cmd.on !== 0);
    else if (cmd.t === "ttsPlay") this.playChatTts(cmd.url);
    // "time"/"dayAuto" применяет сервер; "nowShot" — для дашбордов.
  }

  /**
   * Озвучка сообщения чата (сервер уже синтезировал mp3). Модуль
   * подгружается лениво — если озвучка на стриме не включена, его никто не
   * тянет.
   */
  private tts: import("./SpectatorTts").SpectatorTts | null = null;
  private ttsLoading = false;
  private playChatTts(url: string): void {
    if (this.tts) {
      this.tts.enqueue(url);
      return;
    }
    if (this.ttsLoading) return;
    this.ttsLoading = true;
    void this.sfx.resume();
    void import("./SpectatorTts").then(({ SpectatorTts }) => {
      this.tts = new SpectatorTts(this.sfx.audioContext());
      this.ttsLoading = false;
      this.tts.enqueue(url);
    });
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
      if (this.voice && !id.startsWith("bot:")) this.voice.addPeer(id);
    }, true);
    players.onRemove((_p, id) => {
      this.avatars.get(id)?.dispose();
      this.avatars.delete(id);
      this.voice?.removePeer(id);
    });
  }

  /**
   * Голос игроков в эфире (команда пульта). Спектатор — только слушатель:
   * микрофона у него нет, он лишь инициирует связь и принимает звук. Слышимость
   * ровная (не по месту) — для стрима важнее разборчивость, чем панорама.
   */
  private setVoice(on: boolean): void {
    if (on === this.voiceOn) return;
    this.voiceOn = on;

    if (!on) {
      this.voice?.dispose();
      this.voice = null;
      this.speakingIds.clear();
      for (const a of this.avatars.values()) a.setSpeaking(false);
      return;
    }

    void this.sfx.resume();
    const v = new VoiceChat(this.sfx.audioContext());
    v.micEnabled = false;
    v.spatial = false;
    v.send = (m) => this.net?.sendRtc(m);
    v.peerPosition = (id) => this.avatars.get(id)?.position ?? null;
    v.onSpeaking = (id, sp) => {
      if (sp) this.speakingIds.add(id);
      else this.speakingIds.delete(id);
      this.avatars.get(id)?.setSpeaking(sp);
    };
    this.voice = v;

    this.net?.room?.state.players.forEach((_p, id) => {
      if (!id.startsWith("bot:")) v.addPeer(id);
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
        const i = this._players.length;
        let e = this._playerPool[i];
        if (!e) {
          e = { id: "", nick: "", pos: new Vector3(), eye: new Vector3(), forward: new Vector3() };
          this._playerPool[i] = e;
        }
        e.id = id;
        e.nick = p.nick;
        e.pos.copyFromFloats(head.x, head.y - 0.5, head.z);
        e.eye.copyFrom(head);
        e.forward.copyFrom(av.eyeForward);
        this._players.push(e);
      });

      st.mobs.forEach((m, id) => {
        if (m.dead || m.kind === "shard") return;
        const r = MOB.bodyRadius * (m.scale > 0 ? m.scale : 1);
        const fx = Math.sin(m.yaw);
        const fz = Math.cos(m.yaw);
        const i = this._mobs.length;
        let e = this._mobPool[i];
        if (!e) {
          e = { id: "", kind: "", eye: new Vector3(), forward: new Vector3() };
          this._mobPool[i] = e;
        }
        e.id = id;
        e.kind = m.kind;
        e.eye.copyFromFloats(m.x + fx * r * 0.9, m.y + r * 1.1, m.z + fz * r * 0.9);
        e.forward.copyFromFloats(fx, 0, fz);
        this._mobs.push(e);
        if (m.kind === "boss") {
          let aggro = m.windup > 0 || m.charging === 1 || m.enraged === 1;
          st.players.forEach((p) => {
            if (Math.hypot(p.head.x - m.x, p.head.z - m.z) < BOSS.aggroRange) aggro = true;
          });
          this._boss.id = id;
          this._boss.pos.copyFromFloats(m.x, m.y, m.z);
          this._boss.aggro = aggro;
          boss = this._boss;
        }
      });
    }

    // Ночью ближайший к камере бот светит вокруг себя.
    this._botPos.length = 0;
    this._botFwd.length = 0;
    for (const av of this.avatars.values()) {
      if (!av.isBot) continue;
      this._botPos.push(av.position);
      this._botFwd.push(av.eyeForward);
    }
    this.botLights.update(
      dt,
      daylightAt(LOADOUT.world.hour),
      this.cam.cam.position,
      this._botPos,
      this._botFwd,
    );

    // Режиссёр.
    this.cam.update(dt, {
      players: this._players,
      mobs: this._mobs,
      boss,
      groundY: this.groundHeight,
    });

    // Мобы, лут.
    this.cam.cam.getDirectionToRef(FORWARD_Z, this._fwd);
    const fwd = this._fwd;
    this.netMobs.update(dt, this.cam.cam.position, fwd);
    this.loot.update(dt);
    this.crossFx.update(dt);
    this.healAura.update(dt);
    this.skillFx.update(dt);
    const est = this.net?.room?.state;
    if (est) {
      this.eventBeacon.set(est.eventKind, est.eventX, est.eventZ);
      this.eventBeacon.update(dt);
    }
    const cp = this.cam.cam.position;
    this.fadeTrees?.(cp.x, cp.z);
    if (this.voice) {
      this.voice.update(dt);
      // Игрок мог дать микрофон уже после установки связи — периодически
      // перезапрашиваем дорожку у тех, от кого её ещё нет.
      if (now - this.lastVoiceNudge > 4000) {
        this.lastVoiceNudge = now;
        this.voice.renegotiateMissing();
      }
    }

    // Позиционный звук — из точки камеры в направлении взгляда.
    const p = this.cam.cam.position;
    this.sfx.setListener({ x: p.x, y: p.y, z: p.z }, { x: fwd.x, y: fwd.y, z: fwd.z }, UP);

    this.updateBossMusic();

    // Раз в ~2 с сообщаем дашбордам, какой кадр сейчас в эфире.
    if (room && now - this.lastShotReport > 2000) {
      this.lastShotReport = now;
      this.net?.sendSpecCmd({ t: "nowShot", shot: this.cam.shotKind });
    }

    // Раз в ~200 мс — позиция камеры для метки в мире у игроков (Ф10).
    if (room && now - this.lastCamReport > 200) {
      this.lastCamReport = now;
      const t = this.cam.target;
      this.net?.sendSpecCam({ x: p.x, y: p.y, z: p.z, tx: t.x, ty: t.y, tz: t.z });
    }

    if (this.overlay) this.updateOverlay(room?.state ?? null);

    if (this.debug) {
      const st = room?.state;
      const dpr = window.devicePixelRatio || 1;
      this.debug.textContent =
        `${this.renderRate.toFixed(0)} fps · рендер ${this.engine.getRenderWidth()}×${this.engine.getRenderHeight()}` +
        ` · дисплей ${screen.width}×${screen.height} · CSS ${innerWidth}×${innerHeight} · dpr ${dpr.toFixed(2)}` +
        ` · игроков ${st?.players.size ?? 0} · ${this.cam.shotKind}` +
        ` · ${this.watch?.debugLine() ?? ""}`;
    }
  }

  private static mobName(kind: string): string {
    return kind === "boss" ? "Багровый" : kind === "spitter" ? "Плевун" : "Слизень";
  }

  private static shotLabel(kind: string): string {
    if (kind === "overview") return "Обзор зоны";
    if (kind.startsWith("path ")) return `Пролёт: ${kind.slice(6, -1)}`;
    if (kind === "orbitBoss") return "Багровый";
    return "Зона";
  }

  /** Собираем контекст для оверлеев (Ф6) и отдаём его слою. */
  /** Краткие боевые характеристики игрока для панели «смотрим» (без атрибутов). */
  private static playerStatLine(p: PlayerState): string {
    const parts: string[] = [`ур. ${p.level}`];
    const cls = p.rightCls as WeaponClass | "";
    const tier = (p.rightTier || "base") as WeaponTier;
    const tierMul = cls && cls !== "shield" ? weaponDef(cls, tier).mult : 1;
    if (cls === "bow") {
      parts.push(`лук ×${weaponDamage("arrow", p.level, p.str, tierMul, p.agi).toFixed(1)}`);
    } else if (cls === "staff") {
      parts.push(`магия ×${fireboltDamage(p.level, p.int, 1).toFixed(1)}`);
    } else if (cls === "sword" || cls === "") {
      parts.push(`меч ×${weaponDamage("sword", p.level, p.str, tierMul, p.agi).toFixed(1)}`);
    }
    const arm = armorFrac(p.str);
    const mres = magicResistFrac(p.int);
    if (arm >= 0.03) parts.push(`броня ${Math.round(arm * 100)}%`);
    if (mres >= 0.05) parts.push(`маг.защ ${Math.round(mres * 100)}%`);
    parts.push(`${moveSpeedFor(p.level, p.agi).toFixed(1)} м/с`);
    // темп атаки — только если заметно выше базы
    const spd = attackSpeedFor(p.level, p.agi);
    if (spd >= 1.15) parts.push(`темп ×${spd.toFixed(2)}`);
    return parts.join(" · ");
  }

  /** Ярлык оружия/щита в руке для панели «HP цели». */
  private static weaponLabel(cls: string, tier: string): string | null {
    if (tier === "legendary") return weaponDef(cls as WeaponClass, "legendary").name.toLowerCase();
    if (cls === "shield") return "щит";
    const base =
      cls === "sword" ? "меч" : cls === "bow" ? "лук" : cls === "staff" ? "посох" : null;
    if (!base) return null;
    return tier === "gold" ? `золотой ${base}` : base;
  }

  /** Краткий инвентарь игрока: что в руках + содержимое сумки. */
  private static playerInvLine(p: PlayerState): string {
    const hands: string[] = [];
    const r = Spectator.weaponLabel(p.rightCls, p.rightTier);
    const l = Spectator.weaponLabel(p.leftCls, p.leftTier);
    if (r) hands.push(r);
    if (l && l !== r) hands.push(l);

    const counts = new Map<string, number>();
    p.bag.forEach((s) => {
      if (s.item && s.count > 0) counts.set(s.item, (counts.get(s.item) ?? 0) + s.count);
    });
    const bag: string[] = [];
    for (const [id, n] of counts) {
      const short = id === "potion" ? "зелья" : (ITEMS[id as ItemId]?.short ?? id).toLowerCase();
      bag.push(`${short} ×${n}`);
    }

    const parts = [...hands, ...bag];
    return parts.length ? parts.join(" · ") : "";
  }

  private changelogIdx = 0;
  private changelogAt = 0;

  /** Свежие изменения игры — по одной короткой строке, перебором. */
  private changelogLine(): string {
    const items = CHANGELOG.slice(0, CHANGELOG_SHOWN);
    if (items.length === 0) return "";
    const now = performance.now();
    if (this.changelogAt === 0) this.changelogAt = now;
    if (now - this.changelogAt > CHANGELOG_HOLD_SEC * 1000) {
      this.changelogAt = now;
      this.changelogIdx = (this.changelogIdx + 1) % items.length;
    }
    return items[this.changelogIdx % items.length];
  }

  private updateOverlay(st: ZoneState | null): void {
    const subj = this.cam.subject;
    let watching: string | null = null;
    let watchStats: string | null = null;
    let watchInv: string | null = null;
    let targetHp: OverlayCtx["targetHp"] = null;

    if (st && subj.id) {
      if (subj.type === "player") {
        const p = st.players.get(subj.id);
        if (p) {
          watching = p.nick;
          watchStats = Spectator.playerStatLine(p);
          watchInv = Spectator.playerInvLine(p);
          targetHp = { frac: p.hp / (p.maxHp || 1), cur: p.hp, max: p.maxHp, name: p.nick, boss: false };
        }
      } else if (subj.type === "mob") {
        const m = st.mobs.get(subj.id);
        if (m && !m.dead) {
          const name = m.mobName || Spectator.mobName(m.kind);
          watching = name;
          targetHp = { frac: m.hp / (m.maxHp || 1), cur: m.hp, max: m.maxHp, name, boss: m.kind === "boss" };
        }
      }
    }

    const online: { nick: string; speaking: boolean }[] = [];
    st?.players.forEach((p, id) => online.push({ nick: p.nick, speaking: this.speakingIds.has(id) }));

    // Строка сверху: идёт ивент — крупно; иначе крутим свежие изменения игры.
    if (st?.eventKind === 1) {
      this.overlay?.setTicker("Идёт ивент — нашествие мобов (!event)", "event");
    } else if (st?.eventKind === 2) {
      this.overlay?.setTicker("Идёт ивент — охота на элиту (!event)", "event");
    } else {
      this.overlay?.setTicker(this.changelogLine(), "news");
    }

    this.overlay?.update({
      watching,
      watchStats,
      watchInv,
      shotLabel: Spectator.shotLabel(this.cam.shotKind),
      targetHp,
      online,
    });
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
    this.sfx.setMusic(near ? BOSS_MUSIC : TOWN_MUSIC, near ? 0.1 : 0.07);
  }

  /** Звук действия игрока по сети — как в игре, но без своих эффектов. */
  private playRemoteAct(
    k: ActKind,
    x: number,
    y: number,
    z: number,
    id: string,
    d?: number,
  ): void {
    const at = { x, y, z };
    switch (k) {
      case "swing":
        this.sfx.swordSwing(at);
        this.avatars.get(id)?.playSwing();
        break;
      case "step":
        this.sfx.at(at, () => this.sfx.footstep(0.85));
        break;
      case "drink":
        this.sfx.at(at, () => this.sfx.drink());
        this.crossFx.burst(x, y, z, 5, CROSS_GREEN);
        break;
      case "levelUp":
        this.sfx.at(at, () => this.sfx.levelUp());
        this.crossFx.burst(x, y, z, 9, CROSS_ORANGE);
        break;
      case "healAura":
        this.healAura.burst(x, y, z, BOT.healRadius, BOT.healCastTime);
        this.sfx.at({ x, y, z }, () => this.sfx.levelUp());
        break;
      case "stunBash":
        this.skillFx.stunBash(x, y, z, BOT.stunRadius, d ?? BOT.stunCastTime);
        break;
      case "stunHit":
        this.sfx.at({ x, y, z }, () => this.sfx.groundBash());
        break;
      case "swordHit":
        this.sfx.at({ x, y, z }, () => this.sfx.swordHit());
        break;
      case "arrowRain":
        this.skillFx.arrowRain(x, y, z, BOT.rainRadius, BOT.rainCastTime);
        this.sfx.at({ x, y, z }, () => this.sfx.arrowVolley());
        break;
      case "bow":
        this.sfx.at(at, () => this.sfx.bowRelease(0.8));
        this.avatars.get(id)?.playSwing();
        break;
      case "crit":
        this.crossFx.critMark(x, y + 0.4, z);
        this.sfx.arrowCrit({ x, y, z });
        break;
      case "arrowHit":
        this.sfx.at(at, () => this.sfx.arrowHit("wood", 0.8));
        break;
      case "hurt":
        this.sfx.at(at, () => this.sfx.playerHurt());
        this.avatars.get(id)?.playHitReact();
        break;
      case "dodge":
        this.crossFx.missText(x, y - 1, z, MISS_FX_DELAY);
        break;
      case "blockShield":
        this.sfx.at(at, () => this.sfx.block(1));
        break;
      case "blockSword":
        this.sfx.at(at, () => this.sfx.block(0.5));
        break;
      case "pickup":
        this.avatars.get(id)?.playPickup();
        break;
    }
  }
}
