import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import "@babylonjs/core/Meshes/instancedMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Constants } from "@babylonjs/core/Engines/constants";

import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { Quaternion } from "@babylonjs/core/Maths/math.vector";

import { BOSS_CFG, ELITE_MOBS, MOB, SHARD_CFG, SLIME_CFG, SPITTER_CFG } from "#shared/constants";
import type { MobKind, MobState } from "#shared/net/schema";
import type { RigInstance, ModelName } from "../world/models";
import { HealthBar3D } from "../ui/HealthBar3D";
import { NameTag } from "../ui/NameTag";
import { trackMobMaterial } from "./mobLightTune";
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

/** Длительность процедурного замаха моба, с. */
const ATTACK_DUR = 0.36;

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
    trackMobMaterial(flat); // ?moblight=1 — живая подстройка поверх базовых цветов
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
    let g = groups.get(mat);
    if (!g) {
      g = { mat, pos: [], uv: [], idx: [] };
      groups.set(mat, g);
    }
    const base = g.pos.length / 3;
    for (let i = 0; i < pos.length; i += 3) {
      Vector3.TransformCoordinatesFromFloatsToRef(pos[i], pos[i + 1], pos[i + 2], W, tmp);
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
  if (!(h > expect * 0.5 && h < expect * 1.8) || Math.abs(minY) > expect * 0.45) return null;
  if (Math.abs((minX + maxX) / 2) > expect || Math.abs((minZ + maxZ) / 2) > expect) return null;

  // Кластеризация: увеличиваем ячейку, пока суммарно не уложимся в ~220 треугольников.
  const size = Math.max(maxX - minX, h, maxZ - minZ);
  let cell = size / 16;
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
    const uv: number[] = [];
    for (let ci = 0; ci < sum.length / 6; ci++) {
      const n = sum[ci * 6 + 5];
      pos.push(sum[ci * 6] / n, sum[ci * 6 + 1] / n, sum[ci * 6 + 2] / n);
      uv.push(sum[ci * 6 + 3] / n, sum[ci * 6 + 4] / n);
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
    if (tris <= 220) break;
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

export class Mob implements Hittable {
  readonly root: TransformNode;
  private readonly body: Mesh;
  private readonly head: TransformNode;
  private readonly hitAnchor: TransformNode;
  private readonly mat: StandardMaterial;
  private bar: HealthBar3D | null = null;
  private nameTag: NameTag | null = null;
  private readonly tagName: string;
  private readonly tagLevel: number;
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
  private burnFlames: Mesh[] = [];
  private burnMat: StandardMaterial | null = null;
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
  private lodProxies: InstancedMesh[] | null = null;
  private lodFar = false;
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

  /** Модель из пака (если подключена): она заменяет процедурную сферу. */
  private rig: RigInstance | null = null;
  /** Клип «движение/прыжок» найденной модели (имя зависит от пака). */
  private moveAnim: AnimationGroup | null = null;
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
    const tagLevel = mobLevel > 0 ? mobLevel : cfg.level;
    this.tint = cfg.tint;
    this.bodyAlpha = cfg.alpha;
    this.isBoss = kind === "boss";
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
    this.hitAnchor.position.y = MOB.bodyRadius;

    // Полоса и плашка висят на отдельном узле: у босса тело крупное, а надписи
    // должны оставаться обычного размера — этот узел компенсирует масштаб.
    this.uiAnchor = new TransformNode("mobUi", scene);
    this.shadow = new BlobShadow(scene, id);
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
    for (let i = 0; i < 3; i++) {
      const star = MeshBuilder.CreateBox(`mobStunStar${i}`, { size: 0.13 }, scene);
      star.material = starMat;
      star.isPickable = false;
      star.parent = spin;
      const a = (i / 3) * Math.PI * 2;
      star.position.set(Math.cos(a) * 0.32, Math.sin(a * 2) * 0.05, Math.sin(a) * 0.32);
      star.rotation.set(0.6, a, 0.4);
    }
    this.stunSpin = spin;
    this.stunStarMat = starMat;
  }
  /** Пятно-тень под мобом: без неё прыжок читается как парение. */
  private readonly shadow: BlobShadow;

  /** Подменить процедурную сферу моделью слизня из пака. */
  private async attachModel(): Promise<void> {
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

    // Высота модели ≈ ~1.75 радиуса тела (модель слизня приземистее сферы;
    // на s.scale для босса домножается через this.root отдельно).
    const base = (MOB.bodyRadius * 1.75) / rig.nativeHeight;
    holder.scaling.setAll(base);

    // Мобам лагерей (пчела и т.п.) оставляем родные текстуры пака (только
    // эмиссивная заливка под дневной свет); перекрашиваем под цвет кинда
    // только стандартных слизней/плевунов/босса.
    if (this.modelName) {
      const { recolorMonster } = await import("../world/models");
      const def = Object.values(ELITE_MOBS).find((d) => d.model === this.modelName);
      recolorMonster(rig.root, def?.tint ? new Color3(...def.tint) : undefined);
      if (def?.tint) this.lodTint = def.tint;
    } else {
      recolorRig(rig, this.kind, this.tint, this.bodyAlpha);
      this.lodTint = this.tint;
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
    // Моб за спиной камеры / вне кадра: выключаем его узлы целиком (Babylon не
    // обходит их для отсечения/матриц) и не двигаем тень. Запас по радиусу
    // большой — камера успевает довернуть, пока план кадра отстаёт на кадр.
    const inView = drawAllowed && this.inFrustum(pos, 6 + 4 * this.scale);
    if (!this.deadHidden && inView === this.viewHidden) {
      this.viewHidden = !inView;
      this.root.setEnabled(inView);
      this.shadow.setEnabled(inView && !this.dead); // тень — отдельный инстанс, не ребёнок root
    }
    // Пятно остаётся на земле, пока моб в прыжке — по нему видно высоту.
    if (!this.dead && inView) {
      this.shadow.place(pos.x, pos.y, pos.z, MOB.bodyRadius * this.scale * 1.75);
    }

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
      return;
    }

    this.updateFarLod(pos, playerPos);

    // атака моба: attackSeq вырос -> процедурный замах телом
    if (s.attackSeq !== this.lastAtkSeq) {
      this.lastAtkSeq = s.attackSeq;
      if (!this.dead) this.atkT = ATTACK_DUR;
    }
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


    // урон: hurtSeq вырос -> вспышка + рана + звук
    if (s.hurtSeq !== this.lastHurtSeq) {
      this.lastHurtSeq = s.hurtSeq;
      this.flash = 1;
      if (!this.lean) {
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

    // Горение (поджог мага): языки пламени над мобом + тлеющий пульс тела.
    const burning = s.burning > 0 && !s.dead;
    this.burnGlow = burning
      ? Math.min(1, this.burnGlow + dt * 5)
      : Math.max(0, this.burnGlow - dt * 3);
    this.updateBurnFx(dt);
    const ember = this.burnGlow > 0 ? this.burnGlow * (0.35 + 0.25 * Math.sin(pos.y * 40 + performance.now() * 0.012)) : 0;

    this.mat.emissiveColor.set(
      this.tint[0] * 0.28 + this.flash * 0.6 + ember,
      this.tint[1] * 0.2 + this.flash * 0.1 + ember * 0.35,
      this.tint[2] * 0.32,
    );

    // смерть / возрождение
    if (s.dead && !this.dead) {
      this.dead = true;
      this.deathT = 0;
      this.burnGlow = 0;
      this.burnFx?.setEnabled(false);
      this.shadow.setEnabled(false);
      this.setFarLod(false);
      if (this.rig) this.playAnim(this.rig.anims.get("death"), false);
      this.playIfNear(playerPos, () => this.sfx.mobDie(pos));
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
      if (seen && (s.grounded === 0 || flyer)) this.playAnim(this.moveAnim, true);
      else this.stopAnim();
    }

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

    // Ярость: пульсирующее багровое свечение (босс и разъярённый элита события).
    if (s.enraged && !s.dead) {
      this.ragePulse += dt * 6;
      this.flash = Math.max(this.flash, 0.25 + Math.sin(this.ragePulse) * 0.15);
    }

    if (s.grounded === 0 && this.grounded) this.playIfNear(playerPos, () => this.sfx.mobHop(pos), 20);
    this.grounded = s.grounded === 1;

    // Облегчённый вид (стрим): без плашки и полоски HP — их рисует оверлей страницы.
    if (this.lean) return;

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
      this.getTag().setScale((2 + t * 2) * this.uiScale);
    }
  }

  /** Дальше этого (м) живого моба рисуем сферой вместо модели со скелетом. */
  private static readonly LOD_FAR = 55;

  private setFarLod(want: boolean): void {
    const rig = this.rig;
    if (!rig || want === this.lodFar) return;
    if (want && !this.rigReady) return; // модель ещё не перекрашена
    if (want && !this.lodProxies) {
      const key = `${this.modelName}|${this.kind}`;
      let srcs = lodCache.get(key);
      if (srcs === undefined || (srcs && srcs[0].isDisposed())) {
        srcs = lodBuild(this.scene, key, rig.meshes, this.root);
        lodCache.set(key, srcs);
      }
      if (!srcs) srcs = lodSphere(this.scene, this.lodTint);
      this.lodProxies = srcs.map((src) => {
        const inst = src.createInstance("mobLod");
        inst.parent = this.root;
        inst.isPickable = false;
        return inst;
      });
    }
    this.lodFar = want;
    rig.root.setEnabled(!want);
    for (const p of this.lodProxies ?? []) p.setEnabled(want);
    if (want) this.stopAnim();
  }

  private updateFarLod(pos: Vector3, cam: Vector3): void {
    if (!this.rig) return;
    if (this.dead || this.isBoss || this.hasNovaFx) {
      this.setFarLod(false);
      return;
    }
    const lim = this.lodFar ? Mob.LOD_FAR - 6 : Mob.LOD_FAR;
    const d2 = (pos.x - cam.x) ** 2 + (pos.z - cam.z) ** 2;
    this.setFarLod(d2 > lim * lim);
  }

  /** Дальше этого от камеры скелетную анимацию моба не крутим. */
  private static readonly ANIM_RANGE = 85;
  /** В VR мобов дальше этого (м) не рисуем и не считаем. */
  private static readonly VR_CULL_RANGE = 130;
  /** В VR скелетную анимацию считаем только ближе этого (м). */
  private static readonly VR_ANIM_RANGE = 28;

  /** Моб в кадре и не слишком далеко — тогда анимацию стоит считать. */
  private animVisible(pos: Vector3, cam: Vector3): boolean {
    const dx = pos.x - cam.x;
    const dz = pos.z - cam.z;
    const vr = !!(this.scene.activeCamera as { rigCameras?: unknown[] } | null)?.rigCameras?.length;
    const range = vr ? Mob.VR_ANIM_RANGE : Mob.ANIM_RANGE;
    if (dx * dx + dz * dz > range * range) return false;
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

  private playIfNear(playerPos: Vector3, fn: () => void, range = 28): void {
    if (Vector3.DistanceSquared(this.root.getAbsolutePosition(), playerPos) < range * range) fn();
  }

  /** Сжатие/растяжение тела. Для модели домножаем на её базовый масштаб. */
  private setSquash(x: number, y: number, z: number): void {
    const b = this.rig ? this.baseModelScale : 1;
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
    if (this.rig) {
      // Инстансы (неанимированные части модели) visibility игнорируют и ругаются
      // в консоль — трогаем только настоящие меши.
      for (const m of this.rig.meshes) if (!m.isAnInstance) m.visibility = v;
    } else {
      this.body.visibility = v;
    }
  }

  /** Языки пламени над горящим мобом: несколько аддитивных билбордов, мерцают
   *  и всплывают. Создаётся при первом горении, дальше просто вкл/выкл.
   *  (Пробовали процедурный шейдер огня и текстуру-язык — попросили вернуть
   *  как было: плоские карточки сплошного цвета.) */
  private updateBurnFx(dt: number): void {
    if (this.burnGlow <= 0.001) {
      this.burnFx?.setEnabled(false);
      return;
    }
    if (!this.burnFx) {
      const scene = this.root.getScene();
      this.burnFx = new TransformNode("mobBurn", scene);
      this.burnFx.parent = this.root;
      this.burnMat = new StandardMaterial("mobBurnMat", scene);
      this.burnMat.disableLighting = true;
      this.burnMat.diffuseColor = new Color3(0, 0, 0);
      this.burnMat.specularColor = new Color3(0, 0, 0);
      this.burnMat.emissiveColor = new Color3(1, 0.5, 0.12);
      this.burnMat.alphaMode = Constants.ALPHA_ADD;
      this.burnMat.disableDepthWrite = true;
      const r = MOB.bodyRadius;
      for (let i = 0; i < 5; i++) {
        const f = MeshBuilder.CreatePlane(`mobFlame${i}`, { size: r * 1.7 }, scene);
        f.material = this.burnMat;
        f.isPickable = false;
        f.billboardMode = Mesh.BILLBOARDMODE_Y;
        f.renderingGroupId = 1;
        const a = (i / 5) * Math.PI * 2;
        f.position.set(Math.cos(a) * r * 0.55, r * 0.4, Math.sin(a) * r * 0.55);
        f.parent = this.burnFx;
        this.burnFlames.push(f);
      }
    }
    this.burnFx.setEnabled(true);
    this.burnT += dt;
    const r = MOB.bodyRadius;
    for (let i = 0; i < this.burnFlames.length; i++) {
      const f = this.burnFlames[i];
      const ph = this.burnT * 7 + i * 1.7;
      const rise = (this.burnT * 1.8 + i * 0.37) % 1;
      f.position.y = r * (0.15 + rise * 1.5);
      const s = (1 - rise) * (0.7 + 0.5 * Math.sin(ph)) * this.burnGlow;
      f.scaling.setAll(Math.max(0.05, s));
    }
    if (this.burnMat) {
      this.burnMat.alpha = 0.275 * this.burnGlow;
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
    this.nameTag?.dispose();
    this.bar?.dispose();
    this.slamRing?.material?.dispose();
    this.stunStarMat?.dispose();
    this.burnMat?.dispose();
    this.mat.dispose();
    // Свои «плоские» материалы гасим без текстур: атлас общий у всех копий модели.
    for (const m of this.rig?.meshes ?? []) {
      if (m.material?.name.endsWith("_flat")) m.material.dispose(false, false);
    }
    this.rig?.dispose();
    this.rig = null;
    this.root.dispose(false, false);
  }
}
