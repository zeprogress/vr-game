import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import "@babylonjs/core/Meshes/Builders/boxBuilder";

import { COMBAT } from "#shared/constants";
import type { DummyState } from "#shared/net/schema";
import type { Hittable, HitReporter } from "./Hittable";

/**
 * Кукла-противник — ВИД (этап 6). hp/смерть приходят с сервера; клиент
 * играет вспышку и падение. Удары игрок считает и репортит серверу.
 */
export class Dummy implements Hittable {
  readonly root: TransformNode;
  private readonly figure: TransformNode;
  private readonly mat: StandardMaterial;

  private hitCooldown = 0;
  private flash = 0;
  private tilt = 0;
  private tiltVel = 0;
  private dying = false;
  private lastHurtSeq = 0;

  constructor(
    scene: Scene,
    readonly id: string,
    position: Vector3,
    private readonly report: HitReporter,
  ) {
    this.root = new TransformNode("dummy", scene);
    this.root.position.copyFrom(position);

    const wood = new StandardMaterial("dummyPost", scene);
    wood.diffuseColor = new Color3(0.3, 0.2, 0.12);
    wood.specularColor = new Color3(0, 0, 0);
    const post = MeshBuilder.CreateCylinder("d_post", { height: 1.0, diameter: 0.16 }, scene);
    post.position.y = 0.5;
    post.material = wood;
    post.parent = this.root;
    post.isPickable = false;

    this.mat = new StandardMaterial("dummyBody", scene);
    this.mat.diffuseColor = new Color3(0.75, 0.68, 0.5);
    this.mat.specularColor = new Color3(0, 0, 0);

    this.figure = new TransformNode("dummyFigure", scene);
    this.figure.parent = this.root;
    this.figure.position.y = 1.0;

    const torso = MeshBuilder.CreateCapsule("d_torso", { height: 1.0, radius: 0.28 }, scene);
    torso.position.y = 0.5;
    torso.material = this.mat;
    torso.parent = this.figure;
    torso.isPickable = false;

    const head = MeshBuilder.CreateSphere("d_head", { diameter: 0.34, segments: 6 }, scene);
    head.position.y = 1.15;
    head.material = this.mat;
    head.parent = this.figure;
    head.isPickable = false;

    const arms = MeshBuilder.CreateBox("d_arms", { width: 1.2, height: 0.16, depth: 0.16 }, scene);
    arms.position.y = 0.75;
    arms.material = this.mat;
    arms.parent = this.figure;
    arms.isPickable = false;
  }

  get alive(): boolean {
    return !this.dying;
  }

  hitSegment(): { a: Vector3; b: Vector3; radius: number } {
    const base = this.figure.getAbsolutePosition();
    return {
      a: base.add(new Vector3(0, 0.05, 0)),
      b: base.add(new Vector3(0, 1.35, 0)),
      radius: COMBAT.dummyHitRadius,
    };
  }

  hit(dir: Vector3, damage = 1): boolean {
    if (this.dying || this.hitCooldown > 0) return false;
    this.hitCooldown = COMBAT.hitCooldown;
    this.flash = 1;

    const local = this.root.getWorldMatrix().clone().invert();
    const d = Vector3.TransformNormal(dir, local);
    this.tiltVel += Math.sign(d.z || 1) * 6;

    let hx = dir.x;
    let hz = dir.z;
    const h = Math.hypot(hx, hz);
    if (h > 1e-4) {
      hx /= h;
      hz /= h;
    } else {
      hz = 1;
    }
    this.report(this.id, "dummy", damage, hx, hz);
    return true;
  }

  applyState(s: DummyState, dt: number): void {
    if (this.hitCooldown > 0) this.hitCooldown -= dt;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3);
    this.mat.emissiveColor.set(this.flash * 0.9, this.flash * 0.05, 0);

    if (s.hurtSeq !== this.lastHurtSeq) {
      this.lastHurtSeq = s.hurtSeq;
      this.flash = 1;
      this.tiltVel += 6;
    }

    const dead = s.dead === 1;
    if (dead && !this.dying) this.dying = true;
    else if (!dead && this.dying) {
      this.dying = false;
      this.tilt = 0;
      this.tiltVel = 0;
      this.figure.rotation.x = 0;
    }

    if (this.dying) {
      this.tilt += (Math.PI / 2 - this.tilt) * Math.min(1, dt * 6);
      this.figure.rotation.x = this.tilt;
      return;
    }

    this.tiltVel += -40 * this.tilt * dt;
    this.tiltVel *= Math.exp(-4 * dt);
    this.tilt += this.tiltVel * dt;
    this.figure.rotation.x = this.tilt;
  }

  dispose(): void {
    this.root.dispose(false, true);
  }
}
