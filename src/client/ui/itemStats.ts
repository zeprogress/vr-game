import { weaponDef, type WeaponClass, type WeaponDef, type WeaponTier } from "#shared/items";
import { weaponDamage } from "#shared/combat";
import { attackSpeedFor } from "#shared/progression";
import { fireboltDamage } from "#shared/magic";
import { AFFIX, BOW, COMBAT, SHIELD } from "#shared/constants";

export interface WornWeapon {
  cls: WeaponClass;
  tier: WeaponTier;
}

/** Характеристики героя — от них считаем цифры оружия в подсказке. */
export interface HeroStats {
  level: number;
  str: number;
  agi: number;
  int: number;
}

const n1 = (v: number): string => (Math.round(v * 10) / 10).toFixed(1);

export const AFFIX_TEXT: Record<NonNullable<WeaponDef["affix"]>, string> = {
  fire: `Горение: ${AFFIX.fire.burnSec} с урона по времени`,
  crit: `Крит +${Math.round(AFFIX.crit.chanceBonus * 100)}%`,
  guard: `Блок ${Math.round((1 - AFFIX.guard.blockedDamage) * 100)}% · шире сектор`,
  storm: `АОЕ огнешара ×${AFFIX.storm.splashRadiusMul}`,
};

/**
 * Характеристики предмета в руке — строками «название: значение».
 * Считаем ровно теми же формулами, что и бой, чтобы цифра в подсказке
 * совпадала с уроном в игре. Общий код для плоского инвентаря и VR-панели.
 */
export function weaponStats(w: WornWeapon, s: HeroStats): [string, string][] {
  const d = weaponDef(w.cls, w.tier);
  const spd = attackSpeedFor(s.level, s.agi);
  const out: [string, string][] = [];

  if (w.cls === "sword") {
    const dmg = weaponDamage("sword", s.level, s.str, d.mult, s.agi);
    out.push(["Урон", n1(dmg)]);
    out.push(["Темп атаки", `×${n1(spd)}`]);
    out.push(["Урон в секунду", n1(dmg * spd)]);
    out.push([
      "По площади",
      `${COMBAT.swordSplashRadius} м · ${Math.round(COMBAT.swordSplashFraction * 100)}%`,
    ]);
    out.push(["Растёт от", "силы + ловкости"]);
  } else if (w.cls === "bow") {
    const dmg = weaponDamage("arrow", s.level, s.str, d.mult, s.agi);
    out.push(["Урон стрелы", n1(dmg)]);
    out.push(["Крит", `${Math.round(BOW.critChance * 100)}% · ×${BOW.critMult}`]);
    out.push(["Натяг", `${n1(BOW.drawTimeFlat / spd)} с`]);
    out.push(["Растёт от", "ловкости"]);
  } else if (w.cls === "staff") {
    out.push(["Магия (полный заряд)", n1(fireboltDamage(s.level, s.int, 1))]);
    out.push(["Удар посохом", n1(weaponDamage("sword", s.level, s.str, d.mult, s.agi))]);
    out.push(["Растёт от", "интеллекта (магия), силы+ловкости (удар)"]);
  } else {
    const blocked = d.affix === "guard" ? AFFIX.guard.blockedDamage : SHIELD.blockedDamage;
    const cone = SHIELD.blockCone + (d.affix === "guard" ? AFFIX.guard.coneBonus : 0);
    out.push(["Блок", `гасит ${Math.round((1 - blocked) * 100)}% урона`]);
    out.push(["Сектор", `±${Math.round((cone * 180) / Math.PI)}°`]);
  }
  if (d.affix) out.push(["Эффект", AFFIX_TEXT[d.affix]]);
  return out;
}
