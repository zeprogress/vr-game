/**
 * Природа предмета и валюты перековки (2026-11-04).
 *
 * Природа — постоянное свойство оружия, выпадающее СЛУЧАЙНО при дропе. Она не меняется ни
 * валютой, ни перековкой: это то, что предмет даёт сразу, до всяких аффиксов. Аффиксы
 * (грани) — добавка к природе. Два одинаковых меча с разной природой — разное оружие.
 *
 * Здесь же — валюты перековки (Грань, Эссенция, Знамение) и её правила: цена, трещины,
 * история, бонусы истории. Числа общие для сервера и всех окон.
 */
import type { WeaponClass } from "./items";

export const NATURES = ["hunter", "executioner", "wind", "steadfast", "gambler", "leech"] as const;
export type NatureId = (typeof NATURES)[number];

export interface NatureDef {
  id: NatureId;
  name: string;
  /** Что даёт — одной строкой в карточку. */
  text: string;
  /**
   * Числовой бонус; смысл задают поля ниже.
   * kind: dmg — множитель урона, per — множитель, применяемый к чем-то (см. примечание в text).
   */
  value: number;
}

/**
 * Природа оружия. Значения — доли (0.2 = +20%).
 * `winner` — удача в перековке: +value к шансу удачного действия.
 */
export const NATURE_DEFS: Record<NatureId, NatureDef & { gain: NatureGain }> = {
  hunter: {
    id: "hunter",
    name: "Хищник",
    text: "по врагу с полным здоровьем бьёт на +20%",
    value: 0.2,
    gain: { kind: "fullHp" },
  },
  executioner: {
    id: "executioner",
    name: "Палач",
    text: "по врагу ниже 30% здоровья бьёт на +18%",
    value: 0.18,
    gain: { kind: "lowHp" },
  },
  wind: {
    id: "wind",
    name: "Ветер",
    text: "первый удар после шага — +25%",
    value: 0.25,
    gain: { kind: "firstAfterMove" },
  },
  steadfast: {
    id: "steadfast",
    name: "Стойкость",
    text: "стоя на месте, бьёт на +15%",
    value: 0.15,
    gain: { kind: "standing" },
  },
  gambler: {
    id: "gambler",
    name: "Игрок",
    text: "каждый удар: 10% шанс удвоить урон",
    value: 1,
    gain: { kind: "doubleChance", chance: 0.1 },
  },
  leech: {
    id: "leech",
    name: "Пиявка",
    text: "лечение от удара 5% урона",
    value: 0.05,
    gain: { kind: "leech" },
  },
};

export type NatureGain =
  | { kind: "fullHp" }
  | { kind: "lowHp" }
  | { kind: "firstAfterMove" }
  | { kind: "standing" }
  | { kind: "doubleChance"; chance: number }
  | { kind: "leech" };

/** Полный список природы предмета: класс-независимый (щит тоже получает — для него урон не нужен, см. shieldNature). */
export function rollNature(rnd: () => number = Math.random, cls?: WeaponClass): NatureId {
  // Щиту «урон» не нужен: из пула убираем боевые виды, оставляем защитные/поддержки.
  const pool = cls === "shield" ? NATURES.filter((n) => n === "steadfast" || n === "gambler" || n === "leech") : NATURES;
  return pool[Math.min(pool.length - 1, Math.floor(rnd() * pool.length))];
}

export function natureName(id: string | undefined): string {
  return id && id in NATURE_DEFS ? NATURE_DEFS[id as NatureId].name : "—";
}

export function natureText(id: string | undefined): string {
  return id && id in NATURE_DEFS ? NATURE_DEFS[id as NatureId].text : "";
}

// ---------------------------------------------------------------- валюты перековки

export const REFORGE_CURRENCIES = ["brand", "essence", "omen"] as const;
export type ReforgeCurrency = (typeof REFORGE_CURRENCIES)[number];

export const REFORGE_CURRENCY_DEF: Record<ReforgeCurrency, { name: string; text: string; src: string; color: string }> = {
  brand: { name: "Грань", text: "заменяет выбранную грань предмета на случайную из пула", src: "обычные мобы, лавка", color: "#8fd3ff" },
  essence: { name: "Эссенция", text: "ставит выбранную грань нужного вида; снимает одну трещину", src: "боссы, катакомбы, элитки", color: "#c79bff" },
  omen: { name: "Знамение", text: "раскол: стирает выбранную грань (ниже минимума грейда — трещина)", src: "элитки и боссы", color: "#ffb066" },
};

export const REFORGE_CURRENCY_NAME: Record<ReforgeCurrency, string> = {
  brand: REFORGE_CURRENCY_DEF.brand.name,
  essence: REFORGE_CURRENCY_DEF.essence.name,
  omen: REFORGE_CURRENCY_DEF.omen.name,
};

// ---------------------------------------------------------------- перековка: цена, трещины, история

/** Три уровня трещин: 1 — полировка слабее, 2 — теряет очко, 3 — сколот. */
export const CRACK_MAX = 3;

/** Цена полировки ломом: по грейду. */
export const POLISH_COST: Record<string, number> = { base: 15, gold: 30, legendary: 60, ruby: 240, craft: 240 };

/** Минимум граней по грейду (ниже — раскол даёт трещину). */
export const REFORGE_MIN_ROLLS: Record<string, number> = { base: 1, gold: 1, legendary: 2, ruby: 3, craft: 2 };

/** История перековки — пишется в предмет и даёт бонусы. */
export interface ReforgeHistory {
  /** Сколько раз полировали и сколько из них подняли значения. */
  pol: number;
  up: number;
  /** Сколько раз меняли виды граней. */
  swaps: number;
  /** Сколько трещин залечили. */
  healed: number;
}

export function emptyHistory(): ReforgeHistory {
  return { pol: 0, up: 0, swaps: 0, healed: 0 };
}

/** Бонусы истории — доли и плоские прибавки. */
export interface HistoryBonus {
  /** Прибавка к главной грани (доля значения). */
  main: number;
  /** Прибавка к нижней границе каждой грани (доля). */
  floor: number;
  /** Потолок (множитель): ниже 1 — потолок уже. */
  cap: number;
  /** Плоская регенерация HP/с. */
  regen: number;
  /** Прибавка к темпу атаки (доля, оружие в руках). */
  tempo: number;
  /** Прибавка к скорости бега (доля, надетая броня). */
  move: number;
}

export function historyBonus(h: ReforgeHistory | undefined): HistoryBonus {
  const b: HistoryBonus = { main: 0, floor: 0, cap: 1, regen: 0, tempo: 0, move: 0 };
  if (!h) {
    b.floor = 0.05; // ни разу не точился: стабильные грани
    return b;
  }
  if (h.up > h.pol - h.up && h.pol >= 3) b.main += 0.03;
  if (h.swaps >= 3) {
    b.floor += 0.1;
    b.cap *= 0.9;
  }
  if (h.healed > 0) b.regen += Math.min(3, h.healed) * 1;
  if (h.pol === 0) b.floor += 0.05;
  // Долгая перековка учит предмет держать темп: каждые 5 полировок — +1% к скорости.
  b.tempo += Math.min(0.05, Math.floor(h.pol / 5) * 0.01);
  b.move += Math.min(0.03, Math.floor(h.pol / 10) * 0.01);
  return b;
}

/** Текст истории — строка в карточке. */
export function historyText(h: ReforgeHistory | undefined): string {
  if (!h || h.pol === 0) return "ни разу не точился";
  const parts = [`полировка ×${h.pol} (вверх ${h.up}, вниз ${h.pol - h.up})`];
  if (h.swaps) parts.push(`замен граней ${h.swaps}`);
  if (h.healed) parts.push(`залечено трещин ${h.healed}`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------- перековка оружия и брони

/** Что делаем с предметом. */
export type ReforgeMode = "polish" | "brand" | "essence" | "omen" | "heal";

/** Пул видов граней предмета — у оружия по классу, у брони по части и грейду. */
export const REFORGE_MODES: readonly ReforgeMode[] = ["polish", "brand", "essence", "omen", "heal"] as const;

/** Шанс удачной полировки: с трещиной слабее, природа «Игрок» добавляет удачу. */
export function polishChance(cracks: number, natureId: string | undefined): number {
  const base = 0.55 - 0.1 * Math.min(CRACK_MAX, Math.max(0, cracks));
  return Math.max(0.1, Math.min(0.95, base + (natureId === "gambler" ? 0.08 : 0)));
}

/** Полировка: множитель очков — разброс вверх/вниз (ниже 1 — падение, пишется в историю). */
export function polishMul(rnd: () => number = Math.random): number {
  return 0.85 + rnd() * 0.35;
}

/** Цена полировки: лом по грейду, с каждой трещиной дороже. */
export function polishCost(tier: string, cracks: number): number {
  const base = POLISH_COST[tier] ?? POLISH_COST.base;
  return Math.round(base * (1 + 0.5 * Math.max(0, cracks)));
}

/** Текст уровня трещин — в карточку. */
export function crackText(cracks: number | undefined, natureId?: string): string {
  const n = Math.max(0, Math.min(CRACK_MAX, Math.floor(cracks ?? 0)));
  if (n === 0) return `трещин нет · шанс полировки ${Math.round(polishChance(0, natureId) * 100)}%`;
  if (n === 1) return `1 трещина · полировка слабее (${Math.round(polishChance(1, natureId) * 100)}%)`;
  if (n === 2) return "2 трещины · при полировке одна случайная грань теряет 1 очко";
  return "сколот · числа больше не растут";
}

/** Что из валюты продаётся в лавке (только Грань — сильное берётся лишь с боёв). */
export const CURRENCY_SHOP: Record<ReforgeCurrency, { tokens: number; n: number } | null> = {
  brand: { tokens: 3, n: 1 },
  essence: null,
  omen: null,
};

/** Склад валют перековки: id → сколько. Нет нуля — нет записи. */
export type ReforgeStock = Partial<Record<ReforgeCurrency, number>>;

export function reforgeStockOf(v: unknown): ReforgeStock {
  const out: ReforgeStock = {};
  if (!v || typeof v !== "object") return out;
  for (const k of REFORGE_CURRENCIES) {
    const n = Math.floor(Number((v as Record<string, unknown>)[k]));
    if (Number.isFinite(n) && n > 0) out[k] = n;
  }
  return out;
}
