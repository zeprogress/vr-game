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

export function maxHpFor(str: number): number {
  return PLAYER_HP.max + (str - PROGRESSION.startStat) * PROGRESSION.hpPerStr;
}

/** Урон мечом (базовый удар = 1). */
export function swordDamageFor(str: number): number {
  return 1 + (str - PROGRESSION.startStat) * PROGRESSION.swordDamagePerStr;
}

export function moveSpeedFor(agi: number): number {
  return PLAYER.runSpeed + (agi - PROGRESSION.startStat) * PROGRESSION.moveSpeedPerAgi;
}

/** Добавка к скорости стрелы, м/с. */
export function arrowSpeedBonusFor(agi: number): number {
  return (agi - PROGRESSION.startStat) * PROGRESSION.arrowSpeedPerAgi;
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
