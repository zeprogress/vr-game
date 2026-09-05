/**
 * Живая настройка ночного тумана (LINEAR-режим): цвет + две дистанции —
 * до `near` метров ясно, с `far` метров полная стена. Панель `?fog=1`
 * (см. ui/FogTuner).
 *
 * Читается заново каждый кадр (DayTime.dayState → Sky.apply) — подписка не
 * нужна, панель просто меняет объект.
 *
 * Дефолты здесь — то, что уедет в прод. Копия для вставки — в панели.
 */
export interface FogTune {
  /** Цвет тумана в глубокую ночь. Днём/в сумерках мешается с DAY/DUSK палитрой. */
  nightColor: [number, number, number];
  /** Ясно до этой дистанции, м. */
  near: number;
  /** Полностью затянуто с этой дистанции, м. */
  far: number;
}

export const FOG_TUNE: FogTune = {
  nightColor: [0, 0, 0],
  near: 12,
  far: 55,
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
    if (Number.isFinite(v.near)) FOG_TUNE.near = v.near as number;
    if (Number.isFinite(v.far)) FOG_TUNE.far = v.far as number;
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
