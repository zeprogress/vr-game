import { WORLD } from "./constants";

/** Дерево в мире: где стоит, какого размера и как повёрнуто. */
export interface Tree {
  x: number;
  z: number;
  scale: number;
  yaw: number;
  /** Радиус ствола у земли — по нему расталкиваются игрок и мобы. */
  r: number;
}

/**
 * Расстановка деревьев.
 *
 * Считается по постоянному зерну, а не через Math.random: и сервер, и все
 * клиенты должны получить ОДИН И ТОТ ЖЕ лес. Иначе мобы обходят деревья,
 * которых у игрока нет, а два игрока видят рощу в разных местах.
 */
const SEED = 20260831;

/** Простой генератор псевдослучайных чисел: одинаковый на всех машинах. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let cached: Tree[] | null = null;

export function trees(): Tree[] {
  if (cached) return cached;
  const rnd = rng(SEED);
  const reach = WORLD.size / 2 - 6;
  const out: Tree[] = [];
  for (let i = 0; i < WORLD.treeCount; i++) {
    const x = (rnd() - 0.5) * 2 * reach;
    const z = (rnd() - 0.5) * 2 * reach;
    const scale = 0.8 + rnd() * 0.9;
    const yaw = rnd() * Math.PI * 2;
    if (Math.sqrt(x * x + z * z) < 9) continue; // не на спавне
    out.push({ x, z, scale, yaw, r: 0.22 * scale });
  }
  cached = out;
  return out;
}
