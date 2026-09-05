/**
 * Живая настройка ночного тумана: цвет, в который EXP2-туман уводит даль,
 * и множитель плотности. Панель `?fog=1` (см. ui/FogTuner).
 *
 * Читается заново каждый кадр (DayTime.mix3 для цвета, Sky.apply для
 * плотности) — подписка не нужна, достаточно менять объект.
 *
 * Дефолты здесь — то, что уедет в прод. Копия для вставки — в панели.
 */
export interface FogTune {
  /** Цвет тумана в глубокую ночь. Днём/в сумерках мешается с DAY/DUSK палитрой. */
  nightColor: [number, number, number];
  /** Множитель к BASE_FOG_DENSITY (поверх LOADOUT.light.fog). */
  density: number;
}

export const FOG_TUNE: FogTune = {
  nightColor: [0.015, 0.018, 0.03],
  density: 1,
};

const KEY = "zep.fog";

export function loadFogTune(): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const v = JSON.parse(raw) as Partial<FogTune>;
    if (Array.isArray(v.nightColor) && v.nightColor.length === 3) {
      FOG_TUNE.nightColor = [...v.nightColor] as FogTune["nightColor"];
    }
    if (Number.isFinite(v.density)) FOG_TUNE.density = v.density as number;
  } catch {
    /* приватный режим/битый JSON — берём дефолты */
  }
}

export function saveFogTune(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(FOG_TUNE));
  } catch {
    /* не критично */
  }
}
