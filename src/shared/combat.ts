import { ARROW, BOW, COMBAT, MELEE, SHIELD, THROW } from "./constants";

import { swordDamageFor } from "./progression";

/** Чем игрок ударил. Урон и досягаемость сервер берёт отсюда, а не с клиента. */
export type WeaponKind = "sword" | "fist" | "arrow" | "throw";

export function isWeaponKind(v: unknown): v is WeaponKind {
  return v === "sword" || v === "fist" || v === "arrow" || v === "throw";
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
};

/** Минимум секунд между засчитанными ударами одним видом оружия. */
export const WEAPON_RATE: Record<WeaponKind, number> = {
  sword: COMBAT.hitCooldown * 0.6, // мягче клиентского, чтобы лаг не съедал удары
  fist: MELEE.cooldown * 0.6,
  arrow: 0.12, // стрел в полёте может быть много
  throw: 0.25,
};

/**
 * Урон оружия. Меч растёт от силы, всё остальное фиксировано;
 * `mult` — множитель уровня предмета в руке (бронза, золото).
 */
export function weaponDamage(kind: WeaponKind, str: number, mult = 1): number {
  switch (kind) {
    case "sword":
      return swordDamageFor(str) * mult;
    case "fist":
      return MELEE.damage; // кулак не зависит от того, что в другой руке
    case "throw":
      return THROW.damage * mult;
    case "arrow":
      return 1 * mult;
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

/** Чем заблокировано: 0 — ничем, 1 — щитом, 2 — мечом. */
export type BlockedBy = 0 | 1 | 2;

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
): BlockResult {
  if (!g) return { mult: 1, by: 0 };

  if (g.sx !== 0 || g.sz !== 0) {
    if (g.sx * ax + g.sz * az > Math.cos(SHIELD.blockCone)) {
      return { mult: SHIELD.blockedDamage, by: 1 };
    }
  }

  if (g.wx !== 0 || g.wz !== 0) {
    const cone = projectile ? SHIELD.swordProjectileCone : SHIELD.swordBlockCone;
    if (g.wx * ax + g.wz * az > Math.cos(cone)) {
      return {
        mult: projectile ? SHIELD.blockedDamage : SHIELD.swordBlockedFraction,
        by: 2,
      };
    }
  }

  return { mult: 1, by: 0 };
}
