/**
 * Ожерелья (2026-10-23, дизайн — docs/necklaces.md). Один слот у героя. Аффиксы меняют умения, урона не дают:
 * радиус зон, длительность эффектов и дальность умений. Тиры: обычное, золотое, уникальное, рубиновое (мифическое
 * синее — позже). Каждый аффикс — очки 1..33 и своя строка заточки, как у брони; гнёзда — под те же камни, что в
 * кольцах (атрибуты считает jewelBonus). Хранится вместе с кольцами и камнями (jewels.ts: JewelSave.necks/neckOn).
 *
 * Модуль без серверных и клиентских зависимостей: ролл, подписи, лом, заточка, бонусы — одинаково везде.
 */
import { enchantCurve, POINTS_MAX, type EnchantDeck, type EnchantInfo } from "./items";
import { seededByString } from "./ringAffixes";

export type NeckTier = "base" | "gold" | "legendary" | "ruby";
export const NECK_TIERS: readonly NeckTier[] = ["base", "gold", "legendary", "ruby"];

/**
 * Аффиксы ожерелья: доли прибавки к радиусу и дальности умений (одна величина — reach, 2026-10-24: радиус и дальность
 * слиты), к длительности эффектов и откату умений (cooldown — сокращение, отнимается от времени отката).
 */
export type NeckStat = "reach" | "duration" | "cooldown";
/** Все аффиксы — и постоянный порядок в предмете (как у брони). */
export const NECK_STATS: readonly NeckStat[] = ["reach", "duration", "cooldown"];

export const NECK_STAT_NAME: Record<NeckStat, string> = {
  reach: "Радиус и дальность умений",
  duration: "Длительность умений",
  cooldown: "Откат умений",
};

/** Значение аффикса у обычного тира: от 1 до 33 очков (как у брони). */
export const NECK_RANGE: Record<NeckStat, readonly [number, number]> = {
  reach: [0.03, 0.09],
  duration: [0.05, 0.15],
  cooldown: [0.03, 0.09],
};

/** Прежние имена аффиксов (до 2026-10-24): радиус и дальность стали одним reach. */
const LEGACY_STAT: Record<string, NeckStat> = { radius: "reach", range: "reach", duration: "duration", reach: "reach", cooldown: "cooldown" };

/** Строка аффикса: откат — «−N%» (меньше времени отката), остальные — «+N%». */
function statText(stat: NeckStat, v: number): string {
  return stat === "cooldown" ? `${NECK_STAT_NAME[stat]} −${(v * 100).toFixed(1)}%` : `${NECK_STAT_NAME[stat]} +${(v * 100).toFixed(1)}%`;
}

export const NECK_TIER_NAME: Record<NeckTier, string> = {
  base: "Обычное ожерелье",
  gold: "Золотое ожерелье",
  legendary: "Уникальное ожерелье",
  ruby: "Рубиновое ожерелье",
};

/** Множитель значения каждого аффикса по тиру — как у брони. */
export const NECK_TIER_MUL: Record<NeckTier, number> = { base: 1, gold: 1.2, legendary: 1.3, ruby: 1.4 };

/**
 * Число аффиксов и гнёзд по тиру — [меньше, больше]; большее выпадает с шансом moreChance (отдельно для аффиксов
 * и для гнёзд). Решение пользователя 2026-10-23.
 */
export const NECK = {
  affixes: { base: [1, 1], gold: [1, 2], legendary: [2, 2], ruby: [2, 3] } as Record<NeckTier, readonly [number, number]>,
  sockets: { base: [0, 0], gold: [0, 1], legendary: [1, 1], ruby: [1, 2] } as Record<NeckTier, readonly [number, number]>,
  moreChance: 0.5,
  /** Лом за аффикс по тиру: от min при 1 очке до max при 33 (как ARMOR_SCRAP_RANGE). */
  scrap: { base: [15, 45], gold: [40, 120], legendary: [100, 300], ruby: [400, 1600] } as Record<NeckTier, readonly [number, number]>,
  /** Цена заточки — множитель к общей кривой (items.ts), как у брони того же тира. */
  enchantCostMul: { base: 1 / 5, gold: 1 / 2, legendary: 1, ruby: 8 } as Record<NeckTier, number>,
} as const;

export interface NeckRoll {
  stat: NeckStat;
  pts: number;
  /** Колода заточки этого свойства (enchantRoll в items.ts). */
  ench?: EnchantDeck;
}

export interface NeckInst {
  id: string;
  tier: NeckTier;
  rolls: NeckRoll[];
  /** Камни в гнёздах (длина — число гнёзд), null — пусто. */
  gems: (string | null)[];
  /** ★ избранное — не разбирается и не передаётся. */
  fav?: boolean;
}

/** Аффиксы по NECK_STATS (на месте) — один порядок у всех ожерелий. */
export function sortNeckRolls(list: NeckRoll[]): void {
  list.sort((a, b) => NECK_STATS.indexOf(a.stat) - NECK_STATS.indexOf(b.stat));
}

/** Значение аффикса по очкам и тиру (доля). */
export function neckRollValue(tier: NeckTier, r: { stat: NeckStat; pts: number }): number {
  const [lo, hi] = NECK_RANGE[r.stat];
  const p = Math.max(1, Math.min(POINTS_MAX, r.pts));
  return (lo + ((hi - lo) * (p - 1)) / (POINTS_MAX - 1)) * NECK_TIER_MUL[tier];
}

/** Аффиксы строкой: «Радиус и дальность умений +6.0% · Откат умений −4.2%». */
export function neckRollsText(n: { tier: NeckTier; rolls: readonly NeckRoll[] }): string {
  return n.rolls.map((r) => statText(r.stat, neckRollValue(n.tier, r))).join(" · ");
}

/** Подпись: «Золотое ожерелье · Радиус умений +6.0%». */
export function neckLabel(n: { tier: NeckTier; rolls: readonly NeckRoll[] }): string {
  return `${NECK_TIER_NAME[n.tier]} · ${neckRollsText(n)}`;
}

/** Оценка — сумма очков аффиксов (как у брони и оружия). */
export function neckQuality(n: { rolls: readonly NeckRoll[] }): number {
  return n.rolls.reduce((s, r) => s + r.pts, 0);
}

function pick(range: readonly [number, number], rnd: () => number): number {
  return range[1] > range[0] && rnd() < NECK.moreChance ? range[1] : range[0];
}

/** Раскатать ожерелье: аффиксы без повторов из NECK_STATS, очки 1..33, пустые гнёзда. */
export function rollNecklace(tier: NeckTier, id: string, rnd: () => number = Math.random): NeckInst {
  const pool = [...NECK_STATS];
  const count = Math.min(pool.length, pick(NECK.affixes[tier], rnd));
  const rolls: NeckRoll[] = [];
  for (let i = 0; i < count; i++) {
    const stat = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
    rolls.push({ stat, pts: 1 + Math.floor(rnd() * POINTS_MAX) });
  }
  sortNeckRolls(rolls);
  return { id, tier, rolls, gems: Array.from({ length: pick(NECK.sockets[tier], rnd) }, () => null) };
}

/** Лом за разбор: сумма по аффиксам — NECK.scrap своего тира по очкам аффикса. */
export function neckScrap(n: { tier: NeckTier; rolls: readonly NeckRoll[] }): number {
  const [lo, hi] = NECK.scrap[n.tier];
  let sum = 0;
  for (const r of n.rolls) {
    const p = Math.max(1, Math.min(POINTS_MAX, r.pts));
    sum += Math.max(1, Math.round(lo + ((hi - lo) * (p - 1)) / (POINTS_MAX - 1)));
  }
  return sum;
}

/** Строка заточки аффикса idx — как у брони: шанс по очкам аффикса, цена — по ним, качеству и тиру. */
export function neckEnchantRow(n: NeckInst, idx: number): (EnchantInfo & { label: string }) | null {
  const r = n.rolls[idx];
  if (!r) return null;
  const q = neckQuality(n) / (POINTS_MAX * n.rolls.length);
  const { chance, cost } = enchantCurve(r.pts, q, NECK.enchantCostMul[n.tier]);
  return {
    label: statText(r.stat, neckRollValue(n.tier, r)),
    points: r.pts,
    of: POINTS_MAX,
    max: r.pts >= POINTS_MAX,
    chance,
    cost: Math.max(1, cost),
  };
}

/** Удачная заточка: очки аффикса idx +gain, не выше максимума. */
export function neckEnchant(n: NeckInst, idx: number, gain: number): void {
  const r = n.rolls[idx];
  if (r) r.pts = Math.min(POINTS_MAX, r.pts + gain);
}

/** Прибавка надетого ожерелья: доли к радиусу и дальности, длительности и сокращению отката (нет ожерелья — нули). */
export type NeckBonus = Record<NeckStat, number>;
export function neckBonusOf(n: { tier: NeckTier; rolls: readonly NeckRoll[] } | null | undefined): NeckBonus {
  const b: NeckBonus = { reach: 0, duration: 0, cooldown: 0 };
  if (n) for (const r of n.rolls) b[r.stat] += neckRollValue(n.tier, r);
  return b;
}

/** Сохранённое ожерелье → корректное или null (битое пропускаем). Гнёзда — как сохранены (не больше трёх). */
export function sanitizeNeck(x: unknown, gemOk: (k: unknown) => boolean): NeckInst | null {
  if (!x || typeof x !== "object") return null;
  const o = x as { id?: unknown; tier?: unknown; rolls?: unknown; gems?: unknown; fav?: unknown };
  if (typeof o.id !== "string" || !(NECK_TIERS as readonly unknown[]).includes(o.tier)) return null;
  const rolls: NeckRoll[] = [];
  let merged = false;
  for (const r of Array.isArray(o.rolls) ? (o.rolls as { stat?: unknown; pts?: unknown; ench?: EnchantDeck }[]) : []) {
    const stat = typeof r?.stat === "string" ? LEGACY_STAT[r.stat] : undefined;
    if (!stat) continue;
    const pts = Number(r.pts);
    if (!Number.isFinite(pts)) continue;
    const roll: NeckRoll = { stat, pts: Math.max(1, Math.min(POINTS_MAX, Math.round(pts))) };
    const e = r.ench;
    if (e && typeof e.p === "number" && Number.isInteger(e.s) && Number.isInteger(e.f) && e.s >= 0 && e.f >= 0) roll.ench = { p: e.p, s: e.s, f: e.f };
    // Радиус и дальность слиты: при совпадении остаётся аффикс с большими очками.
    const at = rolls.findIndex((y) => y.stat === stat);
    if (at < 0) rolls.push(roll);
    else {
      merged = true;
      if (roll.pts > rolls[at].pts) rolls[at] = roll;
    }
  }
  // Освободившийся после слияния радиуса и дальности аффикс — новый «Откат умений» (очки — по id, одинаково при каждой загрузке).
  if (merged && !rolls.some((r) => r.stat === "cooldown")) rolls.push({ stat: "cooldown", pts: 1 + Math.floor(seededByString(o.id)() * POINTS_MAX) });
  if (!rolls.length) return null;
  sortNeckRolls(rolls);
  const gems = (Array.isArray(o.gems) ? o.gems : []).slice(0, 3).map((g) => (gemOk(g) ? (g as string) : null));
  const inst: NeckInst = { id: o.id, tier: o.tier as NeckTier, rolls, gems };
  if (o.fav === true) inst.fav = true;
  return inst;
}
