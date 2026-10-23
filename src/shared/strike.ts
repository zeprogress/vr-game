import { HAMMER_SKILL, staffMagicTier, type Attr, type AttrsIn, type ClassId } from "./classes2";
import { weaponDamage } from "./combat";
import { fireboltDamage, magicLevelFor } from "./magic";
import { attrOf, invested } from "./attrs2";
import type { WeaponClass } from "./items";

/** Все шесть атрибутов героя и прибавка от колец и камней (PlayerState.gb). */
export type StrikeAttrs = AttrsIn & { gb?: Partial<Record<Attr, number>> };

/** Оружие в руке, которым бьёт умение: множитель вида/тира, тир (для посоха) и роллы урона (как на сервере). */
export interface StrikeHand {
  /** weaponDef(cls, tier).mult — 1, если руки пустые. */
  mult: number;
  tier: string;
  /** 1 + роллы Урон (лучший из двух рук, см. handsRoll). */
  roll: number;
}

/** Рука, которой бьёт умение класса: посох, молот, лук или бьющее оружие (кинжал, копьё, меч). */
export function strikeKindOf(cls: ClassId): WeaponClass {
  if (cls === "support") return "staff";
  if (cls === "battlemage") return "hammer";
  if (cls === "archer") return "bow";
  if (cls === "assassin") return "dagger";
  if (cls === "spearman") return "spear";
  return "sword";
}

/**
 * Сила удара, на которую умения класса множат свой dmgMult (до бафов и до особых формул умения).
 * Та же формула, что у сервера в skillPower: маг — магия, лук/меч/кинжал/копьё — физика.
 * `a` — атрибуты героя с кольцами и камнями (gb), как PlayerState.
 */
/**
 * Физический удар молотом боевого мага («Громовой вихрь»): как у воина — от уровня и СИЛ (weaponDamage), а не от
 * интеллекта. Магия молота (волна бури, молнии, метеорит) — skillStrike, от ИНТ.
 */
export function hammerPhysStrike(level: number, a: StrikeAttrs, hand: StrikeHand): number {
  return weaponDamage("hammer", level, a, hand.mult * hand.roll);
}

export function skillStrike(cls: ClassId, level: number, a: StrikeAttrs, hand: StrikeHand): { dmg: number; magic: boolean } {
  switch (cls) {
    case "support":
      return { dmg: fireboltDamage(level, a, 0.7) * staffMagicTier(hand.tier) * hand.roll * 0.5, magic: true };
    case "battlemage":
      // Умения молота: урон от ИНТЕЛЛЕКТА (HAMMER_SKILL.intPer за очко сверх старта), уровень — как у магии.
      return { dmg: 1.9 * magicLevelFor(level) * (1 + invested(attrOf(a, "int")) * HAMMER_SKILL.intPer) * hand.mult * hand.roll, magic: true };
    case "archer":
      return { dmg: weaponDamage("arrow", level, a, hand.mult * hand.roll), magic: false };
    default:
      return { dmg: weaponDamage(strikeKindOf(cls) as "sword" | "dagger" | "spear", level, a, hand.mult * hand.roll), magic: false };
  }
}
