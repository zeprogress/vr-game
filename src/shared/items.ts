import { SHIELD, WEAPON_DROP_MUL } from "./constants";
import type { MobKind } from "./net/schema";

export type ItemId =
  | "potion"
  | "gold_sword"
  | "gold_bow"
  | "gold_staff"
  | "leg_sword"
  | "leg_bow"
  | "leg_shield"
  | "gold_shield"
  | "leg_staff"
  | "gold_dagger"
  | "gold_spear"
  | "gold_hammer"
  | "leg_dagger"
  | "leg_spear"
  | "leg_hammer"
  | "scrap"
  | "fish"
  | "scroll_xp"
  | "scroll_wind";

/**
 * Класс оружия. Внутри класса все уровни держатся в руках одинаково —
 * положение настраивается один раз на класс (см. LOADOUT.items).
 */
export type WeaponClass = "sword" | "bow" | "shield" | "staff" | "dagger" | "spear" | "hammer";

/** Все классы оружия (без щита) — для выпадения, списков и проверок. */
export const ATTACK_CLASSES: readonly WeaponClass[] = ["sword", "bow", "staff", "dagger", "spear", "hammer"];
/** Оружие, занимающее обе руки, — в интерфейсе стоит в левой, правая помечена «занята». */
export function bothHandsCls(cls: string | undefined): boolean {
  return cls === "bow" || cls === "spear" || cls === "hammer";
}
/** Подпись занятой второй руки. */
export function bothHandsNote(cls: string | undefined): string {
  return cls === "bow" ? "лук занимает обе руки" : cls === "hammer" ? "молот держат обе руки" : "копьё держат обе руки";
}

/** Двуручное оружие ближнего боя «Классов 2.0» — держится двумя руками, как посох. */
export function isTwoHandedMelee(cls: string): boolean {
  return cls === "spear" || cls === "hammer";
}
/**
 * Уровень внутри класса. `base` — обычное оружие из пака, лежит на камнях с
 * самого начала; `gold` — золотой вариант (редкая добыча с босса, просто ×урон);
 * `legendary` — именное оружие с механическим аффиксом (см. `affix`).
 */
export type WeaponTier = "base" | "gold" | "legendary";

/** Эффект СТАРЫХ уникальных типов — теперь только для миграции в обычный ролл (см. migrateLoot). */
export type WeaponAffix = "vamp" | "crit" | "guard" | "storm";

export interface WeaponDef {
  cls: WeaponClass;
  tier: WeaponTier;
  name: string;
  /** Во сколько раз бьёт сильнее базового. Щиту не важно. */
  mult: number;
  /** Цвет клинка / дуги / диска. */
  tint: readonly [number, number, number];
}

export type WeaponKey = `${WeaponClass}:${WeaponTier}`;

export function weaponKey(cls: WeaponClass, tier: WeaponTier): WeaponKey {
  return `${cls}:${tier}`;
}

export const WEAPONS: Partial<Record<WeaponKey, WeaponDef>> = {
  // tint — запасной цвет (модели пака несут свой), плюс цвет золотой перекраски.
  "sword:base": { cls: "sword", tier: "base", name: "Меч", mult: 1, tint: [0.55, 0.57, 0.62] },
  "sword:gold": { cls: "sword", tier: "gold", name: "Золотой меч", mult: 4, tint: [1, 0.84, 0.26] },
  "bow:base": { cls: "bow", tier: "base", name: "Лук", mult: 1, tint: [0.42, 0.28, 0.16] },
  "bow:gold": { cls: "bow", tier: "gold", name: "Золотой лук", mult: 3, tint: [1, 0.84, 0.26] },
  "shield:base": { cls: "shield", tier: "base", name: "Щит", mult: 1, tint: [0.62, 0.64, 0.7] },
  "shield:gold": { cls: "shield", tier: "gold", name: "Золотой щит", mult: 1, tint: [1, 0.84, 0.26] },
  // Посох бьёт слабо — это фокус для магии, а не оружие ближнего боя.
  "staff:base": { cls: "staff", tier: "base", name: "Посох", mult: 0.5, tint: [0.3, 0.2, 0.12] },
  "staff:gold": { cls: "staff", tier: "gold", name: "Золотой посох", mult: 2, tint: [1, 0.84, 0.26] },

  // Уникальные — урон чуть выше золота и 2–3 ролла (эффектов «из коробки» больше нет).
  // Все фиолетовые (единый «уникальный» вид).
  "sword:legendary": { cls: "sword", tier: "legendary", name: "Уникальный меч", mult: 4.5, tint: [0.62, 0.3, 1] },
  "bow:legendary": { cls: "bow", tier: "legendary", name: "Уникальный лук", mult: 4.1, tint: [0.62, 0.3, 1] },
  "shield:legendary": { cls: "shield", tier: "legendary", name: "Уникальный щит", mult: 1, tint: [0.62, 0.3, 1] },
  "staff:legendary": { cls: "staff", tier: "legendary", name: "Уникальный посох", mult: 2.3, tint: [0.62, 0.3, 1] },

  // «Классы 2.0»: урон удара задаёт профиль оружия (classes2 WEAPONS2.dmg), mult — только тир.
  "dagger:base": { cls: "dagger", tier: "base", name: "Кинжал", mult: 1, tint: [0.55, 0.57, 0.62] },
  "dagger:gold": { cls: "dagger", tier: "gold", name: "Золотой кинжал", mult: 4, tint: [1, 0.84, 0.26] },
  "dagger:legendary": { cls: "dagger", tier: "legendary", name: "Уникальный кинжал", mult: 4.5, tint: [0.62, 0.3, 1] },
  "spear:base": { cls: "spear", tier: "base", name: "Копьё", mult: 1, tint: [0.42, 0.28, 0.16] },
  "spear:gold": { cls: "spear", tier: "gold", name: "Золотое копьё", mult: 4, tint: [1, 0.84, 0.26] },
  "spear:legendary": { cls: "spear", tier: "legendary", name: "Уникальное копьё", mult: 4.5, tint: [0.62, 0.3, 1] },
  "hammer:base": { cls: "hammer", tier: "base", name: "Молот", mult: 1, tint: [0.45, 0.47, 0.52] },
  "hammer:gold": { cls: "hammer", tier: "gold", name: "Золотой молот", mult: 4, tint: [1, 0.84, 0.26] },
  "hammer:legendary": { cls: "hammer", tier: "legendary", name: "Уникальный молот", mult: 4.5, tint: [0.62, 0.3, 1] },
};

/**
 * Имена и эффекты СТАРЫХ уникальных (до упрощения роллов 2026-10-01): эффект
 * типа превращается в обычный ролл на максимуме, имя остаётся на экземпляре
 * (WeaponInstance.nm). Используется только разовой миграцией migrateLoot.
 */
const LEGACY_LEGENDARY: Partial<Record<WeaponClass, { name: string; affix: WeaponAffix }>> = {
  sword: { name: "Меч вампира", affix: "vamp" },
  bow: { name: "Лук охотника", affix: "crit" },
  shield: { name: "Эгида", affix: "guard" },
  staff: { name: "Посох бури", affix: "storm" },
  dagger: { name: "Жало тени", affix: "crit" },
  spear: { name: "Копьё крови", affix: "vamp" },
  hammer: { name: "Молот грома", affix: "storm" },
};

/** Имя конкретного экземпляра: у старых уникальных — их историческое имя. */
export function instanceName(w: Pick<WeaponInstance, "cls" | "tier" | "nm">): string {
  return w.nm ?? weaponDef(w.cls, w.tier).name;
}

export function weaponDef(cls: WeaponClass, tier: WeaponTier): WeaponDef {
  return WEAPONS[weaponKey(cls, tier)] ?? (WEAPONS[weaponKey(cls, "base")] as WeaponDef);
}

export function isWeaponClass(v: unknown): v is WeaponClass {
  return v === "sword" || v === "bow" || v === "shield" || v === "staff" || v === "dagger" || v === "spear" || v === "hammer";
}

export function isWeaponTier(v: unknown): v is WeaponTier {
  return v === "base" || v === "gold" || v === "legendary";
}

/**
 * Название тира по-русски для чата/инвентаря. `legendary` внутри кода и в
 * ItemId ("leg_sword" и т.п.) остаётся как есть — это просто ключ, менять
 * его означало бы переименовывать пол-игры без всякой пользы; здесь только
 * то, что реально видит игрок (было "легендарное" → стало "уникальное").
 */
const TIER_RU: Record<WeaponTier, string> = {
  base: "база",
  gold: "золото",
  legendary: "уникальное",
};
export function tierRu(tier: WeaponTier): string {
  return TIER_RU[tier];
}

/** Можно ли держать два предмета этого класса одновременно (по одному в руке). */
export const DUAL_WIELD: Record<WeaponClass, boolean> = {
  sword: true,
  bow: false, // лук требует обеих рук — второй взять нельзя
  shield: true,
  staff: false, // посох один: его можно взять двумя руками, но не два посоха
  dagger: true, // ассасин: кинжал в каждой руке
  spear: false, // копьё — двуручное
  hammer: false, // молот — двуручный
};

export interface ItemDef {
  name: string;
  /** Короткая подпись в ячейке сумки. */
  short: string;
  /** Пояснение под ячейкой. */
  hint: string;
  /** Сколько влезает в одну ячейку. */
  stack: number;
  /** Сколько HP восстанавливает при использовании. 0 — не используется. */
  heal: number;
  /** Цвет в мире и в сетке [r,g,b]. */
  tint: readonly [number, number, number];
  /** Файл иконки в `public/icons/` (без пути). Пусто — рисуем цветной квадрат. */
  icon: string;
  /**
   * Задан — это оружие, лежащее в мире. Такой предмет НЕ падает в сумку:
   * его берут рукой.
   */
  /** Доля НЕДОСТАЮЩЕГО HP, которую восстанавливает предмет (0 — не лечит долей). */
  healFrac: number;
  weapon?: { cls: WeaponClass; tier: WeaponTier };
}

/** Лом/рыба копятся одной стопкой — предел = uint16 SlotState.count. */
export const BIG_STACK = 65535;

export const ITEMS: Record<ItemId, ItemDef> = {
  potion: {
    name: "Зелье лечения",
    short: "Зелье",
    hint: "восстановить здоровье",
    stack: 99,
    heal: 40,
    healFrac: 0.5,
    tint: [0.9, 0.2, 0.35],
    icon: "potion.png",
  },
  gold_sword: weaponItem("sword", "gold", "Золото", "gold_sword.png"),
  gold_bow: weaponItem("bow", "gold", "Зол. лук", "gold_bow.png"),
  gold_staff: weaponItem("staff", "gold", "Зол. посох", "gold_staff.png"),
  // Иконка "" — рендерится цветным квадратом тира (см. Hud.lootRowHtml,
  // InventoryPanel.iconEl, Overlay), а не картинкой: раньше тут стояли те же
  // PNG, что и у золотого оружия, и баннер дропа с элиты показывал иконку
  // золотого меча, хотя на самом деле выпало уникальное — не отличить на глаз.
  leg_sword: weaponItem("sword", "legendary", "Уник. меч", ""),
  leg_bow: weaponItem("bow", "legendary", "Уник. лук", ""),
  leg_shield: weaponItem("shield", "legendary", "Уник. щит", ""),
  gold_shield: weaponItem("shield", "gold", "Зол. щит", ""),
  leg_staff: weaponItem("staff", "legendary", "Уник. посох", ""),
  gold_dagger: weaponItem("dagger", "gold", "Зол. кинжал", ""),
  gold_spear: weaponItem("spear", "gold", "Зол. копьё", ""),
  gold_hammer: weaponItem("hammer", "gold", "Зол. молот", ""),
  leg_dagger: weaponItem("dagger", "legendary", "Уник. кинжал", ""),
  leg_spear: weaponItem("spear", "legendary", "Уник. копьё", ""),
  leg_hammer: weaponItem("hammer", "legendary", "Уник. молот", ""),
  scrap: {
    name: "Лом оружия",
    short: "Лом",
    hint: "переработка оружия — задел под будущий крафт",
    stack: BIG_STACK,
    heal: 0,
    healFrac: 0,
    tint: [0.55, 0.5, 0.45],
    icon: "",
  },
  scroll_xp: {
    name: "Свиток мудрости",
    short: "Св. мудр.",
    hint: "×2 опыта на 15 мин — используй, когда удобно",
    stack: 99,
    heal: 0,
    healFrac: 0,
    tint: [0.55, 0.75, 1],
    icon: "",
  },
  scroll_wind: {
    name: "Свиток ветра",
    short: "Св. ветра",
    hint: "+20% скорости бега на 15 мин",
    stack: 99,
    heal: 0,
    healFrac: 0,
    tint: [0.6, 1, 0.8],
    icon: "",
  },
  fish: {
    name: "Рыба",
    short: "Рыба",
    hint: "поймана на озере — задел под будущую еду/квесты",
    stack: BIG_STACK,
    heal: 0,
    healFrac: 0,
    tint: [0.5, 0.65, 0.75],
    icon: "",
  },
};

function weaponItem(
  cls: WeaponClass,
  tier: WeaponTier,
  short: string,
  icon: string,
): ItemDef {
  const d = weaponDef(cls, tier);
  return {
    name: d.name,
    short,
    hint:
      cls === "shield"
        ? tier === "base"
          ? "блок и защита — только от роллов"
          : tier === "gold"
            ? "золотой щит · 1–2 ролла"
            : "уникальный щит · 2–3 ролла"
        : tier === "legendary"
          ? "уникальное · 2–3 ролла"
          : tier === "gold"
            ? "золотое · 1–2 ролла"
            : cls === "staff" ? "магия · слабый удар" : `урон x${d.mult}`,
    stack: 1,
    heal: 0,
    healFrac: 0,
    tint: d.tint,
    icon,
    weapon: { cls, tier },
  };
}

/** Оружие в мире берут рукой с этого расстояния. */
export const WEAPON_TAKE_REACH = 2.6;

export function isItemId(v: unknown): v is ItemId {
  return typeof v === "string" && v in ITEMS;
}

export const BAG = {
  slots: 8,
  /** Ближе этого лут подбирается сам. */
  pickupRadius: 1.9,
  /** Сколько секунд обычный лут (банки хп и т.п.) лежит, прежде чем растаять (3 минуты). */
  dropLife: 180,
  /** Сколько секунд оружие лежит на земле, прежде чем растаять (15 минут) — чтобы не копилось на сервере вечно. */
  weaponDropLife: 900,
  /**
   * Сколько секунд трофей с моба закреплён ТОЛЬКО за добившим (не подберут
   * чужие боты/игроки) — потом становится общим, как раньше. Раздел 8 плана:
   * без этого лут игрока часто утаскивал ближайший чужой бот-зритель.
   */
  lootOwnerSec: 25,
  /** Разброс при выпадении нескольких предметов, м. */
  dropSpread: 0.5,
  /** На сколько метров лут висит над землёй — выше травы, чтобы его было видно. */
  dropHeight: 0.5,
} as const;

export interface LootEntry {
  id: ItemId;
  /** Вероятность 0..1. */
  chance: number;
  min: number;
  max: number;
}

export const LOOT: Record<MobKind, LootEntry[]> = {
  // Обычные мобы — только зелья. Золотое оружие ВСЕХ видов падает лишь с босса.
  slime: [{ id: "potion", chance: 0.14, min: 1, max: 1 }],
  spitter: [{ id: "potion", chance: 0.24, min: 1, max: 1 }],
  // Босс — щедрая добыча: зелья горстью и золотое оружие с приличным шансом.
  // Легендарки с него больше не падают — только с события «Охота на элиту».
  boss: [
    { id: "potion", chance: 1, min: 2, max: 3 },
    { id: "gold_sword", chance: 0.05, min: 1, max: 1 },
    { id: "gold_bow", chance: 0.05, min: 1, max: 1 },
    { id: "gold_staff", chance: 0.05, min: 1, max: 1 },
    { id: "gold_dagger", chance: 0.05, min: 1, max: 1 },
    { id: "gold_spear", chance: 0.05, min: 1, max: 1 },
    { id: "gold_hammer", chance: 0.05, min: 1, max: 1 },
    { id: "gold_shield", chance: 0.05, min: 1, max: 1 },
  ],
  shard: [],
};

/** Разыграть добычу с моба. `rnd` — источник случайности (0..1). */
export function rollLoot(kind: MobKind, rnd: () => number): { id: ItemId; count: number }[] {
  const out: { id: ItemId; count: number }[] = [];
  for (const e of LOOT[kind] ?? []) {
    // Оружие — с общим множителем дропа (WEAPON_DROP_MUL), зелья — как есть.
    if (rnd() > (ITEMS[e.id].weapon ? Math.min(1, e.chance * WEAPON_DROP_MUL) : e.chance)) continue;
    const count = e.min + Math.floor(rnd() * (e.max - e.min + 1));
    if (count > 0) out.push({ id: e.id, count });
  }
  return out;
}

// ---- сумка ----

export interface Slot {
  item: ItemId | null;
  count: number;
}

export function emptyBag(): Slot[] {
  return Array.from({ length: BAG.slots }, () => ({ item: null, count: 0 }));
}

/**
 * Положить предметы в сумку. Сначала докладывает в начатые стопки,
 * потом занимает пустые ячейки. Возвращает, сколько НЕ влезло.
 */
export function addToBag(bag: Slot[], id: ItemId, count: number): number {
  const max = ITEMS[id].stack;
  let left = count;

  // Лечебные банки: всего в сумке не больше HEAL_CARRY_MAX (сверх — не влезает,
  // остаётся лежать на земле). Остальные предметы ограничены только ячейками.
  if (ITEMS[id].heal > 0) {
    let have = 0;
    for (const s of bag) if (s.item === id) have += s.count;
    const capLeft = Math.max(0, HEAL_CARRY_MAX - have);
    if (capLeft < left) {
      const over = left - capLeft;
      left = capLeft;
      return over + fillBag(bag, id, left, max);
    }
  }
  return fillBag(bag, id, left, max);
}

/** Максимум лечебных банок одного вида в сумке. */
export const HEAL_CARRY_MAX = 99;

function fillBag(bag: Slot[], id: ItemId, count: number, max: number): number {
  let left = count;

  for (const s of bag) {
    if (left <= 0) break;
    if (s.item !== id || s.count >= max) continue;
    const put = Math.min(left, max - s.count);
    s.count += put;
    left -= put;
  }
  for (const s of bag) {
    if (left <= 0) break;
    if (s.item !== null && s.count > 0) continue;
    const put = Math.min(left, max);
    s.item = id;
    s.count = put;
    left -= put;
  }
  return left;
}

/** Снять один предмет с ячейки. true — получилось. */
export function takeOne(bag: Slot[], index: number): ItemId | null {
  const s = bag[index];
  if (!s || !s.item || s.count <= 0) return null;
  const id = s.item;
  s.count--;
  if (s.count <= 0) s.item = null;
  return id;
}

// ---- Роллы оружия: 5 видов — Урон, Скорость атаки, Крит, Вампиризм, Блок ----

export type AffixKind = "dmg" | "atkSpeed" | "crit" | "vamp" | "block" | "reflect" | "physDef" | "magDef";
/**
 * Под-вид ролла. Выпадают: dmgFlat (Урон), atkSpeedPct (Скорость атаки),
 * critChance (Крит — шанс И сила, см. critRollMult), vamp (Вампиризм, ближний
 * бой), block (Блок, только щит). dmgPct — старый «Урон 8–20%», остаётся у
 * уже выпавших. critMult — старый вид, переводится в Крит миграцией.
 */
export type AffixSub = "dmgFlat" | "dmgPct" | "atkSpeedPct" | "critChance" | "critMult" | "vamp" | "block" | "reflect" | "physDef" | "magDef";

export interface RolledAffix {
  kind: AffixKind;
  sub: AffixSub;
  /** Величина — доля (0.12 = +12%). У Крита — шанс; сила выводится из него (critRollMult). */
  value: number;
}

/** Инстанс сдропанного оружия — конкретный, со своими роллами (в отличие от WeaponDef — общего шаблона тира). */
export interface WeaponInstance {
  id: string;
  cls: WeaponClass;
  tier: WeaponTier;
  affixes: RolledAffix[];
  /** 1 — роллы посоха уже в общем диапазоне (см. migrateStaffAffixes). */
  sv?: number;
  /** Имя старого уникального («Меч вампира») — у новых нет. */
  nm?: string;
  /** Версия формата роллов (см. migrateLoot): 4 — 5 видов, 5 — роллы щитов (Блок, Физ./Маг. защита, Отражение). */
  lv?: number;
}

/** Текущая версия формата роллов (WeaponInstance.lv). */
const LOOT_VER = 6;

/** Оружие ближнего боя — только на нём выпадает вампиризм. */
export function isMeleeClass(cls: string): boolean {
  return cls === "sword" || cls === "dagger" || cls === "spear" || cls === "hammer";
}

/**
 * Какие роллы могут выпасть на предмете этого класса (вид на предмете не повторяется).
 * Круглый щит: Блок, Физ. защита, Маг. защита. Эгида: Блок, Физ. защита, Отражение.
 */
function rollableSubs(cls: WeaponClass, aegis = false): AffixSub[] {
  if (cls === "shield") return aegis ? ["block", "physDef", "reflect"] : ["block", "physDef", "magDef"];
  const out: AffixSub[] = ["dmgFlat", "atkSpeedPct", "critChance"];
  if (isMeleeClass(cls)) out.push("vamp");
  return out;
}

const SUB_KIND: Record<AffixSub, AffixKind> = {
  dmgFlat: "dmg",
  dmgPct: "dmg",
  atkSpeedPct: "atkSpeed",
  critChance: "crit",
  critMult: "crit",
  vamp: "vamp",
  block: "block",
  reflect: "reflect",
  physDef: "physDef",
  magDef: "magDef",
};

const AFFIX_RANGES: Record<AffixSub, readonly [number, number]> = {
  dmgFlat: [0.05, 0.15],
  dmgPct: [0.08, 0.2],
  atkSpeedPct: [0.05, 0.15],
  critChance: [0.05, 0.15],
  critMult: [0.3, 1.0],
  vamp: [0.02, 0.1],
  block: [0.07, 0.2],
  reflect: [0.035, 0.1],
  physDef: [0.035, 0.1],
  magDef: [0.05, 0.15],
};
/** Диапазоны роллов Эгиды (макс.: Блок 10%, Отражение 10%, Физ. защита 15%). */
const AEGIS_RANGES: Partial<Record<AffixSub, readonly [number, number]>> = {
  block: [0.035, 0.1],
  physDef: [0.05, 0.15],
};
/** Старый диапазон Блока (до 2026-10-02) — для пересчёта уже выпавших щитов. */
const OLD_BLOCK_RANGE = [0.02, 0.06] as const;

/** Диапазон ролла вида `sub` на предмете (у Эгиды свой). */
function rangeFor(sub: AffixSub, aegis: boolean): readonly [number, number] {
  return (aegis && AEGIS_RANGES[sub]) || AFFIX_RANGES[sub];
}
/** Сила крита у ролла Крит: растёт вместе с шансом, от +0.3 (5%) до +1 (15%). */
const CRIT_ROLL_MULT = [0.3, 1.0] as const;
/** Потолок силы крита до 2026-10-01 — для пересчёта уже выпавших роллов. */
const OLD_CRIT_MULT_HI = 0.8;

/** Доля ролла от минимума к максимуму своего вида (0..1). */
function rollT(sub: AffixSub, value: number, aegis = false): number {
  const [lo, hi] = rangeFor(sub, aegis);
  return hi > lo ? Math.max(0, Math.min(1, (value - lo) / (hi - lo))) : 1;
}
function atT(sub: AffixSub, t: number, aegis = false): number {
  const [lo, hi] = rangeFor(sub, aegis);
  return lo + t * (hi - lo);
}

/** Прибавка к силе крита от ролла Крит (шанс 5..15% → сила +0.3..+1). */
export function critRollMult(chance: number): number {
  return CRIT_ROLL_MULT[0] + rollT("critChance", chance) * (CRIT_ROLL_MULT[1] - CRIT_ROLL_MULT[0]);
}

/** Шанс и сила крита со всех роллов Крит на предмете. */
export function critOfAffixes(affixes: RolledAffix[]): { chance: number; mult: number } {
  let chance = 0;
  let mult = 0;
  for (const a of affixes) {
    if (a.sub === "critChance") {
      chance += a.value;
      mult += critRollMult(a.value);
    } else if (a.sub === "critMult") mult += a.value;
  }
  return { chance, mult };
}

/**
 * СТАРЫЙ завышенный потолок роллов посоха (до 2026-09-28). Больше нигде не
 * используется, кроме разовой миграции migrateStaffAffixes — теперь у посоха
 * тот же диапазон, что у меча/лука.
 */
const OLD_STAFF_RANGE_HI_MUL: Record<AffixSub, number> = {
  dmgFlat: 1.4,
  dmgPct: 1.4,
  atkSpeedPct: 1.25,
  critChance: 1.25,
  critMult: 1.3,
  vamp: 1,
  block: 1,
  reflect: 1,
  physDef: 1,
  magDef: 1,
};

/** Название вида ролла — одно слово-два, как видит игрок. */
export const AFFIX_NAME: Record<AffixSub, string> = {
  dmgFlat: "Урон",
  dmgPct: "Урон",
  atkSpeedPct: "Скорость атаки",
  critChance: "Крит",
  critMult: "Крит",
  vamp: "Вампиризм",
  block: "Блок",
  reflect: "Отражение",
  physDef: "Физ. защита",
  magDef: "Маг. защита",
};

/** Текст ролла для тултипа/чата: «Урон +12%», «Крит +9%», «Вампиризм +5%». */
export function affixLabel(a: RolledAffix): string {
  // Точность не грубее шага заточки (1 очко ≈ 0.2–0.4%) — иначе удачная
  // заточка не меняла бы подпись. Хвостовые нули срезаем: 12.0% → 12%.
  if (a.sub === "critMult") return `Крит, сила +${Math.round(a.value * 100) / 100}`;
  return `${AFFIX_NAME[a.sub]} +${Math.round(a.value * 1000) / 10}%`;
}

/** Все подписи экземпляра для показа. */
export function instanceLabels(w: Pick<WeaponInstance, "affixes">): string[] {
  return w.affixes.map(affixLabel);
}

function rollAffix(rnd: () => number, cls: WeaponClass, used: ReadonlySet<AffixSub>): RolledAffix | null {
  const subs = rollableSubs(cls).filter((s) => !used.has(s));
  if (subs.length === 0) return null;
  const sub = subs[Math.floor(rnd() * subs.length)];
  return { kind: SUB_KIND[sub], sub, value: atT(sub, rnd()) };
}

/** Очки одного ролла: от 1 (самый низкий) до 33 (самый высокий) линейно по диапазону вида. */
export function affixPoints(a: RolledAffix, w: Pick<WeaponInstance, "cls" | "nm">): number {
  return 1 + 32 * rollT(a.sub, a.value, isAegis(w));
}

/**
 * Насколько роллы предмета близки к максимуму — сумма очков всех аффиксов
 * (каждый 1..33). Игроку показывается баллами (qualityStars), внутри —
 * для цены заточки и лома.
 */
export function weaponQuality(w: WeaponInstance): number {
  let sum = 0;
  for (const a of w.affixes) sum += affixPoints(a, w);
  return Math.round(sum);
}

/** Оценка экземпляра: «оценка 47» (сумма очков роллов, у предмета с 3 роллами — до 99). */
export function instanceStars(w: WeaponInstance): string {
  return qualityStars(weaponQuality(w), w.affixes.length);
}

/** Коротко для маленьких ячеек: «47». */
export function qualityStarsShort(quality: number, rolls: number): string {
  return rolls <= 0 || quality <= 0 ? "" : String(Math.round(quality));
}

/** Оценка предмета «оценка 47» — чем больше, тем ближе роллы к максимуму. Пусто — роллов нет. */
export function qualityStars(quality: number, rolls: number): string {
  if (rolls <= 0 || quality <= 0) return "";
  return `оценка ${Math.round(quality)}`;
}

/** Сколько роллов у нового дропа этого тира — принцип "выше тир — больше роллов". */
function rollAffixCount(tier: WeaponTier, rnd: () => number): number {
  if (tier === "base") return 0;
  if (tier === "gold") return rnd() < 0.3 ? 2 : 1;
  return rnd() < 0.4 ? 3 : 2; // legendary
}

function shortId(rnd: () => number): string {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < 8; i++) out += chars[Math.floor(rnd() * chars.length)];
  return out;
}

/** Раскатать новый инстанс дропнутого оружия — тир задаёт кол-во роллов, вид ролла не повторяется. */
export function rollWeaponInstance(
  cls: WeaponClass,
  tier: WeaponTier,
  rnd: () => number = Math.random,
): WeaponInstance {
  const count = rollAffixCount(tier, rnd);
  const affixes: RolledAffix[] = [];
  const used = new Set<AffixSub>();
  while (affixes.length < count) {
    const a = rollAffix(rnd, cls, used);
    if (!a) break;
    used.add(a.sub);
    affixes.push(a);
  }
  return { id: shortId(rnd), cls, tier, affixes, lv: LOOT_VER, ...(cls === "staff" ? { sv: 1 } : {}) };
}

/**
 * "Голый" инстанс без роллов — для оружия, надетого ДО того, как появился
 * склад инстансов (легаси-предметы: были в руках/owned, но никогда не
 * проходили через дроп). Без этого переключение на другое оружие через
 * "!equip" просто стирало такой предмет — его не было в rt.weapons, некуда
 * было деться. См. preserveLegacyWeapon в ZoneRoom.ts.
 */
export function plainWeaponInstance(cls: WeaponClass, tier: WeaponTier): WeaponInstance {
  // Легаси-предмет из тех времён, когда эффект был у типа: без lv —
  // migrateLoot превратит эффект в ролл и сохранит имя.
  const w: WeaponInstance = { id: shortId(Math.random), cls, tier, affixes: [], ...(cls === "staff" ? { sv: 1 } : {}) };
  migrateLoot(w);
  return w;
}

/** Сумма всех роллов данного под-вида на предмете (обычно 0 или 1 ролл, но на всякий — сумма). */
export function affixSum(affixes: RolledAffix[], sub: AffixSub): number {
  let s = 0;
  for (const a of affixes) if (a.sub === sub) s += a.value;
  return s;
}

/** Сколько "Лома" даёт переработка этого инстанса — больше за более редкий тир и за каждый ролл. */
export function scrapValue(w: WeaponInstance): number {
  // С роллами — от средних очков аффиксов (1..33): середина (17) даёт 15,
  // разброс небольшой — от 11 (всё на минимуме) до 19 (всё на максимуме).
  // Выше 45 баллов оценки предмета (сумма очков, та, что в скобках) — лом
  // растёт круто: 45 → 15, 99 (три идеальных ролла) → 99 (заявка 2026-09-28).
  if (w.affixes.length > 0) {
    const avg = w.affixes.reduce((n, a) => n + affixPoints(a, w), 0) / w.affixes.length;
    const base = Math.round(15 + (4 * (avg - 17)) / 16);
    const q = weaponQuality(w);
    return q > 45 ? Math.max(base, Math.round(15 + ((q - 45) * 84) / 54)) : base;
  }
  return w.tier === "legendary" ? 10 : w.tier === "gold" ? 1 : 0;
}

/** Среди инстансов игрока этого класса+тира — тот, что раскатан сильнее (по сумме величин роллов). */
export function bestWeaponInstance(
  weapons: WeaponInstance[],
  cls: WeaponClass,
  tier: WeaponTier,
): WeaponInstance | null {
  let best: WeaponInstance | null = null;
  let bestScore = -Infinity;
  for (const w of weapons) {
    if (w.cls !== cls || w.tier !== tier) continue;
    const score = w.affixes.reduce((s, a) => s + a.value, 0);
    if (score > bestScore) {
      bestScore = score;
      best = w;
    }
  }
  return best;
}

// ---- Заточка аффиксов за лом (веб-инвентарь) ----

/** Сколько лома этого вида в сумке. */
export function bagCount(bag: Slot[], id: ItemId): number {
  return bag.reduce((n, s) => n + (s.item === id ? s.count : 0), 0);
}

/** Забрать `count` штук из сумки (с конца); false — не хватило, сумку не трогает. */
export function takeFromBag(bag: Slot[], id: ItemId, count: number): boolean {
  if (bagCount(bag, id) < count) return false;
  let left = count;
  for (let i = bag.length - 1; i >= 0 && left > 0; i--) {
    const s = bag[i];
    if (s.item !== id) continue;
    const cut = Math.min(left, s.count);
    s.count -= cut;
    left -= cut;
    if (s.count <= 0) bag[i] = { item: null, count: 0 };
  }
  return true;
}

function affixRange(sub: AffixSub, w: Pick<WeaponInstance, "cls" | "nm">): readonly [number, number] {
  return rangeFor(sub, isAegis(w));
}

/**
 * Разовый пересчёт посоха со старого завышенного диапазона в общий с
 * сохранением очков: t = (v−lo)/(старый_hi−lo), v' = lo + t·(hi−lo).
 * Пример: сила крита 1.04 из 0.3..1.04 (33 очка) → 0.8 из 0.3..0.8 (33 очка).
 * Помечает w.sv=1, повторный вызов ничего не делает. true — что-то поменялось.
 */
export function migrateStaffAffixes(w: WeaponInstance): boolean {
  if (w.cls !== "staff" || w.sv === 1) return false;
  for (const a of w.affixes) {
    const [lo, newHi] = AFFIX_RANGES[a.sub];
    // Посох переводится в диапазоны ДО «Лута 3.0» — сила крита дальше
    // поднимается migrateLoot3, как у всех.
    const hi = a.sub === "critMult" ? OLD_CRIT_MULT_HI : newHi;
    const oldHi = hi * OLD_STAFF_RANGE_HI_MUL[a.sub];
    const t = Math.max(0, Math.min(1, (a.value - lo) / (oldHi - lo)));
    a.value = lo + t * (hi - lo);
  }
  w.sv = 1;
  return true;
}

/** Шанс блока щитом: тир + ролл Блок. */
export function shieldBlockChance(tier: WeaponTier | string, inst?: Pick<WeaponInstance, "affixes"> | null): number {
  const base = SHIELD.blockByTier[tier as WeaponTier] ?? SHIELD.blockChance;
  return inst ? base + affixSum(inst.affixes, "block") : base;
}

/** Доля удара моба, которую щит отражает атакующему (ролл Отражение — только Эгида). */
export function shieldReflect(inst?: Pick<WeaponInstance, "affixes"> | null): number {
  return inst ? affixSum(inst.affixes, "reflect") : 0;
}

/** Доля физ. урона, гасимая щитом (ролл Физ. защита). */
export function shieldPhysDef(inst?: Pick<WeaponInstance, "affixes"> | null): number {
  return inst ? affixSum(inst.affixes, "physDef") : 0;
}

/** Доля магического урона, гасимая круглым щитом (ролл Маг. защита). */
export function shieldMagDef(inst?: Pick<WeaponInstance, "affixes"> | null): number {
  return inst ? affixSum(inst.affixes, "magDef") : 0;
}

/** Эгида — старый уникальный щит с особым свойством «Оплот». */
export function isAegis(w: Pick<WeaponInstance, "cls" | "nm"> | null | undefined): boolean {
  return !!w && w.cls === "shield" && w.nm === LEGACY_LEGENDARY.shield?.name;
}
/** Подпись свойства Эгиды (идёт первой в тексте в руке; heroStats/itemStats ищут по слову «Оплот»). */
export const AEGIS_LABEL = `Оплот: блок лечит ${Math.round(SHIELD.aegisHealFrac * 100)}% HP`;

/** Свойства предмета помимо роллов — строки для инвентаря (сейчас у щитов: блок, отражение, «Оплот»). */
export function instanceEffects(w: WeaponInstance): string[] {
  if (w.cls !== "shield") return [];
  const out: string[] = [];
  const block = shieldBlockChance(w.tier, w);
  if (block > 0) out.push(`Блок ${Math.round(block * 1000) / 10}% — гасит удар целиком`);
  if (isAegis(w)) out.push(AEGIS_LABEL);
  return out;
}

/**
 * Тир для меша оружия в руке: уникальный щит с «Оплотом» в тексте роллов
 * (сервер пишет его только Эгиде, см. heldAffixText) — псевдо-тир "aegis".
 */
export function aegisTier(cls: string, tier: string, affix: string | undefined): string {
  return cls === "shield" && tier === "legendary" && !!affix?.startsWith("Оплот") ? "aegis" : tier;
}

/** Текст «в руке» (PlayerState.left/rightAffix, таблица характеристик): свойство Эгиды + роллы. */
export function heldAffixText(w: WeaponInstance | null | undefined): string {
  if (!w) return "";
  return [...(isAegis(w) ? [AEGIS_LABEL] : []), ...instanceLabels(w)].join(", ");
}

/** Доля урона, возвращаемая как HP (ролл Вампиризм). Только ближний бой. */
export function vampFrac(inst: Pick<WeaponInstance, "cls" | "affixes"> | null | undefined): number {
  if (!inst || !isMeleeClass(inst.cls)) return 0;
  return affixSum(inst.affixes, "vamp");
}

/** Поставить ролл вида `sub` на максимум (если такой уже есть — поднять до максимума). */
function maxRoll(w: WeaponInstance, sub: AffixSub): void {
  // Блок щита здесь — ещё в СТАРОМ диапазоне (до lv 5), его пересчитывает конец migrateLoot.
  const hiOf = (k: AffixSub): number => (k === "block" ? OLD_BLOCK_RANGE[1] : AFFIX_RANGES[k][1]);
  const hi = hiOf(sub);
  const had = w.affixes.find((a) => a.sub === sub || (sub === "dmgFlat" && a.sub === "dmgPct"));
  if (had) had.value = hiOf(had.sub);
  else w.affixes.push({ kind: SUB_KIND[sub], sub, value: hi });
}

/**
 * Разовый переход уже выпавших экземпляров на 5 видов роллов (2026-10-01).
 * Очки (близость к максимуму) везде сохраняются:
 *  - сила крита (старый потолок 0.8) → Крит с той же долей от максимума;
 *  - у щита все роллы → один Блок с лучшей долей из бывших;
 *  - эффект старого уникального типа → ролл на максимуме (Меч вампира —
 *    Вампиризм, Лук охотника — Крит, Посох бури — Урон, Эгида — Блок),
 *    имя остаётся («Меч вампира»).
 * Помечает w.lv, повторный вызов ничего не делает. true — что-то поменялось.
 */
export function migrateLoot(w: WeaponInstance): boolean {
  if ((w.lv ?? 0) >= LOOT_VER) return false;
  const ver = w.lv ?? 0;
  // Сила крита → Крит (до версии 3 потолок силы был 0.8).
  for (const a of w.affixes) {
    if (a.sub !== "critMult") continue;
    const [lo, hi] = AFFIX_RANGES.critMult;
    const t = Math.max(0, Math.min(1, (a.value - lo) / ((ver >= 3 ? hi : OLD_CRIT_MULT_HI) - lo)));
    a.sub = "critChance";
    a.kind = "crit";
    a.value = atT("critChance", t);
  }
  // Два ролла Крит (старые шанс + сила) — оставить лучший.
  const crits = w.affixes.filter((a) => a.sub === "critChance");
  if (crits.length > 1) {
    const best = crits.reduce((m, a) => (a.value > m.value ? a : m));
    w.affixes = w.affixes.filter((a) => a.sub !== "critChance" || a === best);
  }
  // Щит: только Блок.
  if (w.cls === "shield" && w.affixes.some((a) => a.sub !== "block")) {
    const t = w.affixes.reduce((m, a) => Math.max(m, rollT(a.sub, a.value)), 0);
    w.affixes = [{ kind: "block", sub: "block", value: OLD_BLOCK_RANGE[0] + t * (OLD_BLOCK_RANGE[1] - OLD_BLOCK_RANGE[0]) }];
  }
  // Эффект старого уникального типа → ролл на максимуме, имя — на экземпляре.
  if (w.tier === "legendary" && ver < 3) {
    const legacy = LEGACY_LEGENDARY[w.cls];
    if (legacy) {
      w.nm = legacy.name;
      const sub: AffixSub =
        legacy.affix === "vamp" ? "vamp" : legacy.affix === "crit" ? "critChance" : legacy.affix === "guard" ? "block" : "dmgFlat";
      maxRoll(w, sub);
    }
  }
  // Ранние уникальные экземпляры ветки (lv 3) с врождённым эффектом.
  const inn = (w as { innate?: WeaponAffix }).innate;
  if (inn) {
    w.nm = LEGACY_LEGENDARY[w.cls]?.name;
    maxRoll(w, inn === "vamp" ? "vamp" : inn === "crit" ? "critChance" : inn === "guard" ? "block" : "dmgFlat");
    delete (w as { innate?: WeaponAffix }).innate;
  }
  // Щиты lv 5: Блок пересчитан на новый диапазон с теми же очками; Эгида получает ещё
  // Отражение и Физ. защиту с теми же очками, что у Блока.
  if (w.cls === "shield") {
    const aegis = isAegis(w);
    let tBlock = 0;
    for (const a of w.affixes) {
      if (a.sub !== "block") continue;
      tBlock = Math.max(0, Math.min(1, (a.value - OLD_BLOCK_RANGE[0]) / (OLD_BLOCK_RANGE[1] - OLD_BLOCK_RANGE[0])));
      a.value = atT("block", tBlock, aegis);
    }
    if (aegis) {
      for (const sub of ["physDef", "reflect"] as const) {
        if (!w.affixes.some((a) => a.sub === sub)) w.affixes.push({ kind: SUB_KIND[sub], sub, value: atT(sub, tBlock, true) });
      }
    }
  }
  // lv 6: максимум Вампиризма 8% → 10% — выпавшие роллы с теми же очками.
  if (ver < 6) {
    for (const a of w.affixes) {
      if (a.sub !== "vamp") continue;
      const t = Math.max(0, Math.min(1, (a.value - 0.02) / (0.08 - 0.02)));
      a.value = atT("vamp", t);
    }
  }
  w.lv = LOOT_VER;
  return true;
}

/**
 * Формулы заточки (прикидка от дохода лома, см. обсуждение 2026-09-28:
 * топ-фармер ~250 лома/день, средний ~120, лёгкий ~20-60).
 * t — близость ЭТОГО аффикса к максимуму (0..1), Q — общая оценка предмета
 * (сумма очков / максимум, 0..1).
 *  шанс  = max(8%, 85% − 77%·t^1.6)            → 85% внизу, ~12% у самого верха
 *  цена  = (3 + 40·t^2.5) · (1 + 1.2·Q) · (×1.5 у уникального)
 *  успех = +1..3 очка (из 33) к аффиксу, неудача — лом всё равно сгорает.
 * Итог (симуляция): золото с 1 аффиксом от середины до максимума ≈ 1500 лома
 * (~6 дней топ-фарма), уникальное с 3 аффиксами ≈ 6500 (~4 недели топа).
 */
export const ENCHANT = { chanceHi: 0.85, chanceDrop: 0.77, chanceMin: 0.08, costBase: 3, costTop: 40, qualityMul: 1.2, legendaryMul: 1.5, gainMin: 1, gainMax: 3 } as const;

export interface EnchantInfo {
  /** Очки аффикса, 1..33 (целые, для показа). */
  points: number;
  max: boolean;
  chance: number;
  cost: number;
}

export function enchantInfo(w: WeaponInstance, idx: number): EnchantInfo | null {
  const a = w.affixes[idx];
  if (!a) return null;
  const pts = affixPoints(a, w);
  const max = pts >= 33 - 1e-6;
  const t = (pts - 1) / 32;
  const q = w.affixes.length ? weaponQuality(w) / (33 * w.affixes.length) : 0;
  const chance = Math.max(ENCHANT.chanceMin, ENCHANT.chanceHi - ENCHANT.chanceDrop * t ** 1.6);
  const cost = Math.round(
    (ENCHANT.costBase + ENCHANT.costTop * t ** 2.5) * (1 + ENCHANT.qualityMul * q) * (w.tier === "legendary" ? ENCHANT.legendaryMul : 1),
  );
  return { points: Math.floor(pts + 1e-6), max, chance, cost };
}

/** Удачная заточка: +gain очков к аффиксу (не выше максимума диапазона). */
export function enchantApply(w: WeaponInstance, idx: number, gain: number): void {
  const a = w.affixes[idx];
  if (!a) return;
  const [lo, hi] = affixRange(a.sub, w);
  a.value = Math.min(hi, a.value + (gain * (hi - lo)) / 32);
}
