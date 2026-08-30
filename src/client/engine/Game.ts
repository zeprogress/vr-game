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
import { WristPanel } from "../ui/WristPanel";
import { LoadoutPanel } from "../ui/LoadoutPanel";
import { printLoadout } from "../config/loadout";
import { HUD, VIGNETTE } from "#shared/constants";
import { Sfx } from "../audio/Sfx";
import { Hands } from "../player/Hands";
import { Progression } from "../player/Progression";
import { Inventory } from "../player/Inventory";
import { LootDrops } from "../world/LootDrops";
import { PlayerController } from "../player/PlayerController";
import { DesktopInput } from "../input/DesktopInput";
import { TouchInput } from "../input/TouchInput";
import { XRInput } from "../input/XRInput";
import type { InputSource } from "../input/InputSource";
import type { NetClient } from "../net/NetClient";
import { RemoteAvatar } from "../entities/RemoteAvatar";
import type { CharMsg, MoveMsg, SaveMsg, Xf7 } from "#shared/net/messages";
import type { PlayerState } from "#shared/net/schema";
import { noGuard, type BlockedBy } from "#shared/combat";
import { isSwordTier, ITEMS, SWORDS, type SwordTier } from "#shared/items";
import { RESPAWN } from "#shared/constants";

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
  /** Общий список целей (мобы + куклы) — наполняет NetMobs, читает CombatSystem. */
  private readonly targets: Hittable[] = [];
  private readonly sfx = new Sfx();
  private readonly hud = new Hud();

  /** Узел, который следует за головой, но не наклоняется: HUD параллелен горизонту. */
  private hudAnchor: TransformNode | null = null;
  private playerBar3D: HealthBar3D | null = null;
  private vrVignette: VrVignette | null = null;
  private wristPanel: WristPanel | null = null;
  loadoutPanel: LoadoutPanel | null = null;
  private xrInput: XRInput | null = null;
  xr: WebXRDefaultExperience | null = null;

  // Сеть: чужие игроки.
  private net: NetClient | null = null;
  private readonly avatars = new Map<string, RemoteAvatar>();
  private readonly aim = new Vector3(0, 0, 1);
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

    this.player = new PlayerController(this.scene, this.progression);
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
      this.net?.sendHitMob({ id, target, weapon, dx, dz });
    this.netMobs = new NetMobs(this.scene, this.sfx, this.targets, report);
    this.loot = new LootDrops(this.scene);
    this.hands = new Hands(this.scene);
    this.hud.bindProgression(this.progression);
    this.hud.bindInventory(this.inventory);

    // Офлайн уровень считает Progression, онлайн — сервер шлёт MSG.levelUp.
    this.progression.onLevelUp = (lvl) => {
      this.levelUpFx(lvl);
      // Новый уровень поднимает потолок HP — доливаем разницу (офлайн).
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 10);
      this.showHp(this.player.hp);
    };

    this.player.hooks.step = () => this.sfx.footstep();
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
    this.sfx.startMusic("/music/town-dion.mp3", 0.045); // тихий фон
    const wake = () => this.sfx.resume();
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);

    this.scene.onBeforeRenderObservable.add(() => {
      const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.1);
      this.player.update(dt);
      this.player.eyeForward.normalizeToRef(this.aim);
      this.netMobs.update(dt, this.player.position, this.aim);
      this.loot.update(dt);
      this.combat.update(dt);
      this.hands.update(dt);
      this.syncNet(dt);
      this.updateVrUi(dt);
      this.updateLowHealthVignette(dt);
      this.vrVignette?.tick(dt);
      this.updateHpBarFade();
    });

    window.addEventListener("resize", () => this.engine.resize());
  }

  start(): void {
    this.engine.runRenderLoop(() => this.scene.render());
  }

  /** Инициализация WebXR. Кнопка «Enter VR» появляется сама, если VR доступен. */
  async initXR(): Promise<void> {
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

    const base = this.xr.baseExperience;
    base.onStateChangedObservable.add((state) => {
      if (state === WebXRState.IN_XR) {
        this.sfx.resume();
        this.player.enterXR(base.camera);
        this.xrInput = new XRInput(this.xr!);
        this.player.setInput(this.xrInput);
        this.hands.attach(this.xr!);
        this.buildVrUi();
      } else if (state === WebXRState.NOT_IN_XR) {
        this.combat.dropStowed();
        this.player.exitXR();
        this.xrInput = null;
        this.player.setInput(this.defaultInput());
        this.scene.activeCamera = this.player.camera;
        this.hands.detach(this.xr!);
        this.tearDownVrUi();
      }
    });
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
    this.playerBar3D = new HealthBar3D(
      this.scene,
      this.hudAnchor,
      new Vector3(-0.24, 0.46, 0.92), // повыше — не мешает обзору
      0.675, // в 1.5 раза длиннее
      false,
      0.05, // вдвое тоньше
    );
    this.playerBar3D.set(this.player.hp / this.player.maxHp);

    this.vrVignette = new VrVignette(this.scene);

    // Панели цепляются к кистям (или к контроллеру, если кисть ещё не создана).
    this.wristPanel = new WristPanel(
      this.scene,
      this.handNode("left", cam),
      this.progression,
      this.inventory,
    );
    this.loadoutPanel = new LoadoutPanel(this.scene, this.handNode("right", cam));
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
  }

  private updateVrUi(dt: number): void {
    const cam = this.xr?.baseExperience.camera;
    if (this.hudAnchor && cam) {
      // Позиция головы + только рыскание: панель не заваливается вместе с обзором.
      this.hudAnchor.position.copyFrom(cam.globalPosition);
      const f = cam.getDirection(new Vector3(0, 0, 1));
      this.hudAnchor.rotation.set(0, Math.atan2(f.x, f.z), 0);
    }

    const inp = this.player.lastInput;
    if (inp.panelToggle) this.wristPanel?.toggle();
    this.wristPanel?.update(inp.uiNext, inp.uiConfirm);

    // Панель настройки экипировки: открыть — только 5 нажатий B за 3 с
    // (чтобы случайно не всплывала). Открытую закрывает одиночный B.
    this.tuneClock += dt;
    if (inp.tuneToggle) {
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

    this.inventory.applyRemote(self.bag);
    if (isSwordTier(self.swordTier)) this.setSwordTier(self.swordTier);

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
      this.hud.toast(`Подобрано: ${ITEMS[item].name}${count > 1 ? ` ×${count}` : ""}`);
    };

    // Онлайн здоровьем и прокачкой владеет сервер.
    this.player.netControlled = true;
    this.progression.onSpendRequest = (stat) => net.sendSpend(stat);
    this.inventory.onUseRequest = (slot) => net.sendUseItem(slot);
    this.combat.nearestWorldSword = () => this.loot.nearestSword(this.player.position);
    this.combat.onTakeWorldSword = (id) => net.sendTakeSword(id);
    if (net.room) {
      this.netMobs.attach(net.room);
      this.loot.attach(net.room);
    }

    // Автосейв: раз в 30 с, при изменении прогресса (с задержкой) и перед выходом.
    this.saveTimer = window.setInterval(() => this.saveNow(), 30_000);
    this.unsubProgress = this.progression.onChange(() => {
      if (this.saveDebounce) window.clearTimeout(this.saveDebounce);
      this.saveDebounce = window.setTimeout(() => this.saveNow(), 1500);
    });
    window.addEventListener("beforeunload", this.beforeUnload);

    const players = net.room?.state.players;
    if (!players) return;

    const add = (id: string): void => {
      if (id === net.sessionId || this.avatars.has(id)) return;
      const p = players.get(id);
      if (p) this.avatars.set(id, new RemoteAvatar(this.scene, id, p.nick, p.mode));
    };

    players.onAdd((_p, id) => add(id), true); // true — сработает и для уже вошедших
    players.onRemove((_p, id) => {
      this.avatars.get(id)?.dispose();
      this.avatars.delete(id);
    });
  }

  private readonly beforeUnload = (): void => this.saveNow();

  /** Где этот токен стоял в прошлый раз. null — первый вход, отдадим своё. */
  private applyChar(data: CharMsg): void {
    if (!data) {
      this.saveNow();
      return;
    }
    this.player.restoreState(data);
  }

  private swordTier: SwordTier = "iron";

  /** Класс меча сменился — перекрашиваем клинок и сообщаем игроку. */
  private setSwordTier(tier: SwordTier): void {
    if (tier === this.swordTier) return;
    const up = tier !== "iron";
    this.swordTier = tier;
    this.combat.setSwordTier(tier);
    if (up) {
      this.sfx.levelUp();
      this.hud.toast(`${SWORDS[tier].name}: урон ×${SWORDS[tier].mult}`);
    }
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

  private detachNet(): void {
    if (this.saveTimer !== null) window.clearInterval(this.saveTimer);
    if (this.saveDebounce !== null) window.clearTimeout(this.saveDebounce);
    window.removeEventListener("beforeunload", this.beforeUnload);
    this.unsubProgress?.();
    this.saveTimer = this.saveDebounce = null;
    this.unsubProgress = null;
    this.netMobs.detach();
    this.loot.detach();
    this.inventory.onUseRequest = null;
    this.inventory.clear();
    this.combat.nearestWorldSword = null;
    this.combat.onTakeWorldSword = null;
    this.setSwordTier("iron");
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
    }
    for (const a of this.avatars.values()) a.dispose();
    this.avatars.clear();
    this.net = null;
  }

  /** Каждый кадр: отдать свой транспорт, применить чужой. */
  private syncNet(dt: number): void {
    const net = this.net;
    if (!net?.online || !net.room) {
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
