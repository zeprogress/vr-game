/**
 * Готовый урон умения для окон умений (ПК, телефон, VR, !inv) — те же формулы, что у сервера
 * (ZoneRoom.castSkill), от «силы удара» героя `strike` (skillStrike: для молота — магия от интеллекта; удары вихря — `phys`, от силы).
 * Числа — до брони и уязвимостей мобов, без случайных критов. null — у умения нет урона.
 */
import { ATTR2, attrOf } from "./attrs2";
import {
  ARROW_STORM, BARRIER_ARROW, BLAST_ARROW, CHAIN, FAN, HAMMER_FIELD, PLAGUE, SEAL, SKILLS2, SOUL_STEAL, SPEAR_FLURRY, SPEAR_RAIN,
  SWARM_ARROW, skillAttrMul, warriorWhirlHits, type ClassId, type SkillAttrs, type SkillId,
} from "./classes2";
import { SKILL } from "./constants";
import { assassinLeapDamage, chainHopDamage, chainHops, crushHealFrac, fanKnifeDamage, hammerWhirlHit, sealBoltDamage, sealBoltTicks, spearRainDamage, thunderSpinMul, warriorWhirlDamage } from "./skillMath";

const n = (v: number): string => String(Math.round(v));

/** Урон скачков цепи: первый, затем каждый × falloff. */
function hops(first: number, count: number, falloff: number): string {
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(n(chainHopDamage(first, i, falloff)));
  return out.join(" → ");
}

/** `phys` — сила физического удара молотом боевого мага (от СИЛ, PcInvData.strikePhys): удары «Громового вихря». */
export function skillDamageText(id: SkillId, cls: ClassId, strike: number, a: SkillAttrs, phys?: number): string | null {
  const sk = SKILLS2[id];
  const base = sk.dmgMult * strike;
  const int = Math.max(0, attrOf(a, "int") - ATTR2.start);
  switch (id) {
    case "stunBash":
      if (cls === "assassin") return `Урон ${n(assassinLeapDamage(strike))} (крит)`;
      if (cls === "battlemage") return `Урон ${n(base)} всем рядом; молнии по 3 мобам подальше — по ${n(base)}`;
      if (cls === "warrior") return `Урон ${n(base)} всем рядом, с шансом крита`;
      return `Урон ${n(base)} всем рядом`;
    case "arrowRain":
      if (cls === "archer") return `Урон ${n(strike)} за залп × ${SKILL.arrowRain.bowHits} залпа`;
      if (cls === "assassin") return `Урон ${n(fanKnifeDamage(strike))} за нож × ${FAN.volleys} веера + кровотечение`;
      if (cls === "spearman") return `Урон ${n(spearRainDamage(strike))} за копьё × ${SPEAR_RAIN.count}`;
      return `Урон ${n(base)} за волну × ${SKILL.arrowRain.hits} + горение`;
    case "crush":
      if (cls === "battlemage") {
        const heal = crushHealFrac(attrOf(a, "wis") - ATTR2.start);
        return `Урон ${n(base)} в круге; лечение ${Math.round(heal * 1000) / 10}% здоровья`;
      }
      return `Урон ${n(base)} в круге`;
    case "seal":
      if (cls === "battlemage") {
        const bolt = sealBoltDamage(strike);
        return `Урон ${n(bolt)} за молнию (каждые 0.5 с), до ${n(bolt * sealBoltTicks(HAMMER_FIELD.duration))} за поле`;
      }
      if (cls === "support") return `Лечение ${Math.round(SEAL.healFracPerSec * 1000) / 10}% здоровья в секунду`;
      return null;
    case "whirlwind":
      if (cls === "spearman") return `Урон ${n(SPEAR_FLURRY.dmg * strike)} за выпад × ${SPEAR_FLURRY.thrusts}`;
      if (cls === "battlemage") {
        const mul = thunderSpinMul(int);
        const whirl = phys !== undefined ? hammerWhirlHit(sk.dmgMult, phys) : sk.dmgMult * strike;
        return `Урон ${n(whirl)} за удар × ${sk.hits}; молния ${n(mul * strike)} (×${Math.round(mul * 100) / 100})`;
      }
      if (cls === "warrior") return `Урон ${n(warriorWhirlDamage(strike))} за удар × ${warriorWhirlHits(a)}+ (больше с роллом скорости и кличем), каждый — с шансом крита`;
      return `Урон ${n(base)} за удар × ${sk.hits}`;
    case "chain":
      if (cls === "support") return `Лечение по цепи: ${hops(strike * 2.2, 4, CHAIN.falloff)}`;
      return `Урон по скачкам: ${hops(base, chainHops(cls === "battlemage", sk.hits), CHAIN.falloff)}`;
    case "plague": {
      // База яда — атака кинжала (plagueAtk, сервер шлёт её в phys у ассасина), не сила удара.
      const k = skillAttrMul("plague", a);
      const atk = phys ?? strike;
      return `Яд ${n(atk * PLAGUE.tickFrac * k)} в секунду за стак, взрыв ${n(atk * SKILLS2.plague.dmgMult * k)}`;
    }
    case "soulSteal":
      return `Урон ${n(base)}; лечение ${n(base * SOUL_STEAL.transfer * skillAttrMul("soulSteal", a))}`;
    case "abyss":
      return `Удар из тени ${n(base * skillAttrMul("abyss", a))} (крит)`;
    case "lifeArrow":
    case "cleave":
      return `Урон ${n(base)}`;
    case "blastArrow":
      return `Урон ${n(base)} в цель, взрыв ${n(BLAST_ARROW.splash * strike)} вокруг`;
    case "arrowStorm":
      return `Урон ${n(base)} за волну × ${ARROW_STORM.waves} всем в ${ARROW_STORM.radius} м`;
    case "swarmArrow":
      return `Урон ${n(base)} за стрелу, ${SWARM_ARROW.volleys} × ${SWARM_ARROW.arrows} стрел, взрыв ${n(SWARM_ARROW.blast * strike)}`;
    case "barrierArrow":
      return `Урон ${n(base)} врагу в кольце (раз в ${BARRIER_ARROW.hitEvery} с)`;
    case "webArrow":
      return `Урон ${n(base)} в секунду в паутине`;
    case "ghostArrow":
      return null;
    default:
      return base > 0 ? `Урон ${n(base)}` : null;
  }
}
