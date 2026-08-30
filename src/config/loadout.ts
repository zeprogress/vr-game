/**
 * Настройки экипировки: как предметы лежат в руках и как повёрнуты сами кисти.
 *
 * Два способа править, и оба работают на лету:
 *   1. Прямо в игре — панель на правой руке (кнопка B). Изменения сохраняются
 *      в localStorage и переживают перезагрузку.
 *   2. Числа в этом файле — базовые значения. Сохраняешь файл, и они
 *      применяются без перезагрузки (Vite HMR), не сбрасывая прогресс.
 *
 * Что важно: значения, подобранные в панели, ПЕРЕКРЫВАЮТ числа из файла —
 * иначе правка файла молча стирала бы подобранное в шлеме. Сбросить
 * переопределение можно в самой панели (строка «сброс к файлу»).
 *
 * Углы в радианах. Ориентиры: 90° = Math.PI / 2, 180° = Math.PI.
 *
 * Системы координат:
 *   Меч   — клинок вдоль локальной +Y, рукоять в начале координат.
 *   Лук   — плечи вдоль +Y, стрела летит в -Z.
 *   Щит   — диск в плоскости XZ, «наружу» смотрит +Y (этой стороной блокируем).
 *   pos   — [вправо, вверх, вперёд] относительно кисти (VR) или камеры (плоский).
 */

export type HandSide = "left" | "right";
export type ItemKind = "sword" | "bow" | "shield";
export type SlotKey = "flat" | "vrLeft" | "vrRight";

export interface Placement {
  /** Смещение относительно узла руки (в VR) или камеры (в плоском режиме), м. */
  pos: [number, number, number];
  /** Поворот, радианы (X, Y, Z). */
  rot: [number, number, number];
  scale: number;
}

export type ItemPlacement = Record<SlotKey, Placement>;

export interface Loadout {
  /** Поворот кисти относительно grip-узла контроллера. */
  hands: Record<HandSide, [number, number, number]>;
  items: Record<ItemKind, ItemPlacement>;
  /**
   * Индексы кнопок геймпада (xr-standard).
   * Quest: 0 — курок, 1 — grip, 3 — нажатие стика, 4 — A/X, 5 — B/Y.
   * Не открывается панель — посмотри `game.vrButtons()` и поставь сюда индекс
   * кнопки, которая при нажатии показывает НАЖАТА.
   */
  buttons: {
    /** Левый: панель персонажа. Она же «увеличить», когда открыта панель настроек. */
    panelToggle: number;
    /** Левый: следующая характеристика. Он же «уменьшить» в панели настроек. */
    panelNext: number;
    /** Правый: вложить очко. Он же открывает панель настроек экипировки. */
    panelSpend: number;
    /** Правый: прыжок. Он же «сменить шаг», когда открыта панель настроек. */
    jump: number;
  };
}

export const LOADOUT_DEFAULTS: Loadout = {
  hands: {
    left: [1, 1, 3],
    right: [1, 1, 3],
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
 * Живой объект настроек. Системы держат ссылку на него и читают значения
 * каждый кадр, поэтому правки применяются мгновенно.
 */
const KEY = "__vrGameLoadout";
type Holder = { [KEY]?: Loadout };
const holder = globalThis as unknown as Holder;

export const LOADOUT: Loadout =
  holder[KEY] ?? (holder[KEY] = structuredClone(LOADOUT_DEFAULTS));

// ---- цели настройки ----

/** Ключ настраиваемой сущности: кисть или предмет в конкретном слоте. */
export type TargetKey = `hand:${HandSide}` | `item:${ItemKind}:${SlotKey}`;

export function handTarget(side: HandSide): TargetKey {
  return `hand:${side}`;
}
export function itemTarget(kind: ItemKind, slot: SlotKey): TargetKey {
  return `item:${kind}:${slot}`;
}

function readTarget(src: Loadout, key: TargetKey): unknown {
  const parts = key.split(":");
  if (parts[0] === "hand") return src.hands[parts[1] as HandSide];
  return src.items[parts[1] as ItemKind][parts[2] as SlotKey];
}

function writeTarget(dst: Loadout, key: TargetKey, value: unknown): void {
  const parts = key.split(":");
  if (parts[0] === "hand") {
    const a = value as number[];
    if (Array.isArray(a) && a.length === 3) dst.hands[parts[1] as HandSide] = [a[0], a[1], a[2]];
    return;
  }
  const p = value as Partial<Placement>;
  const slot = dst.items[parts[1] as ItemKind][parts[2] as SlotKey];
  if (Array.isArray(p.pos) && p.pos.length === 3) slot.pos = [p.pos[0], p.pos[1], p.pos[2]];
  if (Array.isArray(p.rot) && p.rot.length === 3) slot.rot = [p.rot[0], p.rot[1], p.rot[2]];
  if (typeof p.scale === "number") slot.scale = p.scale;
}

// ---- сохранение того, что подобрано в игре ----

const SAVE_KEY = "loadoutOverrides";
type Overrides = Partial<Record<TargetKey, unknown>>;

function loadOverrides(): Overrides {
  try {
    return (JSON.parse(localStorage.getItem(SAVE_KEY) ?? "{}") as Overrides) ?? {};
  } catch {
    return {};
  }
}

function storeOverrides(o: Overrides): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(o));
  } catch {
    /* приватный режим */
  }
}

/** Запомнить текущее значение цели, чтобы оно пережило перезагрузку. */
export function saveTarget(key: TargetKey): void {
  const o = loadOverrides();
  o[key] = structuredClone(readTarget(LOADOUT, key));
  storeOverrides(o);
}

/** Вернуть цель к числам из файла и забыть переопределение. */
export function resetTarget(key: TargetKey): void {
  const o = loadOverrides();
  delete o[key];
  storeOverrides(o);
  writeTarget(LOADOUT, key, readTarget(LOADOUT_DEFAULTS, key));
}

export function isOverridden(key: TargetKey): boolean {
  return loadOverrides()[key] !== undefined;
}

/** Печатает текущие значения в виде, готовом для вставки в этот файл. */
export function printLoadout(): void {
  const f = (n: number) => Number(n.toFixed(4));
  const fa = (a: number[]) => `[${a.map(f).join(", ")}]`;
  const lines: string[] = ["hands: {"];
  for (const s of ["left", "right"] as HandSide[]) lines.push(`  ${s}: ${fa(LOADOUT.hands[s])},`);
  lines.push("},", "items: {");
  for (const k of ["sword", "bow", "shield"] as ItemKind[]) {
    lines.push(`  ${k}: {`);
    for (const slot of ["flat", "vrLeft", "vrRight"] as SlotKey[]) {
      const p = LOADOUT.items[k][slot];
      lines.push(`    ${slot}: { pos: ${fa(p.pos)}, rot: ${fa(p.rot)}, scale: ${f(p.scale)} },`);
    }
    lines.push("  },");
  }
  lines.push("},");
  console.log(lines.join("\n"));
}

// ---- применение: сначала файл, поверх — подобранное в игре ----

function applyDefaults(next: Loadout): void {
  LOADOUT.hands.left = [...next.hands.left];
  LOADOUT.hands.right = [...next.hands.right];
  for (const kind of ["sword", "bow", "shield"] as ItemKind[]) {
    for (const slot of ["flat", "vrLeft", "vrRight"] as SlotKey[]) {
      const src = next.items[kind][slot];
      const dst = LOADOUT.items[kind][slot];
      dst.pos = [...src.pos];
      dst.rot = [...src.rot];
      dst.scale = src.scale;
    }
  }
  Object.assign(LOADOUT.buttons, next.buttons);
}

function applyOverrides(): number {
  const o = loadOverrides();
  const keys = Object.keys(o) as TargetKey[];
  for (const k of keys) writeTarget(LOADOUT, k, o[k]);
  return keys.length;
}

applyOverrides();

// Горячая замена: при сохранении файла новые числа втекают в живой объект,
// игра не перезагружается. Подобранное в панели накладывается сверху —
// иначе правка файла молча стёрла бы настройку из шлема.
if (import.meta.hot) {
  import.meta.hot.accept((mod) => {
    const next = (mod as { LOADOUT_DEFAULTS?: Loadout } | undefined)?.LOADOUT_DEFAULTS;
    if (!next) return;
    applyDefaults(next);
    const n = applyOverrides();
    console.log(
      n === 0
        ? "[loadout] файл применён без перезагрузки"
        : `[loadout] файл применён; ${n} настроек из панели оставлены поверх (сбросить — в панели)`,
    );
  });
}
