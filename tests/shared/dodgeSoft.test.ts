import { test } from "node:test";
import assert from "node:assert/strict";
import { dodge2 } from "../../src/shared/classes2";

/**
 * Уворот от УДЧ идёт через угасание (2026-10-31): иначе потолок 60% достигался на УДЧ ≈ 61,
 * и дальше удача для уворота не работала. Бонусы брони и дерева прибавляются после.
 */
const a = (luc: number, extra: Record<string, unknown> = {}) =>
  ({ str: 1, agi: 1, int: 1, con: 1, luc, wis: 1, ...extra }) as never;

test("уворот растёт, но медленнее линейного (угасание)", () => {
  const d20 = dodge2(a(20), true);
  const d50 = dodge2(a(50), true);
  const d100 = dodge2(a(100), true);
  assert.ok(d20 > 0.1 && d20 < 0.2, `УДЧ 20 → ${d20}`);
  assert.ok(d50 > 0.28 && d50 < 0.36, `УДЧ 50 → ${d50}`);
  assert.ok(d100 > 0.45 && d100 < 0.55, `УДЧ 100 → ${d100}`);
  // Угасание: прирост НА ОЧКО падает с ростом УДЧ (сравниваем удельные приросты, не абсолютные).
  const perPointLow = (d50 - d20) / 30;
  const perPointHigh = (d100 - d50) / 50;
  assert.ok(perPointHigh < perPointLow, `${perPointHigh} < ${perPointLow}`);
});

test("потолок 60% остаётся страховкой", () => {
  const withArmor = dodge2(a(100, { ab: { dodge: 0.4 } }), true);
  assert.ok(withArmor <= 0.6 + 1e-9, `уворот ${withArmor}`);
});

test("уворот с брони и дерева прибавляется после угасания", () => {
  const base = dodge2(a(50), true);
  const boosted = dodge2(a(50, { ab: { dodge: 0.05 }, tb: { dodge: 0.02 } }), true);
  assert.ok(Math.abs(boosted - base - 0.07) < 1e-9);
});
