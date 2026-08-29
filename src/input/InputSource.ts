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
