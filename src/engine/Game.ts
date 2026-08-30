import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import "@babylonjs/core/Collisions/collisionCoordinator";

import { WebXRDefaultExperience } from "@babylonjs/core/XR/webXRDefaultExperience";
import { WebXRState } from "@babylonjs/core/XR/webXRTypes";

import type { Mesh } from "@babylonjs/core/Meshes/mesh";

import { buildZone } from "../world/Zone";
import { CombatSystem } from "../combat/CombatSystem";
import { MobSystem } from "../combat/MobSystem";
import { Hud } from "../ui/Hud";
import { HealthBar3D } from "../ui/HealthBar3D";
import { VrVignette } from "../ui/VrVignette";
import { WristPanel } from "../ui/WristPanel";
import { HUD } from "../shared/constants";
import { Sfx } from "../audio/Sfx";
import { Hands } from "../player/Hands";
import { Progression } from "../player/Progression";
import { PlayerController } from "../player/PlayerController";
import { DesktopInput } from "../input/DesktopInput";
import { TouchInput } from "../input/TouchInput";
import { XRInput } from "../input/XRInput";
import type { InputSource } from "../input/InputSource";

/**
 * Каркас движка: один Engine, одна Scene, один рендер-луп.
 * Выбирает источник ввода по устройству и подключает WebXR.
 */
export class Game {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly player: PlayerController;
  readonly progression = new Progression();
  readonly hands: Hands;
  readonly isTouch: boolean;
  private readonly ground: Mesh;
  private readonly combat: CombatSystem;
  private readonly mobsAI: MobSystem;
  private readonly dummies: { update(dt: number): void }[];
  private readonly sfx = new Sfx();
  private readonly hud = new Hud();

  /** Узел, который следует за головой, но не наклоняется: HUD параллелен горизонту. */
  private hudAnchor: TransformNode | null = null;
  private playerBar3D: HealthBar3D | null = null;
  private vrVignette: VrVignette | null = null;
  private wristPanel: WristPanel | null = null;
  private xrInput: XRInput | null = null;
  xr: WebXRDefaultExperience | null = null;

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

    this.dummies = zone.dummies;
    this.combat = new CombatSystem(
      this.scene,
      this.player,
      () => this.xr,
      [...zone.dummies, ...zone.mobs],
      this.sfx,
      this.progression,
      zone.groundHeight,
      zone.swordHome,
      zone.bowHome,
      zone.shieldHome,
    );
    this.mobsAI = new MobSystem(
      zone.mobs,
      this.player,
      this.sfx,
      this.progression,
      () => this.combat,
      zone.groundHeight,
    );
    this.hands = new Hands(this.scene);
    this.hud.bindProgression(this.progression);

    this.progression.onLevelUp = (lvl) => {
      this.sfx.levelUp();
      this.hud.toast(`Уровень ${lvl}! +1 очко характеристик`);
      // Новый уровень силы поднимает потолок HP — доливаем разницу.
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
    this.sfx.startMusic("/music/town-dion.mp3", 0.1);
    const wake = () => this.sfx.resume();
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);

    this.scene.onBeforeRenderObservable.add(() => {
      const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.1);
      this.player.update(dt);
      this.mobsAI.update(dt);
      for (const d of this.dummies) d.update(dt);
      this.combat.update(dt);
      this.hands.update(dt);
      this.updateVrUi(dt);
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

  // ---- VR-интерфейс ----

  private buildVrUi(): void {
    const cam = this.xr!.baseExperience.camera;

    // Полоса здоровья висит в мире, но следует за головой без наклона —
    // остаётся параллельной горизонту.
    this.hudAnchor = new TransformNode("hudAnchor", this.scene);
    this.playerBar3D = new HealthBar3D(
      this.scene,
      this.hudAnchor,
      new Vector3(-0.16, 0.34, 0.9),
      0.45,
      false,
    );
    this.playerBar3D.set(this.player.hp / this.player.maxHp);

    this.vrVignette = new VrVignette(this.scene);

    // Панель персонажа — на левой кисти (или на контроллере, если кисти нет).
    const leftHand =
      this.hands.nodeFor("left") ??
      this.xr!.input.controllers.find((c) => c.inputSource.handedness === "left")?.grip ??
      cam;
    this.wristPanel = new WristPanel(this.scene, leftHand, this.progression);
  }

  private tearDownVrUi(): void {
    this.wristPanel?.dispose();
    this.wristPanel = null;
    this.playerBar3D?.dispose();
    this.playerBar3D = null;
    this.hudAnchor?.dispose();
    this.hudAnchor = null;
    this.vrVignette?.dispose();
    this.vrVignette = null;
  }

  private updateVrUi(dt: number): void {
    void dt;
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

    // Панель цепляется к левой кисти, как только контроллер появился.
    const leftHand = this.hands.nodeFor("left");
    if (leftHand && this.wristPanel && this.wristPanel.anchor !== leftHand) {
      this.wristPanel.reparent(leftHand);
    }
  }

  private showHp(hp: number): void {
    this.hud.setHp(hp, this.player.maxHp);
    this.playerBar3D?.set(hp / this.player.maxHp);
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
