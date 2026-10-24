/**
 * Аффиксы колец (2026-10-23): урон умений и ульты — по образцу ожерелий (shared/necklaces.ts): очки 1..33, у каждого
 * аффикса своя строка заточки, постоянный порядок, сила по тиру. Два надетых кольца складываются (ringSkillBonusOf
 * в jewels.ts). Применяет сервер — ZoneRoom.skillHitMob (умения, их поля/ауры и ульта).
 *
 * Модуль без зависимостей от сервера и клиента: ролл, подписи, заточка, лом-цены.
 */
import { enchantCurve, POINTS_MAX, type EnchantDeck, type EnchantInfo } from "./items";

/** Тиры колец (рубиновое — с 2026-10-23, только из сундука супербосса катакомб). */
export type RingTier = "base" | "gold" | "legendary" | "ruby";
export const RING_TIERS: readonly RingTier[] = ["base", "gold", "legendary", "ruby"];

/** Аффиксы колец; порядок списка — постоянный порядок в предмете. */
export type RingStat = "skill" | "stunned" | "wounded" | "elite" | "crowd" | "pen" | "rage" | "confident" | "close" | "far";
export const RING_STATS: readonly RingStat[] = ["skill", "stunned", "wounded", "elite", "crowd", "pen", "rage", "confident", "close", "far"];

export const RING_STAT_NAME: Record<RingStat, string> = {
  skill: "Урон умений",
  stunned: "По оглушённым",
  wounded: "По раненым",
  elite: "По элите и боссам",
  crowd: "По толпе",
  pen: "Пробивание",
  rage: "Урон в ярости",
  confident: "Урон в уверенности",
  close: "Вплотную",
  far: "Издалека",
};

/** Пояснение для подсказки: когда аффикс работает. */
export const RING_STAT_HINT: Record<RingStat, string> = {
  skill: "умения и ульта сильнее",
  stunned: "по оглушённым, замедленным и пригвождённым",
  wounded: "по целям ниже 35% здоровья",
  elite: "по элитным мобам и боссам",
  crowd: "за каждого задетого умением врага сверх первого (до 4)",
  pen: "умения игнорируют долю брони врага",
  rage: "пока твоё здоровье ниже 50%",
  confident: "пока твоё здоровье выше 80%",
  close: "по врагам ближе 4 м",
  far: "по врагам дальше 8 м",
};

/** Значение у обычного тира от 1 до 33 очков (доля; crowd — за одну цель). */
export const RING_RANGE: Record<RingStat, readonly [number, number]> = {
  skill: [0.02, 0.06],
  stunned: [0.04, 0.12],
  wounded: [0.04, 0.12],
  elite: [0.03, 0.09],
  crowd: [0.005, 0.02],
  pen: [0.03, 0.09],
  rage: [0.04, 0.12],
  confident: [0.02, 0.06],
  close: [0.03, 0.09],
  far: [0.03, 0.09],
};

/** Пороги условий (м, доля здоровья) и сколько целей сверх первой даёт «По толпе». */
export const RING_COND = { woundedBelow: 0.35, rageBelow: 0.5, confidentAbove: 0.8, closeM: 4, farM: 8, crowdMax: 4 } as const;

/** Множитель значения по тиру — как у брони и ожерелий. */
export const RING_TIER_MUL: Record<RingTier, number> = { base: 1, gold: 1.2, legendary: 1.3, ruby: 1.4 };

/**
 * Число аффиксов и гнёзд по тиру — [меньше, больше]; большее с шансом moreChance (решение пользователя 2026-10-23).
 * Цена заточки — множитель кривой, как у брони и ожерелий того же тира.
 */
export const RING_ROLL = {
  affixes: { base: [1, 1], gold: [1, 2], legendary: [2, 2], ruby: [2, 3] } as Record<RingTier, readonly [number, number]>,
  sockets: { base: [0, 0], gold: [1, 1], legendary: [1, 2], ruby: [2, 2] } as Record<RingTier, readonly [number, number]>,
  moreChance: 0.5,
  enchantCostMul: { base: 1 / 5, gold: 1 / 2, legendary: 1, ruby: 8 } as Record<RingTier, number>,
} as const;

export interface RingRoll {
  stat: RingStat;
  pts: number;
  ench?: EnchantDeck;
}

export function sortRingRolls(list: RingRoll[]): void {
  list.sort((a, b) => RING_STATS.indexOf(a.stat) - RING_STATS.indexOf(b.stat));
}

export function ringRollValue(tier: RingTier, r: { stat: RingStat; pts: number }): number {
  const [lo, hi] = RING_RANGE[r.stat];
  const p = Math.max(1, Math.min(POINTS_MAX, r.pts));
  return (lo + ((hi - lo) * (p - 1)) / (POINTS_MAX - 1)) * RING_TIER_MUL[tier];
}

/** Аффикс строкой: «Урон умений +4.2%», «По толпе +1.2% за цель», «Пробивание 6.0%». */
export function ringRollText(tier: RingTier, r: { stat: RingStat; pts: number }): string {
  return ringValueText(r.stat, ringRollValue(tier, r));
}

/** Значение аффикса строкой (одно кольцо или сумма двух). */
export function ringValueText(stat: RingStat, value: number): string {
  const v = (value * 100).toFixed(1);
  if (stat === "crowd") return `${RING_STAT_NAME.crowd} +${v}% за цель`;
  if (stat === "pen") return `${RING_STAT_NAME.pen} ${v}% (маг. и физ. защиты)`;
  const brief = RING_STAT_BRIEF[stat] ? ` ${RING_STAT_BRIEF[stat]}` : "";
  return `${RING_STAT_NAME[stat]} +${v}%${brief}`;
}

/** Краткое пояснение в скобках — у аффиксов, которые работают не всегда (по здоровью героя). */
const RING_STAT_BRIEF: Partial<Record<RingStat, string>> = { rage: "(здоровье < 50%)", confident: "(здоровье > 80%)" };

export function ringQuality(r: { rolls: readonly RingRoll[] }): number {
  return r.rolls.reduce((s, x) => s + x.pts, 0);
}

function pick(range: readonly [number, number], rnd: () => number): number {
  return range[1] > range[0] && rnd() < RING_ROLL.moreChance ? range[1] : range[0];
}

/** Аффиксы нового кольца тира: без повторов, очки 1..33, постоянный порядок. */
export function rollRingAffixes(tier: RingTier, rnd: () => number = Math.random): RingRoll[] {
  const pool = [...RING_STATS];
  const n = pick(RING_ROLL.affixes[tier], rnd);
  const out: RingRoll[] = [];
  for (let i = 0; i < n; i++) out.push({ stat: pool.splice(Math.floor(rnd() * pool.length), 1)[0], pts: 1 + Math.floor(rnd() * POINTS_MAX) });
  sortRingRolls(out);
  return out;
}

/** Число гнёзд нового кольца тира. */
export function rollRingSockets(tier: RingTier, rnd: () => number = Math.random): number {
  return pick(RING_ROLL.sockets[tier], rnd);
}

/** Строка заточки аффикса idx (как у брони и ожерелья). */
export function ringEnchantRow(r: { tier: RingTier; rolls: readonly RingRoll[] }, idx: number): (EnchantInfo & { label: string }) | null {
  const a = r.rolls[idx];
  if (!a) return null;
  const q = ringQuality(r) / (POINTS_MAX * r.rolls.length);
  const { chance, cost } = enchantCurve(a.pts, q, RING_ROLL.enchantCostMul[r.tier]);
  return { label: ringRollText(r.tier, a), points: a.pts, of: POINTS_MAX, max: a.pts >= POINTS_MAX, chance, cost: Math.max(1, cost) };
}

export function ringEnchant(r: { rolls: RingRoll[] }, idx: number, gain: number): void {
  const a = r.rolls[idx];
  if (a) a.pts = Math.min(POINTS_MAX, a.pts + gain);
}

/** Сохранённые аффиксы → корректные (битые — пропуск); null — аффиксов в записи нет (старое кольцо). */
export function sanitizeRingRolls(v: unknown): RingRoll[] | null {
  if (!Array.isArray(v)) return null;
  const out: RingRoll[] = [];
  for (const x of v as { stat?: unknown; pts?: unknown; ench?: EnchantDeck }[]) {
    if (!(RING_STATS as readonly unknown[]).includes(x?.stat) || out.some((y) => y.stat === x.stat)) continue;
    const pts = Number(x.pts);
    if (!Number.isFinite(pts)) continue;
    const r: RingRoll = { stat: x.stat as RingStat, pts: Math.max(1, Math.min(POINTS_MAX, Math.round(pts))) };
    const e = x.ench;
    if (e && typeof e.p === "number" && Number.isInteger(e.s) && Number.isInteger(e.f) && e.s >= 0 && e.f >= 0) r.ench = { p: e.p, s: e.s, f: e.f };
    out.push(r);
  }
  sortRingRolls(out);
  return out;
}

/** Генератор по строке (id кольца): старым кольцам аффиксы раскатываются одинаково при каждой загрузке. */
export function seededByString(s: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  let x = h >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 1_000_000) / 1_000_000;
  };
}

/** Сумма аффиксов надетых колец по стату (доли). */
export type RingSkillBonus = Record<RingStat, number>;
export function emptyRingSkillBonus(): RingSkillBonus {
  return { skill: 0, stunned: 0, wounded: 0, elite: 0, crowd: 0, pen: 0, rage: 0, confident: 0, close: 0, far: 0 };
}

/**
 * Множитель урона умения по одной цели от аффиксов колец. Условия — состояние цели и героя в момент удара;
 * `others` — сколько ещё врагов задето этим умением (для «По толпе»). Пробивание считает сам удар (sim.hitMob).
 */
export function ringSkillMul(
  b: RingSkillBonus,
  c: { stunned: boolean; targetHpFrac: number; elite: boolean; heroHpFrac: number; dist: number; others: number },
): number {
  let m = 1 + b.skill;
  if (c.stunned) m += b.stunned;
  if (c.targetHpFrac < RING_COND.woundedBelow) m += b.wounded;
  if (c.elite) m += b.elite;
  if (c.heroHpFrac < RING_COND.rageBelow) m += b.rage;
  if (c.heroHpFrac > RING_COND.confidentAbove) m += b.confident;
  if (c.dist < RING_COND.closeM) m += b.close;
  if (c.dist > RING_COND.farM) m += b.far;
  m += b.crowd * Math.min(RING_COND.crowdMax, Math.max(0, c.others));
  return m;
}
