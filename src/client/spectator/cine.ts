/**
 * Кинематографичные пути камеры и порядок авто-ротации режиссёра
 * (этап 17, Ф4). Правится руками — координаты в метрах мира ZEP GAME
 * (сторона зоны 180, спавн у (0,-20), обелиски с оружием ~ (0,-12),
 * босс в углу (74,74)). Редактор путей прямо в игре — позже (Ф9).
 */

export interface PathKey {
  /** Позиция камеры [x,y,z]. */
  p: [number, number, number];
  /** Точка, на которую камера смотрит [x,y,z]. */
  l: [number, number, number];
}

export interface CinePath {
  name: string;
  /** Секунд на весь пролёт. По истечении режиссёр берёт следующий кадр. */
  duration: number;
  /** Ключи; между ними — гладкий сплайн Катмулла–Рома. Минимум 2. */
  keys: PathKey[];
  /**
   * Подъём точки взгляда к высоте камеры: 0 (по умолчанию) — как в ключах;
   * 1 — почти вровень с камерой (смотрим по горизонту, не в землю на
   * разворотах и наборе высоты). Направление в плане (x,z) остаётся из ключей.
   */
  lookLevel?: number;
}

/** Насколько ниже камеры смотрим при lookLevel=1 (лёгкий наклон вниз). */
const LOOK_DIP = 1.5;

export const CINE_PATHS: CinePath[] = [
  {
    name: "Рассвет над лугом",
    duration: 26,
    lookLevel: 0.55,
    keys: [
      { p: [-72, 3, -46], l: [-20, 2, -10] },
      { p: [-30, 5, -18], l: [10, 2, 6] },
      { p: [4, 9, 4], l: [30, 3, 20] },
      { p: [40, 16, 30], l: [60, 4, 46] },
      { p: [72, 26, 48], l: [40, 3, 30] },
    ],
  },
  {
    name: "К обелискам",
    duration: 22,
    lookLevel: 0.8,
    keys: [
      { p: [26, 4, 14], l: [0, 1, -12] },
      { p: [10, 3, -2], l: [0, 1, -12] },
      { p: [-8, 2.6, -20], l: [0, 1, -12] },
      { p: [-4, 12, -34], l: [0, 1, -12] },
      { p: [6, 28, -44], l: [0, 1, -14] },
    ],
  },
  {
    name: "Тень багрового",
    duration: 24,
    lookLevel: 0.25,
    keys: [
      { p: [8, 44, 8], l: [40, 6, 40] },
      { p: [34, 24, 34], l: [60, 5, 60] },
      { p: [56, 12, 56], l: [74, 4, 74] },
      { p: [66, 6.5, 66], l: [74, 5, 74] },
      { p: [80, 10, 82], l: [74, 6, 74] },
    ],
  },
];

/**
 * Порядок кадров в спокойной ротации (вне боя с боссом). Токены:
 *   overview · orbitPlayer · eyePlayer · orbitBoss · eyeMob · path:<n>
 * Невалидные в моменте (нет игроков / нет босса) режиссёр пропускает.
 */
export const ROTATION: string[] = [
  "overview",
  "path:0",
  "orbitPlayer",
  "eyePlayer",
  "path:1",
  "orbitBoss",
  "eyeMob",
  "path:2",
  "orbitPlayer",
  "eyeMob",
];

/** Позиция и точка взгляда на пути в момент t (0..1). */
export function samplePath(path: CinePath, t: number, outP: number[], outL: number[]): void {
  const k = path.keys;
  const n = k.length;
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const f = clamped * (n - 1);
  const i = Math.min(n - 2, Math.max(0, Math.floor(f)));
  const lt = f - i;
  const k0 = k[Math.max(0, i - 1)];
  const k1 = k[i];
  const k2 = k[i + 1];
  const k3 = k[Math.min(n - 1, i + 2)];
  for (let c = 0; c < 3; c++) {
    outP[c] = catmull(k0.p[c], k1.p[c], k2.p[c], k3.p[c], lt);
    outL[c] = catmull(k0.l[c], k1.l[c], k2.l[c], k3.l[c], lt);
  }
  // Подтягиваем взгляд к высоте камеры — чтобы на разворотах и наборе высоты
  // камера не утыкалась в землю. План (x,z) точки взгляда не трогаем.
  if (path.lookLevel) {
    const w = path.lookLevel < 0 ? 0 : path.lookLevel > 1 ? 1 : path.lookLevel;
    outL[1] += (outP[1] - LOOK_DIP - outL[1]) * w;
  }
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}
