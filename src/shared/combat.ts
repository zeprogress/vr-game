import { AFFIX, ARROW, BOW, COMBAT, MELEE, SHIELD, THROW } from "./constants";

import { arrowDamageFor, weaponDamageBase } from "./progression";
import { ATTR2, invested } from "./attrs2";
import { WEAPONS2, type AttrsIn } from "./classes2";

/** Чем игрок ударил. Урон и досягаемость сервер берёт отсюда, а не с клиента. */
export type WeaponKind = "sword" | "fist" | "arrow" | "throw" | "dagger" | "spear" | "hammer";

export function isWeaponKind(v: unknown): v is WeaponKind {
  return (
    v === "sword" || v === "fist" || v === "arrow" || v === "throw" ||
    v === "dagger" || v === "spear" || v === "hammer"
  );
}

/** Удар оружием ближнего боя «в руке» (не кулак, не стрела, не бросок). */
export function isBladeKind(k: WeaponKind): k is "sword" | "dagger" | "spear" | "hammer" {
  return k === "sword" || k === "dagger" || k === "spear" || k === "hammer";
}

/**
 * Максимум от глаз игрока до центра цели, при котором удар может быть честным.
 * С запасом на пинг: за 150 мс игрок пробегает ~0.8 м, и цель тоже двигается.
 */
export const WEAPON_REACH: Record<WeaponKind, number> = {
  // рука (~0.8) + клинок (~1.0) + радиус тела моба + запас
  sword: 3.6,
  // удар кулаком перед камерой (MELEE.flatReach 1.7) + запас
  fist: 2.8,
  // стрела летит через всю зону — проверять дистанцию бессмысленно,
  // ограничиваем баллистической дальностью (см. BOW.maxSpeed / ARROW).
  arrow: BOW.maxSpeed * ARROW.maxLife * 0.5,
  // брошенное оружие: THROW.flatMaxSpeed с гравитацией летит недалеко
  throw: 45,
  // «Классы 2.0»: кинжал короче меча, копьё — длинный выпад, молот чуть длиннее меча.
  dagger: 3.1,
  spear: 5.8,
  hammer: 4.0,
};

/** Минимум секунд между засчитанными ударами одним видом оружия. */
export const WEAPON_RATE: Record<WeaponKind, number> = {
  sword: COMBAT.hitCooldown * 0.85, // мягче клиентского, чтобы лаг не съедал удары
  fist: MELEE.cooldown * 0.6,
  arrow: 0.45, // серверный предел темпа стрельбы (клиент держит паузу сам)
  throw: 0.25,
  // Два кинжала бьют по очереди — предел мягкий (каждая рука — свой счёт на клиенте).
  dagger: COMBAT.hitCooldown * 0.5,
  spear: COMBAT.hitCooldown * 0.85,
  hammer: COMBAT.hitCooldown * 1.1,
};

/**
 * Крит. База — у оружия (лук BOW.critChance, остальное — BASE_CRIT), сверху
 * УДЧ героя (+шанс и +сила за каждый подъём) и роллы «крит» конкретного
 * инстанса (extraChance/extraMult). Бросок делает СЕРВЕР.
 * Возвращает множитель: 1 — обычный удар, иначе — сила крита.
 */
export const BASE_CRIT = 0.05;

export function rollCritMult(
  kind: WeaponKind,
  rnd: () => number = Math.random,
  /** Стрельба из «Лука охотника» (легендарка) — повышенный шанс крита. */
  hunterBow = false,
  extraChance = 0,
  extraMult = 0,
  /** Базовая кратность крита: у лука BOW.critMult, у меча — SWORD_CRIT_MULT, у посоха — STAFF_CRIT_MULT. */
  baseMult: number = BOW.critMult,
  /** Удача героя (УДЧ). */
  luc: number = ATTR2.start,
): number {
  const baseChance = kind === "arrow" ? BOW.critChance + (hunterBow ? AFFIX.crit.chanceBonus : 0) : BASE_CRIT;
  const n = invested(luc);
  const chance = Math.min(0.75, baseChance + extraChance + n * ATTR2.luc.crit);
  if (chance <= 0) return 1;
  return rnd() < chance ? baseMult + extraMult + n * ATTR2.luc.critDmg : 1;
}

/**
 * Урон оружия: физ. урон растёт от УРОВНЯ (ускоряется) и множится на СИЛ
 * (у всего физического оружия, включая стрелы); `mult` — тир предмета в руке.
 */
export function weaponDamage(kind: WeaponKind, level: number, a: AttrsIn, mult = 1): number {
  switch (kind) {
    case "sword":
      return weaponDamageBase(level, a) * mult;
    case "fist":
      return MELEE.damage * weaponDamageBase(level, a);
    case "throw":
      return THROW.damage * weaponDamageBase(level, a) * mult;
    case "arrow":
      return arrowDamageFor(level, a) * mult;
    case "dagger":
    case "spear":
    case "hammer":
      return WEAPONS2[kind].dmg * weaponDamageBase(level, a) * mult;
  }
}

// ---- защита ----

/**
 * Состояние защиты игрока — летит в move-пакете, чтобы блок считал сервер.
 * Все векторы горизонтальные и единичные; (0,0) — этого предмета нет в руках.
 */
export interface GuardState {
  /** Нормаль плоскости щита. */
  sx: number;
  sz: number;
  /** Направление от глаз к середине клинка. */
  wx: number;
  wz: number;
}

export function noGuard(): GuardState {
  return { sx: 0, sz: 0, wx: 0, wz: 0 };
}

/** Чем заблокировано: 0 — ничем, 1 — щитом, 2 — мечом, 3 — уворот (ловкость). */
export type BlockedBy = 0 | 1 | 2 | 3;

export interface BlockResult {
  /** Множитель урона: 0 — погашено полностью, 1 — прошло целиком. */
  mult: number;
  by: BlockedBy;
}

/**
 * Разбор блока. `ax`,`az` — единичное горизонтальное направление ОТ игрока
 * К источнику удара. `projectile` — плевок: меч отбивает его полностью.
 */
export function resolveBlock(
  g: GuardState | undefined,
  ax: number,
  az: number,
  projectile: boolean,
  /** Щит — легендарная «Эгида»: гасит больше и сектор шире. */
  aegis = false,
): BlockResult {
  if (!g) return { mult: 1, by: 0 };

  // Щит (2026-09-29): не «подставь и погаси половину», а шанс ПОЛНОСТЬЮ
  // заблокировать любой удар с любой стороны — как уворот. Одинаково в VR,
  // на телефоне и у ботов.
  if (g.sx !== 0 || g.sz !== 0) {
    if (Math.random() < (aegis ? AFFIX.guard.blockChance : SHIELD.blockChance)) return { mult: 0, by: 1 };
  }

  if (g.wx !== 0 || g.wz !== 0) {
    const cone = projectile ? SHIELD.swordProjectileCone : SHIELD.swordBlockCone;
    if (g.wx * ax + g.wz * az > Math.cos(cone)) {
      return {
        mult: projectile ? SHIELD.swordProjectileFraction : SHIELD.swordBlockedFraction,
        by: 2,
      };
    }
  }

  return { mult: 1, by: 0 };
}
