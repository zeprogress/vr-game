import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import "@babylonjs/core/Meshes/thinInstanceMesh";

import type { Terrain } from "./Terrain";
import { LIGHT_BUDGET } from "./Fireflies";
import { noGrass } from "./grassLayout";
import { MOB_CAMPS } from "#shared/constants";
import { HUB, HUB_CENTER } from "#shared/hub";
import { TOWER_PROP_CLEAR, TOWER_PROP_POS } from "#shared/tower";

/**
 * Трава и кусты — ТОЛЬКО перед игроком.
 *
 * Раньше ~3900 пучков были раскиданы по всей карте и рисовались всегда (у thin-инстансов нет отсечения по кадру):
 * то, что за спиной, стоило вершин впустую. Теперь клетки сетки живут «виртуально»: позиция/вид/цвет каждой
 * клетки — детерминированная функция её номера (кэшируется кусками), а раз в ~0.2 с (и только если голова
 * заметно сдвинулась/повернулась) в буферы тонких инстансов пишутся клетки внутри конуса взгляда и круга вокруг.
 * Тот же бюджет вершин даёт в 2–3 раза гуще траву там, куда смотришь. Ветра нет (дешевле шейдер).
 *
 * Виды: короткая (много), высокая, «метёлки» — три отрисовки, плюс кусты — одна. Края конуса и дальний край плавно
 * «врастают» (масштаб от 0), чтобы появление не выглядело щелчком.
 */
const CELL = 0.5; // шаг сетки травы, м
const CHUNK = 16; // клеток в куске по стороне (кэш)
const STRIDE = 11; // dmax, x, y, z, yaw, s, hMul, r, g, b, kind
const BUSH_CELL = 3.4;
const R_GRASS_BASE = 130; // дальность травы (редкие пучки), м — увеличена по заявке (конус узкий, так что бюджет тот же)
const R_BUSH_BASE = 85;
const COS_HALF = Math.cos((60 * Math.PI) / 180);
const CHUNK_BUDGET_MS = 1.5; // на расчёт новых кусков за одну пересборку (остальное — в следующую)
const WARM_REBUILDS = 30; // первые пересборки после старта считаем с большим бюджетом
const REACH = 165; // дальше от центра карты травы нет

function hash(ix: number, iz: number, k: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(k + 1, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Гладкий шум 0..1 (значения в узлах решётки, сглаженная интерполяция). */
function vnoise(x: number, z: number, sc: number, seed: number): number {
  const gx = x / sc;
  const gz = z / sc;
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  let tx = gx - ix;
  let tz = gz - iz;
  tx = tx * tx * (3 - 2 * tx);
  tz = tz * tz * (3 - 2 * tz);
  const a = hash(ix, iz, seed);
  const b = hash(ix + 1, iz, seed);
  const c = hash(ix, iz + 1, seed);
  const d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}
const smooth = (e0: number, e1: number, v: number): number => {
  const t = v <= e0 ? 0 : v >= e1 ? 1 : (v - e0) / (e1 - e0);
  return t * t * (3 - 2 * t);
};

/** Углы карты (реже трава по заявке) — примерно где сходятся края «фартука». */
const CORNERS: [number, number][] = [
  [86, 86],
  [-86, 86],
  [86, -86],
  [-86, -86],
];

/** Множитель густоты: реже в середине поляны, у точек спавна мобов, за лагерем, у декоративной башни, в углах карты и у двух точек по заявке; гуще пятнами у лагеря голема-крушителя. */
function sparseMul(x: number, z: number): number {
  let m = 1;
  const dc = Math.hypot(x, z);
  if (dc < 24) m *= 0.3 + 0.7 * smooth(8, 24, dc);
  for (const c of MOB_CAMPS) {
    const r = c.spread + 4;
    const d = Math.hypot(x - c.x, z - c.z);
    if (c.type === "golem") {
      // Голем-крушитель: не реже, а гуще ХАОТИЧНЫМИ пятнами (не ровным кругом) — свой шум на месте общего множителя.
      if (d < r + 10) {
        const patch = 0.5 + 0.5 * vnoise(x, z, 11, 777);
        m *= 0.85 + 1.3 * smooth(r - 4, r + 6, d < r ? r + 6 - d : 0) * patch; // ближе к центру лагеря — сильнее пятна
      }
      continue;
    }
    if (d < r + 8) m *= 0.3 + 0.7 * smooth(r - 2, r + 8, d);
  }
  const dh = Math.hypot(x - HUB_CENTER.x, z - HUB_CENTER.z);
  if (dh < HUB.campRadius + 24) m *= 0.4 + 0.6 * smooth(HUB.campRadius, HUB.campRadius + 24, dh);
  const dt = Math.hypot(x - TOWER_PROP_POS.x, z - TOWER_PROP_POS.z);
  if (dt < TOWER_PROP_CLEAR + 24) m *= 0.4 + 0.6 * smooth(TOWER_PROP_CLEAR, TOWER_PROP_CLEAR + 24, dt);
  // Заявка: у декоративной башни (45, 108) в 15 м — совсем ничего.
  const dTowerSpot = Math.hypot(x - 45, z - 108);
  if (dTowerSpot < 15) return 0;
  // Заявка: заметно меньше травы и кустов в двух точках.
  const d1 = Math.hypot(x - -111, z - -68);
  if (d1 < 20) m *= 0.12 + 0.5 * smooth(0, 20, d1);
  const d2 = Math.hypot(x - 110, z - 0);
  if (d2 < 25) m *= 0.12 + 0.5 * smooth(0, 25, d2);
  // Заявка: значительно реже во всех четырёх углах карты.
  let dCorner = Infinity;
  for (const [cx, cz] of CORNERS) dCorner = Math.min(dCorner, Math.hypot(x - cx, z - cz));
  if (dCorner < 40) m *= 0.15 + 0.55 * smooth(0, 40, dCorner);
  return m;
}

interface Kind {
  mesh: Mesh;
  buf: Float32Array;
  col: Float32Array | null;
  n: number;
}

function firstGeometry(root: TransformNode): Mesh | null {
  const m = root.getChildMeshes(false).find((c) => c.getTotalVertices() > 0) as Mesh | undefined;
  if (!m) return null;
  m.setParent(null);
  m.bakeCurrentTransformIntoVertices(); // низ на y = 0, чистый меш под тонкие инстансы
  return m;
}

export async function loadGrassField(
  scene: Scene,
  terrain: Terrain,
  density: number,
  lite: boolean,
  /** Множитель дальности (зритель-стрим: 2+, у него запас по GPU и камера свободная). */
  farK = 1,
): Promise<(dt: number, daylight: number) => void> {
  if (density <= 0) return () => {};
  const R_GRASS = R_GRASS_BASE * farK;
  const R_BUSH = R_BUSH_BASE * farK;
  await import("@babylonjs/loaders/glTF/2.0");
  const load = (n: string) => LoadAssetContainerAsync(`/models/nature/${n}.gltf`, scene).catch(() => null);
  const [cShort, cTall, cWispy, cBush] = await Promise.all([
    load("Grass_Common_Short"),
    load("Grass_Common_Tall"),
    load("Grass_Wispy_Short"),
    load("Bush_Common"),
  ]);
  if (!cShort) return () => {};

  const mat = new StandardMaterial("grassMat", scene);
  const tex = cShort.textures[0];
  if (tex) {
    tex.hasAlpha = true;
    mat.diffuseTexture = tex;
    mat.useAlphaFromDiffuseTexture = true;
    mat.transparencyMode = 1;
    mat.alphaCutOff = 0.3;
  }
  mat.diffuseColor = new Color3(0.5, 0.72, 0.38);
  const emiDay = new Color3(0.11, 0.2, 0.09);
  mat.emissiveColor = emiDay.clone();
  mat.specularColor = new Color3(0, 0, 0);
  mat.backFaceCulling = false;
  mat.maxSimultaneousLights = lite ? 2 : LIGHT_BUDGET;

  const kinds: Kind[] = [];
  const addKind = (c: typeof cBush, name: string, material: StandardMaterial, withColor: boolean): number => {
    if (!c) return -1;
    const inst = c.instantiateModelsToScene((n) => n, false);
    const root = inst.rootNodes[0] as TransformNode | undefined;
    const m = root ? firstGeometry(root) : null;
    if (!m) return -1;
    // В модель запечён сильный AO у корней (вершинные цвета) — почти чёрный: приподнимаем нижний край.
    const vcol = m.getVerticesData(VertexBuffer.ColorKind);
    if (vcol && withColor) {
      for (let i = 0; i < vcol.length; i += 4) {
        vcol[i] = 0.42 + vcol[i] * 0.48;
        vcol[i + 1] = 0.42 + vcol[i + 1] * 0.48;
        vcol[i + 2] = 0.42 + vcol[i + 2] * 0.48;
      }
      m.setVerticesData(VertexBuffer.ColorKind, vcol, false);
    }
    m.material = material;
    m.useVertexColors = !!vcol && withColor;
    m.isPickable = false;
    m.name = name;
    m.alwaysSelectAsActiveMesh = true;
    m.doNotSyncBoundingInfo = true;
    const cap = withColor ? 4096 : 256;
    const buf = new Float32Array(16 * cap);
    m.thinInstanceSetBuffer("matrix", buf, 16, false);
    let col: Float32Array | null = null;
    if (withColor) {
      col = new Float32Array(4 * cap);
      m.thinInstanceSetBuffer("color", col, 4, false);
    }
    m.setEnabled(false);
    kinds.push({ mesh: m, buf, col, n: 0 });
    return kinds.length - 1;
  };
  const kShort = addKind(cShort, "grassBlade", mat, true);
  const kTall = addKind(cTall, "grassBladeTall", mat, true);
  const kWispy = addKind(cWispy, "grassBladeWispy", mat, true);

  // Кусты: свой материал — листва с текстурой куста, без вершинных цветов.
  let kBush = -1;
  if (cBush) {
    const bm = new StandardMaterial("bushMat", scene);
    // Родная текстура куста (TwistedTree) — тёмно-красная; берём зелёный лист обычных деревьев (та же раскладка карточек).
    const bt = new Texture("/models/nature/Leaves_NormalTree_C.png", scene, false, false);
    if (bt) {
      bt.hasAlpha = true;
      bm.diffuseTexture = bt;
      bm.useAlphaFromDiffuseTexture = true;
      bm.transparencyMode = 1;
      bm.alphaCutOff = 0.28;
    }
    // Освещение только небом и солнцем (2 источника); влияние солнца ослаблено ещё сильнее (заявка) — в тени не чёрные,
    // на солнце не засвечены, плюс совсем чуть-чуть собственного свечения.
    bm.diffuseColor = new Color3(0.2, 0.3, 0.16);
    bm.emissiveColor = new Color3(0.07, 0.1, 0.05);
    bm.specularColor = new Color3(0, 0, 0);
    bm.backFaceCulling = false;
    bm.maxSimultaneousLights = 2;
    kBush = addKind(cBush, "grassBush", bm, false);
  }

  // ---- кэш кусков клеток ----
  const chunks = new Map<number, Float32Array>();
  const chunkKey = (cx: number, cz: number): number => (cx + 4096) * 8192 + (cz + 4096);
  const ncell = CHUNK * CHUNK;
  const build = (cx: number, cz: number): Float32Array => {
    const a = new Float32Array(ncell * STRIDE);
    for (let j = 0; j < CHUNK; j++) {
      for (let i = 0; i < CHUNK; i++) {
        const ix = cx * CHUNK + i;
        const iz = cz * CHUNK + j;
        const o = (j * CHUNK + i) * STRIDE;
        const x = (ix + 0.5 + (hash(ix, iz, 1) - 0.5) * 0.9) * CELL;
        const z = (iz + 0.5 + (hash(ix, iz, 2) - 0.5) * 0.9) * CELL;
        if (Math.hypot(x, z) > REACH || noGrass(x, z)) continue;
        const y = terrain.heightAt(x, z);
        // Рельеф: в низинах гуще и выше, на холмах реже и ниже.
        const hill = smooth(-1.4, 1.8, y);
        // «Хаос»: крупные поляны и проплешины (почти пусто), средние участки и густые заросли.
        const q = vnoise(x, z, 27, 100) * 0.68 + vnoise(x, z, 9, 101) * 0.32;
        const keep = (0.015 + 0.985 * smooth(0.36, 0.6, q)) * (1.35 - 1.0 * hill) * sparseMul(x, z);
        if (hash(ix, iz, 0) > keep * density) continue;
        // Дальность, до которой этот пучок виден: большинство — только вблизи, часть — средне, единицы — далеко.
        const rd = hash(ix, iz, 30);
        const dmax = (rd < 0.05 ? R_GRASS_BASE : rd < 0.22 ? 68 : 30) * farK;
        // Виды: в основном низкая, высокая и метёлки — пятнами.
        const tallP = 0.03 + 0.4 * smooth(0.6, 0.84, vnoise(x, z, 18, 103));
        const wispP = 0.015 + 0.16 * smooth(0.68, 0.9, vnoise(x, z, 14, 104));
        const rk = hash(ix, iz, 4);
        const kind = rk < wispP && kWispy >= 0 ? kWispy : rk < wispP + tallP && kTall >= 0 ? kTall : kShort;
        const b = 0.6 + hash(ix, iz, 5) * 0.9;
        const warm = (hash(ix, iz, 6) - 0.45) * 0.5;
        a[o] = dmax;
        a[o + 1] = x;
        a[o + 2] = y - 0.03;
        a[o + 3] = z;
        a[o + 4] = hash(ix, iz, 7) * Math.PI * 2;
        a[o + 5] = 0.4 + hash(ix, iz, 8) * 0.36;
        // Высота — как раньше (0.8–1.7, ниже на холмах), но самые высокие пики срезаны: выше 1.25 рост сжимается втрое.
        const hRaw = 0.8 + hash(ix, iz, 9) * 0.9;
        a[o + 6] = (hRaw > 1.25 ? 1.25 + (hRaw - 1.25) * 0.33 : hRaw) * (1.18 - 0.42 * hill);
        a[o + 7] = b + warm * 0.7;
        a[o + 8] = b + warm * 0.15;
        a[o + 9] = b - warm * 0.5;
        a[o + 10] = kind;
      }
    }
    return a;
  };

  let lastX = 1e9;
  let lastZ = 1e9;
  let lastFx = 0;
  let lastFz = 0;
  let acc = 1;
  let pending = false;
  const fwd = new Vector3();
  const write = (k: Kind, x: number, y: number, z: number, yaw: number, sx: number, sy: number, r: number, g: number, b: number): void => {
    let idx = k.n;
    if (idx * 16 + 16 > k.buf.length) {
      // рост буфера: редкость — раз в сессии
      const nb = new Float32Array(k.buf.length * 2);
      nb.set(k.buf);
      k.buf = nb;
      k.mesh.thinInstanceSetBuffer("matrix", k.buf, 16, false);
      if (k.col) {
        const nc = new Float32Array(k.col.length * 2);
        nc.set(k.col);
        k.col = nc;
        k.mesh.thinInstanceSetBuffer("color", k.col, 4, false);
      }
      idx = k.n;
    }
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const o = idx * 16;
    const m = k.buf;
    m[o] = c * sx; m[o + 1] = 0; m[o + 2] = -s * sx; m[o + 3] = 0;
    m[o + 4] = 0; m[o + 5] = sy; m[o + 6] = 0; m[o + 7] = 0;
    m[o + 8] = s * sx; m[o + 9] = 0; m[o + 10] = c * sx; m[o + 11] = 0;
    m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; m[o + 15] = 1;
    if (k.col) {
      const co = idx * 4;
      k.col[co] = r; k.col[co + 1] = g; k.col[co + 2] = b; k.col[co + 3] = 1;
    }
    k.n++;
  };

  /** Вклад куска в кадр можно отбросить целиком: он далеко или вне конуса (с запасом на его размер). */
  const chunkOut = (mx: number, mz: number, cx: number, cz: number, fx: number, fz: number, reach: number): boolean => {
    const dx = mx - cx;
    const dz = mz - cz;
    const d = Math.hypot(dx, dz);
    const half = CHUNK * CELL * 0.75; // ~радиус куска
    if (d > reach + half) return true;
    if (d < half * 2) return false;
    const ang = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d)));
    return ang - Math.asin(Math.min(1, half / d)) > Math.acos(COS_HALF) + 0.3;
  };

  let rebuilds = 0;
  const order: { gx: number; gz: number; d: number }[] = [];
  const rebuild = (cx: number, cz: number, fx: number, fz: number): void => {
    for (const k of kinds) k.n = 0;
    pending = false;
    const t0 = performance.now();
    const limit = rebuilds < WARM_REBUILDS ? 7 : CHUNK_BUDGET_MS; // сразу после старта — щедрее
    rebuilds++;
    let built = 0;
    const span = CHUNK * CELL;
    const x0 = Math.floor((cx - R_GRASS) / span);
    const x1 = Math.floor((cx + R_GRASS) / span);
    const z0 = Math.floor((cz - R_GRASS) / span);
    const z1 = Math.floor((cz + R_GRASS) / span);
    // Куски идут от ближних к дальним: при ограниченном бюджете расчёта первыми достраиваются те, что у ног
    // (иначе трава вблизи появлялась с задержкой, пока считались дальние).
    order.length = 0;
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        const mx = (gx + 0.5) * span;
        const mz = (gz + 0.5) * span;
        if (chunkOut(mx, mz, cx, cz, fx, fz, R_GRASS)) continue;
        order.push({ gx, gz, d: Math.hypot(mx - cx, mz - cz) });
      }
    }
    order.sort((p, q) => p.d - q.d);
    for (const { gx, gz, d: cd } of order) {
      {
        const key = chunkKey(gx, gz);
        let a = chunks.get(key);
        if (!a) {
          // Ближние (до ~16 м) считаем всегда; дальние — пока есть бюджет.
          if (cd > 16 && built > 0 && performance.now() - t0 > limit) {
            pending = true; // не всё посчитано за раз — пересоберём на следующем тике
            continue;
          }
          a = build(gx, gz);
          chunks.set(key, a);
          built++;
        }
        for (let n = 0; n < ncell; n++) {
          const o = n * STRIDE;
          const dmax = a[o];
          if (dmax === 0) continue;
          const dx = a[o + 1] - cx;
          const dz = a[o + 3] - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 > dmax * dmax) continue;
          // Без плавных врастаний: пучок либо есть, либо нет (дальность — у каждой клетки своя, вдали он мелкий).
          const d = Math.sqrt(d2);
          const cosA = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
          if (cosA < COS_HALF) continue;
          const k = kinds[a[o + 10]];
          const sx = a[o + 5];
          write(k, a[o + 1], a[o + 2], a[o + 3], a[o + 4], sx, sx * a[o + 6], a[o + 7], a[o + 8], a[o + 9]);
        }
      }
    }
    // Кусты: крупнее и реже, растут кучками (шум), видны дальше травы.
    if (kBush >= 0) {
      const bk = kinds[kBush];
      const bx0 = Math.floor((cx - R_BUSH) / BUSH_CELL);
      const bx1 = Math.floor((cx + R_BUSH) / BUSH_CELL);
      const bz0 = Math.floor((cz - R_BUSH) / BUSH_CELL);
      const bz1 = Math.floor((cz + R_BUSH) / BUSH_CELL);
      for (let ix = bx0; ix <= bx1; ix++) {
        for (let iz = bz0; iz <= bz1; iz++) {
          const x = (ix + 0.5 + (hash(ix, iz, 21) - 0.5) * 0.85) * BUSH_CELL;
          const z = (iz + 0.5 + (hash(ix, iz, 22) - 0.5) * 0.85) * BUSH_CELL;
          const dx = x - cx;
          const dz = z - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 > R_BUSH * R_BUSH) continue;
          // кучками: где-то рощицы кустов, где-то ни одного
          const clump = smooth(0.58, 0.82, vnoise(x, z, 23, 105));
          if (hash(ix, iz, 20) > (0.01 + 0.13 * clump) * sparseMul(x, z) * density) continue;
          if (Math.hypot(x, z) > REACH || noGrass(x, z)) continue;
          const d = Math.sqrt(d2);
          const cosA = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
          if (cosA < COS_HALF) continue;
          const sc = 0.45 + hash(ix, iz, 23) * 0.75;
          write(bk, x, terrain.heightAt(x, z) - 0.05, z, hash(ix, iz, 24) * Math.PI * 2, sc, sc * (0.8 + hash(ix, iz, 25) * 0.5), 1, 1, 1);
        }
      }
    }
    for (const k of kinds) {
      k.mesh.thinInstanceCount = k.n;
      k.mesh.setEnabled(k.n > 0);
      if (k.n > 0) {
        k.mesh.thinInstanceBufferUpdated("matrix");
        if (k.col) k.mesh.thinInstanceBufferUpdated("color");
      }
    }
  };

  /** В простое (голова не двигалась) — по одному куску достраиваем кэш вокруг во всех направлениях: после поворота не будет плешей. */
  const prefetch = (cx: number, cz: number): void => {
    const span = CHUNK * CELL;
    const R = 46;
    const x0 = Math.floor((cx - R) / span);
    const x1 = Math.floor((cx + R) / span);
    const z0 = Math.floor((cz - R) / span);
    const z1 = Math.floor((cz + R) / span);
    let best: [number, number] | null = null;
    let bd = 1e9;
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        if (chunks.has(chunkKey(gx, gz))) continue;
        const d = Math.hypot((gx + 0.5) * span - cx, (gz + 0.5) * span - cz);
        if (d < bd && d < R) {
          bd = d;
          best = [gx, gz];
        }
      }
    }
    if (best) chunks.set(chunkKey(best[0], best[1]), build(best[0], best[1]));
  };

  let lastK = -1;
  return (dt: number, daylight: number) => {
    // Собственная яркость травы к ночи (остаток чуть больше — трава ночью не должна проваливаться в черноту).
    const kk = 0.2 + 0.8 * daylight;
    if (Math.abs(kk - lastK) >= 0.004) {
      lastK = kk;
      mat.emissiveColor.copyFromFloats(emiDay.r * kk, emiDay.g * kk, emiDay.b * kk);
    }
    acc += dt;
    if (acc < 0.2) return;
    const cam = scene.activeCamera;
    if (!cam) return;
    const p = cam.globalPosition;
    cam.getDirectionToRef(Vector3.Forward(), fwd);
    const fl = Math.hypot(fwd.x, fwd.z);
    const fx = fl > 1e-3 ? fwd.x / fl : lastFx;
    const fz = fl > 1e-3 ? fwd.z / fl : lastFz;
    // Пересобираем, только если голова заметно сдвинулась или повернулась.
    const moved = Math.hypot(p.x - lastX, p.z - lastZ);
    const turned = fx * lastFx + fz * lastFz < 0.9986; // ~3°
    if (moved < 0.35 && !turned && !pending && kinds[0].n > 0) {
      prefetch(p.x, p.z);
      acc = 0.1; // следующий тик через 0.1 с
      return;
    }
    acc = 0;
    lastX = p.x;
    lastZ = p.z;
    lastFx = fx;
    lastFz = fz;
    rebuild(p.x, p.z, fx, fz);
  };
}
