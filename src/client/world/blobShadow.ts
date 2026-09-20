import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

import { terrainHeight } from "#shared/terrain";

/** Диаметр прототипа, м. Реальный размер задаётся масштабом инстанса. */
const PROTO_SIZE = 2;
/** Непрозрачность пятна, когда объект лежит на земле. */
const ALPHA = 0.28;
/** Выше этой высоты тень уже почти не видна, м. */
const FADE_HEIGHT = 3;
/** Приподнимаем над землёй, чтобы не спорить с ней по глубине. */
const LIFT = 0.07;
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
 * Диск НАКЛОНЯЕТСЯ по нормали рельефа. Плоский он резался о склон, и от
 * круга оставалась половина — под землёй его отсекало по глубине.
 *
 * Один прототип и материал на сцену, дальше — аппаратные инстансы.
 */
const protos = new WeakMap<Scene, Mesh>();

/**
 * Пятно с плотной серединой: у светлячков спад `pow(1-r, 2.4)` — он даёт
 * ореол, а не тень, и середина выходит жидкой. Здесь держим почти
 * непрозрачно до 55% радиуса и мягко сводим к краю.
 */
function shadowTexture(scene: Scene): DynamicTexture {
  const S = 128;
  const tex = new DynamicTexture("blobShadowTex", { width: S, height: S }, scene, false);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  const STOPS = 20;
  for (let i = 0; i <= STOPS; i++) {
    const r = i / STOPS;
    const t = Math.max(0, (r - 0.55) / 0.45); // до 55% — плотно
    const a = 1 - t * t * (3 - 2 * t);
    g.addColorStop(r, `rgba(0,0,0,${a.toFixed(4)})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  tex.update(true);
  return tex;
}

/** Экспортирован для мест с плоским полом (напр. TowerArenaFx) — свой класс без наклона по рельефу. */
export function protoFor(scene: Scene): Mesh {
  const found = protos.get(scene);
  if (found) return found;

  const mat = new StandardMaterial("blobShadowMat", scene);
  mat.diffuseColor = new Color3(0, 0, 0);
  mat.emissiveColor = new Color3(0, 0, 0);
  mat.specularColor = new Color3(0, 0, 0);
  mat.opacityTexture = shadowTexture(scene);
  mat.disableLighting = true;
  mat.disableDepthWrite = true; // иначе пятна спорят друг с другом
  mat.backFaceCulling = false; // наклон может повернуть диск изнанкой
  mat.alpha = ALPHA;

  const proto = MeshBuilder.CreatePlane("blobShadowProto", { size: PROTO_SIZE }, scene);
  proto.material = mat;
  proto.isPickable = false;
  proto.renderingGroupId = 0;
  proto.isVisible = false; // рисуем только инстансы
  protos.set(scene, proto);
  return proto;
}

const _n = new Vector3();
const _t = new Vector3();
const _b = new Vector3();
const _fwd = new Vector3(0, 0, 1);

/**
 * Все пятна сцены — ОДИН меш с тонкими инстансами (thin instances): раньше у каждого моба и
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
const batches = new WeakMap<Scene, Batch>();
const ZERO16 = new Float32Array(16);

function batchFor(scene: Scene): Batch {
  const found = batches.get(scene);
  if (found && !found.mesh.isDisposed()) return found;
  const mesh = MeshBuilder.CreatePlane("blobShadows", { size: PROTO_SIZE }, scene);
  mesh.material = protoFor(scene).material;
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
  batches.set(scene, b);
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
  private readonly batch: Batch;
  private readonly slot: number;
  private enabled = true;
  /** Последние параметры place(): у стоящего моба они не меняются — пересчёт
   *  (5 запросов высоты рельефа + базис) пропускаем. */
  private lx = NaN;
  private ly = NaN;
  private lz = NaN;
  private lr = NaN;
  private disposed = false;
  private readonly m = new Float32Array(16);

  constructor(scene: Scene, _name: string) {
    this.batch = batchFor(scene);
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

  /**
   * @param x,y,z мировая точка объекта (y — его низ)
   * @param radius радиус пятна на земле, м
   */
  place(x: number, y: number, z: number, radius: number): void {
    if (this.disposed) return;
    if (
      Math.abs(x - this.lx) < 3e-2 &&
      Math.abs(y - this.ly) < 3e-2 &&
      Math.abs(z - this.lz) < 3e-2 &&
      Math.abs(radius - this.lr) < 3e-2
    ) {
      return;
    }
    this.lx = x;
    this.ly = y;
    this.lz = z;
    this.lr = radius;
    const ground = terrainHeight(x, z);

    // Нормаль рельефа: по ней кладём диск, иначе он режется о склон.
    const dhdx = (terrainHeight(x + SLOPE_D, z) - terrainHeight(x - SLOPE_D, z)) / (2 * SLOPE_D);
    const dhdz = (terrainHeight(x, z + SLOPE_D) - terrainHeight(x, z - SLOPE_D)) / (2 * SLOPE_D);
    _n.set(-dhdx, 1, -dhdz).normalize();
    // Локальная Z плоскости должна смотреть по нормали. Базис строим от
    // мировой Z: при почти вертикальной нормали он не вырождается.
    Vector3.CrossToRef(_n, _fwd, _t);
    if (_t.lengthSquared() < 1e-6) _t.set(1, 0, 0);
    _t.normalize();
    Vector3.CrossToRef(_n, _t, _b);

    // Чем выше объект, тем шире и бледнее пятно — по нему и читается прыжок.
    const h = Math.max(0, y - ground);
    const k = Math.min(1, h / FADE_HEIGHT);
    // Высоко в прыжке пятно чуть сжимается — тоже читается как высота.
    const s = ((radius * 2) / PROTO_SIZE) * (1 + k * 0.6) * (1 - k * 0.3);
    // Матрица «масштаб · поворот · сдвиг» из базиса (t, b, n) прямо в буфер (строки Babylon).
    const m = this.m;
    m[0] = _t.x * s; m[1] = _t.y * s; m[2] = _t.z * s; m[3] = 0;
    m[4] = _b.x * s; m[5] = _b.y * s; m[6] = _b.z * s; m[7] = 0;
    m[8] = _n.x * s; m[9] = _n.y * s; m[10] = _n.z * s; m[11] = 0;
    m[12] = x; m[13] = ground + LIFT; m[14] = z; m[15] = 1;
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
