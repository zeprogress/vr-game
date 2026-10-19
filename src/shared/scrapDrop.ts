import { armorLevelMul } from "./armor";

/**
 * Лом с мобов: шанс упасть одному ломку — от 3% на 1 ур. моба до 75% на 53 ур. и выше, линейно
 * (та же шкала, что у шанса золотой брони). Обычные мобы — 1 ур. (без уровня), элитные — свой.
 * 2026-10-20: было 1% → 50% (по просьбе — лома должно падать чаще).
 */
export const SCRAP_DROP = { from: 1, full: 53, chanceFrom: 0.03, chanceFull: 0.75, amount: 1 } as const;

/** Шанс выпадения лома у моба уровня `level`. */
export function scrapDropChance(level: number): number {
  const mul = armorLevelMul(level, SCRAP_DROP);
  return SCRAP_DROP.chanceFrom + (SCRAP_DROP.chanceFull - SCRAP_DROP.chanceFrom) * mul;
}
