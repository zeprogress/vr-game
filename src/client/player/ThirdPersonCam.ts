import type { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Ray } from "@babylonjs/core/Culling/ray";

import { TP_CAM_TUNE } from "./tpCamTune";

/**
 * Орбитальная камера «от третьего лица» для смартфона.
 *
 * Держит СВОЙ азимут/тангаж (обзор), персонаж живёт отдельно — его yaw
 * доворачивает PlayerController в сторону хода. Камера сидит на «удочке»
 * позади точки прицела (грудь персонажа) и подъезжает ближе, если между ней
 * и персонажем стена.
 *
 * `yaw` тут — куда СМОТРИТ камера (не персонаж). forward на земле =
 * (sin yaw, cos yaw): та же система осей, что у PlayerController.
 *
 * Числа (длина удочки, высота, наклоны, скорости) живут в tpCamTune.ts и
 * правятся вживую панелью `?tpcam=1`.
 */
const MIN_DIST = 0.7; // м, ближе не подъезжаем даже вплотную к стене
const COLLIDE_PAD = 0.3; // м, зазор от стены

export class ThirdPersonCam {
  readonly camera: FreeCamera;
  /** Азимут взгляда камеры. Старт — за спиной персонажа (тот смотрит в +Z). */
  yaw = 0;
  private pitch = TP_CAM_TUNE.pitchStart;
  private readonly pivot = new Vector3();
  private readonly pos = new Vector3();
  private readonly _ray = new Ray(Vector3.Zero(), Vector3.Up(), 1);

  constructor(scene: Scene) {
    this.camera = new FreeCamera("tpCam", new Vector3(0, TP_CAM_TUNE.pivotUp, -TP_CAM_TUNE.dist), scene);
    this.camera.minZ = 0.1;
    this.camera.fov = 0.95;
  }

  /** Правое перетаскивание по экрану: крутим обзор вокруг персонажа. */
  applyLook(dYaw: number, dPitch: number): void {
    const s = TP_CAM_TUNE.lookSens;
    this.yaw += dYaw * s;
    this.pitch = clamp(this.pitch + dPitch * s, TP_CAM_TUNE.pitchMin, TP_CAM_TUNE.pitchMax);
  }

  /** Плавно довести обзор за спину персонажа (когда игрок не крутит камеру). */
  followBehind(characterYaw: number, k: number): void {
    this.yaw = lerpAngle(this.yaw, characterYaw, k);
  }

  /** feet — точка ног персонажа в мире. Зовётся каждый кадр после движения. */
  update(feet: Vector3, solid: (m: AbstractMesh) => boolean, scene: Scene): void {
    const t = TP_CAM_TUNE;
    this.pivot.set(feet.x, feet.y + t.pivotUp, feet.z);

    const cp = Math.cos(this.pitch);
    const dx = Math.sin(this.yaw) * cp;
    const dy = Math.sin(this.pitch);
    const dz = Math.cos(this.yaw) * cp;

    // 1. Окклюзия: подъезжаем ближе, если между камерой и персонажем стена.
    // Горизонтальные поверхности (земля/террейн) не считаем препятствием —
    // иначе на ровном поле камера постоянно «утыкается» в склон луча.
    let dist = t.dist;
    this._ray.origin.copyFrom(this.pivot);
    this._ray.direction.set(-dx, -dy, -dz);
    this._ray.length = t.dist + COLLIDE_PAD;
    const hit = scene.pickWithRay(this._ray, solid);
    if (hit?.hit && hit.pickedPoint) {
      const n = hit.getNormal(true);
      if (!n || Math.abs(n.y) < 0.6) {
        dist = clamp(hit.distance - COLLIDE_PAD, MIN_DIST, t.dist);
      }
    }

    this.pos.set(
      this.pivot.x - dx * dist,
      this.pivot.y - dy * dist,
      this.pivot.z - dz * dist,
    );

    // 2. Пол: не пускаем камеру под землю (и не даём «клюнуть» в неё).
    this._ray.origin.set(this.pos.x, this.pos.y + 3, this.pos.z);
    this._ray.direction.set(0, -1, 0);
    this._ray.length = 6;
    const floor = scene.pickWithRay(this._ray, solid);
    if (floor?.pickedPoint && this.pos.y < floor.pickedPoint.y + t.floorClear) {
      this.pos.y = floor.pickedPoint.y + t.floorClear;
    }

    this.camera.position.copyFrom(this.pos);
    this.camera.setTarget(this.pivot);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Кратчайший поворот от a к b (углы в радианах). */
function lerpAngle(a: number, b: number, t: number): number {
  const d = ((b - a) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
  return a + d * t;
}
