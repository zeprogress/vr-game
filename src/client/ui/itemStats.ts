import { craftPctOfText, fmtPct, powerMulOfText, sharpPctOfText, weaponDef, type WeaponClass, type WeaponTier } from "#shared/items";
import { attackSpeedFor } from "#shared/progression";
import { attacksPerSec, dmgRollOfText, sharpAttackAdd, weaponHitDamage } from "#shared/heroStats";
import { magicPowerFor } from "#shared/magic";
import { DAGGER, DUAL, HAMMER, WEAPONS2 } from "#shared/classes2";
import { BOW, COMBAT } from "#shared/constants";

export interface WornWeapon {
  cls: WeaponClass;
  tier: WeaponTier;
  /** Текст роллов конкретного экземпляра («Урон +12%, Крит +6%»). */
  affix?: string;
}

/** Характеристики героя — от них считаем цифры оружия в подсказке. */
export interface HeroStats {
  level: number;
  str: number;
  agi: number;
  int: number;
  con: number;
  luc: number;
  wis: number;
  /** Прибавка от камней в кольцах (attrOf складывает её с атрибутом). */
  gb?: Partial<Record<"str" | "agi" | "int" | "con" | "luc" | "wis", number>>;
}

const n1 = (v: number): string => (Math.round(v * 10) / 10).toFixed(1);

/** Урон удара оружием в руке у героя — та же формула, что строка «Урон» в характеристиках (heroStats.weaponHitDamage), с роллом «Урон». */
export function heldAttack(w: WornWeapon, s: HeroStats): number {
  return weaponHitDamage(w.cls, w.tier, s.level, s, dmgRollOfText(w.affix));
}

/**
 * Характеристики предмета в руке — строками «название: значение».
 * Считаем ровно теми же формулами, что и бой, чтобы цифра в подсказке
 * совпадала с уроном в игре. Общий код для плоского инвентаря и VR-панели.
 */
export function weaponStats(w: WornWeapon, s: HeroStats): [string, string][] {
  const d = weaponDef(w.cls, w.tier);
  const spd = attackSpeedFor(s.level, s);
  const out: [string, string][] = [];
  // Точка атаки за лом и «Мастерство» крафта: удар сильнее на их прибавку — та же формула, что в бою (heroStats).
  const sharp = sharpPctOfText(w.affix);
  const craft = craftPctOfText(w.affix);
  const pow = powerMulOfText(w.affix);
  const hit = (): number => heldAttack(w, s) * pow;

  if (w.cls === "sword") {
    const dmg = hit();
    out.push(["Урон", n1(dmg)]);
    const aps = attacksPerSec("sword", s.level, s);
    out.push(["Скорость атаки", `${aps.toFixed(2)}/с`]);
    out.push(["Урон в секунду", n1(dmg * aps)]);
    out.push([
      "По площади",
      `${COMBAT.swordSplashRadius} м · ${Math.round(COMBAT.swordSplashFraction * 100)}%`,
    ]);
    out.push(["Растёт от", "силы (урон), ловкости (темп), удачи (крит)"]);
    out.push(["Два меча", `темп ×${DUAL.tempo}, урон удара ×${DUAL.dmg} (роллы — лучший из двух)`]);
  } else if (w.cls === "dagger" || w.cls === "spear" || w.cls === "hammer") {
    const prof = WEAPONS2[w.cls];
    const dmg = hit();
    out.push(["Урон", n1(dmg)]);
    const aps = attacksPerSec(w.cls, s.level, s);
    out.push(["Скорость атаки", `${aps.toFixed(2)}/с`]);
    out.push(["Урон в секунду", n1(dmg * aps)]);
    out.push(["Крит (база)", `${Math.round(prof.critBase * 100)}% · ×${prof.critMult}`]);
    if (w.cls === "dagger") {
      out.push(["Один кинжал", `+${Math.round(DAGGER.soloCrit * 100)}% крита, +${DAGGER.soloCritDmg} к силе крита, уворот выше`]);
      out.push(["Два кинжала", `темп ×${DUAL.tempo}, урон удара ×${DUAL.dmg}`]);
    } else if (w.cls === "spear") {
      out.push(["Выпад", `до ${prof.reach} м, конусом перед собой — до ${prof.pierce} целей`]);
    } else {
      out.push(["Волна (магия)", `${n1(HAMMER.waveMagic * magicPowerFor(s.level, s) * d.mult)} по кругу ${HAMMER.waveRadius} м`]);
    }
    out.push(["Растёт от", w.cls === "hammer" ? "силы (удар), интеллекта (волна), ловкости (темп)" : "силы (урон), ловкости (темп), удачи (крит)"]);
  } else if (w.cls === "bow") {
    out.push(["Урон стрелы", n1(hit())]);
    out.push(["Крит (база)", `${Math.round(BOW.critChance * 100)}% · ×${BOW.critMult}`]);
    out.push(["Натяг", `${n1(BOW.drawTimeFlat / spd)} с`]);
    out.push(["Скорость атаки", `${attacksPerSec("bow", s.level, s).toFixed(2)}/с`]);
    out.push(["Растёт от", "силы (урон), ловкости (темп), удачи (крит)"]);
  } else if (w.cls === "staff") {
    out.push(["Огнешар (полный заряд)", n1(hit())]);
    out.push(["Скорость атаки", `${attacksPerSec("staff", s.level, s).toFixed(2)}/с`]);
    out.push(["Растёт от", "интеллекта (урон и лечение), мудрости (скорость каста)"]);
  } else {
    // Блок, защита и отражение щита — только роллы: они в строке «Роллы» ниже, отдельно не дублируем.
    out.push(["Щит", "блок, защита, отражение и регенерация — от роллов"]);
  }
  // Точка атаки — сразу за ударом: прибавка в процентах и в «Атаке» (та же прибавка, что в подписи на складе).
  if (sharp > 0) out.splice(1, 0, ["Точка атаки", `+${fmtPct(sharp)}% · +${sharpAttackAdd(w.cls, w.tier, sharp, craft).toFixed(1)} к атаке`]);
  if (craft > 0) out.splice(1, 0, ["Мастерство", `+${fmtPct(craft)}% к урону`]);
  // Свойство Эгиды идёт в тексте первым («Оплот: …») — отдельной строкой, не роллом.
  const parts = (w.affix ?? "").split(", ").filter(Boolean);
  const aegis = parts.find((t) => t.startsWith("Оплот"));
  if (aegis) out.push(["Оплот", aegis.replace(/^Оплот:\s*/, "")]);
  const rolls = parts.filter((t) => t !== aegis && !t.startsWith("Точка атаки")).join(", ");
  if (rolls) out.push(["Роллы", rolls]);
  return out;
}
