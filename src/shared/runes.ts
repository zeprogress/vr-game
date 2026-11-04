/**
 * Огранка 2.0 (2026-11-04): грани предмета ставятся РУНАМИ, а не перекатом очков.
 *
 * - Твердь — главный стат предмета, задан при дропе, не меняется. Работает сразу.
 * - Гнёзда — места под грани; сколько их, зависит от грейда (RUNE_SLOTS_BY_TIER).
 * - Руна — вид грани + сила (1..5). Руны копятся за бои: слабые с мобов, сильные с
 *   элиток и боссов. Вставил руну — грань появилась (никаких шансов и колод).
 * - Вынуть руну — лом; две одинаковые слабые руны сливаются в одну сильнее.
 *
 * Старая заточка аффиксов (клик «точить», бросок, колода) этим модулем заменяется:
 * числа граней больше не перекатываются по одному — они задаются силой руны.
 */
import type { AffixSub, WeaponClass, WeaponTier } from "./items";

/** Твердь — главный стат предмета. */
export const SOLIDS = ["edge", "guard", "flow", "ward", "greed", "vigor"] as const;
export type SolidId = (typeof SOLIDS)[number];

export interface SolidDef {
  id: SolidId;
  name: string;
  /** Что даёт — одной строкой в карточку. */
  text: string;
}

export const SOLID_DEFS: Record<SolidId, SolidDef> = {
  edge: { id: "edge", name: "Остриё", text: "удар в спину всегда крит" },
  guard: { id: "guard", name: "Стена", text: "щит блокирует чуть больше" },
  flow: { id: "flow", name: "Поток", text: "скорость атаки +8%" },
  ward: { id: "ward", name: "Оберег", text: "маг. защита +10%" },
  greed: { id: "greed", name: "Алчность", text: "лом с мобов +15%" },
  vigor: { id: "vigor", name: "Живучесть", text: "здоровье +6%" },
};

export function solidName(id: string | undefined): string {
  return id && id in SOLID_DEFS ? SOLID_DEFS[id as SolidId].name : "—";
}

export function solidText(id: string | undefined): string {
  return id && id in SOLID_DEFS ? SOLID_DEFS[id as SolidId].text : "";
}

/** Твердь по классу: щиту — Стена, посоху — Оберег, луку — Остриё и т.д. */
const SOLID_BY_CLS: Record<string, readonly SolidId[]> = {
  sword: ["edge", "flow", "vigor"],
  dagger: ["edge", "flow", "greed"],
  spear: ["edge", "flow", "vigor"],
  hammer: ["edge", "vigor", "ward"],
  bow: ["edge", "greed", "flow"],
  staff: ["ward", "flow", "greed"],
  shield: ["guard", "ward", "vigor"],
};

export function rollSolid(cls: WeaponClass, rnd: () => number = Math.random): SolidId {
  const pool = SOLID_BY_CLS[cls] ?? SOLIDS;
  return pool[Math.min(pool.length - 1, Math.floor(rnd() * pool.length))];
}

/** Гнёзда по грейду: обычное 2, золотое 3, уникальное 4, рубиновое 5. */
export const RUNE_SLOTS_BY_TIER: Record<string, number> = { base: 2, gold: 3, legendary: 4, ruby: 5, craft: 4 };

export function runeSlots(tier: string): number {
  return RUNE_SLOTS_BY_TIER[tier] ?? 2;
}

/**
 * Руна: вид грани (тот же AffixSub, что у роллов оружия) и сила 1..5.
 * Сила даёт очки ролла: 1 → 7, 2 → 13, 3 → 20, 4 → 26, 5 → 33 (максимум).
 */
export const RUNE_PTS = [7, 13, 20, 26, 33] as const;
export const RUNE_MAX_POWER = 5;

export function runePts(power: number): number {
  const p = Math.max(1, Math.min(RUNE_MAX_POWER, Math.round(power)));
  return RUNE_PTS[p - 1];
}

/** Ключ руны «вид:сила» — так руны лежат стопками. */
export function runeKey(sub: AffixSub, power: number): string {
  return `${sub}:${power}`;
}

export function parseRuneKey(key: string): { sub: AffixSub; power: number } | null {
  const [sub, p] = key.split(":");
  const power = Number(p);
  if (!sub || !Number.isFinite(power)) return null;
  return { sub: sub as AffixSub, power: Math.max(1, Math.min(RUNE_MAX_POWER, Math.round(power))) };
}

/** Слияние рун: две одинаковые силы n → одна n+1. */
export const RUNE_MERGE = 2;
export const RUNE_MERGE_MAX = RUNE_MAX_POWER;

/**
 * Что падает в бою: вид руны — из пула класса, сила — от типа моба.
 * Обычный: 1–2, элитка: 2–3, вожак: 3–4, босс: 4–5.
 */
export function rollRune(sub: AffixSub, kind: "regular" | "elite" | "champ" | "boss", rnd: () => number = Math.random): { sub: AffixSub; power: number } {
  const [lo, hi] = kind === "boss" ? [4, 5] : kind === "champ" ? [3, 4] : kind === "elite" ? [2, 3] : [1, 2];
  return { sub, power: lo + Math.floor(rnd() * (hi - lo + 1)) };
}

/** Цена вынуть руну — лом по грейду. */
export const RUNE_REMOVE_COST: Record<string, number> = { base: 20, gold: 40, legendary: 80, ruby: 160, craft: 80 };

export function runeRemoveCost(tier: string): number {
  return RUNE_REMOVE_COST[tier] ?? 20;
}

/** Склад рун героя: «вид:сила» → сколько. Ноль не храним. */
export type RuneStock = Record<string, number>;

export function runeStockOf(v: unknown): RuneStock {
  const out: RuneStock = {};
  if (!v || typeof v !== "object") return out;
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
    if (!parseRuneKey(k)) continue;
    const c = Math.floor(Number(n));
    if (Number.isFinite(c) && c > 0) out[k] = c;
  }
  return out;
}

/** Название вида руны по-русски (совпадает с AFFIX_NAME у оружия). */
export const RUNE_SUB_NAME: Partial<Record<AffixSub, string>> = {
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
  regen: "Регенерация",
  pierce: "Пронзание",
  ignite: "Поджог",
  chill: "Холод",
  venom: "Яд",
};

export function runeSubName(sub: string): string {
  return RUNE_SUB_NAME[sub as AffixSub] ?? sub;
}

/** Цвет по возрастанию силы — для иконок и рамок. */
export const RUNE_POWER_NAME = ["", "Слабая", "Обычная", "Крепкая", "Сильная", "Совершенная"] as const;

/** Максимум вида руны у класса: какие подвиды можно получить с дропа. */
export type { WeaponTier };
