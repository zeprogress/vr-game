/**
 * Живая настройка камеры «от третьего лица» (смартфон). Панель `?tpcam=1`
 * (см. ui/TpCamTuner). Читается каждый кадр — подписка не нужна.
 *
 * Дефолты здесь — то, что уедет в прод. Копия для вставки — в панели.
 */
export interface TpCamTune {
  /** Длина «удочки» камеры за персонажем, м. */
  dist: number;
  /** Высота точки прицела над ногами (голова/грудь), м. */
  pivotUp: number;
  /** Стартовый и предельные наклоны камеры, рад. */
  pitchStart: number;
  pitchMin: number;
  pitchMax: number;
  /** Минимальный зазор камеры над землёй, м. */
  floorClear: number;
  /** Скорость доворота персонажа в сторону хода, 1/с. */
  turnRate: number;
  /** Скорость возврата камеры за спину, когда игрок её не крутит, 1/с. */
  followRate: number;
  /** Множитель к перетаскиванию пальцем по экрану (обзор). */
  lookSens: number;
}

export const TP_CAM_TUNE: TpCamTune = {
  dist: 4.6,
  pivotUp: 1.5,
  pitchStart: 0.22,
  pitchMin: -0.15,
  pitchMax: 1.15,
  floorClear: 0.5,
  turnRate: 12,
  followRate: 1.1,
  lookSens: 1,
};

const KEY = "zep.tpcam";

export function loadTpCamTune(): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const v = JSON.parse(raw) as Partial<TpCamTune>;
    for (const k of Object.keys(TP_CAM_TUNE) as (keyof TpCamTune)[]) {
      if (Number.isFinite(v[k])) TP_CAM_TUNE[k] = v[k] as number;
    }
  } catch {
    /* приватный режим / битый JSON — берём дефолты */
  }
}

export function saveTpCamTune(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(TP_CAM_TUNE));
  } catch {
    /* не критично */
  }
}
