import { AFFIX, BOT, BOW, SHIELD, SWORD_CRIT_MULT, STAFF_CRIT_MULT } from "./constants";
import { fireboltDamage } from "./magic";
import { armorFrac, attackSpeedFor, castSpeedFor, dodgeChance, holdsOneItem, meleeSpeedFor, moveSpeedFor } from "./progression";
import { BASE_CRIT } from "./combat";
import { ATTR2, invested } from "./attrs2";
import { DAGGER, HAMMER, staffMagicTier, WEAPONS2, type AttrsIn } from "./classes2";
import { magicPowerFor, magicResistFrac } from "./magic";
import { weaponDamage } from "./combat";
import { weaponDef, type WeaponClass, type WeaponTier } from "./items";

/**
 * Сколько атак в секунду реально делает герой этим оружием — те же формулы,
 * что и бой: меч — приглушённый темп ближнего боя (meleeSpeedFor,
 * без своего потолка) от паузы BOT.attackCooldown; лук — полный темп (attackSpeedFor) от
 * BOT.bowCooldown; посох — это ОГНЕШАРЫ, не удары рукой: полный темп от
 * BOT.staffCooldown. `affixBonus` — ролл «скорость атаки» (0.12 = +12%).
 */
export function attacksPerSec(cls: string, level: number, a: AttrsIn, affixBonus = 0, dualDaggers = false): number {
  const mul = 1 + affixBonus;
  if (cls === "bow") return (attackSpeedFor(level, a) * mul) / BOT.bowCooldown;
  // Посох — огнешары: темп от скорости каста (МДР), не от ловкости.
  if (cls === "staff") return (castSpeedFor(level, a) * mul) / BOT.staffCooldown;
  // Кинжал/копьё/молот — своя пауза между ударами (два кинжала — руки по очереди).
  if (cls === "dagger" || cls === "spear" || cls === "hammer") {
    const dual = cls === "dagger" && dualDaggers ? DAGGER.dualTempo : 1;
    return (meleeSpeedFor(level, a) * mul * dual) / WEAPONS2[cls].interval;
  }
  return (meleeSpeedFor(level, a) * mul) / BOT.attackCooldown;
}

/** Подпись темпа — одна для всех классов (по заявке), значение — атак в секунду. */
export function attackRateLabel(_cls: string): string {
  return "Скорость атаки";
}

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
  con: number;
  luc: number;
  wis: number;
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

const WEAPON_CLASSES: readonly WeaponClass[] = ["sword", "bow", "staff", "dagger", "spear", "hammer"];

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
      value: (weaponDamage("arrow", p.level, p, tierMul) * (1 + dmgBonus)).toFixed(1),
    });
  } else if (cls === "staff") {
    rows.push({ label: "Урон", value: (fireboltDamage(p.level, p, 1) * staffMagicTier(tier) * (1 + dmgBonus)).toFixed(1) });
  } else if (cls === "dagger" || cls === "spear" || cls === "hammer") {
    const dual = cls === "dagger" && p.leftCls === "dagger" && p.rightCls === "dagger";
    rows.push({
      label: "Урон",
      value: (weaponDamage(cls, p.level, p, tierMul) * (dual ? DAGGER.dualDmg : 1) * (1 + dmgBonus)).toFixed(1),
    });
    if (cls === "hammer") {
      rows.push({ label: "Волна молота (магия)", value: (HAMMER.waveMagic * magicPowerFor(p.level, p) * tierMul).toFixed(1) });
    }
    if (cls === "spear") rows.push({ label: "Пробивает целей", value: String(WEAPONS2.spear.pierce) });
  } else {
    rows.push({
      label: "Урон",
      value: (weaponDamage("sword", p.level, p, tierMul) * (1 + dmgBonus)).toFixed(1),
    });
  }

  // Раньше тут был множитель «×2.65» по ОБЩЕЙ формуле — мечникам он завышал
  // темп почти вдвое (в бою у меча приглушённый meleeSpeedFor), а магам
  // вовсе не показывал рост от уровня. Теперь — реальные атаки в секунду.
  const atkSpeedBonus = affixNum2("скорость атаки") / 100;
  rows.push({
    label: attackRateLabel(cls),
    value: `${attacksPerSec(cls, p.level, p, atkSpeedBonus, p.leftCls === "dagger" && p.rightCls === "dagger").toFixed(2)}/с`,
  });

  rows.push({ label: "Скорость бега", value: `${moveSpeedFor(p.level, p).toFixed(1)} м/с` });

  // Уворот (см. ZoneRoom.ts hurtPlayer): свободная левая рука (щит/пусто у
  // меча) — обычный шанс; лук/посох занимают обе руки — вдвое подвижнее (×5
  // в формуле dodgeChance).
  const oneHanded = holdsOneItem(p.leftCls, p.rightCls);
  rows.push({ label: "Шанс уворота", value: `${Math.round(dodgeChance(p, oneHanded) * 100)}%` });

  const critChanceBonus = affixNum2("шанс крита") / 100;
  const critMultBonus = affixNum2("силу крита");
  const luckN = invested(p.luc);
  const newW = cls === "dagger" || cls === "spear" || cls === "hammer" ? WEAPONS2[cls] : null;
  const soloDagger = cls === "dagger" && (p.leftCls === "" || p.rightCls === "");
  const critChance = Math.min(
    0.75,
    (cls === "bow" ? BOW.critChance : newW ? newW.critBase : BASE_CRIT) + (soloDagger ? DAGGER.soloCrit : 0) + critChanceBonus + luckN * ATTR2.luc.crit,
  );
  // Базовая сила крита — своя для каждого вида оружия (см. rollCritMult в
  // combat.ts): у лука BOW.critMult, у меча/кулака SWORD_CRIT_MULT, у посоха
  // STAFF_CRIT_MULT.
  const baseCritMult =
    (cls === "bow" ? BOW.critMult : cls === "staff" ? STAFF_CRIT_MULT : newW ? newW.critMult : SWORD_CRIT_MULT) +
    (soloDagger ? DAGGER.soloCritDmg : 0);
  // Показываем всегда (в т.ч. 0% у меча/посоха без ролла) — а не только при
  // ненулевом шансе: игроку/зрителю иначе непонятно, есть ли крит вообще.
  rows.push({ label: "Шанс крита", value: `${Math.round(critChance * 100)}%` });
  rows.push({ label: "Сила крита", value: `×${(baseCritMult + critMultBonus + luckN * ATTR2.luc.critDmg).toFixed(2)}` });

  const arm = armorFrac(p);
  rows.push({ label: "Физ. защита", value: `${Math.round(arm * 100)}%` });
  const mres = magicResistFrac(p);
  rows.push({ label: "Маг. защита", value: `${Math.round(mres * 100)}%` });

  const shieldTier = p.rightCls === "shield" ? p.rightTier : p.leftCls === "shield" ? p.leftTier : null;
  if (shieldTier) {
    const aegis = shieldTier === "legendary";
    const chance = aegis ? AFFIX.guard.blockChance : SHIELD.blockChance;
    rows.push({ label: "Блок щитом", value: `${Math.round(chance * 100)}% шанс` });
  }

  return rows;
}

/** Та же таблица, но одной строкой через " · " — для мест без вёрстки (чат). */
export function heroStatLine(p: HeroStatInput): string {
  return heroStatRows(p)
    .map((r) => `${r.label.toLowerCase()} ${r.value}`)
    .join(" · ");
}
