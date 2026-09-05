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
  /**
   * Наклон, рад. >0 — камера ниже, смотрит вверх; <0 — выше, смотрит вниз.
   * Палец вверх по экрану опускает камеру (взгляд вверх), вниз — поднимает.
   */
  pitchStart: number;
  pitchMin: number;
  pitchMax: number;
  /** Минимальный зазор камеры над землёй, м. */
  floorClear: number;
  /** Пределы зума (dist) щипком, м. */
  distMin: number;
  distMax: number;
  /** Скорость доворота персонажа в сторону хода, 1/с. */
  turnRate: number;
  /** Скорость, с которой камера всё время потихоньку заезжает за спину, 1/с. */
  followRate: number;
  /** Множитель к перетаскиванию пальцем по экрану (обзор). */
  lookSens: number;
}

export const TP_CAM_TUNE: TpCamTune = {
  dist: 5,
  pivotUp: 1.5,
  pitchStart: -0.12, // почти горизонтально, камера чуть выше — смотрит слегка вниз
  pitchMin: -1, // до крутого вида сверху
  pitchMax: 0.6, // до взгляда снизу вверх
  floorClear: 0.1,
  distMin: 2.5,
  distMax: 11,
  turnRate: 12,
  followRate: 0.55, // «потихоньку» — не дерётся с обзором; на боковом стике даёт пологую дугу
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
