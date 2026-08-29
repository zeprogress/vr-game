import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";

import { MOB } from "../shared/constants";
import { HealthBar3D } from "../ui/HealthBar3D";
import type { Hittable } from "./Hittable";

export interface MobContext {
  playerPos: Vector3;
  groundHeight: (x: number, z: number) => number;
  hurtPlayer: (amount: number, dir: Vector3) => void;
  onHop: () => void;
  onHurt: (pos: Vector3) => void;
  onDie: (pos: Vector3) => void;
}

/** Прыгающий слизень: агрится на игрока, скачет к нему, бьёт в упор. */
export class Mob implements Hittable {
  readonly root: TransformNode;
  private readonly body: Mesh;
  private readonly head: TransformNode;
  private readonly mat: StandardMaterial;
  private readonly home: Vector3;
  private readonly bar: HealthBar3D;
  private barTimer = 0;

  private hp = MOB.hp;
  private vel = new Vector3();
  private grounded = false;
  private hopCd = Math.random() * MOB.hopInterval;
  private attackCd = 0;
  private flash = 0;
  private hurtCd = 0;
  private dead = false;
  private respawnIn = 0;
  private deathT = 0;

  constructor(scene: Scene, home: Vector3) {
    this.home = home.clone();
    this.root = new TransformNode("mob", scene);
    this.root.position.copyFrom(home);

    this.mat = new StandardMaterial("mobMat", scene);
    this.mat.diffuseColor = new Color3(0.52, 0.16, 0.5);
    this.mat.emissiveColor = new Color3(0.14, 0.03, 0.16);
    this.mat.specularColor = new Color3(0.4, 0.3, 0.4);

    this.body = MeshBuilder.CreateSphere("mobBody", { diameter: MOB.bodyRadius * 2, segments: 8 }, scene);
    this.body.material = this.mat;
    this.body.parent = this.root;
    this.body.position.y = MOB.bodyRadius;
    this.body.isPickable = false;

    // Глаза на отдельном узле (не сплющивается с телом), на самой поверхности.
    this.head = new TransformNode("mobHead", scene);
    this.head.parent = this.root;
    this.head.position.y = MOB.bodyRadius;

    const eyeMat = new StandardMaterial("mobEye", scene);
    eyeMat.diffuseColor = new Color3(0.02, 0.02, 0.02);
    eyeMat.specularColor = new Color3(0.15, 0.15, 0.15);
    for (const dx of [-0.18, 0.18]) {
      const eye = MeshBuilder.CreateSphere("mobEye", { diameter: 0.17, segments: 6 }, scene);
      eye.material = eyeMat;
      eye.parent = this.head;
      eye.position.set(dx, 0.15, MOB.bodyRadius * 0.92);
      eye.isPickable = false;
    }

    this.bar = new HealthBar3D(scene, this.root, new Vector3(0, MOB.bodyRadius * 2 + 0.35, 0), 0.7);
    this.bar.set(1);
    this.bar.setVisible(false);
  }

  get alive(): boolean {
    return !this.dead;
  }

  hitSegment(): { a: Vector3; b: Vector3; radius: number } {
    const p = this.root.getAbsolutePosition();
    return { a: p.add(new Vector3(0, 0.1, 0)), b: p.add(new Vector3(0, MOB.bodyRadius * 2, 0)), radius: MOB.hitRadius };
  }

  hit(dir: Vector3, damage = 1): boolean {
    if (this.dead || this.hurtCd > 0) return false;
    this.hurtCd = 0.2;
    this.flash = 1;
    this.hp -= damage;
    this.vel.addInPlace(dir.scale(3.5));
    this.vel.y += 2.5;
    this.grounded = false;
    this.bar.set(Math.max(0, this.hp) / MOB.hp);
    this.bar.setOpacity(1);
    this.barTimer = 3;
    if (this.hp <= 0) {
      this.dead = true;
      this.deathT = 0;
      this.respawnIn = MOB.respawn;
      this.ctxOnDie?.(this.root.getAbsolutePosition().clone());
    } else {
      this.ctxOnHurt?.(this.root.getAbsolutePosition().clone());
    }
    return true;
  }

  // сохраняем колбэки последнего update, чтобы hit() мог их дёрнуть
  private ctxOnHurt?: (p: Vector3) => void;
  private ctxOnDie?: (p: Vector3) => void;

  update(dt: number, ctx: MobContext): void {
    this.ctxOnHurt = ctx.onHurt;
    this.ctxOnDie = ctx.onDie;

    if (this.hurtCd > 0) this.hurtCd -= dt;
    if (this.attackCd > 0) this.attackCd -= dt;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3);
    this.mat.emissiveColor.set(0.14 + this.flash * 0.6, 0.03 + this.flash * 0.1, 0.16);

    if (this.barTimer > 0) {
      this.barTimer -= dt;
      this.bar.setOpacity(this.barTimer > 0.7 ? 1 : this.barTimer / 0.7);
    }

    if (this.dead) {
      this.deathT += dt;
      const k = Math.min(1, this.deathT / 0.4);
      this.body.scaling.set(1 + k, Math.max(0.05, 1 - k), 1 + k);
      this.head.setEnabled(false);
      this.bar.setVisible(false);
      this.root.position.y -= dt * 0.6;
      this.body.visibility = 1 - k;
      this.respawnIn -= dt;
      if (this.respawnIn <= 0) this.respawnAt();
      return;
    }

    const pos = this.root.position;
    const toPlayer = ctx.playerPos.subtract(pos);
    toPlayer.y = 0;
    const dist = toPlayer.length();
    const dir = dist > 1e-3 ? toPlayer.scale(1 / dist) : new Vector3(0, 0, 1);
    const chasing = dist < MOB.aggroRange;

    // --- прыжки ---
    if (this.grounded) {
      this.hopCd -= dt;
      if (this.hopCd <= 0 && chasing && dist > MOB.attackRange * 0.7) {
        this.vel.x = dir.x * MOB.hopSpeed;
        this.vel.z = dir.z * MOB.hopSpeed;
        this.vel.y = MOB.hopUp;
        this.grounded = false;
        this.hopCd = MOB.hopInterval;
        ctx.onHop();
      }
    } else {
      this.vel.y -= MOB.gravity * dt;
    }

    pos.x += this.vel.x * dt;
    pos.y += this.vel.y * dt;
    pos.z += this.vel.z * dt;

    const groundY = ctx.groundHeight(pos.x, pos.z);
    if (pos.y <= groundY) {
      pos.y = groundY;
      this.vel.y = 0;
      this.vel.x *= 0.25;
      this.vel.z *= 0.25;
      this.grounded = true;
    }

    // --- смотрит на игрока, сплющивается по вертикальной скорости ---
    if (chasing) this.root.rotation.y = Math.atan2(dir.x, dir.z);
    const stretch = 1 + this.vel.y * 0.04;
    this.body.scaling.set(1 / Math.sqrt(Math.max(0.4, stretch)), Math.max(0.4, stretch), 1 / Math.sqrt(Math.max(0.4, stretch)));

    // --- атака в упор ---
    if (chasing && dist < MOB.attackRange && this.attackCd <= 0) {
      this.attackCd = MOB.attackCooldown;
      ctx.hurtPlayer(MOB.attackDamage, dir.clone());
      this.vel.addInPlace(dir.scale(-2)); // отскок назад
    }
  }

  private respawnAt(): void {
    const a = Math.random() * Math.PI * 2;
    const r = 3 + Math.random() * MOB.wanderRadius;
    this.root.position.set(this.home.x + Math.cos(a) * r, this.home.y + 5, this.home.z + Math.sin(a) * r);
    this.hp = MOB.hp;
    this.dead = false;
    this.vel.setAll(0);
    this.grounded = false;
    this.flash = 0;
    this.body.visibility = 1;
    this.body.scaling.setAll(1);
    this.head.setEnabled(true);
    this.bar.set(1);
    this.bar.setVisible(false);
    this.barTimer = 0;
  }
}
