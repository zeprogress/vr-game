import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import "@babylonjs/core/Collisions/collisionCoordinator";

import { WebXRDefaultExperience } from "@babylonjs/core/XR/webXRDefaultExperience";
import { WebXRState } from "@babylonjs/core/XR/webXRTypes";

import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Node } from "@babylonjs/core/node";

import { buildZone } from "../world/Zone";
import { CombatSystem, STOW } from "../combat/CombatSystem";
import { NetMobs } from "../combat/MobSystem";
import type { Hittable, HitReporter } from "../combat/Hittable";
import { Hud } from "../ui/Hud";
import { HealthBar3D } from "../ui/HealthBar3D";
import { VrVignette } from "../ui/VrVignette";
import { ComfortVignette } from "../ui/ComfortVignette";
import { WristPanel } from "../ui/WristPanel";
import { LoadoutPanel } from "../ui/LoadoutPanel";
import { LOADOUT, printLoadout, importOverrides, exportOverrides } from "../config/loadout";
import { HUD, VIGNETTE } from "#shared/constants";
import { Sfx } from "../audio/Sfx";
import { Hands } from "../player/Hands";
import { Progression } from "../player/Progression";
import { Inventory } from "../player/Inventory";
import { LootDrops, makeWeaponMesh } from "../world/LootDrops";
import { PlayerController } from "../player/PlayerController";
import { DesktopInput } from "../input/DesktopInput";
import { TouchInput } from "../input/TouchInput";
import { XRInput } from "../input/XRInput";
import type { InputSource } from "../input/InputSource";
import type { NetClient } from "../net/NetClient";
import { RemoteAvatar } from "../entities/RemoteAvatar";
import { VoiceChat } from "../voice/VoiceChat";
import { FxaaPostProcess } from "@babylonjs/core/PostProcesses/fxaaPostProcess";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { ActKind, CharMsg, MoveMsg, SaveMsg, Xf7 } from "#shared/net/messages";
import type { PlayerState, ZoneState } from "#shared/net/schema";
import type { Room } from "colyseus.js";
import { noGuard, type BlockedBy } from "#shared/combat";
import { ITEMS, weaponDef, type WeaponClass, type WeaponTier } from "#shared/items";
import { ADMIN_NICK, BOSS, PLAYER, RESPAWN } from "#shared/constants";

const TOWN_MUSIC = "/music/town-dion.mp3";
const BOSS_MUSIC = "/music/boss.mp3";

/**
 * Каркас движка: один Engine, одна Scene, один рендер-луп.
 * Выбирает источник ввода по устройству и подключает WebXR.
 */
export class Game {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly player: PlayerController;
  readonly progression = new Progression();
  readonly inventory = new Inventory();
  readonly hands: Hands;
  readonly isTouch: boolean;
  private readonly ground: Mesh;
  private readonly combat: CombatSystem;
  private readonly netMobs: NetMobs;
  private readonly loot: LootDrops;
  private readonly zoneTick: (
    dt: number,
    playerPos: Vector3,
    net?: { hour: number; auto: number } | null,
  ) => void;
  /** Ник этого игрока: панель настройки открывает только админ (ADMIN_NICK). */
  private localNick = "";
  /** Голосовой чат: разговор идёт напрямую между игроками. */
  readonly voice: VoiceChat;
  /** Общий список целей (мобы + куклы) — наполняет NetMobs, читает CombatSystem. */
  private readonly targets: Hittable[] = [];
  private readonly sfx = new Sfx();
  private readonly hud = new Hud();

  /** Узел, который следует за головой, но не наклоняется: HUD параллелен горизонту. */
  private hudAnchor: TransformNode | null = null;
  private playerBar3D: HealthBar3D | null = null;
  private vrVignette: VrVignette | null = null;
  private comfortVignette: ComfortVignette | null = null;
  private wristPanel: WristPanel | null = null;
  loadoutPanel: LoadoutPanel | null = null;
  private xrInput: XRInput | null = null;
  xr: WebXRDefaultExperience | null = null;

  // Сеть: чужие игроки.
  private net: NetClient | null = null;
  private readonly avatars = new Map<string, RemoteAvatar>();
  private readonly aim = new Vector3(0, 0, 1);
  /** Слепок содержимого рук — чтобы не слать серверу одно и то же. */
  private handsKey = "";
  /** Про неудачу голоса говорим один раз, а не на каждого собеседника. */
  private voiceWarned = false;
  /** Сглаживание краёв кадра и камера, к которой оно прицеплено. */
  private fxaa: FxaaPostProcess | null = null;
  private fxaaCam: Camera | null = null;
  private readonly moveMsg: MoveMsg = {
    mode: "flat",
    head: zeros7(),
    handL: zeros7(),
    handR: zeros7(),
    guard: noGuard(),
  };
  /** Локальный отсчёт до возрождения — только для надписи на экране. */
  private deathCountdown = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { stencil: true, antialias: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.5, 0.7, 0.9, 1);
    this.scene.collisionsEnabled = true;

    const zone = buildZone(this.scene);
    this.ground = zone.ground;
    this.zoneTick = zone.tick;

    this.player = new PlayerController(this.scene, this.progression);
    this.player.setObstacles(zone.obstacles);
    this.scene.activeCamera = this.player.camera;
    this.player.placeOnGround();

    this.combat = new CombatSystem(
      this.scene,
      this.player,
      () => this.xr,
      this.targets,
      this.sfx,
      this.progression,
      zone.groundHeight,
      zone.swordHome,
      zone.bowHome,
      zone.shieldHome,
    );
    const report: HitReporter = (id, target, weapon, dx, dz) =>
      this.net?.sendHitMob({ id, target, weapon, hand: this.combat.lastHitHand, dx, dz });
    this.netMobs = new NetMobs(this.scene, this.sfx, this.targets, report);
    this.loot = new LootDrops(this.scene);
    this.voice = new VoiceChat(this.sfx.audioContext());
    this.voice.peerPosition = (id) => this.avatars.get(id)?.position ?? null;
    this.voice.onSpeaking = (id, on) => this.avatars.get(id)?.setSpeaking(on);
    // Молчащий голос без объяснения выглядит поломкой — говорим прямо.
    this.voice.onPeerFailed = () => {
      if (this.voiceWarned) return;
      this.voiceWarned = true;
      this.hud.toast("Голос не пробился: мешает VPN или сеть");
    };
    this.voice.onPeerState = (_id, state) => {
      if (state === "говорим") this.hud.toast("Голос: связь установлена");
      else if (state === "соединяется") this.hud.toast("Голос: соединяюсь…");
    };
    this.hands = new Hands(this.scene);
    this.hud.bindProgression(this.progression);
    this.hud.bindInventory(this.inventory);

    // Бутылочка на поясе показывает запас зелий и пьётся поднесением ко рту.
    const syncPotion = (): void => {
      this.combat.setPotionCount(this.potionCount());
    };
    this.inventory.onChange(syncPotion);
    syncPotion();
    this.combat.onDrinkPotion = () => {
      const slot = this.inventory.slots.findIndex((s) => s.item === "potion" && s.count > 0);
      if (slot >= 0) this.inventory.use(slot);
    };

    // Офлайн уровень считает Progression, онлайн — сервер шлёт MSG.levelUp.
    this.progression.onLevelUp = (lvl) => {
      this.levelUpFx(lvl);
      // Новый уровень поднимает потолок HP — доливаем разницу (офлайн).
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 10);
      this.showHp(this.player.hp);
    };

    this.player.hooks.step = () => {
      const p = this.player.position;
      const fx = p.x;
      const fy = p.y - PLAYER.eyeHeight; // под ногами, не у головы
      const fz = p.z;
      // Свои шаги слышим снизу — объёмно от точки под ногами.
      this.sfx.at({ x: fx, y: fy, z: fz }, () => this.sfx.footstep(0.9));
      this.net?.sendAct("step", fx, fy, fz);
    };
    this.player.hooks.jump = () => this.sfx.jump();
    this.player.hooks.land = (impact) => this.sfx.land(Math.min(1, impact / 9));
    this.player.hooks.hurt = (hp, dmg) => {
      this.sfx.playerHurt();
      this.showHp(hp);
      this.hud.setOpacity(1);
      this.playerBar3D?.setOpacity(1);
      this.hud.flashDamage(dmg);
      this.vrVignette?.flash(dmg);
      this.hapticBoth();
    };
    this.player.hooks.heal = (hp) => this.showHp(hp);
    this.player.hooks.respawn = () => {
      this.showHp(this.player.hp);
      this.hud.flashDamage(30);
    };
    this.showHp(this.player.hp);

    this.isTouch =
      window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
    this.player.setInput(this.defaultInput());

    // Звук и музыка стартуют только по жесту пользователя.
    this.sfx.startMusic(TOWN_MUSIC, 0.045); // тихий фон
    const wake = () => this.sfx.resume();
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);

    // Выключатель микрофона: в шлеме он в панели настройки, а на десктопе
    // до неё не добраться — поэтому клавиша M.
    window.addEventListener("keydown", (e) => {
      if (e.code !== "KeyM" || this.player.inVR) return;
      LOADOUT.voice.mic = LOADOUT.voice.mic ? 0 : 1;
      this.hud.toast(LOADOUT.voice.mic ? "Микрофон включён" : "Микрофон выключен");
    });

    this.scene.onBeforeRenderObservable.add(() => {
      const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.1);
      this.zoneTick(dt, this.player.position, this.net?.worldClock ?? null);
      this.player.update(dt);
      this.player.eyeForward.normalizeToRef(this.aim);
      this.netMobs.update(dt, this.player.position, this.aim);
      this.loot.update(dt);
      this.combat.update(dt);
      this.hands.update(dt);
      this.syncNet(dt);
      this.updateVoice(dt);
      this.updateSmoothing();
      this.updateVrUi(dt);
      this.updateLowHealthVignette(dt);
      this.vrVignette?.tick(dt);
      this.updateComfortVignette(dt);
      this.updateHpBarFade();
      this.updateBossMusic();
    });

    window.addEventListener("resize", () => this.engine.resize());
  }

  start(): void {
    this.engine.runRenderLoop(() => this.scene.render());
  }

  /** Готовность WebXR — экран входа ждёт её перед показом кнопки «Войти в VR». */
  xrReady: Promise<void> = Promise.resolve();

  /** Может ли это устройство в иммерсивный VR (шлем). Не виснет: таймаут 2.5 с. */
  async isVrAvailable(): Promise<boolean> {
    try {
      const xr = (navigator as { xr?: { isSessionSupported?(m: string): Promise<boolean> } }).xr;
      if (!xr?.isSessionSupported) return false;
      const timeout = new Promise<boolean>((r) => setTimeout(() => r(false), 2500));
      return await Promise.race([xr.isSessionSupported("immersive-vr"), timeout]);
    } catch {
      return false;
    }
  }

  get inVR(): boolean {
    return this.player.inVR;
  }

  /**
   * Запустить VR-сессию. Зовётся ИЗ обработчика клика без `await` перед этим —
   * иначе браузер теряет «жест пользователя» и `requestSession` отклоняется.
   * Поэтому `xrReady` дожидается экран входа, а тут только синхронная проверка.
   */
  enterVR(): Promise<boolean> {
    if (!this.xr) return Promise.resolve(false);
    const base = this.xr.baseExperience;
    if (base.state === WebXRState.IN_XR) return Promise.resolve(true);

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      // Резолвимся по ФАКТУ входа в XR, а не по промису enterXRAsync — тот на
      // части шлемов не резолвится, и экран входа завис бы навсегда (в VR его
      // всё равно не видно). Плюс страховка по таймауту.
      const obs = base.onStateChangedObservable.add((s) => {
        if (s === WebXRState.IN_XR) {
          base.onStateChangedObservable.remove(obs);
          done(true);
        }
      });
      setTimeout(() => {
        base.onStateChangedObservable.remove(obs);
        done(base.state === WebXRState.IN_XR);
      }, 15000);
      base.enterXRAsync("immersive-vr", "local-floor").catch((e: unknown) => {
        console.warn("не удалось войти в VR:", e);
        done(base.state === WebXRState.IN_XR);
      });
    });
  }

  /** Инициализация WebXR. Вход в VR — по кнопке с экрана входа (см. enterVR). */
  initXR(): Promise<void> {
    this.xrReady = this.setupXR();
    return this.xrReady;
  }

  private async setupXR(): Promise<void> {
    if (!("xr" in navigator)) return;
    try {
      this.xr = await WebXRDefaultExperience.CreateAsync(this.scene, {
        floorMeshes: [this.ground],
        disableTeleportation: true,
        disablePointerSelection: true, // без лазера у контроллеров
        inputOptions: { doNotLoadControllerMeshes: true }, // рисуем свои кисти
      });
    } catch (e) {
      console.warn("WebXR недоступен:", e);
      return;
    }

    // Своей кнопкой входа управляет экран входа. Штатную кнопку Babylon
    // прячем, но держим для ПОВТОРНОГО входа, если игрок вышел из VR.
    const overlay = this.xr.enterExitUI?.overlay;
    if (overlay) {
      overlay.style.top = "16px";
      overlay.style.right = "16px";
      overlay.style.bottom = "auto";
      overlay.style.display = "none";
    }

    const base = this.xr.baseExperience;
    base.onStateChangedObservable.add((state) => {
      if (overlay) overlay.style.display = state === WebXRState.NOT_IN_XR ? "" : "none";
      if (state === WebXRState.IN_XR) {
        this.sfx.resume();
        this.requestMaxFrameRate();
        this.player.enterXR(base.camera);
        this.xrInput = new XRInput(this.xr!);
        this.player.setInput(this.xrInput);
        this.hands.attach(this.xr!);
        this.buildVrUi();
      } else if (state === WebXRState.NOT_IN_XR) {
        // Убранное за спину НЕ роняем: в плоском режиме его не достать, но
        // при возврате в VR и при следующем входе оно на месте.
        this.player.exitXR();
        this.xrInput = null;
        this.player.setInput(this.defaultInput());
        this.scene.activeCamera = this.player.camera;
        this.hands.detach(this.xr!);
        this.tearDownVrUi();
      }
    });
  }

  /**
   * Просим шлем о самой высокой поддерживаемой частоте кадров. По умолчанию
   * Quest-браузер часто отдаёт 72 Гц (а 2D-панель — вовсе 60); список
   * доступен только после старта сессии. Если движок не будет успевать —
   * шлем сам опустит частоту (репроекция), хуже не станет.
   */
  private requestMaxFrameRate(): void {
    const sm = this.xr?.baseExperience.sessionManager;
    const rates = sm?.supportedFrameRates;
    if (!sm || !rates || rates.length === 0) return;
    const target = Math.max(...Array.from(rates));
    if (!Number.isFinite(target) || target <= (sm.currentFrameRate ?? 0)) return;
    sm.updateTargetFrameRate(target)
      .then(() => console.log(`[xr] запрошено ${target} Гц`))
      .catch((e: unknown) => console.warn("[xr] частоту кадров сменить не вышло:", e));
  }

  requestPointerLock(): void {
    if (!this.isTouch) this.canvas.requestPointerLock();
  }

  /**
   * Диагностика из консоли: какие кнопки контроллеров сейчас нажаты.
   * Если панель персонажа не открывается — зажми нужную кнопку, вызови
   * `game.vrButtons()` и поставь её индекс в LOADOUT.buttons.panelToggle.
   */
  vrButtons(): unknown {
    if (!this.xrInput) return "не в VR (или контроллеры ещё не подключились)";
    return this.xrInput.dumpButtons();
  }

  /**
   * Печатает текущие значения экипировки готовым блоком для вставки в
   * src/config/loadout.ts. Так подобранное (в т.ч. в шлеме) переносится в
   * файл — единственное надёжное место, не привязанное к адресу/браузеру.
   */
  printLoadout(): void {
    printLoadout();
  }

  /**
   * Положение убранных за спину предметов (меч/лук/щит × левая/правая).
   * Меняется на лету: `game.stowConfig().sword.left.pos[2] = -0.2`.
   */
  stowConfig(): typeof STOW {
    return STOW;
  }

  // ---- VR-интерфейс ----

  private buildVrUi(): void {
    const cam = this.xr!.baseExperience.camera;

    // Полоса здоровья висит в мире, но следует за головой без наклона —
    // остаётся параллельной горизонту.
    this.hudAnchor = new TransformNode("hudAnchor", this.scene);
    const hp = LOADOUT.hud.hpPos;
    this.playerBar3D = new HealthBar3D(
      this.scene,
      this.hudAnchor,
      new Vector3(hp[0], hp[1], hp[2]), // положение правится в панели настройки
      0.675, // в 1.5 раза длиннее
      false,
      0.05, // вдвое тоньше
    );
    this.playerBar3D.set(this.player.hp / this.player.maxHp);

    this.vrVignette = new VrVignette(this.scene);
    this.comfortVignette = new ComfortVignette(this.scene, this.xr);

    // Панели цепляются к кистям (или к контроллеру, если кисть ещё не создана).
    this.wristPanel = new WristPanel(
      this.scene,
      this.handNode("left", cam),
      this.progression,
      this.inventory,
    );
    this.wristPanel.onExit = () => void this.leaveWorld();
    this.loadoutPanel = new LoadoutPanel(this.scene, this.handNode("right", cam));
    // Перевод времени в панели уходит на сервер — часы общие для всей зоны.
    this.loadoutPanel.onWorldTime = (hour, auto) => this.net?.sendSetTime(hour, auto);
    // Комфорт VR (виньетка, режим перемещения) — общий для мира: на сервер.
    this.loadoutPanel.onComfort = (patch) => this.net?.sendComfort(patch);
    this.loadoutPanel.onClearWorld = () => this.net?.sendClearWorld();
    // «Сохранить» онлайн шлёт настройки на сервер (по токену игрока).
    this.loadoutPanel.onSaveServer = this.net?.online
      ? () => this.net!.sendLoadout(exportOverrides())
      : null;
  }

  /** Ник этого игрока — задаётся из main.ts после входа. */
  setNick(nick: string): void {
    this.localNick = nick;
  }

  /** Админ (ADMIN_NICK) — единственный, кто открывает панель настройки. */
  private get isAdmin(): boolean {
    return this.localNick.trim().toLowerCase() === ADMIN_NICK;
  }

  private handNode(side: "left" | "right", fallback: Node): Node {
    return (
      this.hands.nodeFor(side) ??
      this.xr?.input.controllers.find((c) => c.inputSource.handedness === side)?.grip ??
      fallback
    );
  }

  private tearDownVrUi(): void {
    this.wristPanel?.dispose();
    this.wristPanel = null;
    this.loadoutPanel?.dispose();
    this.loadoutPanel = null;
    this.playerBar3D?.dispose();
    this.playerBar3D = null;
    this.hudAnchor?.dispose();
    this.hudAnchor = null;
    this.vrVignette?.dispose();
    this.vrVignette = null;
    this.comfortVignette?.dispose();
    this.comfortVignette = null;
  }

  private updateVrUi(dt: number): void {
    const cam = this.xr?.baseExperience.camera;
    if (this.hudAnchor && cam) {
      // Позиция головы + только рыскание: панель не заваливается вместе с обзором.
      this.hudAnchor.position.copyFrom(cam.globalPosition);
      const f = cam.getDirection(new Vector3(0, 0, 1));
      this.hudAnchor.rotation.set(0, Math.atan2(f.x, f.z), 0);
    }

    // Полоска жизней правится в панели настройки — подхватываем на лету.
    const hp = LOADOUT.hud.hpPos;
    this.playerBar3D?.moveTo(hp[0], hp[1], hp[2]);

    const inp = this.player.lastInput;
    if (inp.panelToggle) this.wristPanel?.toggle();
    this.wristPanel?.update(inp.uiNext, inp.uiConfirm, dt);

    // Панель настройки экипировки: открыть — только 5 нажатий B за 3 с
    // (чтобы случайно не всплывала). Открытую закрывает одиночный B.
    this.tuneClock += dt;
    if (inp.tuneToggle && this.isAdmin) {
      if (this.loadoutPanel?.visible) {
        this.loadoutPanel.toggle();
        this.tuneTaps.length = 0;
      } else if (!this.wristPanel?.visible) {
        this.tuneTaps.push(this.tuneClock);
        this.tuneTaps = this.tuneTaps.filter((t) => this.tuneClock - t <= 3);
        if (this.tuneTaps.length >= 5) {
          this.loadoutPanel?.toggle();
          this.tuneTaps.length = 0;
        }
      }
    }
    this.loadoutPanel?.update(inp.tuneNavY, inp.tuneDec, inp.tuneInc, inp.tuneStep, dt);
    // Пока панель настройки открыта, X/Y/A меняют значения (движение свободно).
    if (this.xrInput) this.xrInput.tuneOpen = this.loadoutPanel?.visible ?? false;

    // Панели цепляются к кистям, как только контроллеры появились.
    for (const [side, panel] of [
      ["left", this.wristPanel],
      ["right", this.loadoutPanel],
    ] as const) {
      const node = this.hands.nodeFor(side);
      if (node && panel && panel.anchor !== node) panel.reparent(node);
    }
  }

  private lowHpT = 0;
  private tuneClock = 0;
  private tuneTaps: number[] = [];

  /** Постоянная красная виньетка: тем сильнее и быстрее пульсирует, чем меньше HP. */
  private updateLowHealthVignette(dt: number): void {
    const frac = this.player.hp / this.player.maxHp;
    this.vrVignette?.setHealth(frac);

    const t = VIGNETTE.lowHpFrom;
    const low = t <= 0 ? 0 : Math.max(0, Math.min(1, (t - frac) / t));
    this.lowHpT += dt * (3 + low * 4);
    const pulse = 1 + VIGNETTE.lowPulse * low * Math.sin(this.lowHpT);
    this.hud.setLowHealth(low * low * VIGNETTE.lowMaxAlpha * pulse);
  }

  /**
   * Чёрная виньетка при перемещении левым стиком (VR): сужает обзор на время
   * движения. Общий выключатель — на сервере (ставит админ в панели настроек).
   */
  private updateComfortVignette(dt: number): void {
    if (!this.comfortVignette) return; // существует только в VR
    const st = this.net?.room?.state;
    const allowed = (st?.comfortVignette ?? 1) !== 0;
    const teleport = (st?.teleportMove ?? 0) !== 0;
    // Держим LOADOUT в курсе актуальных значений — панель их показывает.
    LOADOUT.comfort.vignette = allowed ? 1 : 0;
    LOADOUT.comfort.teleport = teleport ? 1 : 0;
    this.player.setTeleportMode(teleport);

    const inp = this.player.lastInput;
    // При телепорте непрерывного движения нет — тоннель не нужен, только блинк.
    const stick = teleport ? 0 : Math.min(1, Math.hypot(inp.moveX, inp.moveY) / 0.9);
    this.comfortVignette.tick(dt, stick, allowed);
    if (this.player.consumeTeleportBlink()) this.comfortVignette.blink();
  }

  private showHp(hp: number): void {
    this.hud.setHp(hp, this.player.maxHp);
    this.playerBar3D?.set(hp / this.player.maxHp);
    this.shownHp = hp;
  }
  private shownHp = -1;

  /**
   * Своё состояние с сервера: здоровье, смерть, прокачка.
   * Онлайн это единственный источник правды — клиент только отображает.
   */
  private syncSelf(dt: number, self: PlayerState): void {
    this.player.setHp(self.hp);
    if (Math.abs(self.hp - this.shownHp) > 0.01) this.showHp(self.hp);

    const dead = self.dead === 1;
    if (dead !== this.player.dead) {
      this.player.dead = dead;
      this.deathCountdown = dead ? RESPAWN.delay : 0;
      if (dead) {
        this.hud.flashDamage(40);
        this.vrVignette?.flash(40);
      }
    }
    if (dead) {
      this.deathCountdown = Math.max(0, this.deathCountdown - dt);
      this.hud.setDead(true, this.deathCountdown);
    }

    // Звук глотка — по подтверждённой сервером убыли, а не по нажатию:
    // на полном здоровье сервер зелье не тратит.
    const potions = this.potionCount();
    this.inventory.applyRemote(self.bag);
    const left = this.potionCount();
    if (left < potions) this.sfx.drink();

    // Прокачку применяем только при изменении: applyRemote перерисовывает панель.
    const p = this.progression;
    if (
      p.level !== self.level ||
      p.xp !== self.xp ||
      p.unspent !== self.unspent ||
      p.stats.str !== self.str ||
      p.stats.agi !== self.agi ||
      p.stats.int !== self.int
    ) {
      p.applyRemote({
        level: self.level,
        xp: self.xp,
        unspent: self.unspent,
        str: self.str,
        agi: self.agi,
        int: self.int,
      });
    }
  }

  /** Полоса здоровья: видна при уроне и пока не полное HP, иначе плавно гаснет. */
  private bossMusicOn = false;

  /** Рядом с живым боссом играет boss.mp3, вдали / после смерти — обычная. */
  private updateBossMusic(): void {
    let near = false;
    const mobs = this.net?.room?.state.mobs;
    if (mobs) {
      const p = this.player.position;
      mobs.forEach((m) => {
        if (m.kind !== "boss" || m.dead) return;
        const d = Math.hypot(m.x - p.x, m.z - p.z);
        // Гистерезис: заходим ближе musicRange, выходим дальше musicOut.
        if (d < BOSS.musicRange || (this.bossMusicOn && d < BOSS.musicOut)) near = true;
      });
    }
    if (near === this.bossMusicOn) return;
    this.bossMusicOn = near;
    this.sfx.setMusic(near ? BOSS_MUSIC : TOWN_MUSIC, near ? 0.07 : 0.045);
  }

  private updateHpBarFade(): void {
    const injured = this.player.hp < this.player.maxHp - 0.5;
    const t = this.player.sinceHurt;
    let opacity: number;
    if (injured || t < HUD.showTime) opacity = 1;
    else opacity = Math.max(0, 1 - (t - HUD.showTime) / HUD.fadeTime);
    this.hud.setOpacity(opacity);
    this.playerBar3D?.setOpacity(opacity);
  }

  private defaultInput(): InputSource {
    return this.isTouch ? new TouchInput() : new DesktopInput(this.canvas);
  }

  // ---- сеть: чужие игроки ----

  private saveTimer: number | null = null;
  private saveDebounce: number | null = null;
  private unsubProgress: (() => void) | null = null;

  /** Подключить сетевого клиента (уже в комнате). Аватары чужих + сейв персонажа. */
  attachNet(net: NetClient): void {
    this.net = net;
    net.onChar = (data) => this.applyChar(data);
    net.onMobHit = (dmg, fromX, fromZ, by) => this.takeMobHit(dmg, fromX, fromZ, by);
    net.onRespawn = (x, y, z) => {
      this.player.teleportTo(x, y, z);
      this.player.dead = false;
      this.hud.setDead(false);
      this.hud.flashDamage(20);
    };
    net.onLevelUp = (lvl) => this.levelUpFx(lvl);
    net.onPicked = (item, count) => {
      this.sfx.pickup();
      const w = ITEMS[item].weapon;
      if (w) {
        const d = weaponDef(w.cls, w.tier);
        this.sfx.levelUp();
        this.hud.toast(w.cls === "shield" ? d.name : `${d.name}: урон ×${d.mult}`);
      } else {
        this.hud.toast(`Подобрано: ${ITEMS[item].name}${count > 1 ? ` ×${count}` : ""}`);
      }
    };

    // Онлайн здоровьем и прокачкой владеет сервер.
    this.player.netControlled = true;
    this.progression.onSpendRequest = (stat) => net.sendSpend(stat);
    this.inventory.onUseRequest = (slot) => net.sendUseItem(slot);
    this.combat.nearestWorldWeapon = (pos) => this.loot.nearestWeapon(pos);
    this.combat.onTakeWorldWeapon = (id) => net.sendTakeWeapon(id);
    this.combat.makeWeaponMesh = (cls, tier) =>
      makeWeaponMesh(this.scene, cls as WeaponClass, tier);
    this.combat.onWeaponLanded = (cls, tier, x, z) => net.sendDropWeapon({ cls, tier, x, z });
    this.combat.onSoundEvent = (kind, x, y, z) => net.sendAct(kind, x, y, z);

    // Звук соседа — играем объёмно от его аватара / точки события.
    net.onAct = (k, x, y, z, id) => this.playRemoteAct(k, x, y, z, id);

    // Сервер перезапустился / связь оборвалась — переподключаемся на месте.
    net.onConnectionLost = () => this.hud.toast("Связь потеряна — переподключаюсь…");
    net.onReconnected = (room) => {
      this.attachRoom(room);
      this.handsKey = ""; // заново сообщить серверу, что в руках и за спиной
      this.saveNow();
      this.hud.toast("Снова в игре");
    };
    if (net.room) this.attachRoom(net.room);

    // Голос: спрашиваем микрофон и связываемся с теми, кто уже в комнате.
    this.voice.send = (m) => net.sendRtc(m);
    this.voice.sendVoice = (t, d) => net.sendVoice(t, d);
    net.onRtc = (m) => void this.voice.handle(m);
    net.onVoice = (id, t, d) => this.voice.onVoicePacket(id, t, d);
    void this.voice.start(net.sessionId).then((ok) => {
      if (!ok) {
        this.hud.toast(`Голос выключен: ${this.voice.micError ?? "нет микрофона"}`);
        return;
      }
      this.hud.toast("Микрофон готов");
      for (const id of this.avatars.keys()) this.voice.addPeer(id);
    });

    // Автосейв: раз в 30 с, при изменении прогресса (с задержкой) и перед выходом.
    this.saveTimer = window.setInterval(() => this.saveNow(), 30_000);
    this.unsubProgress = this.progression.onChange(() => {
      if (this.saveDebounce) window.clearTimeout(this.saveDebounce);
      this.saveDebounce = window.setTimeout(() => this.saveNow(), 1500);
    });
    window.addEventListener("beforeunload", this.beforeUnload);

    // Только теперь, когда фабрики мешей и колбэки на месте, разбираем
    // персонажа с сервера: иначе восстанавливать оружие было бы нечем.
    net.flushChar();
  }

  /**
   * Подписки на комнату: мобы, лут, аватары чужих. Зовётся при входе и при
   * КАЖДОМ переподключении (комната после рестарта сервера — новая).
   */
  private attachRoom(room: Room<ZoneState>): void {
    this.netMobs.attach(room);
    this.loot.attach(room);

    for (const a of this.avatars.values()) a.dispose();
    this.avatars.clear();

    const players = room.state.players;
    const add = (id: string): void => {
      if (id === this.net?.sessionId || this.avatars.has(id)) return;
      const p = players.get(id);
      if (!p) return;
      this.avatars.set(
        id,
        new RemoteAvatar(this.scene, id, p.nick, p.mode, (cls, tier) =>
          makeWeaponMesh(this.scene, cls, tier),
        ),
      );
      this.voice.addPeer(id);
    };
    players.onAdd((_p, id) => add(id), true); // true — сработает и для уже вошедших
    players.onRemove((_p, id) => {
      this.avatars.get(id)?.dispose();
      this.avatars.delete(id);
      this.voice.removePeer(id);
    });
  }

  private readonly beforeUnload = (): void => this.saveNow();

  private charApplied = false;

  /** Где этот токен стоял в прошлый раз. null — первый вход, отдадим своё. */
  /** Звук чужого действия — объёмно от точки события (у аватара соседа). */
  private playRemoteAct(k: ActKind, x: number, y: number, z: number, _id: string): void {
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

  private applyChar(data: CharMsg): void {
    // На переподключении сервер снова шлёт char — но игрока с места не дёргаем.
    if (this.charApplied) {
      if (!data) return;
      this.saveNow(); // сразу закрепить актуальную позицию за токеном
      return;
    }
    this.charApplied = true;
    if (!data) {
      this.saveNow();
      return;
    }
    this.player.restoreState(data);
    // Оружие, которое было в руках и за спиной, возвращаем на место.
    if (data.held) this.combat.restoreHeld(data.held);
    if (data.stowed?.length) this.combat.restoreStowed(data.stowed);
    // Настройки панели с сервера — главнее локальных.
    if (data.overrides && Object.keys(data.overrides).length) importOverrides(data.overrides);
  }

  /**
   * Сглаживание краёв кадра (FXAA).
   *
   * Трава нарисована по принципу «пиксель есть или нет», поэтому её края
   * идут лесенкой, и обычное сглаживание геометрии тут не помогает.
   * Пост-обработка сглаживает уже готовый кадр. Она цепляется к активной
   * камере, а в VR камера другая — поэтому проверяем каждый кадр, но
   * пересоздаём только при смене камеры или настройки.
   */
  private updateSmoothing(): void {
    const want = LOADOUT.gfx.smooth !== 0;
    const cam = this.scene.activeCamera;
    if (!want || !cam) {
      this.dropSmoothing();
      return;
    }
    if (this.fxaa && this.fxaaCam === cam) return;
    this.dropSmoothing();
    this.fxaa = new FxaaPostProcess("fxaa", 1, cam);
    this.fxaaCam = cam;
  }

  /**
   * Снять пост-обработку с камеры.
   *
   * dispose() без камеры не отцепляет её от списка камеры: остаётся пустой
   * слот, а при следующем включении набирается второй проход. Поэтому
   * камеру передаём явно.
   */
  private dropSmoothing(): void {
    if (!this.fxaa) return;
    if (this.fxaaCam) this.fxaa.dispose(this.fxaaCam);
    else this.fxaa.dispose();
    this.fxaa = null;
    this.fxaaCam = null;
  }

  /** Голос: подхватываем настройки и отдаём положение слушателя. */
  private updateVoice(dt: number): void {
    // «Уши» игрока для объёмных звуков (моб, взмах, плевок) — всегда, не только
    // когда включён пространственный голос.
    this.sfx.setListener(this.player.eyePosition, this.player.eyeForward, UP);
    this.voice.micEnabled = LOADOUT.voice.mic !== 0;
    this.voice.setSpatial(LOADOUT.voice.spatial !== 0);
    this.voice.update(dt);
  }

  /** Сколько зелий в сумке — суммой по всем ячейкам. */
  private potionCount(): number {
    let n = 0;
    for (const s of this.inventory.slots) if (s.item === "potion") n += s.count;
    return n;
  }

  private levelUpFx(level: number): void {
    this.sfx.levelUp();
    this.hud.toast(`Уровень ${level}! +1 очко характеристик`);
  }

  /**
   * Сервер сообщил об ударе: урон уже посчитан с учётом щита и меча,
   * клиент только играет эффекты. HP придёт состоянием.
   */
  private takeMobHit(dmg: number, fromX: number, fromZ: number, by: BlockedBy): void {
    if (by !== 0) this.combat.playBlock(by);
    if (dmg <= 0) return;
    const eye = this.player.eyePosition;
    const dir = new Vector3(eye.x - fromX, 0, eye.z - fromZ);
    if (dir.lengthSquared() > 1e-6) dir.normalize();
    else dir.set(0, 0, 1);
    // Сообщение приходит раньше патча состояния — снимаем HP сразу, чтобы
    // полоса и виньетка не отставали. syncSelf() тут же всё сверит с сервером.
    this.player.setHp(this.player.hp - dmg);
    this.player.hurtFx(dmg, dir);
  }

  private saveNow(): void {
    if (!this.net?.online) return;
    const msg: SaveMsg = this.player.snapshotState();
    this.net.sendSave(msg);
  }

  /**
   * Выйти из мира — на экран входа. Сохраняемся, выходим из VR и
   * перезагружаем страницу: так не остаётся полуразобранного состояния.
   * Сам разрыв соединения сервер ловит в onLeave и тоже пишет сейв.
   */
  async leaveWorld(): Promise<void> {
    this.saveNow();
    try {
      await this.xr?.baseExperience.exitXRAsync();
    } catch {
      /* уже вне XR */
    }
    window.location.reload();
  }

  private detachNet(): void {
    if (this.saveTimer !== null) window.clearInterval(this.saveTimer);
    if (this.saveDebounce !== null) window.clearTimeout(this.saveDebounce);
    window.removeEventListener("beforeunload", this.beforeUnload);
    this.unsubProgress?.();
    this.saveTimer = this.saveDebounce = null;
    this.unsubProgress = null;
    this.netMobs.detach();
    this.loot.detach();
    this.voice.dispose();
    this.voice.send = null;
    this.voice.sendVoice = null;
    this.inventory.onUseRequest = null;
    this.inventory.clear();
    this.combat.nearestWorldWeapon = null;
    this.combat.onTakeWorldWeapon = null;
    this.combat.makeWeaponMesh = null;
    this.combat.onWeaponLanded = null;
    this.combat.onSoundEvent = null;
    this.player.netControlled = false;
    this.player.dead = false;
    this.progression.onSpendRequest = null;
    this.hud.setDead(false);
    if (this.net) {
      this.net.onChar = null;
      this.net.onMobHit = null;
      this.net.onRespawn = null;
      this.net.onLevelUp = null;
      this.net.onPicked = null;
      this.net.onRtc = null;
      this.net.onAct = null;
      this.net.onVoice = null;
      this.net.onConnectionLost = null;
      this.net.onReconnected = null;
      this.net.disconnect(); // остановить попытки переподключения
    }
    for (const a of this.avatars.values()) a.dispose();
    this.avatars.clear();
    this.net = null;
  }

  /** Каждый кадр: отдать свой транспорт, применить чужой. */
  private syncNet(dt: number): void {
    const net = this.net;
    if (!net?.online || !net.room) {
      // Идёт переподключение — держим всё как есть, мир просто замирает.
      if (net?.busyReconnecting) return;
      if (this.avatars.size || this.net) this.detachNet();
      return;
    }

    const m = this.moveMsg;
    m.mode = this.player.inVR ? "vr" : "flat";
    const g = this.combat.guardState();
    m.guard.sx = g.sx;
    m.guard.sz = g.sz;
    m.guard.wx = g.wx;
    m.guard.wz = g.wz;
    writeXf(m.head, this.player.eyePosition, this.player.eyeRotation);
    if (m.mode === "vr") {
      const l = this.hands.nodeFor("left");
      const r = this.hands.nodeFor("right");
      if (l) writeXf(m.handL, l.getAbsolutePosition(), l.absoluteRotationQuaternion);
      if (r) writeXf(m.handR, r.getAbsolutePosition(), r.absoluteRotationQuaternion);
    }
    const now = performance.now();
    net.sendMove(now, m);

    // Что в руках — только когда поменялось: по этому сервер считает урон.
    const hands = this.combat.handsSnapshot();
    const stowed = this.combat.stowedSnapshot();
    const key =
      `${hands.left?.cls ?? ""}:${hands.left?.tier ?? ""}|${hands.right?.cls ?? ""}:${hands.right?.tier ?? ""}` +
      `|${stowed.map((s) => `${s.side}:${s.cls}:${s.tier}`).sort().join(",")}`;
    if (key !== this.handsKey) {
      this.handsKey = key;
      net.sendHands({
        left: hands.left as { cls: WeaponClass; tier: WeaponTier } | null,
        right: hands.right as { cls: WeaponClass; tier: WeaponTier } | null,
        stowed,
      });
    }

    const self = net.self;
    if (self) this.syncSelf(dt, self);

    const players = net.room.state.players;
    for (const [id, avatar] of this.avatars) {
      const p = players.get(id);
      if (p) avatar.push(now, p);
      avatar.update(now);
    }
  }

  private hapticBoth(): void {
    for (const hand of ["left", "right"] as const) {
      const pad = this.xr?.input.controllers.find((c) => c.inputSource.handedness === hand)
        ?.inputSource.gamepad as
        | { hapticActuators?: { pulse?: (v: number, ms: number) => void }[] }
        | undefined;
      pad?.hapticActuators?.[0]?.pulse?.(0.7, 120);
    }
  }
}

/** Мировая вертикаль — ориентация слушателя для звука по месту. */
const UP = new Vector3(0, 1, 0);

function zeros7(): Xf7 {
  return [0, 0, 0, 0, 0, 0, 1];
}

function writeXf(dst: Xf7, pos: Vector3, q: Quaternion): void {
  dst[0] = pos.x;
  dst[1] = pos.y;
  dst[2] = pos.z;
  dst[3] = q.x;
  dst[4] = q.y;
  dst[5] = q.z;
  dst[6] = q.w;
}
