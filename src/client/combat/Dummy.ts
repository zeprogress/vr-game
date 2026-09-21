import type { Scene } from "@babylonjs/core/scene";
import { Vector3, Matrix } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import "@babylonjs/core/Meshes/Builders/boxBuilder";

import { COMBAT } from "#shared/constants";
import type { DummyState } from "#shared/net/schema";
import type { WeaponKind } from "#shared/combat";
import type { Hittable, HitReporter } from "./Hittable";

/**
 * Все куклы сцены — две отрисовки (стойки и тела) тонкими инстансами вместо двух мешей на куклу.
 * Тела качаются и вспыхивают: матрица (наклон) и цвет (вспышка) пишутся в буферы, но заливка в GPU — только пока что-то меняется.
 */
class DummyBatch {
  private readonly post: Mesh;
  private readonly body: Mesh;
  private readonly members: Dummy[] = [];
  private cap = 8;
  private mPost = new Float32Array(16 * this.cap);
  private mBody = new Float32Array(16 * this.cap);
  private col = new Float32Array(4 * this.cap);
  private dirty = true;
  private moving = false;
  private readonly tmp = new Matrix();

  constructor(scene: Scene) {
    const wood = new StandardMaterial("dummyPost", scene);
    wood.diffuseColor = new Color3(0.3, 0.2, 0.12);
    wood.specularColor = new Color3(0, 0, 0);
    const post = MeshBuilder.CreateCylinder("d_post", { height: 1.0, diameter: 0.16 }, scene);
    post.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0));
    post.material = wood;
    post.isPickable = false;
    post.alwaysSelectAsActiveMesh = true;
    this.post = post;

    const mat = new StandardMaterial("dummyBody", scene);
    mat.diffuseColor = new Color3(0.75, 0.68, 0.5);
    mat.specularColor = new Color3(0, 0, 0);
    // Туловище, голова и руки — один меш (общий материал), выше на 1 м (точка вращения фигуры).
    const torso = MeshBuilder.CreateCapsule("d_torso", { height: 1.0, radius: 0.28 }, scene);
    torso.position.y = 0.5;
    const head = MeshBuilder.CreateSphere("d_head", { diameter: 0.34, segments: 6 }, scene);
    head.position.y = 1.15;
    const arms = MeshBuilder.CreateBox("d_arms", { width: 1.2, height: 0.16, depth: 0.16 }, scene);
    arms.position.y = 0.75;
    const body = Mesh.MergeMeshes([torso, head, arms], true, true) ?? torso;
    body.name = "d_body";
    body.material = mat;
    body.isPickable = false;
    body.alwaysSelectAsActiveMesh = true;
    this.body = body;

    for (const m of [post, body]) {
      m.thinInstanceSetBuffer("matrix", m === post ? this.mPost : this.mBody, 16, false);
      m.setEnabled(false);
    }
    body.thinInstanceSetBuffer("color", this.col, 4, false);
  }

  add(d: Dummy): void {
    if (this.members.includes(d)) return;
    this.members.push(d);
    if (this.members.length > this.cap) this.grow();
    this.dirty = true;
  }

  remove(d: Dummy): void {
    const i = this.members.indexOf(d);
    if (i < 0) return;
    this.members.splice(i, 1);
    this.dirty = true;
  }

  private grow(): void {
    this.cap *= 2;
    this.mPost = new Float32Array(16 * this.cap);
    this.mBody = new Float32Array(16 * this.cap);
    this.col = new Float32Array(4 * this.cap);
    this.post.thinInstanceSetBuffer("matrix", this.mPost, 16, false);
    this.body.thinInstanceSetBuffer("matrix", this.mBody, 16, false);
    this.body.thinInstanceSetBuffer("color", this.col, 4, false);
  }

  /** Раз за кадр после applyState всех кукол. */
  flush(): void {
    const n = this.members.length;
    let anim = false;
    for (const d of this.members) if (d.animating) anim = true;
    if (!this.dirty && !anim && !this.moving) return;
    this.moving = anim;
    this.dirty = false;
    this.post.setEnabled(n > 0);
    this.body.setEnabled(n > 0);
    if (n === 0) return;
    for (let i = 0; i < n; i++) {
      const d = this.members[i];
      const p = d.root.position;
      Matrix.TranslationToRef(p.x, p.y, p.z, this.tmp);
      this.tmp.copyToArray(this.mPost, i * 16);
      Matrix.RotationXToRef(d.tiltAngle, this.tmp);
      const m = this.tmp.m as unknown as Float32Array;
      m[12] = p.x;
      m[13] = p.y + 1;
      m[14] = p.z;
      this.tmp.copyToArray(this.mBody, i * 16);
      const f = d.flashAmount;
      this.col[i * 4] = 1 + f * 1.6;
      this.col[i * 4 + 1] = 1 + f * 0.1;
      this.col[i * 4 + 2] = 1;
      this.col[i * 4 + 3] = 1;
    }
    this.post.thinInstanceCount = n;
    this.body.thinInstanceCount = n;
    this.post.thinInstanceBufferUpdated("matrix");
    this.body.thinInstanceBufferUpdated("matrix");
    this.body.thinInstanceBufferUpdated("color");
  }
}

const batches = new WeakMap<Scene, DummyBatch>();
function batchOf(scene: Scene): DummyBatch {
  let b = batches.get(scene);
  if (!b) {
    b = new DummyBatch(scene);
    batches.set(scene, b);
  }
  return b;
}

/** Залить накопленные позы кукол в GPU (раз за кадр, после всех Dummy.applyState). */
export function flushDummies(scene: Scene): void {
  batches.get(scene)?.flush();
}

/**
 * Кукла-противник — ВИД (этап 6). hp/смерть приходят с сервера; клиент
 * играет вспышку и падение. Удары игрок считает и репортит серверу.
 */
export class Dummy implements Hittable {
  readonly root: TransformNode;
  private readonly figure: TransformNode;
  private inBatch = false;

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

    this.figure = new TransformNode("dummyFigure", scene);
    this.figure.parent = this.root;
    this.figure.position.y = 1.0;
    this.root.computeWorldMatrix(true);
  }

  /** Далеко от игрока — кукла целиком отключена (нет отрисовок и пересчёта матриц). */
  setNear(on: boolean): void {
    if (this.root.isEnabled() !== on) this.root.setEnabled(on);
    if (on !== this.inBatch) {
      this.inBatch = on;
      if (on) batchOf(this.root.getScene()).add(this);
      else batchOf(this.root.getScene()).remove(this);
    }
  }

  /** Наклон фигуры (рад) и сила вспышки 0..1 — читает DummyBatch. */
  get tiltAngle(): number {
    return this.tilt;
  }
  get flashAmount(): number {
    return this.flash;
  }
  /** Что-то ещё качается/горит — буферы надо обновлять. */
  get animating(): boolean {
    return this.flash > 0 || (this.dying ? this.tilt !== Math.PI / 2 : this.tilt !== 0 || this.tiltVel !== 0);
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

  hit(dir: Vector3, weapon: WeaponKind): boolean {
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
    this.report(this.id, "dummy", weapon, hx, hz);
    return true;
  }

  applyState(s: DummyState, dt: number): void {
    if (this.hitCooldown > 0) this.hitCooldown -= dt;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3);

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
      if (Math.PI / 2 - this.tilt < 1e-3) this.tilt = Math.PI / 2;
      this.figure.rotation.x = this.tilt;
      return;
    }

    this.tiltVel += -40 * this.tilt * dt;
    this.tiltVel *= Math.exp(-4 * dt);
    this.tilt += this.tiltVel * dt;
    if (Math.abs(this.tilt) < 1e-3 && Math.abs(this.tiltVel) < 1e-2) this.tilt = this.tiltVel = 0;
    this.figure.rotation.x = this.tilt;
  }

  dispose(): void {
    if (this.inBatch) batchOf(this.root.getScene()).remove(this);
    this.root.dispose(false, true);
  }
}
