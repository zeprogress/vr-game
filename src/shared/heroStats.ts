import { BOW, CAMPFIRE, EVENT, PLAYER_HP, SHIELD, SWORD_CRIT_MULT, STAFF_CRIT_MULT } from "./constants";
import { SCROLL } from "./shop";
import { fireboltDamage } from "./magic";
import { armorFrac, dodgeChance, heroAttackInterval, holdsOneItem, hpRegenFrac, maxHpFor, moveSpeedFor, staffCastInterval } from "./progression";
import { BASE_CRIT } from "./combat";
import { ATTR2, invested } from "./attrs2";
import { DAGGER, DUAL, HAMMER, isDualPair, SMOKE, staffMagicTier, WARCRY, WEAPONS2, type AttrsIn } from "./classes2";
import { magicPowerFor, magicResistFrac } from "./magic";
import { weaponDamage } from "./combat";
import { affixSum, critRollMult, isMeleeClass, shieldBlockChance, weaponDef, type WeaponClass, type WeaponInstance, type WeaponTier } from "./items";

/**
 * Сколько атак в секунду реально делает герой этим оружием — та же пауза, что в бою у всех
 * (heroAttackInterval: ПК, телефон, VR, боты); посох — огнешары (staffCastInterval, МДР).
 * `affixBonus` — ролл «скорость атаки» (0.12 = +12%).
 */
export function attacksPerSec(cls: string, level: number, a: AttrsIn, affixBonus = 0, dualPair = false): number {
  const mul = 1 + affixBonus;
  if (cls === "staff") return 1 / staffCastInterval(level, a, mul);
  const w = cls === "bow" || cls === "dagger" || cls === "spear" || cls === "hammer" ? cls : "sword";
  return 1 / heroAttackInterval(w, level, a, mul, dualPair);
}

/**
 * Урон одного удара / выстрела / огнешара оружием класса `cls` тира `tier` у героя (уровень и
 * атрибуты), `dmgBonus` — ролл «Урон» (0.12 = +12%); без баффов и без поправки на пару клинков.
 * Щит не атакует — 0. Одна формула для строки «Урон» в характеристиках и силы атаки у оружия.
 */
export function weaponHitDamage(cls: string, tier: string, level: number, a: AttrsIn, dmgBonus = 0): number {
  const t = (tier || "base") as WeaponTier;
  const mul = 1 + dmgBonus;
  switch (cls) {
    case "bow":
      return weaponDamage("arrow", level, a, weaponDef("bow", t).mult) * mul;
    case "staff":
      return fireboltDamage(level, a, 1) * staffMagicTier(t) * mul;
    case "sword":
    case "dagger":
    case "spear":
    case "hammer":
      return weaponDamage(cls, level, a, weaponDef(cls, t).mult) * mul;
    default:
      return 0;
  }
}

/**
 * Сила атаки экземпляра оружия у героя — урон удара с его собственным роллом «Урон»
 * (см. weaponHitDamage). Показывается у каждого оружия: ПК, телефон, VR и страница !inv.
 */
export function weaponAttack(w: Pick<WeaponInstance, "cls" | "tier" | "affixes">, level: number, a: AttrsIn): number {
  return weaponHitDamage(w.cls, w.tier, level, a, affixSum(w.affixes, "dmgFlat") + affixSum(w.affixes, "dmgPct"));
}

/** Ролл «Урон» (в долях) из текста роллов предмета в руке («Урон +12%, Крит +6%»). */
export function dmgRollOfText(text: string | undefined): number {
  return affixNum(text, "Урон");
}

/** Число силы атаки для показа: целое (меньше 100 — с десятыми). */
export function attackText(atk: number): string {
  return atk >= 100 ? String(Math.round(atk)) : (Math.round(atk * 10) / 10).toString();
}

/** Подпись «Атака 123»; щит (и неизвестно) — пусто. */
export function attackLabel(atk: number | undefined): string {
  return atk && atk > 0 ? `Атака ${attackText(atk)}` : "";
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
  /**
   * Активные баффы (секунд осталось) — те же поля, что в PlayerState: таблица
   * показывает цифры С баффами, как они сейчас работают в бою. Нет полей — без баффов.
   */
  buffSecs?: number;
  crySecs?: number;
  cryKind?: number;
  campBuffSecs?: number;
  scrollWindSecs?: number;
  smokeSecs?: number;
  towerFloor?: number;
}

/** Множители от активных баффов (как в бою на сервере: buffMult, cryTempo, hurtPlayer). */
function buffMuls(p: HeroStatInput): { dmg: number; tempo: number; move: number; dodge: number; def: number; any: boolean } {
  const on = (s: number | undefined): boolean => (p.towerFloor ?? 0) <= 0 && (s ?? 0) > 0;
  const cry = on(p.crySecs) ? p.cryKind ?? 0 : 0;
  const dmg = (on(p.buffSecs) ? EVENT.invasion.buffDmgMult : 1) * (cry === 1 || cry === 3 ? 1 + WARCRY.dmg : 1);
  const tempo = cry === 2 ? 1 + WARCRY.rallyTempo : cry === 1 || cry === 3 ? 1 + WARCRY.tempo : 1;
  const move = on(p.scrollWindSecs) ? SCROLL.windMul : 1;
  const dodge = on(p.smokeSecs) ? SMOKE.dodge : 0;
  // Доля урона, которую баффы снимают сверх брони: костёр, «Благословение».
  const def = 1 - (on(p.campBuffSecs) ? 1 - CAMPFIRE.buffDef : 1) * (cry === 3 ? 1 - WARCRY.blessDef : 1);
  return { dmg, tempo, move, dodge, def, any: dmg !== 1 || tempo !== 1 || move !== 1 || dodge > 0 || def > 0 };
}
/** Пометка у значения, которое сейчас поднято баффом. */
const UP = " ▲";

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
 * Роллы предмета в другой руке (щит, второй клинок) тоже идут в удар — от
 * каждого вида лучший из двух (см. `rolledDmgMul`/`rolledAtkSpeedMul`/`rolledCrit`
 * в ZoneRoom.ts), поэтому здесь то же самое: берём текст роллов с обоих.
 */
export function heroStatRows(p: HeroStatInput): HeroStatRow[] {
  const rows: HeroStatRow[] = [];
  const bm = buffMuls(p);
  const rightIsWeapon = WEAPON_CLASSES.includes(p.rightCls as WeaponClass);
  const leftIsWeapon = WEAPON_CLASSES.includes(p.leftCls as WeaponClass);
  const cls = (rightIsWeapon ? p.rightCls : leftIsWeapon ? p.leftCls : "") as WeaponClass | "";
  const tier = (rightIsWeapon ? p.rightTier : leftIsWeapon ? p.leftTier : "base") as WeaponTier;
  const tierMul = cls ? weaponDef(cls, tier || "base").mult : 1;
  const weaponAffix = rightIsWeapon ? p.rightAffix : leftIsWeapon ? p.leftAffix : undefined;
  const shieldAffix = p.rightCls === "shield" ? p.rightAffix : p.leftCls === "shield" ? p.leftAffix : undefined;
  // Вторая рука (щит, второй меч/кинжал) — от каждого вида роллов берётся лучший
  // из двух предметов, как на сервере (handsRoll/handsCrit). Двуручное в обеих руках — один раз.
  const twoHand = p.leftCls === p.rightCls && (p.leftCls === "bow" || p.leftCls === "staff" || p.leftCls === "spear" || p.leftCls === "hammer");
  const otherAffix = twoHand ? undefined : rightIsWeapon ? p.leftAffix : leftIsWeapon ? p.rightAffix : undefined;
  const affixNum2 = (name: string): number => Math.max(affixNum(weaponAffix, name), affixNum(otherAffix, name));

  // Урон: и новый dmgFlat, и старый dmgPct подписаны «Урон +N%».
  const dmgBonus = affixNum2("Урон");
  // Удар — та же формула, что «Атака» у оружия (weaponHitDamage); без оружия — как меч базового тира.
  const dual = isDualPair(p.leftCls, p.rightCls) ? DUAL.dmg : 1;
  const hit = weaponHitDamage(cls || "sword", tier, p.level, p, dmgBonus) * dual * bm.dmg;
  rows.push({ label: "Урон", value: hit.toFixed(1) + (bm.dmg > 1 ? UP : "") });
  if (cls === "hammer") {
    rows.push({ label: "Волна молота (магия)", value: (HAMMER.waveMagic * magicPowerFor(p.level, p) * tierMul).toFixed(1) });
  }
  if (cls === "spear") rows.push({ label: "Удар конусом", value: `до ${WEAPONS2.spear.pierce} целей` });

  // Раньше тут был множитель «×2.65» по ОБЩЕЙ формуле — мечникам он завышал
  // темп почти вдвое (в бою у меча приглушённый meleeSpeedFor), а магам
  // вовсе не показывал рост от уровня. Теперь — реальные атаки в секунду.
  const atkSpeedBonus = affixNum2("Скорость атаки");
  rows.push({
    label: attackRateLabel(cls),
    value: `${(attacksPerSec(cls, p.level, p, atkSpeedBonus, isDualPair(p.leftCls, p.rightCls)) * bm.tempo).toFixed(2)}/с${bm.tempo > 1 ? UP : ""}`,
  });

  rows.push({ label: "Скорость бега", value: `${(moveSpeedFor(p.level, p) * bm.move).toFixed(1)} м/с${bm.move > 1 ? UP : ""}` });

  // Уворот (см. ZoneRoom.ts hurtPlayer): свободная левая рука (щит/пусто у
  // меча) — обычный шанс; лук/посох занимают обе руки — вдвое подвижнее (×5
  // в формуле dodgeChance).
  const oneHanded = holdsOneItem(p.leftCls, p.rightCls);
  // «Пелена смерти» прибавляет уворот СВЕРХ потолка (см. hurtPlayer) — показываем так же.
  rows.push({
    label: "Шанс уворота",
    value: `${Math.round((dodgeChance(p, oneHanded, p.leftCls === "dagger" || p.rightCls === "dagger") + bm.dodge) * 100)}%${bm.dodge > 0 ? UP : ""}`,
  });

  // Ролл Крит даёт и шанс, и силу (сила растёт вместе с шансом, см. critRollMult).
  const critW = affixVals(weaponAffix, "Крит");
  const critO = affixVals(otherAffix, "Крит");
  const sumOf = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
  const critVals = sumOf(critW) >= sumOf(critO) ? critW : critO;
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
  // Два меча/кинжала — лучший из двух (как heldVamp на сервере).
  const vamp = Math.max(
    isMeleeClass(p.rightCls) ? affixNum(p.rightAffix, "Вампиризм") : 0,
    isMeleeClass(p.leftCls) && !(p.leftCls === p.rightCls && (p.leftCls === "spear" || p.leftCls === "hammer")) ? affixNum(p.leftAffix, "Вампиризм") : 0,
  );
  if (vamp > 0) rows.push({ label: "Вампиризм", value: `${Math.round(vamp * 1000) / 10}% урона в HP` });

  // Ролл щита гасит урон отдельным множителем сверх брони (см. ZoneRoom.hurtPlayer).
  const arm = 1 - (1 - armorFrac(p)) * (1 - affixNum(shieldAffix, "Физ. защита")) * (1 - bm.def);
  rows.push({ label: "Физ. защита", value: `${Math.round(arm * 100)}%${bm.def > 0 ? UP : ""}` });
  const mres = 1 - (1 - magicResistFrac(p)) * (1 - affixNum(shieldAffix, "Маг. защита")) * (1 - bm.def);
  rows.push({ label: "Маг. защита", value: `${Math.round(mres * 100)}%${bm.def > 0 ? UP : ""}` });
  // Регенерация: ТЕЛ + ролл щита (доля макс. HP в секунду, и в бою) + базовая вне боя.
  const regen = maxHpFor(p.level, p) * (hpRegenFrac(p) + affixNum(shieldAffix, "Регенерация"));
  rows.push({ label: "Регенерация", value: `${regen.toFixed(1)} HP/с (+${PLAYER_HP.regen} вне боя)` });

  const shieldTier = p.rightCls === "shield" ? p.rightTier : p.leftCls === "shield" ? p.leftTier : null;
  if (shieldTier) {
    const chance = shieldBlockChance(shieldTier) + affixNum(shieldAffix, "Блок");
    rows.push({ label: "Блок щитом", value: `${Math.round(chance * 100)}% шанс` });
    const refl = affixNum(shieldAffix, "Отражение");
    if (refl > 0) rows.push({ label: "Отражение щитом", value: `${Math.round(refl * 100)}% удара` });
    if (shieldAffix?.includes("Оплот")) rows.push({ label: "Оплот (Эгида)", value: `блок удара вблизи лечит ${Math.round(SHIELD.aegisHealFrac * 100)}% HP` });
  }

  return rows;
}

/** Та же таблица, но одной строкой через " · " — для мест без вёрстки (чат). */
export function heroStatLine(p: HeroStatInput): string {
  return heroStatRows(p)
    .map((r) => `${r.label.toLowerCase()} ${r.value}`)
    .join(" · ");
}
