import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import "@babylonjs/core/Collisions/collisionCoordinator";

import { buildZone } from "../world/Zone";
import { PlayerController } from "../player/PlayerController";
import { DesktopInput } from "../input/DesktopInput";
import { TouchInput } from "../input/TouchInput";

/**
 * Каркас движка: один Engine, одна Scene, один рендер-луп.
 * На этапе 2 здесь также выбирается источник ввода по типу устройства.
 */
export class Game {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly player: PlayerController;
  readonly isTouch: boolean;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { stencil: true, antialias: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.5, 0.7, 0.9, 1);
    this.scene.collisionsEnabled = true;

    buildZone(this.scene);

    this.player = new PlayerController(this.scene);
    this.scene.activeCamera = this.player.camera;

    this.isTouch =
      window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
    this.player.setInput(this.isTouch ? new TouchInput() : new DesktopInput(canvas));

    this.scene.onBeforeRenderObservable.add(() => {
      const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.1);
      this.player.update(dt);
    });

    window.addEventListener("resize", () => this.engine.resize());
  }

  start(): void {
    this.engine.runRenderLoop(() => this.scene.render());
  }

  requestPointerLock(): void {
    if (!this.isTouch) this.canvas.requestPointerLock();
  }
}
