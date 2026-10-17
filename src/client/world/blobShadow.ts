import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

import { CAT_FLOOR_Y, inCatRegion } from "#shared/catacombs";
import { terrainHeight } from "#shared/terrain";
import { groundFxThrough } from "../ui/groundFx";
import { catTune } from "./catTune";

/** Диаметр прототипа, м. Реальный размер задаётся масштабом инстанса. */
const PROTO_SIZE = 2;
/** Непрозрачность пятна, когда объект лежит на земле (наружу). */
const ALPHA = 0.28;
/** Выше этой высоты тень уже почти не видна, м. */
const FADE_HEIGHT = 3;
/** Приподнимаем над землёй, чтобы не спорить с ней по глубине. */
const LIFT = 0.07;
/**
 * Катакомбы: пол ровный на CAT_FLOOR_Y, земля тёмная — пятно плотнее (плотность — catTune.shadow).
 * Выше пола — с обычной глубиной: колонны и стены его закрывают, а не проступают поверх.
 */
const CAT_LIFT = 0.12;
/** Плечо для замера уклона земли, м. */
const SLOPE_D = 0.6;

/**
 * Мягкое тёмное пятно под объектом — дешёвая замена тени.
 *
 * Настоящие тени в мире не считаются (солнце движется, а на Quest лишний
 * проход глубины дорог), но без опоры прыгающий моб читается как парящий.
 * Пятно остаётся на земле, пока моб в воздухе, и по нему сразу видно высоту
 * прыжка: чем выше, тем шире и бледнее.
 *
 * Пятно — эллипс по следу модели: полуширина и полудлина (rx, rz) и поворот по курсу,
 * а не круг по высоте тела. Диск НАКЛОНЯЕТСЯ по нормали рельефа.
 *
 * Четыре набора пятен на сцену: наружу/катакомбы × резкое/мягкое (мягкое — у героев).
 * В каждом наборе — один меш с тонкими инстансами.
 */
const SOFT_CORE = 0.4;
const SHARP_CORE = 0.55;
/** Наборов пятен: 2 места (наружу/катакомбы) × мягкое/резкое × плотное (супербосс). */
const SETS = 8;

const batches = new WeakMap<Scene, (Batch | null)[]>();
const mats = new WeakMap<Scene, (StandardMaterial | null)[]>();
const texs = new WeakMap<Scene, (DynamicTexture | null)[]>();
const protos = new WeakMap<Scene, Mesh>();

/**
 * Индекс набора: бит 1 — катакомбы, бит 2 — мягкое пятно (герои), бит 4 — плотное пятно
 * (супербосс катакомб: своя непрозрачность catTune.boss, см. setCatBossShadowAlpha).
 */
function setIndex(cat: boolean, soft: boolean, dense: boolean): number {
  return (cat ? 1 : 0) + (soft ? 2 : 0) + (dense ? 4 : 0);
}

/**
 * Пятно: плотная середина до `core` радиуса, дальше плавно сходит к краю.
 * Мягкое — середина короче и край шире, без жёсткой кромки.
 */
function shadowTexture(scene: Scene, soft: boolean): DynamicTexture {
  const list = texs.get(scene) ?? [null, null];
  texs.set(scene, list);
  const i = soft ? 1 : 0;
  const found = list[i];
  if (found) return found;
  const S = 128;
  const tex = new DynamicTexture(soft ? "blobShadowSoftTex" : "blobShadowTex", { width: S, height: S }, scene, false);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, S, S);
  const core = soft ? SOFT_CORE : SHARP_CORE;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  const STOPS = 24;
  for (let k = 0; k <= STOPS; k++) {
    const r = k / STOPS;
    const t = Math.max(0, (r - core) / (1 - core));
    const a = 1 - t * t * (3 - 2 * t);
    g.addColorStop(r, `rgba(0,0,0,${a.toFixed(4)})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  tex.update(true);
  list[i] = tex;
  return tex;
}

/** Материал набора. Наружу — мягче по тени земли (ALPHA), в катакомбах — catTune.shadow (плотное — catTune.boss). */
function matFor(scene: Scene, idx: number): StandardMaterial {
  const list = mats.get(scene) ?? new Array<StandardMaterial | null>(SETS).fill(null);
  mats.set(scene, list);
  const found = list[idx];
  if (found) return found;
  const cat = (idx & 1) === 1;
  const soft = (idx & 2) === 2;
  const dense = idx >= 4;
  const mat = new StandardMaterial(`blobShadowMat${idx}`, scene);
  mat.diffuseColor = new Color3(0, 0, 0);
  mat.emissiveColor = new Color3(0, 0, 0);
  mat.specularColor = new Color3(0, 0, 0);
  mat.opacityTexture = shadowTexture(scene, soft);
  mat.disableLighting = true;
  mat.disableDepthWrite = true; // иначе пятна спорят друг с другом
  mat.backFaceCulling = false; // наклон может повернуть диск изнанкой
  mat.alpha = cat ? (dense ? catTune.boss : catTune.shadow) : ALPHA;
  list[idx] = mat;
  return mat;
}

/** Экспортирован для мест с плоским полом (напр. TowerArenaFx) — свой класс без наклона по рельефу. */
export function protoFor(scene: Scene): Mesh {
  const found = protos.get(scene);
  if (found) return found;
  const proto = MeshBuilder.CreatePlane("blobShadowProto", { size: PROTO_SIZE }, scene);
  proto.material = matFor(scene, 0);
  proto.isPickable = false;
  // Пятно просвечивает землю и склоны, как круги эффектов (groundFx.ts): без теста глубины.
  groundFxThrough(proto);
  proto.isVisible = false; // рисуем только инстансы
  protos.set(scene, proto);
  return proto;
}

/** Плотность пятен в катакомбах (панель ?cattune=1 двигает на лету). */
export function setCatShadowAlpha(scene: Scene, alpha: number): void {
  matFor(scene, 1).alpha = alpha;
  matFor(scene, 3).alpha = alpha;
}

/** Плотность пятна супербосса в катакомбах — отдельно от прочих (catTune.boss, панель ?cattune=1). */
export function setCatBossShadowAlpha(scene: Scene, alpha: number): void {
  matFor(scene, 5).alpha = alpha;
}

const _n = new Vector3();
const _t = new Vector3();
const _b = new Vector3();
const _ax = new Vector3();
const UP = new Vector3(0, 1, 0);

/**
 * Все пятна набора — ОДИН меш с тонкими инстансами (thin instances): раньше у каждого моба и
 * героя был свой InstancedMesh, и на каждый из них шёл пересчёт матрицы, регистрация в кадре и
 * запись в буфер инстансов (~20 штук — заметная доля CPU-времени кадра в VR). Теперь слот —
 * 16 чисел в общем буфере, который грузится на GPU одним вызовом, только если что-то менялось.
 */
interface Batch {
  mesh: Mesh;
  buf: Float32Array;
  cap: number;
  used: number; // верхняя граница занятых слотов
  free: number[];
  dirty: boolean;
}
const ZERO16 = new Float32Array(16);

function batchFor(scene: Scene, idx: number): Batch {
  const list = batches.get(scene) ?? new Array<Batch | null>(SETS).fill(null);
  batches.set(scene, list);
  const found = list[idx];
  if (found && !found.mesh.isDisposed()) return found;
  const cat = (idx & 1) === 1;
  const mesh = MeshBuilder.CreatePlane(`blobShadows${idx}`, { size: PROTO_SIZE }, scene);
  mesh.material = matFor(scene, idx);
  // Наружу: группа и тест глубины ставим сразу — отложенный обработчик сцены не должен отнести пятна в мир.
  // В катакомбах — обычная глубина: колонны и стены закрывают пятно.
  if (!cat) groundFxThrough(mesh);
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true; // границы пятен по всей карте — не отсекаем по рамке плоскости
  const b: Batch = { mesh, buf: new Float32Array(64 * 16), cap: 64, used: 0, free: [], dirty: false };
  mesh.thinInstanceSetBuffer("matrix", b.buf, 16, false);
  mesh.thinInstanceCount = 0;
  scene.onBeforeRenderObservable.add(() => {
    if (!b.dirty) return;
    b.dirty = false;
    mesh.thinInstanceCount = b.used;
    mesh.thinInstanceBufferUpdated("matrix");
  });
  list[idx] = b;
  return b;
}

function grow(b: Batch): void {
  const cap = b.cap * 2;
  const buf = new Float32Array(cap * 16);
  buf.set(b.buf);
  b.buf = buf;
  b.cap = cap;
  b.mesh.thinInstanceSetBuffer("matrix", buf, 16, false);
}

/** Пятно под одним объектом. Двигать через `place()`. */
export class BlobShadow {
  private readonly scene: Scene;
  private readonly soft: boolean;
  private readonly dense: boolean;
  private batch: Batch;
  private slot: number;
  /** Текущий набор (см. setIndex). */
  private idx: number;
  private enabled = true;
  /** Последние параметры place(): у стоящего моба они не меняются — пересчёт пропускаем. */
  private lx = NaN;
  private ly = NaN;
  private lz = NaN;
  private lrx = NaN;
  private lrz = NaN;
  private lyaw = NaN;
  private disposed = false;
  private readonly m = new Float32Array(16);

  /**
   * soft — мягкое пятно (герои): шире по краю, без жёсткой кромки.
   * dense — плотное пятно (супербосс катакомб): в катакомбах темнее, см. catTune.boss.
   */
  constructor(scene: Scene, _name: string, soft = false, dense = false) {
    this.scene = scene;
    this.soft = soft;
    this.dense = dense;
    this.idx = setIndex(false, soft, dense);
    this.batch = batchFor(scene, this.idx);
    const b = this.batch;
    this.slot = b.free.pop() ?? b.used++;
    if (this.slot >= b.cap) grow(b);
    this.write(ZERO16); // пока не размещено — пятна нет
  }

  private write(m: Float32Array): void {
    const b = this.batch;
    b.buf.set(m, this.slot * 16);
    b.dirty = true;
  }

  /** Переехать в другой набор (наружу ↔ катакомбы): старый слот освобождаем. */
  private moveTo(idx: number): void {
    const old = this.batch;
    old.buf.set(ZERO16, this.slot * 16);
    old.dirty = true;
    old.free.push(this.slot);
    const b = batchFor(this.scene, idx);
    this.batch = b;
    this.slot = b.free.pop() ?? b.used++;
    if (this.slot >= b.cap) grow(b);
    this.idx = idx;
  }

  /**
   * @param x,y,z мировая точка объекта (y — его низ)
   * @param rx полуширина пятна на земле, м (поперёк курса)
   * @param rz полудлина пятна на земле, м (вдоль курса; по умолчанию — как rx, круг)
   * @param yaw курс объекта, рад (поворот эллипса; у круга не важен)
   */
  place(x: number, y: number, z: number, rx: number, rz = rx, yaw = 0): void {
    if (this.disposed) return;
    const cat = inCatRegion(x, z);
    const idx = setIndex(cat, this.soft, this.dense);
    if (idx !== this.idx) {
      this.moveTo(idx);
      this.lx = NaN; // переехали — матрицу пересчитываем
    }
    if (
      Math.abs(x - this.lx) < 3e-2 &&
      Math.abs(y - this.ly) < 3e-2 &&
      Math.abs(z - this.lz) < 3e-2 &&
      Math.abs(rx - this.lrx) < 3e-2 &&
      Math.abs(rz - this.lrz) < 3e-2 &&
      Math.abs(yaw - this.lyaw) < 1e-2
    ) {
      return;
    }
    this.lx = x;
    this.ly = y;
    this.lz = z;
    this.lrx = rx;
    this.lrz = rz;
    this.lyaw = yaw;
    // Катакомбы: пол ровный, рельефа нет — пятно на полу, по вертикали.
    const ground = cat ? CAT_FLOOR_Y : terrainHeight(x, z);
    if (cat) {
      _n.copyFrom(UP);
    } else {
      // Нормаль рельефа: по ней кладём диск, иначе он режется о склон.
      const dhdx = (terrainHeight(x + SLOPE_D, z) - terrainHeight(x - SLOPE_D, z)) / (2 * SLOPE_D);
      const dhdz = (terrainHeight(x, z + SLOPE_D) - terrainHeight(x, z - SLOPE_D)) / (2 * SLOPE_D);
      _n.set(-dhdx, 1, -dhdz).normalize();
    }
    // Ось «поперёк курса» — X локальной системы объекта (по повороту Babylon RotationY),
    // в плоскости земли. Вторая ось — перпендикуляр к ней и нормали.
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    _ax.set(c, 0, -s);
    _t.copyFrom(_ax);
    _t.subtractInPlace(_n.scale(Vector3.Dot(_ax, _n)));
    if (_t.lengthSquared() < 1e-6) _t.set(1, 0, 0);
    _t.normalize();
    Vector3.CrossToRef(_n, _t, _b);

    // Чем выше объект, тем шире и бледнее пятно — по нему и читается прыжок.
    const h = Math.max(0, y - ground);
    const k = Math.min(1, h / FADE_HEIGHT);
    // Высоко в прыжке пятно чуть сжимается — тоже читается как высота.
    const f = (1 + k * 0.6) * (1 - k * 0.3);
    const sx = rx * f; // полуоси плоскости (PROTO_SIZE = 2 → масштаб = полуразмер)
    const sz = rz * f;
    // Матрица «масштаб · поворот · сдвиг» из базиса (t, b, n) прямо в буфер (строки Babylon).
    const m = this.m;
    m[0] = _t.x * sx; m[1] = _t.y * sx; m[2] = _t.z * sx; m[3] = 0;
    m[4] = _b.x * sz; m[5] = _b.y * sz; m[6] = _b.z * sz; m[7] = 0;
    m[8] = _n.x * sx; m[9] = _n.y * sx; m[10] = _n.z * sx; m[11] = 0;
    m[12] = x; m[13] = ground + (cat ? CAT_LIFT : LIFT); m[14] = z; m[15] = 1;
    if (this.enabled) this.write(m);
  }

  setEnabled(on: boolean): void {
    if (this.disposed || on === this.enabled) return;
    this.enabled = on;
    this.write(on && Number.isFinite(this.lx) ? this.m : ZERO16);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.write(ZERO16);
    this.batch.free.push(this.slot);
  }
}
