/**
 * Броня — этап 1: обычный тир, пять частей. Каждая часть даёт ОДИН стат, выпадающий случайно из пула
 * этой части. Лежит в общей сумке вместе с оружием и кольцами; заточка — та же кривая, что у оружия
 * (items.ts). Иконки — public/icons/armor (верхний ряд атласа «Атлас фэнтезийных доспехов»).
 *
 * Модуль без серверных и клиентских зависимостей: им пользуются и сервер (ролл, лом, бонусы, заточка),
 * и клиент (подписи, сумка). Из items.ts берутся только заточка и максимум очков.
 */
import { enchantCurve, POINTS_MAX, type EnchantInfo } from "./items";
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

/** Пул стата по части: из него выпадает один — случайно. */
export const ARMOR_POOL: Record<ArmorPart, readonly ArmorStat[]> = {
  helm: ["hp", "magDef", "regen"],
  chest: ["hp", "physDef", "regen"],
  gloves: ["physDef", "dodge", "magDef"],
  legs: ["hp", "physDef", "magDef"],
  boots: ["dodge", "regen", "hp"],
};

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
 * Шанс упасть одной части обычного тира за убийство: обычный и элитный моб, босс — отдельный шанс.
 * Без угасания по уровню героя; в катакомбах падает так же.
 */
export const ARMOR_DROP = { regular: 0.01, elite: 0.02, boss: 0.2 } as const;

/** Предмет брони: в сумке или надетый. */
export interface ArmorInstance {
  id: string;
  part: ArmorPart;
  /** Тир. Пока только обычный; золотой/уникальный/рубиновый/эпический — следующими этапами. */
  tier: "base";
  stat: ArmorStat;
  /** Очки ролла, 1..33. */
  pts: number;
  /** ★ Избранное — как у оружия: не разбирается, не передаётся, в общем лимите ★ (FAV_MAX). */
  fav?: boolean;
}

/** Значение стата по очкам: линейно по диапазону. */
export function armorValue(stat: ArmorStat, pts: number): number {
  const [lo, hi] = ARMOR_RANGE[stat];
  const p = Math.max(1, Math.min(ARMOR_POINTS_MAX, pts));
  return lo + ((hi - lo) * (p - 1)) / (ARMOR_POINTS_MAX - 1);
}

/** Текст значения для игрока: «+2.3%», для регенерации — «+0.10%/с». */
export function armorValueText(stat: ArmorStat, pts: number): string {
  const v = armorValue(stat, pts) * 100;
  return stat === "regen" ? `+${v.toFixed(2)}%/с` : `+${v.toFixed(1)}%`;
}

/** Подпись предмета: «Шлем · Здоровье +2.3%». */
export function armorLabel(a: ArmorInstance): string {
  return `${ARMOR_PART_NAME[a.part]} · ${ARMOR_STAT_NAME[a.stat]} ${armorValueText(a.stat, a.pts)}`;
}

/** Раскатать часть: случайный стат из её пула, случайные очки 1..33. */
export function rollArmor(part: ArmorPart, id: string, rnd: () => number = Math.random): ArmorInstance {
  const pool = ARMOR_POOL[part];
  const stat = pool[Math.floor(rnd() * pool.length)];
  const pts = 1 + Math.floor(rnd() * ARMOR_POINTS_MAX);
  return { id, part, tier: "base", stat, pts };
}

/** Лом за разбор: 1 + округлённые очки / 11 — от 1 до 4 у обычной брони. */
export function armorScrap(a: ArmorInstance): number {
  return 1 + Math.round(a.pts / 11);
}

/** Строка заточки брони (как строка ролла у оружия): шкала 1..33, та же кривая шанса и цены; «качество» — очки части. */
export function armorEnchantRow(a: ArmorInstance): EnchantInfo & { label: string } {
  const { chance, cost } = enchantCurve(a.pts, a.pts / POINTS_MAX);
  return {
    label: `${ARMOR_STAT_NAME[a.stat]} ${armorValueText(a.stat, a.pts)}`,
    points: a.pts,
    of: POINTS_MAX,
    max: a.pts >= ARMOR_POINTS_MAX,
    chance,
    cost,
  };
}

/** Часть для окна сумки (PcInvArmor): подпись, лом и строка заточки — одинаково на сервере и на странице !inv. */
export function armorPcView(a: ArmorInstance): PcInvArmor {
  return { id: a.id, part: a.part, stat: a.stat, pts: a.pts, scrap: armorScrap(a), label: armorLabel(a), ench: [armorEnchantRow(a)], fav: a.fav === true };
}

/** Сохранённый список брони → только корректные предметы (старые/битые записи пропускаем). */
export function sanitizeArmorList(v: unknown): ArmorInstance[] {
  if (!Array.isArray(v)) return [];
  const out: ArmorInstance[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") continue;
    const a = x as { id?: unknown; part?: unknown; stat?: unknown; pts?: unknown; fav?: unknown };
    if (typeof a.id !== "string" || !(ARMOR_PARTS as readonly unknown[]).includes(a.part)) continue;
    if (typeof a.stat !== "string" || !(a.stat in ARMOR_RANGE)) continue;
    const pts = Number(a.pts);
    if (!Number.isFinite(pts)) continue;
    const inst: ArmorInstance = { id: a.id, part: a.part as ArmorPart, tier: "base", stat: a.stat as ArmorStat, pts: Math.max(1, Math.min(ARMOR_POINTS_MAX, Math.round(pts))) };
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
  for (const a of worn) b[a.stat] += armorValue(a.stat, a.pts);
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
