import { BOSS, LAKE, MOB_CAMPS, MOUNTAIN, WORLD } from "./constants";
import { HUB, HUB_CENTER } from "./hub";
import { TOWER_PROP_POS } from "./tower";

/**
 * Выразительный рельеф поляны (2026-10-02): холмы, столовые горы с отвесными
 * склонами, ямы и гряды. Набор форм ДЕТЕРМИНИРОВАННЫЙ (свой генератор с
 * постоянным зерном) — одинаковый на сервере и у всех клиентов.
 *
 * Не трогаем: лагерь героев, центр поляны, озеро с горой и центры лагерей
 * мобов, Багрового и декоративную башню — там ровно, как было. Поменять
 * рельеф = поменять RELIEF (числа) или зерно.
 */
export const RELIEF = {
  seed: 20261002,
  /** Сколько форм каждого вида. */
  hills: 20,
  mesas: 10,
  pits: 13,
  ridges: 6,
  /** Край формы — не ближе этого к центру лагеря мобов / башне / Багровому, м. */
  keepOff: 8,
} as const;

type Shape =
  | { kind: "hill"; x: number; z: number; r: number; h: number }
  | { kind: "mesa"; x: number; z: number; r: number; h: number; edge: number }
  | { kind: "pit"; x: number; z: number; r: number; h: number; edge: number }
  | { kind: "ridge"; x: number; z: number; x2: number; z2: number; r: number; h: number };

/** Тот же генератор при каждом запуске (mulberry32). */
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

/** 0 — здесь рельеф не меняем (лагерь, центр, озеро/гора), 1 — меняем полностью. */
export function reliefMask(x: number, z: number): number {
  const hub = clamp01((Math.hypot(x - HUB_CENTER.x, z - HUB_CENTER.z) - (HUB.campRadius + 18)) / 25);
  const center = clamp01((Math.hypot(x, z) - 30) / 20);
  const lake = clamp01((Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz) - 1.5) / 0.6);
  const mount = clamp01((Math.hypot(x - MOUNTAIN.x, z - MOUNTAIN.z) - MOUNTAIN.radius - 5) / 20);
  return hub * center * lake * mount;
}

const SHAPES: Shape[] = (() => {
  const r = rng(RELIEF.seed);
  const half = WORLD.playHalf - 8;
  const keep: { x: number; z: number }[] = [
    ...MOB_CAMPS.map((c) => ({ x: c.x, z: c.z })),
    TOWER_PROP_POS,
    { x: BOSS.home[0], z: BOSS.home[1] },
  ];
  /** Точка под форму радиуса `rad`: вся форма вне запретных зон и не накрывает лагеря/башню/Багрового. */
  const place = (rad: number): { x: number; z: number } | null => {
    for (let i = 0; i < 60; i++) {
      const x = (r() * 2 - 1) * half;
      const z = (r() * 2 - 1) * half;
      if (reliefMask(x, z) < 0.99) continue;
      if (keep.some((k) => Math.hypot(k.x - x, k.z - z) < rad + RELIEF.keepOff)) continue;
      return { x, z };
    }
    return null;
  };
  const out: Shape[] = [];
  for (let i = 0; i < RELIEF.hills; i++) {
    const rad = 14 + r() * 18;
    const p = place(rad);
    if (p) out.push({ kind: "hill", ...p, r: rad, h: 6 + r() * 10 });
  }
  for (let i = 0; i < RELIEF.mesas; i++) {
    const rad = 9 + r() * 10;
    const p = place(rad);
    if (p) out.push({ kind: "mesa", ...p, r: rad, h: 5 + r() * 6, edge: 3.5 + r() * 2.5 });
  }
  for (let i = 0; i < RELIEF.pits; i++) {
    const rad = 7 + r() * 8;
    const p = place(rad);
    if (p) out.push({ kind: "pit", ...p, r: rad, h: 3 + r() * 4, edge: 3 + r() * 2 });
  }
  for (let i = 0; i < RELIEF.ridges; i++) {
    const a = r() * Math.PI;
    const len = 20 + r() * 25;
    const p = place(len * 0.5 + 12);
    if (!p) continue;
    out.push({
      kind: "ridge",
      x: p.x - Math.cos(a) * len * 0.5,
      z: p.z - Math.sin(a) * len * 0.5,
      x2: p.x + Math.cos(a) * len * 0.5,
      z2: p.z + Math.sin(a) * len * 0.5,
      r: 7 + r() * 5,
      h: 5 + r() * 6,
    });
  }
  return out;
})();

/** Габарит формы для быстрого отсева (с запасом). */
const BOUNDS = SHAPES.map((s) => {
  const pad = s.r + 1;
  return s.kind === "ridge"
    ? { x0: Math.min(s.x, s.x2) - pad, x1: Math.max(s.x, s.x2) + pad, z0: Math.min(s.z, s.z2) - pad, z1: Math.max(s.z, s.z2) + pad }
    : { x0: s.x - pad, x1: s.x + pad, z0: s.z - pad, z1: s.z + pad };
});

/** Добавка рельефа (м) в точке — сумма форм, уже с маской запретных зон. */
export function reliefAt(x: number, z: number): number {
  let h = 0;
  for (let i = 0; i < SHAPES.length; i++) {
    const b = BOUNDS[i];
    if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
    const s = SHAPES[i];
    if (s.kind === "ridge") {
      // Расстояние до отрезка гряды, профиль — гладкий купол.
      const vx = s.x2 - s.x;
      const vz = s.z2 - s.z;
      const t = clamp01(((x - s.x) * vx + (z - s.z) * vz) / (vx * vx + vz * vz));
      const d = Math.hypot(x - (s.x + vx * t), z - (s.z + vz * t));
      h += s.h * smooth(1 - d / s.r);
      continue;
    }
    const d = Math.hypot(x - s.x, z - s.z);
    if (s.kind === "hill") h += s.h * smooth(1 - d / s.r);
    // Столовая гора и яма: ровный верх/дно и крутой край шириной edge.
    else if (s.kind === "mesa") h += s.h * smooth(clamp01((s.r - d) / s.edge));
    else h -= s.h * smooth(clamp01((s.r - d) / s.edge));
  }
  return h === 0 ? 0 : h * reliefMask(x, z);
}

function smooth(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
