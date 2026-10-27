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
 * Кривая опыта (2026-10-16): опыт до следующего уровня растёт ×growth за уровень (L1 → 100, L10 → 644,
 * L26 → 17 686, L52 → 3 847 341). Опыт моба — от ЕГО уровня: столько, чтобы герою того же уровня
 * хватало killsBase·killsGrowth^(L−1) убийств (L1 — 10, L10 — 29, L30 — 317, L52 — ≈4360, L99 — ≈1.18 млн):
 * до 100 уровня ≈ 10.5 млн убийств = год при 20 в минуту (52 ур. — ~29 ч, 70 — ~10 сут, 90 — ~111 сут).
 * Сильный моб даёт больше, слабый — меньше; слабому герою за сильного — не больше ratioMax от «своего» моба.
 */
export const XP_CURVE = {
  base: 100,
  growth: 1.23,
  killsBase: 10,
  /** Подобран так, чтобы 100 уровень брался за год (365 суток) при 20 убийствах мобов своего уровня в минуту. */
  killsGrowth: 1.1266,
  /** Босс: во столько раз больше моба уровня бойца (делится по вкладу). */
  bossMul: 10,
  /**
   * Прибавка за моба выше героя (2026-10-22): на 1 уровне — +bonusMax, к максимальному уровню сходит к нулю.
   * Линейно по уровню героя: чем ниже герой, тем ощутимее.
   */
  bonusMax: 0.5,
} as const;

/** Сколько опыта нужно для перехода с `level` на следующий. */
export function xpToNext(level: number): number {
  if (level >= PROGRESSION.maxLevel) return Infinity;
  return Math.round(XP_CURVE.base * XP_CURVE.growth ** (level - 1));
}

/** Опыт за моба уровня `level` (полное убийство). */
export function mobXpAt(level: number): number {
  const L = Math.max(1, Math.min(PROGRESSION.maxLevel - 1, level));
  return xpToNext(L) / (XP_CURVE.killsBase * XP_CURVE.killsGrowth ** (L - 1));
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
  if (atMaxLevel(p.level) || amount <= 0) return 0;
  p.xp += amount;
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
