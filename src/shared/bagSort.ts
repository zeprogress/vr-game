/**
 * Сортировка сумки — оружие и кольца вместе. Одна на ПК, телефон и VR-склад, чтобы порядок везде совпадал.
 *
 *  - «По оценке»: оружие — по оценке (выше сверху); кольца — после оружия, по тиру, внутри по лому.
 *  - «По типу»: по виду оружия (TYPE_ORDER); кольца — в конце. Внутри вида — как «По оценке».
 *  - «По классу»: по классу героя (CLASS_OF_WEAPON); кольца — «без класса», в конце. Внутри класса — по оценке: меч и щит воина идут вперемешку.
 *  - Без сортировки: как пришло — сначала оружие, потом кольца.
 */
import type { WeaponClass, WeaponTier } from "./items";
import { CLASS_OF_WEAPON, type ClassId } from "./classes2";
import { RING_TIERS, type RingTier } from "./jewels";

/** Включённая сортировка; none — как пришло. */
export type BagSort = "none" | "quality" | "type" | "class";
export type BagSortMode = Exclude<BagSort, "none">;

/** Кнопки сортировки в шапке сумки: подпись и подсказка. */
export const BAG_SORTS: readonly { mode: BagSortMode; label: string; title: string }[] = [
  { mode: "quality", label: "По оценке", title: "Оружие — по оценке, выше сверху. Кольца — после оружия, по тиру" },
  { mode: "type", label: "По типу", title: "Вид оружия: меч, щит, кинжал, копьё, молот, лук, посох. Кольца — в конце" },
  {
    mode: "class",
    label: "По классу",
    title: "Класс героя: воин (меч, щит), ассасин, копейщик, боевой маг, лучник, маг поддержки. Кольца — без класса, в конце",
  },
];

/** Порядок видов оружия в «По типу». */
export const TYPE_ORDER: readonly WeaponClass[] = ["sword", "shield", "dagger", "spear", "hammer", "bow", "staff"];
/** Порядок классов в «По классу». */
export const CLASS_ORDER: readonly ClassId[] = ["warrior", "assassin", "spearman", "battlemage", "archer", "support"];

/** Что сортировке нужно знать о предмете. Нет weapon — кольцо. */
export interface BagSortItem {
  weapon?: WeaponClass;
  tier: WeaponTier | RingTier;
  quality: number;
  scrap: number;
}

/** Предмет сумки или склада: оружие (w) или кольцо (r). Поля — те же, что у записей окна инвентаря. */
export type BagPick = { w: { cls: WeaponClass; tier: WeaponTier; quality: number; scrap?: number } } | { r: { tier: RingTier; scrap: number } };

/** Что сортировке знать о предмете: из полей оружия или кольца. */
export function bagPickItem(e: BagPick): BagSortItem {
  return "w" in e ? { weapon: e.w.cls, tier: e.w.tier, quality: e.w.quality, scrap: e.w.scrap ?? 0 } : { tier: e.r.tier, quality: 0, scrap: e.r.scrap };
}

/** Группа по виду: кольца и неизвестное — в конце. */
function typeGroup(x: BagSortItem): number {
  const i = x.weapon ? TYPE_ORDER.indexOf(x.weapon) : -1;
  return i < 0 ? TYPE_ORDER.length : i;
}

/** Группа по классу: кольца («без класса») — в конце. */
function classGroup(x: BagSortItem): number {
  const i = x.weapon ? CLASS_ORDER.indexOf(CLASS_OF_WEAPON[x.weapon]) : -1;
  return i < 0 ? CLASS_ORDER.length : i;
}

/** Внутри группы: оружие — перед кольцами, оружие — по оценке, кольца — по тиру, потом по лому. */
function byQuality(a: BagSortItem, b: BagSortItem): number {
  if (!!a.weapon !== !!b.weapon) return a.weapon ? -1 : 1;
  if (a.weapon) return b.quality - a.quality;
  return RING_TIERS.indexOf(b.tier as RingTier) - RING_TIERS.indexOf(a.tier as RingTier) || b.scrap - a.scrap;
}

/** Копия списка в нужном порядке; `of` — что сортировке нужно знать о каждом элементе. */
export function sortBag<T>(items: readonly T[], mode: BagSort, of: (x: T) => BagSortItem): T[] {
  const out = [...items];
  if (mode === "none") return out;
  const groups: ((x: BagSortItem) => number)[] = mode === "type" ? [typeGroup] : mode === "class" ? [classGroup] : [];
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
