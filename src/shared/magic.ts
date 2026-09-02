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
    /** Радиус ВИЗУАЛА снаряда по заряду, м. При полном заряде — крупный шар. */
    minRadius: 0.12,
    maxRadius: 0.62,
    /** Урон: база + за заряд, плюс масштаб от интеллекта. */
    baseDamage: 1.0,
    damagePerCharge: 2.8,
    intScale: 0.03, // +3% урона за очко интеллекта сверх стартового
    /** Дальность полёта и жизнь снаряда. */
    range: 34,
    life: 2.2,
    /** Между кастами. */
    cooldown: 0.9,
  },

  /**
   * Лечение — небоевое. Подносишь кристалл к груди (жест: кристалл близко к
   * голове), держишь курок держащей рукой — копится, мана убывает. Отпустил —
   * мгновенное исцеление тем сильнее, чем дольше держал.
   */
  heal: {
    manaPerSec: 16,
    chargeTime: 1.5,
    minCharge: 0.15,
    minMana: 8,
    baseHeal: 8,
    healPerCharge: 34, // полный ≈ 42 HP при интеллекте 1
    intScale: 0.04,
    cooldown: 1.5,
    /** Кристалл ближе этого к голове — жест считается лечением, не огнешаром. */
    reach: 0.5,
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

/** Сколько HP вернёт лечение: заряд 0..1, интеллект. */
export function healAmountFor(int: number, charge: number): number {
  const c = Math.max(0, Math.min(1, charge));
  const base = MAGIC.heal.baseHeal + c * MAGIC.heal.healPerCharge;
  const scale = 1 + (int - PROGRESSION.startStat) * MAGIC.heal.intScale;
  return base * scale;
}

export function fireboltSpeed(pull01: number): number {
  const p = Math.max(0, Math.min(1, pull01));
  return MAGIC.firebolt.minSpeed + p * (MAGIC.firebolt.maxSpeed - MAGIC.firebolt.minSpeed);
}

export function fireboltRadius(charge: number): number {
  const c = Math.max(0, Math.min(1, charge));
  // Растёт круче к максимуму: слабый каст — небольшой уголёк, полный — шар.
  const k = c * c * (3 - 2 * c); // smoothstep — резче тянет вверх у полного заряда
  return MAGIC.firebolt.minRadius + k * (MAGIC.firebolt.maxRadius - MAGIC.firebolt.minRadius);
}

/**
 * Радиус КОЛЛИЗИИ снаряда — заметно меньше визуала, чтобы приходилось целиться,
 * а не «кидать в сторону моба». Растёт с зарядом слабо.
 */
export function fireboltHitRadius(charge: number): number {
  const c = Math.max(0, Math.min(1, charge));
  return 0.12 + c * 0.18; // 0.12..0.30 м
}
