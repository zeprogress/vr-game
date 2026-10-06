import { BOW, PLAYER, PLAYER_HP, PROGRESSION } from "./constants";
import { MAGIC } from "./magic";
import { levelGain } from "./levelGain";
import { ATTR2, invested } from "./attrs2";
import { glyph } from "./icons";
import { WEAPON_NOUN } from "./items";

export { levelGain };

/**
 * «Классы 2.0» — шесть атрибутов, шесть классов, общий пул умений.
 *
 * ПОКА ТОЛЬКО ДЛЯ ЛАБОРАТОРИИ и расчёта баланса (npm run balance): игра
 * по-прежнему считает по progression.ts/magic.ts. Когда цифры устоятся,
 * бой переводится на этот модуль целиком (этап ввода).
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
      return `+${pc(A.wis.cast)} скорости каста и отката умений (все классы), маг. защита растёт (до ${pc(A.wis.resistMax, 0)})`;
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
  return (PLAYER_HP.max + levelGain(level, P.hp)) * (1 + inv(a.con) * ATTR2.con.hp);
}

/** Доля физ. урона, которую гасит броня (ТЕЛ). */
export function physArmor2(a: AttrsIn): number {
  const n = inv(a.con);
  return (ATTR2.con.armorMax * n) / (n + ATTR2.con.armorK);
}

/** Доля магического урона, которую гасит МДР. */
export function magicResist2(a: AttrsIn): number {
  const n = inv(a.wis);
  return (ATTR2.wis.resistMax * n) / (n + ATTR2.wis.resistK);
}

export function moveSpeed2(level: number, a: AttrsIn): number {
  return (PLAYER.runSpeed + levelGain(level, P.moveSpeed)) * (1 + inv(a.agi) * ATTR2.agi.move);
}

/** Множитель физ. урона: уровень × СИЛ. Тир оружия и профиль — отдельно. */
export function physPower2(level: number, a: AttrsIn): number {
  return (1 + levelGain(level, P.weaponDmg)) * (1 + inv(a.str) * ATTR2.str.physDmg);
}

/** Множитель магии (урон и лечение): уровень × ИНТ. */
export function magicPower2(level: number, a: AttrsIn): number {
  return (1 + levelGain(level, P.magicDmg)) * (1 + inv(a.int) * ATTR2.int.magic);
}

/** Мягкое затухание прироста без потолка (как в progression.ts). */
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
  return 1 + inv(a.agi) * ATTR2.agi.atkSpeed * share;
}

/** Множитель скорости каста (посох): уровень (рост гаснет) × МДР — линейно, как ЛОВ у физ. темпа. */
export function castTempo2(level: number, a: AttrsIn): number {
  return (1 + softGain(levelTempo(level) - 1, 1.8)) * (1 + inv(a.wis) * ATTR2.wis.cast);
}

/** Уворот: УДЧ (один предмет в руках — ×dodgeOneItem) + врождённый уворот ассасина с кинжалом (DAGGER.dodge). */
export function dodge2(a: AttrsIn, oneItem: boolean, dagger = false): number {
  const L = ATTR2.luc;
  return Math.min(L.dodgeCap, inv(a.luc) * L.dodge * (oneItem ? L.dodgeOneItem : 1) + (dagger ? DAGGER.dodge : 0));
}

export function critChance2(a: AttrsIn, weaponBase: number): number {
  return Math.min(0.75, weaponBase + inv(a.luc) * ATTR2.luc.crit);
}

export function critMult2(a: AttrsIn, weaponBase: number): number {
  return weaponBase + inv(a.luc) * ATTR2.luc.critDmg;
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
    name: WEAPON_NOUN.sword.name, dmg: 1.8, interval: 0.7, tempoSoft: 1, reach: 2.2, pierce: 1, // 1 → 1.8 (2026-10-05: воин слабейший, темп ПК приведён к общему)
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
    critBase: 0.12, critMult: 2, twoHanded: false, dmgType: "phys", tiers: [1, 4, 4.5],
  },
  // Копьё: длинный выпад конусом перед собой, обе руки.
  // dmg 2.1 → 1.45 (2026-10-02: удары больше не пропадают в «окне» моба — копьё стало вдвое сильнее медианы).
  spear: {
    name: WEAPON_NOUN.spear.name, dmg: 1.75, interval: 0.8, tempoSoft: 1, reach: 4.8, pierce: 3, // было 5 целей (2026-10-02)
    critBase: 0.05, critMult: 1.75, twoHanded: true, dmgType: "phys", tiers: [1, 4, 4.5],
  },
  // Молот: тяжёлый физический удар + магическая волна вокруг цели (HAMMER).
  hammer: {
    name: WEAPON_NOUN.hammer.name, dmg: 2.8, interval: 1.1, tempoSoft: 1, reach: 2.6, pierce: 1,
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
  return tier === "legendary" ? t[2] : tier === "gold" ? t[1] : t[0];
}

export const DAGGER = {
  /** Два кинжала: руки чередуются — темп ×, урон удара ×. */
  dualTempo: 1.35,
  dualDmg: 0.95,
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
  waveRadius: 3,
} as const;

/** Огнешар: доля урона по соседям (сплэш) — как в игре. */
export const STAFF_SPLASH = { frac: MAGIC.firebolt.splashFraction * 0.5, radius: 3 } as const;

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
  /** Сколько раз бьёт за применение (град — 5 залпов). */
  hits: number;
  /** Своё имя/описание у отдельных классов (одно умение — разный вид). */
  variants?: Partial<Record<ClassId, { name: string; desc: string }>>;
  /** 🧪 Тестовое умение — идёт отбор: имя с пометкой, может уйти на переделку. */
  test?: boolean;
  /** Атрибут, усиливающий само умение (сверх общих), и на сколько за вложенное очко. */
  attr?: { attr: Attr; per: number; what: string };
}

/**
 * «Сокрушение бури»: лечение героя и союзников рядом (доли максимума HP).
 * 2026-10-06: было 0.3 / 0.15 — боевой маг был сам себе лекарем и танком (три молота в катакомбах не умирали).
 */
export const STORM_CRUSH = { selfHeal: 0.15, allyHeal: 0.08 } as const;

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
    name: "Град стрел", icon: glyph("s.arrowRain"), desc: "Круг вдалеке: 5 залпов за 3 с, мобы в нём пригвождены",
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
      battlemage: { name: "Сокрушение бури", desc: `Прыжок и магический удар: волна по кругу, мобы замедлены на 3 с; лечит тебя на ${Math.round(STORM_CRUSH.selfHeal * 100)}% здоровья, союзников рядом — на ${Math.round(STORM_CRUSH.allyHeal * 100)}%` },
    },
  },
  seal: {
    name: "Печать света", icon: glyph("s.seal"), desc: "Круг на 6 с: союзникам лечение и щит −20% урона, врагам замедление 40%",
    cooldown: 18, castTime: 0.4, radius: 5, dmgMult: 0, hits: 1,
    variants: {
      warrior: { name: "Печать стража", desc: "Круг на 6 с: союзникам −40% урона, мобы в круге бросаются на воина" },
      battlemage: { name: "Грозовое поле", desc: "Круг на 6 с: молнии каждые 0.5 с бьют врагов внутри магией и замедляют" },
    },
  },
  whirlwind: {
    name: "Вихрь", icon: glyph("s.whirlwind"), desc: "2 с вращаешься с мечом: 5 ударов по всем вокруг, входящий урон −30%",
    cooldown: 14, castTime: 0, radius: 3.2, dmgMult: 0.9, hits: 5, // 0.7 → 0.9 (2026-10-05)
    variants: {
      spearman: { name: "Град выпадов", desc: "Серия из 8 быстрых выпадов копьём вперёд (длинный конус 6 м): каждый колет всех в секторе" },
      battlemage: { name: "Громовой вихрь", desc: "Молот по кругу: 5 магических ударов, каждый ещё бьёт молнией соседа в 7 м" },
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
    name: "Метка", icon: glyph("s.mark"), desc: "Цель 8 с: все атакующие (и ты сам) наносят ей +25% урона; умерла под меткой — откат сброшен",
    cooldown: 12, castTime: 0.2, radius: 22, dmgMult: 0, hits: 1,
    variants: {
      archer: { name: "Метка охотника", desc: "Цель 8 с: все атакующие (и ты сам) наносят ей +25% урона; умерла под меткой — откат сброшен" },
    },
  },
  plague: {
    name: "Чумной клинок", icon: glyph("s.plague"), test: true,
    desc: "Рывок к цели (до 6 м) и 8 с отравленных клинков: удар вешает стак яда (до 5); на 5 стаках взрыв ×0.4 удара заражает соседей (+2 стака) — яд ползёт по толпе",
    cooldown: 16, castTime: 0, radius: 5, dmgMult: 0.4, hits: 1,
    attr: { attr: "wis", per: 0.02, what: "сила яда" },
  },
  smoke: {
    name: "Пелена смерти", icon: glyph("s.smoke"), test: true,
    desc: "Дымовая бомба на цель (до 12 м; нет цели — под собой), дым 5 м на 6 с: мобы в дыму промахиваются в половине ударов, в стоящих в дыму не стреляют, союзникам в дыму +30% уворота",
    cooldown: 18, castTime: 0.2, radius: 5, dmgMult: 0, hits: 1,
    attr: { attr: "wis", per: 0.01, what: "длительность дыма" },
  },
  soulSteal: {
    name: "Кража душ", icon: glyph("s.soulSteal"), test: true,
    desc: "Удар насквозь: рывок сквозь цель (до 6 м) за спину, удар ×1.5; половина урона лечит самого раненого союзника рядом (все целы — тебя)",
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
      archer: { name: "Грозовая стрела", desc: "Стрела-молния: ×2.5 по первой цели, затем 2 слабых скачка" },
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
export function skillCdMul2(cls: ClassId | null, wis: number): number {
  return ((cls && CLASS_CD_MUL[cls]) || 1) / (1 + inv(wis) * ATTR2.wis.cast);
}

export function skillCooldownOf(id: SkillId, cls: ClassId | null): number {
  return Math.round(SKILLS2[id].cooldown * ((cls && CLASS_CD_MUL[cls]) || 1) * 10) / 10;
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
export const MARK = { duration: 8, dmgMul: 1.25, assassinCrit: 0.25, slow: 0.3 } as const;
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

/** Описание умения для класса + строка про свой атрибут (если есть) — единый текст для всех окон. */
export function skillDesc(id: SkillId, cls: ClassId): string {
  const sk = SKILLS2[id];
  const d = sk.variants?.[cls]?.desc ?? sk.desc;
  return sk.attr ? `${d}. ${ATTR_INFO[sk.attr.attr].name}: +${Math.round(sk.attr.per * 1000) / 10}% (${sk.attr.what}) за очко` : d;
}

/** Множитель умения от его атрибута (SkillDef.attr): 1 + вложенные очки × per. */
export function skillAttrMul(id: SkillId, a: Partial<Record<Attr, number>>): number {
  const at = SKILLS2[id].attr;
  return at ? 1 + Math.max(0, (a[at.attr] ?? 1) - ATTR2.start) * at.per : 1;
}

/** «Чумной клинок»: стак яда тикает stackSec, доля удара в секунду за стак; на maxStacks — взрыв. */
export const PLAGUE = {
  duration: 8, stackSec: 3, maxStacks: 5, tickFrac: 0.03, burstRadius: 5,
  /** Взрыв на 5 стаках не сжигает их; следующий взрыв того же моба — не раньше чем через burstCd с. */
  burstCd: 3,
  /** Взрыв заражает соседей в burstRadius: +spread стаков (цепочкой — их взрывы заражают дальше). */
  spread: 2,
  /** Применение — рывок к цели до dash м, удар сразу вешает openStacks стаков. */
  dash: 6,
  openStacks: 2,
} as const;
/** «Пелена смерти»: дым — промах мобов, запрет выстрелов, уворот союзникам. */
export const SMOKE = { duration: 6, miss: 0.5, dodge: 0.3, range: 12 } as const;
/** «Кража душ»: доля нанесённого урона в лечение; «все целы» — выше этой доли HP. */
/** «Кража душ»: удар насквозь — рывок к цели до reach м и дальше за спину на through м. */
/** Лучник «Стрела жизни»: лечение — доля нанесённого урона + доля своего макс. HP; бот стреляет ею, когда HP ниже botBelow. */
export const LIFE_ARROW = { healDmg: 0.5, healMax: 0.25, botBelow: 0.85 } as const;
export const SOUL_STEAL = { transfer: 0.5, healthy: 0.85, reach: 6, through: 3, dashTime: 0.22 } as const;
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
    perHit = w.dmg * magicPower2(h.level, a) * tierMul;
  } else {
    rate = physTempo2(h.level, a, w.tempoSoft) / w.interval;
    perHit = w.dmg * physPower2(h.level, a) * tierMul;
  }
  if (h.cls === "assassin") {
    if (h.dual) {
      rate *= DAGGER.dualTempo;
      perHit *= DAGGER.dualDmg;
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
    splash = HAMMER.waveMagic * magicPower2(h.level, a) * tierMul;
    splashType = "magic";
  } else if (h.cls === "support") {
    splash = hit * STAFF_SPLASH.frac;
    splashType = "magic";
  }
  const casterSkills = h.cls === "support" || h.cls === "battlemage";
  return {
    hp: maxHp2(h.level, a),
    armor: physArmor2(a),
    resist: magicResist2(a),
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
    power: casterSkills ? Math.max(hit, (WEAPONS2.staff.dmg * magicPower2(h.level, a) * tierMul) / 2) : hit,
    // Откат умений ускоряет только МДР (не уровень): иначе к 30+ ур. умения магов шли бы вдвое чаще.
    cdMul: casterSkills ? 1 / (1 + inv(a.wis) * ATTR2.wis.cast) : 1,
  };
}
