import type { MobKind } from "./net/schema";

export type ItemId =
  | "potion"
  | "gold_sword"
  | "gold_bow"
  | "gold_staff"
  | "leg_sword"
  | "leg_bow"
  | "leg_shield"
  | "leg_staff";

/**
 * Класс оружия. Внутри класса все уровни держатся в руках одинаково —
 * положение настраивается один раз на класс (см. LOADOUT.items).
 */
export type WeaponClass = "sword" | "bow" | "shield" | "staff";
/**
 * Уровень внутри класса. `base` — обычное оружие из пака, лежит на камнях с
 * самого начала; `gold` — золотой вариант (редкая добыча с босса, просто ×урон);
 * `legendary` — именное оружие с механическим аффиксом (см. `affix`).
 */
export type WeaponTier = "base" | "gold" | "legendary";

/** Механический эффект легендарного оружия. Числа — в constants.ts (AFFIX). */
export type WeaponAffix = "fire" | "crit" | "guard" | "storm";

export interface WeaponDef {
  cls: WeaponClass;
  tier: WeaponTier;
  name: string;
  /** Во сколько раз бьёт сильнее базового. Щиту не важно. */
  mult: number;
  /** Цвет клинка / дуги / диска. */
  tint: readonly [number, number, number];
  /** Аффикс легендарки (только у tier === "legendary"). */
  affix?: WeaponAffix;
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
  // Посох бьёт слабо — это фокус для магии, а не оружие ближнего боя.
  "staff:base": { cls: "staff", tier: "base", name: "Посох", mult: 0.5, tint: [0.3, 0.2, 0.12] },
  "staff:gold": { cls: "staff", tier: "gold", name: "Золотой посох", mult: 2, tint: [1, 0.84, 0.26] },

  // Легендарки — именное оружие с аффиксом. Урон чуть выше золота, плюс эффект.
  // Все фиолетовые (единый «легендарный» вид).
  "sword:legendary": {
    cls: "sword", tier: "legendary", name: "Пламенный меч", mult: 4.5,
    tint: [0.62, 0.3, 1], affix: "fire",
  },
  "bow:legendary": {
    cls: "bow", tier: "legendary", name: "Лук охотника", mult: 3.7,
    tint: [0.62, 0.3, 1], affix: "crit",
  },
  "shield:legendary": {
    cls: "shield", tier: "legendary", name: "Эгида", mult: 1,
    tint: [0.62, 0.3, 1], affix: "guard",
  },
  "staff:legendary": {
    cls: "staff", tier: "legendary", name: "Посох бури", mult: 2.3,
    tint: [0.62, 0.3, 1], affix: "storm",
  },
};

/** Аффикс оружия по классу/тиру — удобно для боевых формул. */
export function weaponAffix(cls: WeaponClass, tier: WeaponTier): WeaponAffix | undefined {
  return tier === "legendary" ? WEAPONS[weaponKey(cls, tier)]?.affix : undefined;
}

const AFFIX_HINT: Record<WeaponAffix, string> = {
  fire: "легендарный · горение",
  crit: "легендарный · крит",
  guard: "легендарный · усиленный блок",
  storm: "легендарный · сильнее AoE",
};

export function weaponDef(cls: WeaponClass, tier: WeaponTier): WeaponDef {
  return WEAPONS[weaponKey(cls, tier)] ?? (WEAPONS[weaponKey(cls, "base")] as WeaponDef);
}

export function isWeaponClass(v: unknown): v is WeaponClass {
  return v === "sword" || v === "bow" || v === "shield" || v === "staff";
}

export function isWeaponTier(v: unknown): v is WeaponTier {
  return v === "base" || v === "gold" || v === "legendary";
}

/** Можно ли держать два предмета этого класса одновременно (по одному в руке). */
export const DUAL_WIELD: Record<WeaponClass, boolean> = {
  sword: true,
  bow: false, // лук требует обеих рук — второй взять нельзя
  shield: true,
  staff: false, // посох один: его можно взять двумя руками, но не два посоха
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
  leg_sword: weaponItem("sword", "legendary", "Пламя", "gold_sword.png"),
  leg_bow: weaponItem("bow", "legendary", "Лук охот.", "gold_bow.png"),
  leg_shield: weaponItem("shield", "legendary", "Эгида", ""),
  leg_staff: weaponItem("staff", "legendary", "Посох бури", "gold_staff.png"),
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
    hint: d.affix
      ? AFFIX_HINT[d.affix]
      : cls === "shield" ? "защита" : cls === "staff" ? "магия · слабый удар" : `урон x${d.mult}`,
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
  /** Сколько секунд обычный лут лежит, прежде чем растаять (3 минуты). */
  dropLife: 180,
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
    { id: "gold_sword", chance: 0.4, min: 1, max: 1 },
    { id: "gold_bow", chance: 0.4, min: 1, max: 1 },
    { id: "gold_staff", chance: 0.4, min: 1, max: 1 },
  ],
  shard: [],
};

/** Разыграть добычу с моба. `rnd` — источник случайности (0..1). */
export function rollLoot(kind: MobKind, rnd: () => number): { id: ItemId; count: number }[] {
  const out: { id: ItemId; count: number }[] = [];
  for (const e of LOOT[kind] ?? []) {
    if (rnd() > e.chance) continue;
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
