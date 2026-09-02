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

/** Подгонка модели кисти под грип контроллера. */
export interface HandFit {
  /** Поворот кисти относительно grip-узла контроллера, рад. */
  rot: [number, number, number];
  /** Размер модели перчатки. */
  scale: number;
  /** Сила сжатия в кулак: 1 — полный кулак при полном grip, <1 слабее, >1 туже. */
  curl: number;
}

export interface Loadout {
  hands: Record<HandSide, HandFit>;
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
  /**
   * Освещение сцены. Множители и оттенки поверх палитры DayTime — единица
   * (и warm/coolShade = 1) = «как в палитре». Глобальное, сохраняется на
   * сервере по токену игрока.
   */
  light: {
    /** Яркость направленного солнца. */
    sun: number;
    /** Яркость рассеянной заливки неба (её ловит всё, что не под прямым солнцем). */
    fill: number;
    /** Теплота солнечного света: 0 — белый, 1 — золотой. */
    warm: number;
    /** Прохлада тени (синева заливки): 0 — нейтральная белая, 1 — как в палитре. */
    coolShade: number;
    /** Яркость ночи (заливка + луна). */
    night: number;
    /** Плотность тумана: 1 — как в палитре, 0 — тумана нет. */
    fog: number;
  };
  /** Голосовой чат. */
  voice: {
    /** 1 — микрофон работает, 0 — молчим (слушать продолжаем). */
    mic: number;
    /** 1 — голос идёт от места игрока, 0 — всех слышно ровно. */
    spatial: number;
  };
  /**
   * Комфорт в VR. Это ОБЩИЕ настройки мира: их задаёт админ, сервер рассылает
   * всем. Здесь хранится последнее известное значение — панель его показывает.
   */
  comfort: {
    /** 1 — чёрная виньетка при движении левым стиком (меньше укачивает). */
    vignette: number;
    /** 1 — левый стик телепортирует; 0 — плавное скольжение. */
    teleport: number;
  };
}

export const LOADOUT_DEFAULTS: Loadout = {
  hands: {
    left: { rot: [Math.PI, 0, 0], scale: 0.135, curl: 1 },
    right: { rot: [Math.PI, 0, 0], scale: 0.135, curl: 1 },
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
  light: {
    sun: 1, // яркость солнца
    fill: 1, // яркость заливки неба
    warm: 1, // тёплый (золотой) солнечный свет
    coolShade: 1, // прохладная (синеватая) тень
    night: 1, // яркость ночи
    fog: 1, // плотность тумана
  },
  voice: {
    mic: 1, // микрофон работает
    spatial: 0, // всех слышно ровно (не от места игрока)
  },
  comfort: {
    vignette: 1, // виньетка движения включена
    teleport: 0, // плавное скольжение
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
  | "light:day"
  | "belt:potion"
  | "hud:hp"
  | "voice:chat"
  | "gfx:smooth"
  | "comfort:vignette"
  | "comfort:move"
  | "world:clear";

export function handTarget(side: HandSide): TargetKey {
  return `hand:${side}`;
}
export function itemTarget(kind: ItemKind, slot: SlotKey): TargetKey {
  return `item:${kind}:${slot}`;
}

function readTarget(src: Loadout, key: TargetKey): unknown {
  const parts = key.split(":");
  if (key === "world:clear") return {}; // не настройка, а действие
  if (parts[0] === "world") return src.world;
  if (parts[0] === "light") return src.light;
  if (parts[0] === "belt") return src.belt;
  if (parts[0] === "hud") return src.hud;
  if (parts[0] === "voice") return src.voice;
  if (parts[0] === "gfx") return src.gfx;
  if (parts[0] === "comfort") return src.comfort;
  if (parts[0] === "hand") return src.hands[parts[1] as HandSide];
  return src.items[parts[1] as ItemKind][parts[2] as SlotKey];
}

function writeTarget(dst: Loadout, key: TargetKey, value: unknown): void {
  const parts = key.split(":");
  if (key === "world:clear") return; // действие, ничего не хранит
  if (parts[0] === "world") {
    const w = value as Partial<Loadout["world"]>;
    if (typeof w?.hour === "number" && Number.isFinite(w.hour)) dst.world.hour = w.hour;
    if (typeof w?.auto === "number") {
      dst.world.auto = Number.isFinite(w.auto) ? (w.auto ? 1 : 0) : 1;
    }
    return;
  }
  if (parts[0] === "light") {
    const v = value as Partial<Loadout["light"]>;
    const num = (x: unknown, lo: number, hi: number): number | null =>
      typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : null;
    const s = num(v?.sun, 0.2, 3);
    if (s !== null) dst.light.sun = s;
    const f = num(v?.fill, 0, 1.5);
    if (f !== null) dst.light.fill = f;
    const w = num(v?.warm, 0, 2);
    if (w !== null) dst.light.warm = w;
    const c = num(v?.coolShade, 0, 1);
    if (c !== null) dst.light.coolShade = c;
    const n = num(v?.night, 0.2, 2.5);
    if (n !== null) dst.light.night = n;
    const fg = num(v?.fog, 0, 4);
    if (fg !== null) dst.light.fog = fg;
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
  if (parts[0] === "comfort") {
    const v = value as Partial<Loadout["comfort"]>;
    if (typeof v?.vignette === "number") {
      dst.comfort.vignette = Number.isFinite(v.vignette) ? (v.vignette ? 1 : 0) : 1;
    }
    if (typeof v?.teleport === "number") {
      dst.comfort.teleport = Number.isFinite(v.teleport) ? (v.teleport ? 1 : 0) : 0;
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
    const v = value as Partial<HandFit>;
    const h = dst.hands[parts[1] as HandSide];
    if (Array.isArray(v?.rot) && v.rot.length === 3) h.rot = [v.rot[0], v.rot[1], v.rot[2]];
    if (typeof v?.scale === "number" && Number.isFinite(v.scale)) h.scale = Math.max(0.02, v.scale);
    if (typeof v?.curl === "number" && Number.isFinite(v.curl)) h.curl = Math.max(0, v.curl);
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

/** Текущие панельные переопределения — чтобы отправить на сервер. */
export function exportOverrides(): Overrides {
  return loadOverrides();
}

/**
 * Принять настройки с сервера: запомнить локально и применить поверх файла.
 * Вызывается при входе в мир — сервер главнее локального localStorage.
 */
export function importOverrides(o: unknown): void {
  if (!o || typeof o !== "object" || Array.isArray(o)) return;
  storeOverrides(o as Overrides);
  applyOverrides();
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
        light: LOADOUT.light,
        voice: LOADOUT.voice,
        comfort: LOADOUT.comfort,
      }),
    });
    if (res.ok) {
      clearAllOverrides(); // файл теперь источник правды — локальные копии не нужны
      return "ok";
    }
    // Нет обработчика (собранная игра за nginx: 404, или 405 на POST к статике)
    // — не ошибка, просто писать в файл некуда. Настройки уже в localStorage.
    return res.status === 404 || res.status === 405 ? "no-server" : "error";
  } catch {
    return "no-server";
  }
}

/** Печатает текущие значения в виде, готовом для вставки в этот файл. */
export function printLoadout(): void {
  const f = (n: number) => Number(n.toFixed(4));
  const fa = (a: number[]) => `[${a.map(f).join(", ")}]`;
  const lines: string[] = ["hands: {"];
  for (const s of ["left", "right"] as HandSide[]) {
    const h = LOADOUT.hands[s];
    lines.push(`  ${s}: { rot: ${fa(h.rot)}, scale: ${f(h.scale)}, curl: ${f(h.curl)} },`);
  }
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
  const li = LOADOUT.light;
  lines.push(
    `light: { sun: ${f(li.sun)}, fill: ${f(li.fill)}, warm: ${f(li.warm)}, ` +
      `coolShade: ${f(li.coolShade)}, night: ${f(li.night)}, fog: ${f(li.fog)} },`,
  );
  console.log(lines.join("\n"));
}

// ---- применение: сначала файл, поверх — подобранное в игре ----

function applyDefaults(next: Loadout): void {
  for (const s of ["left", "right"] as HandSide[]) {
    const src = next.hands[s];
    const dst = LOADOUT.hands[s];
    dst.rot = [src.rot[0], src.rot[1], src.rot[2]];
    dst.scale = src.scale;
    dst.curl = src.curl;
  }
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
  if (next.light) Object.assign(LOADOUT.light, next.light);
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
