import { WORLD, BOSS } from "./constants";

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

/**
 * Деревья не рассыпаны ровно, а собраны в рощи: несколько центров-кластеров
 * (разной плотности) плюс редкие одиночки. `WORLD.treeCount` — примерное
 * итоговое число.
 */
export function trees(): Tree[] {
  if (cached) return cached;
  const rnd = rng(SEED);
  const reach = WORLD.size / 2 - 6;
  const out: Tree[] = [];

  const add = (x: number, z: number): void => {
    if (Math.hypot(x, z) < 10) return; // не на спавне
    if (Math.abs(x) > reach || Math.abs(z) > reach) return;
    if (Math.abs(x + 0) < 5 && Math.abs(z + 12) < 5) return; // не поверх оружия
    if (Math.hypot(x - BOSS.home[0], z - BOSS.home[1]) < 22) return; // арена босса — чисто
    const scale = 0.75 + rnd() * 1.0;
    out.push({ x, z, scale, yaw: rnd() * Math.PI * 2, r: 0.19 * scale });
  };

  const clusters = 8;
  const perCluster = Math.round((WORLD.treeCount * 0.72) / clusters);
  for (let c = 0; c < clusters; c++) {
    const cx = (rnd() - 0.5) * 2 * reach;
    const cz = (rnd() - 0.5) * 2 * reach;
    // Рощи рыхлее: даже «плотная» — это редколесье, а не частокол.
    const spread = 14 + rnd() * rnd() * 45;
    const n = Math.max(2, Math.round(perCluster * (0.5 + rnd())));
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const rad = Math.sqrt(rnd()) * spread;
      add(cx + Math.cos(a) * rad, cz + Math.sin(a) * rad);
    }
  }
  // одиночки по всей карте
  const loners = Math.round(WORLD.treeCount * 0.28);
  for (let i = 0; i < loners; i++) {
    add((rnd() - 0.5) * 2 * reach, (rnd() - 0.5) * 2 * reach);
  }

  cached = out;
  return out;
}
