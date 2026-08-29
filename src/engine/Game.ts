import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import "@babylonjs/core/Collisions/collisionCoordinator";

import { WebXRDefaultExperience } from "@babylonjs/core/XR/webXRDefaultExperience";
import { WebXRState } from "@babylonjs/core/XR/webXRTypes";
import "@babylonjs/core/XR/features/WebXRControllerPointerSelection";

import type { Mesh } from "@babylonjs/core/Meshes/mesh";

import { buildZone } from "../world/Zone";
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
  xr: WebXRDefaultExperience | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { stencil: true, antialias: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.5, 0.7, 0.9, 1);
    this.scene.collisionsEnabled = true;

    this.ground = buildZone(this.scene);

    this.player = new PlayerController(this.scene);
    this.scene.activeCamera = this.player.camera;

    this.isTouch =
      window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
    this.player.setInput(this.defaultInput());

    this.scene.onBeforeRenderObservable.add(() => {
      const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.1);
      this.player.update(dt);
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
}
