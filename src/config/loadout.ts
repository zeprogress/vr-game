/**
 * Настройки экипировки: как предметы лежат в руках и как повёрнуты сами кисти.
 *
 * ЭТОТ ФАЙЛ — единственный источник правды для положения предметов.
 * Правь числа и сохраняй: значения применяются в игре сразу, без перезагрузки
 * и без сброса прогресса, позиции и того, что уже в руках (Vite HMR + мутация
 * живого объекта на месте).
 *
 * Углы в радианах. Удобные ориентиры: 90° = Math.PI / 2, 180° = Math.PI.
 *
 * Системы координат:
 *   Меч   — клинок вдоль локальной +Y, рукоять в начале координат.
 *   Лук   — плечи вдоль +Y, стрела летит в -Z.
 *   Щит   — диск в плоскости XZ, «наружу» смотрит +Y (этой стороной блокируем).
 *   Кисть — пальцы вдоль -Z, ладонь смотрит вниз по -Y.
 */

export interface Placement {
  /** Смещение относительно узла руки (в VR) или камеры (в плоском режиме), м. */
  pos: [number, number, number];
  /** Поворот, радианы (X, Y, Z). */
  rot: [number, number, number];
  scale: number;
}

export interface ItemPlacement {
  /** Плоский режим: предмет висит у камеры. */
  flat: Placement;
  vrLeft: Placement;
  vrRight: Placement;
}

export interface Loadout {
  /** Поворот кисти относительно grip-узла контроллера. */
  hands: {
    left: [number, number, number];
    right: [number, number, number];
  };
  items: {
    sword: ItemPlacement;
    bow: ItemPlacement;
    shield: ItemPlacement;
  };
  /**
   * Индексы кнопок геймпада (xr-standard).
   * Quest: 0 — курок, 1 — grip, 3 — нажатие стика, 4 — A/X, 5 — B/Y.
   * Если панель не открывается — посмотри `game.vrButtons()` в консоли и
   * поставь сюда индекс кнопки, которая при нажатии показывает `true`.
   */
  buttons: {
    /** Левый контроллер: открыть/закрыть панель персонажа. */
    panelToggle: number;
    /** Левый контроллер: следующая характеристика в панели. */
    panelNext: number;
    /** Правый контроллер: вложить очко. */
    panelSpend: number;
    /** Правый контроллер: прыжок. */
    jump: number;
  };
}

export const LOADOUT_DEFAULTS: Loadout = {
  hands: {
    left: [Math.PI / 2, Math.PI / 2, Math.PI / 2],
    right: [Math.PI / 2, Math.PI / 2, Math.PI / 2],
  },
  items: {
    sword: {
      flat: { pos: [0.42, -0.38, 0.85], rot: [-0.2, 0.25, -0.28], scale: 0.55 },
      vrLeft: { pos: [0, 0, 0], rot: [1, 0, 0], scale: 1 },
      vrRight: { pos: [0, 0, 0], rot: [1, 0, 0], scale: 1 },
    },
    bow: {
      flat: { pos: [-0.24, -0.26, 0.55], rot: [0, Math.PI, 0], scale: 0.8 },
      vrLeft: { pos: [0, 0, 0], rot: [0, 0, 0], scale: 1 },
      vrRight: { pos: [0, 0, 0], rot: [0, 0, 0], scale: 1 },
    },
    shield: {
      flat: { pos: [-0.34, -0.26, 0.62], rot: [Math.PI / 2, 0, 0], scale: 0.8 },
      // Щит пристёгнут к предплечью: диск смотрит вперёд от кисти.
      vrLeft: { pos: [0, -0.04, -0.1], rot: [Math.PI / 2, 0, Math.PI / 2], scale: 1 },
      vrRight: { pos: [0, -0.04, -0.1], rot: [Math.PI / 2, 0, -Math.PI / 2], scale: 1 },
    },
  },
  buttons: {
    panelToggle: 5, // Y на левом
    panelNext: 4, // X на левом
    panelSpend: 5, // B на правом
    jump: 4, // A на правом
  },
};

/**
 * Живой объект настроек. Systems держат ссылку на него и читают значения
 * каждый кадр, поэтому правки применяются мгновенно.
 */
const KEY = "__vrGameLoadout";
type Holder = { [KEY]?: Loadout };
const holder = globalThis as unknown as Holder;

export const LOADOUT: Loadout =
  holder[KEY] ?? (holder[KEY] = structuredClone(LOADOUT_DEFAULTS));

/** Копирует значения новой версии файла в живой объект, не меняя его identity. */
function applyInto(target: Loadout, next: Loadout): void {
  target.hands.left = [...next.hands.left];
  target.hands.right = [...next.hands.right];
  for (const kind of ["sword", "bow", "shield"] as const) {
    for (const slot of ["flat", "vrLeft", "vrRight"] as const) {
      const src = next.items[kind][slot];
      const dst = target.items[kind][slot];
      dst.pos = [...src.pos];
      dst.rot = [...src.rot];
      dst.scale = src.scale;
    }
  }
  Object.assign(target.buttons, next.buttons);
}

// Горячая замена: при сохранении файла новые числа втекают в живой объект,
// игра не перезагружается и ничего не теряет. Берём именно DEFAULTS новой
// версии модуля — сам LOADOUT кэширован в globalThis и остаётся тем же.
if (import.meta.hot) {
  import.meta.hot.accept((mod) => {
    const next = (mod as { LOADOUT_DEFAULTS?: Loadout } | undefined)?.LOADOUT_DEFAULTS;
    if (next) {
      applyInto(LOADOUT, next);
      console.log("[loadout] настройки применены без перезагрузки");
    }
  });
}
