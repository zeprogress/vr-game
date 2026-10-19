import { armorLevelMul } from "./armor";

/**
 * Лом с мобов: шанс упасть одному ломку — от 10% на 1 ур. моба до 100% на 70 ур. и выше, линейно
 * (та же шкала, что у шанса золотой брони). Обычные мобы — 1 ур. (без уровня), элитные — свой.
 * 2026-10-20: было 3% → 75% на 53 ур. (по просьбе — лом на высоких уровнях падает всегда).
 */
export const SCRAP_DROP = { from: 1, full: 70, chanceFrom: 0.1, chanceFull: 1, amount: 1 } as const;

/** Шанс выпадения лома у моба уровня `level`. */
export function scrapDropChance(level: number): number {
  const mul = armorLevelMul(level, SCRAP_DROP);
  return SCRAP_DROP.chanceFrom + (SCRAP_DROP.chanceFull - SCRAP_DROP.chanceFrom) * mul;
}
