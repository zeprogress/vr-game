import { AFFIX, PROGRESSION } from "./constants";
import { levelGain } from "./levelGain";
import { ATTR2, invested } from "./attrs2";

/**
 * Магия (этап 14). Всё считает сервер: ману, кулдаун, урон, снаряд.
 *
 * Каст огненного снаряда посохом устроен как лук: держащей рукой посох,
 * второй — «тянешь» энергию от кристалла. Дальше руки от кристалла — быстрее
 * полетит; дольше держишь — больше заряд (сильнее урон и крупнее снаряд).
 * Пока копишь, мана убывает; кончилась — заряд замирает.
 */
/**
 * Мана пока выключена: посохи ничего не тратят и полоски нет. Механику оставляем
 * в коде (константы, состояние) — вернём позже, когда решим, как её использовать.
 */
export const MANA_ENABLED = false;

export const MAGIC = {
  /** Мана: базовый запас. Рост от уровня — в PROGRESSION.perLevel.mana, множитель от int. */
  baseMana: 30,
  /** Восстановление маны в секунду: база + за интеллект. */
  regenBase: 2.0,
  regenPerInt: 0.5,

  firebolt: {
    /** Сколько маны стоит секунда накопления заряда. */
    manaPerSec: 0, // мана временно отключена (см. MANA_ENABLED) — раньше 16
    /** Минимальный заряд (0..1), ниже которого выстрел не срабатывает. */
    minCharge: 0.16,
    /** Мана на минимальный заряд — без неё каст вообще не начинается. */
    minMana: 0, // было 8
    /** За сколько секунд заряд дошёл бы до максимума (при полной мане). */
    chargeTime: 1.2, // было 1.95 — посох заряжается быстрее
    /** Скорость снаряда по «натягу» второй руки (0..1 → м/с). */
    minSpeed: 12,
    maxSpeed: 34,
    /** Радиус ВИЗУАЛА снаряда по заряду, м. При полном заряде — крупный шар. */
    minRadius: 0.12,
    maxRadius: 0.9, // было 0.62 — полностью заряженный шар крупнее
    /**
     * Урон: база + за заряд. Множится на magicPowerFor(level, int).
     * Поднят по просьбе (было 0.7/1.95, потом 0.8/2.2, 0.9/2.4, 1.0/2.65,
     * 1.15/2.95 — дальше ещё раз подняли примерно на 20%).
     */
    baseDamage: 1.4,
    damagePerCharge: 3.55,
    /**
     * Небольшой АОЕ в точке попадания: радиус растёт с зарядом, урон спадает
     * от эпицентра к краю. Прямая цель получает полный урон, соседи — долю.
     * Было 1.3..3.4 — расширили примерно на 15%.
     */
    splashMinRadius: 1.5,
    splashMaxRadius: 3.9,
    /** Доля прямого урона в эпицентре сплэша (на краю — ноль). */
    splashFraction: 0.5,
    /** Дальность полёта и жизнь снаряда. */
    range: 34,
    life: 2.2,
    /** Между кастами. */
    cooldown: 1.05,
  },

  /**
   * Лечение — небоевое. Подносишь кристалл к груди (жест: кристалл близко к
   * голове), держишь курок держащей рукой — копится, мана убывает. Отпустил —
   * мгновенное исцеление тем сильнее, чем дольше держал.
   */
  heal: {
    manaPerSec: 0, // было 16
    chargeTime: 1.5,
    minCharge: 0.15,
    minMana: 0, // было 8
    baseHeal: 5,
    healPerCharge: 20, // полный ≈ 25 HP на 1 ур. при интеллекте 1
    cooldown: 1.5,
    /** Кристалл ближе этого к голове (своей или союзника) — жест лечения. */
    reach: 0.5,
    /** Макс. дистанция каст→союзник, чтобы лечить его (проверяет сервер). */
    allyRange: 4,
    /** Массовое лечение игрока (посох над головой + курок): кулдаун, с. Время каста/радиус/доля — как у ботов (BOT.heal*). */
    massCooldown: 10,
  },
} as const;

/** Атрибуты, от которых считается магия (подходит PlayerState / сейв / Progress). */
export interface MagicAttrs {
  readonly int: number;
  readonly wis: number;
}

/**
 * Поджог огнешара: доля МАКС. HP цели в секунду — база AFFIX.fire.burnHpFrac,
 * растёт от ИНТ поджигающего так же, как урон магией.
 */
export function burnHpFracFor(a: Pick<MagicAttrs, "int">): number {
  return AFFIX.fire.burnHpFrac * (1 + invested(a.int) * ATTR2.int.magic);
}

/**
 * Множитель «силы магии»: рост от УРОВНЯ (ускоряется) × ИНТ. Множит урон
 * огнешара, магических умений и объём лечения.
 */
export function magicPowerFor(level: number, a: MagicAttrs): number {
  const lvl = 1 + levelGain(level, PROGRESSION.perLevel.magicDmg);
  return lvl * (1 + invested(a.int) * ATTR2.int.magic);
}

/** Потолок маны (мана пока выключена): уровень × ИНТ. */
export function maxManaFor(level: number, a: MagicAttrs): number {
  const base = MAGIC.baseMana + levelGain(level, PROGRESSION.perLevel.mana);
  return base * (1 + invested(a.int) * 0.05);
}

export function manaRegenFor(a: MagicAttrs): number {
  return MAGIC.regenBase + invested(a.int) * MAGIC.regenPerInt;
}

/** Доля магического урона (и снарядов магов), которую гасит МДР: max·n/(n+K). */
export function magicResistFrac(a: MagicAttrs): number {
  const n = invested(a.wis);
  return (ATTR2.wis.resistMax * n) / (n + ATTR2.wis.resistK);
}

/** Множитель лечения зельями: +2% за каждый подъём ИНТ (сила лечения — от интеллекта). */
export function potionPowerFor(a: MagicAttrs): number {
  return 1 + invested(a.int) * 0.02;
}

/** Урон огненного снаряда: заряд 0..1, уровень, интеллект. */
export function fireboltDamage(level: number, a: MagicAttrs, charge: number): number {
  const c = Math.max(0, Math.min(1, charge));
  const base = MAGIC.firebolt.baseDamage + c * MAGIC.firebolt.damagePerCharge;
  return base * magicPowerFor(level, a);
}

/** Сколько HP вернёт лечение: заряд 0..1, уровень, интеллект. */
export function healAmountFor(level: number, a: MagicAttrs, charge: number): number {
  const c = Math.max(0, Math.min(1, charge));
  const base = MAGIC.heal.baseHeal + c * MAGIC.heal.healPerCharge;
  return base * magicPowerFor(level, a);
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

/** Радиус АОЕ в точке попадания огнешара, м. Растёт с зарядом. */
export function fireboltSplashRadius(charge: number): number {
  const c = Math.max(0, Math.min(1, charge));
  const f = MAGIC.firebolt;
  return f.splashMinRadius + c * (f.splashMaxRadius - f.splashMinRadius);
}
