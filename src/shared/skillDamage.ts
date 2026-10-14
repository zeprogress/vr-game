/**
 * Готовый урон умения для окон умений (ПК, телефон, VR, !inv) — те же формулы, что у сервера
 * (ZoneRoom.castSkill), от «силы удара» героя `strike` (skillStrike: для молота — от интеллекта).
 * Числа — до брони и уязвимостей мобов, без случайных критов. null — у умения нет урона.
 */
import { ATTR2, attrOf } from "./attrs2";
import {
  ASSASSIN_LEAP, CHAIN, CHAIN_HAMMER, FAN, HAMMER_FIELD, PLAGUE, SEAL, SKILLS2, SOUL_STEAL, SPEAR_FLURRY, STORM_CRUSH, THUNDER_SPIN,
  WEAPONS2, skillAttrMul, type ClassId, type SkillAttrs, type SkillId,
} from "./classes2";
import { SKILL } from "./constants";

const n = (v: number): string => String(Math.round(v));

/** Урон скачков цепи: первый, затем каждый × falloff. */
function hops(first: number, count: number, falloff: number): string {
  const out: string[] = [];
  let d = first;
  for (let i = 0; i < count; i++) {
    out.push(n(d));
    d *= falloff;
  }
  return out.join(" → ");
}

export function skillDamageText(id: SkillId, cls: ClassId, strike: number, a: SkillAttrs): string | null {
  const sk = SKILLS2[id];
  const base = sk.dmgMult * strike;
  const int = Math.max(0, attrOf(a, "int") - ATTR2.start);
  switch (id) {
    case "stunBash":
      if (cls === "assassin") return `Урон ${n(ASSASSIN_LEAP.dmg * strike * WEAPONS2.dagger.critMult)} (крит)`;
      if (cls === "battlemage") return `Урон ${n(base)} всем рядом; молнии по 3 мобам подальше — по ${n(base)}`;
      return `Урон ${n(base)} всем рядом`;
    case "arrowRain":
      if (cls === "archer") return `Урон ${n(strike)} за залп × ${SKILL.arrowRain.bowHits} залпа`;
      if (cls === "assassin") return `Урон ${n(FAN.dmgMult * strike)} за нож × ${FAN.volleys} веера + кровотечение`;
      if (cls === "spearman") return `Урон ${n(1.6 * strike)} за копьё × 3`;
      return `Урон ${n(base)} за волну × ${SKILL.arrowRain.hits} + горение`;
    case "crush":
      if (cls === "battlemage") {
        const heal = STORM_CRUSH.healBase + Math.max(0, attrOf(a, "wis") - ATTR2.start) * STORM_CRUSH.healPerWis;
        return `Урон ${n(base)} в круге; лечение ${Math.round(heal * 1000) / 10}% здоровья`;
      }
      return `Урон ${n(base)} в круге`;
    case "seal":
      if (cls === "battlemage") {
        const bolt = HAMMER_FIELD.boltMul * strike;
        return `Урон ${n(bolt)} за молнию (каждые 0.5 с), до ${n(bolt * HAMMER_FIELD.duration * 2)} за поле`;
      }
      if (cls === "support") return `Лечение ${Math.round(SEAL.healFracPerSec * 1000) / 10}% здоровья в секунду`;
      return null;
    case "whirlwind":
      if (cls === "spearman") return `Урон ${n(SPEAR_FLURRY.dmg * strike)} за выпад × ${SPEAR_FLURRY.thrusts}`;
      if (cls === "battlemage") {
        const mul = THUNDER_SPIN.minMul + (THUNDER_SPIN.maxMul - THUNDER_SPIN.minMul) * Math.min(1, int / THUNDER_SPIN.intFull);
        return `Урон ${n(base)} за удар × ${sk.hits}; молния ${n(mul * strike)} (×${Math.round(mul * 100) / 100})`;
      }
      return `Урон ${n(base)} за удар × ${sk.hits}`;
    case "chain":
      if (cls === "support") return `Лечение по цепи: ${hops(strike * 2.2, 4, CHAIN.falloff)}`;
      if (cls === "archer") return `Урон: ${n(2 * strike)} → ${hops(2 * strike * 0.35, 2, CHAIN.falloff)}`;
      if (cls === "battlemage") return `Урон по скачкам: ${hops(base, CHAIN_HAMMER.hops, CHAIN.falloff)}`;
      return `Урон по скачкам: ${hops(base, sk.hits, CHAIN.falloff)}`;
    case "plague": {
      const k = skillAttrMul("plague", a);
      return `Яд ${n(strike * PLAGUE.tickFrac * k)} в секунду за стак, взрыв ${n(base * k)}`;
    }
    case "soulSteal":
      return `Урон ${n(base)}; лечение ${n(base * SOUL_STEAL.transfer * skillAttrMul("soulSteal", a))}`;
    case "abyss":
      return `Удар из тени ${n(base * skillAttrMul("abyss", a))} (крит)`;
    case "lifeArrow":
    case "cleave":
      return `Урон ${n(base)}`;
    default:
      return base > 0 ? `Урон ${n(base)}` : null;
  }
}
