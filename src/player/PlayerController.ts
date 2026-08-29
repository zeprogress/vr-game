import type { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { WebXRCamera } from "@babylonjs/core/XR/webXRCamera";
import { Ray } from "@babylonjs/core/Culling/ray";
import "@babylonjs/core/Culling/ray";
import "@babylonjs/core/Meshes/Builders/boxBuilder";

import { PLAYER } from "../shared/constants";
import { emptyInput, type InputSource, type InputState } from "../input/InputSource";

const GROUND_SNAP = 0.2; // м, зазор до земли, при котором считаем «стоим»
const STEP_HEIGHT = 0.35; // м, высоту ниже этого можно перешагнуть
const FORWARD = new Vector3(0, 0, 1); // локальная ось «вперёд»

/**
 * Движение персонажа от первого лица. Управляется любым InputSource
 * (десктоп / тач / VR) — сам источник ввода здесь не важен.
 *
 * Коллизии — только лучами (raycast): вниз для земли, по осям X/Z для стен.
 * Просто, предсказуемо и достаточно для зоны из прямоугольных препятствий.
 */
export class PlayerController {
  readonly camera: FreeCamera;
  private readonly body: Mesh;
  private readonly scene: Scene;
  private input: InputSource | null = null;

  private yaw = 0;
  private pitch = 0;
  private verticalVelocity = 0;
  private grounded = false;

  /** Ввод, снятый в последнем update() — читают другие системы (бой). */
  lastInput: InputState = emptyInput();

  /** Хуки для звука. Назначает Game. */
  readonly hooks: { step?: () => void; jump?: () => void; land?: (impact: number) => void } = {};
  private stepDist = 0;

  /** В VR камера гарнитуры парентится к этому ригу; риг мы двигаем/крутим сами. */
  private xrRig: TransformNode | null = null;
  private xrCamera: WebXRCamera | null = null;
  private readonly fwd = new Vector3();
  /** Предыдущая ЛОКАЛЬНАЯ позиция головы в риге — для учёта ходьбы по комнате. */
  private xrHeadLX = 0;
  private xrHeadLZ = 0;
  private xrHeadTracked = false;

  constructor(scene: Scene) {
    this.scene = scene;

    this.body = MeshBuilder.CreateBox("playerBody", { size: PLAYER.radius * 2 }, scene);
    this.body.isVisible = false;
    this.body.isPickable = false;
    this.body.position.set(0, PLAYER.eyeHeight, -20);

    this.camera = new FreeCamera("player", this.body.position.clone(), scene);
    this.camera.minZ = 0.1;
  }

  setInput(source: InputSource): void {
    this.input?.dispose();
    this.input = source;
  }

  get position(): Vector3 {
    return this.body.position;
  }

  get inVR(): boolean {
    return this.xrCamera !== null;
  }

  /** Поставить тело на поверхность в текущей точке (x, z). */
  placeOnGround(): void {
    const p = this.body.position;
    const ray = new Ray(new Vector3(p.x, 500, p.z), Vector3.Down(), 1000);
    const hit = this.scene.pickWithRay(ray, this.isSolid);
    if (hit?.pickedPoint) p.y = hit.pickedPoint.y + PLAYER.eyeHeight;
    this.verticalVelocity = 0;
  }

  /** Вход в VR: камеру гарнитуры вешаем на управляемый нами риг. */
  enterXR(xrCamera: WebXRCamera): void {
    if (!this.xrRig) this.xrRig = new TransformNode("xrRig", this.scene);
    xrCamera.parent = this.xrRig;
    this.xrCamera = xrCamera;
    this.xrHeadTracked = false;
  }

  exitXR(): void {
    if (this.xrCamera) this.xrCamera.parent = null;
    this.xrCamera = null;
  }

  /** Вызывается каждый кадр из рендер-лупа. dt — секунды. */
  update(dt: number): void {
    const inp = this.input?.sample() ?? emptyInput();
    this.lastInput = inp;
    const pos = this.body.position;
    const vr = this.xrCamera !== null;

    // --- Поворот ---
    // yaw: мышь/тач в плоском режиме, snap-turn в VR. pitch — только плоский режим.
    this.yaw += inp.lookYaw;
    this.pitch = vr ? 0 : clamp(this.pitch + inp.lookPitch, -PLAYER.pitchClamp, PLAYER.pitchClamp);

    // --- VR: физическая ходьба по комнате переносится в тело ---
    // Берём смещение головы в ЛОКАЛЬНЫХ осях рига (не зависит от snap-turn)
    // и поворачиваем его текущим yaw. Так поворот стиком не толкает тело вбок.
    if (vr && this.xrCamera) {
      const h = this.xrCamera.position;
      if (this.xrHeadTracked) {
        const dlx = h.x - this.xrHeadLX;
        const dlz = h.z - this.xrHeadLZ;
        const c = Math.cos(this.yaw);
        const s = Math.sin(this.yaw);
        this.moveAxis(dlx * c + dlz * s, 0);
        this.moveAxis(0, -dlx * s + dlz * c);
      }
      this.xrHeadLX = h.x;
      this.xrHeadLZ = h.z;
      this.xrHeadTracked = true;
    }

    // --- База движения: в VR — куда смотрит голова, иначе — yaw ---
    let fx: number;
    let fz: number;
    if (vr && this.xrCamera) {
      this.xrCamera.getDirectionToRef(FORWARD, this.fwd);
      const l = Math.hypot(this.fwd.x, this.fwd.z) || 1;
      fx = this.fwd.x / l;
      fz = this.fwd.z / l;
    } else {
      fx = Math.sin(this.yaw);
      fz = Math.cos(this.yaw);
    }

    // --- Горизонталь по осям (естественное скольжение вдоль стен) ---
    let mx = fz * inp.moveX + fx * inp.moveY;
    let mz = -fx * inp.moveX + fz * inp.moveY;
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    const speed = PLAYER.runSpeed * dt;
    const bx = pos.x;
    const bz = pos.z;
    this.moveAxis(mx * speed, 0);
    this.moveAxis(0, mz * speed);

    // --- Шаги (звук) ---
    if (this.grounded) {
      this.stepDist += Math.hypot(pos.x - bx, pos.z - bz);
      if (this.stepDist >= PLAYER.strideLength) {
        this.stepDist = 0;
        this.hooks.step?.();
      }
    } else {
      this.stepDist = PLAYER.strideLength * 0.6; // приземлился — шаг почти сразу
    }

    // --- Земля под ногами ---
    const groundY = this.rayDown();

    if (inp.jump && this.grounded) {
      this.verticalVelocity = PLAYER.jumpSpeed;
      this.grounded = false;
      this.hooks.jump?.();
    }

    if (this.grounded && this.verticalVelocity <= 0) {
      if (groundY !== null) pos.y = groundY + PLAYER.eyeHeight;
      this.verticalVelocity = 0;
    } else {
      this.verticalVelocity -= PLAYER.gravity * dt;
      pos.y += this.verticalVelocity * dt;
      if (groundY !== null && pos.y < groundY + PLAYER.eyeHeight) {
        pos.y = groundY + PLAYER.eyeHeight;
        if (this.verticalVelocity < -3) this.hooks.land?.(-this.verticalVelocity);
        this.verticalVelocity = 0;
      }
    }

    const gapNow = groundY === null ? Infinity : pos.y - PLAYER.eyeHeight - groundY;
    if (this.verticalVelocity <= 0) this.grounded = gapNow <= GROUND_SNAP;

    // --- Камера следует за телом ---
    if (vr && this.xrRig && this.xrCamera) {
      // Голова должна оказаться ровно над телом. Компенсируем комнатное
      // смещение головы: сдвигаем риг на -(смещение головы в мире).
      const h = this.xrCamera.position;
      const c = Math.cos(this.yaw);
      const s = Math.sin(this.yaw);
      const hwx = h.x * c + h.z * s;
      const hwz = -h.x * s + h.z * c;
      this.xrRig.position.set(pos.x - hwx, pos.y - PLAYER.eyeHeight, pos.z - hwz);
      this.xrRig.rotation.set(0, this.yaw, 0);
      this.xrRig.computeWorldMatrix(true);
    } else {
      this.camera.position.copyFrom(pos);
      this.camera.rotation.set(this.pitch, this.yaw, 0);
    }

    // TODO(этап 7): primaryAction / interact -> отправка на сервер.
    void inp.primaryAction;
    void inp.interact;
  }

  /** Движение по одной горизонтальной оси с упором в стены (3 луча по высоте). */
  private moveAxis(dx: number, dz: number): void {
    const dist = Math.abs(dx) + Math.abs(dz);
    if (dist < 1e-5) return;
    const pos = this.body.position;
    const dir = new Vector3(Math.sign(dx), 0, Math.sign(dz));
    const feetY = pos.y - PLAYER.eyeHeight;

    let allowed = dist;
    for (const h of [STEP_HEIGHT + 0.05, PLAYER.eyeHeight * 0.6, PLAYER.eyeHeight - 0.15]) {
      const ray = new Ray(new Vector3(pos.x, feetY + h, pos.z), dir, dist + PLAYER.radius);
      const hit = this.scene.pickWithRay(ray, this.isSolid);
      if (hit?.hit && hit.distance < Infinity) {
        allowed = Math.min(allowed, Math.max(0, hit.distance - PLAYER.radius));
      }
    }
    pos.x += dir.x * allowed;
    pos.z += dir.z * allowed;
  }

  /** Y поверхности под телом или null. */
  private rayDown(): number | null {
    const pos = this.body.position;
    const ray = new Ray(pos.clone(), Vector3.Down(), PLAYER.eyeHeight + 0.6);
    const hit = this.scene.pickWithRay(ray, this.isSolid);
    return hit?.pickedPoint?.y ?? null;
  }

  private isSolid = (m: AbstractMesh): boolean =>
    m.isPickable && m.checkCollisions && m !== this.body;

  dispose(): void {
    this.input?.dispose();
    this.body.dispose();
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
