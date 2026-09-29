import { weaponDef, type WeaponClass, type WeaponDef, type WeaponTier } from "#shared/items";
import { weaponDamage } from "#shared/combat";
import { attackSpeedFor } from "#shared/progression";
import { attacksPerSec } from "#shared/heroStats";
import { fireboltDamage } from "#shared/magic";
import { AFFIX, BOW, COMBAT, SHIELD } from "#shared/constants";

export interface WornWeapon {
  cls: WeaponClass;
  tier: WeaponTier;
  /** Текст случайных роллов конкретного подобранного инстанса ("+12% урона, +6% крит"). */
  affix?: string;
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
  vamp: `Вампиризм: ${Math.round(AFFIX.vamp.healFrac * 100)}% урона — в HP`,
  crit: `Крит +${Math.round(AFFIX.crit.chanceBonus * 100)}%`,
  guard: `Шанс блока ${Math.round(AFFIX.guard.blockChance * 100)}%`,
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
    const aps = attacksPerSec("sword", s.level, s.agi);
    out.push(["Скорость атаки", `${aps.toFixed(2)}/с`]);
    out.push(["Урон в секунду", n1(dmg * aps)]);
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
    out.push(["Скорость атаки", `${attacksPerSec("bow", s.level, s.agi).toFixed(2)}/с`]);
    out.push(["Растёт от", "ловкости"]);
  } else if (w.cls === "staff") {
    out.push(["Огнешар (полный заряд)", n1(fireboltDamage(s.level, s.int, 1))]);
    out.push(["Скорость атаки", `${attacksPerSec("staff", s.level, s.agi).toFixed(2)}/с`]);
    out.push(["Растёт от", "интеллекта (сила магии), ловкости (темп)"]);
  } else {
    const chance = d.affix === "guard" ? AFFIX.guard.blockChance : SHIELD.blockChance;
    out.push(["Блок", `${Math.round(chance * 100)}% шанс погасить удар целиком`]);
  }
  if (d.affix) out.push(["Эффект", AFFIX_TEXT[d.affix]]);
  if (w.affix) out.push(["Роллы", w.affix]);
  return out;
}
