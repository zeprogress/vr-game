/**
 * Настройки экипировки: как предметы лежат в руках и как повёрнуты сами кисти.
 *
 * Два способа править, и оба работают на лету:
 *   1. Числа в этом файле — надёжный источник. Сохраняешь файл — значения
 *      применяются без перезагрузки (Vite HMR), прогресс не сбрасывается.
 *   2. Панель на правой руке в VR (кнопка B) — для подгонки прямо в шлеме.
 *      Пишет в localStorage браузера.
 *
 * Кто главнее: правка ФАЙЛА для конкретной цели всегда побеждает — при
 * загрузке панельное переопределение этой цели отбрасывается. Панельные
 * правки целей, которых в файле не трогали, сохраняются поверх.
 *
 * localStorage привязан к адресу: шлем (https://<IP>:5173) и компьютер
 * (https://localhost:5173) — РАЗНЫЕ хранилища, и смена IP в сети теряет
 * настройку. Поэтому подобранное в шлеме переноси в этот файл:
 * `game.printLoadout()` в консоли печатает готовый блок.
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
export type ItemKind = "sword" | "bow" | "shield" | "potion";
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
  /** Мир. */
  world: {
    /** Час суток 0..24: задаёт свет, краски неба и место солнца. */
    hour: number;
    /** 1 — время идёт само, 0 — стоит на выставленном часе. */
    auto: number;
  };
  /** Пояс: где висит бутылочка зелья относительно бедра. */
  belt: { pos: [number, number, number] };
  /** Интерфейс в VR: где висит полоска жизней относительно взгляда. */
  hud: { hpPos: [number, number, number] };
  /** Картинка. */
  gfx: {
    /** 1 — сглаживать края кадра (FXAA). В шлеме это стоит заметно дороже. */
    smooth: number;
  };
  /** Голосовой чат. */
  voice: {
    /** 1 — микрофон работает, 0 — молчим (слушать продолжаем). */
    mic: number;
    /** 1 — голос идёт от места игрока, 0 — всех слышно ровно. */
    spatial: number;
  };
}

export const LOADOUT_DEFAULTS: Loadout = {
  hands: {
    left: [-1.14, 3.4, 4.5],
    right: [-0.9, 2.6, 2],
  },
  items: {
    sword: {
      flat: { pos: [0.42, -0.38, 0.85], rot: [-0.2, 0.25, -0.28], scale: 0.55 },
      vrLeft: { pos: [0, 0, 0.12], rot: [0, -1.56, -1.56], scale: 1 },
      vrRight: { pos: [-0.01, 0, 0.12], rot: [0.2, 1.5, 1.56], scale: 1 },
    },
    bow: {
      flat: { pos: [-0.24, -0.26, 0.55], rot: [0, Math.PI, 0], scale: 0.8 },
      vrLeft: { pos: [0.025, 0.025, 0], rot: [-1.8908, -1.22, 1.22], scale: 1 },
      vrRight: { pos: [-0.015, 0.025, 0], rot: [-Math.PI / 2, -0.04, 0], scale: 1 },
    },
    shield: {
      flat: { pos: [-0.34, -0.26, 0.62], rot: [Math.PI / 2, 0, 0], scale: 0.8 },
      vrLeft: { pos: [-0.025, -0.05, 0.025], rot: [0.9308, 1.04, 2.4508], scale: 1 },
      vrRight: { pos: [0.01, -0.05, 0.035], rot: [2.6308, 1.92, 0.6692], scale: 1 },
    },
    potion: {
      flat: { pos: [0.3, -0.3, 0.6], rot: [0, 0, 0], scale: 1 },
      vrLeft: { pos: [0.025, -0.01, 0.02], rot: [1.2, 0, 0], scale: 1 },
      vrRight: { pos: [-0.03, 0, 0.02], rot: [0.9, 0, 0], scale: 1 },
    },
  },
  buttons: {
    panelToggle: 5, // Y на левом
    panelNext: 4, // X на левом
    panelSpend: 5, // B на правом
    jump: 4, // A на правом
  },
  world: {
    hour: 2.77, // час суток: свет, небо и место солнца
    auto: 1, // время идёт само
  },
  belt: {
    pos: [0.01, 0.2, 0.1],
  },
  hud: {
    hpPos: [-0.035, 0.46, 0.72],
  },
  gfx: {
    smooth: 1, // сглаживание краёв
  },
  voice: {
    mic: 0, // микрофон работает
    spatial: 1, // голос идёт от места игрока
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
export type TargetKey =
  | `hand:${HandSide}`
  | `item:${ItemKind}:${SlotKey}`
  | "world:time"
  | "belt:potion"
  | "hud:hp"
  | "voice:chat"
  | "gfx:smooth";

export function handTarget(side: HandSide): TargetKey {
  return `hand:${side}`;
}
export function itemTarget(kind: ItemKind, slot: SlotKey): TargetKey {
  return `item:${kind}:${slot}`;
}

function readTarget(src: Loadout, key: TargetKey): unknown {
  const parts = key.split(":");
  if (parts[0] === "world") return src.world;
  if (parts[0] === "belt") return src.belt;
  if (parts[0] === "hud") return src.hud;
  if (parts[0] === "voice") return src.voice;
  if (parts[0] === "gfx") return src.gfx;
  if (parts[0] === "hand") return src.hands[parts[1] as HandSide];
  return src.items[parts[1] as ItemKind][parts[2] as SlotKey];
}

function writeTarget(dst: Loadout, key: TargetKey, value: unknown): void {
  const parts = key.split(":");
  if (parts[0] === "world") {
    const w = value as Partial<Loadout["world"]>;
    if (typeof w?.hour === "number" && Number.isFinite(w.hour)) dst.world.hour = w.hour;
    if (typeof w?.auto === "number") {
      dst.world.auto = Number.isFinite(w.auto) ? (w.auto ? 1 : 0) : 1;
    }
    return;
  }
  if (parts[0] === "belt") {
    const a = (value as Loadout["belt"])?.pos;
    if (Array.isArray(a) && a.length === 3) dst.belt.pos = [a[0], a[1], a[2]];
    return;
  }
  if (parts[0] === "hud") {
    const a = (value as Loadout["hud"])?.hpPos;
    if (Array.isArray(a) && a.length === 3) dst.hud.hpPos = [a[0], a[1], a[2]];
    return;
  }
  if (parts[0] === "gfx") {
    const v = value as Partial<Loadout["gfx"]>;
    if (typeof v?.smooth === "number") {
      dst.gfx.smooth = Number.isFinite(v.smooth) ? (v.smooth ? 1 : 0) : 1;
    }
    return;
  }
  if (parts[0] === "voice") {
    const v = value as Partial<Loadout["voice"]>;
    // Мусор трактуем как «включено»: молчащий микрофон выглядит поломкой.
    if (typeof v?.mic === "number") dst.voice.mic = Number.isFinite(v.mic) ? (v.mic ? 1 : 0) : 1;
    if (typeof v?.spatial === "number") {
      dst.voice.spatial = Number.isFinite(v.spatial) ? (v.spatial ? 1 : 0) : 1;
    }
    return;
  }
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
//
// Пока крутишь значения в панели, каждая правка пишется в localStorage
// (вместе со снимком тогдашнего числа файла — «база»), чтобы случайный
// выход из VR ничего не терял. Строка «Сохранить настройки» отправляет всё
// на дев-сервер (см. pushLoadoutToFile) — он переписывает блок выше, и
// localStorage чистится: файл становится единственным источником.
// Если сервера нет (собранная игра) — остаётся только localStorage,
// а он привязан к адресу: шлем и компьютер — разные хранилища.

const SAVE_KEY = "loadoutOverrides";
interface Override {
  v: unknown;
  base: unknown;
}
type Overrides = Partial<Record<TargetKey, Override | unknown>>;

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

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

function unwrap(entry: Override | unknown): { value: unknown; base: unknown | null } {
  if (entry && typeof entry === "object" && "v" in (entry as Override)) {
    const e = entry as Override;
    return { value: e.v, base: e.base ?? null };
  }
  return { value: entry, base: null }; // старый формат — без базы
}

/** Запомнить текущее значение цели, чтобы оно пережило перезагрузку. */
export function saveTarget(key: TargetKey): void {
  const o = loadOverrides();
  o[key] = {
    v: structuredClone(readTarget(LOADOUT, key)),
    base: structuredClone(readTarget(LOADOUT_DEFAULTS, key)),
  };
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

/** Забыть все панельные переопределения (после записи значений в файл). */
export function clearAllOverrides(): void {
  storeOverrides({});
}

/**
 * Отправляет текущие значения дев-серверу — он перепишет блок
 * LOADOUT_DEFAULTS в этом файле. Так «Сохранить настройки» кладёт числа в
 * файл (общий для всех адресов), а не только в localStorage браузера.
 * "ok" — записано; "no-server" — обработчика нет (собранная игра / прод);
 * "error" — сервер не смог.
 */
export async function pushLoadoutToFile(): Promise<"ok" | "no-server" | "error"> {
  try {
    const res = await fetch("/__loadout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        hands: LOADOUT.hands,
        items: LOADOUT.items,
        buttons: LOADOUT.buttons,
        world: LOADOUT.world,
        belt: LOADOUT.belt,
        hud: LOADOUT.hud,
        gfx: LOADOUT.gfx,
        voice: LOADOUT.voice,
      }),
    });
    if (res.ok) {
      clearAllOverrides(); // файл теперь источник правды — локальные копии не нужны
      return "ok";
    }
    return res.status === 404 ? "no-server" : "error";
  } catch {
    return "no-server";
  }
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

/**
 * Накладывает сохранённые в панели значения поверх файла. Если число в файле
 * для цели изменилось с момента сохранения — правка файла главнее, лишнее
 * переопределение удаляется. `fileRef` — актуальные значения файла (при
 * горячей замене это НОВЫЙ модуль, поэтому сравниваем с ним).
 */
function applyOverrides(fileRef: Loadout = LOADOUT_DEFAULTS): { applied: number; dropped: number } {
  const o = loadOverrides();
  let applied = 0;
  let dropped = 0;
  for (const k of Object.keys(o) as TargetKey[]) {
    const { value, base } = unwrap(o[k]);
    if (base !== null && !eq(base, readTarget(fileRef, k))) {
      delete o[k]; // цель правили в файле — файл главнее
      dropped++;
      continue;
    }
    writeTarget(LOADOUT, k, value);
    applied++;
  }
  if (dropped > 0) storeOverrides(o);
  return { applied, dropped };
}

applyOverrides();

// Горячая замена: при сохранении файла новые числа втекают в живой объект,
// игра не перезагружается. Цели, которые правили в файле, берут значение из
// файла (и забывают панельное переопределение); нетронутые — сохраняются.
if (import.meta.hot) {
  import.meta.hot.accept((mod) => {
    const next = (mod as { LOADOUT_DEFAULTS?: Loadout } | undefined)?.LOADOUT_DEFAULTS;
    if (!next) return;
    applyDefaults(next);
    const { applied, dropped } = applyOverrides(next);
    const parts = ["[loadout] файл применён без перезагрузки"];
    if (dropped) parts.push(`${dropped} правок из файла перекрыли настройку панели`);
    if (applied) parts.push(`${applied} настроек панели оставлены поверх`);
    console.log(parts.join("; "));
  });
}
