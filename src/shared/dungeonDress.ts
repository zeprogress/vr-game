import {
  DUN_BOSS_GATE,
  DUN_SPOTS,
  DUN_SHAPES,
  DUN_VOIDS,
  DUN_VOID_H,
  DUN_ZONES,
  type DunShape,
  type DunZone,
  dunFloorLocal,
  dunInPoly,
  dunRoomHeight,
} from "./dungeon";

/**
 * Расстановка модулей набора подземелья (public/models/dungeon/DungeonKit.glb, генератор —
 * tools/blender/gen_dkit.py) по планировке shared/dungeon. Чистый расчёт без движка и без случайности
 * между запусками (свой seed): клиент делает из этого инстансы, превью в Blender — тот же список.
 *
 * Координаты — локальные подземелья в осях игры: x = u (восток), y = высота над DUN_Y0, z = v (север).
 * Модуль в игре: «лицо» смотрит в +Z, верх — +Y (Blender −Y → игра +Z; см. gen_dkit.py).
 * Поворот задаётся базисом: f — куда смотрит лицо модуля, up — его верх (правая ось = up × f).
 */
export interface DunPiece {
  /** Меш набора без суффикса LOD: "RockWall_1". */
  k: string;
  /** Зона (для кусков-чанков и отсечения по залам). */
  zone: string;
  p: [number, number, number];
  f: [number, number, number];
  up: [number, number, number];
  s: [number, number, number];
}

/** Источник света подземелья (жаровня, кристалл): клиент держит 4 настоящих источника у ближайших. */
export interface DunLight {
  zone: string;
  p: [number, number, number];
  color: [number, number, number];
  range: number;
  power: number;
  /** Огонь: размер пламени (1 — жаровня) и высота пола для пятна света под ним; нет — без пламени (кристалл). */
  flame?: number;
  floor?: number;
  /** Кристалл: высота пола под ним и размер холодного пятна свечения (м) — пятно у каждого, свет — у ближайших. */
  glow?: { floor: number; size: number };
}
let dressLights: DunLight[] = [];
/** Источники света (после dunDress — тот же детерминированный список). */
export function dunLights(): DunLight[] {
  if (!dressLights.length) dunDress();
  return dressLights;
}

/** Гигантские кристаллы-ориентиры: зона, u, v, высота основания, масштаб. */
const DUN_GIANT_CRYSTALS: readonly [string, number, number, number, number][] = [
  ["U", -170, -104, 26, 1.3],
  ["D", -112, -92, 26, 0.9],
  ["D", -62, -60, 26, 0.7],
  ["E", -196, -40, 2, 1.6],
  ["E", -192, 44, 2, 1.4],
  ["E", -150, -70, 2, 1.1],
  ["W", -180, 100, 24, 0.8],
  ["O", 176, -84, 18, 0.6],
];

/** Отдельные жаровни: зона, u, v (у входов их ставит расстановка сама). */
const DUN_BRAZIERS: readonly [string, number, number][] = [
  ["A", -6, -194], ["A", 6, -194],
  ["B", -8, -146], ["B", 8, -146], ["B", -10, -116], ["B", 10, -116],
  ["G", -14, 72], ["G", 14, 72], ["G", -24, 50], ["G", 24, 50],
  ["V", -6, 120], ["V", 6, 120],
  ["H", -40, 150], ["H", 40, 150], ["H", -40, 180], ["H", 40, 180], ["H", -14, 190], ["H", 14, 190],
  ["P", 64, 70], ["P", 118, 60], ["Y", 166, 50], ["Y", 184, 94], ["Y", 174, 72],
  ["X", -130, 160], ["X", -160, 176], ["R", -40, 100], ["R", -70, 102], ["J", 90, 182], ["Z", 150, 170], ["Z", 170, 150],
  ["K", 70, -140], ["K", 140, -146], ["K", 110, -86],
];

/** Число вариантов модулей в наборе (как в gen_dkit.py MODULES). */
const VARIANTS: Record<string, number> = {
  RockWall: 3, RockOutcrop: 3, Rubble: 4, Stalactite: 3, Stalagmite: 3, CliffPillar: 2,
  Column: 2, Arch: 1, Wall: 2, Stairs: 1, BridgeSeg: 2, Crystal: 3, Brazier: 1,
  Sconce: 1, Barrel: 2, Crate: 2, Chest: 1, MineCart: 1, Cage: 1, Banner: 2, Statue: 2, Bones: 3,
};

/**
 * Пропсы по зонам: что стоит у стен (кучками, в 1.5–3 м от края, не у проходов и не на связках) и
 * насколько густо. Каждая зона рассказывает своё: лагерь экспедиции, шахта, казармы, склеп, логово.
 */
const ZONE_PROPS: Record<string, { p: number; kit: string[] }> = {
  A: { p: 0.7, kit: ["Crate", "Barrel", "Crate", "Barrel", "Bones"] },
  B: { p: 0.25, kit: ["Bones", "Bones", "Crate"] },
  T: { p: 0.22, kit: ["Bones", "Crate", "Barrel"] },
  K: { p: 0.55, kit: ["MineCart", "Crate", "Barrel", "Crate", "MineCart"] },
  P: { p: 0.6, kit: ["Barrel", "Crate", "Banner", "Barrel", "Cage"] },
  Y: { p: 0.5, kit: ["Barrel", "Crate", "MineCart", "Barrel"] },
  R: { p: 0.55, kit: ["Bones", "Bones", "Cage", "Bones"] },
  W: { p: 0.5, kit: ["Bones", "Cage", "Bones", "Bones"] },
  X: { p: 0.35, kit: ["Bones", "Banner", "Bones"] },
  U: { p: 0.2, kit: ["Bones"] },
  D: { p: 0.15, kit: ["Bones", "Crate"] },
  Q: { p: 0.2, kit: ["Bones", "Barrel"] },
  Z: { p: 0.45, kit: ["Chest", "Barrel", "Crate", "Chest"] },
  O: { p: 0.4, kit: ["Chest", "Bones"] },
  I: { p: 0.4, kit: ["Crate", "Barrel", "Bones"] },
  N: { p: 0.15, kit: ["Bones"] },
  F: { p: 0.08, kit: ["Bones"] },
  S: { p: 0.1, kit: ["Bones"] },
  G: { p: 0.0, kit: [] },
  H: { p: 0.0, kit: [] },
  V: { p: 0.0, kit: [] },
  C: { p: 0.1, kit: ["Bones"] },
  J: { p: 0.3, kit: ["Crate", "Barrel"] },
  W2: { p: 0, kit: [] },
};

/** Детерминированный генератор (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const zoneOf = new Map(DUN_ZONES.map((z) => [z.id, z] as const));
const inVoid = (u: number, v: number): boolean => DUN_VOIDS.some((pts) => dunInPoly(pts, u, v));

const UP: [number, number, number] = [0, 1, 0];

/** Залы с низким сводом (м): у них есть потолок и сталактиты; выше — тёмный свод пещеры (этап света). */
export const DUN_LOW_CEIL = 16;

/** Точка края фигуры с внешней нормалью. */
export interface Edge {
  u: number;
  v: number;
  nu: number;
  nv: number;
  shape: DunShape;
}

/** Края фигуры, шаг step м (у кольца — только внешний; у связки — бока на участке между комнатами). */
export function edgesOf(s: DunShape, step: number): Edge[] {
  const out: Edge[] = [];
  if (s.t === "disc") {
    const n = Math.max(6, Math.round((2 * Math.PI * s.r) / step));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      out.push({ u: s.u + Math.cos(a) * s.r, v: s.v + Math.sin(a) * s.r, nu: Math.cos(a), nv: Math.sin(a), shape: s });
    }
    return out;
  }
  if (s.t === "poly") {
    let area = 0;
    for (let i = 0, j = s.pts.length - 1; i < s.pts.length; j = i++) area += s.pts[j][0] * s.pts[i][1] - s.pts[i][0] * s.pts[j][1];
    const ccw = area > 0;
    for (let i = 0, j = s.pts.length - 1; i < s.pts.length; j = i++) {
      const [au, av] = s.pts[j];
      const [bu, bv] = s.pts[i];
      const L = Math.hypot(bu - au, bv - av);
      // внешняя нормаль: у обхода против часовой — справа от стороны
      const nu = ((bv - av) / L) * (ccw ? 1 : -1);
      const nv = (-(bu - au) / L) * (ccw ? 1 : -1);
      const n = Math.max(1, Math.round(L / step));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        out.push({ u: au + (bu - au) * t, v: av + (bv - av) * t, nu, nv, shape: s });
      }
    }
    return out;
  }
  const L = Math.hypot(s.bu - s.au, s.bv - s.av);
  const ex = (s.bu - s.au) / L;
  const ez = (s.bv - s.av) / L;
  const d0 = s.room ? Math.max(0, s.sa) : 0;
  const d1 = s.room ? Math.min(L, s.sb) : L;
  const n = Math.max(1, Math.round((d1 - d0) / step));
  for (const side of [1, -1]) {
    for (let k = 0; k < n; k++) {
      const d = d0 + ((d1 - d0) * (k + 0.5)) / n;
      const cu = s.au + ex * d;
      const cv = s.av + ez * d;
      const nu = ez * side;
      const nv = -ex * side;
      out.push({ u: cu + nu * (s.w / 2), v: cv + nv * (s.w / 2), nu, nv, shape: s });
    }
  }
  return out;
}

function zoneCeil(z: DunZone | undefined, s: DunShape): number {
  if (s.t === "strip") return s.kind === "ledge" ? 30 : 7;
  return z?.ceil ?? 12;
}

/** Высота пола у края (чуть внутрь фигуры). */
export function floorAt(e: Edge): number {
  return dunFloorLocal(e.u - e.nu * 0.6, e.v - e.nv * 0.6) ?? dunRoomHeight(e.shape, e.u, e.v);
}

/** Край открыт: дальше пол той же высоты (проход) или пустота (разлом, озеро, колодец). */
export function edgeOpen(e: Edge, h: number): boolean {
  for (const d of [2.5, 5]) {
    const q = dunFloorLocal(e.u + e.nu * d, e.v + e.nv * d);
    if (q !== null && Math.abs(q - h) < 4) return true;
  }
  return inVoid(e.u + e.nu * 4, e.v + e.nv * 4);
}

const variant = (k: string, r: () => number): string => `${k}_${Math.floor(r() * VARIANTS[k])}`;

/** Точки проходов: края фигур, за которыми пол той же высоты (вход в соседний зал, тоннель, мост). */
function passagePoints(): [number, number][] {
  const out: [number, number][] = [];
  for (const s of DUN_SHAPES) {
    for (const e of edgesOf(s, 2)) {
      const h = floorAt(e);
      const q = dunFloorLocal(e.u + e.nu * 2.5, e.v + e.nv * 2.5);
      if (q !== null && Math.abs(q - h) < 4) out.push([e.u, e.v]);
    }
  }
  return out;
}

/** Точка ближе d к оси связки (тоннель, лестница, мост…) — там ничего не ставим. */
function onLink(u: number, v: number, d: number): boolean {
  for (const s of DUN_SHAPES) {
    if (s.t !== "strip") continue;
    const dx = s.bu - s.au;
    const dz = s.bv - s.av;
    const L2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((u - s.au) * dx + (v - s.av) * dz) / L2));
    if (Math.hypot(u - (s.au + dx * t), v - (s.av + dz * t)) < s.w / 2 + d) return true;
  }
  return false;
}

/** Лицо скалы шириной 2·hw у края e ляжет на пол (проход, соседний зал, вогнутый угол)? */
function wallBlocks(e: Edge, hw: number): boolean {
  for (let t = -hw; t <= hw; t += 1) {
    const u = e.u + e.nu * 0.6 - e.nv * t;
    const v = e.v + e.nv * 0.6 + e.nu * t;
    if (dunFloorLocal(u, v) !== null) return true;
  }
  return false;
}

/** Вся расстановка (порядок и числа детерминированы). */
export function dunDress(): DunPiece[] {
  const out: DunPiece[] = [];
  const r = rng(20261012);
  const put = (k: string, zone: string, p: [number, number, number], f: [number, number, number], s: [number, number, number], up = UP): void => {
    out.push({ k, zone, p, f, up, s });
  };

  const openings = passagePoints();
  const nearOpening = (u: number, v: number, d: number): boolean => openings.some(([a, b]) => (a - u) ** 2 + (b - v) ** 2 < d * d);

  for (const s of DUN_SHAPES) {
    const z = zoneOf.get(s.zone);
    const style = z?.style ?? "cave";
    if (s.t === "strip" && (s.kind === "bridge" || s.kind === "rope" || s.kind === "causeway")) continue;
    if ((s.t === "disc" || s.t === "poly") && s.ledge) continue;
    const ceil = zoneCeil(z, s);
    const temple = style === "temple" && s.t !== "strip";
    // связки (тоннели, пандусы) закрыты всегда; залы — по зоне
    const enclose = s.t === "strip" ? "closed" : (z?.enclose ?? "closed");

    // --- Стены. Постройки — сплошная кладка в dungeonGeo (здесь — изредка обломок у подножия).
    // Скала: closed — до двух рядов; partial — один низкий ряд с разрывами-«окнами»; open — только
    // глыбы по краю. Скала не ставится поперёк прохода (лицо не должно пересекать пол).
    for (const e of edgesOf(s, temple ? 4 : 8)) {
      const h = floorAt(e);
      if (edgeOpen(e, h)) continue;
      const inward: [number, number, number] = [-e.nu, 0, -e.nv];
      if (temple) {
        if (enclose === "closed" && r() < 0.08 && !nearOpening(e.u, e.v, 6)) put("Wall_1", s.zone, [e.u - e.nu * 1.2, h, e.v - e.nv * 1.2], inward, [0.8, 0.6, 0.8]);
        continue;
      }
      if (enclose === "open") {
        // открытый край: глыбы-«бордюр» (у руин — реже, там гранитный парапет из dungeonGeo)
        if (style === "cave" || style === "hall" || r() < 0.35) {
          for (const t of [-2.5, 1.5]) {
            const u = e.u - e.nv * t + e.nu * 0.2;
            const v = e.v + e.nu * t + e.nv * 0.2;
            if (nearOpening(u, v, 4) || r() < 0.3) continue;
            put(variant("Rubble", r), s.zone, [u, h - 0.25, v], [Math.cos(r() * 6.3), 0, Math.sin(r() * 6.3)], [1.4 + r() * 1.2, 0.8 + r() * 0.8, 1.4 + r() * 1.2]);
          }
        }
        continue;
      }
      // Стена — сплошная скала из dungeonGeo; глыбы набора — редкие акценты, наполовину утопленные в неё.
      if (r() < 0.62 || nearOpening(e.u, e.v, 9)) continue;
      const sc = enclose === "partial" ? 0.35 + r() * 0.25 : 0.5 + r() * 0.4;
      const rows = 1;
      for (let row = 0; row < rows; row++) {
        let s2 = sc * (0.9 + r() * 0.25);
        const wide = 0.9 + r() * 0.3;
        // не перекрыть проход: лицо скалы (по ширине модуля) не должно лечь на пол
        for (const k of [1, 0.7, 0.45, 0]) {
          if (k === 0 || !wallBlocks(e, 5.3 * s2 * wide * k)) {
            s2 *= k;
            break;
          }
        }
        if (s2 <= 0) break;
        const back = 2.1 * s2 + 1.0 + r() * 0.8; // лицо глыбы — в толще стены, наружу торчит выступ
        put(variant("RockWall", r), s.zone, [e.u + e.nu * back, h - 0.5 + row * 7 * sc, e.v + e.nv * back], inward, [s2 * wide, s2, s2]);
      }
      // мелочь у стены — не у проходов, не на связках и не на маленьких площадках (углы уступов)
      if (nearOpening(e.u, e.v, 6) || onLink(e.u, e.v, 3) || (s.t === "disc" && s.r < 8)) continue;
      if (r() < 0.5) {
        const k = 1.0 + r() * 1.6;
        put(variant("Rubble", r), s.zone, [e.u - e.nu * k, h, e.v - e.nv * k], [Math.cos(r() * 6.3), 0, Math.sin(r() * 6.3)], [0.8 + r() * 1.4, 0.7 + r() * 1.0, 0.8 + r() * 1.4]);
      }
      if (style === "cave" && s.t !== "strip" && r() < 0.18) {
        const k = 2.2 + r() * 1.5;
        put(variant("RockOutcrop", r), s.zone, [e.u - e.nu * k, h - 0.2, e.v - e.nv * k], inward, [0.6 + r() * 0.5, 0.6 + r() * 0.5, 0.6 + r() * 0.5]);
      } else if (style === "cave" && s.t !== "strip" && r() < 0.15) {
        const k = 1.5 + r() * 1.5;
        put(variant("Stalagmite", r), s.zone, [e.u - e.nu * k, h, e.v - e.nv * k], [1, 0, 0], [0.8 + r() * 0.6, 0.7 + r() * 0.8, 0.8 + r() * 0.6]);
      }
    }

    // --- Сталактиты со свода пещер и руин (не в постройках и не над бездной).
    if (style !== "temple" && ceil <= DUN_LOW_CEIL && (s.t === "poly" || (s.t === "disc" && !s.ri && s.r > 8))) {
      const box = s.t === "disc" ? [s.u - s.r, s.v - s.r, s.u + s.r, s.v + s.r] : [
        Math.min(...s.pts.map((p) => p[0])), Math.min(...s.pts.map((p) => p[1])), Math.max(...s.pts.map((p) => p[0])), Math.max(...s.pts.map((p) => p[1])),
      ];
      const area = (box[2] - box[0]) * (box[3] - box[1]);
      const n = Math.round(area / 260);
      for (let i = 0; i < n; i++) {
        const u = box[0] + r() * (box[2] - box[0]);
        const v = box[1] + r() * (box[3] - box[1]);
        const h = dunFloorLocal(u, v);
        if (h === null) continue;
        put(variant("Stalactite", r), s.zone, [u, h + ceil + 0.3, v], [1, 0, 0], [0.9 + r() * 0.8, 0.8 + r() * 1.0, 0.9 + r() * 0.8]);
      }
    }
  }

  // --- Опоры: под площадками в пустотах (мост Предков, мост над озером, столбы у тайника) и под длинными мостами.
  for (const s of DUN_SHAPES) {
    if (s.t === "disc" && !s.ri && inVoid(s.u, s.v)) {
      const sx = (s.r / 3.1) * 0.95;
      put(variant("CliffPillar", r), s.zone, [s.u, DUN_VOID_H, s.v], [1, 0, 0], [sx, (s.h - DUN_VOID_H - 0.35) / 20, sx]);
    }
    if (s.t === "strip" && (s.kind === "bridge" || s.kind === "rope")) {
      const L = Math.hypot(s.bu - s.au, s.bv - s.av);
      const span = s.sb - s.sa;
      const n = Math.floor(span / 24);
      for (let k = 1; k <= n; k++) {
        const d = s.sa + (span * k) / (n + 1);
        const u = s.au + ((s.bu - s.au) * d) / L;
        const v = s.av + ((s.bv - s.av) * d) / L;
        const h = dunFloorLocal(u, v);
        if (h === null) continue;
        const sx = s.w / 7;
        put(variant("CliffPillar", r), s.zone, [u, DUN_VOID_H, v], [1, 0, 0], [sx, (h - DUN_VOID_H - (s.kind === "rope" ? 0.5 : 2.4)) / 20, sx]);
      }
    }
  }

  // --- Каменные мосты: пролёты по 4 м вдоль моста (настил вровень с полом, с уклоном моста).
  for (const s of DUN_SHAPES) {
    if (s.t !== "strip" || s.kind !== "bridge") continue;
    const L = Math.hypot(s.bu - s.au, s.bv - s.av);
    const ex = (s.bu - s.au) / L;
    const ez = (s.bv - s.av) / L;
    const d0 = Math.max(0, s.sa - 0.5);
    const d1 = Math.min(L, s.sb + 0.5);
    const n = Math.max(1, Math.round((d1 - d0) / 4));
    const seg = (d1 - d0) / n;
    for (let k = 0; k < n; k++) {
      const da = d0 + seg * k;
      const db = da + seg;
      const ha = dunFloorLocal(s.au + ex * da, s.av + ez * da) ?? s.ha;
      const hb = dunFloorLocal(s.au + ex * db, s.av + ez * db) ?? s.hb;
      const dm = (da + db) / 2;
      const f = norm([ex * seg, hb - ha, ez * seg]);
      put(r() < 0.15 ? "BridgeSeg_1" : "BridgeSeg_0", s.zone, [s.au + ex * dm, (ha + hb) / 2, s.av + ez * dm], f, [s.w / 6, 1, (Math.hypot(seg, hb - ha) / 4) * 1.02], upOf(f));
    }
  }

  // --- Лестницы: марши по уклону связки (у марша ступени поднимаются к −Z модуля).
  for (const s of DUN_SHAPES) {
    if (s.t !== "strip" || s.kind !== "stairs" || s.ha === s.hb) continue;
    const L = Math.hypot(s.bu - s.au, s.bv - s.av);
    const run = s.sb - s.sa;
    if (run < 1) continue;
    const up = s.hb > s.ha ? 1 : -1;
    const ex = ((s.bu - s.au) / L) * up;
    const ez = ((s.bv - s.av) / L) * up;
    const n = Math.max(1, Math.round(run / 3.6));
    const seg = run / n;
    const rise = Math.abs(s.hb - s.ha) / n;
    for (let k = 0; k < n; k++) {
      // от нижнего края к верхнему
      const dLow = up > 0 ? s.sa + seg * k : s.sb - seg * k;
      const dm = dLow + (seg / 2) * up;
      const base = Math.min(s.ha, s.hb) + rise * k;
      put("Stairs_0", s.zone, [s.au + ((s.bu - s.au) / L) * dm, base - 0.02, s.av + ((s.bv - s.av) / L) * dm], [-ex, 0, -ez], [s.w / 4, rise / 2.4, seg / 3.6]);
    }
  }

  // --- Колонны: неф (два ряда до ворот), святилище по краю, преддверие, руины (часть обломана).
  // неф — открытая колоннада: редкие колонны по самому краю, между ними вид на пещеру с обеих сторон
  for (const v of [81, 94, 107, 119]) for (const sx of [-1, 1]) put("Column_0", "V", [sx * 9, 56, v], [0, 0, 1], [1.0, 2.6, 1.0]);
  {
    // святилище: по контуру, в 4 м от края
    const H = DUN_SHAPES.find((s) => s.t === "poly" && s.zone === "H");
    if (H) for (const e of edgesOf(H, 13)) {
      if (Math.abs(e.u) < 14 && e.v < 130) continue; // не у ворот
      put("Column_0", "H", [e.u - e.nu * 5, 56, e.v - e.nv * 5], [-e.nu, 0, -e.nv], [2.2, 3.2, 2.2]);
    }
  }
  for (const [u, v] of [[-26, 52], [26, 52], [-30, 70], [30, 70]] as const) if (!onLink(u, v, 2)) put("Column_0", "G", [u, 56, v], [0, 0, 1], [1.1, 2.0, 1.1]);
  for (const [u, v, broken] of [[-24, -146, 1], [22, -148, 0], [-28, -128, 1], [26, -126, 1], [-10, -118, 1], [12, -116, 0]] as const) {
    put(broken ? "Column_1" : "Column_0", "B", [u, 54, v], [Math.cos(u), 0, Math.sin(u)], [1, 1.2 + r() * 0.4, 1]);
  }

  // --- Арки на входах в постройки и руины (там, где связка входит в зал hall/temple).
  for (const s of DUN_SHAPES) {
    if (s.t !== "strip" || !s.room || s.kind === "bridge" || s.kind === "rope") continue;
    const L = Math.hypot(s.bu - s.au, s.bv - s.av);
    const ex = (s.bu - s.au) / L;
    const ez = (s.bv - s.av) / L;
    for (const [d, dir] of [[s.sa, -1], [s.sb, 1]] as const) {
      const u = s.au + ex * d;
      const v = s.av + ez * d;
      const room = DUN_SHAPES.find((q) => q.t !== "strip" && !q.ledge && dunRoomHeight(q, u, v) !== undefined && (q.t === "disc" ? Math.hypot(u - q.u, v - q.v) < q.r + 1.5 : dunInPoly(q.pts, u + ex * dir * 1.5, v + ez * dir * 1.5)));
      const st = room ? zoneOf.get(room.zone)?.style : undefined;
      // арки — только на входах в постройки; у пещер и руин проём — скальный
      if (st !== "temple") continue;
      const h = dunFloorLocal(u, v);
      if (h === null) continue;
      const sx = Math.max(1, (s.w + 1.5) / 8);
      put("Arch_0", room!.zone, [u, h - 0.05, v], [ex, 0, ez], [sx, Math.max(1, sx * 0.9), 1]);
    }
  }
  // --- Стены вокруг пустот (озеро, разлом, колодец) — сплошная скала из dungeonGeo (voidWalls).

  // --- Кристаллы: друзы у стен пещер, кластеры, гиганты-ориентиры (холодный свет).
  for (const s of DUN_SHAPES) {
    const z = zoneOf.get(s.zone);
    if (z?.style !== "cave" || s.t === "strip" || ((s.t === "disc" || s.t === "poly") && s.ledge)) continue;
    const rich = s.zone === "D" || s.zone === "U" || s.zone === "N" || s.zone === "O";
    for (const e of edgesOf(s, 5)) {
      const h = floorAt(e);
      if (edgeOpen(e, h) || nearOpening(e.u, e.v, 5) || onLink(e.u, e.v, 2)) continue;
      const q = r();
      if (q < (rich ? 0.35 : 0.12)) {
        const k = 0.4 + r() * 0.8;
        put("Crystal_0", s.zone, [e.u - e.nu * k, h - 0.05, e.v - e.nv * k], [-e.nu, 0, -e.nv], [1 + r(), 1 + r() * 1.2, 1 + r()]);
      } else if (q < (rich ? 0.5 : 0.17)) {
        const k = 0.6 + r() * 0.8;
        put("Crystal_1", s.zone, [e.u - e.nu * k, h - 0.1, e.v - e.nv * k], [-e.nu, 0, -e.nv], [0.8 + r() * 0.6, 0.8 + r() * 0.7, 0.8 + r() * 0.6]);
      }
    }
  }
  for (const [zone, u, v, y, sc] of DUN_GIANT_CRYSTALS) {
    put("Crystal_2", zone, [u, y, v], [Math.cos(u), 0, Math.sin(u)], [sc, sc, sc]);
  }
  // кристаллы на стенах разлома и колодца — свечение из глубины
  for (const [zone, u, v, y] of [["C", -38, -70, 18], ["C", 38, -96, 6], ["C", -36, -100, 30], ["C", 37, -60, 24], ["N", 158, -90, 10], ["N", 184, -62, 4]] as const) {
    put("Crystal_1", zone, [u, y, v], [-Math.sign(u), 0.2, 0], [2, 2, 2]);
  }

  // --- Жаровни: у входов в руины и постройки, в храме и зале босса, на площадке моста, вокруг провала.
  const braziers: [string, number, number][] = [];
  const brazier = (zone: string, u: number, v: number): void => {
    const h = dunFloorLocal(u, v, 0.6);
    if (h === null || onLink(u, v, 0.5)) return;
    put("Brazier_0", zone, [u, h, v], [1, 0, 0], [1, 1, 1]);
    braziers.push([zone, u, v]);
  };
  for (const s of DUN_SHAPES) {
    if (s.t !== "strip" || !s.room || s.kind === "bridge" || s.kind === "rope") continue;
    const L = Math.hypot(s.bu - s.au, s.bv - s.av);
    const ex = (s.bu - s.au) / L;
    const ez = (s.bv - s.av) / L;
    for (const [d, dir] of [[s.sa, -1], [s.sb, 1]] as const) {
      const u = s.au + ex * (d + dir * 2.5);
      const v = s.av + ez * (d + dir * 2.5);
      const zid = DUN_SHAPES.find((q) => q.t !== "strip" && !q.ledge && dunInPoly(q.t === "poly" ? q.pts : [], u, v))?.zone ?? s.zone;
      const st = zoneOf.get(zid)?.style;
      if (st !== "temple" && st !== "hall") continue;
      const off = s.w / 2 + 1.6;
      brazier(zid, u + ez * off, v - ex * off);
      brazier(zid, u - ez * off, v + ex * off);
    }
  }
  for (const [zone, u, v] of DUN_BRAZIERS) brazier(zone, u, v);
  // кольцо жаровен вокруг провала зала Кольца и на площадке Моста Предков
  for (let k = 0; k < 6; k++) brazier("F", Math.cos((k / 6) * Math.PI * 2 + 0.5) * 14, -10 + Math.sin((k / 6) * Math.PI * 2 + 0.5) * 14);
  for (let k = 0; k < 4; k++) brazier("C", Math.cos((k / 4) * Math.PI * 2 + 0.78) * 12.5, -80 + Math.sin((k / 4) * Math.PI * 2 + 0.78) * 12.5);
  // --- Пропсы у стен по зонам: кучки по 1–3 предмета, лицом в зал; бочка иногда на боку.
  const sconces: [string, number, number, number][] = [];
  const propOk = (u: number, v: number, r: number): boolean =>
    dunFloorLocal(u, v, r) !== null && !onLink(u, v, 1.2) && !nearOpening(u, v, 5);
  for (const s of DUN_SHAPES) {
    if (s.t === "strip" || s.ledge) continue;
    const zp = ZONE_PROPS[s.zone];
    if (!zp || zp.p <= 0) continue;
    for (const e of edgesOf(s, 7)) {
      if (r() > zp.p) continue;
      const h = floorAt(e);
      if (edgeOpen(e, h)) continue;
      const n = 1 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) {
        const kind = zp.kit[Math.floor(r() * zp.kit.length)];
        const inset = 1.6 + r() * 1.6 + (kind === "MineCart" || kind === "Cage" ? 1 : 0);
        const side = (k - (n - 1) / 2) * 1.5 + (r() - 0.5);
        const u = e.u - e.nu * inset - e.nv * side;
        const v = e.v - e.nv * inset + e.nu * side;
        if (!propOk(u, v, 0.9)) continue;
        const yaw = Math.atan2(-e.nu, -e.nv) + (r() - 0.5) * (kind === "Banner" || kind === "Cage" ? 0.3 : 1.6);
        const sc = kind === "Bones" ? 1 + r() * 0.4 : 0.9 + r() * 0.25;
        put(variant(kind, r), s.zone, [u, (dunFloorLocal(u, v) ?? h) - 0.02, v], [Math.sin(yaw), 0, Math.cos(yaw)], [sc, sc, sc]);
      }
    }
    // настенные факелы — в закрытых постройках, через ~12 м по стене
    const z = zoneOf.get(s.zone);
    if (z?.style === "temple" && z.enclose === "closed") {
      for (const e of edgesOf(s, 12)) {
        const h = floorAt(e);
        if (edgeOpen(e, h) || nearOpening(e.u, e.v, 4)) continue;
        // кронштейн «лицом» (+Y модуля → +Z игры) в зал, задником в стену
        put("Sconce_0", s.zone, [e.u - e.nu * 0.05, h + 2.6, e.v - e.nv * 0.05], [-e.nu, 0, -e.nv], [1.4, 1.4, 1.4]);
        sconces.push([s.zone, e.u - e.nu * 0.64, h + 2.6 + 0.35 * 1.4 + 0.25, e.v - e.nv * 0.64]);
      }
    }
  }
  // сундуки (тайники и награды) — на точках DUN_SPOTS.chests, лицом к центру зала
  for (const c of DUN_SPOTS.chests) {
    const h = dunFloorLocal(c.u, c.v);
    if (h === null) continue;
    const zone = DUN_SHAPES.find((q) => q.t !== "strip" && dunInPoly(q.t === "poly" ? q.pts : [], c.u, c.v))?.zone ?? "A";
    put("Chest_0", zone, [c.u, h, c.v], [Math.cos(c.u), 0, Math.sin(c.u)], [1.2, 1.2, 1.2]);
  }
  // статуи-стражи: у входа в храм, у ворот святилища, вдоль стен зала босса
  for (const [zone, u, v, sc, fu, fv, broken] of [
    ["G", -13, 70, 1.6, 0, -1, 0], ["G", 13, 70, 1.6, 0, -1, 0],
    ["V", -7, 117, 1.3, 0, -1, 0], ["V", 7, 117, 1.3, 0, -1, 0],
    ["H", -50, 160, 1.7, 1, 0, 0], ["H", 50, 160, 1.7, -1, 0, 0], ["H", -26, 190, 1.7, 0.4, -1, 0], ["H", 26, 190, 1.7, -0.4, -1, 0],
  ] as const) {
    const h = dunFloorLocal(u, v);
    if (h === null) continue;
    const l = Math.hypot(fu, fv);
    put(broken ? "Statue_1" : "Statue_0", zone, [u, h, v], [fu / l, 0, fv / l], [sc, sc, sc]);
  }
  // знамёна: вдоль нефа между колоннами и по бокам зала босса
  for (const v of [87.5, 100.5, 113]) for (const sx of [-1, 1]) put("Banner_0", "V", [sx * 8.6, 56, v], [-sx, 0, 0], [1.1, 1.1, 1.1]);
  for (const [u, v, fu] of [[-58, 146, 1], [58, 146, -1], [-55, 176, 1], [55, 176, -1]] as const) put("Banner_1", "H", [u, 56, v], [fu, 0, 0], [1.6, 1.6, 1.6]);
  for (const u of [-30, 30]) put("Banner_0", "G", [u, 56, 74], [0, 0, -1], [1.3, 1.3, 1.3]);

  // Кристаллы — фон: у огня (жаровни, факелы) их нет — тёплые островки и холодный фон не смешиваются.
  const fires: [number, number, number][] = [
    ...braziers.map(([, u, v]) => [u, dunFloorLocal(u, v) ?? 0, v] as [number, number, number]),
    ...sconces.map(([, u, y, v]) => [u, y, v] as [number, number, number]),
  ];
  const nearFire = (x: number, y: number, z: number, d: number): boolean => fires.some(([a, b, c]) => (a - x) ** 2 + ((b - y) * 0.6) ** 2 + (c - z) ** 2 < d * d);
  for (let i = out.length - 1; i >= 0; i--) {
    const pc = out[i];
    if (pc.k.startsWith("Crystal") && nearFire(pc.p[0], pc.p[1], pc.p[2], pc.k === "Crystal_2" ? 26 : 16)) out.splice(i, 1);
  }

  dressLights = [
    ...sconces.map(([zone, u, y, v]) => ({ zone, p: [u, y, v] as [number, number, number], color: [1, 0.5, 0.18] as [number, number, number], range: 14, power: 0.8, flame: 0.45 })),
    ...braziers.map(([zone, u, v]) => ({ zone, p: [u, (dunFloorLocal(u, v) ?? 0) + 1.85, v] as [number, number, number], color: [1, 0.55, 0.22] as [number, number, number], range: 20, power: 1, flame: 1, floor: dunFloorLocal(u, v) ?? 0 })),
    ...DUN_GIANT_CRYSTALS.filter(([, u, v, y]) => !nearFire(u, y, v, 26)).map(([zone, u, v, y, sc]) => ({
      zone, p: [u, y + 4 * sc, v] as [number, number, number], color: [0.3, 0.58, 1] as [number, number, number], range: 34 * sc, power: 1.3,
      glow: { floor: y, size: 14 * sc },
    })),
    // Мелкие кристаллы (друзы у стен, в разломе и колодце) — тот же холодный свет, слабее и ближе, по размеру друзы.
    ...out
      .filter((pc) => pc.k === "Crystal_0" || pc.k === "Crystal_1" || pc.k === "Crystal_2")
      .map((pc) => {
        const sz = (pc.s[0] + pc.s[1] + pc.s[2]) / 3;
        // пятно на полу — только у друз, стоящих на полу (на стенах разлома и колодца — висело бы в воздухе)
        const fl = dunFloorLocal(pc.p[0], pc.p[2]);
        const onFloor = fl !== null && Math.abs(fl - pc.p[1]) < 1.5;
        return {
          zone: pc.zone, p: [pc.p[0], pc.p[1] + 1.1 * pc.s[1], pc.p[2]] as [number, number, number],
          color: [0.3, 0.58, 1] as [number, number, number], range: 9 * sz, power: (pc.k === "Crystal_2" ? 0.8 : 0.6) * Math.min(1.5, sz),
          glow: onFloor ? { floor: pc.p[1], size: 5 * sz } : undefined,
        };
      }),
  ];

  // Стены всей пещеры и свод — один меш-купол (dungeonGeo, «DOME»), здесь — ничего.

  // ворота святилища ставит клиент отдельно (DUN_BOSS_GATE); здесь — без модулей
  void DUN_BOSS_GATE;
  return out;
}

function norm(a: [number, number, number]): [number, number, number] {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** Верх, перпендикулярный наклонному «лицу» f (для пролётов моста с уклоном). */
function upOf(f: [number, number, number]): [number, number, number] {
  // up = f × (right), где right — горизонталь, перпендикулярная f
  const rx = f[2];
  const rz = -f[0];
  const rl = Math.hypot(rx, rz) || 1;
  const R: [number, number, number] = [rx / rl, 0, rz / rl];
  // up = f × R  (правый базис: R = up × f)
  return norm([f[1] * R[2] - f[2] * R[1], f[2] * R[0] - f[0] * R[2], f[0] * R[1] - f[1] * R[0]]);
}
