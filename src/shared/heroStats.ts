import { BOT, BOW, SHIELD, SWORD_CRIT_MULT, STAFF_CRIT_MULT } from "./constants";
import { fireboltDamage } from "./magic";
import { armorFrac, attackSpeedFor, castSpeedFor, dodgeChance, holdsOneItem, meleeSpeedFor, moveSpeedFor } from "./progression";
import { BASE_CRIT } from "./combat";
import { ATTR2, invested } from "./attrs2";
import { DAGGER, HAMMER, staffMagicTier, WEAPONS2, type AttrsIn } from "./classes2";
import { magicPowerFor, magicResistFrac } from "./magic";
import { weaponDamage } from "./combat";
import { critRollMult, isMeleeClass, shieldBlockChance, weaponDef, type WeaponClass, type WeaponTier } from "./items";

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

/** Все числа «<Название> +N%» в тексте роллов (см. affixLabel в items.ts), в долях. */
function affixVals(text: string | undefined, name: string): number[] {
  if (!text) return [];
  const out: number[] = [];
  for (const m of text.matchAll(new RegExp(`${name} \\+([\\d.]+)%`, "g"))) out.push(Number(m[1]) / 100);
  return out;
}
/** Сумма роллов вида `name` (в долях). */
function affixNum(text: string | undefined, name: string): number {
  return affixVals(text, name).reduce((a, b) => a + b, 0);
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
  // Вторая рука (щит, второй меч/кинжал) — её роллы складываются с роллами
  // оружия, как на сервере (rolledDmgMul/rolledCrit). Двуручное в обеих руках — один раз.
  const twoHand = p.leftCls === p.rightCls && (p.leftCls === "bow" || p.leftCls === "staff" || p.leftCls === "spear" || p.leftCls === "hammer");
  const otherAffix = twoHand ? undefined : rightIsWeapon ? p.leftAffix : leftIsWeapon ? p.rightAffix : undefined;
  const affixNum2 = (name: string): number => affixNum(weaponAffix, name) + affixNum(otherAffix, name);

  // Урон: и новый dmgFlat, и старый dmgPct подписаны «Урон +N%».
  const dmgBonus = affixNum2("Урон");
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
    if (cls === "spear") rows.push({ label: "Удар конусом", value: `до ${WEAPONS2.spear.pierce} целей` });
  } else {
    rows.push({
      label: "Урон",
      value: (weaponDamage("sword", p.level, p, tierMul) * (1 + dmgBonus)).toFixed(1),
    });
  }

  // Раньше тут был множитель «×2.65» по ОБЩЕЙ формуле — мечникам он завышал
  // темп почти вдвое (в бою у меча приглушённый meleeSpeedFor), а магам
  // вовсе не показывал рост от уровня. Теперь — реальные атаки в секунду.
  const atkSpeedBonus = affixNum2("Скорость атаки");
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

  // Ролл Крит даёт и шанс, и силу (сила растёт вместе с шансом, см. critRollMult).
  const critVals = [...affixVals(weaponAffix, "Крит"), ...affixVals(otherAffix, "Крит")];
  const critChanceBonus = critVals.reduce((a, b) => a + b, 0);
  const critMultBonus = critVals.reduce((a, v) => a + critRollMult(v), 0);
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

  // Вампиризм — только ролл на оружии ближнего боя (см. vampFrac в items.ts).
  // С обоих рук: два меча/кинжала — складывается (как heldVamp на сервере).
  const vamp =
    (isMeleeClass(p.rightCls) ? affixNum(p.rightAffix, "Вампиризм") : 0) +
    (isMeleeClass(p.leftCls) && !(p.leftCls === p.rightCls && (p.leftCls === "spear" || p.leftCls === "hammer")) ? affixNum(p.leftAffix, "Вампиризм") : 0);
  if (vamp > 0) rows.push({ label: "Вампиризм", value: `${Math.round(vamp * 1000) / 10}% урона в HP` });

  // Ролл щита гасит урон отдельным множителем сверх брони (см. ZoneRoom.hurtPlayer).
  const arm = 1 - (1 - armorFrac(p)) * (1 - affixNum(shieldAffix, "Физ. защита"));
  rows.push({ label: "Физ. защита", value: `${Math.round(arm * 100)}%` });
  const mres = 1 - (1 - magicResistFrac(p)) * (1 - affixNum(shieldAffix, "Маг. защита"));
  rows.push({ label: "Маг. защита", value: `${Math.round(mres * 100)}%` });

  const shieldTier = p.rightCls === "shield" ? p.rightTier : p.leftCls === "shield" ? p.leftTier : null;
  if (shieldTier) {
    const chance = shieldBlockChance(shieldTier) + affixNum(shieldAffix, "Блок");
    rows.push({ label: "Блок щитом", value: `${Math.round(chance * 100)}% шанс` });
    const refl = affixNum(shieldAffix, "Отражение");
    if (refl > 0) rows.push({ label: "Отражение щитом", value: `${Math.round(refl * 100)}% удара` });
    if (shieldAffix?.includes("Оплот")) rows.push({ label: "Оплот (Эгида)", value: `блок лечит ${Math.round(SHIELD.aegisHealFrac * 100)}% HP` });
  }

  return rows;
}

/** Та же таблица, но одной строкой через " · " — для мест без вёрстки (чат). */
export function heroStatLine(p: HeroStatInput): string {
  return heroStatRows(p)
    .map((r) => `${r.label.toLowerCase()} ${r.value}`)
    .join(" · ");
}
