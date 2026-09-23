import { AFFIX, BOW, SHIELD, SWORD_CRIT_MULT, STAFF_CRIT_MULT } from "./constants";
import { fireboltDamage } from "./magic";
import { armorFrac, attackSpeedFor, moveSpeedFor } from "./progression";
import { magicResistFrac } from "./magic";
import { weaponDamage } from "./combat";
import { weaponDef, type WeaponClass, type WeaponTier } from "./items";

/** Одна строка характеристик в таблице (спектатор / чат / веб-инвентарь). */
export interface HeroStatRow {
  label: string;
  value: string;
}

/** Минимальный набор полей, нужный для расчёта — общий для PlayerState и записи в PlayerStore. */
export interface HeroStatInput {
  level: number;
  str: number;
  agi: number;
  int: number;
  rightCls: string;
  rightTier: string;
  leftCls: string;
  leftTier: string;
  /** Текст ролла на оружии в руке — синкается как affixLabel(...), см. items.ts. */
  rightAffix?: string;
  leftAffix?: string;
}

/** Достаёт число из "+N% <label>" / "+N <label>" в тексте ролла (см. affixLabel в items.ts). */
function affixNum(text: string | undefined, label: string): number {
  if (!text) return 0;
  const m = text.match(new RegExp(`\\+([\\d.]+)%?\\s*${label}`));
  return m ? Number(m[1]) : 0;
}

const WEAPON_CLASSES: readonly WeaponClass[] = ["sword", "bow", "staff"];

/**
 * Таблица понятных игроку характеристик героя: урон, скорость атаки, скорость
 * бега, шанс/сила крита, физ./маг. защита, блок щитом. Используется в панели
 * спектатора, чате (!stats) и веб-инвентаре (!inv) — единая формулировка
 * везде, чтобы зрителям и игрокам не приходилось гадать, что есть что.
 *
 * Роллы щита в другой руке усиливают удар — сервер их суммирует с роллами
 * оружия (см. `rolledDmgMul`/`rolledAtkSpeedMul`/`rolledCrit` в ZoneRoom.ts),
 * поэтому здесь то же самое: берём текст роллов и с оружия, и со щита.
 */
export function heroStatRows(p: HeroStatInput): HeroStatRow[] {
  const rows: HeroStatRow[] = [];
  const rightIsWeapon = WEAPON_CLASSES.includes(p.rightCls as WeaponClass);
  const leftIsWeapon = WEAPON_CLASSES.includes(p.leftCls as WeaponClass);
  const cls = (rightIsWeapon ? p.rightCls : leftIsWeapon ? p.leftCls : "") as WeaponClass | "";
  const tier = (rightIsWeapon ? p.rightTier : leftIsWeapon ? p.leftTier : "base") as WeaponTier;
  const tierMul = cls ? weaponDef(cls, tier || "base").mult : 1;
  const weaponAffix = rightIsWeapon ? p.rightAffix : leftIsWeapon ? p.leftAffix : undefined;
  const shieldAffix = p.rightCls === "shield" ? p.rightAffix : p.leftCls === "shield" ? p.leftAffix : undefined;
  const affixNum2 = (label: string): number => affixNum(weaponAffix, label) + affixNum(shieldAffix, label);

  // dmgFlat и dmgPct делят один ярлык "урона" — на одном оружии не бывает
  // роллов сразу из двух (одно семейство даёт только один саб-ролл), поэтому
  // хватает одного поиска по тексту.
  const dmgBonus = affixNum2("урона") / 100;
  if (cls === "bow") {
    rows.push({
      label: "Урон",
      value: (weaponDamage("arrow", p.level, p.str, tierMul, p.agi) * (1 + dmgBonus)).toFixed(1),
    });
  } else if (cls === "staff") {
    rows.push({ label: "Урон", value: (fireboltDamage(p.level, p.int, 1) * (1 + dmgBonus)).toFixed(1) });
  } else {
    rows.push({
      label: "Урон",
      value: (weaponDamage("sword", p.level, p.str, tierMul, p.agi) * (1 + dmgBonus)).toFixed(1),
    });
  }

  const atkSpeedBonus = affixNum2("скорость атаки") / 100;
  if (cls === "staff") {
    if (atkSpeedBonus > 0) {
      rows.push({ label: "Скорость атаки", value: `×${(1 + atkSpeedBonus).toFixed(2)}` });
    }
  } else {
    const spd = attackSpeedFor(p.level, p.agi) * (1 + atkSpeedBonus);
    rows.push({ label: "Скорость атаки", value: `×${spd.toFixed(2)}` });
  }

  rows.push({ label: "Скорость бега", value: `${moveSpeedFor(p.level, p.agi).toFixed(1)} м/с` });

  const critChanceBonus = affixNum2("шанс крита") / 100;
  const critMultBonus = affixNum2("силу крита");
  const critChance = (cls === "bow" ? BOW.critChance : 0) + critChanceBonus;
  // Базовая сила крита — своя для каждого вида оружия (см. rollCritMult в
  // combat.ts): у лука BOW.critMult, у меча/кулака SWORD_CRIT_MULT, у посоха
  // STAFF_CRIT_MULT.
  const baseCritMult = cls === "bow" ? BOW.critMult : cls === "staff" ? STAFF_CRIT_MULT : SWORD_CRIT_MULT;
  // Показываем всегда (в т.ч. 0% у меча/посоха без ролла) — а не только при
  // ненулевом шансе: игроку/зрителю иначе непонятно, есть ли крит вообще.
  rows.push({ label: "Шанс крита", value: `${Math.round(critChance * 100)}%` });
  rows.push({ label: "Сила крита", value: `×${(baseCritMult + critMultBonus).toFixed(1)}` });

  const arm = armorFrac(p.str);
  if (arm >= 0.03) rows.push({ label: "Физ. защита", value: `${Math.round(arm * 100)}%` });
  const mres = magicResistFrac(p.int);
  if (mres >= 0.05) rows.push({ label: "Маг. защита", value: `${Math.round(mres * 100)}%` });

  const shieldTier = p.rightCls === "shield" ? p.rightTier : p.leftCls === "shield" ? p.leftTier : null;
  if (shieldTier) {
    const aegis = shieldTier === "legendary";
    const blocked = 1 - (aegis ? AFFIX.guard.blockedDamage : SHIELD.blockedDamage);
    rows.push({ label: "Блок щитом", value: `-${Math.round(blocked * 100)}% урона` });
  }

  return rows;
}

/** Та же таблица, но одной строкой через " · " — для мест без вёрстки (чат). */
export function heroStatLine(p: HeroStatInput): string {
  return heroStatRows(p)
    .map((r) => `${r.label.toLowerCase()} ${r.value}`)
    .join(" · ");
}
