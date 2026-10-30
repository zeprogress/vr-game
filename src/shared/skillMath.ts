/**
 * Формулы урона умений, которые нужны ДВУМ сторонам: бою (ZoneRoom.castSkill) и окнам
 * умений (skillDamage — ПК, телефон, VR, !inv). Раньше каждая сторона считала их сама,
 * и правка баланса в одном месте не доезжала до другого: цифра в интерфейсе врала.
 *
 * Здесь только чистые функции — без PlayerState, Runtime и сети. Всё, что зависит от
 * героя (сила удара `strike`, «сила магии», физ. удар молотом `phys`), передаётся готовым.
 */
import { ASSASSIN_LEAP, CHAIN, CHAIN_HAMMER, FAN, HAMMER_FIELD, SPEAR_RAIN, STORM_CRUSH, THUNDER_SPIN, WEAPONS2, WHIRL } from "./classes2";

/** Лечение «Сокрушения бури» — доля макс. HP: база + за очко МУДРОСТИ сверх старта. */
export function crushHealFrac(wisInvested: number): number {
  return STORM_CRUSH.healBase + Math.max(0, wisInvested) * STORM_CRUSH.healPerWis;
}

/** Урон одной молнии «Грозового поля» (каждые 0.5 с) от силы удара героя. */
export function sealBoltDamage(strike: number): number {
  return HAMMER_FIELD.boltMul * strike;
}

/** Сколько раз молния бьёт за всё поле: раз в 0.5 с на длительность. */
export function sealBoltTicks(durationSec: number): number {
  return Math.round(durationSec / 0.5);
}

/** Множитель молнии «Громового вихря»: растёт с ИНТ от minMul до maxMul за intFull очков. */
export function thunderSpinMul(intInvested: number): number {
  const k = Math.min(1, Math.max(0, intInvested) / THUNDER_SPIN.intFull);
  return THUNDER_SPIN.minMul + (THUNDER_SPIN.maxMul - THUNDER_SPIN.minMul) * k;
}

/** Урон одного удара «Громового вихря» боевого мага: физика от СИЛЫ × hitMul × множитель умения. */
export function hammerWhirlHit(dmgMult: number, phys: number): number {
  return dmgMult * phys * THUNDER_SPIN.hitMul;
}

/** Урон k-го скачка цепи: первый — как есть, каждый следующий слабее на falloff. */
export function chainHopDamage(first: number, hop: number, falloff: number = CHAIN.falloff): number {
  return first * falloff ** hop;
}

/** Сколько скачков у цепи: у молота своё число (CHAIN_HAMMER.hops), у остальных — hits умения. */
export function chainHops(isBattlemage: boolean, hits: number): number {
  return isBattlemage ? CHAIN_HAMMER.hops : hits;
}

/** Копейщик «Ливень копий»: урон одного копья от силы удара героя. */
export function spearRainDamage(strike: number): number {
  return SPEAR_RAIN.dmg * strike;
}

/** Ассасин «Отскок с веером»: урон одного ножа. */
export function fanKnifeDamage(strike: number): number {
  return FAN.dmgMult * strike;
}

/** Ассасин «Смертельный прыжок»: удар с гарантированным критом кинжала. */
export function assassinLeapDamage(strike: number): number {
  return ASSASSIN_LEAP.dmg * strike * WEAPONS2.dagger.critMult;
}

/** Воин «Вихрь»: урон одного удара от силы удара героя. */
export function warriorWhirlDamage(strike: number): number {
  return WHIRL.warriorDmg * strike;
}
