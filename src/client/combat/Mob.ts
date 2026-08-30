import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

import { MOB, SLIME_CFG, SPITTER_CFG } from "#shared/constants";
import type { MobKind, MobState } from "#shared/net/schema";
import { HealthBar3D } from "../ui/HealthBar3D";
import { NameTag } from "../ui/NameTag";
import type { WeaponKind } from "#shared/combat";
import type { Hittable, HitReporter } from "./Hittable";
import type { Sfx } from "../audio/Sfx";

let woundTex: DynamicTexture | null = null;

/** Тёмная «рана» — один общий текстурный сплат на всех мобов. */
function woundTexture(scene: Scene): DynamicTexture {
  if (woundTex) return woundTex;
  const S = 96;
  const t = new DynamicTexture("mobWound", { width: S, height: S }, scene, false);
  t.hasAlpha = true;
  const c = t.getContext() as unknown as CanvasRenderingContext2D;
  c.clearRect(0, 0, S, S);
  c.fillStyle = "rgba(30,4,6,0.95)";
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    c.beginPath();
    c.ellipse(S / 2 + Math.cos(a) * 12, S / 2 + Math.sin(a) * 12, 16 + i * 3, 9 + ((i * 5) % 11), a, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = "rgba(90,10,12,0.9)";
  c.beginPath();
  c.ellipse(S / 2, S / 2, 20, 12, 0.6, 0, Math.PI * 2);
  c.fill();
  t.update(true);
  woundTex = t;
  return t;
}

/**
 * Моб — ВИД (этап 6). Позиция/hp/смерть приходят из состояния сервера,
 * клиент интерполирует и играет вспышки, раны, сжатие, звуки. Попадания
 * игрока по мобу считает клиент и репортит серверу через `report`.
 */
export class Mob implements Hittable {
  readonly root: TransformNode;
  private readonly body: Mesh;
  private readonly head: TransformNode;
  private readonly hitAnchor: TransformNode;
  private readonly mat: StandardMaterial;
  private readonly bar: HealthBar3D;
  private readonly nameTag: NameTag;
  private readonly wounds: Mesh[] = [];
  private _woundMat: StandardMaterial | null = null;

  private readonly tint: readonly [number, number, number];
  private dead = false;
  private deathT = 0;
  private flash = 0;
  private barTimer = 0;
  private hitCd = 0;
  private lastHurtSeq = 0;
  private grounded = true;
  private prevY = 0;
  private readonly shove2 = new Vector3();
  private init = false;

  constructor(
    private readonly scene: Scene,
    kind: MobKind,
    readonly id: string,
    private readonly sfx: Sfx,
    private readonly report: HitReporter,
  ) {
    const cfg = kind === "spitter" ? SPITTER_CFG : SLIME_CFG;
    this.tint = cfg.tint;

    this.root = new TransformNode("mob", scene);

    this.mat = new StandardMaterial("mobMat", scene);
    this.mat.diffuseColor = new Color3(...cfg.tint);
    this.mat.emissiveColor = new Color3(cfg.tint[0] * 0.28, cfg.tint[1] * 0.2, cfg.tint[2] * 0.32);
    this.mat.specularColor = new Color3(0.4, 0.3, 0.4);
    // Полупрозрачное тело одним слоем: изнанку сферы не рисуем, иначе
    // передняя и задняя половины смешиваются и получается «слоёный пирог».
    this.mat.alpha = cfg.alpha;
    this.mat.backFaceCulling = true;

    this.body = MeshBuilder.CreateSphere("mobBody", { diameter: MOB.bodyRadius * 2, segments: 8 }, scene);
    this.body.material = this.mat;
    this.body.parent = this.root;
    this.body.position.y = MOB.bodyRadius;
    this.body.isPickable = false;

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
      eye.position.set(dx, cfg.ranged ? 0.05 : 0.15, MOB.bodyRadius * 0.99);
      eye.isPickable = false;
    }

    this.hitAnchor = new TransformNode("mobHitAnchor", scene);
    this.hitAnchor.parent = this.root;
    this.hitAnchor.position.y = MOB.bodyRadius;

    this.bar = new HealthBar3D(scene, this.root, new Vector3(0, MOB.bodyRadius * 2 + 0.35, 0), 0.7);
    this.bar.set(1);
    this.bar.setVisible(false);

    this.nameTag = new NameTag(
      scene,
      this.root,
      new Vector3(0, MOB.bodyRadius * 2 + 0.78, 0),
      cfg.name,
      cfg.level,
      cfg.ranged ? new Color3(1, 0.6, 0.25) : new Color3(0.85, 0.9, 1),
    );
  }

  // ---- Hittable ----

  get alive(): boolean {
    return !this.dead;
  }

  hitSegment(): { a: Vector3; b: Vector3; radius: number } {
    const p = this.root.getAbsolutePosition();
    return {
      a: p.add(new Vector3(0, 0.1, 0)),
      b: p.add(new Vector3(0, MOB.bodyRadius * 2, 0)),
      radius: MOB.hitRadius,
    };
  }

  hitNode(): TransformNode {
    return this.hitAnchor;
  }

  center(): Vector3 {
    return this.root.getAbsolutePosition().add(new Vector3(0, MOB.bodyRadius, 0));
  }

  /** Заявка на удар. Урон считает сервер; локальный кулдаун — 1 заявка на замах. */
  hit(dir: Vector3, weapon: WeaponKind, _contact?: Vector3): boolean {
    if (this.dead || this.hitCd > 0) return false;
    this.hitCd = 0.2;
    this.flash = Math.max(this.flash, 0.6); // мгновенная реакция, рана придёт из состояния
    let d = new Vector3(dir.x, 0, dir.z);
    if (d.lengthSquared() < 1e-6) d = new Vector3(0, 0, 1);
    d.normalize();
    this.report(this.id, "mob", weapon, d.x, d.z);
    return true;
  }

  /** Прислонили меч/щит — лёгкий визуальный толчок (сервер владеет физикой). */
  shove(dir: Vector3, strength: number): void {
    if (this.dead) return;
    this.shove2.x += dir.x * strength * 0.03;
    this.shove2.z += dir.z * strength * 0.03;
    const h = Math.hypot(this.shove2.x, this.shove2.z);
    if (h > 0.4) {
      this.shove2.x *= 0.4 / h;
      this.shove2.z *= 0.4 / h;
    }
  }

  // ---- вид ----

  applyState(s: MobState, dt: number, playerPos: Vector3, playerAim: Vector3): void {
    if (this.hitCd > 0) this.hitCd -= dt;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3);

    // толчок затухает
    this.shove2.scaleInPlace(Math.exp(-dt * 6));

    const tx = s.x + this.shove2.x;
    const ty = s.y;
    const tz = s.z + this.shove2.z;
    const pos = this.root.position;
    const far = Math.abs(pos.x - tx) > 5 || Math.abs(pos.z - tz) > 5;
    if (!this.init || far) {
      pos.set(tx, ty, tz);
      this.prevY = ty;
      this.init = true;
    } else {
      const k = 1 - Math.exp(-dt * 14);
      pos.x += (tx - pos.x) * k;
      pos.y += (ty - pos.y) * k;
      pos.z += (tz - pos.z) * k;
    }
    this.root.rotation.y = s.yaw;

    // урон: hurtSeq вырос -> вспышка + рана + звук
    if (s.hurtSeq !== this.lastHurtSeq) {
      this.lastHurtSeq = s.hurtSeq;
      this.flash = 1;
      this.barTimer = 3;
      this.bar.set(Math.max(0, s.hp) / s.maxHp);
      this.bar.setOpacity(1);
      if (!s.dead) {
        this.addWound(s.hurtDx, s.hurtDz);
        this.playIfNear(playerPos, () => this.sfx.mobHurt());
      }
    }

    if (this.barTimer > 0) {
      this.barTimer -= dt;
      this.bar.setOpacity(this.barTimer > 0.7 ? 1 : Math.max(0, this.barTimer / 0.7));
    }

    this.mat.emissiveColor.set(
      this.tint[0] * 0.28 + this.flash * 0.6,
      this.tint[1] * 0.2 + this.flash * 0.1,
      this.tint[2] * 0.32,
    );

    // смерть / возрождение
    if (s.dead && !this.dead) {
      this.dead = true;
      this.deathT = 0;
      for (const w of this.wounds) w.setEnabled(false);
      this.playIfNear(playerPos, () => this.sfx.mobDie());
    } else if (!s.dead && this.dead) {
      this.dead = false;
      this.body.visibility = 1;
      this.body.scaling.setAll(1);
      this.head.setEnabled(true);
      this.nameTag.setEnabled(true);
      this.clearWounds();
      this.bar.setVisible(false);
      this.barTimer = 0;
    }

    if (this.dead) {
      this.deathT += dt;
      const k = Math.min(1, this.deathT / 0.4);
      this.body.scaling.set(1 + k, Math.max(0.05, 1 - k), 1 + k);
      this.body.visibility = 1 - k;
      this.head.setEnabled(false);
      this.bar.setVisible(false);
      this.nameTag.setEnabled(false);
      this.prevY = pos.y;
      return;
    }

    // сжатие в прыжке — по вертикальной скорости
    const vy = dt > 1e-4 ? (pos.y - this.prevY) / dt : 0;
    this.prevY = pos.y;
    const sq = Math.max(0.4, 1 + vy * 0.04);
    this.body.scaling.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));

    if (s.grounded === 0 && this.grounded) this.playIfNear(playerPos, () => this.sfx.mobHop(), 20);
    this.grounded = s.grounded === 1;

    // плашка — только рядом и примерно в поле зрения
    const toMob = new Vector3(pos.x - playerPos.x, 0, pos.z - playerPos.z);
    const md = toMob.length();
    const facing = md < 1e-3 || Vector3.Dot(toMob.scale(1 / md), playerAim) > -0.25;
    this.nameTag.setEnabled(md < MOB.nameTagRange && facing);
  }

  private playIfNear(playerPos: Vector3, fn: () => void, range = 28): void {
    if (Vector3.DistanceSquared(this.root.getAbsolutePosition(), playerPos) < range * range) fn();
  }

  private addWound(dirX: number, dirZ: number): void {
    const n = new Vector3(-dirX, 0, -dirZ);
    if (n.lengthSquared() < 1e-4) n.set(0, 0, 1);
    n.normalize();
    n.addInPlaceFromFloats(
      (Math.random() - 0.5) * 0.6,
      (Math.random() - 0.4) * 0.7,
      (Math.random() - 0.5) * 0.6,
    );
    n.normalize();
    const yaw = this.root.rotation.y;
    const cos = Math.cos(-yaw);
    const sin = Math.sin(-yaw);
    const lx = n.x * cos - n.z * sin;
    const lz = n.x * sin + n.z * cos;
    const surf = MOB.bodyRadius * 0.99;

    const mark = MeshBuilder.CreatePlane("mobWound", { size: 0.22 + Math.random() * 0.1 }, this.scene);
    mark.parent = this.hitAnchor;
    mark.position.set(lx * surf, n.y * surf, lz * surf);
    mark.lookAt(mark.position.scale(2));
    mark.rotate(new Vector3(0, 0, 1), Math.random() * Math.PI);
    mark.material = this.woundMat();
    mark.isPickable = false;
    mark.renderingGroupId = 0;

    this.wounds.push(mark);
    if (this.wounds.length > MOB.woundLimit) this.wounds.shift()?.dispose();
  }

  private woundMat(): StandardMaterial {
    if (this._woundMat) return this._woundMat;
    const tex = woundTexture(this.scene);
    const m = new StandardMaterial("mobWoundMat", this.scene);
    m.diffuseTexture = tex;
    m.emissiveTexture = tex;
    m.opacityTexture = tex;
    m.useAlphaFromDiffuseTexture = true;
    m.disableLighting = true;
    m.specularColor = new Color3(0, 0, 0);
    m.emissiveColor = new Color3(1, 1, 1);
    m.backFaceCulling = false;
    m.zOffset = -2;
    this._woundMat = m;
    return m;
  }

  private clearWounds(): void {
    for (const w of this.wounds) w.dispose();
    this.wounds.length = 0;
  }

  dispose(): void {
    this.clearWounds();
    this.nameTag.dispose();
    this.bar.dispose();
    this.root.dispose(false, true);
    this._woundMat?.dispose();
  }
}
