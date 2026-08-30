import type { MobKind } from "./net/schema";

export type ItemId = "potion" | "slime" | "shell";

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
}

export const ITEMS: Record<ItemId, ItemDef> = {
  potion: {
    name: "Зелье лечения",
    short: "Зелье",
    hint: "восстановить здоровье",
    stack: 10,
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
};

export function isItemId(v: unknown): v is ItemId {
  return typeof v === "string" && v in ITEMS;
}

export const BAG = {
  slots: 8,
  /** Ближе этого лут подбирается сам. */
  pickupRadius: 1.4,
  /** Сколько секунд лут лежит, прежде чем растаять. */
  dropLife: 90,
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
  ],
  spitter: [
    { id: "shell", chance: 1, min: 1, max: 2 },
    { id: "potion", chance: 0.5, min: 1, max: 1 },
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
