import { weaponDef, type WeaponClass, type WeaponTier } from "#shared/items";
import { weaponDamage } from "#shared/combat";
import { attackSpeedFor } from "#shared/progression";
import { attacksPerSec } from "#shared/heroStats";
import { fireboltDamage, magicPowerFor } from "#shared/magic";
import { DAGGER, HAMMER, staffMagicTier, WEAPONS2 } from "#shared/classes2";
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
}

const n1 = (v: number): string => (Math.round(v * 10) / 10).toFixed(1);

/**
 * Характеристики предмета в руке — строками «название: значение».
 * Считаем ровно теми же формулами, что и бой, чтобы цифра в подсказке
 * совпадала с уроном в игре. Общий код для плоского инвентаря и VR-панели.
 */
export function weaponStats(w: WornWeapon, s: HeroStats): [string, string][] {
  const d = weaponDef(w.cls, w.tier);
  const spd = attackSpeedFor(s.level, s);
  const out: [string, string][] = [];

  if (w.cls === "sword") {
    const dmg = weaponDamage("sword", s.level, s, d.mult);
    out.push(["Урон", n1(dmg)]);
    const aps = attacksPerSec("sword", s.level, s);
    out.push(["Скорость атаки", `${aps.toFixed(2)}/с`]);
    out.push(["Урон в секунду", n1(dmg * aps)]);
    out.push([
      "По площади",
      `${COMBAT.swordSplashRadius} м · ${Math.round(COMBAT.swordSplashFraction * 100)}%`,
    ]);
    out.push(["Растёт от", "силы (урон), ловкости (темп), удачи (крит)"]);
  } else if (w.cls === "dagger" || w.cls === "spear" || w.cls === "hammer") {
    const prof = WEAPONS2[w.cls];
    const dmg = weaponDamage(w.cls, s.level, s, d.mult);
    out.push(["Урон", n1(dmg)]);
    const aps = attacksPerSec(w.cls, s.level, s);
    out.push(["Скорость атаки", `${aps.toFixed(2)}/с`]);
    out.push(["Урон в секунду", n1(dmg * aps)]);
    out.push(["Крит (база)", `${Math.round(prof.critBase * 100)}% · ×${prof.critMult}`]);
    if (w.cls === "dagger") {
      out.push(["Один кинжал", `+${Math.round(DAGGER.soloCrit * 100)}% крита, +${DAGGER.soloCritDmg} к силе крита, уворот выше`]);
      out.push(["Два кинжала", `темп ×${DAGGER.dualTempo}, урон удара ×${DAGGER.dualDmg}`]);
    } else if (w.cls === "spear") {
      out.push(["Выпад", `до ${prof.reach} м, конусом перед собой — до ${prof.pierce} целей`]);
    } else {
      out.push(["Волна (магия)", `${n1(HAMMER.waveMagic * magicPowerFor(s.level, s) * d.mult)} по кругу ${HAMMER.waveRadius} м`]);
    }
    out.push(["Растёт от", w.cls === "hammer" ? "силы (удар), интеллекта (волна), ловкости (темп)" : "силы (урон), ловкости (темп), удачи (крит)"]);
  } else if (w.cls === "bow") {
    const dmg = weaponDamage("arrow", s.level, s, d.mult);
    out.push(["Урон стрелы", n1(dmg)]);
    out.push(["Крит (база)", `${Math.round(BOW.critChance * 100)}% · ×${BOW.critMult}`]);
    out.push(["Натяг", `${n1(BOW.drawTimeFlat / spd)} с`]);
    out.push(["Скорость атаки", `${attacksPerSec("bow", s.level, s).toFixed(2)}/с`]);
    out.push(["Растёт от", "силы (урон), ловкости (темп), удачи (крит)"]);
  } else if (w.cls === "staff") {
    out.push(["Огнешар (полный заряд)", n1(fireboltDamage(s.level, s, 1) * staffMagicTier(w.tier))]);
    out.push(["Скорость атаки", `${attacksPerSec("staff", s.level, s).toFixed(2)}/с`]);
    out.push(["Растёт от", "интеллекта (урон и лечение), мудрости (скорость каста)"]);
  } else {
    // Блок, защита и отражение щита — только роллы: они в строке «Роллы» ниже, отдельно не дублируем.
    out.push(["Щит", "блок, защита, отражение и регенерация — от роллов"]);
  }
  // Свойство Эгиды идёт в тексте первым («Оплот: …») — отдельной строкой, не роллом.
  const parts = (w.affix ?? "").split(", ").filter(Boolean);
  const aegis = parts.find((t) => t.startsWith("Оплот"));
  if (aegis) out.push(["Оплот", aegis.replace(/^Оплот:\s*/, "")]);
  const rolls = parts.filter((t) => t !== aegis).join(", ");
  if (rolls) out.push(["Роллы", rolls]);
  return out;
}
