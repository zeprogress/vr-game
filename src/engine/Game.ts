import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import "@babylonjs/core/Collisions/collisionCoordinator";

import { buildZone } from "../world/Zone";
import { PlayerController } from "../player/PlayerController";

/**
 * Каркас движка: один Engine, одна Scene, один рендер-луп.
 * На этапе 1 здесь только одиночная сцена без сети.
 */
export class Game {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly player: PlayerController;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { stencil: true, antialias: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.5, 0.7, 0.9, 1);

    // Гравитация и коллизии на уровне сцены.
    this.scene.gravity = new Vector3(0, -0.6, 0);
    this.scene.collisionsEnabled = true;

    buildZone(this.scene);
    this.player = new PlayerController(this.scene, canvas);

    window.addEventListener("resize", () => this.engine.resize());
  }

  start(): void {
    this.engine.runRenderLoop(() => this.scene.render());
  }
}
