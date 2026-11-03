/**
 * Живая настройка тумана (LINEAR-режим): цвет ночного + по паре дистанций
 * на день и на ночь — до `near` м ясно, с `far` м полная стена. Сумерки
 * между ними интерполируются. Панель `?fog=1` (см. ui/FogTuner).
 *
 * Читается заново каждый кадр (DayTime.dayState → Sky.apply) — подписка не
 * нужна, панель просто меняет объект.
 *
 * Дефолты здесь — то, что уедет в прод. Копия для вставки — в панели.
 */
export interface FogTune {
  /** Цвет тумана в глубокую ночь. Днём/в сумерках мешается с DAY/DUSK палитрой. */
  nightColor: [number, number, number];
  /** Ночь: ясно до / полностью затянуто с, м. */
  near: number;
  far: number;
  /** День: ясно до / полностью затянуто с, м. */
  dayNear: number;
  dayFar: number;
}

export const FOG_TUNE: FogTune = {
  nightColor: [0, 0, 0],
  near: 150,
  far: 400,
  dayNear: 60,
  dayFar: 520,
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
    if (Number.isFinite(v.dayNear)) FOG_TUNE.dayNear = v.dayNear as number;
    if (Number.isFinite(v.dayFar)) FOG_TUNE.dayFar = v.dayFar as number;
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
