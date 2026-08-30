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

import { MOB, PLAYER, SLIME_CFG, SPITTER, type MobConfig } from "../shared/constants";
import { HealthBar3D } from "../ui/HealthBar3D";
import { NameTag } from "../ui/NameTag";
import type { Hittable } from "./Hittable";

export interface MobContext {
  playerPos: Vector3;
  /** Направление взгляда игрока (единичное) — для «в радиусе видимости». */
  playerAim: Vector3;
  groundHeight: (x: number, z: number) => number;
  /** `from` — откуда прилетел удар (нужно для проверки блока щитом/мечом). */
  hurtPlayer: (amount: number, dir: Vector3, from: Vector3) => void;
  /** Дальнобойный моб плюётся шариком из точки `from`. */
  fireBall: (from: Vector3) => void;
  onHop: () => void;
  onHurt: (pos: Vector3) => void;
  onDie: (pos: Vector3, xp: number) => void;
}

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
    c.ellipse(
      S / 2 + Math.cos(a) * 12,
      S / 2 + Math.sin(a) * 12,
      16 + i * 3,
      9 + ((i * 5) % 11),
      a,
      0,
      Math.PI * 2,
    );
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
 * Моб. Слизень (по умолчанию) скачет к игроку и бьёт в упор; «Плевун»
 * (`cfg.ranged`) держит дистанцию и стреляет шариками.
 */
export class Mob implements Hittable {
  readonly root: TransformNode;
  private readonly body: Mesh;
  private readonly head: TransformNode;
  private readonly hitAnchor: TransformNode; // сюда крепятся стрелы и раны
  private readonly mat: StandardMaterial;
  private readonly home: Vector3;
  private readonly bar: HealthBar3D;
  private readonly nameTag: NameTag;
  private readonly wounds: Mesh[] = [];
  private barTimer = 0;

  private readonly maxHp: number;
  private hp: number;
  private vel = new Vector3();
  private grounded = false;
  private hopCd = Math.random() * MOB.hopInterval;
  private attackCd = 0;
  private shoveCd = 0;
  private flash = 0;
  private hurtCd = 0;
  private aggroed = false; // разъярён — идёт к игроку даже издалека
  private outOfRange = 0; // с подряд вне зоны агра
  private dead = false;
  private respawnIn = 0;
  private deathT = 0;

  constructor(
    private readonly scene: Scene,
    home: Vector3,
    private readonly cfg: MobConfig = SLIME_CFG,
  ) {
    this.home = home.clone();
    this.maxHp = cfg.hp;
    this.hp = cfg.hp;

    this.root = new TransformNode("mob", scene);
    this.root.position.copyFrom(home);

    this.mat = new StandardMaterial("mobMat", scene);
    this.mat.diffuseColor = new Color3(...cfg.tint);
    this.mat.emissiveColor = new Color3(cfg.tint[0] * 0.28, cfg.tint[1] * 0.2, cfg.tint[2] * 0.32);
    this.mat.specularColor = new Color3(0.4, 0.3, 0.4);

    this.body = MeshBuilder.CreateSphere(
      "mobBody",
      { diameter: MOB.bodyRadius * 2, segments: 8 },
      scene,
    );
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
      eye.position.set(dx, cfg.ranged ? 0.05 : 0.15, MOB.bodyRadius * 0.92);
      eye.isPickable = false;
    }

    this.hitAnchor = new TransformNode("mobHitAnchor", scene);
    this.hitAnchor.parent = this.root;
    this.hitAnchor.position.y = MOB.bodyRadius;

    this.bar = new HealthBar3D(
      scene,
      this.root,
      new Vector3(0, MOB.bodyRadius * 2 + 0.35, 0),
      0.7,
    );
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

  /** Толчок предметом в руке (не урон). */
  shove(dir: Vector3, strength: number): void {
    if (this.dead || this.shoveCd > 0) return;
    this.shoveCd = 0.12;
    this.vel.x += dir.x * strength;
    this.vel.z += dir.z * strength;
    if (this.grounded && strength > 2.5) {
      this.vel.y += 1.6;
      this.grounded = false;
    }
    const h = Math.hypot(this.vel.x, this.vel.z);
    if (h > MOB.shoveMax) {
      this.vel.x *= MOB.shoveMax / h;
      this.vel.z *= MOB.shoveMax / h;
    }
  }

  hit(dir: Vector3, damage = 1, contact?: Vector3): boolean {
    if (this.dead || this.hurtCd > 0) return false;
    this.hurtCd = 0.2;
    this.flash = 1;
    this.hp -= damage;
    this.aggroed = true; // получил урон (в т.ч. стрелой издалека) — идёт к игроку
    this.outOfRange = 0;

    // Отскок пропорционален урону.
    const kb = 2.5 + damage * 1.5;
    this.vel.addInPlace(dir.scale(Math.min(kb, 7)));
    this.vel.y += 2.5;
    this.grounded = false;

    this.addWound(contact, dir);

    this.bar.set(Math.max(0, this.hp) / this.maxHp);
    this.bar.setOpacity(1);
    this.barTimer = 3;
    if (this.hp <= 0) {
      this.dead = true;
      this.deathT = 0;
      this.respawnIn = MOB.respawn;
      this.ctxOnDie?.(this.root.getAbsolutePosition().clone(), this.cfg.xp);
    } else {
      this.ctxOnHurt?.(this.root.getAbsolutePosition().clone());
    }
    return true;
  }

  private addWound(contactWorld: Vector3 | undefined, dir: Vector3): void {
    // Рана точно в месте касания оружия: направление от центра тела к точке
    // контакта. Небольшой разброс — только чтобы повторные удары не сливались.
    const n = contactWorld
      ? contactWorld.subtract(this.center())
      : new Vector3(-dir.x, 0, -dir.z);
    if (n.lengthSquared() < 1e-4) n.copyFrom(dir);
    n.normalize();
    n.addInPlaceFromFloats(
      (Math.random() - 0.5) * 0.22,
      (Math.random() - 0.5) * 0.22,
      (Math.random() - 0.5) * 0.22,
    );
    n.normalize();

    // world -> локально в root (root крутится только по Y).
    const yaw = this.root.rotation.y;
    const cos = Math.cos(-yaw);
    const sin = Math.sin(-yaw);
    const lx = n.x * cos - n.z * sin;
    const lz = n.x * sin + n.z * cos;
    const surf = MOB.bodyRadius * 0.99;

    const mark = MeshBuilder.CreatePlane(
      "mobWound",
      { size: 0.22 + Math.random() * 0.1 },
      this.scene,
    );
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

  private _woundMat: StandardMaterial | null = null;
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
    m.zOffset = -2; // не мерцает на поверхности тела
    this._woundMat = m;
    return m;
  }

  private clearWounds(): void {
    for (const w of this.wounds) w.dispose();
    this.wounds.length = 0;
  }

  // колбэки последнего update, чтобы hit() мог их дёрнуть
  private ctxOnHurt?: (p: Vector3) => void;
  private ctxOnDie?: (p: Vector3, xp: number) => void;

  update(dt: number, ctx: MobContext): void {
    this.ctxOnHurt = ctx.onHurt;
    this.ctxOnDie = ctx.onDie;

    if (this.hurtCd > 0) this.hurtCd -= dt;
    if (this.attackCd > 0) this.attackCd -= dt;
    if (this.shoveCd > 0) this.shoveCd -= dt;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3);
    this.mat.emissiveColor.set(
      this.cfg.tint[0] * 0.28 + this.flash * 0.6,
      this.cfg.tint[1] * 0.2 + this.flash * 0.1,
      this.cfg.tint[2] * 0.32,
    );

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
      this.nameTag.setEnabled(false);
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
    const aggro = this.cfg.ranged ? SPITTER.aggroRange : MOB.aggroRange;
    // Внутри зоны — агрится; получил урон — тоже. Уходит из агра, только если
    // игрок надолго ушёл заметно дальше зоны (гистерезис, чтобы не мигало).
    if (dist < aggro) {
      this.aggroed = true;
      this.outOfRange = 0;
    } else if (this.aggroed && dist > aggro * 1.4) {
      this.outOfRange += dt;
      if (this.outOfRange > MOB.leash) this.aggroed = false;
    } else {
      this.outOfRange = 0;
    }
    const chasing = this.aggroed;

    // Плашка с именем — только для мобов рядом и примерно в поле зрения.
    // dir смотрит от моба к игроку; перед игроком -> dir ≈ -playerAim.
    const facing = dist < 1e-3 || Vector3.Dot(dir, ctx.playerAim) < 0.25;
    this.nameTag.setEnabled(dist < MOB.nameTagRange && facing);

    if (this.grounded) {
      this.hopCd -= dt;
      if (this.hopCd <= 0 && chasing) {
        this.hopCd = MOB.hopInterval;
        let hx = 0;
        let hz = 0;
        if (this.cfg.ranged) {
          // Держит дистанцию: близко — назад, далеко — вперёд, в норме — вбок.
          if (dist < SPITTER.keepDistance) {
            hx = -dir.x;
            hz = -dir.z;
          } else if (dist > SPITTER.fireRange) {
            hx = dir.x;
            hz = dir.z;
          } else {
            hx = -dir.z * (Math.random() < 0.5 ? 1 : -1);
            hz = dir.x * (Math.random() < 0.5 ? 1 : -1);
          }
        } else if (dist > MOB.attackRange * 0.7) {
          hx = dir.x;
          hz = dir.z;
        }
        if (hx !== 0 || hz !== 0) {
          this.vel.x = hx * MOB.hopSpeed;
          this.vel.z = hz * MOB.hopSpeed;
          this.vel.y = MOB.hopUp;
          this.grounded = false;
          ctx.onHop();
        }
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

    // --- не проходит сквозь игрока ---
    const gap = new Vector3(pos.x - ctx.playerPos.x, 0, pos.z - ctx.playerPos.z);
    const gd = gap.length();
    const clr = PLAYER.radius + MOB.bodyRadius;
    if (gd > 1e-4 && gd < clr) {
      const push = (clr - gd) / gd;
      pos.x += gap.x * push;
      pos.z += gap.z * push;
      const inward = (this.vel.x * gap.x + this.vel.z * gap.z) / gd;
      if (inward < 0) {
        this.vel.x -= (gap.x / gd) * inward;
        this.vel.z -= (gap.z / gd) * inward;
      }
    }

    if (chasing) this.root.rotation.y = Math.atan2(dir.x, dir.z);
    const stretch = 1 + this.vel.y * 0.04;
    const sq = Math.max(0.4, stretch);
    this.body.scaling.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));

    if (this.cfg.ranged) {
      if (chasing && dist < SPITTER.fireRange && this.attackCd <= 0) {
        this.attackCd = SPITTER.fireCooldown;
        const muzzle = this.center();
        ctx.fireBall(muzzle);
      }
    } else if (chasing && dist < MOB.attackRange && this.attackCd <= 0) {
      this.attackCd = MOB.attackCooldown;
      ctx.hurtPlayer(MOB.attackDamage, dir.clone(), this.root.getAbsolutePosition().clone());
      this.vel.addInPlace(dir.scale(-2));
    }
  }

  private respawnAt(): void {
    const a = Math.random() * Math.PI * 2;
    const r = 3 + Math.random() * MOB.wanderRadius;
    this.root.position.set(
      this.home.x + Math.cos(a) * r,
      this.home.y + 5,
      this.home.z + Math.sin(a) * r,
    );
    this.hp = this.maxHp;
    this.dead = false;
    this.aggroed = false;
    this.outOfRange = 0;
    this.vel.setAll(0);
    this.grounded = false;
    this.flash = 0;
    this.body.visibility = 1;
    this.body.scaling.setAll(1);
    this.head.setEnabled(true);
    this.nameTag.setEnabled(true);
    this.clearWounds();
    this.bar.set(1);
    this.bar.setVisible(false);
    this.barTimer = 0;
  }
}
