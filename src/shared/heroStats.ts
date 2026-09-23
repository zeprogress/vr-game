import { AFFIX, BOW, SHIELD } from "./constants";
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

/**
 * Таблица понятных игроку характеристик героя: урон, скорость атаки, скорость
 * бега, шанс/сила крита, физ./маг. защита, блок щитом. Используется в панели
 * спектатора, чате (!stats) и веб-инвентаре (!inv) — единая формулировка
 * везде, чтобы зрителям и игрокам не приходилось гадать, что есть что.
 */
export function heroStatRows(p: HeroStatInput): HeroStatRow[] {
  const rows: HeroStatRow[] = [];
  const cls = p.rightCls as WeaponClass | "";
  const tier = (p.rightTier || "base") as WeaponTier;
  const tierMul = cls && cls !== "shield" ? weaponDef(cls, tier).mult : 1;
  const affixText = cls && p.rightCls === cls ? p.rightAffix : p.leftAffix;

  if (cls === "bow") {
    rows.push({ label: "Урон", value: weaponDamage("arrow", p.level, p.str, tierMul, p.agi).toFixed(1) });
  } else if (cls === "staff") {
    rows.push({ label: "Урон", value: fireboltDamage(p.level, p.int, 1).toFixed(1) });
  } else if (cls === "sword" || cls === "") {
    rows.push({ label: "Урон", value: weaponDamage("sword", p.level, p.str, tierMul, p.agi).toFixed(1) });
  }

  const atkSpeedBonus = affixNum(affixText, "скорость атаки") / 100;
  if (cls === "staff") {
    if (atkSpeedBonus > 0) {
      rows.push({ label: "Скорость атаки", value: `×${(1 + atkSpeedBonus).toFixed(2)}` });
    }
  } else {
    const spd = attackSpeedFor(p.level, p.agi) * (1 + atkSpeedBonus);
    rows.push({ label: "Скорость атаки", value: `×${spd.toFixed(2)}` });
  }

  rows.push({ label: "Скорость бега", value: `${moveSpeedFor(p.level, p.agi).toFixed(1)} м/с` });

  const critChanceBonus = affixNum(affixText, "шанс крита") / 100;
  const critMultBonus = affixNum(affixText, "силу крита");
  const critChance = (cls === "bow" ? BOW.critChance : 0) + critChanceBonus;
  if (critChance > 0) {
    rows.push({ label: "Шанс крита", value: `${Math.round(critChance * 100)}%` });
    rows.push({ label: "Сила крита", value: `×${(BOW.critMult + critMultBonus).toFixed(1)}` });
  }

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
