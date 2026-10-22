import type { Scene } from "@babylonjs/core/scene";
import { turnClip, turnToward } from "./turnSteps";
import { secNow, secAdd, secCount } from "../engine/secProf";
import { createPinArrows } from "./PinArrows";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Constants } from "@babylonjs/core/Engines/constants";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import "@babylonjs/core/Meshes/instancedMesh";
import { groundFxThrough } from "../ui/groundFx";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { createBurnFlameMesh, makeBurnFlameMaterial } from "../world/BurnFlameMat";
import { BurnParticles, FIRE_PARTICLES } from "./BurnParticles";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import "@babylonjs/core/Meshes/Builders/torusBuilder";

import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { Quaternion } from "@babylonjs/core/Maths/math.vector";

import { BOSS_CFG, SLIME_CFG, SPITTER_CFG } from "#shared/mobs";
import { DRAGON, ELITE_MOBS, FLYER_HIT_BONUS, ICE_GIANT, LAVA, MAGE_NOVA, MOB, MOB_SWING, SHARD_CFG, type EliteMobDef } from "#shared/mobs";
import { DECAL, IceFx, SHARD, type IceAura } from "../ui/IceFx";
import { FireFx, FLAME, type FireAura } from "../ui/FireFx";
import { DUST, LordFeet, lordMouth, lordScale, lordStep } from "../ui/DragonAct";
import { FXC } from "../ui/fxColors";
import type { MobKind, MobState } from "#shared/net/schema";
import type { RigInstance, ModelName } from "../world/models";
import { HealthBar3D } from "../ui/HealthBar3D";
import { difficultyRgb } from "../pc/difficulty";
import { NameTag } from "../ui/NameTag";
import { modelLight, trackMobMaterial } from "./mobLightTune";
import { feetCentre, type MeshVerts } from "#shared/feetCentre";
import { daylightAt } from "../world/DayTime";
import { LOADOUT } from "../config/loadout";
import { sharedMobMaterial } from "./mobMaterials";
import { instanceSlime, type SlimeInstances } from "./slimeInstances";
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
/** Клипы видов замаха босса (MOB_SWING): имя в rig (нижний регистр) и длительность, с. Укус — обычный atkClip. */
const SWING_ANIM: Record<number, { clip: string; sec: number }> = {
  // Драконы (DRAGON — длины клипов Владыки Бездны; у огнекрылого клипы те же по смыслу).
  [MOB_SWING.claw]: { clip: "attackclaw", sec: DRAGON.clipSec.claw },
  [MOB_SWING.tail]: { clip: "attacktail", sec: DRAGON.clipSec.tail },
  [MOB_SWING.breath]: { clip: "attackbreath", sec: DRAGON.clipSec.breath },
  [MOB_SWING.wings]: { clip: "attackwings", sec: DRAGON.clipSec.wings },
  [MOB_SWING.magic]: { clip: "magiccharge", sec: DRAGON.clipSec.charge },
  // Ледяной гигант (ICE_GIANT): удар левой, раскол, бросок глыбы, разлом, рёв.
  [MOB_SWING.swipe2]: { clip: "attack2", sec: ICE_GIANT.clipSec.attack },
  [MOB_SWING.slam]: { clip: "slam", sec: ICE_GIANT.clipSec.slam },
  [MOB_SWING.throw]: { clip: "throw", sec: ICE_GIANT.clipSec.throw },
  [MOB_SWING.fissure]: { clip: "fissure", sec: ICE_GIANT.clipSec.fissure },
  [MOB_SWING.roar]: { clip: "roar", sec: ICE_GIANT.clipSec.roar },
  // Лавовый монстр (LAVA): удар о землю, разлив магмы, рёв ярости (Страж); метка и кольцо (Маг).
  [MOB_SWING.lavaSlam]: { clip: "slam", sec: LAVA.clipSec.slam },
  [MOB_SWING.lavaSpill]: { clip: "spill", sec: LAVA.clipSec.spill },
  [MOB_SWING.lavaRoar]: { clip: "roar", sec: LAVA.clipSec.roar },
  [MOB_SWING.lavaMark]: { clip: "mark", sec: LAVA.clipSec.mark },
  [MOB_SWING.lavaRing]: { clip: "ring", sec: LAVA.clipSec.ring },
};
/** EliteMobDef.gait: медленнее — стойка (Idle), быстрее — бег (Run), между — шаг (Walk), м/с. */
const GAIT_IDLE_SPEED = 0.5;
const GAIT_RUN_SPEED = 2.2;
/** Скорость, при которой клип бега идёт с обычным темпом; быстрее/медленнее — темп клипа пропорционально (шаг под ногу). */
const RUN_CLIP_SPEED = 9;

/** Длительность процедурного замаха моба, с. */
const ATTACK_DUR = 0.36;

/** Перекрасить материалы модели: плоский цвет кинда, полупрозрачное желейное тело. */
function recolorRig(
  rig: RigInstance,
  kind: MobKind,
  tint: readonly [number, number, number],
  alpha: number,
  /** Без собственного свечения (осколки големов). */
  noGlow = false,
): void {
  const scene = rig.root.getScene();
  for (const m of rig.meshes) {
    const src = m.material as { name?: string } | null;
    if (!src) continue;
    const name = src.name ?? "";
    m.material = sharedMobMaterial(scene, `${kind}|${name}|${tint.join(",")}|${alpha}|${noGlow ? 1 : 0}`, () => {
      const flat = new StandardMaterial(`${kind}_${name}`, scene);
      flat.maxSimultaneousLights = 1;
      if (/eye/i.test(name)) {
        flat.diffuseColor = new Color3(0.02, 0.02, 0.02);
        flat.specularColor = new Color3(0.12, 0.12, 0.12);
        return flat;
      }
      // secondary — светлее (блик/пузики), primary — базовый цвет кинда
      const k = /secondary/i.test(name) ? 1.4 : 1;
      flat.diffuseColor = new Color3(clamp01(tint[0] * k), clamp01(tint[1] * k), clamp01(tint[2] * k));
      // Слизень, плевун и багровый — чуть больше прежнего свечения (было 0.14/0.1/0.16); осколки — как были.
      flat.emissiveColor =
        kind === "shard"
          ? new Color3(tint[0] * 0.14, tint[1] * 0.1, tint[2] * 0.16)
          : new Color3(tint[0] * 0.2, tint[1] * 0.15, tint[2] * 0.23);
      flat.specularColor = new Color3(0.06, 0.06, 0.06);
      // Полупрозрачное тело одним слоем: изнанку не рисуем (иначе «слоёный пирог»).
      flat.alpha = alpha;
      flat.backFaceCulling = true;
      trackMobMaterial(flat); // ?moblight=1 — живая подстройка поверх базовых цветов
      return flat;
    });
  }
}


/**
 * Моб — ВИД (этап 6). Позиция/hp/смерть приходят из состояния сервера,
 * клиент интерполирует и играет вспышки, раны, сжатие, звуки. Попадания
 * игрока по мобу считает клиент и репортит серверу через `report`.
 */

/**
 * Дальний LOD моба: упрощённая копия САМОЙ модели без скелета (≈200 треугольников),
 * а не сфера — чтобы силуэт (рога, руки, крылья) читался издали. Геометрия
 * берётся из позы покоя реальной модели и схлопывается кластеризацией вершин по
 * сетке; материал — копия материала модели (текстура-атлас, цвета). Источник один
 * на вид моба, у каждого моба — инстансы (один draw call на вид).
 */
const lodCache = new Map<string, Mesh[] | null>();

/**
 * Дальние мобы (LOD) — тонкие инстансы (thin instances) на общем мешe-источнике вида: раньше у каждого
 * дальнего моба было по InstancedMesh на деталь, и на каждый шёл пересчёт матрицы и регистрация в кадре
 * (десятки узлов). Теперь слот — 16 чисел в буфере, который грузится на GPU одним вызовом раз в кадр.
 * Пока слотов нет — сам меш-источник отключён (иначе он рисовался бы один раз в нуле координат).
 */
class LodBatch {
  private buf = new Float32Array(32 * 16);
  private cap = 32;
  private used = 0;
  private readonly free: number[] = [];
  private readonly on = new Set<number>();
  private dirty = false;

  constructor(private readonly mesh: Mesh) {
    mesh.isVisible = true;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.thinInstanceSetBuffer("matrix", this.buf, 16, false);
    mesh.thinInstanceCount = 0;
    mesh.setEnabled(false);
    mesh.getScene().onBeforeRenderObservable.add(() => {
      if (!this.dirty) return;
      this.dirty = false;
      mesh.thinInstanceCount = this.used;
      mesh.thinInstanceBufferUpdated("matrix");
      mesh.setEnabled(this.on.size > 0);
    });
  }

  acquire(): number {
    const slot = this.free.pop() ?? this.used++;
    if (slot >= this.cap) {
      this.cap *= 2;
      const nb = new Float32Array(this.cap * 16);
      nb.set(this.buf);
      this.buf = nb;
      this.mesh.thinInstanceSetBuffer("matrix", nb, 16, false);
    }
    this.buf.fill(0, slot * 16, slot * 16 + 16);
    this.dirty = true;
    return slot;
  }

  /** Показать слот с матрицей мира `m` (true) или спрятать (false). */
  set(slot: number, on: boolean, m?: Matrix): void {
    if (on && m) {
      m.copyToArray(this.buf, slot * 16);
      this.on.add(slot);
    } else {
      this.buf.fill(0, slot * 16, slot * 16 + 16);
      this.on.delete(slot);
    }
    this.dirty = true;
  }

  release(slot: number): void {
    this.set(slot, false);
    this.free.push(slot);
  }
}

const lodBatches = new WeakMap<Mesh, LodBatch>();
function lodBatchOf(src: Mesh): LodBatch {
  let b = lodBatches.get(src);
  if (!b) lodBatches.set(src, (b = new LodBatch(src)));
  return b;
}

function lodBuild(scene: Scene, key: string, rigMeshes: AbstractMesh[], root: TransformNode): Mesh[] | null {
  root.computeWorldMatrix(true);
  const inv = root.getWorldMatrix().clone().invert();
  interface Grp { mat: StandardMaterial; pos: number[]; uv: number[]; idx: number[] }
  const groups = new Map<unknown, Grp>();
  const tmp = new Vector3();
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const m of rigMeshes) {
    const src = (m.isAnInstance ? (m as InstancedMesh).sourceMesh : m) as Mesh;
    const pos = src.getVerticesData(VertexBuffer.PositionKind);
    const idx = src.getIndices();
    const mat = m.material as StandardMaterial | null;
    if (!pos || !idx || !mat) continue;
    const uv = src.getVerticesData(VertexBuffer.UVKind);
    m.computeWorldMatrix(true);
    const W = m.getWorldMatrix().multiply(inv);
    // Скинненый меш: берём позу, в которой моб реально стоит сейчас (покой после
    // stopAnim), а не «позу привязки» — у слизня они разные (сплющивание по фазе).
    const sk = m.skeleton ?? src.skeleton;
    let skin: Float32Array | null = null;
    let mi: Float32Array | null = null;
    let mw: Float32Array | null = null;
    let mie: Float32Array | null = null;
    let mwe: Float32Array | null = null;
    if (sk) {
      sk.prepare(true);
      skin = sk.getTransformMatrices(m);
      mi = src.getVerticesData(VertexBuffer.MatricesIndicesKind) as Float32Array | null;
      mw = src.getVerticesData(VertexBuffer.MatricesWeightsKind) as Float32Array | null;
      mie = src.getVerticesData(VertexBuffer.MatricesIndicesExtraKind) as Float32Array | null;
      mwe = src.getVerticesData(VertexBuffer.MatricesWeightsExtraKind) as Float32Array | null;
    }
    let g = groups.get(mat);
    if (!g) {
      g = { mat, pos: [], uv: [], idx: [] };
      groups.set(mat, g);
    }
    const base = g.pos.length / 3;
    for (let i = 0; i < pos.length; i += 3) {
      let px = pos[i];
      let py = pos[i + 1];
      let pz = pos[i + 2];
      if (skin && mi && mw) {
        const vi4 = (i / 3) * 4;
        let sx = 0, sy = 0, sz = 0, wsum = 0;
        for (let k = 0; k < 8; k++) {
          const ex = k >= 4;
          const idxArr = ex ? mie : mi;
          const wArr = ex ? mwe : mw;
          if (!idxArr || !wArr) continue;
          const w = wArr[vi4 + (k & 3)];
          if (!w) continue;
          const o = idxArr[vi4 + (k & 3)] * 16;
          sx += w * (px * skin[o] + py * skin[o + 4] + pz * skin[o + 8] + skin[o + 12]);
          sy += w * (px * skin[o + 1] + py * skin[o + 5] + pz * skin[o + 9] + skin[o + 13]);
          sz += w * (px * skin[o + 2] + py * skin[o + 6] + pz * skin[o + 10] + skin[o + 14]);
          wsum += w;
        }
        if (wsum > 0.001) {
          px = sx;
          py = sy;
          pz = sz;
        }
      }
      Vector3.TransformCoordinatesFromFloatsToRef(px, py, pz, W, tmp);
      g.pos.push(tmp.x, tmp.y, tmp.z);
      if (tmp.y < minY) minY = tmp.y;
      if (tmp.y > maxY) maxY = tmp.y;
      if (tmp.x < minX) minX = tmp.x;
      if (tmp.x > maxX) maxX = tmp.x;
      if (tmp.z < minZ) minZ = tmp.z;
      if (tmp.z > maxZ) maxZ = tmp.z;
      const vi = i / 3;
      g.uv.push(uv ? uv[vi * 2] : 0, uv ? uv[vi * 2 + 1] : 0);
    }
    for (let i = 0; i < idx.length; i++) g.idx.push(idx[i] + base);
  }
  if (groups.size === 0) return null;
  // Проверка адекватности: поза покоя должна давать модель ожидаемой высоты,
  // стоящую на земле, иначе (скелет тянет вершины иначе) — откат на сферу.
  const expect = MOB.bodyRadius * 1.75;
  const h = maxY - minY;
  if (!(h > expect * 0.4 && h < expect * 2.2)) return null;
  if (Math.abs((minX + maxX) / 2) > expect * 1.5 || Math.abs((minZ + maxZ) / 2) > expect * 1.5) return null;

  // Кластеризация: увеличиваем ячейку, пока суммарно не уложимся в ~650 треугольников.
  const size = Math.max(maxX - minX, h, maxZ - minZ);
  let cell = size / 26;
  type Out = { pos: number[]; uv: number[]; idx: number[] };
  const cluster = (g: Grp, c: number): Out => {
    const cellOf = new Map<number, number>();
    const sum: number[] = []; // x,y,z,u,v,count
    const remap = new Int32Array(g.pos.length / 3);
    for (let i = 0; i < remap.length; i++) {
      const ix = Math.floor((g.pos[i * 3] - minX) / c);
      const iy = Math.floor((g.pos[i * 3 + 1] - minY) / c);
      const iz = Math.floor((g.pos[i * 3 + 2] - minZ) / c);
      const k = (ix * 1024 + iy) * 1024 + iz;
      let ci = cellOf.get(k);
      if (ci === undefined) {
        ci = sum.length / 6;
        cellOf.set(k, ci);
        sum.push(0, 0, 0, 0, 0, 0);
      }
      remap[i] = ci;
      sum[ci * 6] += g.pos[i * 3];
      sum[ci * 6 + 1] += g.pos[i * 3 + 1];
      sum[ci * 6 + 2] += g.pos[i * 3 + 2];
      sum[ci * 6 + 3] += g.uv[i * 2];
      sum[ci * 6 + 4] += g.uv[i * 2 + 1];
      sum[ci * 6 + 5] += 1;
    }
    const pos: number[] = [];
    for (let ci = 0; ci < sum.length / 6; ci++) {
      const n = sum[ci * 6 + 5];
      pos.push(sum[ci * 6] / n, sum[ci * 6 + 1] / n, sum[ci * 6 + 2] / n);
    }
    // UV — у ближайшей к центру ячейки настоящей вершины (усреднение размазывало цвета
    // атласа между соседними частями модели).
    const uv: number[] = new Array((sum.length / 6) * 2).fill(0);
    const best = new Float32Array(sum.length / 6).fill(Infinity);
    for (let i = 0; i < remap.length; i++) {
      const ci = remap[i];
      const dx = g.pos[i * 3] - pos[ci * 3];
      const dy = g.pos[i * 3 + 1] - pos[ci * 3 + 1];
      const dz = g.pos[i * 3 + 2] - pos[ci * 3 + 2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < best[ci]) {
        best[ci] = d;
        uv[ci * 2] = g.uv[i * 2];
        uv[ci * 2 + 1] = g.uv[i * 2 + 1];
      }
    }
    const idx: number[] = [];
    const seen = new Set<string>();
    for (let t = 0; t < g.idx.length; t += 3) {
      const a = remap[g.idx[t]], b = remap[g.idx[t + 1]], c2 = remap[g.idx[t + 2]];
      if (a === b || b === c2 || a === c2) continue;
      const key3 = [a, b, c2].sort((x, y) => x - y).join(",");
      if (seen.has(key3)) continue;
      seen.add(key3);
      idx.push(a, b, c2);
    }
    return { pos, uv, idx };
  };
  let outs: Out[] = [];
  for (let it = 0; it < 30; it++) {
    outs = [...groups.values()].map((g) => cluster(g, cell));
    const tris = outs.reduce((n, o) => n + o.idx.length / 3, 0);
    if (tris <= 650) break;
    cell *= 1.18;
  }
  const srcs: Mesh[] = [];
  let gi = 0;
  for (const g of groups.values()) {
    const o = outs[gi++];
    if (o.idx.length < 9) continue;
    const mesh = new Mesh(`mobLod_${key}_${gi}`, scene);
    const vd = new VertexData();
    vd.positions = o.pos;
    vd.indices = o.idx;
    vd.uvs = o.uv;
    const nor: number[] = [];
    VertexData.ComputeNormals(o.pos, o.idx, nor);
    vd.normals = nor;
    vd.applyToMesh(mesh);
    const mat = new StandardMaterial(`mobLodMat_${key}_${gi}`, scene);
    mat.diffuseTexture = g.mat.diffuseTexture;
    mat.emissiveTexture = g.mat.emissiveTexture;
    mat.diffuseColor = g.mat.diffuseColor?.clone() ?? new Color3(0.7, 0.7, 0.7);
    mat.emissiveColor = g.mat.emissiveColor?.clone() ?? new Color3(0.2, 0.2, 0.2);
    mat.specularColor = new Color3(0, 0, 0);
    mat.backFaceCulling = false;
    // Полупрозрачные слизни и вдали полупрозрачные (одним слоем — изнанку не рисуем).
    if (g.mat.alpha < 1) {
      mat.alpha = g.mat.alpha;
      mat.backFaceCulling = true;
    }
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.isVisible = false; // инстансы остаются видимыми
    srcs.push(mesh);
  }
  return srcs.length ? srcs : null;
}

/** Запасной вариант, если у модели нет вменяемой позы покоя: сфера (как раньше). */
function lodSphere(scene: Scene, tint: readonly [number, number, number]): Mesh[] {
  const key = tint.map((v) => v.toFixed(2)).join(",");
  const cached = lodCache.get(`sphere|${key}`);
  if (cached && !cached[0].isDisposed()) return cached;
  const src = MeshBuilder.CreateSphere(`mobLodSrc_${key}`, { diameter: MOB.bodyRadius * 2, segments: 6 }, scene);
  src.position.y = 0;
  src.bakeCurrentTransformIntoVertices();
  const v = src.getVerticesData(VertexBuffer.PositionKind);
  if (v) {
    for (let i = 1; i < v.length; i += 3) v[i] += MOB.bodyRadius;
    src.setVerticesData(VertexBuffer.PositionKind, v);
  }
  src.isPickable = false;
  src.isVisible = false;
  const mat = new StandardMaterial(`mobLodMat_${key}`, scene);
  mat.diffuseColor = new Color3(tint[0], tint[1], tint[2]);
  mat.emissiveColor = new Color3(tint[0] * 0.28, tint[1] * 0.2, tint[2] * 0.32);
  mat.specularColor = new Color3(0, 0, 0);
  src.material = mat;
  lodCache.set(`sphere|${key}`, [src]);
  return [src];
}

/** Цвет языков: огонь и кровотечение (веер ножей). */
const FLAME_FIRE = new Color3(1, 0.5, 0.12);
const FLAME_BLOOD = new Color3(0.95, 0.05, 0.05);

export class Mob implements Hittable {
  /** Паук: шаги и укусы — звуки (см. MobSystem.spiderSound). */
  get isSpider(): boolean {
    return this.modelName === "monSpider";
  }
  /** Звук паука: последний удар (attackSeq), позиция для шагов и накопленный путь. */
  soundAtkSeq = -1;
  stepX = NaN;
  stepZ = NaN;
  stepAcc = 0;

  /** ПК в третьем лице: плашки как в WoW (HP всегда, цвет уровня по опасности). null — как было. */
  static pcPlates: { level: number } | null = null;

  readonly root: TransformNode;
  private readonly body: Mesh;
  private readonly head: TransformNode;
  private readonly hitAnchor: TransformNode;
  private readonly mat: StandardMaterial;
  private bar: HealthBar3D | null = null;
  private nameTag: NameTag | null = null;
  private readonly tagName: string;
  private readonly tagLevel: number | null;
  private readonly tagColor: Color3;

  private getBar(): HealthBar3D {
    if (!this.bar) {
      this.bar = new HealthBar3D(
        this.scene,
        this.uiAnchor,
        new Vector3(0, MOB.bodyRadius * 2 + 0.35, 0),
        0.7 * this.uiScale,
      );
      this.bar.set(1);
      this.bar.setVisible(false);
    }
    return this.bar;
  }

  private getTag(): NameTag {
    if (!this.nameTag) {
      this.nameTag = new NameTag(
        this.scene,
        this.uiAnchor,
        new Vector3(0, MOB.bodyRadius * 2 + 0.78, 0),
        this.tagName,
        this.tagLevel,
        this.tagColor,
      );
    }
    return this.nameTag;
  }

  private readonly tint: readonly [number, number, number];
  private readonly bodyAlpha: number;
  private dead = false;
  private deathT = 0;
  private flash = 0;
  /** 0..1 — насколько ярко моб тлеет (поджог мага). */
  private burnGlow = 0;
  /** Языки пламени над мобом, пока он горит (ленивое создание). */
  private burnFx: TransformNode | null = null;
  private burnMat: ShaderMaterial | null = null;
  /** Крупные «квадраты» пламени, как было раньше (плюс россыпь мелких). */
  private burnMesh: Mesh | null = null;
  private burnT = 0;
  private barTimer = 0;
  private hitCd = 0;
  private lastHurtSeq = 0;
  private lastAtkSeq = 0;
  /** Таймер процедурного замаха: пока > 0, тело играет атаку. */
  private atkT = 0;
  private grounded = true;
  private prevY = 0;
  private readonly shove2 = new Vector3();
  /** Дальний LOD: модель выключена, вместо неё сфера-инстанс. */
  private lodSlots: { batch: LodBatch; slot: number }[] | null = null;
  private lodFar = false;
  /** Дальний LOD включён (игровой клиент). У спектатора модели всегда полные — анимация вдали не режется. */
  farLodOn = false;
  /** Живая схема состояния этого моба (обновляется Colyseus на месте) — чтобы не искать её в Map каждый кадр. */
  st: MobState | null = null;
  /** Мелкий летающий моб (пчела) — увеличенный хитбокс. */
  private readonly flyer: boolean;
  /** Подъём хитбокса и плашки над корнем (в единицах тела до масштаба), см. MobDef.visLift. */
  private readonly lift: number;
  private readonly heavy: boolean;
  private rigReady = false;
  private lodTint: readonly [number, number, number] = [0.5, 0.8, 0.5];
  /** Труп уже полностью растворился: корень выключен до возрождения. */
  private deadHidden = false;
  /** VR: накопленное время, пока моб невидим и обновляется редко (см. NetMobs.update). */
  idleAcc = Math.random() * 0.25; // разные фазы — редкие обновления не сходятся в один кадр
  /** Корень выключен, потому что моб вне кадра (см. applyState). */
  private viewHidden = false;
  private init = false;
  /** Размер тела (босс — крупнее). Приходит из состояния. */
  private scale = 1;
  private lastSlamSeq = 0;
  private slamRing: Mesh | null = null;
  private slamRingT = 0;
  private ragePulse = 0;
  /** Щит отражения (Ледяной демон): купол — дочерний узел корня, едет и поворачивается вместе с мобом. */
  private reflectShield: Mesh | null = null;
  private reflectShieldT = 0;

  /** Модель из пака (если подключена): она заменяет процедурную сферу. */
  private rig: RigInstance | null = null;
  /** Клип «движение/прыжок» найденной модели (имя зависит от пака). */
  private moveAnim: AnimationGroup | null = null;
  /** Описание элитного моба этой модели (после загрузки рига). */
  private eliteDef: EliteMobDef | undefined;
  /** Ледяной гигант: кольцо «Стужи» и снег; сколько секунд без ударов (в бою ли); фаза шага (звук и иней на касание). */
  private iceAura: IceAura | null = null;
  private giantIdleT = 99;
  private stepU = -1;
  /** Владыка Бездны: огонь ярости у лап; стопы (касание — шаг и пыль); метры мира на метр модели; когда фыркнет. */
  private lordAura: FireAura | null = null;
  private readonly lordFeet = new LordFeet();
  private lordK = 0;
  private lordSnortT = 4;
  /** Узлы костей модели по имени (рука с глыбой гиганта). */
  private readonly boneNodes = new Map<string, TransformNode | null>();
  /** Клип броска/удара (мобы 40 ур. с анимацией Weapon/Punch) и сколько ещё его держать, с. */
  private atkClip: AnimationGroup | null = null;
  /** Без сжатия/растяжения тела (EliteMobDef.noSquash). */
  private noSquash = false;
  /** Клип текущего замаха (вид босса или обычный) и его длительность, с. */
  private atkNow: AnimationGroup | null = null;
  private atkNowSec = 0.8;
  /** Клипы видов замаха этой модели (по MOB_SWING). */
  private swingAnims: Partial<Record<number, AnimationGroup>> = {};
  private atkClipT = 0;
  /** Модели с EliteMobDef.gait: стойка/бег (шаг — moveAnim) и сглаженная скорость по серверу, м/с. */
  private gaitIdle: AnimationGroup | null = null;
  /** EliteMobDef.turnRate: клипы разворота на месте шагами и текущая скорость разворота модели, рад/с. */
  private turnL: AnimationGroup | null = null;
  private turnR: AnimationGroup | null = null;
  private turnSpeed = 0;
  private gaitRun: AnimationGroup | null = null;
  private moveSpd = 0;
  private gaitX = NaN;
  private gaitZ = NaN;
  /** Сколько прошло с последнего пересчёта скорости (с). */
  private gaitT = 0;
  /** Узел, который тянем/сжимаем в прыжке: сфера или корень модели. */
  private squash: TransformNode;
  private curAnim: AnimationGroup | null = null;

  private readonly isBoss: boolean;
  /** true — у моба своя площадная атака (Чародей руин): те же FX телеграфа/кольца, что у босса. */
  private readonly hasNovaFx: boolean;

  constructor(
    private readonly scene: Scene,
    readonly kind: MobKind,
    readonly id: string,
    private readonly sfx: Sfx,
    private readonly report: HitReporter,
    /** true — облегчённый вид (стрим на слабом GPU): непрозрачное тело,
     *  без плашки имени, полоски HP и ран. Глаза оставляем — с ними живее. */
    private readonly lean = false,
    /** Множитель размера плашки/полоски — на смартфоне 2 (мелкий экран). */
    private readonly uiScale = 1,
    /** Ключ MODELS: своя модель из пака (усиленные мобы лагерей). Пусто — стандарт. */
    private readonly modelName = "",
    /** Переопределение имени в плашке (усиленные мобы). Пусто — по kind. */
    mobName = "",
    /** Переопределение уровня в плашке. 0 — по kind. */
    mobLevel = 0,
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
    const tagName = mobName || cfg.name;
    // Багровый — без уровня: подстраивается под бойцов (BOSS_ADAPT).
    const tagLevel = kind === "boss" || modelName === "scarecrow" ? null : mobLevel > 0 ? mobLevel : cfg.level;
    this.tint = cfg.tint;
    this.bodyAlpha = cfg.alpha;
    this.isBoss = kind === "boss";
    this.heavy = !!modelName && Mob.HEAVY.has(modelName);
    const flyDef = Object.values(ELITE_MOBS).find((d) => d.model === modelName);
    this.flyer = !!flyDef?.flying;
    this.lift = (flyDef?.visLift ?? 0) * MOB.bodyRadius * 2;
    this.hasNovaFx =
      this.isBoss ||
      !!Object.values(ELITE_MOBS).find((d) => d.model === modelName)?.novaCaster;

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
    trackMobMaterial(this.mat); // ?moblight=1 — живая подстройка поверх базовых цветов

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
    this.hitAnchor.position.y = MOB.bodyRadius + this.lift;

    // Полоса и плашка висят на отдельном узле: у босса тело крупное, а надписи
    // должны оставаться обычного размера — этот узел компенсирует масштаб.
    this.uiAnchor = new TransformNode("mobUi", scene);
    this.shadow = new BlobShadow(scene, id, false, modelLight(modelName).dense === true);
    this.uiAnchor.parent = this.root;

    // Полоска и плашка строятся лениво (getBar/getTag): 60+ мобов на карте
    // держали 200+ скрытых мешей, которые сцена обходит каждый кадр.
    this.tagName = tagName;
    this.tagLevel = tagLevel;
    this.tagColor =
      kind === "boss"
        ? new Color3(1, 0.3, 0.3)
        : cfg.ranged
          ? new Color3(1, 0.6, 0.25)
          : new Color3(0.85, 0.9, 1);

    // «Звёздочки» оглушения строятся лениво (buildStunStars) — у 60+ мобов
    // на карте это 200 лишних мешей, которые сцена обходит каждый кадр.

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
  /** Стрелы пригвождения (град стрел): включатель создаётся лениво, при первом пригвождении. */
  private setPins: ((on: boolean) => void) | null = null;
  private pinOn = false;
  private stunSpin: TransformNode | null = null;
  private stunStarMat: StandardMaterial | null = null;

  /** Три жёлтых кубика вращаются над головой, пока s.stunned. Дёшево, читается сразу. */
  private buildStunStars(): void {
    const scene = this.scene;
    const spin = new TransformNode("mobStun", scene);
    spin.parent = this.uiAnchor;
    spin.position.y = MOB.bodyRadius * 2 + 0.5;
    const starMat = new StandardMaterial("mobStunMat", scene);
    starMat.emissiveColor = new Color3(1, 0.92, 0.4);
    starMat.diffuseColor = new Color3(0, 0, 0);
    starMat.specularColor = new Color3(0, 0, 0);
    starMat.disableLighting = true;
    // Три кубика — один меш: одна отрисовка на оглушённого моба вместо трёх.
    const parts: Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const star = MeshBuilder.CreateBox(`mobStunStar${i}`, { size: 0.13 }, scene);
      const a = (i / 3) * Math.PI * 2;
      star.position.set(Math.cos(a) * 0.32, Math.sin(a * 2) * 0.05, Math.sin(a) * 0.32);
      star.rotation.set(0.6, a, 0.4);
      parts.push(star);
    }
    const stars = Mesh.MergeMeshes(parts, true, true) ?? parts[0];
    stars.name = "mobStunStar";
    stars.material = starMat;
    stars.isPickable = false;
    stars.parent = spin;
    this.stunSpin = spin;
    this.stunStarMat = starMat;
  }
  /** Пугало лагеря: табло над головой (кто бьёт, DPS, макс. удар) и последний нарисованный текст. */
  private scareBoard: Mesh | null = null;
  private scareTex: DynamicTexture | null = null;
  private scareText = "";

  /** Пугало (SCARECROW): столб, перекладина-руки, мешок-тело, голова и соломенная шляпа. Высота ~1.6 (до масштаба). */
  private buildScarecrow(): void {
    this.body.setEnabled(false);
    this.head.setEnabled(false);
    const sc = this.scene;
    const mat = (name: string, r: number, g: number, b: number): StandardMaterial => {
      const mm = new StandardMaterial(name, sc);
      mm.diffuseColor = new Color3(r, g, b);
      mm.emissiveColor = new Color3(r * 0.25, g * 0.25, b * 0.25);
      mm.specularColor = new Color3(0, 0, 0);
      return mm;
    };
    const wood = mat("scareWood", 0.42, 0.29, 0.16);
    const sack = mat("scareSack", 0.74, 0.6, 0.38);
    const straw = mat("scareStraw", 0.92, 0.8, 0.35);
    const hatM = mat("scareHat", 0.45, 0.33, 0.14);
    const part = (mesh: Mesh, m2: StandardMaterial, x: number, y: number, z: number): Mesh => {
      mesh.material = m2;
      mesh.parent = this.root;
      mesh.position.set(x, y, z);
      mesh.isPickable = false;
      return mesh;
    };
    part(MeshBuilder.CreateCylinder("scarePost", { diameter: 0.1, height: 1.5, tessellation: 6 }, sc), wood, 0, 0.75, 0);
    const arms = part(MeshBuilder.CreateCylinder("scareArms", { diameter: 0.07, height: 1.2, tessellation: 6 }, sc), wood, 0, 1.15, 0);
    arms.rotation.z = Math.PI / 2;
    part(MeshBuilder.CreateBox("scareBody", { width: 0.5, height: 0.6, depth: 0.26 }, sc), sack, 0, 1.0, 0);
    for (const x of [-0.62, 0.62]) {
      const tuft = part(MeshBuilder.CreateCylinder("scareTuft", { diameterTop: 0.02, diameterBottom: 0.16, height: 0.18, tessellation: 6 }, sc), straw, x, 1.15, 0);
      tuft.rotation.z = x < 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    part(MeshBuilder.CreateSphere("scareHead", { diameter: 0.34, segments: 8 }, sc), sack, 0, 1.45, 0);
    part(MeshBuilder.CreateCylinder("scareBrim", { diameter: 0.6, height: 0.03, tessellation: 12 }, sc), hatM, 0, 1.58, 0);
    part(MeshBuilder.CreateCylinder("scareCrown", { diameterTop: 0.08, diameterBottom: 0.3, height: 0.24, tessellation: 10 }, sc), hatM, 0, 1.7, 0);
    // Табло — над табличкой с именем, всегда лицом к камере.
    const tex = new DynamicTexture("scareTex", { width: 768, height: 220 }, sc, false);
    tex.hasAlpha = true;
    const bm = new StandardMaterial("scareBoardMat", sc);
    bm.diffuseTexture = tex;
    bm.emissiveTexture = tex;
    bm.opacityTexture = tex;
    bm.disableLighting = true;
    bm.backFaceCulling = false;
    const board = MeshBuilder.CreatePlane("scareBoard", { width: 2.6, height: 0.75 }, sc);
    board.material = bm;
    board.parent = this.root;
    board.position.y = 2.55;
    board.billboardMode = Mesh.BILLBOARDMODE_ALL;
    board.isPickable = false;
    this.scareBoard = board;
    this.scareTex = tex;
  }

  /** Перерисовать табло пугала (только когда текст сменился). */
  private paintScareBoard(text: string): void {
    const tex = this.scareTex;
    if (!tex || text === this.scareText) return;
    this.scareText = text;
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    const W = 768;
    const H = 220;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(10,9,14,0.72)";
    ctx.fillRect(8, 8, W - 16, H - 16);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const [l1 = "", l2 = ""] = text.split("\n");
    ctx.fillStyle = "#e6e0d0";
    ctx.font = "600 52px system-ui, sans-serif";
    ctx.fillText(l1, W / 2, 66, W - 40);
    ctx.fillStyle = "#ffcf5a";
    ctx.font = "800 62px system-ui, sans-serif";
    ctx.fillText(l2, W / 2, 150, W - 40);
    tex.update(true);
  }

  /** Пятно-тень под мобом: без неё прыжок читается как парение. */
  private readonly shadow: BlobShadow;

  /** Подменить процедурную сферу моделью слизня из пака. */
  private async attachModel(): Promise<void> {
    if (this.modelName === "scarecrow") {
      this.buildScarecrow();
      return;
    }
    let make: () => RigInstance;
    try {
      const { loadRig } = await import("../world/models");
      // Без smoothNormals: пересчёт нормалей ломал их направление на модели из
      // FBX (свет ложился «снизу»). Берём нормали как в файле.
      make = await loadRig(this.scene, (this.modelName || "slime") as ModelName);
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
    const drop = Object.values(ELITE_MOBS).find((d) => d.model === this.modelName)?.modelDrop ?? 0;
    holder.position.y = -drop * MOB.bodyRadius * 2;

    // Высота модели ≈ ~1.75 радиуса тела (модель слизня приземистее сферы;
    // на s.scale для босса домножается через this.root отдельно).
    const base = (MOB.bodyRadius * 1.75) / rig.nativeHeight;
    holder.scaling.setAll(base);
    // След модели для пятна-тени: полуширина и полудлина в координатах корня (без его масштаба и курса).
    // Меряем по мировым bbox каждого меша, как и рост рига в models.ts: getHierarchyBoundingVectors
    // на скиннутой модели врёт (вытягивал пятно по одной оси).
    {
      const sc0 = this.root.scaling.clone();
      const ry0 = this.root.rotation.y;
      this.root.scaling.setAll(1);
      this.root.rotation.y = 0;
      this.root.computeWorldMatrix(true);
      for (const n of this.root.getDescendants(false)) n.computeWorldMatrix(true);
      let loX = Infinity;
      let hiX = -Infinity;
      let loZ = Infinity;
      let hiZ = -Infinity;
      for (const m of rig.meshes) {
        if (m.getTotalVertices() === 0) continue;
        m.refreshBoundingInfo({});
        m.computeWorldMatrix(true);
        const bb = m.getBoundingInfo().boundingBox;
        loX = Math.min(loX, bb.minimumWorld.x);
        hiX = Math.max(hiX, bb.maximumWorld.x);
        loZ = Math.min(loZ, bb.minimumWorld.z);
        hiZ = Math.max(hiZ, bb.maximumWorld.z);
      }
      if (Number.isFinite(hiX - loX) && hiX > loX && Number.isFinite(hiZ - loZ) && hiZ > loZ) {
        // Пятно круглое: радиус — корень из площади следа (расставленные руки призрака и длинный дракон
        // не растягивают тень), площадь следа сохраняем.
        const fx = Math.max(0.05, (hiX - loX) / 2);
        const fz = Math.max(0.05, (hiZ - loZ) / 2);
        this.footX = Math.sqrt(fx * fz);
        this.footZ = this.footX;
      }
      if (modelLight(this.modelName).feet) {
        // Вершины — в мировых координатах; корень стоит в мире, поэтому вычитаем его позицию.
        const parts: MeshVerts[] = [];
        for (const m of rig.meshes) {
          const pos = m.getVerticesData(VertexBuffer.PositionKind);
          if (pos) parts.push({ pos, world: m.getWorldMatrix().m });
        }
        const o = this.root.getAbsolutePosition();
        const c = feetCentre(parts, { x: o.x, z: o.z });
        if (c) {
          this.footCx = c.x;
          this.footCz = c.z;
        }
      }
      this.root.scaling.copyFrom(sc0);
      this.root.rotation.y = ry0;
      this.root.computeWorldMatrix(true);
    }

    // Мобам лагерей (пчела и т.п.) оставляем родные текстуры пака (только
    // эмиссивная заливка под дневной свет); перекрашиваем под цвет кинда
    // только стандартных слизней/плевунов/босса.
    if (this.modelName) {
      const { recolorMonster } = await import("../world/models");
      const def = Object.values(ELITE_MOBS).find((d) => d.model === this.modelName);
      // Свет модели (пчела, орк, модели art/models) — таблица MODEL_LIGHT в mobLightTune.ts.
      recolorMonster(rig.root, def?.tint ? new Color3(...def.tint) : undefined, false, this.modelName as ModelName);
      if (def?.tint) this.lodTint = def.tint;
    } else {
      // Имена частей (body_primary / body_secondary / eye_color) — до перекраски: по ним общий источник инстансов.
      const parts = rig.meshes.map((m) => m.material?.name ?? "");
      recolorRig(rig, this.kind, this.tint, this.bodyAlpha);
      this.lodTint = this.tint;
      // Слизни и плевуны — инстансами (одна отрисовка на часть для всех); Багровый один — своими мешами.
      if (this.kind === "slime" || this.kind === "spitter") {
        this.slimeInst = instanceSlime(this.scene, this.kind, rig.meshes, parts, this.tint, this.bodyAlpha);
      }
    }

    // Мобы 40 ур. (свой снаряд, прыжок или сгенерированная модель с клипами): удар — клип модели, а не только «замах» телом.
    const eliteDef = this.modelName ? Object.values(ELITE_MOBS).find((d) => d.model === this.modelName) : undefined;
    if (eliteDef?.shot || eliteDef?.leaper || eliteDef?.gait)
      this.atkClip = rig.anims.get("weapon") ?? rig.anims.get("punch") ?? rig.anims.get("attack") ?? null;
    if (eliteDef?.attackClip) this.atkClip = rig.anims.get(eliteDef.attackClip) ?? this.atkClip;
    this.noSquash = !!eliteDef?.noSquash;
    this.eliteDef = eliteDef;
    // Плавные переходы между клипами (гигант: удар → шаг без рывка позы).
    if (eliteDef?.blendAnims) {
      for (const g of rig.anims.values()) {
        g.enableBlending = true;
        g.blendingSpeed = 0.07;
      }
    }
    if (eliteDef?.iceGiant) this.sfx.preloadIceGiant();
    if (eliteDef?.lavaGuard || eliteDef?.lavaMage) this.sfx.preloadLava();
    if (eliteDef?.dragonLord) this.sfx.preloadLord();
    // Клипы видов замаха босса (MOB_SWING), если они есть в модели.
    this.swingAnims = {};
    for (const [kind, v] of Object.entries(SWING_ANIM)) {
      const a = rig.anims.get(v.clip);
      if (a) this.swingAnims[Number(kind)] = a;
    }
    if (!eliteDef?.dragonLord && [MOB_SWING.claw, MOB_SWING.tail, MOB_SWING.breath, MOB_SWING.wings].some((k) => this.swingAnims[k])) this.sfx.preloadDragon();
    if (eliteDef?.gait) {
      this.gaitIdle = rig.anims.get("idle") ?? null;
      this.gaitRun = rig.anims.get("run") ?? null;
    }
    if (eliteDef?.turnRate) {
      this.turnL = rig.anims.get("turnl") ?? null;
      this.turnR = rig.anims.get("turnr") ?? null;
    }
    // Клип «движения»: у разных моделей пака он называется по-разному
    // (Hop / Jump / Fast_Flying / Walk / Run). Запомним, что нашли.
    this.moveAnim =
      rig.anims.get("hop") ??
      rig.anims.get("jump") ??
      rig.anims.get("flying") ??
      rig.anims.get("walk") ??
      rig.anims.get("run") ??
      rig.anims.get("idle") ??
      null;

    // Процедурная сфера с глазами больше не нужна — сносим совсем.
    this.body.dispose();
    this.head.dispose(false, true);
    this.squash = holder;
    this.baseModelScale = base;
    this.rigReady = true; // материалы перекрашены — можно строить дальний LOD
    // Летуны (пчёлы): модель висит выше корня — огонь поднимаем на высоту её низа, иначе он горит под мобом.
    this.root.computeWorldMatrix(true);
    holder.computeWorldMatrix(true);
    const bb = holder.getHierarchyBoundingVectors(true);
    const sy = Math.max(0.05, Math.abs(this.root.scaling.y));
    this.burnBaseY = Math.max(0, (bb.min.y - this.root.getAbsolutePosition().y) / sy);
    if (this.burnFx) this.burnFx.position.y = this.burnBaseY;
    // Плашка и HP — над макушкой самой модели (у крупных боссов «тело слизня × масштаб» мимо головы).
    this.modelTop = Math.max(0, (bb.max.y - this.root.getAbsolutePosition().y) / sy);
    this.placeUi();

    // «Hop» проигрываем только в прыжке (см. applyState), в покое — статика.
  }

  private baseModelScale = 1;
  /** След модели (полуширина и полудлина, м при масштабе 1); 0 — модели ещё нет, пятно по радиусу тела. */
  private footX = 0;
  private footZ = 0;
  /** Центр между ногами в координатах корня (ModelLight.feet); 0,0 — центр корня. */
  private footCx = 0;
  private footCz = 0;
  /** Макушка модели над корнем, локальные единицы (0 — модели нет, высота по телу слизня). */
  private modelTop = 0;

  /**
   * Высота плашки (uiAnchor масштабирован 1/scale, сама плашка — на bodyRadius·2 + 0.78 м выше якоря).
   * Есть модель — над её макушкой; нет — на прибавку высоты тела от масштаба (не больше — иначе плашка улетает).
   */
  private placeUi(): void {
    const sc = this.scale;
    this.uiAnchor.position.y =
      this.modelTop > 0 ? this.modelTop - (MOB.bodyRadius * 2) / sc : (MOB.bodyRadius * 2 * (sc - 1)) / sc + this.lift;
  }
  /** Слизень/плевун на общих инстансах (см. slimeInstances.ts): прозрачность — через цвет инстанса. */
  private slimeInst: SlimeInstances | null = null;
  /** На сколько выше корня начинается модель (у летунов), локальные единицы — сюда поднимаем огонь. */
  private burnBaseY = 0;

  // ---- Hittable ----

  get alive(): boolean {
    return !this.dead;
  }

  hitSegment(): { a: Vector3; b: Vector3; radius: number } {
    const p = this.root.getAbsolutePosition();
    const sc = this.scale;
    return {
      a: p.add(new Vector3(0, 0.1 + this.lift * sc, 0)),
      b: p.add(new Vector3(0, (MOB.bodyRadius * 2 + this.lift) * sc, 0)),
      radius: MOB.hitRadius * sc + (this.flyer ? FLYER_HIT_BONUS : 0),
    };
  }

  hitNode(): TransformNode {
    return this.hitAnchor;
  }

  center(): Vector3 {
    return this.root.getAbsolutePosition().add(new Vector3(0, (MOB.bodyRadius + this.lift) * this.scale, 0));
  }

  /**
   * Точка «MISS» над головой — в соглашении WorldCrossFx.missText (шейдер сам поднимет ещё на 1.3 м):
   * над макушкой и плашкой с именем, как и точка, что шлёт сервер (ZoneSim.mobMisses).
   */
  missPoint(): { x: number; y: number; z: number } {
    const p = this.root.getAbsolutePosition();
    return { x: p.x, y: p.y + (MOB.bodyRadius * 2 + this.lift) * this.scale + 0.2, z: p.z };
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

  applyState(
    s: MobState,
    dt: number,
    playerPos: Vector3,
    playerAim: Vector3,
    /** VR: моб в числе ближайших, которых рисуем (иначе отключаем целиком). */
    drawAllowed = true,
    /** VR: показывать ли плашку имени. */
    uiAllowed = true,
  ): void {
    let sp = secNow();
    if (this.hitCd > 0) this.hitCd -= dt;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3);

    if (s.scale > 0 && s.scale !== this.scale) {
      this.scale = s.scale;
      this.root.scaling.setAll(s.scale);
      this.uiAnchor.scaling.setAll(1 / s.scale);
      this.placeUi();
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
    this.turnSpeed = 0;
    if (this.eliteDef?.turnRate && !far) {
      // Разворот шагами (дракон): курс не быстрее turnRate — лапы успевают переставляться (клип разворота ниже).
      const t = turnToward(this.root.rotation.y, s.yaw, dt, (this.eliteDef.turnRate * Math.PI) / 180);
      this.root.rotation.y = t.yaw;
      this.turnSpeed = t.speed;
    } else if (this.eliteDef?.blendAnims && !far) {
      // Тяжёлый (гигант): разворот плавный, а не рывком за курсом сервера.
      let dy = s.yaw - this.root.rotation.y;
      dy = (((dy + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      this.root.rotation.y += dy * (1 - Math.exp(-dt * 7));
    } else this.root.rotation.y = s.yaw;
    // Моб за спиной камеры / вне кадра: выключаем его узлы целиком (Babylon не
    // обходит их для отсечения/матриц) и не двигаем тень. Запас по радиусу
    // большой — камера успевает довернуть, пока план кадра отстаёт на кадр.
    // Под землёй (Землерой) — модель не рисуем: видно только пыльный след (эффекты burrowTrail).
    const inView = drawAllowed && s.under !== 1 && this.inFrustum(pos, 6 + 4 * this.scale);
    if (!this.deadHidden && inView === this.viewHidden) {
      this.viewHidden = !inView;
      this.root.setEnabled(inView);
      this.shadow.setEnabled(inView && !this.dead); // тень — отдельный инстанс, не ребёнок root
      this.refreshLod();
    }
    // Пятно остаётся на земле, пока моб в прыжке — по нему видно высоту.
    if (!this.dead && inView) {
      // Пятно — по следу модели (1 = ровно след); множитель модели — MODEL_LIGHT.shadow (панель ?moblight=1).
      const sc = this.scale;
      const k = modelLight(this.modelName).shadow ?? 1;
      // Центр пятна — между ногами: смещение в координатах корня, повёрнутое по курсу (ось Z — вперёд).
      const yaw = this.root.rotation.y;
      const lx = this.footCx * sc;
      const lz = this.footCz * sc;
      const cx = pos.x + lx * Math.cos(yaw) + lz * Math.sin(yaw);
      const cz = pos.z - lx * Math.sin(yaw) + lz * Math.cos(yaw);
      if (this.footX > 0) {
        this.shadow.place(cx, pos.y, cz, this.footX * sc * k, this.footZ * sc * k, yaw);
      } else {
        this.shadow.place(cx, pos.y, cz, MOB.bodyRadius * sc * k, MOB.bodyRadius * sc * k, 0);
      }
    }
    secAdd("mob.pos+view+shadow", sp);
    if (this.eliteDef?.iceGiant) this.updateIceAura(s, inView, pos, dt);
    if (this.eliteDef?.dragonLord) this.updateLord(s, inView, pos, playerPos, dt);

    // Невидимый живой моб (вне лимита/за спиной/далеко): ни эффектов, ни анимации,
    // ни плашки — только держим счётчики событий в актуальном виде, чтобы при
    // появлении не выстрелили накопившиеся удары/звуки. Это главный выигрыш по
    // времени кадра (netMobs) на слабом шлеме: живых мобов десятки, видны единицы.
    if (!inView && !s.dead && !this.dead) {
      this.lastAtkSeq = s.attackSeq;
      this.lastHurtSeq = s.hurtSeq;
      this.lastSlamSeq = s.slamSeq;
      this.grounded = s.grounded === 1;
      this.prevY = pos.y;
      this.atkT = 0;
      this.flash = 0;
      this.stopAnim();
      secCount("#mob.hiddenPath");
      return;
    }
    secCount("#mob.fullPath");

    sp = secNow();
    this.updateFarLod(pos, playerPos);
    if (this.lodFar) this.refreshLod();
    secAdd("mob.farLod", sp);
    sp = secNow();

    // атака моба: attackSeq вырос -> процедурный замах телом
    if (s.attackSeq !== this.lastAtkSeq) {
      this.lastAtkSeq = s.attackSeq;
      if (!this.dead) this.atkT = ATTACK_DUR;
      // Вид замаха босса: свой клип и его длительность; укус (0) — обычный atkClip.
      const sw = s.attackKind ? this.swingAnims[s.attackKind] : undefined;
      this.atkNow = sw ?? this.atkClip;
      this.atkNowSec = sw ? SWING_ANIM[s.attackKind].sec : (this.eliteDef?.attackSec ?? 0.8);
      if (this.eliteDef?.iceGiant) {
        this.giantIdleT = 0;
        if (!this.dead && (s.attackKind === 0 || s.attackKind === MOB_SWING.swipe2))
          this.playIfNear(playerPos, () => this.sfx.at(pos, () => this.sfx.ice("swipe", 1, 0.06)), 45);
      }
      if (!this.dead && this.atkNow) {
        // Перезапуск клипа броска с начала (playAnim не перезапускает тот же клип).
        if (this.curAnim === this.atkNow) {
          this.atkNow.stop();
          this.curAnim = null;
        }
        this.atkClipT = this.atkNowSec;
      }
      // Голос дракона: огонь дыхания и рёв ударной волны (слышно издалека, как у большого босса).
      // Владыка Бездны — свои звуки: укус и взмах крыльев здесь, остальное — по событиям приёмов (DragonAct).
      if (this.eliteDef?.dragonLord) {
        if (!this.dead) this.lordSwing(s.attackKind, pos, playerPos);
      } else if (!this.dead && s.attackKind === MOB_SWING.breath) this.playIfNear(playerPos, () => this.sfx.dragonBreath(pos), 45);
      else if (!this.dead && s.attackKind === MOB_SWING.wings) this.playIfNear(playerPos, () => this.sfx.dragonRoar(pos), 45);
    }
    if (this.atkClipT > 0) this.atkClipT = Math.max(0, this.atkClipT - dt);
    if (this.atkT > 0) this.atkT = Math.max(0, this.atkT - dt);

    // оглушение: звёздочки над головой вращаются, пока s.stunned
    const stun = s.stunned === 1 && !s.dead;
    if (stun && !this.stunSpin) this.buildStunStars();
    const spin = this.stunSpin;
    if (spin) {
      if (stun !== spin.isEnabled()) spin.setEnabled(stun);
      if (stun) {
        spin.rotation.y += dt * 6;
        if (this.stunStarMat) this.stunStarMat.alpha = 0.75 + Math.sin(spin.rotation.y * 3) * 0.2;
      }
    }


    // пригвождение градом стрел: торчащие стрелы, пока s.pinned (инстансы, без покадровой работы)
    const pin = s.pinned === 1 && !s.dead;
    if (pin !== this.pinOn) {
      this.pinOn = pin;
      if (pin && !this.setPins) this.setPins = createPinArrows(this.scene, this.root, MOB.bodyRadius);
      this.setPins?.(pin);
    }

    // урон: hurtSeq вырос -> вспышка + рана + звук
    if (s.hurtSeq !== this.lastHurtSeq) {
      this.lastHurtSeq = s.hurtSeq;
      this.flash = 1;
      this.giantIdleT = 0;
      // ПК: здоровье — в самой плашке над мобом, отдельная полоска не нужна.
      if (!this.lean && !Mob.pcPlates) {
        this.barTimer = 3;
        const bar = this.getBar();
        bar.set(Math.max(0, s.hp) / s.maxHp);
        bar.setOpacity(1);
      }
      if (!s.dead) {
        this.playIfNear(playerPos, () => this.sfx.mobHurt(pos));
      }
    }

    if (this.barTimer > 0 && !this.lean) {
      this.barTimer -= dt;
      this.bar?.setOpacity(this.barTimer > 0.7 ? 1 : Math.max(0, this.barTimer / 0.7));
    }
    secAdd("mob.status(atk/stun/pin/hurt/bar)", sp);
    sp = secNow();

    // Горение (поджог мага): языки пламени над мобом + тлеющий пульс тела.
    // Кровотечение — те же языки, но красные и без света (огонь светит, кровь — нет).
    const bleedOnly = s.burning <= 0 && (s.bleeding ?? 0) > 0 && !s.dead;
    this.flameRed = bleedOnly;
    const burning = (s.burning > 0 || bleedOnly) && !s.dead;
    this.burnGlow = burning
      ? Math.min(1, this.burnGlow + dt * 5)
      : Math.max(0, this.burnGlow - dt * 3);
    // Свет гаснет плавно за последнюю секунду горения (остаток `burning` — целые секунды, 1 = последняя).
    if (burning && s.burning <= 1) {
      this.burnLastSecT = Math.min(1, this.burnLastSecT + dt);
      this.burnLightFade = 1 - this.burnLastSecT;
    } else if (burning) {
      this.burnLastSecT = 0;
      this.burnLightFade = 1;
    } else {
      this.burnLightFade = 0;
    }
    this.updateBurnFx(dt);
    const ember = this.burnGlow > 0 ? this.burnGlow * (0.35 + 0.25 * Math.sin(pos.y * 40 + performance.now() * 0.012)) : 0;

    // Ночью — немного собственного свечения сверх дневного (заявка): слизень/плевун/багровый едва светятся в темноте.
    const night = (1 - daylightAt(LOADOUT.world.hour)) * 0.16;
    this.mat.emissiveColor.set(
      this.tint[0] * (0.28 + night) + this.flash * 0.6 + ember,
      this.tint[1] * (0.2 + night) + this.flash * 0.1 + (this.flameRed ? 0 : ember * 0.35),
      this.tint[2] * (0.32 + night),
    );

    secAdd("mob.burn+tint", sp);
    sp = secNow();
    // смерть / возрождение
    if (s.dead && !this.dead) {
      this.dead = true;
      this.deathT = 0;
      this.burnGlow = 0;
      this.burnFx?.setEnabled(false);
      this.shadow.setEnabled(false);
      this.setFarLod(false);
      if (this.rig) this.playAnim(this.rig.anims.get("death"), false);
      if (this.eliteDef?.iceGiant) this.giantDeath(pos, playerPos);
      else if (this.eliteDef?.dragonLord) this.lordDeath(pos, playerPos);
      else this.playIfNear(playerPos, () => this.sfx.mobDie(pos));
    } else if (!s.dead && this.dead) {
      this.dead = false;
      if (this.deadHidden) {
        this.deadHidden = false;
        this.viewHidden = false;
        this.root.setEnabled(true);
      }
      this.shadow.setEnabled(true);
      this.setBodyVisibility(1);
      this.setSquash(1, 1, 1);
      if (!this.rig) this.head.setEnabled(true);
      this.nameTag?.setEnabled(true);
      this.bar?.setVisible(false);
      this.barTimer = 0;
      this.stopAnim();
    }

    if (this.dead) {
      this.deathT += dt;
      if (!this.rig) this.head.setEnabled(false);
      this.bar?.setVisible(false);
      this.nameTag?.setEnabled(false);
      this.prevY = pos.y;
      if (this.deathT > 1.5) {
        // Растворился — не тратим кадры на невидимый труп (визуальность, снятие
        // анимаций, обход узлов). Включим обратно при возрождении.
        if (!this.deadHidden) {
          this.deadHidden = true;
          this.root.setEnabled(false);
        }
        return;
      }
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

    secAdd("mob.deathLogic", sp);
    sp = secNow();
    // сжатие в прыжке — по вертикальной скорости
    const vy = dt > 1e-4 ? (pos.y - this.prevY) / dt : 0;
    this.prevY = pos.y;
    const sq = Math.max(0.4, 1 + vy * 0.04);
    if (this.atkT > 0) {
      this.applyAttackSquash();
    } else if (this.isBoss && s.charging) {
      // Телеграф рывка: босс вытягивается вперёд по направлению взгляда,
      // сжимаясь с боков, и наливается багровым.
      const w = Math.max(0.35, s.windup);
      this.setSquash(Math.max(0.5, 1 - w * 0.3), Math.max(0.6, 1 - w * 0.2), 1 + w * 0.7);
      this.flash = Math.max(this.flash, 0.35 + w * 0.35);
    } else if (this.hasNovaFx && s.windup > 0) {
      // Телеграф слэма/нова-заклинания: приседает и раздувается вширь.
      const w = s.windup;
      this.setSquash(1 + w * 0.4, Math.max(0.45, 1 - w * 0.45), 1 + w * 0.4);
      this.flash = Math.max(this.flash, w * 0.5);
    } else {
      this.setSquash(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    }

    // «Hop» — только пока моб в воздухе (серверный признак grounded); на земле
    // модель статична (желейное сжатие даёт setSquash по вертикальной скорости).
    if (this.rig && !this.dead) {
      // Летающим мобам (пчела) клип держим всегда — иначе «висят» замерев.
      const flyer = !!this.moveAnim && !this.rig.anims.has("hop");
      // Скелетная анимация вне кадра/вдали не нужна: у 20+ пчёл она крутилась
      // вечно, даже когда их никто не видит.
      const seen = this.animVisible(pos, playerPos);
      if (this.gaitIdle) {
        // Скорость — по серверным тикам: позиция приходит не каждый кадр, поэтому делим путь на время
        // между сменами позиции (а не на кадр — иначе в среднем выходило ~2 м/с и бег не включался).
        this.gaitT += dt;
        const moved = Number.isFinite(this.gaitX) ? Math.hypot(s.x - this.gaitX, s.z - this.gaitZ) : 0;
        if (Number.isFinite(this.gaitX) && (moved > 1e-3 || this.gaitT > 0.3)) {
          const raw = moved > 1e-3 ? Math.min(12, moved / this.gaitT) : 0;
          this.moveSpd += (raw - this.moveSpd) * (1 - Math.exp(-this.gaitT / 0.35));
          this.gaitT = 0;
          this.gaitX = s.x;
          this.gaitZ = s.z;
        } else if (!Number.isFinite(this.gaitX)) {
          this.gaitX = s.x;
          this.gaitZ = s.z;
          this.gaitT = 0;
        }
      }
      if (seen && this.atkNow && this.atkClipT > 0) this.playAnim(this.atkNow, false);
      else if (seen && this.gaitIdle) {
        const def = this.eliteDef;
        let clip =
          this.moveSpd < GAIT_IDLE_SPEED ? this.gaitIdle : this.moveSpd > GAIT_RUN_SPEED && this.gaitRun ? this.gaitRun : this.moveAnim;
        // Стоит и поворачивается — разворот шагами (темп клипа под скорость поворота: стопы не скользят).
        if (clip === this.gaitIdle && def?.turnRate) {
          const tc = turnClip(this.turnSpeed, (def.turnRate * Math.PI) / 180);
          const g = tc ? (tc.clip === "turnl" ? this.turnL : this.turnR) : null;
          if (tc && g) {
            g.speedRatio = tc.ratio;
            clip = g;
          }
        }
        // Темп бега — от скорости моба, чтобы ноги не скользили по земле.
        if (clip === this.gaitRun && clip) clip.speedRatio = Math.min(2, Math.max(0.5, this.moveSpd / (def?.runClipSpeed ?? RUN_CLIP_SPEED)));
        else if (clip === this.moveAnim && clip && def?.walkClipSpeed) clip.speedRatio = Math.min(1.6, Math.max(0.6, this.moveSpd / def.walkClipSpeed));
        this.playAnim(clip, true);
        if (def?.iceGiant) this.giantSteps(clip, pos, playerPos);
      } else if (seen && (s.grounded === 0 || flyer)) this.playAnim(this.moveAnim, true);
      else this.stopAnim();
    }

    secAdd("mob.squash+anim", sp);
    sp = secNow();
    // Слэм/нова: ++slamSeq -> ударная волна по земле + грохот.
    if (this.hasNovaFx && s.slamSeq !== this.lastSlamSeq) {
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

    // Щит отражения: привязан к корню моба (движется и поворачивается с ним), мерцает.
    if (s.reflecting && !s.dead) {
      if (!this.reflectShield) this.reflectShield = this.makeReflectShield();
      this.reflectShield.setEnabled(true);
      this.reflectShieldT += dt;
      const pulse = 1 + 0.05 * Math.sin(this.reflectShieldT * 10);
      this.reflectShield.scaling.setAll(pulse);
      (this.reflectShield.material as StandardMaterial).alpha = 0.45 + 0.25 * Math.abs(Math.sin(this.reflectShieldT * 7));
    } else if (this.reflectShield) {
      this.reflectShield.setEnabled(false);
    }

    // Ярость: пульсирующее багровое свечение (босс и разъярённый элита события).
    if (s.enraged && !s.dead) {
      this.ragePulse += dt * 6;
      this.flash = Math.max(this.flash, 0.25 + Math.sin(this.ragePulse) * 0.15);
    }

    if (s.grounded === 0 && this.grounded) this.playIfNear(playerPos, () => this.sfx.mobHop(pos), 20);
    this.grounded = s.grounded === 1;

    secAdd("mob.slam+misc", sp);
    // Пугало: табло урона — и у игроков, и на трансляции (до выхода облегчённого вида ниже).
    if (this.scareBoard) {
      this.paintScareBoard(s.info);
      this.scareBoard.setEnabled(Math.hypot(pos.x - playerPos.x, pos.z - playerPos.z) < MOB.nameTagRange * 1.6);
    }
    // Облегчённый вид (стрим): без плашки и полоски HP — их рисует оверлей страницы.
    if (this.lean) return;
    sp = secNow();

    // плашка — только рядом и примерно в поле зрения
    const dx = pos.x - playerPos.x;
    const dz = pos.z - playerPos.z;
    const md = Math.hypot(dx, dz);
    const facing = md < 1e-3 || (dx * playerAim.x + dz * playerAim.z) / md > -0.25;
    const near = md < MOB.nameTagRange && facing && uiAllowed;
    if (near || this.nameTag) this.getTag().setEnabled(near);
    if (near) {
      // Издалека плашку не разобрать, поэтому на дальней границе она ×4,
      // а по мере приближения плавно ужимается до ×2. На смартфоне — вдвое.
      const t = Math.min(1, Math.max(0, (md - 6) / (MOB.nameTagRange - 6)));
      const tag = this.getTag();
      tag.setScale((2 + t * 2) * this.uiScale);
      tag.setArmor(s.armor);
      // ПК «как в WoW»: полоска здоровья всегда в плашке, уровень — цветом опасности.
      const pc = Mob.pcPlates;
      if (pc) {
        tag.showHp();
        tag.setHp(s.maxHp > 0 ? Math.max(0, s.hp) / s.maxHp : 0);
        if (this.tagLevel !== null) {
          const [r, g, b] = difficultyRgb(this.tagLevel, pc.level);
          tag.setAccent(r, g, b);
        }
      }
    }
    secAdd("mob.nameTag", sp);
  }

  /** Дальше этого (м) живого моба рисуем сферой вместо модели со скелетом. */
  private static readonly LOD_FAR = 55;
  /** Множитель дальности упрощённой копии: эфир держит живые модели дальше (Spectator ставит 1.6). */
  static lodFarMul = 1;
  private static readonly LOD_FAR_FLYER = 24;
  /** Тяжёлые модели (40+ костей и 3–4 тыс. вершин: орк, кактородо, жаба, грибной владыка, шипобрюх) переходят на дальний LOD раньше. */
  private static readonly LOD_FAR_HEAVY = 30;
  private static readonly HEAVY = new Set(["monOrc", "monCactoro", "monFrog", "monMushKing", "monSpikyBlob"]);

  private setFarLod(want: boolean): void {
    const rig = this.rig;
    if (!rig || want === this.lodFar) return;
    if (want && !this.rigReady) return; // модель ещё не перекрашена
    if (want && !this.lodSlots) {
      const key = `${this.modelName}|${this.kind}`;
      let srcs = lodCache.get(key);
      if (srcs === undefined || (srcs && srcs[0].isDisposed())) {
        this.stopAnim(); // поза покоя — как моб выглядит вдали
        srcs = lodBuild(this.scene, key, rig.meshes, this.root);
        lodCache.set(key, srcs);
      }
      if (!srcs) srcs = lodSphere(this.scene, this.lodTint);
      this.lodSlots = srcs.map((src) => {
        const batch = lodBatchOf(src);
        return { batch, slot: batch.acquire() };
      });
    }
    this.lodFar = want;
    rig.root.setEnabled(!want);
    this.refreshLod();
    if (want) this.stopAnim();
  }

  /** Матрицы дальних (LOD) слотов: показываем, пока моб далеко, жив и в кадре; иначе прячем. */
  private refreshLod(): void {
    if (!this.lodSlots) return;
    const show = this.lodFar && !this.dead && !this.viewHidden && !this.deadHidden;
    if (show) this.root.computeWorldMatrix(true);
    const m = this.root.getWorldMatrix();
    for (const l of this.lodSlots) l.batch.set(l.slot, show, m);
  }

  private updateFarLod(pos: Vector3, cam: Vector3): void {
    if (!this.rig || !this.farLodOn) return;
    if (this.dead || this.isBoss || this.hasNovaFx) {
      this.setFarLod(false);
      return;
    }
    // Летающие мелкие мобы (пчёлы) вдали неразличимы — переходят на общий LOD-батч гораздо раньше.
    const far = (this.flyer ? Mob.LOD_FAR_FLYER : this.heavy ? Mob.LOD_FAR_HEAVY : Mob.LOD_FAR) * Mob.lodFarMul;
    const lim = this.lodFar ? far - 4 : far;
    // С высотой камеры: общий план эфира сверху (~100 м) — все мобы упрощённые.
    const d2 = (pos.x - cam.x) ** 2 + (pos.y - cam.y) ** 2 + (pos.z - cam.z) ** 2;
    this.setFarLod(d2 > lim * lim);
  }

  /** Дальше этого от камеры скелетную анимацию моба не крутим. */
  private static readonly ANIM_RANGE = 85;
  /** В VR мобов дальше этого (м) не рисуем и не считаем. */
  private static readonly VR_CULL_RANGE = Number(new URLSearchParams(location.search).get("mobrange")) || 130; // ?mobrange=<м> — для подбора замером
  /** В VR скелетную анимацию считаем только ближе этого (м). */
  private static readonly VR_ANIM_RANGE = 28;
  /** Тяжёлому скелету (43 кости) в VR анимацию считаем только вблизи. */
  private static readonly VR_ANIM_RANGE_HEAVY = 18;

  /** Моб в кадре и не слишком далеко — тогда анимацию стоит считать. */
  private animVisible(pos: Vector3, cam: Vector3): boolean {
    const dx = pos.x - cam.x;
    const dy = pos.y - cam.y;
    const dz = pos.z - cam.z;
    const vr = !!(this.scene.activeCamera as { rigCameras?: unknown[] } | null)?.rigCameras?.length;
    const range = vr ? (this.heavy ? Mob.VR_ANIM_RANGE_HEAVY : Mob.VR_ANIM_RANGE) : Mob.ANIM_RANGE;
    // С высотой камеры (общий план эфира сверху), в VR — по горизонтали, как было.
    if (dx * dx + (vr ? 0 : dy * dy) + dz * dz > range * range) return false;
    return this.inFrustum(pos, 2 + 2.5 * this.scale);
  }

  /**
   * Попадает ли шар вокруг моба (радиус r) в пирамиду видимости камеры по
   * планам прошлого кадра. В VR (стерео-риг) план один на оба глаза — там не
   * отсекаем, чтобы не терять мобов с краю одного из глаз.
   */
  private inFrustum(pos: Vector3, r: number): boolean {
    const cam = this.scene.activeCamera as
      | { rigCameras?: unknown[]; globalPosition: Vector3; getWorldMatrix(): { m: ArrayLike<number> } }
      | null;
    if (cam?.rigCameras?.length) {
      // VR (стерео-риг): плана кадра на оба глаза нет, зато Quest тянет мобов из
      // последних сил — прячем дальних (гистерезис ±4 м) и тех, что явно за
      // спиной (угол больше ~110° от взгляда), остальное рисуем как есть.
      const cp = cam.globalPosition;
      const dx = pos.x - cp.x;
      const dz = pos.z - cp.z;
      const d2 = dx * dx + dz * dz;
      const lim = this.viewHidden ? Mob.VR_CULL_RANGE + 4 : Mob.VR_CULL_RANGE;
      if (d2 > lim * lim) return false;
      if (d2 > 36) {
        const m = cam.getWorldMatrix().m;
        const fl = Math.hypot(m[8], m[10]) || 1;
        if ((dx * m[8] + dz * m[10]) / (Math.sqrt(d2) * fl) < -0.35) return false;
      }
      return true;
    }
    const planes = this.scene.frustumPlanes;
    if (!planes) return true;
    const y = pos.y + MOB.bodyRadius * this.scale;
    for (const p of planes) {
      if (p.normal.x * pos.x + p.normal.y * y + p.normal.z * pos.z + p.d < -r) return false;
    }
    return true;
  }

  /** Мировая точка кости модели (по имени узла glTF); null — модели нет, она скрыта или моб мёртв. */
  boneWorld(name: string): { x: number; y: number; z: number } | null {
    if (!this.rig || this.viewHidden || this.dead) return null;
    let n = this.boneNodes.get(name);
    if (n === undefined) {
      n = (this.rig.root.getDescendants(false).find((d) => d.name === name || d.name.endsWith(name)) as TransformNode | undefined) ?? null;
      this.boneNodes.set(name, n);
    }
    if (!n) return null;
    const p = n.getAbsolutePosition();
    return { x: p.x, y: p.y, z: p.z };
  }

  /** Ледяной гигант: кольцо «Стужи» и снег вокруг, пока он виден и жив; в бою — гуще, в ярости — метель. */
  private updateIceAura(s: MobState, inView: boolean, pos: Vector3, dt: number): void {
    this.giantIdleT += dt;
    if (!inView || this.dead || s.dead) {
      this.iceAura?.release();
      this.iceAura = null;
      return;
    }
    this.iceAura ??= IceFx.of(this.scene).aura();
    const fury = s.enraged === 1;
    const r = ICE_GIANT.aura.radius * (fury ? ICE_GIANT.fury.auraMul : 1);
    this.iceAura?.place(pos.x, pos.y, pos.z, r, fury, this.giantIdleT < 8);
  }

  /** Шаги гиганта: на касании стопы (доли клипа 0 и 0.5) — тяжёлый удар со звоном льда и иней у ноги. */
  private giantSteps(clip: AnimationGroup | null, pos: Vector3, playerPos: Vector3): void {
    const an = clip?.animatables[0];
    if (!clip || !an || clip.to <= clip.from) return;
    const u = (((an.masterFrame - clip.from) / (clip.to - clip.from)) % 1 + 1) % 1;
    const prev = this.stepU;
    this.stepU = u;
    if (prev < 0) return;
    const crossed = (c: number): boolean => (prev <= u ? prev < c && u >= c : prev < c || u >= c);
    // Левая стопа (касание в начале клипа) — слева, т.е. к −X модели, смотрящей на +Z.
    const side = crossed(0.04) ? -1 : crossed(0.54) ? 1 : 0;
    if (!side) return;
    const k = (MOB.bodyRadius * 1.75 * this.scale) / 2; // метры мира на метр модели (модель — 2 м)
    const yaw = this.root.rotation.y;
    const fx = pos.x + Math.cos(yaw) * side * 0.27 * k;
    const fz = pos.z - Math.sin(yaw) * side * 0.27 * k;
    this.playIfNear(playerPos, () => {
      this.sfx.at({ x: fx, y: pos.y, z: fz }, () => this.sfx.ice("step", 0.85, 0.08));
      IceFx.of(this.scene).burst(fx, pos.y + 0.3, fz, FXC.frost, { count: 8, speed: 2, life: 0.6, grav: 1, size: 0.5 });
    }, 45);
  }

  /** Смерть гиганта: стон и грохот; когда тело рухнуло — лёд разлетается и земля покрывается инеем. */
  private giantDeath(pos: Vector3, playerPos: Vector3): void {
    const yaw = this.root.rotation.y;
    const k = (MOB.bodyRadius * 1.75 * this.scale) / 2;
    const p = { x: pos.x + Math.sin(yaw) * 0.9 * k, y: pos.y, z: pos.z + Math.cos(yaw) * 0.9 * k };
    this.playIfNear(playerPos, () => this.sfx.at(p, () => this.sfx.ice("death")), 60);
    const ice = IceFx.of(this.scene);
    ice.after(1.85, () => {
      ice.shards(SHARD.crater, p, { r: 0.7 * k, hold: 1.4, size: 0.35 * k, count: 32 });
      ice.decal(DECAL.wave, p.x, p.y, p.z, 1.4 * k, 0.6);
      ice.decal(DECAL.frost, p.x, p.y, p.z, 1.05 * k, 7, 0.9);
      ice.burst(p.x, p.y + 1.2, p.z, FXC.iceRim, { count: 28, speed: 9, life: 1.1, grav: 9, size: 0.4 });
      ice.burst(p.x, p.y + 0.6, p.z, FXC.frost, { count: 24, speed: 5, life: 1.6, grav: 1, size: 0.7 });
    });
  }

  /** Пасть Владыки (у кончика морды, идёт за клипом). */
  private lordMouth(): { x: number; y: number; z: number } | null {
    return lordMouth((n) => this.boneWorld(n));
  }

  /** Замах Владыки: укус — рык и щелчок пасти (искры в кадр укуса), крылья — тяжёлый взмах. */
  private lordSwing(kind: number, pos: Vector3, playerPos: Vector3): void {
    this.lordSnortT = Math.max(this.lordSnortT, 3);
    if (kind === 0) {
      const at = this.lordMouth() ?? pos;
      this.playIfNear(playerPos, () => this.sfx.at(at, () => this.sfx.lord("bite", 0.9, 0.06)), 45);
      const fire = FireFx.of(this.scene);
      fire.after(DRAGON.hitSec.bite, () => {
        const m = this.lordMouth();
        if (m) fire.burst(m.x, m.y, m.z, FXC.fire, { count: 10, speed: 3, life: 0.45, grav: 3, size: 0.24 });
      });
    } else if (kind === MOB_SWING.wings) {
      this.playIfNear(playerPos, () => this.sfx.at(pos, () => this.sfx.lord("wings")), 50);
    }
  }

  /**
   * Владыка каждый кадр: огонь ярости у лап (s.enraged — стадия «Ярость»), шаги по касанию стоп (кости
   * передних и задних лап: поднялась выше порога — опустилась на землю → удар, пыль), в покое — фырканье дымом.
   */
  private updateLord(s: MobState, inView: boolean, pos: Vector3, playerPos: Vector3, dt: number): void {
    const live = inView && !this.dead && !s.dead && !!this.rig;
    if (!live) {
      this.lordAura?.release();
      this.lordAura = null;
      this.lordFeet.reset();
      return;
    }
    this.lordK ||= lordScale((n) => this.boneWorld(n));
    if (!this.lordK) return;
    const k = this.lordK;
    const fire = FireFx.of(this.scene);
    this.lordAura ??= fire.aura();
    this.lordAura?.place(pos.x, pos.y, pos.z, 1.3 * k, s.enraged === 1);

    const near = Vector3.DistanceSquared(pos, playerPos) < 45 * 45;
    this.lordFeet.update((n) => this.boneWorld(n), pos.y, k, dt, (p) => {
      if (near) lordStep(fire, this.sfx, p, pos.y, k, this.moveSpd > GAIT_RUN_SPEED ? 0.8 : 0.6);
    });

    // Фырканье: в покое раз в 5–9 с из ноздрей — дым (в ярости — с огнём).
    this.lordSnortT -= dt;
    if (this.atkClipT > 0) this.lordSnortT = Math.max(this.lordSnortT, 2);
    if (this.lordSnortT <= 0 && near) {
      this.lordSnortT = 5 + Math.random() * 4;
      const m = this.lordMouth();
      if (m) {
        const yaw = this.root.rotation.y;
        const rage = s.enraged === 1;
        fire.flame(FLAME.puff, m, {
          b: { x: m.x + Math.sin(yaw) * k, y: m.y - 0.4 * k, z: m.z + Math.cos(yaw) * k },
          r: 0.5 * k, half: 0.5, life: 1.3, size: 0.2 * k, rise: 0.3 * k, count: 12, heat: rage ? 0.75 : 0.22,
        });
        this.sfx.at(m, () => this.sfx.lord("snort", rage ? 0.8 : 0.55, 0.08));
      }
    }
  }

  /** Смерть Владыки: предсмертный рёв; тело рушится (1.45 с) — пыль и искры, голова (1.8 с); потом дым над телом. */
  private lordDeath(at: Vector3, playerPos: Vector3): void {
    this.lordAura?.release();
    this.lordAura = null;
    const pos = { x: at.x, y: at.y, z: at.z }; // эффекты — через секунды, вектор вызывающего к тому времени другой
    this.playIfNear(playerPos, () => this.sfx.at(pos, () => this.sfx.lord("death")), 60);
    const k = this.lordK || 5.4;
    const fire = FireFx.of(this.scene);
    const yaw = this.root.rotation.y;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    fire.after(1.45, () => {
      for (const u of [-0.9, -0.3, 0.3, 0.9]) {
        const px = pos.x + fx * u * k;
        const pz = pos.z + fz * u * k;
        fire.flame(FLAME.puff, { x: px, y: pos.y + 0.2 * k, z: pz }, { r: 0.9 * k, half: 1.4, life: 1.4, size: 0.45 * k, rise: 0.25 * k, count: 12, heat: 0, smoke: DUST });
      }
      fire.burst(pos.x, pos.y + 0.3 * k, pos.z, FXC.fire, { count: 24, speed: 7, life: 1, grav: 6, size: 0.3 });
    });
    fire.after(1.8, () => {
      const px = pos.x + fx * 1.3 * k;
      const pz = pos.z + fz * 1.3 * k;
      fire.flame(FLAME.puff, { x: px, y: pos.y + 0.15 * k, z: pz }, { r: 0.6 * k, half: 1.4, life: 1.1, size: 0.35 * k, rise: 0.2 * k, count: 10, heat: 0, smoke: DUST });
    });
    fire.after(2.2, () => {
      fire.flame(FLAME.disc, { x: pos.x, y: pos.y, z: pos.z }, { r: 1.1 * k, inner: 0, dur: 4, life: 2.2, size: 0.4 * k, rise: 1.2 * k, count: 18, heat: 0.18 });
    });
  }

  private playIfNear(playerPos: Vector3, fn: () => void, range = 28): void {
    if (Vector3.DistanceSquared(this.root.getAbsolutePosition(), playerPos) < range * range) fn();
  }

  /** Сжатие/растяжение тела. Для модели домножаем на её базовый масштаб. */
  private setSquash(x: number, y: number, z: number): void {
    const b = this.rig ? this.baseModelScale : 1;
    // noSquash (Скалолом, Владыка): тело не сжимается — анимации только клипами модели.
    if (this.noSquash) x = y = z = 1;
    this.squash.scaling.set(x * b, y * b, z * b);
  }

  /**
   * Процедурный замах во время атаки (модель без клипа атаки). Ось Z тела —
   * это направление на цель (root повёрнут по s.yaw), поэтому «вперёд» =
   * растянуть по Z. Слизень/босс: короткий замах назад и бросок-«укус».
   * Плевун: резкий тычок вперёд с просадкой — «выплюнул».
   */
  private applyAttackSquash(): void {
    const p = 1 - this.atkT / ATTACK_DUR; // 0 → 1 за время атаки
    if (this.kind === "spitter") {
      const jab = Math.sin(clamp01(p * 1.5) * Math.PI); // 0→1→0 к p≈0.67
      this.setSquash(1 - jab * 0.16, 1 - jab * 0.22, 1 + jab * 0.36);
    } else {
      const wind = p < 0.28 ? Math.sin((p / 0.28) * Math.PI) : 0; // замах назад
      const lunge = p >= 0.2 ? Math.sin(clamp01((p - 0.2) / 0.8) * Math.PI) : 0; // бросок
      const z = 1 - wind * 0.16 + lunge * 0.62;
      const xy = 1 + wind * 0.1 - lunge * 0.4;
      this.setSquash(xy, xy, z);
    }
  }

  private setBodyVisibility(v: number): void {
    if (this.slimeInst) {
      this.slimeInst.setVisibility(v);
    } else if (this.rig) {
      // Инстансы (неанимированные части модели) visibility игнорируют и ругаются
      // в консоль — трогаем только настоящие меши.
      for (const m of this.rig.meshes) if (!m.isAnInstance) m.visibility = v;
    } else {
      this.body.visibility = v;
    }
  }

  /** Насколько моб горит 0..1 — от него зависит ночной свет огня (MobSystem.fireLight). */
  get burning(): number {
    return this.flameRed ? 0 : this.burnGlow * this.burnLightFade;
  }
  /** Языки красные (кровотечение без горения). */
  private flameRed = false;
  /** Множитель света к концу горения: сервер шлёт остаток в целых секундах — последнюю секунду гасим линейно. */
  private burnLightFade = 1;
  private burnLastSecT = 0;

  /** Языки пламени над горящим мобом: несколько аддитивных билбордов, мерцают
   *  и всплывают. Создаётся при первом горении, дальше просто вкл/выкл.
   *  (Пробовали процедурный шейдер огня и текстуру-язык — попросили вернуть
   *  как было: плоские карточки сплошного цвета.) */
  private updateBurnFx(dt: number): void {
    if (FIRE_PARTICLES) {
      // ?fire=1 — огонь частицами (одна общая система на сцену, см. BurnParticles).
      // Кровотечение — своя (красная) система частиц; из другой моба убираем.
      const scene = this.root.getScene();
      const bp = BurnParticles.for(scene, this.flameRed);
      BurnParticles.for(scene, !this.flameRed).remove(this);
      if (this.burnGlow <= 0.001 || this.dead) {
        bp.remove(this);
        return;
      }
      const p = this.root.getAbsolutePosition();
      const sy = Math.abs(this.root.scaling.y) || 1;
      bp.set(this, p.x, p.y + this.burnBaseY * sy, p.z, MOB.bodyRadius * this.scale, this.burnGlow * this.burnLightFade);
      return;
    }
    if (this.burnGlow <= 0.001) {
      this.burnFx?.setEnabled(false);
      return;
    }
    if (!this.burnFx) {
      const scene = this.root.getScene();
      this.burnFx = new TransformNode("mobBurn", scene);
      this.burnFx.parent = this.root;
      this.burnFx.position.y = this.burnBaseY;
      // Весь огонь — один меш из 23 квадов, всплытие/пульсацию/билборд считает шейдер (BurnFlameMat).
      this.burnMat = makeBurnFlameMaterial(scene);
      this.burnMat.setFloat("uR", MOB.bodyRadius);
      this.burnMesh = createBurnFlameMesh(scene, "mobFlames");
      this.burnMesh.material = this.burnMat;
      this.burnMesh.parent = this.burnFx;
    }
    this.burnFx.setEnabled(true);
    this.burnT += dt;
    if (this.burnMat) {
      this.burnMat.setFloat("uTime", this.burnT);
      this.burnMat.setFloat("uGlow", this.burnGlow);
      this.burnMat.setFloat("uShift", MOB.bodyRadius * 2 * this.scale);
      if (this.flameRed) this.burnMat.setColor3("uColor", FLAME_BLOOD);
      else this.burnMat.setColor3("uColor", FLAME_FIRE);
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

  /**
   * Ударная волна слэма. Босс — плоское кольцо на земле, разбегается и гаснет.
   * Чародей руин (нова с отталкиванием) — полупрозрачный КУПОЛ: полусфера
   * раздувается до радиуса новы (MAGE_NOVA.radius) и гаснет.
   */
  private startSlamRing(): void {
    if (!this.slamRing) {
      let m: Mesh;
      if (this.isBoss) {
        m = MeshBuilder.CreateTorus("bossSlam", { diameter: 2, thickness: 0.18, tessellation: 24 }, this.scene);
        m.rotation.x = Math.PI / 2;
      } else {
        m = MeshBuilder.CreateSphere("mageNova", { diameter: 2, segments: 20, slice: 0.5 }, this.scene);
      }
      const mat = new StandardMaterial(this.isBoss ? "bossSlamMat" : "mageNovaMat", this.scene);
      mat.emissiveColor = this.isBoss ? new Color3(1, 0.35, 0.2) : new Color3(1, 0.16, 0.1);
      mat.diffuseColor = new Color3(0, 0, 0);
      mat.specularColor = new Color3(0, 0, 0);
      mat.disableLighting = true;
      mat.backFaceCulling = false;
      mat.disableDepthWrite = true;
      mat.alpha = this.slamAlpha();
      m.material = mat;
      m.isPickable = false;
      groundFxThrough(m);
      m.parent = this.root;
      this.slamRing = m;
    }
    this.slamRing.setEnabled(true);
    this.slamRing.scaling.setAll(this.slamScale(0));
    (this.slamRing.material as StandardMaterial).alpha = this.slamAlpha();
    this.slamRingT = 0.45;
  }

  private slamAlpha(): number {
    return this.isBoss ? 0.9 : 0.32; // купол мага — как купол оглушения мечника
  }

  /** Локальный масштаб волны в фазе k (0..1): босс ~5 м, купол мага — ровно радиус новы в мире. */
  private slamScale(k: number): number {
    if (this.isBoss) return 0.3 + k * 4.7;
    return (MAGE_NOVA.radius / Math.max(0.1, this.scale)) * (0.15 + 0.85 * k);
  }

  private animateSlamRing(dt: number): void {
    if (!this.slamRing) return;
    this.slamRingT -= dt;
    const k = 1 - Math.max(0, this.slamRingT) / 0.45;
    this.slamRing.scaling.setAll(this.slamScale(k));
    (this.slamRing.material as StandardMaterial).alpha = this.slamAlpha() * (1 - k);
    if (this.slamRingT <= 0) this.slamRing.setEnabled(false);
  }

  /**
   * Купол щита отражения: локальный радиус 0.65 (2026-10-19; было 1.25 → 0.875) — чуть больше модели (рост ≈0.96
   * при центре на 0.55); корень масштабирован ростом моба, купол растёт вместе с ним.
   */
  private makeReflectShield(): Mesh {
    const m = MeshBuilder.CreateSphere(`reflectShield_${this.id}`, { diameter: 1.3, segments: 16 }, this.scene);
    m.parent = this.root;
    // Центр тела — та же точка, что у прицела и попаданий (MOB.bodyRadius над подошвой).
    m.position.set(0, MOB.bodyRadius, 0);
    m.isPickable = false;
    const mat = new StandardMaterial(`reflectShieldMat_${this.id}`, this.scene);
    mat.emissiveColor = new Color3(0.5, 0.9, 1.0);
    mat.diffuseColor = new Color3(0, 0, 0);
    mat.specularColor = new Color3(0, 0, 0);
    mat.disableLighting = true;
    mat.disableDepthWrite = true;
    mat.alphaMode = Constants.ALPHA_ADD;
    mat.backFaceCulling = false;
    m.material = mat;
    return m;
  }

  dispose(): void {
    this.iceAura?.release();
    this.iceAura = null;
    this.lordAura?.release();
    this.lordAura = null;
    this.reflectShield?.material?.dispose();
    this.reflectShield?.dispose();
    for (const l of this.lodSlots ?? []) l.batch.release(l.slot);
    this.lodSlots = null;
    this.shadow.dispose();
    this.nameTag?.dispose();
    this.bar?.dispose();
    this.slamRing?.material?.dispose();
    this.stunStarMat?.dispose();
    this.burnMat?.dispose();
    this.burnMesh?.dispose();
    if (FIRE_PARTICLES) {
      BurnParticles.for(this.root.getScene()).remove(this);
      BurnParticles.for(this.root.getScene(), true).remove(this);
    }
    this.mat.dispose();
    this.rig?.dispose();
    this.rig = null;
    this.root.dispose(false, false);
  }
}
