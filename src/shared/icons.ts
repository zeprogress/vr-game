import { ITEMS, type ItemId, type WeaponClass } from "./items";

/**
 * ВСЕ значки игры — здесь, в одном месте. Поменял значок тут — он меняется
 * везде сразу: ПК, телефон, VR (холсты меню), спектатор/OBS, страница !inv.
 * Рисуют их client/ui/icons.ts (HTML и холст); размер подстраивается под
 * место (в HTML значок = 1em, т.е. берёт размер шрифта ячейки/кнопки).
 *
 *  - `svg`   — векторный значок (содержимое <svg>, по умолчанию viewBox 0 0 100 100).
 *              `currentColor` — цвет по месту (у оружия — цвет тира, см. look.ts);
 *  - `img`   — картинка из public/icons/;
 *  - `emoji` — значок для текста (чат, строки на холсте) и запасной, если нет svg/img.
 */
export interface IconDef {
  emoji: string;
  svg?: string;
  /** viewBox для svg, если не «0 0 100 100». */
  box?: string;
  img?: string;
}

// ---- маленькие помощники для векторных значков (viewBox 0 0 100 100) ----
const line = (d: string, w = 7): string =>
  `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const fill = (d: string): string => `<path d="${d}" fill="currentColor"/>`;
const dot = (cx: number, cy: number, r: number): string => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor"/>`;
const ring = (cx: number, cy: number, r: number, w: number): string =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="currentColor" stroke-width="${w}"/>`;
/** Обёртка для многоцветных значков, перенесённых как есть (свои цвета, без currentColor). */
const g = (attrs: string, inner: string): string => `<g ${attrs}>${inner}</g>`;

export const ICONS = {
  // ---- оружие: остриё вверх-вправо, рукоять вниз-влево; цвет — тир ----
  "w.sword": {
    emoji: "🗡️",
    svg: fill("M88 10 L83 22 L43.5 61.5 L36.5 54.5 L76 15 Z") + line("M29 47 L51 69", 8) + line("M37 61 L24 74", 7) + dot(19, 79, 6),
  },
  "w.dagger": {
    emoji: "🔪",
    // Нож, а не маленький меч (2026-10-02: путали с мечом): широкий клинок с прямым
    // обухом и изогнутым лезвием, толстая рукоять, без крестовины.
    svg: fill("M38 55 L88 12 Q80 50 51 67 Z") + line("M44 62 L20 86", 13),
  },
  "w.spear": {
    emoji: "🔱",
    svg: line("M12 88 L66 34", 6) + fill("M90 10 L83 27 L67.4 32.6 L73 17 Z") + line("M60 32 L68 40", 6),
  },
  "w.hammer": {
    emoji: "🔨",
    svg: line("M14 86 L54 46", 7) + fill("M54 15 L85 46 L70 61 L39 30 Z"),
  },
  "w.staff": {
    emoji: "🪄",
    svg: line("M18 90 L60 42", 7) + dot(70, 29, 13) + ring(70, 29, 21, 3),
  },
  "w.bow": {
    emoji: "🏹",
    svg: line("M30 8 Q84 50 30 92", 7) + line("M30 8 L30 92", 2.5) + line("M12 50 L78 50", 4) + fill("M92 50 L76 42 L76 58 Z") + line("M12 50 L5 43 M12 50 L5 57", 3),
  },
  /** Круглый щит — у всех грейдов один (цвет — тир). */
  "w.shield": {
    emoji: "🛡️",
    svg: ring(50, 50, 38, 7) + ring(50, 50, 24, 3) + dot(50, 50, 9),
  },
  /** Эгида — свой, треугольный щит с крестом. */
  "w.aegis": {
    emoji: "🛡️",
    svg: line("M50 8 L86 20 L82 56 Q72 82 50 94 Q28 82 18 56 L14 20 Z", 7) + line("M50 30 L50 72 M34 46 L66 46", 6),
  },
  /** Пустые руки. */
  "w.fist": {
    emoji: "✊",
    svg:
      line("M26 46 Q26 34 38 34 L66 34 Q78 34 78 46 L78 66 Q78 84 60 84 L44 84 Q26 84 26 68 Z", 6) +
      line("M42 34 L42 50 M54 34 L54 50 M66 34 L66 50", 4) +
      line("M26 58 L46 58 Q54 58 54 50", 5),
  },

  // ---- предметы ----
  "i.potion": { emoji: "🧪", img: "potion.png" },
  /** Лом — кусочки металла (шестерёнка путала). */
  "i.scrap": {
    emoji: "🔩",
    box: "0 0 28 28",
    svg: g(
      `stroke-linejoin="round"`,
      `<path d="M3 17l7-5 4 3-2 6-7 1z" fill="#8d939c" stroke="#d6dae0" stroke-width="1.1"/>` +
        `<path d="M12 9l6-4 5 3-1 6-6 1z" fill="#a4957e" stroke="#e2d6c2" stroke-width="1.1"/>` +
        `<path d="M15 18l6-2 4 4-3 5-6-1z" fill="#6f757e" stroke="#c9ced6" stroke-width="1.1"/>` +
        `<circle cx="18.5" cy="10" r="1.1" fill="#3a3e45"/><circle cx="8" cy="17.5" r="1" fill="#3a3e45"/>`,
    ),
  },
  "i.fish": { emoji: "🐟" },
  "i.scroll_xp": { emoji: "📜" },
  "i.scroll_wind": { emoji: "🪶" },
  /** Жетоны заданий. */
  "i.token": { emoji: "◈" },

  // ---- классы ----
  "c.warrior": { emoji: "⚔️" },
  "c.archer": { emoji: "🏹" },
  "c.support": { emoji: "✨" },
  "c.assassin": { emoji: "🔪" },
  "c.spearman": { emoji: "🦯" },
  "c.battlemage": { emoji: "🔨" },

  // ---- атрибуты ----
  "a.str": { emoji: "💪" },
  "a.agi": { emoji: "🏃" },
  "a.int": { emoji: "🔮" },
  "a.con": { emoji: "🛡️" },
  "a.luc": { emoji: "🍀" },
  "a.wis": { emoji: "📿" },

  // ---- умения (svg — где нарисован свой значок; иначе эмодзи) ----
  "s.stunBash": {
    emoji: "💫",
    box: "0 0 32 32",
    // Меч, вонзённый в землю, и ударная волна.
    svg: g(
      `fill="none" stroke-linecap="round" stroke-linejoin="round"`,
      `<path d="M16 3v15" stroke="#e9ecf2" stroke-width="3"/><path d="M11 8h10" stroke="#c9a05a" stroke-width="2.6"/>` +
        `<path d="M16 18l-2.2 3h4.4z" fill="#e9ecf2" stroke="#e9ecf2" stroke-width="1.2"/>` +
        `<path d="M6 23c3 3 17 3 20 0" stroke="#ff7a4a" stroke-width="2.2"/><path d="M2.5 26.5c5 4.5 22 4.5 27 0" stroke="#ff4a3a" stroke-width="1.8" opacity=".8"/>` +
        `<path d="M9 17l-3-2M23 17l3-2M8 21l-4 0M24 21l4 0" stroke="#ffd166" stroke-width="1.6"/>`,
    ),
  },
  "s.arrowRain": {
    emoji: "🌧️",
    box: "0 0 32 32",
    // Три стрелы падают сверху.
    svg: g(
      `fill="none" stroke-linecap="round" stroke-linejoin="round"`,
      `<g stroke="#dfe9f5" stroke-width="2"><path d="M8 3v17"/><path d="M16 1v21"/><path d="M24 4v16"/></g>` +
        `<g fill="#9fd0ff" stroke="#9fd0ff" stroke-width="1"><path d="M8 24l-2.6-4.5h5.2z"/><path d="M16 26l-2.6-4.5h5.2z"/><path d="M24 24l-2.6-4.5h5.2z"/></g>` +
        `<g stroke="#b88a54" stroke-width="1.6"><path d="M6 3l2 2 2-2M14 1l2 2 2-2M22 4l2 2 2-2"/></g>` +
        `<path d="M4 29h24" stroke="#6f8a5a" stroke-width="2"/>`,
    ),
  },
  "s.massHeal": {
    emoji: "💚",
    box: "0 0 32 32",
    // Зелёный крест в сияющем кольце.
    svg: g(
      `fill="none" stroke-linecap="round" stroke-linejoin="round"`,
      `<circle cx="16" cy="16" r="12.5" stroke="#5fe08a" stroke-width="1.8" opacity=".75"/>` +
        `<path d="M16 8v16M8 16h16" stroke="#7dff9e" stroke-width="5"/><path d="M16 8v16M8 16h16" stroke="#eafff0" stroke-width="1.6"/>` +
        `<path d="M5 6l1.5 1.5M26 5l-1.5 1.5M27 26l-1.5-1.5M5 26l1.5-1.5" stroke="#bfffd0" stroke-width="1.6"/>`,
    ),
  },
  "s.shadowStep": { emoji: "🌑" },
  "s.crush": { emoji: "💥" },
  "s.seal": { emoji: "🔯" },
  "s.whirlwind": { emoji: "🌀" },
  "s.cleave": { emoji: "⚔️" },
  "s.warcry": { emoji: "📯" },
  "s.mark": { emoji: "🎯" },
  "s.chain": { emoji: "⚡" },
  "s.plague": { emoji: "🧪" },
  "s.smoke": { emoji: "🌫️" },
  "s.soulSteal": { emoji: "👻" },
  "s.abyss": { emoji: "🕳️" },
  "s.lifeArrow": { emoji: "💚" },
  "ui.test": { emoji: "🧪" },

  // ---- баффы ----
  "b.victory": { emoji: "🗡️" },
  "b.camp": { emoji: "🛡️" },
  "b.scrollXp": { emoji: "📜" },
  "b.scrollWind": { emoji: "🪶" },

  // ---- интерфейс ----
  /** Мешок (кнопка снаряжения и сумки). */
  "ui.sack": {
    emoji: "🎒",
    box: "0 0 24 24",
    svg: g(
      `fill="none" stroke-linecap="round" stroke-linejoin="round"`,
      `<path d="M9 3.5h6l-1.6 3.2h-2.8z" fill="#c9b28a" stroke="#e8dcc0" stroke-width="1.2"/>` +
        `<path d="M10.2 6.9c-4.2 1.4-6.7 5.3-6.2 9.3.4 3.1 3 4.8 8 4.8s7.6-1.7 8-4.8c.5-4-2-7.9-6.2-9.3z" fill="#a8855a" stroke="#e8dcc0" stroke-width="1.3"/>` +
        `<path d="M9.6 7.2c1.6.6 3.2.6 4.8 0" stroke="#5a4028" stroke-width="1.6"/>` +
        `<path d="M8 13.5c1.3 1 2.6 1.4 4 1.4" stroke="#e8dcc0" stroke-width="1" opacity=".6"/>`,
    ),
  },
  "ui.map": { emoji: "🗺" },
  "ui.chat": { emoji: "💬" },
  "ui.fullscreen": { emoji: "⛶" },
  "ui.menu": { emoji: "⚙" },
  /** Выстрел из прицела (телефон). */
  "ui.fire": { emoji: "➤" },
  /** Кил-фид: «кто → кого». */
  "ui.kill": { emoji: "🗡️" },
  /** Молот заточки (наковальня). */
  "ui.forge": { emoji: "🔨" },
  /** Пустая ячейка умения. */
  "ui.noSkill": { emoji: "✦" },
  /** Избранное оружие (звёздочка в инвентаре) и пустая звёздочка — «добавить в избранное». */
  "ui.fav": { emoji: "★" },
  "ui.favOff": { emoji: "☆" },
  /** Рука, которая что-то поднимает (подобрать, клавиша E). */
  "ui.grab": {
    emoji: "✋",
    box: "0 0 24 24",
    svg: g(
      `fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"`,
      `<path d="M8 11v-3.5a1.5 1.5 0 0 1 3 0v2.5"/><path d="M11 9.5v-3a1.5 1.5 0 0 1 3 0v3.5"/>` +
        `<path d="M14 7.5a1.5 1.5 0 0 1 3 0v2.5"/><path d="M17 11.5a1.5 1.5 0 0 1 3 0v4.5a6 6 0 0 1-6 6h-2h.2a6 6 0 0 1-5-2.7l-.2-.3c-.3-.5-1.4-2.4-3.3-5.7a1.5 1.5 0 0 1 .5-2a1.9 1.9 0 0 1 2.3.3l1.5 1.5"/>`,
    ),
  },
} satisfies Record<string, IconDef>;

export type IconKey = keyof typeof ICONS;

/** Значок для текста (чат, подписи на холсте): эмодзи. */
export function glyph(key: IconKey): string {
  return ICONS[key].emoji;
}

/** Значок оружия по классу (пусто/неизвестно — кулак). Эгида — свой. */
export function weaponIcon(cls: WeaponClass | string | null | undefined, aegis = false): IconKey {
  if (cls === "shield") return aegis ? "w.aegis" : "w.shield";
  const k = `w.${cls}`;
  return k in ICONS ? (k as IconKey) : "w.fist";
}

/** Значок умения по id (нет такого — «✦»). */
export function skillIcon(id: string | null | undefined): IconKey {
  const k = `s.${id}`;
  return id && k in ICONS ? (k as IconKey) : "ui.noSkill";
}

/** Значок предмета по ItemId (оружие — по классу; `aegis` — это Эгида). */
export function itemIcon(id: ItemId, aegis = false): IconKey {
  const w = ITEMS[id]?.weapon;
  if (w) return weaponIcon(w.cls, aegis);
  const k = `i.${id}`;
  return k in ICONS ? (k as IconKey) : "i.scrap";
}
