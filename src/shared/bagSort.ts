/**
 * Сортировка сумки — оружие, кольца и броня вместе. Одна на ПК, телефон и VR-склад, чтобы порядок везде совпадал.
 * Броня (shared/armor.ts) — в самом конце, после колец.
 *
 *  - «По оценке»: оружие — по оценке (выше сверху); кольца — после оружия, по тиру, внутри по лому.
 *  - «По типу»: по виду оружия (TYPE_ORDER); кольца — в конце. Внутри вида — как «По оценке». Кнопка «По классу» убрана 2026-10-14 (код режима class остался).
 *  - «★ сначала»: избранное сверху, внутри — как «По оценке».
 *  - Без сортировки: как пришло — сначала оружие, потом кольца.
 */
import type { WeaponClass, WeaponTier } from "./items";
import { CLASS_OF_WEAPON, type ClassId } from "./classes2";
import { RING_TIERS, type RingTier } from "./jewels";
import { ARMOR_PARTS, type ArmorPart } from "./armor";

/** Включённая сортировка; none — как пришло. */
export type BagSort = "none" | "quality" | "type" | "class" | "fav";
export type BagSortMode = Exclude<BagSort, "none">;

/** Кнопки сортировки в шапке сумки: подпись и подсказка. */
export const BAG_SORTS: readonly { mode: BagSortMode; label: string; title: string }[] = [
  { mode: "quality", label: "По оценке", title: "Оружие — по оценке, выше сверху. Кольца — после оружия, по тиру" },
  { mode: "type", label: "По типу", title: "Вид оружия: меч, щит, кинжал, копьё, молот, лук, посох. Кольца — в конце" },
  { mode: "fav", label: "★ Сначала", title: "Избранное ★ — сверху, дальше как «По оценке»" },
];

/** Порядок видов оружия в «По типу». */
export const TYPE_ORDER: readonly WeaponClass[] = ["sword", "shield", "dagger", "spear", "hammer", "bow", "staff"];
/** Порядок классов в «По классу». */
export const CLASS_ORDER: readonly ClassId[] = ["warrior", "assassin", "spearman", "battlemage", "archer", "support"];

/** Что сортировке нужно знать о предмете. Нет weapon — кольцо. */
export interface BagSortItem {
  weapon?: WeaponClass;
  /** Броня: сортируется по лому, после колец; в «По типу» — по части (шлем, нагрудник, …). */
  armor?: true;
  armorPart?: ArmorPart;
  tier: WeaponTier | RingTier;
  quality: number;
  scrap: number;
  /** ★ Избранное. */
  fav?: boolean;
}

/** Предмет сумки или склада: оружие (w), кольцо (r) или броня (a). Поля — те же, что у записей окна инвентаря. */
export type BagPick =
  | { w: { cls: WeaponClass; tier: WeaponTier; quality: number; scrap?: number; fav?: boolean } }
  | { r: { tier: RingTier; scrap: number; fav?: boolean } }
  | { a: { part: ArmorPart; pts: number; scrap: number; fav?: boolean } };

/** Что сортировке знать о предмете: из полей оружия, кольца или брони. */
export function bagPickItem(e: BagPick): BagSortItem {
  if ("w" in e) return { weapon: e.w.cls, tier: e.w.tier, quality: e.w.quality, scrap: e.w.scrap ?? 0, fav: !!e.w.fav };
  if ("a" in e) return { armor: true, armorPart: e.a.part, tier: "base", quality: e.a.pts, scrap: e.a.scrap, fav: !!e.a.fav };
  return { tier: e.r.tier, quality: 0, scrap: e.r.scrap, fav: !!e.r.fav };
}

/** Группа по виду: кольца и неизвестное — перед бронёй, броня — в самом конце. */
function typeGroup(x: BagSortItem): number {
  // Оружие — по виду; кольца — после него; броня — в самом конце, по части (шлем, нагрудник, перчатки, поножи, сапоги).
  if (x.armor) return TYPE_ORDER.length + 1 + Math.max(0, ARMOR_PARTS.indexOf(x.armorPart ?? "helm"));
  const i = x.weapon ? TYPE_ORDER.indexOf(x.weapon) : -1;
  return i < 0 ? TYPE_ORDER.length : i;
}

/** Группа по классу: кольца («без класса») — перед бронёй, броня — в самом конце. */
function classGroup(x: BagSortItem): number {
  if (x.armor) return CLASS_ORDER.length + 1;
  const i = x.weapon ? CLASS_ORDER.indexOf(CLASS_OF_WEAPON[x.weapon]) : -1;
  return i < 0 ? CLASS_ORDER.length : i;
}

/** Порядок видов внутри «как пришло»: оружие, кольца, броня. */
function kindRank(x: BagSortItem): number {
  return x.weapon ? 0 : x.armor ? 2 : 1;
}

/** Внутри группы: оружие — перед кольцами и бронёй, оружие — по оценке, кольца — по тиру, броня — по лому; потом по лому. */
function byQuality(a: BagSortItem, b: BagSortItem): number {
  const r = kindRank(a) - kindRank(b);
  if (r) return r;
  if (a.weapon) return b.quality - a.quality;
  if (a.armor) return b.scrap - a.scrap;
  return RING_TIERS.indexOf(b.tier as RingTier) - RING_TIERS.indexOf(a.tier as RingTier) || b.scrap - a.scrap;
}

/** Копия списка в нужном порядке; `of` — что сортировке нужно знать о каждом элементе. */
export function sortBag<T>(items: readonly T[], mode: BagSort, of: (x: T) => BagSortItem): T[] {
  const out = [...items];
  if (mode === "none") return out;
  const groups: ((x: BagSortItem) => number)[] = mode === "type" ? [typeGroup] : mode === "class" ? [classGroup] : mode === "fav" ? [(x) => (x.fav ? 0 : 1)] : [];
  return out.sort((a, b) => {
    const A = of(a);
    const B = of(b);
    for (const g of groups) {
      const d = g(A) - g(B);
      if (d) return d;
    }
    return byQuality(A, B);
  });
}

/** Нажали кнопку: та же сортировка — выключить, другая — включить. */
export function nextBagSort(cur: BagSort, mode: BagSortMode): BagSort {
  return cur === mode ? "none" : mode;
}
