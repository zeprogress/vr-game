import type { Scene } from "@babylonjs/core/scene";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";

/** Насколько вперёд тянутся лучи направления, м. */
const RAY_LEN = 8;
/** Полуширина прямоугольника на конце лучей, м — узкий конус, не во весь экран. */
const RAY_HALF = 1.4;

/**
 * Модель камеры стрима в мире (Ф10) — без подписи: корпус + «объектив»,
 * повёрнута туда, куда реально смотрит спектатор, плюс необязательные лучи
 * направления (гизмо-фрустум). Билборда нет нарочно: если бы камера всегда
 * разворачивалась к зрителю, направление взгляда было бы не прочитать —
 * а это и есть весь смысл метки.
 */
export class SpecCamMarker {
  private readonly root: TransformNode;
  private readonly rays: LinesMesh;

  constructor(scene: Scene) {
    this.root = new TransformNode("specCamMarker", scene);
    this.root.rotationQuaternion = Quaternion.Identity();
    this.root.setEnabled(false);

    const mat = new StandardMaterial("specCamMat", scene);
    mat.diffuseColor = new Color3(0.12, 0.13, 0.16);
    mat.emissiveColor = new Color3(0.15, 0.55, 0.95);
    mat.specularColor = new Color3(0, 0, 0);

    const body = MeshBuilder.CreateBox("specCamBody", { width: 0.24, height: 0.16, depth: 0.16 }, scene);
    body.material = mat;
    body.isPickable = false;
    body.parent = this.root;

    // Объектив — цилиндр, ось вдоль +Z (перёд у нас туда, см. остальной код).
    const lens = MeshBuilder.CreateCylinder(
      "specCamLens",
      { diameter: 0.11, height: 0.14, tessellation: 16 },
      scene,
    );
    lens.material = mat;
    lens.isPickable = false;
    lens.rotation.x = Math.PI / 2;
    lens.position.z = 0.15;
    lens.parent = this.root;

    // Лучи-фрустум: от объектива к прямоугольнику впереди + рамка самого
    // прямоугольника — читается как конус обзора, а не просто одна линия.
    const tip = new Vector3(0, 0, 0.2);
    const corners = [
      new Vector3(-RAY_HALF, RAY_HALF * 0.6, RAY_LEN),
      new Vector3(RAY_HALF, RAY_HALF * 0.6, RAY_LEN),
      new Vector3(RAY_HALF, -RAY_HALF * 0.6, RAY_LEN),
      new Vector3(-RAY_HALF, -RAY_HALF * 0.6, RAY_LEN),
    ];
    const lines: Vector3[][] = [
      [tip, corners[0]],
      [tip, corners[1]],
      [tip, corners[2]],
      [tip, corners[3]],
      [corners[0], corners[1], corners[2], corners[3], corners[0]],
    ];
    this.rays = MeshBuilder.CreateLineSystem("specCamRays", { lines }, scene);
    this.rays.color = new Color3(0.3, 0.75, 1);
    this.rays.alpha = 0.55;
    this.rays.isPickable = false;
    this.rays.parent = this.root;
  }

  /** Показать/спрятать саму метку целиком (переключатель на пульте). */
  setEnabled(v: boolean): void {
    this.root.setEnabled(v);
  }

  /** Показать/спрятать только лучи направления (отдельный переключатель). */
  setRaysEnabled(v: boolean): void {
    this.rays.setEnabled(v);
  }

  /** Позиция камеры и точка, на которую она смотрит — направление считаем сами. */
  setPose(pos: Vector3, target: Vector3): void {
    this.root.position.copyFrom(pos);
    const dx = target.x - pos.x;
    const dy = target.y - pos.y;
    const dz = target.z - pos.z;
    const horiz = Math.hypot(dx, dz);
    if (horiz < 1e-4 && Math.abs(dy) < 1e-4) return; // цель совпадает с камерой — оставляем как было
    const yaw = Math.atan2(dx, dz);
    // Тот же знак, что и pitch камеры игрока: вниз — положительный (см. RemoteAvatar).
    const pitch = -Math.atan2(dy, horiz);
    Quaternion.RotationYawPitchRollToRef(yaw, pitch, 0, this.root.rotationQuaternion!);
  }

  dispose(): void {
    this.rays.dispose();
    this.root.dispose(false, true);
  }
}
