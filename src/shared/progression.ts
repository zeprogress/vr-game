import { PROGRESSION } from "./constants";
import { ATTR2 } from "./attrs2";
import { pointsAt, stepCost } from "./classes2";

/**
 * Формулы боя живут в classes2.ts — единый источник для боя (клиент и сервер), башни, ботов и
 * сводки баланса. Здесь они только переэкспортируются под прежними именами, чтобы импорты не менялись.
 */
export {
  armorFrac,
  arrowDamageFor,
  arrowSpeedBonusFor,
  attackSpeedFor,
  castSpeedFor,
  dodgeChance,
  heroAttackInterval,
  hpRegenFrac,
  armorRegenFlat,
  holdsOneItem,
  maxHpFor,
  meleeAnimRate,
  meleeSpeedFor,
  moveSpeedFor,
  staffCastInterval,
  swordDamageFor,
  weaponDamageBase,
  weaponDmgFromLevel,
} from "./classes2";
export type { AttackWeapon } from "./classes2";
export { levelGain } from "./levelGain";

/**
 * Прогресс героя — «Классы 2.0» (формулы в classes2.ts):
 *   СИЛ — физ. урон любым оружием; ЛОВ — бег и темп физ. атак;
 *   ИНТ — магия и лечение; ТЕЛ — HP и физ. броня;
 *   УДЧ — крит и уворот; МДР — магзащита и скорость каста.
 * Очков — ATTR2.pointsPerLevel за уровень, цена подъёма растёт каждые
 * ATTR2.costStep вложенных (1, 2, 3… очка за +1).
 */
export type StatName = "str" | "agi" | "int" | "con" | "luc" | "wis";
export const STAT_NAMES: readonly StatName[] = ["str", "agi", "int", "con", "luc", "wis"];

/** Прогресс игрока в «плоском» виде — так он летит по сети и лежит в сейве. */
export interface Progress {
  level: number;
  xp: number;
  unspent: number;
  str: number;
  agi: number;
  int: number;
  con: number;
  luc: number;
  wis: number;
}

export function blankProgress(): Progress {
  const s = ATTR2.start;
  return { level: 1, xp: 0, unspent: pointsAt(1), str: s, agi: s, int: s, con: s, luc: s, wis: s };
}

/** Сбросить атрибуты к стартовым и вернуть все очки уровня (сброс/переход на новую систему). */
export function resetAttrs(p: Progress): void {
  for (const k of STAT_NAMES) p[k] = ATTR2.start;
  p.unspent = pointsAt(p.level);
}

/**
 * Кривая опыта реворка (2026-11-03). Опыт до следующего уровня растёт ×growth;
 * опыт моба — от его уровня, чтобы герою того же уровня хватало
 * killsBase·killsGrowth^(L−1) убийств. Выше 75 уровня мобов в мире нет, поэтому
 * mobXpAt клампится на PROGRESSION.mobMaxLevel: до 100 уровня выходит ≈29.7 млн
 * убийств мобов 75 ур. = **≈2.8 года** при 20 убийствах в минуту (для сравнения,
 * старая кривая с реальными мобами до 100 давала ~1 год). Начальный множитель
 * (earlyMul) плавно сходит к 1 к 100 уровню и почти не меняет итог.
 *
 * Когда появятся мобы 76–100, поднять PROGRESSION.mobMaxLevel — кривая ускорится
 * без правки формулы.
 */
export const XP_CURVE = {
  base: 100,
  growth: 1.18,
  killsBase: 10,
  /**
   * Плавный ранний множитель: на 1 уровне ×6, к 100 уровню — ровно ×1,
   * без ступеньки. Степень делает замедление сильнее внизу и мягче к середине:
   * 1 уровень — ~60 убийств вместо 10, 10 — ~150 вместо 30, 20 — ~408
   * вместо 102; дальше плавно ближе к обычной кривой. К 100 — ровно текущая.
   */
  earlyMul: 6,
  earlyMulUntil: PROGRESSION.maxLevel,
  earlyMulPower: 2.4,
  /** Базовая кривая: 10 убийств на 1 ур. без earlyMul; с ним — ~25 на 1 и ~67 на 10. */
  killsGrowth: 1.13,
  /** Босс: во столько раз больше моба уровня бойца (делится по вкладу). */
  bossMul: 10,
  /**
   * Прибавка за моба выше героя (2026-10-22): на 1 уровне — +bonusMax, к максимальному уровню сходит к нулю.
   * Линейно по уровню героя: чем ниже герой, тем ощутимее.
   */
  bonusMax: 0.5,
} as const;

/** Базовая кривая без начального налога — её же видит опыт моба. */
function baseXpToNext(level: number): number {
  return XP_CURVE.base * XP_CURVE.growth ** (level - 1);
}

/** Плавный множитель: на 1-м — `earlyMul`, к `earlyMulUntil` — ровно 1. */
function earlyMulAt(level: number): number {
  const until = XP_CURVE.earlyMulUntil;
  if (level >= until) return 1;
  const t = (until - level) / (until - 1);
  return 1 + (XP_CURVE.earlyMul - 1) * t ** XP_CURVE.earlyMulPower;
}

/** Сколько опыта нужно для перехода с `level` на следующий. */
export function xpToNext(level: number): number {
  if (level >= PROGRESSION.maxLevel) return Infinity;
  return Math.round(baseXpToNext(level) * earlyMulAt(level));
}

/**
 * Опыт за моба уровня `level` (полное убийство). Выше `mobMaxLevel` опыт не растёт:
 * мобов 76–100 в мире пока нет, и прогресс не должен делать вид, что они есть.
 */
export function mobXpAt(level: number): number {
  const L = Math.max(1, Math.min(PROGRESSION.mobMaxLevel, Math.floor(level) || 1));
  // Опыт моба — от БАЗОВОЙ кривой, без начального налога: иначе налог
  // пропорционально увеличивал бы и опыт моба, и замедления бы не было.
  return baseXpToNext(L) / (XP_CURVE.killsBase * XP_CURVE.killsGrowth ** (L - 1));
}

/**
 * Опыт за полное убийство моба уровня `mobLevel` игроку уровня `level` (его доля — умножается на вклад).
 * Моб без уровня (обычные мобы) считается 1-го уровня. Моб ниже героя — опыт в квадрате доли (штраф);
 * выше — опыт «своего» моба × (1 + bonusMax × (макс. уровень − уровень героя) / (макс. уровень − 1)).
 */
export function killXp(mobLevel: number, level: number, boss = false): number {
  if (level >= PROGRESSION.maxLevel) return 0;
  const own = mobXpAt(level);
  const r = mobXpAt(mobLevel > 0 ? mobLevel : 1) / own;
  // Моб ниже героя: доля в квадрате (2026-10-22, было линейно) — за мобов слабее себя опыта заметно меньше.
  // Моб выше героя: прибавка от уровня героя — ощутимая внизу, к максимуму сходит к нулю.
  const left = Math.max(0, PROGRESSION.maxLevel - level) / Math.max(1, PROGRESSION.maxLevel - 1);
  const k = r <= 1 ? r * r : 1 + XP_CURVE.bonusMax * left;
  return own * k * (boss ? XP_CURVE.bossMul : 1);
}

/**
 * Штраф дропа за мобов ниже героя (2026-10-27): до `free` уровней разницы — полный дроп, дальше −`perLevel`
 * за уровень, не ниже `min`. Штучные предметы (оружие, броня, камни, кольца, материалы) — множитель шанса;
 * стопки (лом, зелья) — множитель количества. Боссы — без штрафа. Обычный (не элитный) моб — 1 уровень.
 */
export const LOW_MOB_DROP = { free: 5, perLevel: 0.1, min: 0.1 } as const;

export function lowMobDropMul(heroLevel: number, mobLevel: number): number {
  const diff = heroLevel - Math.max(1, mobLevel) - LOW_MOB_DROP.free;
  return diff <= 0 ? 1 : Math.max(LOW_MOB_DROP.min, 1 - diff * LOW_MOB_DROP.perLevel);
}

/** Количество со штрафом: дробная часть — шансом (12 × 0.25 = 3; 3 × 0.25 — 0 или 1). */
export function scaleCount(count: number, mul: number, rnd: () => number = Math.random): number {
  if (mul >= 1) return count;
  const x = count * mul;
  const n = Math.floor(x);
  return n + (rnd() < x - n ? 1 : 0);
}

export function atMaxLevel(level: number): boolean {
  return level >= PROGRESSION.maxLevel;
}

// ---- изменения ----

/** Начислить опыт. Мутирует `p`, возвращает число набранных уровней. */
export function grantXp(p: Progress, amount: number): number {
  if (atMaxLevel(p.level)) return 0;
  // amount может быть 0: так нормализуем застрявший сейв, где xp уже
  // накоплен до порога, но уровень ещё не поднят.
  if (amount > 0) p.xp += amount;
  let gained = 0;
  while (!atMaxLevel(p.level) && p.xp >= xpToNext(p.level)) {
    p.xp -= xpToNext(p.level);
    p.level++;
    p.unspent += ATTR2.pointsPerLevel;
    gained++;
  }
  if (atMaxLevel(p.level)) p.xp = 0;
  return gained;
}

/** Цена следующего подъёма атрибута. */
export function statCost(p: Pick<Progress, StatName>, stat: StatName): number {
  return stepCost(p[stat]);
}

/** Поднять атрибут на 1 (цена растёт с вложенным). true — получилось. */
export function spendPoint(p: Progress, stat: StatName): boolean {
  const cost = stepCost(p[stat]);
  if (p.unspent < cost) return false;
  p.unspent -= cost;
  p[stat]++;
  return true;
}

export function isStatName(v: unknown): v is StatName {
  return v === "str" || v === "agi" || v === "int" || v === "con" || v === "luc" || v === "wis";
}
