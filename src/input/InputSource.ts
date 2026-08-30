/**
 * Абстракция ввода. Геймплей ниже этого слоя не знает, какое устройство:
 * клава+мышь, тач-экран или VR-контроллеры (этап 3) дают одинаковый InputState.
 */
export interface InputState {
  /** Направление движения в локальных осях игрока. x — вбок, y — вперёд. -1..1. */
  moveX: number;
  moveY: number;
  /** Поворот за этот кадр, в радианах. yaw — вокруг вертикали, pitch — вверх/вниз. */
  lookYaw: number;
  lookPitch: number;
  /** Основное действие (атака). Удерживается. */
  primaryAction: boolean;
  /** Взаимодействие (подобрать лут и т.п.). Удерживается. */
  interact: boolean;
  /** Прыжок — нажат в этом кадре (фронт). */
  jump: boolean;
  /** Сбросить щит (клавиша Q в плоском режиме) — нажат в этом кадре (фронт). */
  dropItem: boolean;
  /**
   * Не null только в VR при зажатой кнопке настройки меча (X на левом): сырые
   * оси стиков для правки положения меча в руке. Локомоция в это время подавлена.
   */
  tune: TuneInput | null;
  /** Открыть/закрыть панель персонажа (фронт). */
  panelToggle: boolean;
  /** Панель: следующая характеристика (фронт). */
  uiNext: boolean;
  /** Панель: вложить очко в выбранную характеристику (фронт). */
  uiConfirm: boolean;
}

/** Сырые оси стиков в режиме настройки меча (-1..1). */
export interface TuneInput {
  lx: number;
  ly: number;
  rx: number;
  ry: number;
}

export function emptyInput(): InputState {
  return {
    moveX: 0,
    moveY: 0,
    lookYaw: 0,
    lookPitch: 0,
    primaryAction: false,
    interact: false,
    jump: false,
    dropItem: false,
    tune: null,
    panelToggle: false,
    uiNext: false,
    uiConfirm: false,
  };
}

export interface InputSource {
  /**
   * Снять состояние за текущий кадр. Вызывается ровно один раз за кадр.
   * Накопленные дельты (look, jump) после вызова обнуляются.
   */
  sample(): InputState;
  dispose(): void;
}
