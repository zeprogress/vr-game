/**
 * Катакомбы: числа, которые подбираются на глаз. Яркость стен, сила нормалей (рельеф камня),
 * плотность пятен-теней под героями и мобами. CAT_TUNE_DEFAULT — то, что уезжает в прод.
 * Панель `?cattune=1` (ui/CatTuner) двигает значения в игре; подобранное лежит в localStorage
 * и читается только при открытой панели — обычные игроки берут дефолт из исходника.
 */
export const CAT_TUNE_DEFAULT = { wall: 0.36, bump: 2, shadow: 0.42 } as const;

export const catTune: { wall: number; bump: number; shadow: number } = { ...CAT_TUNE_DEFAULT };

const KEY = "zep.cattune";

/** Подхватываем подобранное — только когда открыта панель. */
export function loadCatTune(): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const v = JSON.parse(raw) as Partial<Record<keyof typeof catTune, number>>;
    if (typeof v.wall === "number") catTune.wall = v.wall;
    if (typeof v.bump === "number") catTune.bump = v.bump;
    if (typeof v.shadow === "number") catTune.shadow = v.shadow;
  } catch {
    /* приватный режим/битый JSON — остаются дефолты */
  }
}

export function saveCatTune(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(catTune));
  } catch {
    /* не критично — панель всё равно двигает значения в памяти */
  }
}

/** Катакомбы перекрашивают и подстраивают свои материалы, когда тронули настройку. */
const listeners = new Set<() => void>();

export function onCatTuneChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifyCatTuneChanged(): void {
  for (const fn of listeners) fn();
}
