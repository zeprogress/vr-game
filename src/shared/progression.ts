import { PROGRESSION } from "./constants";
import { invested } from "./attrs2";
import {
  ATTR2,
  castTempo2,
  dodge2,
  levelGain,
  magicResist2,
  maxHp2,
  moveSpeed2,
  physArmor2,
  physPower2,
  physTempo2,
  pointsAt,
  stepCost,
  type AttrsIn,
} from "./classes2";

export { levelGain };

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

/** Сколько опыта нужно для перехода с `level` на следующий (удваивается). */
export function xpToNext(level: number): number {
  if (level >= PROGRESSION.maxLevel) return Infinity;
  return PROGRESSION.baseXp * Math.pow(2, level - 1);
}

export function atMaxLevel(level: number): boolean {
  return level >= PROGRESSION.maxLevel;
}

// ---- производные величины (тонкие обёртки над classes2) ----

/**
 * В руках ОДИН предмет — уворот выше (см. dodgeChance). Одна рука пуста, или
 * обе держат один и тот же двуручник (лук/посох/копьё/молот: клиент сообщает
 * его сразу в обеих руках). Два меча/кинжала или оружие со щитом — не один.
 */
export function holdsOneItem(leftCls: string, rightCls: string): boolean {
  if (leftCls === "" || rightCls === "") return true;
  return leftCls === rightCls && (leftCls === "bow" || leftCls === "staff" || leftCls === "spear" || leftCls === "hammer");
}

/**
 * Регенерация здоровья от ТЕЛ — доля МАКС. HP в секунду, работает и в бою
 * (вдобавок к PLAYER_HP.regen вне боя). Ролл щита «Регенерация» — сверху.
 */
export function hpRegenFrac(a: AttrsIn): number {
  return invested(a.con) * ATTR2.con.regen;
}

/** Доля урона, гасимая физ. бронёй (ТЕЛ). */
export function armorFrac(a: AttrsIn): number {
  return physArmor2(a);
}

/** Шанс увернуться от любой атаки (УДЧ); один предмет в руках — выше. */
export function dodgeChance(a: AttrsIn, oneHanded: boolean): number {
  return dodge2(a, oneHanded);
}

/** Базовый множитель физ. урона от уровня (без атрибута и тира оружия). */
export function weaponDmgFromLevel(level: number): number {
  return 1 + levelGain(level, PROGRESSION.perLevel.weaponDmg);
}

/** Итоговый базовый множитель физ. урона: уровень × СИЛ. Тир оружия — отдельно. */
export function weaponDamageBase(level: number, a: AttrsIn): number {
  return physPower2(level, a);
}

/** Мягкое затухание прироста: вначале ≈g, дальше растёт всё медленнее, но БЕЗ потолка. */
function softGain(g: number, s: number): number {
  return g > 0 ? s * Math.log(1 + g / s) : g;
}
/** Сила затухания общего темпа (меньше — сильнее гасит на высоких уровнях). */
const ATK_SOFT = 1.8;
/** Затухание темпа мечника — сильнее общего: на высоких уровнях не «пропеллер». */
const MELEE_SOFT = 1.0;

const START: AttrsIn = { str: 1, agi: 1, int: 1, con: 1, luc: 1, wis: 1 };

/** Темп физ. атак дальнего боя (лук): уровень × ЛОВ. */
export function attackSpeedFor(level: number, a: AttrsIn = START): number {
  return physTempo2(level, a, ATK_SOFT);
}

/** Совместимость: темп атаки только от уровня (где атрибуты неизвестны, напр. чужой аватар). */
export function attackSpeedFromLevel(level: number): number {
  return attackSpeedFor(level);
}

/**
 * Темп атаки БЛИЖНЕГО боя (меч/кинжал/копьё/молот/кулак) — приглушённый:
 * половина общего прироста и своё, более сильное затухание.
 */
export function meleeSpeedFor(level: number, a: AttrsIn = START): number {
  const full = attackSpeedFor(level, a);
  return 1 + softGain((full - 1) * 0.5, MELEE_SOFT);
}

/** Скорость каста (посох, откат заклинаний): уровень × МДР. */
export function castSpeedFor(level: number, a: AttrsIn = START): number {
  return castTempo2(level, a);
}

/** Скорость проигрывания клипа замаха — быстрее темпа боя, чтобы клип успевал. */
export function meleeAnimRate(level: number, a: AttrsIn = START): number {
  return 1.5 * meleeSpeedFor(level, a);
}

export function maxHpFor(level: number, a: AttrsIn): number {
  return maxHp2(level, a);
}

/** Урон мечом (базовый удар на 1 ур. = 1). Совместимость имени. */
export function swordDamageFor(level: number, a: AttrsIn): number {
  return weaponDamageBase(level, a);
}

export function moveSpeedFor(level: number, a: AttrsIn): number {
  return moveSpeed2(level, a);
}

/** Добавка к скорости стрелы, м/с — небольшая, от уровня. */
export function arrowSpeedBonusFor(level: number): number {
  return Math.max(0, Math.floor(level) - 1) * PROGRESSION.arrowSpeedPerLevel;
}

/** Урон стрелы: 1.75 × физ. урон (СИЛ, как у всего физического оружия). Тир лука — отдельно. */
export function arrowDamageFor(level: number, a: AttrsIn): number {
  return 1.75 * physPower2(level, a);
}

/** Магзащита (МДР) — реэкспорт для удобства. */
export { magicResist2 as magicResistFor };

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
