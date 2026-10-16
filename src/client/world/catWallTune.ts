/**
 * Затемнение стен катакомб. Множитель к цвету стен темы (paintThemes в Catacombs.ts):
 * 1 — как было до 2026-10-17. Дефолт — то, что уедет в прод. Панель `?catwall=1`
 * (ui/CatWallTuner) двигает значение в игре; подобранное лежит в localStorage и
 * читается только при открытой панели — обычные игроки берут дефолт из исходника.
 */
export const CAT_WALL_DEFAULT_MUL = 0.6;

export const catWallTune = { mul: CAT_WALL_DEFAULT_MUL };

const KEY = "zep.catwall";

/** Подхватываем подобранное — только когда открыта панель. */
export function loadCatWallTune(): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const v = JSON.parse(raw) as { mul?: number };
    if (typeof v.mul === "number") catWallTune.mul = v.mul;
  } catch {
    /* приватный режим/битый JSON — остаётся дефолт */
  }
}

export function saveCatWallTune(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ mul: catWallTune.mul }));
  } catch {
    /* не критично — панель всё равно двигает значение в памяти */
  }
}

/** Катакомбы перекрашивают стены залов, когда тронули множитель. */
const listeners = new Set<() => void>();

export function onCatWallTuneChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifyCatWallTuneChanged(): void {
  for (const fn of listeners) fn();
}
