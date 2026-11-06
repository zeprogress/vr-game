/**
 * Броня 2.0: пять частей, четыре грейда и три веса.
 *
 * В отличие от прежней системы, защита хранится числами:
 *   • physDef — плоская Броня (физ. защита);
 *   • magDef  — плоское Сопротивление магии;
 *   • hp      — плоское здоровье;
 *   • regen   — плоское HP/с;
 *   • dodge   — шанс уворота (остаётся процентом).
 *
 * Вес задаёт характер брони и скорость: лёгкая — быстрая и антимагическая,
 * средняя — с высокой скоростью атаки, тяжёлая — физический танк.
 *
 * Модуль без серверных и клиентских зависимостей: им пользуются и сервер
 * (ролл, лом, бонусы, заточка), и клиент (подписи, сумка).
 */
import { enchantCurve, POINTS_MAX, RUBY, type EnchantDeck, type EnchantInfo } from "./items";
import type { PcInvArmor } from "./net/messages";

export const ARMOR_PARTS = ["helm", "chest", "gloves", "legs", "boots"] as const;
export type ArmorPart = (typeof ARMOR_PARTS)[number];

export const ARMOR_PART_NAME: Record<ArmorPart, string> = {
  helm: "Шлем",
  chest: "Нагрудник",
  gloves: "Перчатки",
  legs: "Поножи",
  boots: "Сапоги",
};

/** Вес брони — отдельно от грейда. */
export type ArmorWeight = "light" | "medium" | "heavy";
export const ARMOR_WEIGHTS: readonly ArmorWeight[] = ["light", "medium", "heavy"];

export const ARMOR_WEIGHT_NAME: Record<ArmorWeight, string> = {
  light: "лёгкая",
  medium: "средняя",
  heavy: "тяжёлая",
};

/** Какие веса бывают у грейда. */
export const ARMOR_WEIGHTS_BY_TIER: Record<ArmorTier, readonly ArmorWeight[]> = {
  base: ["medium"],
  gold: ["light", "heavy"],
  legendary: ["light", "medium", "heavy"],
  ruby: ["light", "medium", "heavy"],
};

export function armorWeightsFor(tier: ArmorTier): readonly ArmorWeight[] {
  return ARMOR_WEIGHTS_BY_TIER[tier] ?? ARMOR_WEIGHTS_BY_TIER.base;
}

/**
 * Статы-роллы. Имена оставлены прежними ради совместимости сейвов и схемы,
 * но physDef/magDef/hp/regen теперь числа, а не проценты.
 */
export type ArmorStat = "hp" | "physDef" | "magDef" | "regen" | "dodge";

export const ARMOR_STATS: readonly ArmorStat[] = ["hp", "physDef", "magDef", "regen", "dodge"];

export function sortArmorRolls(list: ArmorRoll[]): void {
  list.sort((a, b) => ARMOR_STATS.indexOf(a.stat) - ARMOR_STATS.indexOf(b.stat));
}

export const ARMOR_STAT_NAME: Record<ArmorStat, string> = {
  hp: "Здоровье",
  physDef: "Броня",
  magDef: "Маг. сопротивление",
  regen: "Регенерация",
  dodge: "Уворот",
};

/** Пул стата по части: из него выпадают аффиксы части — случайно, без повторов в одной части. */
export const ARMOR_POOL: Record<ArmorPart, readonly ArmorStat[]> = {
  helm: ["hp", "magDef", "regen"],
  chest: ["hp", "physDef", "regen"],
  gloves: ["physDef", "dodge", "magDef"],
  legs: ["hp", "physDef", "magDef"],
  boots: ["dodge", "regen", "hp"],
};

/** Пул уникального тира — на один стат шире обычного. */
export const ARMOR_POOL_LEGENDARY: Record<ArmorPart, readonly ArmorStat[]> = {
  helm: ["hp", "magDef", "regen", "physDef"],
  chest: ["hp", "physDef", "regen", "magDef"],
  gloves: ["physDef", "dodge", "magDef", "hp"],
  legs: ["hp", "physDef", "magDef", "regen"],
  boots: ["dodge", "regen", "hp", "physDef"],
};

export function armorPool(part: ArmorPart, tier: ArmorTier): readonly ArmorStat[] {
  if (tier === "ruby") return ARMOR_STATS;
  return tier === "legendary" ? ARMOR_POOL_LEGENDARY[part] : ARMOR_POOL[part];
}

/**
 * Базовый вклад одной части за единицу коэффициента слота. Вес — это не
 * «просто ещё один ролл»: он задаёт и защиту, и скорость.
 */
export const ARMOR_WEIGHT_BASE: Record<ArmorWeight, {
  armor: number;
  resist: number;
  hp: number;
  regen: number;
  dodge: number;
  move: number;
  atk: number;
}> = {
  light: { armor: 10, resist: 24, hp: 8, regen: 0.08, dodge: 0.005, move: 0.02, atk: 0 },
  medium: { armor: 18, resist: 18, hp: 16, regen: 0.11, dodge: 0, move: 0, atk: 0.015 },
  // Маг. защита тяжёлой равна средней; уворот — минус, это её цена.
  heavy: { armor: 30, resist: 18, hp: 24, regen: 0.14, dodge: -0.005, move: -0.02, atk: -0.02 },
};

/** Защита с вещей: физ. и маг. защита всей брони удвоены (2026-11-07; было 15% от исходной). */
export const ARMOR_DEF_MUL = 0.3;
/** Чистая регенерация HP/с с брони: базовые значения и роллы усилены в 25 раз. */
export const ARMOR_REGEN_MUL = 25;

/** Вклад части в общий сет: нагрудник — 1.0, перчатки — 0.45. */
export const ARMOR_SLOT_FACTOR: Record<ArmorPart, number> = {
  chest: 1.0,
  legs: 0.8,
  helm: 0.6,
  boots: 0.55,
  gloves: 0.45,
};

export type ArmorTier = "base" | "gold" | "legendary" | "ruby";
export const ARMOR_TIERS: readonly ArmorTier[] = ["base", "gold", "legendary", "ruby"];

export const ARMOR_TIER_NAME: Record<ArmorTier, string> = {
  base: "обычная",
  gold: "золотая",
  legendary: "уникальная",
  ruby: "рубиновая",
};

export const ARMOR_TIER_MUL: Record<ArmorTier, number> = { base: 1, gold: 1.2, legendary: 1.35, ruby: 1.5 };

/** Уровень предмета: 1 + 3.5% за уровень. */
export function armorLevelScale(level: number): number {
  return 1 + 0.035 * Math.max(0, Math.floor(level) - 1);
}

/** Максимум очков — как у оружия (шкала заточки). */
export const ARMOR_POINTS_MAX = POINTS_MAX;

/**
 * Плоские значения одного аффикса по очкам (1..33). Сумма на части умножается
 * на грейд и уровень; это делает числа сопоставимыми с Бронёй на любой стадии.
 */
export const ARMOR_RANGE: Record<ArmorStat, readonly [number, number]> = {
  hp: [0.55, 18],
  physDef: [0.55, 18],
  magDef: [0.67, 22],
  regen: [0.004, 0.12],
  dodge: [0.0002, 0.006],
};

/** Шанс упасть части обычного тира за убийство. */
export const ARMOR_DROP = { regular: 0.01, elite: 0.02, boss: 0.2 } as const;

export const ARMOR_GOLD = { twoChance: 0.3, dropDiv: 2 } as const;
export const ARMOR_LEGENDARY = { threeChance: 0.5, dropDiv: 2 } as const;
const TWO_AFFIX_PARTS: readonly ArmorPart[] = ["chest", "legs"];

export const ARMOR_RUBY = {
  affixes: { helm: [1, 2], chest: [3, 4], gloves: [1, 2], legs: [2, 3], boots: [1, 2] } as Record<ArmorPart, readonly [number, number]>,
  moreChance: 0.5,
  dropChance: RUBY.dropChance * 2,
} as const;

export function armorGoldDropChance(kind: "regular" | "elite" | "boss"): number {
  return kind === "boss" ? ARMOR_DROP.boss : ARMOR_DROP[kind] / ARMOR_GOLD.dropDiv;
}

export function armorLegendaryDropChance(kind: "regular" | "elite" | "boss"): number {
  return armorGoldDropChance(kind) / ARMOR_LEGENDARY.dropDiv;
}

export const ARMOR_LEVEL_GATE = {
  gold: { from: 1, full: 53 },
  legendary: { from: 1, full: 53 },
} as const;

export function armorLevelMul(level: number, gate: { from: number; full: number }): number {
  const L = Math.max(1, level);
  return Math.min(1, Math.max(0, (L - gate.from) / (gate.full - gate.from)));
}

export function levelFadeMul(level: number, from: number, to: number): number {
  return 1 - armorLevelMul(level, { from, full: to });
}

/** Окно уровня с затуханием: до from — 0, на from — 1, к to — 0, после to — 0. */
export function levelWindowMul(level: number, from: number, to: number): number {
  if (level < from || level >= to) return 0;
  return 1 - (level - from) / (to - from);
}

/** Разгон: до from — 0, от from до full растёт 0→1, после full — 1. */
export function levelRampMul(level: number, from: number, full: number): number {
  if (level < from) return 0;
  if (level >= full) return 1;
  return (level - from) / (full - from);
}

/** Горб: 0 до from, разгон до 1 на peak, затухание к 0 на to и после. */
export function levelRiseFallMul(level: number, from: number, peak: number, to: number): number {
  if (level < from || level >= to) return 0;
  if (level < peak) return (level - from) / (peak - from);
  return 1 - (level - peak) / (to - peak);
}

export function armorBaseLevelMul(level: number): number {
  return 1 - armorLevelMul(level, { from: 1, full: 53 });
}

export interface ArmorRoll {
  stat: ArmorStat;
  pts: number;
  /** Колода заточки этого свойства. */
  ench?: EnchantDeck;
}

export interface ArmorInstance {
  id: string;
  part: ArmorPart;
  tier: ArmorTier;
  weight: ArmorWeight;
  /** Уровень моба/предмета: 1..75 в текущем мире. */
  lvl: number;
  rolls: ArmorRoll[];
  fav?: boolean;
}

/** Все числовые бонусы брони, включая скорости от веса. */
export type ArmorBonus = Record<"hp" | "physDef" | "magDef" | "regen" | "dodge" | "move" | "atk", number>;

export function emptyArmorBonus(): ArmorBonus {
  return { hp: 0, physDef: 0, magDef: 0, regen: 0, dodge: 0, move: 0, atk: 0 };
}

/** Базовые числа части — без роллов. */
export function armorBaseStats(a: ArmorInstance): ArmorBonus {
  const w = ARMOR_WEIGHT_BASE[a.weight] ?? ARMOR_WEIGHT_BASE.medium;
  const k = ARMOR_SLOT_FACTOR[a.part] * ARMOR_TIER_MUL[a.tier] * armorLevelScale(a.lvl);
  return {
    hp: w.hp * k,
    physDef: w.armor * k * ARMOR_DEF_MUL,
    magDef: w.resist * k * ARMOR_DEF_MUL,
    regen: w.regen * k * ARMOR_REGEN_MUL,
    // Уворот не растёт от уровня: это фиксированный характер веса.
    dodge: w.dodge * ARMOR_TIER_MUL[a.tier],
    move: w.move,
    atk: w.atk,
  };
}

export function armorValue(stat: ArmorStat, pts: number): number {
  const [lo, hi] = ARMOR_RANGE[stat];
  const p = Math.max(1, Math.min(ARMOR_POINTS_MAX, pts));
  return lo + ((hi - lo) * (p - 1)) / (ARMOR_POINTS_MAX - 1);
}

/** Значение одного ролла с учётом грейда/уровня. */
export function armorRollValue(a: Pick<ArmorInstance, "tier"> & Partial<Pick<ArmorInstance, "lvl">>, r: ArmorRoll): number {
  const scale = r.stat === "dodge" ? 1 : ARMOR_TIER_MUL[a.tier] * armorLevelScale(a.lvl ?? 1);
  const defMul = r.stat === "physDef" || r.stat === "magDef" ? ARMOR_DEF_MUL : 1;
  const regenMul = r.stat === "regen" ? ARMOR_REGEN_MUL : 1;
  return armorValue(r.stat, r.pts) * scale * defMul * regenMul;
}

function valueText(stat: ArmorStat, value: number): string {
  if (stat === "hp") return `+${Math.round(value)}`;
  if (stat === "physDef") return `+${Math.round(value)}`;
  if (stat === "magDef") return `+${Math.round(value)}`;
  if (stat === "regen") return `+${value.toFixed(2)}/с`;
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

/** Суммарные числа части (база + роллы) — для подписи и сравнения. */
export function armorStats(a: ArmorInstance): ArmorBonus {
  const b = armorBaseStats(a);
  for (const r of a.rolls) b[r.stat] += armorRollValue(a, r);
  return b;
}

export function armorRollsText(a: ArmorInstance): string {
  return a.rolls.map((r) => `${ARMOR_STAT_NAME[r.stat]} ${valueText(r.stat, armorRollValue(a, r))}`).join(" · ");
}

export function armorStatsText(a: ArmorInstance): string {
  const b = armorStats(a);
  const speed = [
    b.move ? `Бег ${b.move > 0 ? "+" : ""}${Math.round(b.move * 100)}%` : "",
    b.atk ? `Атака ${b.atk > 0 ? "+" : ""}${Math.round(b.atk * 100)}%` : "",
    b.dodge ? `Уворот ${b.dodge > 0 ? "+" : ""}${(b.dodge * 100).toFixed(1)}%` : "",
  ].filter(Boolean).join(" · ");
  return `Броня ${Math.round(b.physDef)} · Маг. сопр. ${Math.round(b.magDef)} · HP +${Math.round(b.hp)} · Реген ${b.regen.toFixed(2)}/с${speed ? ` · ${speed}` : ""}`;
}

/** Короткое имя: без слов «лёгкая/средняя/тяжёлая» — вес только в описании. */
export function armorName(a: Pick<ArmorInstance, "part" | "tier" | "weight">): string {
  const noun = ARMOR_NOUN[a.weight][a.part];
  const adj = ARMOR_TIER_ADJ[a.tier];
  const name = adj ? `${adj[noun.g]} ${noun.name}` : noun.name;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function armorWeightName(weight: ArmorWeight): string {
  return ARMOR_WEIGHT_NAME[weight];
}

/** Описание без названия: вес и числа — чтобы не дублировать имя в карточке. */
export function armorDescription(a: ArmorInstance): string {
  return `Вес: ${armorWeightName(a.weight)} · ${armorStatsText(a)}`;
}

export function armorLabel(a: ArmorInstance): string {
  return `${armorName(a)} · ${armorDescription(a)}`;
}

/** Рубиновое/уникальное/золотое — приставка к короткому имени. */
const ARMOR_TIER_ADJ: Record<ArmorTier, Record<"m" | "f" | "n", string> | null> = {
  base: null,
  gold: { m: "Золотой", f: "Золотая", n: "Золотое" },
  legendary: { m: "Уникальный", f: "Уникальная", n: "Уникальное" },
  ruby: { m: "Рубиновый", f: "Рубиновая", n: "Рубиновое" },
};

const ARMOR_NOUN: Record<ArmorWeight, Record<ArmorPart, { name: string; g: "m" | "f" | "n" }>> = {
  light: {
    helm: { name: "кожаный капюшон", g: "m" },
    chest: { name: "стёганая куртка", g: "f" },
    gloves: { name: "кожаные перчатки", g: "n" },
    legs: { name: "кожаные штаны", g: "n" },
    boots: { name: "кожаные сапоги", g: "n" },
  },
  medium: {
    helm: { name: "кольчужный шлем", g: "m" },
    chest: { name: "кольчужная кираса", g: "f" },
    gloves: { name: "кольчужные рукавицы", g: "n" },
    legs: { name: "кольчужные поножи", g: "n" },
    boots: { name: "кольчужные сапоги", g: "n" },
  },
  heavy: {
    helm: { name: "латный шлем", g: "m" },
    chest: { name: "латная кираса", g: "f" },
    gloves: { name: "латные рукавицы", g: "n" },
    legs: { name: "латные поножи", g: "n" },
    boots: { name: "латные сапоги", g: "n" },
  },
};

export function armorBaseName(part: ArmorPart, weight: ArmorWeight): string {
  return ARMOR_NOUN[weight][part].name;
}

/** Раскатать часть. Грейд задаёт доступные веса; вес можно передать явно. */
export function rollArmor(
  part: ArmorPart,
  id: string,
  rnd: () => number = Math.random,
  tier: ArmorTier = "base",
  weight?: ArmorWeight,
  lvl = 1,
): ArmorInstance {
  const allowed = armorWeightsFor(tier);
  const w = weight && allowed.includes(weight)
    ? weight
    : allowed[Math.min(allowed.length - 1, Math.floor(rnd() * allowed.length))];
  const pool = [...armorPool(part, tier)];
  const [less, more] = ARMOR_RUBY.affixes[part];
  let count = tier === "ruby" ? (rnd() < ARMOR_RUBY.moreChance ? more : less) : 1;
  if (TWO_AFFIX_PARTS.includes(part)) {
    if (tier === "gold" && rnd() < ARMOR_GOLD.twoChance) count = 2;
    if (tier === "legendary") count = rnd() < ARMOR_LEGENDARY.threeChance ? 3 : 2;
  }
  const rolls: ArmorRoll[] = [];
  for (let i = 0; i < count; i++) {
    const stat = pool.splice(Math.floor(rnd() * pool.length), 1)[0] as ArmorStat;
    const pts = 1 + Math.floor(rnd() * ARMOR_POINTS_MAX);
    rolls.push({ stat, pts });
  }
  sortArmorRolls(rolls);
  return { id, part, tier, weight: w, lvl: Math.max(1, Math.floor(lvl) || 1), rolls };
}

export function armorQuality(a: ArmorInstance): number {
  return a.rolls.reduce((s, r) => s + r.pts, 0);
}

export const ARMOR_SCRAP_RANGE: Record<ArmorTier, readonly [number, number]> = {
  base: [1, 4],
  gold: [2, 8],
  legendary: [4, 16],
  ruby: [400, 1600],
};

export function armorScrap(a: ArmorInstance): number {
  const [lo, hi] = ARMOR_SCRAP_RANGE[a.tier];
  let sum = 0;
  for (const r of a.rolls) {
    const p = Math.max(1, Math.min(ARMOR_POINTS_MAX, r.pts));
    sum += Math.max(1, Math.round(lo + ((hi - lo) * (p - 1)) / (ARMOR_POINTS_MAX - 1)));
  }
  return sum;
}

export function armorEnchant(a: ArmorInstance, idx: number, gain: number): void {
  const r = a.rolls[idx];
  if (r) r.pts = Math.min(ARMOR_POINTS_MAX, r.pts + gain);
}

export const ARMOR_ENCHANT_COST_MUL: Record<ArmorTier, number> = { base: 1 / 5, gold: 1 / 2, legendary: 1, ruby: 8 };

export function armorEnchantRow(a: ArmorInstance, idx: number): (EnchantInfo & { label: string }) | null {
  const r = a.rolls[idx];
  if (!r) return null;
  const q = armorQuality(a) / (POINTS_MAX * a.rolls.length);
  const { chance, cost } = enchantCurve(r.pts, q, ARMOR_ENCHANT_COST_MUL[a.tier]);
  return {
    label: `${ARMOR_STAT_NAME[r.stat]} ${valueText(r.stat, armorRollValue(a, r))}`,
    points: r.pts,
    of: POINTS_MAX,
    max: r.pts >= ARMOR_POINTS_MAX,
    chance,
    cost: Math.max(1, cost),
  };
}

export function armorEnchantRows(a: ArmorInstance): (EnchantInfo & { label: string })[] {
  return a.rolls.map((_, i) => armorEnchantRow(a, i)!);
}

export function armorPcView(a: ArmorInstance): PcInvArmor {
  return {
    id: a.id,
    part: a.part,
    tier: a.tier,
    pts: armorQuality(a),
    rolls: a.rolls.length,
    scrap: armorScrap(a),
    name: armorName(a),
    desc: armorDescription(a),
    label: armorLabel(a),
    weight: a.weight,
    lvl: a.lvl,
    ench: armorEnchantRows(a),
    fav: a.fav === true,
  };
}

export function sanitizeArmorList(v: unknown): ArmorInstance[] {
  if (!Array.isArray(v)) return [];
  const out: ArmorInstance[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") continue;
    const a = x as {
      id?: unknown; part?: unknown; tier?: unknown; weight?: unknown; lvl?: unknown;
      rolls?: unknown; stat?: unknown; pts?: unknown; fav?: unknown;
    };
    if (typeof a.id !== "string" || !(ARMOR_PARTS as readonly unknown[]).includes(a.part)) continue;
    const part = a.part as ArmorPart;
    const tier: ArmorTier = (ARMOR_TIERS as readonly unknown[]).includes(a.tier) ? (a.tier as ArmorTier) : "base";
    const allowed = armorWeightsFor(tier);
    const weight: ArmorWeight = allowed.includes(a.weight as ArmorWeight) ? (a.weight as ArmorWeight) : allowed[0];
    const pool = armorPool(part, tier);
    const raw = (Array.isArray(a.rolls) ? a.rolls : [{ stat: a.stat, pts: a.pts }]) as { stat?: unknown; pts?: unknown }[];
    const rolls: ArmorRoll[] = [];
    for (const r of raw.slice(0, pool.length)) {
      if (typeof r?.stat !== "string" || !pool.includes(r.stat as ArmorStat)) continue;
      if (rolls.some((y) => y.stat === r.stat)) continue;
      const pts = Number(r.pts);
      if (!Number.isFinite(pts)) continue;
      const roll: ArmorRoll = { stat: r.stat as ArmorStat, pts: Math.max(1, Math.min(ARMOR_POINTS_MAX, Math.round(pts))) };
      const e = (r as { ench?: EnchantDeck }).ench;
      if (e && typeof e.p === "number" && Number.isInteger(e.s) && Number.isInteger(e.f) && e.s >= 0 && e.f >= 0) roll.ench = { p: e.p, s: e.s, f: e.f };
      rolls.push(roll);
    }
    if (rolls.length === 0) continue;
    sortArmorRolls(rolls);
    const inst: ArmorInstance = {
      id: a.id,
      part,
      tier,
      weight,
      lvl: Math.max(1, Math.floor(Number(a.lvl)) || 1),
      rolls,
    };
    if (a.fav === true) inst.fav = true;
    out.push(inst);
  }
  return out;
}

export function wornArmorOf(list: readonly ArmorInstance[], worn: Partial<Record<ArmorPart, string>>): ArmorInstance[] {
  const out: ArmorInstance[] = [];
  for (const part of ARMOR_PARTS) {
    const a = list.find((x) => x.id === worn[part] && x.part === part);
    if (a) out.push(a);
  }
  return out;
}

export function armorBonusOf(worn: readonly ArmorInstance[]): ArmorBonus {
  const b = emptyArmorBonus();
  for (const a of worn) {
    const base = armorBaseStats(a);
    for (const k of Object.keys(base) as (keyof ArmorBonus)[]) b[k] += base[k];
    for (const r of a.rolls) b[r.stat] += armorRollValue(a, r);
  }
  return b;
}

export function armorBonus(a: object, stat: keyof ArmorBonus): number {
  const ab = (a as { ab?: Partial<Record<keyof ArmorBonus, number>> }).ab;
  const v = ab ? ab[stat] : undefined;
  return typeof v === "number" ? v : 0;
}
