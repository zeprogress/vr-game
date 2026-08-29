import type { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Ray } from "@babylonjs/core/Culling/ray";
import "@babylonjs/core/Culling/ray";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";

import { ARROW } from "../shared/constants";
import { segmentDistance } from "../shared/geometry";
import type { Hittable } from "./Hittable";

export interface ArrowContext {
  scene: Scene;
  targets: Hittable[];
  isSolid: (m: AbstractMesh) => boolean;
  onHit: (kind: "flesh" | "wood", pos: Vector3) => void;
}

/** Прототип стрелы: наконечник смотрит по локальной +Z. */
export function createArrowProto(scene: Scene): Mesh {
  const shaftMat = new StandardMaterial("arrowShaft", scene);
  shaftMat.diffuseColor = new Color3(0.5, 0.36, 0.22);
  shaftMat.specularColor = new Color3(0, 0, 0);
  const headMat = new StandardMaterial("arrowHead", scene);
  headMat.diffuseColor = new Color3(0.7, 0.72, 0.75);
  headMat.specularColor = new Color3(0.5, 0.5, 0.5);
  const fletchMat = new StandardMaterial("arrowFletch", scene);
  fletchMat.diffuseColor = new Color3(0.8, 0.2, 0.2);
  fletchMat.specularColor = new Color3(0, 0, 0);

  const shaft = MeshBuilder.CreateBox("a_shaft", { width: 0.012, height: 0.012, depth: 0.7 }, scene);
  shaft.material = shaftMat;

  const head = MeshBuilder.CreateCylinder(
    "a_head",
    { height: 0.09, diameterBottom: 0.03, diameterTop: 0, tessellation: 6 },
    scene,
  );
  head.rotation.x = Math.PI / 2; // ось Y -> +Z
  head.position.z = 0.39;
  head.material = headMat;

  const f1 = MeshBuilder.CreateBox("a_f1", { width: 0.001, height: 0.05, depth: 0.1 }, scene);
  f1.position.z = -0.3;
  f1.material = fletchMat;
  const f2 = f1.clone("a_f2");
  f2.rotation.z = Math.PI / 2;

  const proto = Mesh.MergeMeshes([shaft, head, f1, f2], true, true, undefined, false, true);
  if (!proto) throw new Error("не удалось собрать стрелу");
  proto.name = "arrowProto";
  proto.isPickable = false;
  proto.setEnabled(false);
  return proto;
}

export class Arrow {
  readonly mesh: Mesh;
  private readonly vel: Vector3;
  private life = 0;
  private stuck = false;
  private stuckLife = 0;

  constructor(proto: Mesh, pos: Vector3, vel: Vector3) {
    this.mesh = proto.clone("arrow");
    this.mesh.setEnabled(true);
    this.mesh.position.copyFrom(pos);
    this.vel = vel.clone();
    this.face();
  }

  private face(): void {
    if (this.vel.lengthSquared() < 1e-6) return;
    this.mesh.lookAt(this.mesh.position.add(this.vel));
  }

  /** true — стрела ещё в игре. */
  update(dt: number, ctx: ArrowContext): boolean {
    if (this.stuck) {
      this.stuckLife += dt;
      return this.stuckLife < ARROW.stuckLife;
    }

    this.life += dt;
    const prev = this.mesh.position.clone();
    this.vel.y -= ARROW.gravity * dt;
    this.mesh.position.addInPlace(this.vel.scale(dt));
    this.face();

    const seg = this.mesh.position.subtract(prev);
    const len = seg.length();
    if (len > 1e-4) {
      const dir = seg.scale(1 / len);

      for (const target of ctx.targets) {
        if (!target.alive) continue;
        const s = target.hitSegment();
        if (segmentDistance(prev, this.mesh.position, s.a, s.b) < s.radius + ARROW.hitRadius) {
          target.hit(dir);
          ctx.onHit("flesh", this.mesh.position.clone());
          this.stopAt(prev.add(dir.scale(Math.max(0, len - 0.15))));
          return true;
        }
      }

      const hit = ctx.scene.pickWithRay(new Ray(prev, dir, len), ctx.isSolid);
      if (hit?.hit && hit.pickedPoint) {
        ctx.onHit("wood", hit.pickedPoint.clone());
        this.stopAt(hit.pickedPoint.subtract(dir.scale(0.12)));
        return true;
      }
    }

    return this.life <= ARROW.maxLife && this.mesh.position.y > -8;
  }

  private stopAt(at: Vector3): void {
    this.mesh.position.copyFrom(at);
    this.vel.setAll(0);
    this.stuck = true;
  }

  dispose(): void {
    this.mesh.dispose();
  }
}
