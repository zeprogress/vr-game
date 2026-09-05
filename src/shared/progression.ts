import { PLAYER, PLAYER_HP, PROGRESSION } from "./constants";

export type StatName = "str" | "agi" | "int";

/** Прогресс игрока в «плоском» виде — так он летит по сети и лежит в сейве. */
export interface Progress {
  level: number;
  xp: number;
  unspent: number;
  str: number;
  agi: number;
  int: number;
}

export function blankProgress(): Progress {
  return {
    level: 1,
    xp: 0,
    unspent: 0,
    str: PROGRESSION.startStat,
    agi: PROGRESSION.startStat,
    int: PROGRESSION.startStat,
  };
}

/** Сколько опыта нужно для перехода с `level` на следующий (удваивается). */
export function xpToNext(level: number): number {
  if (level >= PROGRESSION.maxLevel) return Infinity;
  return PROGRESSION.baseXp * Math.pow(2, level - 1);
}

export function atMaxLevel(level: number): boolean {
  return level >= PROGRESSION.maxLevel;
}

// ---- производные величины ----
//
// Схема: базовое значение растёт ОТ УРОВНЯ (ускоряясь), атрибут — небольшой
// множитель поверх. str → HP и физ. урон, agi → бег, int → мана и магия.
// Скорость атаки растёт только от уровня.

const P = PROGRESSION.perLevel;

/** Накопленный рост к уровню: perLevel·L + accel·L·(L-1)/2, L = level-1. */
export function levelGain(level: number, curve: { perLevel: number; accel: number }): number {
  const L = Math.max(0, Math.floor(level) - 1);
  return curve.perLevel * L + (curve.accel * L * (L - 1)) / 2;
}

const strDmgMul = (str: number): number => 1 + (str - PROGRESSION.startStat) * PROGRESSION.str.dmgMul;

/** Базовый множитель физ. урона от уровня (без атрибута и тира оружия). */
export function weaponDmgFromLevel(level: number): number {
  return 1 + levelGain(level, P.weaponDmg);
}

/** Итоговый базовый множитель физ. урона: уровень × сила. Тир оружия — отдельно. */
export function weaponDamageBase(level: number, str: number): number {
  return weaponDmgFromLevel(level) * strDmgMul(str);
}

/** Множитель темпа атаки (>1 — быстрее). Только от уровня, с потолком. */
export function attackSpeedFromLevel(level: number): number {
  return Math.min(P.atkSpeed.max, 1 + levelGain(level, P.atkSpeed));
}

export function maxHpFor(level: number, str: number): number {
  const base = PLAYER_HP.max + levelGain(level, P.hp);
  return base * (1 + (str - PROGRESSION.startStat) * PROGRESSION.str.hpMul);
}

/** Урон мечом (базовый удар на 1 ур. при силе 1 = 1). Совместимость имени. */
export function swordDamageFor(level: number, str: number): number {
  return weaponDamageBase(level, str);
}

export function moveSpeedFor(level: number, agi: number): number {
  const base = PLAYER.runSpeed + levelGain(level, P.moveSpeed);
  return base * (1 + (agi - PROGRESSION.startStat) * PROGRESSION.agi.moveMul);
}

/** Добавка к скорости стрелы, м/с — небольшая, от уровня. */
export function arrowSpeedBonusFor(level: number): number {
  return Math.max(0, Math.floor(level) - 1) * PROGRESSION.arrowSpeedPerLevel;
}

/** Урон стрелы (относительно меча ×1.3). Тир оружия домножается отдельно. */
export function arrowDamageFor(level: number, str: number): number {
  return 1.3 * weaponDamageBase(level, str);
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
    p.unspent += PROGRESSION.statPointsPerLevel;
    gained++;
  }
  if (atMaxLevel(p.level)) p.xp = 0;
  return gained;
}

/** Потратить очко на характеристику. true — получилось. */
export function spendPoint(p: Progress, stat: StatName): boolean {
  if (p.unspent <= 0) return false;
  p.unspent--;
  p[stat]++;
  return true;
}

export function isStatName(v: unknown): v is StatName {
  return v === "str" || v === "agi" || v === "int";
}
