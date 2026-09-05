import { PROGRESSION } from "./constants";
import { levelGain } from "./progression";

/**
 * Магия (этап 14). Всё считает сервер: ману, кулдаун, урон, снаряд.
 *
 * Каст огненного снаряда посохом устроен как лук: держащей рукой посох,
 * второй — «тянешь» энергию от кристалла. Дальше руки от кристалла — быстрее
 * полетит; дольше держишь — больше заряд (сильнее урон и крупнее снаряд).
 * Пока копишь, мана убывает; кончилась — заряд замирает.
 */
export const MAGIC = {
  /** Мана: базовый запас. Рост от уровня — в PROGRESSION.perLevel.mana, множитель от int. */
  baseMana: 30,
  /** Восстановление маны в секунду: база + за интеллект. */
  regenBase: 2.0,
  regenPerInt: 0.5,

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
    /** Урон: база + за заряд. Множится на magicPowerFor(level, int). */
    baseDamage: 1.0,
    damagePerCharge: 2.8,
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
    baseHeal: 5,
    healPerCharge: 20, // полный ≈ 25 HP на 1 ур. при интеллекте 1
    cooldown: 1.5,
    /** Кристалл ближе этого к голове (своей или союзника) — жест лечения. */
    reach: 0.5,
    /** Макс. дистанция каст→союзник, чтобы лечить его (проверяет сервер). */
    allyRange: 4,
  },
} as const;

/**
 * Множитель «силы магии»: базовый рост от УРОВНЯ (ускоряется) × небольшой
 * множитель от интеллекта. Множит урон огнешара и объём лечения.
 */
export function magicPowerFor(level: number, int: number): number {
  const lvl = 1 + levelGain(level, PROGRESSION.perLevel.magicDmg);
  const intMul = 1 + (int - PROGRESSION.startStat) * PROGRESSION.int.magicMul;
  return lvl * intMul;
}

/** Потолок маны: базовый запас растёт от уровня, интеллект множит. */
export function maxManaFor(level: number, int: number): number {
  const base = MAGIC.baseMana + levelGain(level, PROGRESSION.perLevel.mana);
  return base * (1 + (int - PROGRESSION.startStat) * PROGRESSION.int.manaMul);
}

export function manaRegenFor(int: number): number {
  return MAGIC.regenBase + (int - PROGRESSION.startStat) * MAGIC.regenPerInt;
}

/** Урон огненного снаряда: заряд 0..1, уровень, интеллект. */
export function fireboltDamage(level: number, int: number, charge: number): number {
  const c = Math.max(0, Math.min(1, charge));
  const base = MAGIC.firebolt.baseDamage + c * MAGIC.firebolt.damagePerCharge;
  return base * magicPowerFor(level, int);
}

/** Сколько HP вернёт лечение: заряд 0..1, уровень, интеллект. */
export function healAmountFor(level: number, int: number, charge: number): number {
  const c = Math.max(0, Math.min(1, charge));
  const base = MAGIC.heal.baseHeal + c * MAGIC.heal.healPerCharge;
  return base * magicPowerFor(level, int);
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
