import { ITEMS, type ItemId, type WeaponClass } from "./items";
import type { ArmorPart } from "./armor";

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
/** Обёртка для многоцветных значков, перенесённых как есть (свои цвета, без currentColor). */
const g = (attrs: string, inner: string): string => `<g ${attrs}>${inner}</g>`;

export const ICONS = {
  // ---- оружие и щиты: картинки из концепта по грейду (public/icons/gear/); базовый ключ — обычное (серебро) ----
  "w.sword": { emoji: "🗡️", img: "gear/sword_base.png" },
  "w.sword.gold": { emoji: "🗡️", img: "gear/sword_gold.png" },
  "w.sword.legendary": { emoji: "🗡️", img: "gear/sword_legendary.png" },
  "w.sword.ruby": { emoji: "🗡️", img: "gear/sword_ruby.png" },
  "w.dagger": { emoji: "🔪", img: "gear/dagger_base.png" },
  "w.dagger.gold": { emoji: "🔪", img: "gear/dagger_gold.png" },
  "w.dagger.legendary": { emoji: "🔪", img: "gear/dagger_legendary.png" },
  "w.dagger.ruby": { emoji: "🔪", img: "gear/dagger_ruby.png" },
  "w.spear": { emoji: "🔱", img: "gear/spear_base.png" },
  "w.spear.gold": { emoji: "🔱", img: "gear/spear_gold.png" },
  "w.spear.legendary": { emoji: "🔱", img: "gear/spear_legendary.png" },
  "w.spear.ruby": { emoji: "🔱", img: "gear/spear_ruby.png" },
  "w.hammer": { emoji: "🔨", img: "gear/hammer_base.png" },
  "w.hammer.gold": { emoji: "🔨", img: "gear/hammer_gold.png" },
  "w.hammer.legendary": { emoji: "🔨", img: "gear/hammer_legendary.png" },
  "w.hammer.ruby": { emoji: "🔨", img: "gear/hammer_ruby.png" },
  "w.staff": { emoji: "🪄", img: "gear/staff_base.png" },
  "w.staff.gold": { emoji: "🪄", img: "gear/staff_gold.png" },
  "w.staff.legendary": { emoji: "🪄", img: "gear/staff_legendary.png" },
  "w.staff.ruby": { emoji: "🪄", img: "gear/staff_ruby.png" },
  "w.bow": { emoji: "🏹", img: "gear/bow_base.png" },
  "w.bow.gold": { emoji: "🏹", img: "gear/bow_gold.png" },
  "w.bow.legendary": { emoji: "🏹", img: "gear/bow_legendary.png" },
  "w.bow.ruby": { emoji: "🏹", img: "gear/bow_ruby.png" },
  "w.shield": { emoji: "🛡️", img: "gear/shield_base.png" },
  "w.shield.gold": { emoji: "🛡️", img: "gear/shield_gold.png" },
  "w.shield.legendary": { emoji: "🛡️", img: "gear/shield_legendary.png" },
  "w.shield.ruby": { emoji: "🛡️", img: "gear/shield_ruby.png" },
  "w.aegis": { emoji: "🛡️", img: "gear/aegis_base.png" },
  "w.aegis.gold": { emoji: "🛡️", img: "gear/aegis_gold.png" },
  "w.aegis.legendary": { emoji: "🛡️", img: "gear/aegis_legendary.png" },
  "w.aegis.ruby": { emoji: "🛡️", img: "gear/aegis_ruby.png" },
  // Мастерское (крафт) — тёмно-оранжевое: перекраска рубиновых картинок (временно, до своих).
  "w.sword.craft": { emoji: "🗡️", img: "gear/sword_craft.png" },
  "w.dagger.craft": { emoji: "🔪", img: "gear/dagger_craft.png" },
  "w.spear.craft": { emoji: "🔱", img: "gear/spear_craft.png" },
  "w.hammer.craft": { emoji: "🔨", img: "gear/hammer_craft.png" },
  "w.staff.craft": { emoji: "🪄", img: "gear/staff_craft.png" },
  "w.bow.craft": { emoji: "🏹", img: "gear/bow_craft.png" },
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
  "i.armor": { emoji: "🛡️", img: "armor/chest_base.png" },
  // ---- броня: обычный тир — верхний ряд атласа (public/icons/armor) ----
  "a.helm": { emoji: "⛑️", img: "armor/helm_base.png" },
  "a.chest": { emoji: "🦺", img: "armor/chest_base.png" },
  "a.gloves": { emoji: "🧤", img: "armor/gloves_base.png" },
  "a.legs": { emoji: "👖", img: "armor/legs_base.png" },
  "a.boots": { emoji: "🥾", img: "armor/boots_base.png" },
  // Золотой тир: золотой ряд атласа «Атлас фэнтезийных доспехов» (вырезан в public/icons/armor/*_gold.png).
  "a.helm.gold": { emoji: "⛑️", img: "armor/helm_gold.png" },
  "a.chest.gold": { emoji: "🦺", img: "armor/chest_gold.png" },
  "a.gloves.gold": { emoji: "🧤", img: "armor/gloves_gold.png" },
  "a.legs.gold": { emoji: "👖", img: "armor/legs_gold.png" },
  "a.boots.gold": { emoji: "🥾", img: "armor/boots_gold.png" },
  // Уникальный тир (фиолетовый): фиолетовый ряд того же атласа (public/icons/armor/*_legendary.png).
  "a.helm.legendary": { emoji: "⛑️", img: "armor/helm_legendary.png" },
  "a.chest.legendary": { emoji: "🦺", img: "armor/chest_legendary.png" },
  "a.gloves.legendary": { emoji: "🧤", img: "armor/gloves_legendary.png" },
  "a.legs.legendary": { emoji: "👖", img: "armor/legs_legendary.png" },
  "a.boots.legendary": { emoji: "🥾", img: "armor/boots_legendary.png" },
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
  // ---- крафт: материалы и особые катализаторы (shared/craft.ts) — временные значки ----
  "m.alloy": { emoji: "🧱" },
  "m.web": { emoji: "🕸️" },
  "m.scale": { emoji: "🐉" },
  "m.bone": { emoji: "🦴" },
  "m.frost": { emoji: "❄️" },
  "m.sting": { emoji: "🦂" },

  // ---- классы ----
  "c.warrior": { emoji: "⚔️" },
  "c.archer": { emoji: "🏹" },
  "c.support": { emoji: "✨" },
  "c.assassin": { emoji: "🔪" },
  "c.spearman": { emoji: "🦯" },
  "c.battlemage": { emoji: "🔨" },

  // ---- атрибуты ----
  "a.str": { emoji: "💪", img: "attr/str.png" },
  "a.agi": { emoji: "🏃", img: "attr/agi.png" },
  "a.int": { emoji: "🔮", img: "attr/int.png" },
  "a.con": { emoji: "🛡️", img: "attr/con.png" },
  "a.luc": { emoji: "🍀", img: "attr/luc.png" },
  "a.wis": { emoji: "📿", img: "attr/wis.png" },

  // ---- характеристики героя (строки в окне снаряжения; одноцветные, цвет — по месту) ----
  "st.hp": { emoji: "❤", box: "0 0 20 20", svg: `<path d="M10 17s-6-3.6-6-8.2A3.4 3.4 0 0 1 10 6.4a3.4 3.4 0 0 1 6 2.4C16 13.4 10 17 10 17z" fill="currentColor"/>` },
  "st.dmg": { emoji: "⚔", box: "0 0 20 20", svg: g(`fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"`, `<path d="M15.5 2.5l2 2-9 9-2-2zM5.5 11.5l3 3M4 13l3 3M3 17l2-2"/>`) },
  "st.aspd": { emoji: "⚡", box: "0 0 20 20", svg: `<path d="M11 2L5 11h4.5L8.5 18 15 8.5h-4.5z" fill="currentColor"/>` },
  "st.move": { emoji: "👟", box: "0 0 20 20", svg: g(`fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"`, `<path d="M3 13h8M5 9.5h9M7 6h7M14 13a3 3 0 1 0 0-6"/>`) },
  "st.dodge": { emoji: "🍃", box: "0 0 20 20", svg: `<path d="M16 3.5C9.5 4 5 8.5 4 16.5c4.5-4 8.5-6 12-13z" fill="currentColor"/>` },
  "st.crit": { emoji: "🎯", box: "0 0 20 20", svg: g(`fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"`, `<circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r="2.2" fill="currentColor"/><path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3"/>`) },
  "st.critx": { emoji: "✴", box: "0 0 20 20", svg: `<path d="M10 2l2 5 5.3.4-4 3.4 1.3 5.2L10 13.2 5.4 16l1.3-5.2-4-3.4L8 7z" fill="currentColor"/>` },
  "st.pdef": { emoji: "🛡", box: "0 0 20 20", svg: `<path d="M10 2l6.5 2.5v4.8c0 4.2-2.8 7.2-6.5 8.7-3.7-1.5-6.5-4.5-6.5-8.7V4.5z" fill="currentColor"/>` },
  "st.mdef": { emoji: "🔰", box: "0 0 20 20", svg: g(`fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"`, `<path d="M10 2l6.5 2.5v4.8c0 4.2-2.8 7.2-6.5 8.7-3.7-1.5-6.5-4.5-6.5-8.7V4.5z"/><path d="M10 6.5v7M6.8 10h6.4"/>`) },
  "st.regen": { emoji: "💧", box: "0 0 20 20", svg: `<path d="M10 2.5c3.2 4.2 5.2 6.6 5.2 9.1a5.2 5.2 0 0 1-10.4 0c0-2.5 2-4.9 5.2-9.1z" fill="currentColor"/>` },
  "st.vamp": { emoji: "🩸", box: "0 0 20 20", svg: g(`fill="currentColor"`, `<path d="M6 3h8l-1.2 5.5L10 17l-2.8-8.5z"/>`) },
  "st.block": { emoji: "🛡", box: "0 0 20 20", svg: g(`fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"`, `<path d="M10 2l6.5 2.5v4.8c0 4.2-2.8 7.2-6.5 8.7-3.7-1.5-6.5-4.5-6.5-8.7V4.5z"/><path d="M6.5 10.5l2.5 2.5 4.5-5" stroke-linecap="round"/>`) },
  "st.magic": { emoji: "✨", box: "0 0 20 20", svg: `<path d="M10 2l1.6 5.4L17 9l-5.4 1.6L10 16l-1.6-5.4L3 9l5.4-1.6z" fill="currentColor"/>` },

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
  /** Герой (голова и плечи) — рядом с ником. */
  "ui.hero": {
    emoji: "👤",
    box: "0 0 24 24",
    svg: `<circle cx="12" cy="8.2" r="4.2" fill="currentColor"/><path d="M3.8 21c.6-4.4 4-7 8.2-7s7.6 2.6 8.2 7z" fill="currentColor"/>`,
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

/**
 * Значок оружия по классу и грейду (tier: base/gold/legendary/ruby — свои картинки; без грейда — обычный).
 * Пусто/неизвестно — кулак. Эгида — свой щит.
 */
export function weaponIcon(cls: WeaponClass | string | null | undefined, aegis = false, tier?: string | null): IconKey {
  const item = cls === "shield" ? (aegis ? "aegis" : "shield") : cls;
  if (tier && tier !== "base") {
    const g = `w.${item}.${tier}`;
    if (g in ICONS) return g as IconKey;
  }
  const k = `w.${item}`;
  return k in ICONS ? (k as IconKey) : "w.fist";
}

/** Значок части брони по тиру: обычный — a.helm, золотой — a.helm.gold (как у оружия по грейду). */
export function armorIconKey(part: ArmorPart, tier?: string | null): IconKey {
  if (tier && tier !== "base") {
    const g = `a.${part}.${tier}`;
    if (g in ICONS) return g as IconKey;
  }
  return `a.${part}` as IconKey;
}

/** Значок умения по id (нет такого — «✦»). */
export function skillIcon(id: string | null | undefined): IconKey {
  const k = `s.${id}`;
  return id && k in ICONS ? (k as IconKey) : "ui.noSkill";
}

/** Значок предмета по ItemId (оружие — по классу; `aegis` — это Эгида). */
export function itemIcon(id: ItemId, aegis = false): IconKey {
  const w = ITEMS[id]?.weapon;
  if (w) return weaponIcon(w.cls, aegis, w.tier);
  const k = `i.${id}`;
  return k in ICONS ? (k as IconKey) : "i.scrap";
}
