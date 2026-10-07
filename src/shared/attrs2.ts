/**
 * Числа атрибутов «Классов 2.0» (формулы — classes2.ts). Отдельный модуль без
 * зависимостей: его читают и classes2, и magic — без круговых импортов.
 */
/** Все числа «Классов 2.0» — в одном месте, их крутит лаборатория. */
export const ATTR2 = {
  /** Значение каждого атрибута на 1 уровне. */
  start: 1,
  /** Очков за уровень (на 100 ур. — 297). */
  pointsPerLevel: 3,
  /** Очков сразу на 1 уровне. */
  startPoints: 0,
  /** Каждые столько подъёмов атрибута цена очка растёт на 1. */
  costStep: 10,

  str: { physDmg: 0.024 }, // +2.4% физ. урона за очко
  agi: { move: 0.01, atkSpeed: 0.015 }, // +1% бега, +1.5% темпа физ. атак (2026-10-02: было 0.8% / 1.2%)
  int: { magic: 0.026 }, // +2.6% урона магией и лечения
  con: { hp: 0.09, armorMax: 0.6, armorK: 60, regen: 0.0002 }, // +9% HP (2026-10-05: было 4% — вместо скрытого ×1.6 HP воинов-ботов); броня = max·n/(n+K); +0.02% макс. HP в секунду (и в бою)
  luc: { crit: 0.009, critDmg: 0.02, dodge: 0.0065, dodgeOneItem: 3, dodgeCap: 0.5 }, // 2026-10-02: было 0.4% / 0.01 / 0.4%; 2026-10-07 уворот 0.5% → 0.65%
  wis: { resistMax: 0.7, resistK: 45, cast: 0.015 }, // магзащита = max·n/(n+K); +1.5% скорости каста и отката умений (все классы; 2026-10-05: было 0.9% и только у магов)
} as const;

/** Сколько подъёмов вложено в атрибут сверх стартового. */
export function invested(v: number): number {
  return Math.max(0, v - ATTR2.start);
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
