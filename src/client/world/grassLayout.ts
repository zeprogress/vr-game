import { WORLD } from "#shared/constants";

/**
 * Раскладка травы — чистая математика, без сцены и загрузки моделей.
 *
 * Вынесена из nature.ts, чтобы одни и те же позиции (и клякс, и травинок)
 * видели ДВА потребителя: nature.ts (расставляет реальные пучки) и
 * Terrain.ts (запекает под ними лёгкое затенение в вершины земли — как у
 * деревьев и камней). Раз функция чистая и детерминированная (одно и то же
 * зерно), звать её можно из обоих мест независимо и в любом порядке — не
 * нужно ждать, пока трава асинхронно загрузится, чтобы запечь землю.
 */

/** Плотность травы относительно WORLD.grassCount — то же число, что в nature.ts. */
const GRASS_FACTOR = 1.8;
/** То же зерно, что у травы в nature.ts — раскладка обязана совпадать. */
const GRASS_SEED = 20260904;

/** Тот же генератор, что у деревьев/камней/травы (mulberry32-style). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Одна травинка: всё, что не зависит от высоты земли (её добавляет nature.ts). */
export interface GrassBlade {
  x: number;
  z: number;
  /** Масштаб по X/Z. */
  s: number;
  /** Множитель высоты поверх `s` (травинки разной стройности). */
  heightMul: number;
  yaw: number;
  /** Базовая яркость пучка. */
  b: number;
  /** От жёлто-сухого до сочно-зелёного. */
  warm: number;
}

/** Одна кляксa-скопление — центр и радиус, для AO под травой (см. Terrain.ts). */
export interface GrassBlob {
  x: number;
  z: number;
  size: number;
}

export interface GrassLayout {
  blades: GrassBlade[];
  blobs: GrassBlob[];
}

let cached: GrassLayout | null = null;
let cachedDensity = -1;

/**
 * Раскладка травы для данной плотности (0..1, как в ZoneQuality.grass).
 * Кэшируется — в сессии зовётся минимум дважды (nature.ts и Terrain.ts).
 */
export function computeGrassLayout(density: number): GrassLayout {
  if (cached && cachedDensity === density) return cached;

  const rnd = rng(GRASS_SEED);
  const reach = WORLD.size / 2 - 4;
  const budget = Math.max(0, Math.round(WORLD.grassCount * density * GRASS_FACTOR));
  const blades: GrassBlade[] = [];
  const blobs: GrassBlob[] = [];

  const gauss2 = (): number => rnd() + rnd() + rnd() - 1.5; // ~[-1.5..1.5]

  const tryPush = (x: number, z: number): void => {
    if (Math.hypot(x, z) < 1.5) return;
    if (Math.abs(x) > reach || Math.abs(z) > reach) return;
    const s = 0.4 + rnd() * 0.36;
    const heightMul = 0.9 + rnd() * 0.7;
    const yaw = rnd() * Math.PI * 2;
    const b = 0.6 + rnd() * 0.9; // 0.6..1.5 — заметный разброс яркости
    const warm = (rnd() - 0.45) * 0.5;
    blades.push({ x, z, s, heightMul, yaw, b, warm });
  };

  /** Набросать `total` травинок кляксами в круге радиуса `area` вокруг (cx,cz). */
  const scatterClumps = (
    cx: number,
    cz: number,
    area: number,
    total: number,
    centrePull: number,
  ): void => {
    let placed = 0;
    let guard = 0;
    while (placed < total && guard++ < total * 3) {
      const ca = rnd() * Math.PI * 2;
      const cr = Math.pow(rnd(), 0.5 + centrePull) * area;
      const kx = cx + Math.cos(ca) * cr;
      const kz = cz + Math.sin(ca) * cr;
      const size = 0.5 + rnd() * rnd() * 3.2; // радиус кляксы, м
      const n = 5 + Math.floor(rnd() * rnd() * 26);
      blobs.push({ x: kx, z: kz, size });
      for (let i = 0; i < n && placed < total; i++) {
        tryPush(kx + gauss2() * size, kz + gauss2() * size);
        placed++;
      }
    }
  };

  // Гуще вокруг спавна, реже — по всей карте, плюс совсем редкий ровный фон
  // (без кляксы — фон не даёт AO, только сами клячи-скопления).
  scatterClumps(0, 0, WORLD.grassRadius * 1.7, budget * 0.42, 0.9);
  scatterClumps(0, 0, reach, budget * 0.46, 0.15);
  for (let i = 0; i < budget * 0.12; i++) {
    tryPush((rnd() - 0.5) * 2 * reach, (rnd() - 0.5) * 2 * reach);
  }

  cached = { blades, blobs };
  cachedDensity = density;
  return cached;
}
