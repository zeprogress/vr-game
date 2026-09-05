/**
 * Живая настройка пятна светлячков на земле: цвет, яркость (альфа), радиус,
 * высота над землёй. Панель `?groundglow=1` (см. ui/GroundGlowTuner) двигает
 * значения прямо в игре — по тому же образцу, что и `?gear=1` (botGear.ts).
 *
 * Дефолты здесь — то, что уедет в прод. Панель показывает готовый кусок
 * кода, чтобы подобранное можно было вписать в Fireflies.ts (FIREFLY.groundGlow*).
 */
export interface GroundGlowTune {
  color: [number, number, number];
  /** Пиковая альфа ночью (умножается на долю ночи — см. Fireflies.update). */
  alpha: number;
  radius: number;
  /** Насколько пятно приподнято над землёй, м. */
  height: number;
}

export const GROUND_GLOW_TUNE: GroundGlowTune = {
  color: [1, 1, 0.445],
  alpha: 0.101,
  radius: 6.071,
  height: 0.103,
};

const KEY = "zep.groundglow";

/** Подхватываем подобранное после перезагрузки — иначе настройка теряется. */
export function loadGroundGlowTune(): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const v = JSON.parse(raw) as Partial<GroundGlowTune>;
    if (Array.isArray(v.color) && v.color.length === 3) {
      GROUND_GLOW_TUNE.color = [...v.color] as GroundGlowTune["color"];
    }
    if (Number.isFinite(v.alpha)) GROUND_GLOW_TUNE.alpha = v.alpha as number;
    if (Number.isFinite(v.radius)) GROUND_GLOW_TUNE.radius = v.radius as number;
    if (Number.isFinite(v.height)) GROUND_GLOW_TUNE.height = v.height as number;
  } catch {
    /* приватный режим/битый JSON — просто берём дефолты */
  }
}

export function saveGroundGlowTune(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(GROUND_GLOW_TUNE));
  } catch {
    /* не критично */
  }
}

/** Fireflies подписывается, чтобы перекрасить/пересчитать пятна сразу после правки. */
const listeners = new Set<() => void>();

export function onGroundGlowTuneChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifyGroundGlowTuneChanged(): void {
  for (const fn of listeners) fn();
}
