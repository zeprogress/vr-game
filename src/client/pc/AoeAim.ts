import type { Scene } from "@babylonjs/core/scene";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/discBuilder";
import "@babylonjs/core/Meshes/Builders/torusBuilder";

import { terrainHeight } from "#shared/terrain";
import { groundFxThrough } from "../ui/groundFx";

const OK = new Color3(0.35, 0.95, 0.45);
const FAR = new Color3(1, 0.25, 0.2);

/**
 * Прицел умения по площади на ПК (град стрел): круг на земле под курсором.
 * Зелёный — в пределах дальности, красный — дальше (применить нельзя).
 */
export class AoeAim {
  private readonly root: TransformNode;
  private readonly disc: Mesh;
  private readonly ring: Mesh;
  private readonly discMat: StandardMaterial;
  private readonly ringMat: StandardMaterial;
  active = false;
  /** Куда ляжет круг (центр на земле) и дотягиваемся ли. */
  readonly point = new Vector3();
  inRange = false;
  private radius = 1;

  constructor(private readonly scene: Scene) {
    this.root = new TransformNode("aoeAim", scene);
    this.discMat = new StandardMaterial("aoeAimDiscMat", scene);
    this.discMat.disableLighting = true;
    this.discMat.alpha = 0.22;
    this.discMat.backFaceCulling = false;
    this.disc = MeshBuilder.CreateDisc("aoeAimDisc", { radius: 1, tessellation: 48 }, scene);
    this.disc.rotation.x = Math.PI / 2;
    this.disc.material = this.discMat;
    this.disc.parent = this.root;
    this.disc.isPickable = false;
    groundFxThrough(this.disc);
    this.ringMat = new StandardMaterial("aoeAimRingMat", scene);
    this.ringMat.disableLighting = true;
    this.ringMat.backFaceCulling = false;
    this.ring = MeshBuilder.CreateTorus("aoeAimRing", { diameter: 2, thickness: 0.06, tessellation: 64 }, scene);
    this.ring.material = this.ringMat;
    this.ring.parent = this.root;
    this.ring.isPickable = false;
    groundFxThrough(this.ring);
    this.root.setEnabled(false);
  }

  start(radius: number): void {
    this.radius = radius;
    this.active = true;
    this.root.scaling.set(radius, 1, radius);
    this.root.setEnabled(true);
  }

  cancel(): void {
    this.active = false;
    this.root.setEnabled(false);
  }

  /**
   * Курсор (px на канвасе) → точка на земле; дальность считаем от героя.
   * Возвращает false, если луч не упёрся в землю (смотрим в небо).
   */
  update(mx: number, my: number, camera: Camera, from: Vector3, range: number): boolean {
    if (!this.active) return false;
    const ray = this.scene.createPickingRay(mx, my, Matrix.Identity(), camera);
    const o = ray.origin;
    const d = ray.direction;
    let hit = false;
    let prev = 0;
    for (let s = 0.5; s < 260; s += 0.5) {
      if (o.y + d.y * s < terrainHeight(o.x + d.x * s, o.z + d.z * s)) {
        let lo = prev;
        let hi = s;
        for (let i = 0; i < 6; i++) {
          const m = (lo + hi) / 2;
          if (o.y + d.y * m < terrainHeight(o.x + d.x * m, o.z + d.z * m)) hi = m;
          else lo = m;
        }
        this.point.set(o.x + d.x * hi, 0, o.z + d.z * hi);
        hit = true;
        break;
      }
      prev = s;
    }
    if (!hit) {
      this.root.setEnabled(false);
      this.inRange = false;
      return false;
    }
    this.point.y = terrainHeight(this.point.x, this.point.z);
    this.inRange = Math.hypot(this.point.x - from.x, this.point.z - from.z) <= range;
    const c = this.inRange ? OK : FAR;
    this.discMat.emissiveColor = c;
    this.ringMat.emissiveColor = c;
    this.root.position.set(this.point.x, this.point.y + 0.08, this.point.z);
    this.root.scaling.set(this.radius, 1, this.radius);
    this.root.setEnabled(true);
    return true;
  }

  dispose(): void {
    this.root.dispose();
  }
}
