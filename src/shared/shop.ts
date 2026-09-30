/**
 * Лавка трактирщика (за жетоны заданий ◈) и свитки-баффы.
 * Свитки — предметы сумки: использовать когда хочешь, эффект 15 мин; пока
 * действует — второй такой же не читается. В башне не действуют.
 */
import type { ItemId } from "./items";

export const SCROLL = {
  sec: 15 * 60,
  maxSec: 60 * 60,
  /** Свиток мудрости: ×2 опыта; с благословением (тоже ×2) — ×3 (бонусы складываются). */
  xpMul: 2,
  /** Свиток ветра: +20% скорости бега. */
  windMul: 1.2,
} as const;

export type ShopId = "potions" | "scrap" | "scroll_wind" | "scroll_xp" | "chest";

export interface ShopItem {
  id: ShopId;
  name: string;
  desc: string;
  price: number;
  /** Что кладём в сумку (нет — особая выдача, напр. сундук). */
  item?: ItemId;
  count?: number;
}

export const SHOP: readonly ShopItem[] = [
  { id: "potions", name: "Зелья лечения ×3", desc: "в сумку", price: 1, item: "potion", count: 3 },
  { id: "scrap", name: "Лом ×50", desc: "на заточку роллов", price: 2, item: "scrap", count: 50 },
  { id: "scroll_wind", name: "Свиток ветра", desc: "+20% скорости бега на 15 мин", price: 2, item: "scroll_wind", count: 1 },
  { id: "scroll_xp", name: "Свиток мудрости", desc: "×2 опыта на 15 мин (с благословением ×3)", price: 3, item: "scroll_xp", count: 1 },
  { id: "chest", name: "Сундук оружия", desc: "уникальное оружие твоего класса, оценка не ниже 80", price: 30 },
];

/** Минимальная оценка уникального оружия из сундука. */
export const CHEST_MIN_QUALITY = 80;
/** Как близко к трактирщику, чтобы торговать, м. */
export const TAVERN_REACH = 3.8;
/** Шанс свитка за усложнённое задание. */
export const HARD_SCROLL_CHANCE = 0.25;
