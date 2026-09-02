import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/boxBuilder";

/** Источник позы глаз (в VR — голова гарнитуры, иначе — камера). Всё в мире. */
interface EyeSource {
  readonly eyePosition: Vector3;
  readonly eyeForward: Vector3;
}

interface Cross {
  mesh: Mesh;
  age: number; // < 0 — задержка старта (крестики вылетают волной)
  life: number;
  x: number;
  driftX: number;
}

const WORLD_UP = new Vector3(0, 1, 0);

/**
 * Зелёные крестики, пролетающие снизу вверх перед глазами после лечения
 * (зельем или магией). Позиционируются в мировых осях от направления взгляда —
 * одинаково в VR и на плоскости.
 */
export class HealCrossFx {
  private readonly proto: Mesh;
  private readonly crosses: Cross[] = [];
  private seq = 0;
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly at = new Vector3();

  constructor(
    scene: Scene,
    private readonly eye: EyeSource,
  ) {
    const bar = MeshBuilder.CreateBox("healCrossH", { width: 0.11, height: 0.022, depth: 0.006 }, scene);
    const post = MeshBuilder.CreateBox("healCrossV", { width: 0.022, height: 0.11, depth: 0.006 }, scene);
    const merged = Mesh.MergeMeshes([bar, post], true, true);
    const m = merged ?? bar;
    if (!merged) post.dispose();
    m.name = "healCrossProto";
    const mat = new StandardMaterial("healCrossMat", scene);
    mat.emissiveColor = new Color3(0.3, 1, 0.42);
    mat.diffuseColor = new Color3(0, 0, 0);
    mat.specularColor = new Color3(0, 0, 0);
    mat.disableLighting = true;
    mat.disableDepthWrite = true;
    mat.alpha = 0.95;
    m.material = mat;
    m.isPickable = false;
    m.renderingGroupId = 2;
    m.setEnabled(false);
    this.proto = m;
  }

  /** Выпустить волну крестиков. strength 0..1 — сколько и как ярко. */
  burst(strength = 1): void {
    const s = Math.max(0.2, Math.min(1, strength));
    const n = 4 + Math.round(s * 5);
    for (let i = 0; i < n; i++) {
      const mesh = this.proto.clone(`healCross_${this.seq++}`);
      mesh.material = this.proto.material!.clone(`healCrossMat_${this.seq}`);
      mesh.setEnabled(false);
      this.crosses.push({
        mesh,
        age: -i * 0.07 - Math.random() * 0.05,
        life: 1.0 + Math.random() * 0.5,
        x: (Math.random() - 0.5) * 0.6,
        driftX: (Math.random() - 0.5) * 0.12,
      });
    }
  }

  update(dt: number): void {
    if (this.crosses.length === 0) return;
    const pos = this.eye.eyePosition;
    const fwd = this.eye.eyeForward;
    // Мировой базис у лица: право = up × fwd, вверх = fwd × право.
    Vector3.CrossToRef(WORLD_UP, fwd, this.right);
    if (this.right.lengthSquared() < 1e-6) this.right.set(1, 0, 0);
    this.right.normalize();
    Vector3.CrossToRef(fwd, this.right, this.up);
    this.up.normalize();

    for (let i = this.crosses.length - 1; i >= 0; i--) {
      const c = this.crosses[i];
      c.age += dt;
      if (c.age < 0) continue;
      const f = c.age / c.life;
      if (f >= 1) {
        c.mesh.dispose(false, true);
        this.crosses.splice(i, 1);
        continue;
      }
      c.mesh.setEnabled(true);
      const lx = c.x + c.driftX * f;
      const ly = -0.3 + f * 0.6;
      this.at
        .copyFrom(pos)
        .addInPlaceFromFloats(fwd.x * 0.62, fwd.y * 0.62, fwd.z * 0.62)
        .addInPlaceFromFloats(this.right.x * lx, this.right.y * lx, this.right.z * lx)
        .addInPlaceFromFloats(this.up.x * ly, this.up.y * ly, this.up.z * ly);
      c.mesh.position.copyFrom(this.at);
      c.mesh.lookAt(pos); // плоскостью к лицу
      c.mesh.scaling.setAll(0.6 + 0.5 * Math.min(1, f * 4));
      const fade = f < 0.12 ? f / 0.12 : 1 - (f - 0.12) / 0.88;
      (c.mesh.material as StandardMaterial).alpha = Math.max(0, fade) * 0.95;
    }
  }

  dispose(): void {
    for (const c of this.crosses) c.mesh.dispose(false, true);
    this.crosses.length = 0;
    this.proto.dispose(false, true);
  }
}
