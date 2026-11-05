/**
 * Числа атрибутов «Классов 2.0» (формулы — classes2.ts). Отдельный модуль без
 * зависимостей: его читают и classes2, и magic — без круговых импортов.
 */
/** Все числа «Классов 2.0» — в одном месте, их крутит лаборатория. */
export const ATTR2 = {
  /** Значение каждого атрибута на 1 уровне. */
  start: 1,
  /** Очков за уровень — узлов дерева прокачки (shared/passiveTree.ts; на 100 ур. — 100). */
  pointsPerLevel: 1,
  /** Очков сразу на 1 уровне. */
  startPoints: 1,
  /** Каждые столько подъёмов атрибута цена очка растёт на 1. */
  costStep: 10,

  str: { physDmg: 0.024 }, // +2.4% физ. урона за очко
  agi: { move: 0.01, atkSpeed: 0.015 }, // +1% бега, +1.5% темпа физ. атак (2026-10-02: было 0.8% / 1.2%)
  int: { magic: 0.026 }, // +2.6% урона магией и лечения
  con: { hp: 0.15, armorMax: 0.6, armorK: 35, regen: 0.0003 }, // +15% HP за очко (2026-10-30: было 9%); броня = max·n/(n+K), K 35; +0.02% макс. HP в секунду (и в бою)
  luc: { crit: 0.009, critDmg: 0.02, dodge: 0.005, dodgeOneItem: 2, dodgeCap: 0.6, critCap: 0.75 }, // 2026-10-02: было 0.4% / 0.01 / 0.4%; 2026-10-07 уворот 0.5% → 0.65%; 2026-10-28 → 0.5%, один предмет ×3 → ×2, потолок 50% → 60%
  wis: { resistMax: 0.7, resistK: 45, cast: 0.015, cd: 0.035 }, // магзащита = max·n/(n+K); +1.5% скорости каста и отката умений (все классы; 2026-10-05: было 0.9% и только у магов)
} as const;

/** Сколько подъёмов вложено в атрибут сверх стартового. */
export function invested(v: number): number {
  return Math.max(0, v - ATTR2.start);
}

/** Доля физ. урона, которую гасит броня от ТЕЛ (без брони-предметов — её добавляет armorFrac). */
export function physArmorBase(a: object): number {
  const n = invested(attrOf(a, "con"));
  return (ATTR2.con.armorMax * n) / (n + ATTR2.con.armorK);
}

/** Доля магического урона, которую гасит МДР (без колец и магической брони — их добавляет magicResistFrac). */
export function magicResistBase(a: object): number {
  const n = invested(attrOf(a, "wis"));
  return (ATTR2.wis.resistMax * n) / (n + ATTR2.wis.resistK);
}

/**
 * Атрибут героя с прибавкой от камней в надетых кольцах (поле `gb` у PlayerState, считает
 * shared/jewels.ts). Все формулы характеристик читают атрибуты только так — прибавка видна везде.
 * Очки (цена, сброс, распределение) — по «голым» полям, без неё.
 */
export function attrOf(a: object, k: "str" | "agi" | "int" | "con" | "luc" | "wis"): number {
  const o = a as { [key: string]: unknown; gb?: { [key: string]: unknown } };
  const base = typeof o[k] === "number" ? (o[k] as number) : ATTR2.start;
  const add = o.gb && typeof o.gb[k] === "number" ? (o.gb[k] as number) : 0;
  return base + add;
}
