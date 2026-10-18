import { BOW, MELEE, PLAYER, PLAYER_HP, PROGRESSION } from "./constants";
import { MAGIC, magicPowerFor, magicResistFrac } from "./magic";
import { levelGain } from "./levelGain";
import { ATTR2, attrOf, invested, physArmorBase } from "./attrs2";
import { glyph } from "./icons";
import { RUBY, WEAPON_NOUN, type WeaponClass } from "./items";
import { armorBonus } from "./armor";

export { levelGain };

/**
 * «Классы 2.0» — шесть атрибутов, шесть классов, общий пул умений.
 *
 * Единый модуль формул: бой (сервер и клиент), башня, боты и сводка баланса
 * (npm run balance) считают отсюда. В игре с 2026-10-01. progression.ts — опыт, уровни
 * и очки (формулы боя переэкспортирует отсюда); magic.ts — числа и формулы магии;
 * attrs2.ts — числа атрибутов и базовые кривые без зависимостей.
 *
 * Атрибуты:
 *   СИЛ — физ. урон любым оружием (меч, кинжал, копьё, молот, лук);
 *   ЛОВ — скорость бега и темп ФИЗИЧЕСКИХ атак;
 *   ИНТ — урон магией и сила лечения;
 *   ТЕЛ — HP и физ. броня;
 *   УДЧ — шанс и сила крита, уворот;
 *   МДР — маг. защита и скорость каста (темп посоха, откат заклинаний).
 *
 * Цена очка растёт с вложенным: первые 10 подъёмов атрибута по 1 очку,
 * следующие 10 — по 2, потом по 3 и т.д. Отдача от каждого подъёма —
 * ЛИНЕЙНАЯ (затухание старой системы softCap не нужно: его заменяет цена).
 */

export type Attr = "str" | "agi" | "int" | "con" | "luc" | "wis";
export const ATTRS: readonly Attr[] = ["str", "agi", "int", "con", "luc", "wis"];

export const ATTR_INFO: Record<Attr, { short: string; name: string; icon: string; desc: string }> = {
  str: { short: "СИЛ", name: "Сила", icon: glyph("a.str"), desc: "Физический урон любым оружием: меч, кинжал, копьё, молот, лук" },
  agi: { short: "ЛОВ", name: "Ловкость", icon: glyph("a.agi"), desc: "Скорость бега и темп физических атак" },
  int: { short: "ИНТ", name: "Интеллект", icon: glyph("a.int"), desc: "Урон магией и сила лечения" },
  con: { short: "ТЕЛ", name: "Телосложение", icon: glyph("a.con"), desc: "Здоровье и физическая броня" },
  luc: { short: "УДЧ", name: "Удача", icon: glyph("a.luc"), desc: "Шанс и сила крита, уворот" },
  wis: { short: "МДР", name: "Мудрость", icon: glyph("a.wis"), desc: "Магическая защита, скорость каста и откат умений" },
};

export { ATTR2 };

export type Attrs = Record<Attr, number>;
/** Любой объект с шестью атрибутами (PlayerState, запись сейва, Progress). */
export type AttrsIn = Readonly<Attrs>;

export function blankAttrs(): Attrs {
  const s = ATTR2.start;
  return { str: s, agi: s, int: s, con: s, luc: s, wis: s };
}

/** Сколько подъёмов вложено в атрибут сверх стартового. */
const inv = (v: number): number => Math.max(0, v - ATTR2.start);

/** Цена подъёма атрибута со значения `value` на +1. */
export function stepCost(value: number): number {
  return 1 + Math.floor(inv(value) / ATTR2.costStep);
}

/** Сколько очков всего ушло, чтобы поднять атрибут со старта до `value`. */
export function totalCost(value: number): number {
  let sum = 0;
  for (let v = ATTR2.start; v < value; v++) sum += stepCost(v);
  return sum;
}

/** Сколько очков всего у героя уровня `level`. */
export function pointsAt(level: number): number {
  return ATTR2.startPoints + Math.max(0, Math.floor(level) - 1) * ATTR2.pointsPerLevel;
}

/** Потрачено на раскладку. */
export function spentOn(a: AttrsIn): number {
  return ATTRS.reduce((n, k) => n + totalCost(a[k]), 0);
}

/** Что даёт каждый подъём атрибута — точными цифрами (подсказки во всех окнах). */
export function attrEffect(k: Attr): string {
  const A = ATTR2;
  const pc = (v: number, d = 1): string => `${+(v * 100).toFixed(d)}%`;
  switch (k) {
    case "str":
      return `+${pc(A.str.physDmg)} физ. урона любым оружием (меч, кинжал, копьё, молот, лук)`;
    case "agi":
      return `+${pc(A.agi.atkSpeed)} темпа физ. атак, +${pc(A.agi.move)} скорости бега`;
    case "int":
      return `+${pc(A.int.magic)} урона магией и силы лечения`;
    case "con":
      return `+${pc(A.con.hp)} здоровья, +${pc(A.con.regen, 2)} здоровья в секунду (и в бою), физ. броня растёт (до ${pc(A.con.armorMax, 0)})`;
    case "luc":
      return `+${pc(A.luc.crit)} шанса крита, +${pc(A.luc.critDmg, 0)} силы крита, +${pc(A.luc.dodge)} уворота (×${A.luc.dodgeOneItem} с одним оружием)`;
    case "wis":
      return `+${pc(A.wis.cast)} скорости каста, +${pc(A.wis.cd)} к скорости отката умений (все классы), маг. защита растёт (до ${pc(A.wis.resistMax, 0)})`;
  }
}

/** Подсказка о цене очков (одна строка). */
export function costRule(): string {
  return `${ATTR2.pointsPerLevel} очка за уровень · первые ${ATTR2.costStep} подъёмов атрибута — по 1 очку, следующие ${ATTR2.costStep} — по 2, дальше по 3…`;
}

// ---------------------------------------------------------------- производные

const P = PROGRESSION.perLevel;


export { invested };

export function maxHp2(level: number, a: AttrsIn): number {
  return (PLAYER_HP.max + levelGain(level, P.hp)) * (1 + inv(attrOf(a, "con")) * ATTR2.con.hp + armorBonus(a, "hp"));
}

export function moveSpeed2(level: number, a: AttrsIn): number {
  return (PLAYER.runSpeed + levelGain(level, P.moveSpeed)) * (1 + inv(attrOf(a, "agi")) * ATTR2.agi.move);
}

/** Множитель физ. урона: уровень × СИЛ. Тир оружия и профиль — отдельно. */
export function physPower2(level: number, a: AttrsIn): number {
  return (1 + levelGain(level, P.weaponDmg)) * (1 + inv(attrOf(a, "str")) * ATTR2.str.physDmg);
}

/** Мягкое затухание прироста без потолка: вначале ≈g, дальше растёт всё медленнее. */
function softGain(g: number, s: number): number {
  return g > 0 ? s * Math.log(1 + g / s) : g;
}

/** Темп от уровня (общий для всех). */
function levelTempo(level: number): number {
  return 1 + levelGain(level, P.atkSpeed);
}

/**
 * Множитель темпа физ. атак (>1 — быстрее): уровень (рост гаснет) × ЛОВ.
 * `soft` — сила затухания роста от уровня: у ближнего боя сильнее (иначе «пропеллер»).
 */
export function physTempo2(level: number, a: AttrsIn, soft: number): number {
  return (1 + softGain(levelTempo(level) - 1, soft)) * agiTempo2(a);
}

/**
 * Темп от ЛОВ — отдельный множитель, линейный, как урон от СИЛ (2026-10-02:
 * раньше ЛОВ шла под затухание роста от уровня и почти съедалась —
 * «всё в ЛОВ» давало ~55% урона «всё в СИЛ»). `share` — доля (ближний бой меньше).
 */
export function agiTempo2(a: AttrsIn, share = 1): number {
  return 1 + inv(attrOf(a, "agi")) * ATTR2.agi.atkSpeed * share;
}

/** Множитель скорости каста (посох): уровень (рост гаснет) × МДР — линейно, как ЛОВ у физ. темпа. */
export function castTempo2(level: number, a: AttrsIn): number {
  return (1 + softGain(levelTempo(level) - 1, ATK_SOFT)) * (1 + inv(attrOf(a, "wis")) * ATTR2.wis.cast);
}

/** Уворот: УДЧ (один предмет в руках — ×dodgeOneItem) + врождённый уворот ассасина с кинжалом (DAGGER.dodge). */
export function dodge2(a: AttrsIn, oneItem: boolean, dagger = false): number {
  const L = ATTR2.luc;
  return Math.min(L.dodgeCap, inv(attrOf(a, "luc")) * L.dodge * (oneItem ? L.dodgeOneItem : 1) + (dagger ? DAGGER.dodge : 0) + armorBonus(a, "dodge"));
}

export function critChance2(a: AttrsIn, weaponBase: number): number {
  return Math.min(0.75, weaponBase + inv(attrOf(a, "luc")) * ATTR2.luc.crit);
}

export function critMult2(a: AttrsIn, weaponBase: number): number {
  return weaponBase + inv(attrOf(a, "luc")) * ATTR2.luc.critDmg;
}

// ---------------------------------------------------------------- оружие

export type Weapon2 = "sword" | "shield" | "bow" | "staff" | "dagger" | "spear" | "hammer";

export interface WeaponProfile {
  name: string;
  /** Урон одного удара/выстрела относительно базы (меч = 1). */
  dmg: number;
  /** Пауза между атаками на 1 уровне без бонусов, с. */
  interval: number;
  /** Затухание темпа (меньше — сильнее). Ближний бой — 1.0, дальний — 1.8. */
  tempoSoft: number;
  /** Досягаемость, м (дальний бой — дальность выстрела). */
  reach: number;
  /** Сколько целей задевает удар (у копья — конусом перед собой). */
  pierce: number;
  critBase: number;
  critMult: number;
  twoHanded: boolean;
  /** Чем бьёт: физика (СИЛ, темп от ЛОВ) или магия (ИНТ, темп от МДР). */
  dmgType: "phys" | "magic";
  /** Множители тиров base/gold/legendary. */
  tiers: [number, number, number];
}

export const WEAPONS2: Record<Weapon2, WeaponProfile> = {
  sword: {
    name: WEAPON_NOUN.sword.name, dmg: 1.8 * 1.2 * 1.2, interval: 0.7, tempoSoft: 1, reach: 2.2, pierce: 1, // 1 → 1.8 (2026-10-05: воин слабейший, темп ПК приведён к общему); ×1.2 (2026-10-15); ×1.2 (2026-10-16)
    critBase: 0.05, critMult: 1.5, twoHanded: false, dmgType: "phys", tiers: [1, 4, 4.5],
  },
  shield: {
    name: WEAPON_NOUN.shield.name, dmg: 0, interval: 1, tempoSoft: 1, reach: 0, pierce: 0,
    critBase: 0, critMult: 1, twoHanded: false, dmgType: "phys", tiers: [1, 1, 1],
  },
  // Кинжал: темп как у меча (быстрее было «пропеллером»); крит выше и больнее. Два кинжала —
  // руки бьют по очереди (DAGGER.dual), один — свободная рука даёт уворот.
  // dmg 0.86 → 1.15 (2026-10-02: ассасин был слабейшим и по DPS, и по живучести — лаборатория баланса).
  dagger: {
    name: WEAPON_NOUN.dagger.name, dmg: 1.35, interval: 0.7, tempoSoft: 1, reach: 1.8, pierce: 1, // 1.15 → 1.35 (2026-10-05)
    critBase: 0.12, critMult: 3, twoHanded: false, dmgType: "phys", tiers: [1, 4, 4.5],
  },
  // Копьё: длинный выпад конусом перед собой, обе руки.
  // dmg 2.1 → 1.45 (2026-10-02: удары больше не пропадают в «окне» моба — копьё стало вдвое сильнее медианы).
  spear: {
    name: WEAPON_NOUN.spear.name, dmg: 1.75, interval: 0.8, tempoSoft: 1, reach: 5, pierce: 3, // было 5 целей (2026-10-02)
    critBase: 0.05, critMult: 1.5, twoHanded: true, dmgType: "phys", tiers: [1, 4, 4.5],
  },
  // Молот: тяжёлый физический удар + магическая волна вокруг цели (HAMMER). Удар +12% урона (2026-10-15).
  hammer: {
    // Удар −20% (2026-10-18).
    name: WEAPON_NOUN.hammer.name, dmg: 2.8 * 1.12 * 1.2 * 0.9 * 0.8, interval: 1.1, tempoSoft: 1, reach: 2.6, pierce: 1,
    critBase: 0.05, critMult: 1.5, twoHanded: true, dmgType: "phys", tiers: [1, 4, 4.5],
  },
  // Лук: стрела 1.75 (как сейчас), но масштаб — от СИЛ, темп — от ЛОВ.
  bow: {
    name: WEAPON_NOUN.bow.name, dmg: 2, interval: 1.6, tempoSoft: 1.8, reach: 30, pierce: 1, // 1.75 → 2 (2026-10-05)
    critBase: BOW.critChance, critMult: BOW.critMult, twoHanded: true, dmgType: "phys", tiers: [1.2, 3.6, 4.1],
  },
  // Посох: огнешар (средний заряд 0.7), темп — от МДР. Тир теперь множит и магию.
  staff: {
    name: WEAPON_NOUN.staff.name,
    dmg: MAGIC.firebolt.baseDamage + 0.7 * MAGIC.firebolt.damagePerCharge,
    interval: MAGIC.firebolt.cooldown, tempoSoft: 1.8, reach: 17, pierce: 1,
    critBase: 0.05, critMult: 2, twoHanded: true, dmgType: "magic", tiers: [1.2, 2.3, 2.8], // 2026-10-05: поджог стал роллом — без него ~170 DPS, с «Поджогом» на максимуме ~середина классов (лаборатория)
  },
};

/** Множитель магии от тира посоха (раньше тир посоха на огнешар не влиял — маг отставал). */
export function staffMagicTier(tier: string): number {
  const t = WEAPONS2.staff.tiers;
  return tier === "ruby" ? t[2] * RUBY.powerMul : tier === "legendary" ? t[2] : tier === "gold" ? t[1] : t[0];
}

/**
 * Пара одинаковых клинков — два кинжала или (с 2026-10-06) два меча: руки чередуются,
 * темп × tempo, урон удара × dmg. Роллы двух клинков не складываются (лучший из двух).
 */
export const DUAL = { tempo: 1.35, dmg: 0.95 } as const;
/** В руках пара одинаковых клинков (кинжал+кинжал или меч+меч). */
export function isDualPair(left: string | null | undefined, right: string | null | undefined): boolean {
  return !!left && left === right && (left === "dagger" || left === "sword");
}

export const DAGGER = {
  /** Удар в спину (цель смотрит не на героя). */
  backstab: 1.5,
  /** Один кинжал + пустая рука: прибавка к шансу и силе крита. */
  soloCrit: 0.08,
  soloCritDmg: 0.5,
  /** Врождённый уворот ассасина: кинжал в руке (один или два) — +18% к шансу уворота (2026-10-02). */
  dodge: 0.18,
} as const;

export const HAMMER = {
  /** Магическая волна при каждом ударе: доля силы магии, радиус. */
  waveMagic: 0.65,
  /** Прибавка волны от интеллекта за очко сверх старта (2026-10-15: 5%). */
  waveIntPer: 0.05,
  /** Радиус волны, м (2026-10-17: 4 — больше, и эффект в середине роста героя). */
  waveRadius: 4,
} as const;

/** Огнешар: доля урона по соседям (сплэш) — как в игре. */
export const STAFF_SPLASH = { frac: MAGIC.firebolt.splashFraction * 0.5, radius: 3 } as const;

// ---------------------------------------------------------------- боевые формулы (единый источник: бой, башня, баланс)

/** Затухание темпа дальнего боя (лук, посох): сильнее — меньше прироста от уровня. */
const ATK_SOFT = 1.8;
/** Затухание темпа мечника — сильнее общего: на высоких уровнях не «пропеллер». */
const MELEE_SOFT = 1.0;
/** Доля прироста темпа ближнего боя: от уровня — половина, от ЛОВ — полностью (2026-10-02: было тоже половина и под затуханием). */
const MELEE_LEVEL_SHARE = 0.5;
const MELEE_AGI_SHARE = 1;

const START: AttrsIn = { str: 1, agi: 1, int: 1, con: 1, luc: 1, wis: 1 };

/** Регенерация здоровья от ТЕЛ — доля МАКС. HP в секунду, работает и в бою (вдобавок к PLAYER_HP.regen вне боя). Ролл щита «Регенерация» — сверху. */
export function hpRegenFrac(a: AttrsIn): number {
  // Регенерация от брони — складывается с телосложением (доля макс. HP в секунду).
  return inv(attrOf(a, "con")) * ATTR2.con.regen + armorBonus(a, "regen");
}

/** Доля урона, гасимая физ. бронёй: броня от ТЕЛ, перемноженная с бронёй предметов (shared/armor.ts). */
export function armorFrac(a: AttrsIn): number {
  return 1 - (1 - physArmorBase(a)) * (1 - armorBonus(a, "physDef"));
}

/** Шанс увернуться от любой атаки (УДЧ); один предмет в руках — выше; кинжал в руке — врождённый уворот ассасина. */
export function dodgeChance(a: AttrsIn, oneHanded: boolean, dagger = false): number {
  return dodge2(a, oneHanded, dagger);
}

/**
 * В руках ОДИН предмет — уворот выше (см. dodgeChance). Одна рука пуста, или
 * обе держат один и тот же двуручник (лук/посох/копьё/молот: клиент сообщает
 * его сразу в обеих руках). Два меча/кинжала или оружие со щитом — не один.
 */
export function holdsOneItem(leftCls: string, rightCls: string): boolean {
  if (leftCls === "" || rightCls === "") return true;
  return leftCls === rightCls && (leftCls === "bow" || leftCls === "staff" || leftCls === "spear" || leftCls === "hammer");
}

/** Базовый множитель физ. урона от уровня (без атрибута и тира оружия). */
export function weaponDmgFromLevel(level: number): number {
  return 1 + levelGain(level, P.weaponDmg);
}

/** Итоговый базовый множитель физ. урона: уровень × СИЛ. Тир оружия — отдельно. */
export function weaponDamageBase(level: number, a: AttrsIn): number {
  return physPower2(level, a);
}

/** Темп физ. атак дальнего боя (лук): уровень × ЛОВ. */
export function attackSpeedFor(level: number, a: AttrsIn = START): number {
  return physTempo2(level, a, ATK_SOFT);
}

/**
 * Темп атаки БЛИЖНЕГО боя (меч/кинжал/копьё/молот/кулак) — приглушённый:
 * от прироста за уровень — MELEE_LEVEL_SHARE со своим, более сильным
 * затуханием; от ЛОВ — MELEE_AGI_SHARE (линейно, см. agiTempo2).
 */
export function meleeSpeedFor(level: number, a: AttrsIn = START): number {
  const lvl = attackSpeedFor(level, START);
  return (1 + softGain((lvl - 1) * MELEE_LEVEL_SHARE, MELEE_SOFT)) * agiTempo2(a, MELEE_AGI_SHARE);
}

/** Оружие с паузой между атаками (посох — своя формула staffCastInterval). */
export type AttackWeapon = "sword" | "dagger" | "spear" | "hammer" | "bow" | "fist";

/**
 * Пауза между атаками героя, с — ОДНА для всех: ПК, телефон, VR (предел сервера) и боты
 * (2026-10-05: раньше у ПК меч бил в 1.8, лук — в 2.3 раза чаще ботов и телефона).
 * База — профиль оружия (WEAPONS2.*.interval), темп — уровень и ЛОВ; `mul` — ролл
 * «скорость атаки» × клич × рывок; два кинжала бьют по очереди — чаще.
 */
export function heroAttackInterval(weapon: AttackWeapon, level: number, a: AttrsIn, mul = 1, dualPair = false): number {
  if (weapon === "bow") return WEAPONS2.bow.interval / (attackSpeedFor(level, a) * mul);
  if (weapon === "fist") return MELEE.cooldown / (meleeSpeedFor(level, a) * mul);
  // Пара клинков (два кинжала / два меча) — руки чередуются, бьют чаще (DUAL).
  const dual = dualPair && (weapon === "dagger" || weapon === "sword") ? DUAL.tempo : 1;
  return WEAPONS2[weapon].interval / dual / (meleeSpeedFor(level, a) * mul);
}

/**
 * Пауза между огнешарами посоха, с: откат огнешара ÷ (скорость каста × `mul` —
 * ролл «скорость атаки», клич). ОДНА для игрока (клиент и проверка сервера),
 * бота, героя башни и окна характеристик (2026-10-03: бот кастовал по своей
 * паузе 2.2 с от ЛОВ — вдвое реже игрока на ПК).
 */
export function staffCastInterval(level: number, a: AttrsIn, mul = 1): number {
  return MAGIC.firebolt.cooldown / (castTempo2(level, a) * mul);
}

/** Скорость каста (посох, откат заклинаний): уровень × МДР. */
export function castSpeedFor(level: number, a: AttrsIn = START): number {
  return castTempo2(level, a);
}

/** Скорость проигрывания клипа замаха — быстрее темпа боя, чтобы клип успевал. */
export function meleeAnimRate(level: number, a: AttrsIn = START): number {
  return 1.5 * meleeSpeedFor(level, a);
}

/** Максимум HP героя: уровень × ТЕЛ (+ броня предметов). */
export function maxHpFor(level: number, a: AttrsIn): number {
  return maxHp2(level, a);
}

/** Урон мечом (базовый удар на 1 ур. = 1). Совместимость имени. */
export function swordDamageFor(level: number, a: AttrsIn): number {
  return weaponDamageBase(level, a);
}

/** Скорость бега: уровень × ЛОВ. */
export function moveSpeedFor(level: number, a: AttrsIn): number {
  return moveSpeed2(level, a);
}

/** Добавка к скорости стрелы, м/с — небольшая, от уровня. */
export function arrowSpeedBonusFor(level: number): number {
  return Math.max(0, Math.floor(level) - 1) * PROGRESSION.arrowSpeedPerLevel;
}

/** Урон стрелы: 1.75 × физ. урон (СИЛ, как у всего физического оружия). Тир лука — отдельно. */
export function arrowDamageFor(level: number, a: AttrsIn): number {
  return WEAPONS2.bow.dmg * physPower2(level, a); // профиль лука — единый источник
}

// ---------------------------------------------------------------- классы

export type ClassId = "warrior" | "archer" | "support" | "assassin" | "spearman" | "battlemage";
export const CLASS_IDS: readonly ClassId[] = ["warrior", "archer", "support", "assassin", "spearman", "battlemage"];

export type SkillId =
  | "stunBash"
  | "arrowRain"
  | "massHeal"
  | "shadowStep"
  | "crush"
  | "seal"
  | "whirlwind"
  | "warcry"
  | "mark"
  | "chain"
  | "plague"
  | "smoke"
  | "soulSteal"
  | "abyss"
  | "lifeArrow"
  | "cleave";

export interface ClassDef {
  name: string;
  icon: string;
  role: string;
  weapons: string;
  /** Чем бьёт основная атака класса. */
  main: Weapon2;
  /** Разрешённые умения (игрок ставит любые 2). */
  skills: SkillId[];
  /** Умения по умолчанию (и у ботов). */
  defaultSkills: [SkillId, SkillId];
  /**
   * Шаблон раскачки для ботов и расчёта: веса атрибутов. Очки идут туда,
   * где «вес / цена следующего подъёма» больше.
   */
  build: Partial<Record<Attr, number>>;
}

export const CLASSES2: Record<ClassId, ClassDef> = {
  warrior: {
    name: "Воин", icon: glyph("c.warrior"), role: "Танк, контроль", weapons: "меч + щит", main: "sword",
    skills: ["stunBash", "whirlwind", "cleave", "warcry", "seal"], defaultSkills: ["cleave", "whirlwind"],
    build: { str: 3, con: 4, agi: 1.5, luc: 1, wis: 1.2 },
  },
  archer: {
    name: "Лучник", icon: glyph("c.archer"), role: "Дальний урон", weapons: "лук", main: "bow",
    skills: ["arrowRain", "shadowStep", "mark", "chain", "lifeArrow"], defaultSkills: ["arrowRain", "mark"],
    build: { str: 4, agi: 2.5, luc: 2.5, con: 1.2, wis: 0.8 },
  },
  support: {
    name: "Маг поддержки", icon: glyph("c.support"), role: "Лечение, защита", weapons: "посох", main: "staff",
    skills: ["massHeal", "seal", "warcry", "arrowRain"], defaultSkills: ["massHeal", "warcry"],
    build: { int: 4, wis: 3, con: 1.8, luc: 0.6 },
  },
  assassin: {
    name: "Ассасин", icon: glyph("c.assassin"), role: "Криты, уворот", weapons: "1 или 2 кинжала", main: "dagger",
    skills: ["shadowStep", "stunBash", "arrowRain", "whirlwind", "plague", "smoke", "soulSteal", "abyss"], defaultSkills: ["shadowStep", "arrowRain"],
    build: { str: 3, luc: 3.5, agi: 2.5, con: 1.3, wis: 0.6 },
  },
  spearman: {
    name: "Копейщик", icon: glyph("c.spearman"), role: "Длинный выпад конусом", weapons: "копьё (2 руки)", main: "spear",
    skills: ["stunBash", "whirlwind", "arrowRain", "shadowStep"], defaultSkills: ["whirlwind", "stunBash"],
    build: { str: 4, agi: 2.2, con: 2.2, luc: 1.2, wis: 0.8 },
  },
  battlemage: {
    name: "Боевой маг", icon: glyph("c.battlemage"), role: "Гибрид: молот + магия", weapons: "молот (2 руки)", main: "hammer",
    skills: ["crush", "seal", "whirlwind", "chain"], defaultSkills: ["crush", "chain"],
    build: { str: 2.6, int: 2.6, con: 2.4, wis: 1.2, luc: 0.5 },
  },
};

/** Класс по тому, что в руках (как сейчас: оружие = класс). null — пустые руки. */
export function classOf2(left: Weapon2 | "", right: Weapon2 | ""): ClassId | null {
  const h = [left, right];
  if (h.includes("spear")) return "spearman";
  if (h.includes("hammer")) return "battlemage";
  if (h.includes("staff")) return "support";
  if (h.includes("bow")) return "archer";
  if (h.includes("dagger") && !h.includes("sword")) return "assassin";
  if (h.includes("sword")) return "warrior";
  return null;
}

/** Класс, которому принадлежит вид оружия (как classOf2): щит — к воину (меч + щит). Для сортировки «По классу». */
export const CLASS_OF_WEAPON: Record<WeaponClass, ClassId> = {
  sword: "warrior",
  shield: "warrior",
  dagger: "assassin",
  spear: "spearman",
  hammer: "battlemage",
  bow: "archer",
  staff: "support",
};

// ---------------------------------------------------------------- умения

export interface SkillDef {
  name: string;
  icon: string;
  desc: string;
  cooldown: number;
  castTime: number;
  radius: number;
  /** Урон в долях «силы удара» класса (физ. удар или огнешар). */
  dmgMult: number;
  /** Сколько раз бьёт за применение (град — 5 залпов, у лука 3). */
  hits: number;
  /** Своё имя/описание у отдельных классов (одно умение — разный вид). */
  variants?: Partial<Record<ClassId, { name: string; desc: string; /** Множитель отката только у этого класса (2026-10-15). */ cdMul?: number }>>;
  /** 🧪 Тестовое умение — идёт отбор: имя с пометкой, может уйти на переделку. */
  test?: boolean;
  /** Атрибут, усиливающий само умение (сверх общих), и на сколько за вложенное очко. */
  attr?: { attr: Attr; per: number; what: string };
}

/**
 * «Сокрушение бури»: лечение героя и союзников рядом (доли максимума HP).
 * 2026-10-06: было 0.3 / 0.15 — боевой маг был сам себе лекарем и танком (три молота в катакомбах не умирали).
 */
export const STORM_CRUSH = {
  /** Лечение — доля макс. HP: база + за каждое очко мудрости сверх старта. Союзники — то же, в allyRadius. */
  healBase: 0.09, healPerWis: 0.003, allyRadius: 12, // лечение база 6% → 9% (2026-10-15)
  /** Урон волны — ещё +intDmgPer за очко интеллекта сверх старта (поверх общих +6% умений молота). */
  intDmgPer: 0.025,
  /** Замедление мобов в волне: секунд и множитель скорости (0.5 — вдвое медленнее). */
  slowSec: 5, slowMul: 0.5,
} as const;

/** Умения молота: урон растёт от интеллекта на intPer за очко сверх старта (у магии — ATTR2.int.magic, 2.6%). */
export const HAMMER_SKILL = { intPer: 0.06 } as const;

/** «Грозовое поле» молота: круг на duration с радиусом radius; каждые 0.5 с молния бьёт магией ×boltMul и оглушает на stunSec. */
export const HAMMER_FIELD = { duration: 5, radius: 8, boltMul: 0.1625, stunSec: 0.2 } as const; // 2026-10-15: молния 0.1625 (вдвое слабее, было 0.325), радиус 8 (было 10), длительность 5 с
/** «Громовой вихрь» молота: последний удар вихря бьёт молнией соседа в range м; множитель ×minMul → ×maxMul от интеллекта (полная шкала — intFull очков сверх старта). */
export const THUNDER_SPIN = { range: 7, minMul: 2, maxMul: 3, intFull: 30 } as const; // молния ×2 → ×3 (было ×3 → ×4, 2026-10-15)
/** «Цепная молния» молота: hops скачков; задетые получают +vulnMul% урона от молота на vulnSec. */
export const CHAIN_HAMMER = { hops: 5, vulnMul: 1.2, vulnSec: 5 } as const;

export const SKILLS2: Record<SkillId, SkillDef> = {
  stunBash: {
    name: "Оглушающий удар", icon: glyph("s.stunBash"), desc: "Удар по кругу: оглушает всех рядом на 3 с",
    cooldown: 12, castTime: 0.5, radius: 5, dmgMult: 1, hits: 1, // 0.6 → 1 (2026-10-05)
    variants: {
      assassin: { name: "Смертельный прыжок", desc: "Прыжок на цель до 9 м: удар с гарантированным критом ×2 и оглушение 1.5 с" },
      spearman: { name: "Подсечка", desc: "Древком по кругу: сбивает с ног всех рядом (оглушение 2 с) и замедляет на 4 с" },
    },
  },
  arrowRain: {
    name: "Град стрел", icon: glyph("s.arrowRain"), desc: "Круг вдалеке: 3 залпа за 3 с, мобы в нём пригвождены",
    cooldown: 14, castTime: 0.9, radius: 6.5, dmgMult: 1, hits: 5,
    variants: {
      support: { name: "Огненный дождь", desc: "Круг огня вдалеке: 5 волн магии, каждая поджигает (горение 6 с)" },
      assassin: { name: "Отскок с веером", desc: "Отскок назад на 5 м и три веера ножей конусом вперёд (9 м), каждый нож — кровотечение 5 с: 2% здоровья цели в секунду" },
      spearman: { name: "Ливень копий", desc: "Три тяжёлых копья с неба в круг 5 м: каждое бьёт ×1.6 и оглушает на 1 с" },
    },
  },
  massHeal: {
    name: "Аура исцеления", icon: glyph("s.massHeal"), desc: "Сразу: аура вокруг героя на 6 с, ходит за ним и понемногу лечит всех союзников в ней",
    cooldown: 14, castTime: 0, radius: 8, dmgMult: 0, hits: 1,
  },
  shadowStep: {
    name: "Теневой рывок", icon: glyph("s.shadowStep"), desc: "Рывок сквозь мобов за спину цели; следующий удар — гарантированный крит",
    cooldown: 10, castTime: 0.15, radius: 10, dmgMult: 0, hits: 1,
    variants: {
      assassin: { name: "Теневой рывок", desc: "Рывок сквозь мобов за спину цели: цель оглушена на 1 с, следующий удар — гарантированный крит" },
      archer: { name: "Отскок", desc: "Прыжок назад на 7 м; на старом месте — дымовая ловушка (пригвождает 3 с), следующий выстрел — крит" },
      spearman: { name: "Отскок", desc: "Короткий прыжок назад на 4 м; на старом месте — ловушка: все мобы вокруг стягиваются в кучку и замедлены на 50% на 3 с, следующий удар — крит" },
    },
  },
  crush: {
    name: "Сокрушение", icon: glyph("s.crush"), desc: "Прыжок и удар о землю: волна по кругу, мобы оглушены на 1 с",
    cooldown: 14, castTime: 0.6, radius: 5, dmgMult: 2.2, hits: 1,
    variants: {
      battlemage: { name: "Сокрушение бури", desc: `Прыжок и магический удар: волна по кругу, мобы замедлены на ${STORM_CRUSH.slowSec} с на ${Math.round((1 - STORM_CRUSH.slowMul) * 100)}%; урон волны +${Math.round(STORM_CRUSH.intDmgPer * 100)}% за очко интеллекта; лечит тебя на ${Math.round(STORM_CRUSH.healBase * 100)}% здоровья + ${(STORM_CRUSH.healPerWis * 100).toFixed(1)}% за очко мудрости, союзников в ${STORM_CRUSH.allyRadius} м — так же` },
    },
  },
  seal: {
    name: "Печать света", icon: glyph("s.seal"), desc: "Круг на 6 с: союзникам лечение и щит −20% урона, врагам замедление 40%",
    cooldown: 18, castTime: 0.4, radius: 5, dmgMult: 0, hits: 1,
    variants: {
      warrior: { name: "Печать стража", desc: "Круг на 6 с: союзникам −40% урона, мобы в круге бросаются на воина" },
      battlemage: { name: "Грозовое поле", cdMul: 2, desc: `Круг ${HAMMER_FIELD.radius} м на ${HAMMER_FIELD.duration} с: каждые 0.5 с молния бьёт врагов внутри магией и оглушает на ${HAMMER_FIELD.stunSec} с` },
    },
  },
  whirlwind: {
    name: "Вихрь", icon: glyph("s.whirlwind"), desc: "2 с вращаешься с мечом: 5 ударов по всем вокруг, входящий урон −30%",
    cooldown: 14, castTime: 0, radius: 3.2, dmgMult: 0.9, hits: 5, // 0.7 → 0.9 (2026-10-05)
    variants: {
      spearman: { name: "Град выпадов", desc: "Серия из 8 быстрых выпадов копьём вперёд (длинный конус 6 м): каждый колет всех в секторе" },
      battlemage: { name: "Громовой вихрь", desc: `Молот по кругу: 5 магических ударов; последний бьёт молнией соседа в ${THUNDER_SPIN.range} м — ×${THUNDER_SPIN.minMul}, до ×${THUNDER_SPIN.maxMul} от интеллекта` },
      assassin: { name: "Танец клинков", desc: "Вихрь-рывок: 2 с неуязвимости, проносишься вперёд на 6 м, 5 ударов по всем вокруг (с шансом крита), задетые замедлены на 30%" },
    },
  },
  warcry: {
    name: "Боевой клич", icon: glyph("s.warcry"), desc: "Союзникам в 12 м на 8 с +25% урона и +15% темпа; мобы рядом бросаются на тебя",
    cooldown: 22, castTime: 0.3, radius: 12, dmgMult: 0, hits: 1,
    variants: {
      support: { name: "Благословение", desc: "Союзникам в 12 м на 10 с: +25% урона, +15% темпа атак и −15% входящего урона" },
    },
  },
  mark: {
    name: "Метка", icon: glyph("s.mark"), desc: "Цель 10 с: все атакующие (и ты сам) наносят ей +40% урона; умерла под меткой — откат сброшен",
    cooldown: 12, castTime: 0.2, radius: 22, dmgMult: 0, hits: 1,
    variants: {
      archer: { name: "Метка охотника", desc: "Цель 10 с: все атакующие (и ты сам) наносят ей +40% урона; умерла под меткой — откат сброшен" },
    },
  },
  plague: {
    name: "Чумной клинок", icon: glyph("s.plague"), test: true,
    desc: "8 с отравленных клинков: удар вешает стак яда (до 5); на 5 стаках взрыв заражает соседей (+1 стак) — яд ползёт по толпе. Яд — от атаки кинжала (с заточкой) и мудрости",
    cooldown: 16, castTime: 0, radius: 5, dmgMult: 0.288, hits: 1, // взрыв −20% (2026-10-15): было 0.36
    attr: { attr: "wis", per: 1, what: "сила яда" }, // 2026-10-16: ×10 к зависимости от мудрости (было 0.1 = +10% за очко; ×20 откатили); раньше: 2% → 4.5% → 8% → 14% → 11.2% → 10%
  },
  smoke: {
    name: "Пелена смерти", icon: glyph("s.smoke"), test: true,
    desc: "Дымовая бомба на цель (до 12 м; нет цели — под собой), дым 5 м на 6 с: мобы в дыму промахиваются в половине ударов, в стоящих в дыму не стреляют, союзникам в дыму +30% уворота",
    cooldown: 18, castTime: 0.2, radius: 5, dmgMult: 0, hits: 1,
    attr: { attr: "wis", per: 0.01, what: "длительность дыма" },
  },
  soulSteal: {
    name: "Кража душ", icon: glyph("s.soulSteal"), test: true,
    desc: "Удар по цели до 6 м, ×1.5; половина урона лечит самого раненого союзника рядом (все целы — тебя)",
    cooldown: 10, castTime: 0.2, radius: 12, dmgMult: 1.5, hits: 1,
    attr: { attr: "wis", per: 0.02, what: "сила лечения" },
  },
  abyss: {
    name: "Призрак бездны", icon: glyph("s.abyss"), test: true,
    desc: "3 с в тени: мобы теряют тебя, бег +40%; первый удар из тени — рывок за спину цели, ×2 и крит, затем +30% темпа на 3 с",
    cooldown: 16, castTime: 0, radius: 0, dmgMult: 2, hits: 1,
    attr: { attr: "agi", per: 0.015, what: "удар из тени" },
  },
  lifeArrow: {
    name: "Стрела жизни", icon: glyph("s.lifeArrow"),
    desc: "Тяжёлая стрела в цель до 22 м: ×2 урона; лечит тебя на половину нанесённого урона и ещё на 25% здоровья",
    cooldown: 12, castTime: 0.2, radius: 22, dmgMult: 2, hits: 1,
  },
  cleave: {
    name: "Рассекающий удар", icon: glyph("s.cleave"),
    desc: "Широкий удар мечом перед собой (конус 120°, 6 м): ×2.2 урона всем в секторе, отбрасывает и замедляет на 40% на 3 с",
    cooldown: 9, castTime: 0.25, radius: 6, dmgMult: 2.2, hits: 1,
  },
  chain: {
    name: "Цепная молния", icon: glyph("s.chain"), desc: "Разряд скачет по 4 врагам (каждый скачок слабее на 20%) и оглушает каждого на 0.5 с",
    cooldown: 11, castTime: 0.3, radius: 14, dmgMult: 1.6, hits: 4,
    variants: {
      archer: { name: "Грозовая стрела", desc: "Стрела-молния: ×2 по первой цели, затем 2 слабых скачка" },
      battlemage: { name: "Цепная молния", desc: `Разряд скачет по ${CHAIN_HAMMER.hops} врагам (каждый скачок слабее на 20%); задетые на ${CHAIN_HAMMER.vulnSec} с получают +${Math.round((CHAIN_HAMMER.vulnMul - 1) * 100)}% урона от молота` },
    },
  },
};

/** Классы, у которых «Теневой рывок» — отскок назад с дымовой ловушкой (лучник, копейщик). */
export function hopsBack(cls: ClassId | null): boolean {
  return cls === "archer" || cls === "spearman";
}

/** Дальность отскока назад, м: у копейщика короче. */
export function hopDistance(cls: ClassId | null): number {
  return cls === "spearman" ? 4 : 7;
}

/** Ассасин: «Смертельный прыжок» на цель (время полёта, урон в силах удара до крита ×2, оглушение). */
export const ASSASSIN_LEAP = { range: 9, time: 0.35, dmg: 1.2, stun: 1.5 } as const;
/** Ассасин: «Отскок с веером» — на сколько метров отскакивает назад перед веером ножей. */
export const ASSASSIN_FAN_HOP = 5;

/** «Отскок» копейщика: ловушка стягивает мобов вокруг в кучку и замедляет. */
export const SPEAR_HOP_TRAP = { radius: 6.5, seconds: 3, slow: 0.5, pullStep: 0.25 } as const;

/** Копейщик, боевой маг и ассасин — умения откатываются быстрее остальных классов. */
export const CLASS_CD_MUL: Partial<Record<ClassId, number>> = { spearman: 0.7, battlemage: 0.65, assassin: 0.4 };

/** Базовый откат умения у класса (без МДР). */
/** Множитель отката умений: класс × МДР (у всех классов). ОДИН для сервера, клиента и ботов. */
/** Множитель отката умений: класс × МДР (с камнями) — ATTR2.wis.cd за очко, у всех классов (2026-10-07: было 1.5%). */
export function skillCdMul2(cls: ClassId | null, a: object): number {
  return ((cls && CLASS_CD_MUL[cls]) || 1) / (1 + inv(attrOf(a, "wis")) * ATTR2.wis.cd);
}

/** Атрибуты героя для умений: база (как в PlayerState) и прибавка от колец и камней (PlayerState.gb). */
export type SkillAttrs = Partial<Record<Attr, number>> & { gb?: Partial<Record<Attr, number>> };

/** Откат умения героя, сек, до 0.1 — тот же расчёт, что у сервера: база × класс × МДР (с камнями). Без `a` — старт (МДР 1). */
export function skillCooldownFor(id: SkillId, cls: ClassId | null, a: SkillAttrs = {}): number {
  return Math.round(SKILLS2[id].cooldown * skillCdMul2(cls, a) * 10) / 10;
}

/** «Град выпадов» копейщика: серия колющих ударов вперёд. */
/** Выпад копья: цели ЗА основной (до pierce − 1) получают эту долю урона (2026-10-02: было 100% по пяти целям). */
export const SPEAR_PIERCE_DMG = 0.7;

export const SPEAR_FLURRY = { thrusts: 8, duration: 1.6, range: 6.5, cone: 0.5, dmg: 1 } as const;

/** Числа новых умений. */
export const WHIRL = { duration: 2, spearRadius: 4, spearHits: 4, spearDmg: 0.9, warriorDef: 0.3 } as const;
export const WARCRY = { duration: 8, blessDuration: 10, blessDef: 0.15, dmg: 0.25, tempo: 0.15, rallyTempo: 0.3, aggroSec: 4 } as const;
/** Печать стража: союзникам в круге −40% урона. */
export const GUARD_SEAL = { shield: 0.4 } as const;
/** «Рассекающий удар» воина: конус перед собой. */
export const CLEAVE = { halfAngle: 1.05, shove: 4, slowSec: 3, slow: 0.4 } as const;
/** «Метка» (2026-10-07 усилена: было 8 с и +25%). */
export const MARK = { duration: 10, dmgMul: 1.4, assassinCrit: 0.25, slow: 0.3 } as const;
export const CHAIN = { jump: 7, falloff: 0.8 } as const;
/** Аура исцеления: длительность и сколько «полных лечений» отдаёт за всё время. */
export const HEAL_AURA = { duration: 6, totalMul: 1.6 } as const;
/** Веер ножей: кровотечение — доля МАКС. HP цели в секунду (босс/осколки — в bossDiv раз меньше), bleedSec с. */
export const FAN = { range: 9, halfAngle: 0.55, volleys: 3, dmgMult: 0.7, bleedHpFrac: 0.02, bleedSec: 5, bossDiv: 4 } as const;

/** Числа «Печати» (лечение — доля макс. HP в секунду; урон — у боевого мага). */
export const SEAL = { duration: 6, healFracPerSec: 0.015, shield: 0.2, slow: 0.4, burnPerSec: 0.35 } as const;

export function skillName(id: SkillId, cls: ClassId): string {
  const sk = SKILLS2[id];
  const name = sk.variants?.[cls]?.name ?? sk.name;
  return sk.test ? `${glyph("ui.test")} ${name}` : name;
}

/**
 * Описание умения для класса + строка про свой атрибут (если есть) — единый текст для всех окон.
 * С `a` (герой) — бонус, который сервер применяет сейчас (атрибут с кольцами и камнями); без `a` — формула.
 */
export function skillDesc(id: SkillId, cls: ClassId, a?: SkillAttrs): string {
  const sk = SKILLS2[id];
  const d = sk.variants?.[cls]?.desc ?? sk.desc;
  if (!sk.attr) return d;
  const name = ATTR_INFO[sk.attr.attr].name;
  const per = `+${Math.round(sk.attr.per * 1000) / 10}% за очко`;
  if (!a) return `${d}. ${name}: ${per} (${sk.attr.what})`;
  const pct = Math.round((skillAttrMul(id, a) - 1) * 1000) / 10;
  return `${d}. ${sk.attr.what}: +${pct}% сейчас (${name} ${attrOf(a, sk.attr.attr)}) · ${per}`;
}

/** Множитель умения от его атрибута (SkillDef.attr): 1 + (атрибут − старт) × per. Атрибут — с кольцами и камнями (attrOf), как на сервере. */
export function skillAttrMul(id: SkillId, a: SkillAttrs): number {
  const at = SKILLS2[id].attr;
  return at ? 1 + Math.max(0, attrOf(a, at.attr) - ATTR2.start) * at.per : 1;
}

/** «Чумной клинок»: стак яда тикает stackSec, доля удара в секунду за стак; на maxStacks — взрыв. */
export const PLAGUE = {
  duration: 8, stackSec: 3, maxStacks: 5, tickFrac: 0.024, burstRadius: 4, // яд −20% (2026-10-15): было 0.03; радиус взрыва 4 м (было 5)
  /** Взрыв на 5 стаках не сжигает их; следующий взрыв того же моба — не раньше чем через burstCd с. */
  burstCd: 3,
  /** Взрыв заражает соседей в burstRadius: +spread стаков (цепочкой — их взрывы заражают дальше). */
  spread: 1, // соседи после взрыва: +1 стак (было 2, 2026-10-15)
} as const;
/** «Пелена смерти»: дым — промах мобов, запрет выстрелов, уворот союзникам. */
export const SMOKE = { duration: 6, miss: 0.5, dodge: 0.3, range: 12 } as const;
/** «Кража душ»: доля нанесённого урона в лечение; «все целы» — выше этой доли HP. */
/** «Кража душ»: удар насквозь — рывок к цели до reach м и дальше за спину на through м. */
/** Лучник «Стрела жизни»: лечение — доля нанесённого урона + доля своего макс. HP; бот стреляет ею, когда HP ниже botBelow. */
export const LIFE_ARROW = { healDmg: 0.5, healMax: 0.25, botBelow: 0.85 } as const;
export const SOUL_STEAL = { transfer: 0.5, healthy: 0.85, reach: 6 } as const;
/** «Призрак бездны»: сколько в тени, ускорение после выхода. */
/** «Призрак бездны»: сколько в тени, ускорение после выхода, бег в тени; удар из тени — рывок за спину цели (blink м). */
export const ABYSS = { duration: 3, hasteSec: 3, haste: 0.3, move: 0.4, blink: 4 } as const;
/** Ассасин: «Теневой рывок» оглушает цель, «Танец клинков» замедляет задетых. */
export const ASSASSIN_STEP_STUN = 1;
/**
 * Прыжки ассасина на цель (Смертельный прыжок, Теневой рывок, Чума, Кража душ,
 * удар из тени) — посадка ЗА спиной цели: радиус тела моба + столько метров,
 * чтобы перепрыгнуть, но остаться на дистанции удара (и бить в спину).
 */
export const JUMP_BEHIND = 0.6;
export const ASSASSIN_WHIRL_SLOW = { sec: 2, mul: 0.7 } as const;
/** «Танец клинков» ассасина — вихрь-рывок: за время вращения проносится вперёд на столько метров. */
export const ASSASSIN_WHIRL_DASH = 6;

// ---------------------------------------------------------------- раскладка

/**
 * Раскладка очков по шаблону класса: каждое очко-подъём идёт в атрибут с
 * наибольшим «вес / (цена · (1 + вложено/20))» — так шаблон не сливает всё в
 * один атрибут, а повторяет то, как раскидал бы живой игрок.
 */
export function autoBuild(cls: ClassId, level: number): Attrs {
  const a = blankAttrs();
  let left = pointsAt(level);
  const w = CLASSES2[cls].build;
  for (;;) {
    let best: Attr | null = null;
    let bestScore = 0;
    for (const k of ATTRS) {
      const wk = w[k] ?? 0;
      if (wk <= 0) continue;
      const c = stepCost(a[k]);
      if (c > left) continue;
      const score = wk / (c * (1 + inv(a[k]) / 20));
      if (score > bestScore) {
        bestScore = score;
        best = k;
      }
    }
    if (!best) break;
    left -= stepCost(a[best]);
    a[best]++;
  }
  return a;
}

/**
 * Дораскидать свободные очки по шаблону класса (боты зрителей): тот же
 * выбор, что в autoBuild, но от текущих значений. Мутирует `a`, вернёт,
 * сколько подъёмов сделано.
 */
export function autoSpend(a: Attrs & { unspent: number }, cls: ClassId): number {
  const w = CLASSES2[cls].build;
  let n = 0;
  for (;;) {
    let best: Attr | null = null;
    let bestScore = 0;
    for (const k of ATTRS) {
      const wk = w[k] ?? 0;
      if (wk <= 0) continue;
      const c = stepCost(a[k]);
      if (c > a.unspent) continue;
      const score = wk / (c * (1 + inv(a[k]) / 20));
      if (score > bestScore) {
        bestScore = score;
        best = k;
      }
    }
    if (!best) return n;
    a.unspent -= stepCost(a[best]);
    a[best]++;
    n++;
  }
}

// ---------------------------------------------------------------- сводка героя

export interface Hero2 {
  cls: ClassId;
  level: number;
  attrs: Attrs;
  /** Тир оружия: 0 base, 1 gold, 2 legendary. */
  tier: 0 | 1 | 2;
  /** Ассасин: два кинжала (иначе — один и пустая рука). */
  dual?: boolean;
}

export interface Summary2 {
  hp: number;
  armor: number;
  resist: number;
  dodge: number;
  move: number;
  /** Средний урон одной атаки с учётом крита (без брони цели). */
  hit: number;
  /** Атак в секунду. */
  rate: number;
  critChance: number;
  critMult: number;
  /** Доп. урон вокруг цели за атаку (волна молота, сплэш огнешара). */
  splash: number;
  splashType: "phys" | "magic";
  /** Сколько целей пробивает. */
  pierce: number;
  /** Урон основной атаки — физ. или магия. */
  dmgType: "phys" | "magic";
  /** «Сила удара» класса — от неё считаются умения. */
  power: number;
  /** Множитель отката умений (МДР ускоряет каст у магов). */
  cdMul: number;
}

export function summarize2(h: Hero2): Summary2 {
  const a = h.attrs;
  const def = CLASSES2[h.cls];
  const w = WEAPONS2[def.main];
  const tierMul = w.tiers[h.tier];
  const magic = w.dmgType === "magic";
  let critBase = w.critBase;
  let critDmg = w.critMult;
  let rate: number;
  let perHit: number;
  let oneItem = w.twoHanded;
  if (magic) {
    rate = castTempo2(h.level, a) / w.interval;
    perHit = w.dmg * magicPowerFor(h.level, a) * tierMul;
  } else {
    rate = physTempo2(h.level, a, w.tempoSoft) / w.interval;
    perHit = w.dmg * physPower2(h.level, a) * tierMul;
  }
  if (h.cls === "assassin") {
    if (h.dual) {
      rate *= DUAL.tempo;
      perHit *= DUAL.dmg;
    } else {
      oneItem = true;
      critBase += DAGGER.soloCrit;
      critDmg += DAGGER.soloCritDmg;
    }
  }
  const cc = critChance2(a, critBase);
  const cm = critMult2(a, critDmg);
  const hit = perHit * (1 + cc * (cm - 1));
  let splash = 0;
  let splashType: "phys" | "magic" = "phys";
  if (h.cls === "battlemage") {
    splash = HAMMER.waveMagic * magicPowerFor(h.level, a) * tierMul * (1 + Math.max(0, attrOf(a, "int") - ATTR2.start) * HAMMER.waveIntPer);
    splashType = "magic";
  } else if (h.cls === "support") {
    splash = hit * STAFF_SPLASH.frac;
    splashType = "magic";
  }
  const casterSkills = h.cls === "support" || h.cls === "battlemage";
  return {
    hp: maxHp2(h.level, a),
    armor: armorFrac(a),
    resist: magicResistFrac(a),
    dodge: dodge2(a, oneItem, h.cls === "assassin"),
    move: moveSpeed2(h.level, a),
    hit,
    rate,
    critChance: cc,
    critMult: cm,
    splash,
    splashType,
    pierce: w.pierce,
    dmgType: w.dmgType,
    power: casterSkills ? Math.max(hit, (WEAPONS2.staff.dmg * magicPowerFor(h.level, a) * tierMul) / 2) : hit,
    // Откат умений ускоряет только МДР (не уровень): иначе к 30+ ур. умения магов шли бы вдвое чаще.
    cdMul: 1 / (1 + inv(attrOf(a, "wis")) * ATTR2.wis.cd),
  };
}
