/**
 * Настройка свечения оружия по точкам атаки. Сила и радиус растут с прибавкой
 * (sharpGlowMul в shared/items.ts): по умолчанию сила пропорционально, радиус — корень
 * из прибавки; на +10 точках — как было. Панель `?sharpglow=1` двигает значения на лету
 * и подменяет прибавку для проверки (testPct), в прод уходят числа из исходника.
 */
export const SHARP_GLOW_DEFAULT = { strength: 1, radius: 1 } as const; // радиус линейно от прибавки: +5 мельче, +20 шире

export const sharpGlowTune: { strength: number; radius: number; testPct: number | null } = {
  strength: SHARP_GLOW_DEFAULT.strength,
  radius: SHARP_GLOW_DEFAULT.radius,
  testPct: null,
};

const KEY = "zep.sharpglow";
let version = 0;

/** Номер настройки: сменился — оружие в руках пересчитывает свечение в ближайший кадр. */
export function sharpGlowVersion(): number {
  return version;
}

export function bumpSharpGlow(): void {
  version++;
}

/** Подобранное из панели (localStorage) — грузится только при открытой панели. */
export function loadSharpGlowTune(): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const v = JSON.parse(raw) as { strength?: number; radius?: number };
    if (typeof v.strength === "number") sharpGlowTune.strength = v.strength;
    if (typeof v.radius === "number") sharpGlowTune.radius = v.radius;
  } catch {
    // Хранилища нет (приватное окно, заблокированы данные сайта) — остаются значения по умолчанию.
  }
}

export function saveSharpGlowTune(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ strength: sharpGlowTune.strength, radius: sharpGlowTune.radius }));
  } catch {
    // Не сохранилось — панель всё равно двигает значения в памяти.
  }
}
