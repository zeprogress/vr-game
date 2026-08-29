import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import "@babylonjs/core/Cameras/Inputs/freeCameraKeyboardMoveInput";
import "@babylonjs/core/Cameras/Inputs/freeCameraMouseInput";

/**
 * Этап 1: управление от первого лица на десктопе.
 * WASD + мышь (pointer lock), коллизии и гравитация.
 *
 * Этап 2 вынесет ввод в отдельный InputSource, чтобы тем же кодом
 * двигать персонажа с тач-экрана и VR-контроллеров.
 */
export class PlayerController {
  readonly camera: UniversalCamera;

  constructor(scene: Scene, private readonly canvas: HTMLCanvasElement) {
    this.camera = new UniversalCamera("player", new Vector3(0, 1.7, -20), scene);
    this.camera.setTarget(new Vector3(0, 1.7, 0));
    this.camera.attachControl(canvas, true);

    // Рост игрока / «капсула» для коллизий.
    this.camera.ellipsoid = new Vector3(0.5, 0.9, 0.5);
    this.camera.ellipsoidOffset = new Vector3(0, 0.9, 0);
    this.camera.checkCollisions = true;
    this.camera.applyGravity = true;

    // WASD вместо стрелок.
    this.camera.keysUp = [87]; // W
    this.camera.keysDown = [83]; // S
    this.camera.keysLeft = [65]; // A
    this.camera.keysRight = [68]; // D

    this.camera.speed = 0.35;
    this.camera.angularSensibility = 900;
    this.camera.inertia = 0.4;
    this.camera.minZ = 0.1;
  }

  requestPointerLock(): void {
    this.canvas.requestPointerLock();
  }
}
