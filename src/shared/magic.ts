import { PROGRESSION } from "./constants";

/**
 * Магия (этап 14). Всё считает сервер: ману, кулдаун, урон, снаряд.
 *
 * Каст огненного снаряда посохом устроен как лук: держащей рукой посох,
 * второй — «тянешь» энергию от кристалла. Дальше руки от кристалла — быстрее
 * полетит; дольше держишь — больше заряд (сильнее урон и крупнее снаряд).
 * Пока копишь, мана убывает; кончилась — заряд замирает.
 */
export const MAGIC = {
  /** Мана: базовый запас + прибавка за очко интеллекта. */
  baseMana: 30,
  manaPerInt: 14,
  /** Восстановление маны в секунду: база + за интеллект. */
  regenBase: 3.5,
  regenPerInt: 0.8,

  firebolt: {
    /** Сколько маны стоит секунда накопления заряда. */
    manaPerSec: 16,
    /** Минимальный заряд (0..1), ниже которого выстрел не срабатывает. */
    minCharge: 0.16,
    /** Мана на минимальный заряд — без неё каст вообще не начинается. */
    minMana: 8,
    /** За сколько секунд заряд дошёл бы до максимума (при полной мане). */
    chargeTime: 1.6,
    /** Скорость снаряда по «натягу» второй руки (0..1 → м/с). */
    minSpeed: 12,
    maxSpeed: 34,
    /** Радиус снаряда по заряду, м. */
    minRadius: 0.12,
    maxRadius: 0.4,
    /** Урон: база + за заряд, плюс масштаб от интеллекта. */
    baseDamage: 1.5,
    damagePerCharge: 5.5,
    intScale: 0.06, // +6% урона за очко интеллекта сверх стартового
    /** Дальность полёта и жизнь снаряда. */
    range: 34,
    life: 2.2,
    /** Между кастами. */
    cooldown: 0.5,
  },
} as const;

export function maxManaFor(int: number): number {
  return MAGIC.baseMana + (int - PROGRESSION.startStat) * MAGIC.manaPerInt;
}

export function manaRegenFor(int: number): number {
  return MAGIC.regenBase + (int - PROGRESSION.startStat) * MAGIC.regenPerInt;
}

/** Урон огненного снаряда: заряд 0..1, интеллект. */
export function fireboltDamage(int: number, charge: number): number {
  const c = Math.max(0, Math.min(1, charge));
  const base = MAGIC.firebolt.baseDamage + c * MAGIC.firebolt.damagePerCharge;
  const scale = 1 + (int - PROGRESSION.startStat) * MAGIC.firebolt.intScale;
  return base * scale;
}

export function fireboltSpeed(pull01: number): number {
  const p = Math.max(0, Math.min(1, pull01));
  return MAGIC.firebolt.minSpeed + p * (MAGIC.firebolt.maxSpeed - MAGIC.firebolt.minSpeed);
}

export function fireboltRadius(charge: number): number {
  const c = Math.max(0, Math.min(1, charge));
  return MAGIC.firebolt.minRadius + c * (MAGIC.firebolt.maxRadius - MAGIC.firebolt.minRadius);
}
