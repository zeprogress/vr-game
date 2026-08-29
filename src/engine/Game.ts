import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import "@babylonjs/core/Collisions/collisionCoordinator";

import { WebXRDefaultExperience } from "@babylonjs/core/XR/webXRDefaultExperience";
import { WebXRState } from "@babylonjs/core/XR/webXRTypes";
import "@babylonjs/core/XR/features/WebXRControllerPointerSelection";

import type { Mesh } from "@babylonjs/core/Meshes/mesh";

import { buildZone } from "../world/Zone";
import { CombatSystem } from "../combat/CombatSystem";
import { MobSystem } from "../combat/MobSystem";
import { TuningPanel } from "../debug/TuningPanel";
import { Hud } from "../ui/Hud";
import { Sfx } from "../audio/Sfx";
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
  readonly isTouch: boolean;
  private readonly ground: Mesh;
  private readonly combat: CombatSystem;
  private readonly mobsAI: MobSystem;
  private readonly dummies: { update(dt: number): void }[];
  private readonly sfx = new Sfx();
  private readonly hud = new Hud();
  xr: WebXRDefaultExperience | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { stencil: true, antialias: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.5, 0.7, 0.9, 1);
    this.scene.collisionsEnabled = true;

    const zone = buildZone(this.scene);
    this.ground = zone.ground;

    this.player = new PlayerController(this.scene);
    this.scene.activeCamera = this.player.camera;
    this.player.placeOnGround();

    this.dummies = zone.dummies;
    this.combat = new CombatSystem(
      this.scene,
      this.player,
      () => this.xr,
      [...zone.dummies, ...zone.mobs],
      this.sfx,
      zone.swordHome,
      zone.bowHome,
    );
    this.mobsAI = new MobSystem(zone.mobs, this.player, this.sfx, zone.groundHeight);
    new TuningPanel(this.combat);

    this.player.hooks.step = () => this.sfx.footstep();
    this.player.hooks.jump = () => this.sfx.jump();
    this.player.hooks.land = (impact) => this.sfx.land(Math.min(1, impact / 9));
    this.player.hooks.hurt = (hp, dmg) => {
      this.sfx.playerHurt();
      this.hud.setHp(hp);
      this.hud.flashDamage(dmg);
      this.hapticBoth();
    };
    this.player.hooks.heal = (hp) => this.hud.setHp(hp);
    this.player.hooks.respawn = () => {
      this.hud.setHp(this.player.hp);
      this.hud.flashDamage(30);
    };
    this.hud.setHp(this.player.hp);

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
        this.player.setInput(new XRInput(this.xr!));
      } else if (state === WebXRState.NOT_IN_XR) {
        this.player.exitXR();
        this.player.setInput(this.defaultInput());
        this.scene.activeCamera = this.player.camera;
      }
    });
  }

  requestPointerLock(): void {
    if (!this.isTouch) this.canvas.requestPointerLock();
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
