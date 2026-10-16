/**
 * Броня — три тира: обычный, золотой и уникальный (фиолетовый, тир «legendary» как у оружия). У обычного каждая часть
 * даёт ОДИН стат, выпадающий случайно из пула этой части. У золотого нагрудник и поножи — 1–2 стата, перчатки и сапоги —
 * 1 стат. У уникального нагрудник и поножи — 2–3 стата, остальные части — 1, пул части шире (ARMOR_POOL_LEGENDARY);
 * каждый аффикс сильнее обычного (ARMOR_TIER_MUL). Статы в одной части не повторяются. Лежит в общей сумке вместе с оружием и кольцами; заточка —
 * та же кривая, что у оружия (items.ts), её «качество» — среднее очков аффиксов части. Иконки — public/icons/armor
 * (верхний ряд атласа «Атлас фэнтезийных доспехов»).
 *
 * Модуль без серверных и клиентских зависимостей: им пользуются и сервер (ролл, лом, бонусы, заточка),
 * и клиент (подписи, сумка). Из items.ts берутся только заточка и максимум очков.
 */
import { enchantCurve, POINTS_MAX, type EnchantDeck, type EnchantInfo } from "./items";
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

/**
 * Статы брони. hp — доля макс. HP; physDef / magDef — доля урона; regen — доля макс. HP в секунду;
 * dodge — доля шанса уворота (общий потолок уворота не меняется).
 */
export type ArmorStat = "hp" | "physDef" | "magDef" | "regen" | "dodge";

export const ARMOR_STAT_NAME: Record<ArmorStat, string> = {
  hp: "Здоровье",
  physDef: "Физ. защита",
  magDef: "Маг. защита",
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

/** Пул уникального тира — на один стат шире обычного: из него выпадают аффиксы уникальной части. */
export const ARMOR_POOL_LEGENDARY: Record<ArmorPart, readonly ArmorStat[]> = {
  helm: ["hp", "magDef", "regen", "physDef"],
  chest: ["hp", "physDef", "regen", "magDef"],
  gloves: ["physDef", "dodge", "magDef", "hp"],
  legs: ["hp", "physDef", "magDef", "regen"],
  boots: ["dodge", "regen", "hp", "physDef"],
};

/** Пул стата части для тира: уникальный шире, остальные — ARMOR_POOL. */
export function armorPool(part: ArmorPart, tier: ArmorTier): readonly ArmorStat[] {
  return tier === "legendary" ? ARMOR_POOL_LEGENDARY[part] : ARMOR_POOL[part];
}

/** Диапазон значения стата у обычного тира (от 1 до 33 очков — как у роллов оружия). */
export const ARMOR_RANGE: Record<ArmorStat, readonly [number, number]> = {
  hp: [0.01, 0.03],
  physDef: [0.01, 0.03],
  magDef: [0.01, 0.03],
  regen: [0.0005, 0.0015],
  dodge: [0.005, 0.015],
};

/** Максимум очков — как у оружия (шкала заточки). */
export const ARMOR_POINTS_MAX = POINTS_MAX;

/**
 * Шанс упасть одной части ОБЫЧНОГО тира за убийство: обычный и элитный моб, босс — отдельный шанс.
 * Без угасания по уровню героя; в катакомбах падает так же.
 */
export const ARMOR_DROP = { regular: 0.01, elite: 0.02, boss: 0.2 } as const;

/** Тиры брони: обычный, золотой, уникальный (фиолетовый). Имена — как у оружия (TIER_LOOK). */
export type ArmorTier = "base" | "gold" | "legendary";

export const ARMOR_TIER_NAME: Record<ArmorTier, string> = { base: "обычная", gold: "золотая", legendary: "уникальная" };

/** Множитель значения КАЖДОГО аффикса по тиру. Золото — чуть сильнее обычного, уникальное — ещё чуть сильнее. */
export const ARMOR_TIER_MUL: Record<ArmorTier, number> = { base: 1, gold: 1.2, legendary: 1.3 };

/**
 * Золото. Аффиксов у нагрудника и поножей — 1 или 2 (два с шансом twoChance); у перчаток и сапог — всегда 1.
 * dropDiv — во сколько раз золотая часть падает реже обычной (с обычного и элитного моба); у босса золото
 * заменяет обычную часть — тот же шанс ARMOR_DROP.boss, выпадает золотая.
 */
export const ARMOR_GOLD = { twoChance: 0.3, dropDiv: 2 } as const;

/**
 * Уникальное. У нагрудника и поножей — 2 или 3 аффикса (3 с шансом threeChance); у остальных — 1. dropDiv — во сколько
 * раз реже золотой (тот же шанс от золота, у босса — ARMOR_DROP.boss / dropDiv).
 */
export const ARMOR_LEGENDARY = { threeChance: 0.5, dropDiv: 2 } as const;
const TWO_AFFIX_PARTS: readonly ArmorPart[] = ["chest", "legs"];

/** Шанс золотой части за убийство: обычный и элитный моб — в dropDiv раз реже обычной; босс — ARMOR_DROP.boss (вместо обычной). */
export function armorGoldDropChance(kind: "regular" | "elite" | "boss"): number {
  return kind === "boss" ? ARMOR_DROP.boss : ARMOR_DROP[kind] / ARMOR_GOLD.dropDiv;
}

/** Шанс уникальной части за убийство: в ARMOR_LEGENDARY.dropDiv раз реже золотой на том же типе моба (босс — 10%). */
export function armorLegendaryDropChance(kind: "regular" | "elite" | "boss"): number {
  return armorGoldDropChance(kind) / ARMOR_LEGENDARY.dropDiv;
}

/**
 * Уникальная часть по уровню моба: на 1-м уровне её не бывает, к 53-му (кость жнеца) шанс растёт линейно
 * и на 53-м — полный (как было до этого правила). Обычный моб — уровень 1 (eliteLevel 0).
 */
export const ARMOR_LEGENDARY_LEVEL = { from: 1, full: 53 } as const;

/** Множитель шанса уникальной части по уровню моба: 0 на ARMOR_LEGENDARY_LEVEL.from, 1 с ARMOR_LEGENDARY_LEVEL.full и выше. */
export function armorLegendaryLevelMul(level: number): number {
  const L = Math.max(1, level);
  const { from, full } = ARMOR_LEGENDARY_LEVEL;
  return Math.min(1, Math.max(0, (L - from) / (full - from)));
}

/** Один аффикс части: стат и очки ролла (1..33). */
export interface ArmorRoll {
  stat: ArmorStat;
  pts: number;
  /** Колода заточки этого свойства (см. enchantRoll в items.ts). */
  ench?: EnchantDeck;
}

/** Предмет брони: в сумке или надетый. */
export interface ArmorInstance {
  id: string;
  part: ArmorPart;
  tier: ArmorTier;
  /** Аффиксы части: у обычного тира — один; у золотого — 1–2 (нагрудник, поножи) или 1. */
  rolls: ArmorRoll[];
  /** ★ Избранное — как у оружия: не разбирается, не передаётся, в общем лимите ★ (FAV_MAX). */
  fav?: boolean;
}

/** Значение стата по очкам: линейно по диапазону (без учёта тира). */
export function armorValue(stat: ArmorStat, pts: number): number {
  const [lo, hi] = ARMOR_RANGE[stat];
  const p = Math.max(1, Math.min(ARMOR_POINTS_MAX, pts));
  return lo + ((hi - lo) * (p - 1)) / (ARMOR_POINTS_MAX - 1);
}

/** Значение одного аффикса части с учётом её тира. */
export function armorRollValue(a: { tier: ArmorTier }, r: ArmorRoll): number {
  return armorValue(r.stat, r.pts) * ARMOR_TIER_MUL[a.tier];
}

/** Текст значения для игрока: «+2.3%», для регенерации — «+0.10%/с». */
function valueText(stat: ArmorStat, value: number): string {
  const v = value * 100;
  return stat === "regen" ? `+${v.toFixed(2)}%/с` : `+${v.toFixed(1)}%`;
}

/** Все аффиксы части для текста: «Здоровье +2.3% · Физ. защита +1.5%». */
export function armorRollsText(a: ArmorInstance): string {
  return a.rolls.map((r) => `${ARMOR_STAT_NAME[r.stat]} ${valueText(r.stat, armorRollValue(a, r))}`).join(" · ");
}

/** Подпись предмета: «Шлем · Здоровье +2.3%», у золотого — «Нагрудник (золото) · …». */
export function armorLabel(a: ArmorInstance): string {
  const head = `${ARMOR_PART_NAME[a.part]}${a.tier === "gold" ? " (золото)" : a.tier === "legendary" ? " (уникальное)" : ""}`;
  return `${head} · ${armorRollsText(a)}`;
}

/**
 * Раскатать часть. Обычный тир — один стат из пула части. Золото — нагрудник и поножи с шансом twoChance
 * получают два стата (без повтора), остальные части — один. Очки каждого аффикса — случайно 1..33.
 */
export function rollArmor(part: ArmorPart, id: string, rnd: () => number = Math.random, tier: ArmorTier = "base"): ArmorInstance {
  const pool = [...armorPool(part, tier)];
  let count = 1;
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
  return { id, part, tier, rolls };
}

/**
 * Оценка части — СУММА очков её аффиксов, как у оружия (weaponQuality): у двух аффиксов — до 66.
 * Любой новый тир брони — так же: каждый аффикс — свои очки, своя строка заточки (armorEnchantRows).
 */
export function armorQuality(a: ArmorInstance): number {
  return a.rolls.reduce((s, r) => s + r.pts, 0);
}

/** Лом за один аффикс по тиру: от min при очках 1 до max при 33 (линейно, целое). Как ценник роллов: «1–4 за аффикс». */
export const ARMOR_SCRAP_RANGE: Record<ArmorTier, readonly [number, number]> = {
  base: [1, 4],
  gold: [2, 8],
  legendary: [4, 16],
};

/** Лом за разбор: сумма по аффиксам — каждый даёт ARMOR_SCRAP_RANGE своего тира, по очкам этого аффикса. */
export function armorScrap(a: ArmorInstance): number {
  const [lo, hi] = ARMOR_SCRAP_RANGE[a.tier];
  let sum = 0;
  for (const r of a.rolls) {
    const p = Math.max(1, Math.min(ARMOR_POINTS_MAX, r.pts));
    sum += Math.max(1, Math.round(lo + ((hi - lo) * (p - 1)) / (ARMOR_POINTS_MAX - 1)));
  }
  return sum;
}

/** Заточка одного аффикса idx (как ролл оружия): удача поднимает его очки на gain, не выше максимума. */
export function armorEnchant(a: ArmorInstance, idx: number, gain: number): void {
  const r = a.rolls[idx];
  if (r) r.pts = Math.min(ARMOR_POINTS_MAX, r.pts + gain);
}

/**
 * Цена заточки по тиру — множитель к общей кривой (items.ts). Обычная броня — в 5 раз дешевле, золотая — в 2 раза
 * дешевле обычной кривой. Шанс заточки не меняется.
 */
export const ARMOR_ENCHANT_COST_MUL: Record<ArmorTier, number> = { base: 1 / 5, gold: 1 / 2, legendary: 1 };

/**
 * Строка заточки аффикса idx — как строка ролла у оружия (enchantInfo): шанс по очкам ЭТОГО аффикса,
 * цена — от них же и от общего качества части (сумма / (33 × число аффиксов)), множитель — по тиру.
 */
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
    cost: Math.max(1, cost), // после кратного снижения низкие очки округлялись бы в ноль — заточка стала бы бесплатной
  };
}

/** Все строки заточки части — по одной на аффикс. */
export function armorEnchantRows(a: ArmorInstance): (EnchantInfo & { label: string })[] {
  return a.rolls.map((_, i) => armorEnchantRow(a, i)!);
}

/** Часть для окна сумки (PcInvArmor): подпись, лом и строка заточки — одинаково на сервере и на странице !inv. */
export function armorPcView(a: ArmorInstance): PcInvArmor {
  return {
    id: a.id,
    part: a.part,
    tier: a.tier,
    pts: armorQuality(a),
    rolls: a.rolls.length,
    scrap: armorScrap(a),
    label: armorLabel(a),
    ench: armorEnchantRows(a),
    fav: a.fav === true,
  };
}

/**
 * Сохранённый список брони → только корректные предметы (старые/битые записи пропускаем).
 * Старый формат (один стат и очки на часть) читается как один аффикс обычного тира.
 */
export function sanitizeArmorList(v: unknown): ArmorInstance[] {
  if (!Array.isArray(v)) return [];
  const out: ArmorInstance[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") continue;
    const a = x as { id?: unknown; part?: unknown; tier?: unknown; rolls?: unknown; stat?: unknown; pts?: unknown; fav?: unknown };
    if (typeof a.id !== "string" || !(ARMOR_PARTS as readonly unknown[]).includes(a.part)) continue;
    const part = a.part as ArmorPart;
    const tier: ArmorTier = a.tier === "gold" || a.tier === "legendary" ? a.tier : "base";
    const pool = armorPool(part, tier);
    const raw = (Array.isArray(a.rolls) ? a.rolls : [{ stat: a.stat, pts: a.pts }]) as { stat?: unknown; pts?: unknown }[];
    const rolls: ArmorRoll[] = [];
    // Аффиксов — сколько угодно в пределах пула части (будущие тиры с 3+ аффиксами не обрезаются).
    for (const r of raw.slice(0, pool.length)) {
      if (typeof r?.stat !== "string" || !pool.includes(r.stat as ArmorStat)) continue;
      if (rolls.some((x) => x.stat === r.stat)) continue;
      const pts = Number(r.pts);
      if (!Number.isFinite(pts)) continue;
      const roll: ArmorRoll = { stat: r.stat as ArmorStat, pts: Math.max(1, Math.min(ARMOR_POINTS_MAX, Math.round(pts))) };
      const e = (r as { ench?: EnchantDeck }).ench;
      if (e && typeof e.p === "number" && Number.isInteger(e.s) && Number.isInteger(e.f) && e.s >= 0 && e.f >= 0) roll.ench = { p: e.p, s: e.s, f: e.f };
      rolls.push(roll);
    }
    if (rolls.length === 0) continue;
    const inst: ArmorInstance = { id: a.id, part, tier, rolls };
    if (a.fav === true) inst.fav = true;
    out.push(inst);
  }
  return out;
}

/** Надетые части: по слотам из `worn` — те, что есть в списке сумки. */
export function wornArmorOf(list: readonly ArmorInstance[], worn: Partial<Record<ArmorPart, string>>): ArmorInstance[] {
  const out: ArmorInstance[] = [];
  for (const part of ARMOR_PARTS) {
    const a = list.find((x) => x.id === worn[part] && x.part === part);
    if (a) out.push(a);
  }
  return out;
}

/** Суммарный бонус надетой брони по каждому стату. */
export type ArmorBonus = Record<ArmorStat, number>;

export function armorBonusOf(worn: readonly ArmorInstance[]): ArmorBonus {
  const b: ArmorBonus = { hp: 0, physDef: 0, magDef: 0, regen: 0, dodge: 0 };
  for (const a of worn) for (const r of a.rolls) b[r.stat] += armorRollValue(a, r);
  return b;
}

/**
 * Бонус брони героя по стату — из поля `ab` состояния игрока (синхронизируется с сервером).
 * Нет поля — ноль, так что старые расчёты без брони не меняются.
 */
export function armorBonus(a: object, stat: ArmorStat): number {
  const ab = (a as { ab?: Partial<Record<ArmorStat, number>> }).ab;
  const v = ab ? ab[stat] : undefined;
  return typeof v === "number" ? v : 0;
}
