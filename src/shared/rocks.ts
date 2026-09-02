import { WORLD, BOSS } from "./constants";

/** Камень в мире: где, какой модели, как повёрнут и насколько крупный. */
export interface Rock {
  x: number;
  z: number;
  /** Индекс модели 0..2 (Rock_Medium_1..3). */
  kind: number;
  scale: number;
  yaw: number;
  /** Наклон вокруг X и Z (камень лежит не строго ровно). */
  tilt: [number, number];
  /** Радиус для расталкивания; `solid` — большой ли (мелкие проходимы). */
  r: number;
  solid: boolean;
}

const SEED = 40260902;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let cached: Rock[] | null = null;

/** Камни, разбросанные по карте (постоянное зерно — пейзаж одинаков у всех). */
export function rocks(): Rock[] {
  if (cached) return cached;
  const r = rng(SEED);
  const reach = WORLD.size / 2 - 4;
  const out: Rock[] = [];
  for (let i = 0; i < 28; i++) {
    const x = (r() - 0.5) * 2 * reach;
    const z = (r() - 0.5) * 2 * reach;
    if (Math.hypot(x, z) < 10) continue; // не на спавне
    if (Math.abs(x) < 5 && Math.abs(z + 12) < 5) continue; // не поверх оружия
    if (Math.hypot(x - BOSS.home[0], z - BOSS.home[1]) < 22) continue; // арена босса — чисто
    const scale = 0.22 + r() ** 2 * 0.75; // много мелких, редко валун
    const solid = scale > 0.42;
    out.push({
      x,
      z,
      kind: Math.floor(r() * 3),
      scale,
      yaw: r() * Math.PI * 2,
      tilt: [(r() - 0.5) * 0.5, (r() - 0.5) * 0.5],
      // модель ~3 ед. в поперечнике; запас, чтобы не влезать в бок
      r: solid ? scale * 1.15 + 0.2 : 0,
      solid,
    });
  }
  cached = out;
  return out;
}
