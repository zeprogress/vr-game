import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import "@babylonjs/core/Meshes/Builders/torusBuilder";

import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { Quaternion } from "@babylonjs/core/Maths/math.vector";

import { BOSS_CFG, MOB, SHARD_CFG, SLIME_CFG, SPITTER_CFG } from "#shared/constants";
import type { MobKind, MobState } from "#shared/net/schema";
import type { RigInstance } from "../world/models";
import { HealthBar3D } from "../ui/HealthBar3D";
import { NameTag } from "../ui/NameTag";
import type { WeaponKind } from "#shared/combat";
import type { Hittable, HitReporter } from "./Hittable";
import type { Sfx } from "../audio/Sfx";
import { BlobShadow } from "../world/blobShadow";

/** Доворот модели, чтобы её «перёд» (глаза) совпал с направлением взгляда
 *  моба. Подбор: `?myaw=<рад>`. (0 = −90° от исходного π/2.) */
const MODEL_YAW = (() => {
  const p = new URLSearchParams(location.search);
  const v = Number(p.get("myaw"));
  return p.has("myaw") && Number.isFinite(v) ? v : 0;
})();

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Перекрасить материалы модели: плоский цвет кинда, полупрозрачное желейное тело. */
function recolorRig(
  rig: RigInstance,
  kind: MobKind,
  tint: readonly [number, number, number],
  alpha: number,
): void {
  for (const m of rig.meshes) {
    const src = m.material as { name?: string } | null;
    if (!src) continue;
    const name = src.name ?? "";
    const flat = new StandardMaterial(`${kind}_${name}`, rig.root.getScene());
    // 5 = небо + солнце + два факела ботов + ближайший светлячок.
    flat.maxSimultaneousLights = 5;
    m.material = flat;

    if (/eye/i.test(name)) {
      flat.diffuseColor = new Color3(0.02, 0.02, 0.02);
      flat.specularColor = new Color3(0.12, 0.12, 0.12);
      continue;
    }
    // secondary — светлее (блик/пузики), primary — базовый цвет кинда
    const k = /secondary/i.test(name) ? 1.4 : 1;
    flat.diffuseColor = new Color3(clamp01(tint[0] * k), clamp01(tint[1] * k), clamp01(tint[2] * k));
    flat.emissiveColor = new Color3(tint[0] * 0.14, tint[1] * 0.1, tint[2] * 0.16);
    flat.specularColor = new Color3(0.06, 0.06, 0.06);
    // Полупрозрачное тело одним слоем: изнанку не рисуем (иначе «слоёный пирог»).
    flat.alpha = alpha;
    flat.backFaceCulling = true;
  }
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

  private readonly tint: readonly [number, number, number];
  private readonly bodyAlpha: number;
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
  /** Размер тела (босс — крупнее). Приходит из состояния. */
  private scale = 1;
  private lastSlamSeq = 0;
  private slamRing: Mesh | null = null;
  private slamRingT = 0;
  private ragePulse = 0;

  /** Модель из пака (если подключена): она заменяет процедурную сферу. */
  private rig: RigInstance | null = null;
  /** Узел, который тянем/сжимаем в прыжке: сфера или корень модели. */
  private squash: TransformNode;
  private curAnim: AnimationGroup | null = null;

  private readonly isBoss: boolean;

  constructor(
    private readonly scene: Scene,
    readonly kind: MobKind,
    readonly id: string,
    private readonly sfx: Sfx,
    private readonly report: HitReporter,
    /** true — облегчённый вид (стрим на слабом GPU): непрозрачное тело,
     *  без плашки имени, полоски HP и ран. Глаза оставляем — с ними живее. */
    private readonly lean = false,
  ) {
    const opaque = this.lean;
    const cfg =
      kind === "spitter"
        ? SPITTER_CFG
        : kind === "boss"
          ? BOSS_CFG
          : kind === "shard"
            ? SHARD_CFG
            : SLIME_CFG;
    this.tint = cfg.tint;
    this.bodyAlpha = cfg.alpha;
    this.isBoss = kind === "boss";

    this.root = new TransformNode("mob", scene);

    this.mat = new StandardMaterial("mobMat", scene);
    this.mat.diffuseColor = new Color3(...cfg.tint);
    this.mat.emissiveColor = new Color3(cfg.tint[0] * 0.28, cfg.tint[1] * 0.2, cfg.tint[2] * 0.32);
    this.mat.specularColor = new Color3(0.4, 0.3, 0.4);
    // Полупрозрачное тело одним слоем: изнанку сферы не рисуем, иначе
    // передняя и задняя половины смешиваются и получается «слоёный пирог».
    // opaque — слабый GPU (стрим): непрозрачное тело без смешивания и
    // сортировки. Слизень выглядит плотным, зато почти бесплатно по заполнению.
    this.mat.alpha = opaque ? 1 : cfg.alpha;
    this.mat.backFaceCulling = true;

    this.body = MeshBuilder.CreateSphere("mobBody", { diameter: MOB.bodyRadius * 2, segments: 8 }, scene);
    this.body.material = this.mat;
    this.body.parent = this.root;
    this.body.position.y = MOB.bodyRadius;
    this.body.isPickable = false;
    this.squash = this.body;

    this.head = new TransformNode("mobHead", scene);
    this.head.parent = this.root;
    this.head.position.y = MOB.bodyRadius;

    const eyeMat = new StandardMaterial("mobEye", scene);
    if (this.isBoss) {
      // Провалы вместо глаз — угольно-чёрные, без бликов и подсветки.
      eyeMat.diffuseColor = new Color3(0, 0, 0);
      eyeMat.emissiveColor = new Color3(0, 0, 0);
      eyeMat.specularColor = new Color3(0, 0, 0);
      eyeMat.disableLighting = true;
    } else {
      eyeMat.diffuseColor = new Color3(0.02, 0.02, 0.02);
      eyeMat.specularColor = new Color3(0.15, 0.15, 0.15);
    }
    const eyeY = cfg.ranged ? 0.05 : this.isBoss ? 0.13 : 0.15;
    for (const dx of [-0.18, 0.18]) {
      const eye = MeshBuilder.CreateSphere("mobEye", { diameter: this.isBoss ? 0.2 : 0.17, segments: 6 }, scene);
      eye.material = eyeMat;
      eye.parent = this.head;
      eye.position.set(dx, eyeY, MOB.bodyRadius * 0.99);
      eye.isPickable = false;
      if (this.isBoss) {
        // Насупленная бровь: тёмный клин, наклонён к переносице.
        const brow = MeshBuilder.CreateBox("mobBrow", { width: 0.28, height: 0.09, depth: 0.1 }, scene);
        const bm = new StandardMaterial("mobBrowMat", scene);
        bm.diffuseColor = new Color3(0.05, 0.01, 0.02);
        bm.specularColor = new Color3(0, 0, 0);
        brow.material = bm;
        brow.parent = this.head;
        brow.position.set(dx * 0.95, eyeY + 0.16, MOB.bodyRadius * 0.98);
        brow.rotation.z = dx < 0 ? -0.5 : 0.5; // внешние края вверх, к носу — вниз
        brow.isPickable = false;
      }
    }

    this.hitAnchor = new TransformNode("mobHitAnchor", scene);
    this.hitAnchor.parent = this.root;
    this.hitAnchor.position.y = MOB.bodyRadius;

    // Полоса и плашка висят на отдельном узле: у босса тело крупное, а надписи
    // должны оставаться обычного размера — этот узел компенсирует масштаб.
    this.uiAnchor = new TransformNode("mobUi", scene);
    this.shadow = new BlobShadow(scene, id);
    this.uiAnchor.parent = this.root;

    this.bar = new HealthBar3D(
      scene,
      this.uiAnchor,
      new Vector3(0, MOB.bodyRadius * 2 + 0.35, 0),
      0.7,
    );
    this.bar.set(1);
    this.bar.setVisible(false);

    this.nameTag = new NameTag(
      scene,
      this.uiAnchor,
      new Vector3(0, MOB.bodyRadius * 2 + 0.78, 0),
      cfg.name,
      cfg.level,
      kind === "boss"
        ? new Color3(1, 0.3, 0.3)
        : cfg.ranged
          ? new Color3(1, 0.6, 0.25)
          : new Color3(0.85, 0.9, 1),
    );

    // Модель из пака вместо сферы — для слизней/плевунов/босса, не в lean-режиме
    // (на стриме слабый GPU не потянет ~9 скелетов). Сферу и глаза прячем СРАЗУ
    // (синхронно), чтобы не было кадров с двумя моделями внахлёст; если модель
    // не загрузится — вернём сферу в catch attachModel().
    if (!this.lean && (kind === "slime" || kind === "spitter" || kind === "boss")) {
      this.body.setEnabled(false);
      this.head.setEnabled(false);
      void this.attachModel();
    }
  }

  private readonly uiAnchor: TransformNode;
  /** Пятно-тень под мобом: без неё прыжок читается как парение. */
  private readonly shadow: BlobShadow;

  /** Подменить процедурную сферу моделью слизня из пака. */
  private async attachModel(): Promise<void> {
    let make: () => RigInstance;
    try {
      const { loadRig } = await import("../world/models");
      // Без smoothNormals: пересчёт нормалей ломал их направление на модели из
      // FBX (свет ложился «снизу»). Берём нормали как в файле.
      make = await loadRig(this.scene, "slime");
    } catch {
      // модель не загрузилась — возвращаем процедурную сферу
      if (!this.root.isDisposed() && !this.dead) {
        this.body.setEnabled(true);
        this.head.setEnabled(true);
      }
      return;
    }
    if (this.root.isDisposed()) return;

    const rig = make();
    this.rig = rig;

    // Свой узел-обёртка: масштаб и доворот держим здесь, трансформы самой
    // модели (её пересчёт системы координат из FBX) не трогаем.
    const holder = new TransformNode("mobModel", this.scene);
    holder.parent = this.root;
    holder.rotationQuaternion = Quaternion.RotationYawPitchRoll(MODEL_YAW, 0, 0);
    rig.root.parent = holder;
    rig.root.position.set(0, 0, 0);

    // Высота модели ≈ ~1.75 радиуса тела (модель слизня приземистее сферы;
    // на s.scale для босса домножается через this.root отдельно).
    const base = (MOB.bodyRadius * 1.75) / rig.nativeHeight;
    holder.scaling.setAll(base);

    recolorRig(rig, this.kind, this.tint, this.bodyAlpha);

    // Процедурная сфера с глазами больше не нужна — сносим совсем.
    this.body.dispose();
    this.head.dispose(false, true);
    this.squash = holder;
    this.baseModelScale = base;

    // «Hop» проигрываем только в прыжке (см. applyState), в покое — статика.
  }

  private baseModelScale = 1;

  // ---- Hittable ----

  get alive(): boolean {
    return !this.dead;
  }

  hitSegment(): { a: Vector3; b: Vector3; radius: number } {
    const p = this.root.getAbsolutePosition();
    const sc = this.scale;
    return {
      a: p.add(new Vector3(0, 0.1, 0)),
      b: p.add(new Vector3(0, MOB.bodyRadius * 2 * sc, 0)),
      radius: MOB.hitRadius * sc,
    };
  }

  hitNode(): TransformNode {
    return this.hitAnchor;
  }

  center(): Vector3 {
    return this.root.getAbsolutePosition().add(new Vector3(0, MOB.bodyRadius * this.scale, 0));
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

    if (s.scale > 0 && s.scale !== this.scale) {
      this.scale = s.scale;
      this.root.scaling.setAll(s.scale);
      this.uiAnchor.scaling.setAll(1 / s.scale);
      // Поднимаем ровно на прибавку высоты от увеличения тела (в мировых
      // единицах это position.y * scale), не больше — иначе плашка улетает.
      this.uiAnchor.position.y = (MOB.bodyRadius * 2 * (s.scale - 1)) / s.scale;
    }

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
    // Пятно остаётся на земле, пока моб в прыжке — по нему видно высоту.
    if (!this.dead) {
      this.shadow.place(pos.x, pos.y, pos.z, MOB.bodyRadius * this.scale * 1.15);
    }

    // урон: hurtSeq вырос -> вспышка + рана + звук
    if (s.hurtSeq !== this.lastHurtSeq) {
      this.lastHurtSeq = s.hurtSeq;
      this.flash = 1;
      if (!this.lean) {
        this.barTimer = 3;
        this.bar.set(Math.max(0, s.hp) / s.maxHp);
        this.bar.setOpacity(1);
      }
      if (!s.dead) {
        this.playIfNear(playerPos, () => this.sfx.mobHurt(pos));
      }
    }

    if (this.barTimer > 0 && !this.lean) {
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
      this.shadow.setEnabled(false);
      if (this.rig) this.playAnim(this.rig.anims.get("death"), false);
      this.playIfNear(playerPos, () => this.sfx.mobDie(pos));
    } else if (!s.dead && this.dead) {
      this.dead = false;
      this.shadow.setEnabled(true);
      this.setBodyVisibility(1);
      this.setSquash(1, 1, 1);
      if (!this.rig) this.head.setEnabled(true);
      this.nameTag.setEnabled(true);
      this.bar.setVisible(false);
      this.barTimer = 0;
      this.stopAnim();
    }

    if (this.dead) {
      this.deathT += dt;
      if (!this.rig) this.head.setEnabled(false);
      this.bar.setVisible(false);
      this.nameTag.setEnabled(false);
      this.prevY = pos.y;
      if (this.rig) {
        // Даём проиграть Slime_Death, затем прячем.
        if (this.deathT > 0.9) this.setBodyVisibility(Math.max(0, 1 - (this.deathT - 0.9) * 3));
      } else {
        const k = Math.min(1, this.deathT / 0.4);
        this.setSquash(1 + k, Math.max(0.05, 1 - k), 1 + k);
        this.setBodyVisibility(1 - k);
      }
      return;
    }

    // сжатие в прыжке — по вертикальной скорости
    const vy = dt > 1e-4 ? (pos.y - this.prevY) / dt : 0;
    this.prevY = pos.y;
    const sq = Math.max(0.4, 1 + vy * 0.04);
    if (this.isBoss && s.charging) {
      // Телеграф рывка: босс вытягивается вперёд по направлению взгляда,
      // сжимаясь с боков, и наливается багровым.
      const w = Math.max(0.35, s.windup);
      this.setSquash(Math.max(0.5, 1 - w * 0.3), Math.max(0.6, 1 - w * 0.2), 1 + w * 0.7);
      this.flash = Math.max(this.flash, 0.35 + w * 0.35);
    } else if (this.isBoss && s.windup > 0) {
      // Телеграф слэма: босс приседает и раздувается вширь.
      const w = s.windup;
      this.setSquash(1 + w * 0.4, Math.max(0.45, 1 - w * 0.45), 1 + w * 0.4);
      this.flash = Math.max(this.flash, w * 0.5);
    } else {
      this.setSquash(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    }

    // «Hop» — только пока моб в воздухе (серверный признак grounded); на земле
    // модель статична (желейное сжатие даёт setSquash по вертикальной скорости).
    if (this.rig && !this.dead) {
      if (s.grounded === 0) this.playAnim(this.rig.anims.get("hop"), true);
      else this.stopAnim();
    }

    // Слэм: ++slamSeq -> ударная волна по земле + грохот.
    if (this.isBoss && s.slamSeq !== this.lastSlamSeq) {
      this.lastSlamSeq = s.slamSeq;
      this.startSlamRing();
      this.playIfNear(playerPos, () => {
        this.sfx.at(pos, () => {
          this.sfx.hitThud(1.5);
          this.sfx.land(1.3);
        });
      }, 30);
    }
    if (this.slamRingT > 0) this.animateSlamRing(dt);

    // Ярость: пульсирующее багровое свечение.
    if (this.isBoss && s.enraged) {
      this.ragePulse += dt * 6;
      this.flash = Math.max(this.flash, 0.25 + Math.sin(this.ragePulse) * 0.15);
    }

    if (s.grounded === 0 && this.grounded) this.playIfNear(playerPos, () => this.sfx.mobHop(pos), 20);
    this.grounded = s.grounded === 1;

    // Облегчённый вид (стрим): без плашки и полоски HP — их рисует оверлей страницы.
    if (this.lean) return;

    // плашка — только рядом и примерно в поле зрения
    const toMob = new Vector3(pos.x - playerPos.x, 0, pos.z - playerPos.z);
    const md = toMob.length();
    const facing = md < 1e-3 || Vector3.Dot(toMob.scale(1 / md), playerAim) > -0.25;
    const near = md < MOB.nameTagRange && facing;
    this.nameTag.setEnabled(near);
    if (near) {
      // Издалека плашку не разобрать, поэтому на дальней границе она ×4,
      // а по мере приближения плавно ужимается до ×2.
      const t = Math.min(1, Math.max(0, (md - 6) / (MOB.nameTagRange - 6)));
      this.nameTag.setScale(2 + t * 2);
    }
  }

  private playIfNear(playerPos: Vector3, fn: () => void, range = 28): void {
    if (Vector3.DistanceSquared(this.root.getAbsolutePosition(), playerPos) < range * range) fn();
  }

  /** Сжатие/растяжение тела. Для модели домножаем на её базовый масштаб. */
  private setSquash(x: number, y: number, z: number): void {
    const b = this.rig ? this.baseModelScale : 1;
    this.squash.scaling.set(x * b, y * b, z * b);
  }

  private setBodyVisibility(v: number): void {
    if (this.rig) {
      for (const m of this.rig.meshes) m.visibility = v;
    } else {
      this.body.visibility = v;
    }
  }

  private playAnim(g: AnimationGroup | undefined | null, loop: boolean): void {
    if (!g || g === this.curAnim) return;
    this.curAnim?.stop();
    g.start(loop, 1, g.from, g.to, false);
    this.curAnim = g;
  }

  /** Остановить анимацию и вернуть модель в исходную позу. */
  private stopAnim(): void {
    if (!this.curAnim) return;
    this.curAnim.stop();
    this.curAnim.reset();
    this.curAnim = null;
  }

  /** Ударная волна слэма: плоское кольцо на земле, разбегается и гаснет. */
  private startSlamRing(): void {
    if (!this.slamRing) {
      const m = MeshBuilder.CreateTorus(
        "bossSlam",
        { diameter: 2, thickness: 0.18, tessellation: 24 },
        this.scene,
      );
      const mat = new StandardMaterial("bossSlamMat", this.scene);
      mat.emissiveColor = new Color3(1, 0.35, 0.2);
      mat.diffuseColor = new Color3(0, 0, 0);
      mat.disableLighting = true;
      mat.alpha = 0.9;
      m.material = mat;
      m.isPickable = false;
      m.rotation.x = Math.PI / 2;
      m.parent = this.root;
      this.slamRing = m;
    }
    this.slamRing.setEnabled(true);
    this.slamRing.scaling.setAll(0.3);
    (this.slamRing.material as StandardMaterial).alpha = 0.9;
    this.slamRingT = 0.45;
  }

  private animateSlamRing(dt: number): void {
    if (!this.slamRing) return;
    this.slamRingT -= dt;
    const k = 1 - Math.max(0, this.slamRingT) / 0.45;
    // Радиус слэма ~5 м; кольцо-меш базово 2 м -> масштаб до ~5.
    this.slamRing.scaling.setAll(0.3 + k * 4.7);
    (this.slamRing.material as StandardMaterial).alpha = 0.9 * (1 - k);
    if (this.slamRingT <= 0) this.slamRing.setEnabled(false);
  }

  dispose(): void {
    this.shadow.dispose();
    this.nameTag.dispose();
    this.bar.dispose();
    this.slamRing?.material?.dispose();
    this.rig?.dispose();
    this.rig = null;
    this.root.dispose(false, true);
  }
}
