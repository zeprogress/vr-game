import type { MobKind } from "./net/schema";

export type ItemId =
  | "potion"
  | "slime"
  | "shell"
  | "bronze_sword"
  | "gold_sword"
  | "gold_bow"
  | "gold_shield";

/**
 * Класс оружия. Внутри класса все уровни держатся в руках одинаково —
 * положение настраивается один раз на класс (см. LOADOUT.items).
 */
export type WeaponClass = "sword" | "bow" | "shield";
/** Уровень внутри класса. base — то, что лежит на камнях с самого начала. */
export type WeaponTier = "base" | "bronze" | "gold";

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
  "sword:base": { cls: "sword", tier: "base", name: "Меч", mult: 1, tint: [0.52, 0.36, 0.2] },
  "sword:bronze": { cls: "sword", tier: "bronze", name: "Бронзовый меч", mult: 2, tint: [0.78, 0.81, 0.86] },
  "sword:gold": { cls: "sword", tier: "gold", name: "Золотой меч", mult: 5, tint: [1, 0.84, 0.26] },
  "bow:base": { cls: "bow", tier: "base", name: "Лук", mult: 1, tint: [0.55, 0.38, 0.2] },
  "bow:gold": { cls: "bow", tier: "gold", name: "Золотой лук", mult: 3, tint: [1, 0.84, 0.26] },
  "shield:base": { cls: "shield", tier: "base", name: "Щит", mult: 1, tint: [0.62, 0.64, 0.7] },
  "shield:gold": { cls: "shield", tier: "gold", name: "Золотой щит", mult: 1, tint: [1, 0.84, 0.26] },
};

export function weaponDef(cls: WeaponClass, tier: WeaponTier): WeaponDef {
  return WEAPONS[weaponKey(cls, tier)] ?? (WEAPONS[weaponKey(cls, "base")] as WeaponDef);
}

export function isWeaponClass(v: unknown): v is WeaponClass {
  return v === "sword" || v === "bow" || v === "shield";
}

export function isWeaponTier(v: unknown): v is WeaponTier {
  return v === "base" || v === "bronze" || v === "gold";
}

/** Можно ли держать два предмета этого класса одновременно (по одному в руке). */
export const DUAL_WIELD: Record<WeaponClass, boolean> = {
  sword: true,
  bow: false, // лук требует обеих рук — второй взять нельзя
  shield: true,
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
  /**
   * Задан — это оружие, лежащее в мире. Такой предмет НЕ падает в сумку:
   * его берут рукой.
   */
  weapon?: { cls: WeaponClass; tier: WeaponTier };
}

export const ITEMS: Record<ItemId, ItemDef> = {
  potion: {
    name: "Зелье лечения",
    short: "Зелье",
    hint: "восстановить здоровье",
    stack: 99,
    heal: 40,
    tint: [0.9, 0.2, 0.35],
  },
  slime: {
    name: "Слизь",
    short: "Слизь",
    hint: "на продажу",
    stack: 20,
    heal: 0,
    tint: [0.55, 0.2, 0.55],
  },
  shell: {
    name: "Панцирь",
    short: "Панцирь",
    hint: "на продажу",
    stack: 20,
    heal: 0,
    tint: [0.85, 0.55, 0.2],
  },
  bronze_sword: weaponItem("sword", "bronze", "Бронза"),
  gold_sword: weaponItem("sword", "gold", "Золото"),
  gold_bow: weaponItem("bow", "gold", "Зол. лук"),
  gold_shield: weaponItem("shield", "gold", "Зол. щит"),
};

function weaponItem(cls: WeaponClass, tier: WeaponTier, short: string): ItemDef {
  const d = weaponDef(cls, tier);
  return {
    name: d.name,
    short,
    hint: cls === "shield" ? "защита" : `урон x${d.mult}`,
    stack: 1,
    heal: 0,
    tint: d.tint,
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
  pickupRadius: 1.4,
  /** Сколько секунд обычный лут лежит, прежде чем растаять (10 минут). */
  dropLife: 600,
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
  slime: [
    { id: "slime", chance: 1, min: 1, max: 2 },
    { id: "potion", chance: 0.25, min: 1, max: 1 },
    { id: "bronze_sword", chance: 0.1, min: 1, max: 1 },
    { id: "gold_shield", chance: 0.1, min: 1, max: 1 },
  ],
  spitter: [
    { id: "shell", chance: 1, min: 1, max: 2 },
    { id: "potion", chance: 0.5, min: 1, max: 1 },
    { id: "gold_sword", chance: 0.05, min: 1, max: 1 },
    { id: "gold_bow", chance: 0.05, min: 1, max: 1 },
  ],
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
