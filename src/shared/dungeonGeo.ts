import {
  DUN_LAKE,
  DUN_SHAPES,
  DUN_VOID_H,
  DUN_VOIDS,
  DUN_HALF,
  DUN_ZONES,
  type DunShape,
  dunInPoly,
  dunRoomHeight,
  dunShapeHeight,
  dunFloorLocal,
} from "./dungeon";
import { type Edge, edgeOpen, edgesOf, floorAt } from "./dungeonDress";

/**
 * Геометрия подземелья для отрисовки: верх полов (с текстурными координатами в метрах), обрывы до дна
 * бездны, потолки залов, вода озера. Чистые массивы (без движка): клиент делает меши, превью в Blender —
 * то же самое. Координаты локальные, оси игры: x = u, y = высота, z = v.
 *
 * Материалы: floorStone (плиты — руины и постройки), floorRock (пещеры), cliff (скала боков и потолков),
 * masonry (помосты, лестничные полосы в постройках), wood (верёвочные мосты), water.
 */
export type DunGeoMat = "floorStone" | "floorRock" | "cliff" | "masonry" | "wood" | "water" | "ceiling" | "dome";

export interface DunGeoPart {
  mat: DunGeoMat;
  /** Зона (для кусков-чанков). */
  zone: string;
  pos: number[];
  idx: number[];
  uv: number[];
  /** Цвет вершин RGB (крупная вариация тона: пятна, влажность, темнота к глубине) — против повторов. */
  col: number[];
}

/** Метров на повтор текстуры (как TILE_M в gen_dkit.py). */
export const DUN_TILE: Record<DunGeoMat, number> = {
  floorStone: 5, floorRock: 6, cliff: 4, masonry: 3, wood: 2, water: 8, ceiling: 4, dome: 12,
};

const styleOf = new Map(DUN_ZONES.map((z) => [z.id, z.style] as const));
const encloseOf = new Map(DUN_ZONES.map((z) => [z.id, z.enclose] as const));
const ceilOf = new Map(DUN_ZONES.map((z) => [z.id, z.ceil] as const));
const inVoid = (u: number, v: number): boolean => DUN_VOIDS.some((pts) => dunInPoly(pts, u, v));

/** Триангуляция простого многоугольника (уши) — индексы вершин, обход как у ввода. */
export function earcut2(pts: readonly (readonly [number, number])[]): number[] {
  const n = pts.length;
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) area += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  const idx = Array.from({ length: n }, (_, i) => (area > 0 ? i : n - 1 - i));
  const out: number[] = [];
  const cross = (a: number, b: number, c: number): number =>
    (pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[b][1] - pts[a][1]) * (pts[c][0] - pts[a][0]);
  const inside = (p: number, a: number, b: number, c: number): boolean => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < 4000) {
    let cut = false;
    for (let k = 0; k < idx.length; k++) {
      const a = idx[(k + idx.length - 1) % idx.length];
      const b = idx[k];
      const c = idx[(k + 1) % idx.length];
      if (cross(a, b, c) <= 0) continue;
      if (idx.some((p) => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue;
      out.push(a, b, c);
      idx.splice(k, 1);
      cut = true;
      break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out;
}

/** Наибольшее ребро треугольника пола, м. */
const FLOOR_EDGE = 2.5;

class Builder {
  readonly parts = new Map<string, DunGeoPart>();
  part(mat: DunGeoMat, zone: string): DunGeoPart {
    const key = `${zone}|${mat}`;
    let p = this.parts.get(key);
    if (!p) {
      p = { mat, zone, pos: [], idx: [], uv: [], col: [] };
      this.parts.set(key, p);
    }
    return p;
  }
  /** Четырёхугольник a-b-c-d (вершины [x,y,z]) с UV стены: по длине вдоль a→b и по высоте. */
  wallQuad(p: DunGeoPart, a: number[], b: number[], c: number[], d: number[], u0: number, T: number): void {
    const base = p.pos.length / 3;
    const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
    p.pos.push(...a, ...b, ...c, ...d);
    p.uv.push(u0 / T, a[1] / T, (u0 + L) / T, b[1] / T, (u0 + L) / T, c[1] / T, u0 / T, d[1] / T);
    p.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  /** Плоский/наклонный многоугольник верхом (или низом — flip): UV — мировые x, z. */
  cap(p: DunGeoPart, pts: readonly (readonly [number, number])[], hAt: (u: number, v: number) => number, T: number, flip = false): void {
    const base = p.pos.length / 3;
    for (const [u, v] of pts) {
      p.pos.push(u, hAt(u, v), v);
      p.uv.push(u / T, v / T);
    }
    const tri = earcut2(pts);
    // Полы мелко разбиваем (рёбра ≤ FLOOR_EDGE м): иначе на огромном многоугольнике нет вершин внутри и
    // крупной вариации тона (цвет вершин) не на чем лечь — видно повторы текстуры.
    const keyOf = new Map<string, number>();
    const vert = (u: number, v: number): number => {
      const k = `${Math.round(u * 100)},${Math.round(v * 100)}`;
      let i = keyOf.get(k);
      if (i === undefined) {
        i = p.pos.length / 3;
        p.pos.push(u, hAt(u, v), v);
        p.uv.push(u / T, v / T);
        keyOf.set(k, i);
      }
      return i;
    };
    const emit = (a: number[], b: number[], c: number[], depth: number): void => {
      const lab = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const lbc = Math.hypot(b[0] - c[0], b[1] - c[1]);
      const lca = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const m = Math.max(lab, lbc, lca);
      if (!flip && m > FLOOR_EDGE && depth < 10) {
        // делим длиннейшее ребро пополам
        if (m === lab) {
          const d = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          emit(a, d, c, depth + 1);
          emit(d, b, c, depth + 1);
        } else if (m === lbc) {
          const d = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2];
          emit(a, b, d, depth + 1);
          emit(a, d, c, depth + 1);
        } else {
          const d = [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2];
          emit(a, b, d, depth + 1);
          emit(d, b, c, depth + 1);
        }
        return;
      }
      const ia = vert(a[0], a[1]);
      const ib = vert(b[0], b[1]);
      const ic = vert(c[0], c[1]);
      if (flip) p.idx.push(ia, ib, ic);
      else p.idx.push(ia, ic, ib);
    };
    void base;
    for (let i = 0; i < tri.length; i += 3) {
      emit([...pts[tri[i]]], [...pts[tri[i + 1]]], [...pts[tri[i + 2]]], 0);
    }
  }
}

const circle = (u: number, v: number, r: number, n = 48): [number, number][] =>
  Array.from({ length: n }, (_, k) => [u + Math.cos((k / n) * Math.PI * 2) * r, v + Math.sin((k / n) * Math.PI * 2) * r] as [number, number]);

function floorMat(zone: string): DunGeoMat {
  return styleOf.get(zone) === "cave" ? "floorRock" : "floorStone";
}

/** Вся геометрия; детерминирована. */
export function dunGeometry(): DunGeoPart[] {
  const B = new Builder();
  const prof = (globalThis as { __dunProf?: Record<string, number> }).__dunProf;
  for (const s of DUN_SHAPES) {
    const t0 = prof ? performance.now() : 0;
    if (s.t === "strip") strip(B, s);
    else room(B, s);
    if (prof) prof[`${s.zone}:${s.t}`] = (prof[`${s.zone}:${s.t}`] ?? 0) + performance.now() - t0;
  }
  const t1 = prof ? performance.now() : 0;
  dome(B);
  voidWalls(B);
  if (prof) prof.dome = performance.now() - t1;
  // Вода озера и стенки чаши до дна бездны.
  const w = B.part("water", "E");
  B.cap(w, DUN_LAKE.pts, () => DUN_LAKE.h, DUN_TILE.water);
  cliffDown(B, "E", resample(DUN_LAKE.pts, 3, true, ccwSign(DUN_LAKE.pts)), true, () => DUN_LAKE.h + 1);
  const parts = [...B.parts.values()];
  for (const p of parts) finishPart(p);
  return parts;
}

/**
 * Против повторов текстуры на больших площадях: (1) текстурные координаты плавно искажены крупным
 * шумом (повтор не складывается в ровную сетку), (2) крупная вариация тона в цвете вершин — пятна,
 * влажные тёмные зоны, у скал — темнее к глубине. Кладка — без искажения (ровные ряды блоков).
 */
function finishPart(p: DunGeoPart): void {
  const T = DUN_TILE[p.mat];
  const flat = p.mat === "floorStone" || p.mat === "floorRock" || p.mat === "ceiling" || p.mat === "water";
  const warp = p.mat !== "masonry" && p.mat !== "wood" && p.mat !== "water";
  const rock = p.mat === "cliff" || p.mat === "dome" || p.mat === "floorRock" || p.mat === "ceiling";
  const n = p.pos.length / 3;
  p.col = new Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = p.pos[i * 3];
    const y = p.pos[i * 3 + 1];
    const z = p.pos[i * 3 + 2];
    if (warp) {
      const wx = 2.6 * dunFbm(x * 0.055, y * 0.055 + 1.3, z * 0.055);
      const wz = 2.6 * dunFbm(x * 0.055 + 4.1, y * 0.055, z * 0.055 + 2.7);
      if (flat) {
        p.uv[i * 2] = (x + wx) / T;
        p.uv[i * 2 + 1] = (z + wz) / T;
      } else {
        p.uv[i * 2] += wx / T;
        p.uv[i * 2 + 1] += wz / T;
      }
    }
    // пол — не идеально ровный: бугры и впадины до ±0.15 м (только вид: ходьба — по полу dungeon.ts);
    // у края полосы (ширина связки) не трогаем — стык с соседней фигурой без щелей
    if (p.mat === "floorRock" || p.mat === "floorStone") {
      const amp = p.mat === "floorRock" ? 0.16 : 0.08;
      p.pos[i * 3 + 1] = y + amp * dunFbm(x * 0.35, 7.7, z * 0.35) + amp * 0.4 * dunFbm(x * 1.1, 3.1, z * 1.1);
    }
    // тон: крупные пятна + средние, у плит — мягче
    const big = dunFbm(x * 0.022, y * 0.022, z * 0.022);
    const mid = dunFbm(x * 0.09 + 3, y * 0.09, z * 0.09);
    const spread = rock ? 1 : 0.55;
    let v = 0.86 + spread * (0.22 * big + 0.12 * mid);
    // влажные тёмные пятна на полу и у воды
    if (p.mat === "floorRock" || p.mat === "floorStone") {
      const wet = dunFbm(x * 0.04 + 9, 0, z * 0.04);
      if (wet > 0.25) v *= 1 - Math.min(0.28, (wet - 0.25) * 0.9);
    }
    // скалы и купол темнеют к глубине (бездна уходит во тьму)
    if (p.mat === "cliff" || p.mat === "dome") v *= Math.max(0.28, Math.min(1, (y - DUN_VOID_H) / 50));
    const warm = 0.05 * dunFbm(x * 0.015 + 7, y * 0.015, z * 0.015);
    p.col[i * 3] = Math.max(0, v * (1 + warm));
    p.col[i * 3 + 1] = Math.max(0, v);
    p.col[i * 3 + 2] = Math.max(0, v * (1 - warm));
  }
}

/** Боковые стенки по контуру pts: верх hTop(u,v), низ hBot(u,v), лицом наружу (обход любой). */
function ring(B: Builder, p: DunGeoPart, pts: readonly (readonly [number, number])[], hTop: (u: number, v: number) => number, hBot: (u: number, v: number) => number): void {
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    const [au, av] = pts[i];
    const [bu, bv] = pts[(i + 1) % pts.length];
    B.wallQuad(p, [au, hTop(au, av), av], [bu, hTop(bu, bv), bv], [bu, hBot(bu, bv), bv], [au, hBot(au, av), av], acc, DUN_TILE.cliff);
    acc += Math.hypot(bu - au, bv - av);
  }
}

// ---------------------------------------------------------------------------
// Сплошные скальные стены и обрывы: лента вдоль контура с рельефом из 3D-шума (без щелей и повторов).

function hash3(x: number, y: number, z: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Сглаженный шум решётки 0..1 (без замыканий и выделений — зовётся десятки тысяч раз). */
function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  let fx = x - xi;
  let fy = y - yi;
  let fz = z - zi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);
  const c000 = hash3(xi, yi, zi);
  const c100 = hash3(xi + 1, yi, zi);
  const c010 = hash3(xi, yi + 1, zi);
  const c110 = hash3(xi + 1, yi + 1, zi);
  const c001 = hash3(xi, yi, zi + 1);
  const c101 = hash3(xi + 1, yi, zi + 1);
  const c011 = hash3(xi, yi + 1, zi + 1);
  const c111 = hash3(xi + 1, yi + 1, zi + 1);
  const x00 = c000 + (c100 - c000) * fx;
  const x10 = c010 + (c110 - c010) * fx;
  const x01 = c001 + (c101 - c001) * fx;
  const x11 = c011 + (c111 - c011) * fx;
  const y0 = x00 + (x10 - x00) * fy;
  const y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}

/** Фрактальный шум −1..1 (4 октавы). */
export function dunFbm(x: number, y: number, z: number): number {
  let a = 0;
  let w = 0.5;
  let f = 1;
  for (let o = 0; o < 4; o++) {
    a += (vnoise(x * f, y * f, z * f) * 2 - 1) * w;
    f *= 2.03;
    w *= 0.5;
  }
  return a / 0.9375;
}

interface CSample {
  u: number;
  v: number;
  nu: number;
  nv: number;
  /** Длина пути от начала (для UV). */
  d: number;
}

/** Контур, переразбитый с шагом ds; нормали — наружу, сглажены на углах. closed — замкнутый. */
function resample(pts: readonly (readonly [number, number])[], ds: number, closed: boolean, outwardSign: number): CSample[] {
  const segs: [number, number, number, number, number][] = [];
  const n = pts.length;
  let total = 0;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const [au, av] = pts[i];
    const [bu, bv] = pts[(i + 1) % n];
    const L = Math.hypot(bu - au, bv - av);
    if (L < 1e-6) continue;
    segs.push([au, av, bu, bv, L]);
    total += L;
  }
  const cnt = Math.max(2, Math.round(total / ds));
  const out: CSample[] = [];
  for (let k = 0; k < (closed ? cnt : cnt + 1); k++) {
    let d = (total * k) / cnt;
    const dd = d;
    for (const [au, av, bu, bv, L] of segs) {
      if (d <= L + 1e-9) {
        const t = d / L;
        out.push({ u: au + (bu - au) * t, v: av + (bv - av) * t, nu: 0, nv: 0, d: dd });
        break;
      }
      d -= L;
    }
  }
  // нормали по соседям (центральная разность касательной)
  for (let i = 0; i < out.length; i++) {
    const a = out[closed ? (i - 1 + out.length) % out.length : Math.max(0, i - 1)];
    const b = out[closed ? (i + 1) % out.length : Math.min(out.length - 1, i + 1)];
    const tu = b.u - a.u;
    const tv = b.v - a.v;
    const l = Math.hypot(tu, tv) || 1;
    out[i].nu = (tv / l) * outwardSign;
    out[i].nv = (-tu / l) * outwardSign;
  }
  return out;
}

/** +1, если обход многоугольника против часовой (тогда «наружу» — справа от направления обхода). */
function ccwSign(pts: readonly (readonly [number, number])[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a > 0 ? 1 : -1;
}

/**
 * Лента скалы вдоль контура: колонки вершин по образцам, ряды по высоте. bottom/top — высоты низа и
 * верха у образца, push(t, y, smp) — смещение наружу (м), use[i] — строить ли отрезок i→i+1.
 */
function ribbon(
  p: DunGeoPart,
  smp: CSample[],
  closed: boolean,
  rows: number,
  bottom: (s: CSample) => number,
  top: (s: CSample) => number,
  push: (t: number, y: number, s: CSample) => number,
  use: boolean[],
  dy?: (t: number, y: number, s: CSample) => number,
): void {
  const T = DUN_TILE.cliff;
  const base = p.pos.length / 3;
  for (const s of smp) {
    const y0 = bottom(s);
    const y1 = top(s);
    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      const y = y0 + (y1 - y0) * t;
      const o = push(t, y, s);
      p.pos.push(s.u + s.nu * o, y + (dy ? dy(t, y, s) : 0), s.v + s.nv * o);
      p.uv.push(s.d / T, y / T);
    }
  }
  const nseg = closed ? smp.length : smp.length - 1;
  for (let i = 0; i < nseg; i++) {
    if (!use[i]) continue;
    const j = (i + 1) % smp.length;
    for (let r = 0; r < rows; r++) {
      const a = base + i * (rows + 1) + r;
      const b = base + j * (rows + 1) + r;
      p.idx.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }
}

/** Скальные стены зала (пещеры и руины): сплошные, с выступами и нишами; у построек — кладка (wallBand). */
function caveWalls(B: Builder, s: DunShape, smp: CSample[], closed: boolean): void {
  const zone = s.zone;
  const st = styleOf.get(zone);
  const en = s.t === "strip" ? "closed" : encloseOf.get(zone) ?? "closed";
  // постройки: до свода — кладка (wallBand); полустена — скала, как у пещер (меньше правильных форм)
  if (st === "temple" && s.t !== "strip" && en === "closed") return;
  if (en === "open") return;
  const ceil = s.t === "strip" ? (s.kind === "ledge" ? 30 : 7.5) : ceilOf.get(zone) ?? 12;
  const flags = smp.map((q) => {
    const e: Edge = { u: q.u, v: q.v, nu: q.nu, nv: q.nv, shape: s };
    return !edgeOpen(e, floorAt(e));
  });
  const use = smp.map((_, i) => flags[i] && flags[(i + 1) % smp.length]);
  if (!use.some(Boolean)) return;
  // У прохода стена прижимается к краю (без наклона и контрфорсов): иначе нависала бы над проходом
  // (мост над озером «перекрыт камнем»). Расстояние вдоль контура до ближайшего открытого образца.
  const nS = smp.length;
  const dOpen = new Array<number>(nS).fill(Infinity);
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < nS * (closed ? 2 : 1); k++) {
      const i = pass === 0 ? k % nS : (nS - 1 - (k % nS));
      if (!flags[i]) {
        dOpen[i] = 0;
        continue;
      }
      const j = pass === 0 ? i - 1 : i + 1;
      if (!closed && (j < 0 || j >= nS)) continue;
      const jj = (j + nS) % nS;
      const d = dOpen[jj] + Math.hypot(smp[i].u - smp[jj].u, smp[i].v - smp[jj].v);
      if (d < dOpen[i]) dOpen[i] = d;
    }
  }
  const idxOf = new Map(smp.map((q, i) => [q, i] as const));
  const taper = (q: CSample): number => {
    const d = dOpen[idxOf.get(q) ?? 0];
    const t = Math.max(0, Math.min(1, (d - 1.5) / 7));
    return t * t * (3 - 2 * t);
  };
  const floorH = (q: CSample): number => dunFloorLocal(q.u - q.nu * 0.6, q.v - q.nv * 0.6) ?? dunRoomHeight(s, q.u, q.v);
  const partial = en === "partial";
  const H = (q: CSample): number =>
    partial ? 2.2 + 4.5 * (0.5 + 0.5 * dunFbm(q.u * 0.06, 3.1, q.v * 0.06)) : ceil <= 16 ? ceil + 0.6 : Math.min(ceil, 30);
  // Профиль стены — не отвесный: у пола осыпь у самого края, выше стена уходит назад уступами-пластами,
  // вдоль стены — крупные контрфорсы и ниши; у залов с потолком верх возвращается к краю потолка.
  const capped = !partial && ceil <= 16;
  const amp = partial ? 0.8 : 1.4;
  const rows = partial ? 5 : Math.max(6, Math.min(22, Math.round((capped ? ceil : 30) / 1.3)));
  ribbon(
    B.part("cliff", zone),
    smp,
    closed,
    rows,
    (q) => floorH(q) - 0.8,
    (q) => floorH(q) + H(q),
    (t, y, q) => {
      const hh = Math.max(0, y - floorH(q));
      const big = dunFbm(q.u * 0.035, 1.7, q.v * 0.035);
      const n = dunFbm(q.u * 0.14, y * 0.14, q.v * 0.14);
      const n2 = dunFbm(q.u * 0.45 + 7, y * 0.45, q.v * 0.45);
      const k = hh / 3.2 + 0.45 * n;
      const fr = k - Math.floor(k);
      const step = (Math.floor(k) + Math.max(0, (fr - 0.72) / 0.28)) * 0.55;
      const lean = partial ? 0.2 * hh : 0.34 * hh * (1 - 0.45 * t);
      const body = amp * (0.55 + 0.45 * n) + 0.45 * n2 + 2.4 * (0.5 + 0.5 * big) + step + lean;
      // у пола — у самого края (не залезать на проход); у залов с потолком — к краю потолка наверху
      const top = capped ? 1 - Math.pow(t, 3) : 1;
      return 0.25 + Math.min(1, hh / 1.2) * body * top * taper(q);
    },
    use,
    (t, y, q) => (t > 0 && t < 1 ? 0.5 * dunFbm(q.u * 0.3, y * 0.3 + 5, q.v * 0.3) : 0),
  );
  // Под стеной — массив породы до дна бездны, к низу шире: стена стоит на скале, а не висит в воздухе.
  ribbon(
    B.part("cliff", zone),
    smp,
    closed,
    9,
    () => DUN_VOID_H,
    (q) => floorH(q) - 0.8,
    (t, y, q) => {
      const depth = (1 - t) * (floorH(q) + 0.8 - DUN_VOID_H);
      const n = dunFbm(q.u * 0.06, y * 0.06, q.v * 0.06);
      return 0.25 + Math.min(1, depth / 4) * (depth * 0.3 + 3 * (0.5 + 0.5 * n)) * (0.4 + 0.6 * taper(q));
    },
    use,
  );
}

/** Обрыв под полом до дна бездны: рельефная скала, к низу сужается (столб под залом). */
function cliffDown(B: Builder, zone: string, smp: CSample[], closed: boolean, topH: (q: CSample) => number, bottom = DUN_VOID_H): void {
  const rows = 14;
  ribbon(
    B.part("cliff", zone),
    smp,
    closed,
    rows,
    () => bottom,
    topH,
    (t, y, q) => {
      // массив породы: уступы-пласты, сужается книзу (висит над бездной), крупные выступы вдоль края
      const depth = (1 - t) * (topH(q) - bottom);
      const big = dunFbm(q.u * 0.03, 3.3, q.v * 0.03);
      const n = dunFbm(q.u * 0.07, y * 0.07, q.v * 0.07);
      const k = depth / 4.5 + 0.35 * n;
      const fr = k - Math.floor(k);
      const step = -(Math.floor(k) + Math.max(0, (fr - 0.7) / 0.3)) * 0.7;
      return Math.min(1, depth / 3) * (3.2 * n + 2.6 * big - depth * 0.16 + step);
    },
    smp.map(() => true),
  );
}

/**
 * Внутренний купол пещеры — дальний план одним мешем: стены по краю участка (квадрат со скруглёнными
 * углами) от дна бездны вверх и свод с «лесом» сталактитов. Рельеф — 3D-шум; одна отрисовка.
 */
function dome(B: Builder): void {
  const p = B.part("dome", "DOME");
  const T = DUN_TILE.dome;
  const NU = 240;
  const WALL_ROWS = 14;
  const DOME_ROWS = 40;
  const R = DUN_HALF + 34;
  const PE = 8; // показатель суперэллипса: почти квадрат, углы скруглены
  const yBot = DUN_VOID_H - 6;
  const yMid = 60;
  const HY = 58; // свод до ~118
  const rows = WALL_ROWS + DOME_ROWS;
  const base = p.pos.length / 3;
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= NU; i++) {
      const a = (i / NU) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const rr = R / Math.pow(Math.pow(Math.abs(ca), PE) + Math.pow(Math.abs(sa), PE), 1 / PE);
      let c: number;
      let y: number;
      if (j <= WALL_ROWS) {
        c = 1;
        y = yBot + ((yMid - yBot) * j) / WALL_ROWS;
      } else {
        const f = ((j - WALL_ROWS) / DOME_ROWS) * (Math.PI / 2);
        c = Math.pow(Math.cos(f), 0.7);
        y = yMid + HY * Math.pow(Math.sin(f), 0.8);
      }
      let x = ca * rr * c;
      let z = sa * rr * c;
      // рельеф стен: внутрь до ~14 м
      const n = dunFbm(x * 0.018, y * 0.018, z * 0.018) * 0.5 + 0.5;
      const inward = 3 + 11 * n;
      const l = Math.hypot(x, z) || 1;
      x -= (x / l) * inward * (c > 0.05 ? 1 : 0);
      z -= (z / l) * inward * (c > 0.05 ? 1 : 0);
      // сталактиты: на своде (и на верху стен) — острые выступы вниз
      const ceilK = Math.max(0, Math.min(1, (y - 70) / 25));
      if (ceilK > 0) {
        const sp = 1 - Math.abs(dunFbm(x * 0.06, 11.3, z * 0.06));
        const spike = Math.pow(Math.max(0, sp - 0.55) / 0.45, 3);
        y -= ceilK * (spike * 34 + (dunFbm(x * 0.02, 2.2, z * 0.02) * 0.5 + 0.5) * 8);
      }
      p.pos.push(x, y, z);
      p.uv.push((a * R) / T, y / T);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < NU; i++) {
      const a0 = base + j * (NU + 1) + i;
      const b0 = a0 + NU + 1;
      p.idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
    }
  }
}

/**
 * Стены вокруг пустот (озеро, разлом, колодец): где к краю пустоты не подходит пол зала, — сплошная
 * рельефная скала от воды/дна бездны до верха, лицом в пустоту (с западной стены озера падает водопад).
 */
function voidWalls(B: Builder): void {
  DUN_VOIDS.forEach((pts, vi) => {
    const lake = vi === 0;
    // у озера отвесных стен нет: его обрамляют края залов и стены купола (просьба пользователя)
    if (lake) return;
    const zone = lake ? "E" : vi === 1 ? "C" : vi === 2 ? "I" : "N";
    // наружу от пустоты (в скалу) — нормаль контура наружу; лицо скалы смотрит в пустоту
    const smp = resample(pts, 2.5, true, ccwSign(pts));
    const near = smp.map((q) => {
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        if (dunFloorLocal(q.u + Math.cos(ang) * 7, q.v + Math.sin(ang) * 7) !== null) return true;
      }
      return false;
    });
    const use = smp.map((_, i) => !near[i] && !near[(i + 1) % smp.length]);
    const bottom = lake ? DUN_LAKE.h - 3 : DUN_VOID_H;
    const top = lake ? 85 : vi === 3 ? 52 : 72;
    ribbon(B.part("cliff", zone), smp, true, 16, () => bottom, () => top + 0, (_t, y, q) => {
      const n = dunFbm(q.u * 0.07, y * 0.07, q.v * 0.07);
      const n2 = dunFbm(q.u * 0.25 + 3, y * 0.25, q.v * 0.25);
      return 1.5 + 4 * (0.5 + 0.5 * n) + 1.2 * n2;
    }, use);
  });
}

function room(B: Builder, s: Extract<DunShape, { t: "disc" | "poly" }>): void {
  const zone = s.zone;
  const pts = s.t === "poly" ? s.pts : circle(s.u, s.v, s.r);
  const hAt = (u: number, v: number): number => dunRoomHeight(s, u, v);
  const top = s.ledge ? B.part("masonry", zone) : B.part(floorMat(zone), zone);
  if (s.t === "disc" && s.ri) {
    // кольцо: верх — полоса между окружностями, внутренняя стенка — в провал
    const outer = circle(s.u, s.v, s.r, 64);
    const inner = circle(s.u, s.v, s.ri, 64);
    const T = DUN_TILE[top.mat];
    const base = top.pos.length / 3;
    for (let k = 0; k < 64; k++) {
      top.pos.push(outer[k][0], s.h, outer[k][1], inner[k][0], s.h, inner[k][1]);
      top.uv.push(outer[k][0] / T, outer[k][1] / T, inner[k][0] / T, inner[k][1] / T);
    }
    for (let k = 0; k < 64; k++) {
      const a = base + k * 2;
      const b = base + ((k + 1) % 64) * 2;
      top.idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    // внутренняя стенка — в провал (нормаль к центру)
    cliffDown(B, zone, resample(inner, 3, true, -ccwSign(inner)), true, () => s.h);
  } else {
    B.cap(top, pts, hAt, DUN_TILE[top.mat]);
  }
  // бока: у помоста — кладка на 4 м вниз (стоит на полу зала), у остальных — рельефная скала до дна бездны;
  // стены пещеры по контуру — сплошные (closed — до свода, partial — низкие с «окнами» по высоте)
  if (s.ledge) ring(B, B.part("masonry", zone), pts, hAt, (u, v) => hAt(u, v) - 4);
  else {
    const loop = resample(pts, 1.5, true, ccwSign(pts));
    cliffDown(B, zone, resample(pts, 3, true, ccwSign(pts)), true, (q) => hAt(q.u, q.v));
    caveWalls(B, s, loop, true);
  }
  // потолок: у залов, кроме площадок посреди пустот (разлом, озеро) — над ними общий свод пещеры
  const open = s.t === "disc" && inVoid(s.u, s.v);
  const ceil = ceilOf.get(zone) ?? 12;
  // стены по контуру (кроме проходов и краёв над пустотой): постройки — кладка до свода (closed),
  // до пояса (partial) или парапет (open); открытые руины — парапет с проломами
  if (!s.ledge) {
    const st = styleOf.get(zone);
    const en = encloseOf.get(zone) ?? "closed";
    // кладка — только у построек: до свода (closed, с разрушенным неровным верхом) и низкий щербатый
    // парапет у открытых (неф); полустены и края руин — скала (caveWalls / глыбы из dungeonDress)
    if (st === "temple" && en === "closed") wallBand(B, s, TEMPLE_WALL, 1.5, 0, 0.35);
    else if (st === "temple" && en === "open") wallBand(B, s, PARAPET, 0.6, 0.3, 0.3);
  }
  // потолок — у низких залов (стены дотягиваются до него); высокие своды — тёмные (этап света и атмосферы)
  if (!s.ledge && !open && ceil <= 16) {
    B.cap(B.part("ceiling", zone), pts, (u, v) => hAt(u, v) + ceil, DUN_TILE.ceiling, true);
  }
}

/** Высота стен построек над полом, м; парапет открытых залов. */
const TEMPLE_WALL = 18;
const PARAPET = 1.1;

/** Полоса кладки по контуру: высота H, толщина o (наружу от края), доля проломов gaps (0 — сплошная). */
function wallBand(B: Builder, s: Extract<DunShape, { t: "disc" | "poly" }>, Hmax: number, o: number, gaps: number, ruin = 0): void {
  const p = B.part("masonry", s.zone);
  const T = DUN_TILE.masonry;
  const H = Math.min(Hmax, ceilOf.get(s.zone) ?? Hmax);
  const step = 2;
  let acc = 0;
  let seed = 1;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const e of edgesOf(s, step)) {
    acc += step;
    const h = floorAt(e);
    if (edgeOpen(e, h)) continue;
    if (gaps > 0 && rnd() < gaps) continue;
    const tu = -e.nv;
    const tv = e.nu;
    const a = [e.u - tu * step * 0.5, e.v - tv * step * 0.5];
    const b = [e.u + tu * step * 0.5, e.v + tv * step * 0.5];
    const ha = dunRoomHeight(s, a[0], a[1]);
    const hb = dunRoomHeight(s, b[0], b[1]);
    // верх неровный: разрушенная кладка (плавно вдоль стены, а не ступеньками) и щербины парапета
    const k = (1 - ruin * (0.5 + 0.5 * dunFbm(e.u * 0.09, 2.2, e.v * 0.09))) * (gaps > 0 ? 0.7 + rnd() * 0.5 : 1);
    // лицо (внутрь зала), верх, тыл
    B.wallQuad(p, [b[0], hb + H * k, b[1]], [a[0], ha + H * k, a[1]], [a[0], ha - 0.3, a[1]], [b[0], hb - 0.3, b[1]], acc, T);
    const bo = [b[0] + e.nu * o, b[1] + e.nv * o];
    const ao = [a[0] + e.nu * o, a[1] + e.nv * o];
    const base = p.pos.length / 3;
    p.pos.push(a[0], ha + H * k, a[1], b[0], hb + H * k, b[1], bo[0], hb + H * k, bo[1], ao[0], ha + H * k, ao[1]);
    p.uv.push(a[0] / T, a[1] / T, b[0] / T, b[1] / T, bo[0] / T, bo[1] / T, ao[0] / T, ao[1] / T);
    p.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    B.wallQuad(p, [ao[0], ha + H * k, ao[1]], [bo[0], hb + H * k, bo[1]], [bo[0], hb - 2, bo[1]], [ao[0], ha - 2, ao[1]], acc, T);
  }
}

function strip(B: Builder, s: Extract<DunShape, { t: "strip" }>): void {
  const zone = s.zone;
  const L = Math.hypot(s.bu - s.au, s.bv - s.av);
  const ex = (s.bu - s.au) / L;
  const ez = (s.bv - s.av) / L;
  const nx = ez * (s.w / 2);
  const nz = -ex * (s.w / 2);
  const d0 = s.room ? Math.max(0, s.sa - 0.5) : 0;
  const d1 = s.room ? Math.min(L, s.sb + 0.5) : L;
  const lo = s.room ? Math.max(0.01, s.sa - 0.49) : 0.01;
  const hi = s.room ? Math.min(L - 0.01, s.sb + 0.49) : L - 0.01;
  const H = (d: number, a: number): number => {
    const dd = Math.max(lo, Math.min(hi, d));
    const aa = Math.max(-s.w / 2 + 0.01, Math.min(s.w / 2 - 0.01, a));
    return dunShapeHeight(s, s.au + ex * dd + ez * aa, s.av + ez * dd - ex * aa) ?? s.ha;
  };
  const ds = [...new Set([d0, s.sa, s.sb, d1].map((d) => Math.max(d0, Math.min(d1, d))))].sort((a, b) => a - b);
  // Мосты рисуются модулями (пролёты), верёвочные — деревом; связки — верх полом зоны.
  if (s.kind === "bridge") return;
  const mat: DunGeoMat = s.kind === "rope" ? "wood" : s.kind === "stairs" && styleOf.get(zone) !== "cave" ? "masonry" : floorMat(zone);
  const top = B.part(mat, zone);
  const T = DUN_TILE[mat];
  const depth = s.kind === "rope" ? 0.35 : null;
  const sec = ds.map((d) => {
    const cu = s.au + ex * d;
    const cv = s.av + ez * d;
    const hp = H(d, s.w / 2);
    const hm = H(d, -s.w / 2);
    return { a: [cu + nx, hp, cv + nz], b: [cu - nx, hm, cv - nz], d };
  });
  for (let k = 0; k + 1 < sec.length; k++) {
    const A = sec[k];
    const C = sec[k + 1];
    const base = top.pos.length / 3;
    top.pos.push(...A.a, ...A.b, ...C.b, ...C.a);
    for (const q of [A.a, A.b, C.b, C.a]) top.uv.push(q[0] / T, q[2] / T);
    top.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    // бока верёвочного моста — доски
    if (s.kind === "rope") {
      const side = B.part("wood", zone);
      const bot = (y: number): number => y - (depth ?? 0.35);
      B.wallQuad(side, A.a, C.a, [C.a[0], bot(C.a[1]), C.a[2]], [A.a[0], bot(A.a[1]), A.a[2]], A.d, DUN_TILE.cliff);
      B.wallQuad(side, C.b, A.b, [A.b[0], bot(A.b[1]), A.b[2]], [C.b[0], bot(C.b[1]), C.b[2]], C.d, DUN_TILE.cliff);
    }
  }
  if (s.kind !== "rope") {
    // бока связки: рельефный обрыв вниз и сплошные стены тоннеля (у уступов колодца — только с внешней стороны)
    for (const side of [1, -1]) {
      const pts: [number, number][] = [];
      for (let d = d0; d <= d1 + 1e-6; d += Math.max(0.5, (d1 - d0) / Math.ceil((d1 - d0) / 1.5))) pts.push([s.au + ex * d + nx * side, s.av + ez * d + nz * side]);
      if (pts.length < 2) continue;
      const smp = resample(pts, 1.5, false, side);
      const hEdge = (q: CSample): number => {
        const d = (q.u - s.au) * ex + (q.v - s.av) * ez;
        return H(d, (s.w / 2) * side);
      };
      cliffDown(B, zone, smp, false, hEdge);
      if (s.kind === "tunnel" || s.kind === "ramp" || s.kind === "stairs" || s.kind === "ledge") caveWalls(B, s, smp, false);
    }
  }
  // свод тоннеля (у связок между залами, кроме уступов колодца и гати)
  if (s.kind === "tunnel" || s.kind === "ramp" || (s.kind === "stairs" && styleOf.get(zone) !== "hall")) {
    const ceil = B.part("ceiling", zone);
    for (let k = 0; k + 1 < sec.length; k++) {
      const A = sec[k];
      const C = sec[k + 1];
      const up = 7;
      const base = ceil.pos.length / 3;
      ceil.pos.push(A.a[0], A.a[1] + up, A.a[2], A.b[0], A.b[1] + up, A.b[2], C.b[0], C.b[1] + up, C.b[2], C.a[0], C.a[1] + up, C.a[2]);
      for (const q of [A.a, A.b, C.b, C.a]) ceil.uv.push(q[0] / 4, q[2] / 4);
      ceil.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
}
