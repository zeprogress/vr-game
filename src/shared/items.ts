import type { MobKind } from "./net/schema";

export type ItemId = "potion" | "gold_sword" | "gold_bow" | "gold_staff";

/**
 * Класс оружия. Внутри класса все уровни держатся в руках одинаково —
 * положение настраивается один раз на класс (см. LOADOUT.items).
 */
export type WeaponClass = "sword" | "bow" | "shield" | "staff";
/**
 * Уровень внутри класса. Всего два: `base` — обычное оружие из пака, лежит на
 * камнях с самого начала; `gold` — золотой вариант, редкая добыча с мобов.
 */
export type WeaponTier = "base" | "gold";

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
  // Посох бьёт слабо — это фокус для магии, а не оружие ближнего боя.
  "staff:base": { cls: "staff", tier: "base", name: "Посох", mult: 0.5, tint: [0.3, 0.2, 0.12] },
  "staff:gold": { cls: "staff", tier: "gold", name: "Золотой посох", mult: 2, tint: [1, 0.84, 0.26] },
};

export function weaponDef(cls: WeaponClass, tier: WeaponTier): WeaponDef {
  return WEAPONS[weaponKey(cls, tier)] ?? (WEAPONS[weaponKey(cls, "base")] as WeaponDef);
}

export function isWeaponClass(v: unknown): v is WeaponClass {
  return v === "sword" || v === "bow" || v === "shield" || v === "staff";
}

export function isWeaponTier(v: unknown): v is WeaponTier {
  return v === "base" || v === "gold";
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
  gold_sword: weaponItem("sword", "gold", "Золото"),
  gold_bow: weaponItem("bow", "gold", "Зол. лук"),
  gold_staff: weaponItem("staff", "gold", "Зол. посох"),
};

function weaponItem(cls: WeaponClass, tier: WeaponTier, short: string): ItemDef {
  const d = weaponDef(cls, tier);
  return {
    name: d.name,
    short,
    hint:
      cls === "shield" ? "защита" : cls === "staff" ? "магия · слабый удар" : `урон x${d.mult}`,
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
  slime: [{ id: "potion", chance: 0.18, min: 1, max: 1 }],
  spitter: [
    { id: "potion", chance: 0.3, min: 1, max: 1 },
    { id: "gold_sword", chance: 0.05, min: 1, max: 1 },
    { id: "gold_bow", chance: 0.05, min: 1, max: 1 },
  ],
  // Босс — щедрая добыча: зелья горстью и гарантированное золотое оружие.
  boss: [
    { id: "potion", chance: 1, min: 2, max: 3 },
    { id: "gold_sword", chance: 0.5, min: 1, max: 1 },
    { id: "gold_bow", chance: 0.5, min: 1, max: 1 },
    { id: "gold_staff", chance: 0.5, min: 1, max: 1 },
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
