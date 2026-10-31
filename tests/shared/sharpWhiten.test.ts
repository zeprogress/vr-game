import { test } from "node:test";
import assert from "node:assert/strict";
import { sharpPctOfPoints, sharpWhiten } from "../../src/shared/items";

/**
 * Свечение заточки: с +20 до +25 точек цвет уходит в белый (просьба 2026-10-31).
 * До +20 — цвет тира, на +25 и выше — чисто белый.
 */
test("белизна: до +20 точек не белеет", () => {
  assert.equal(sharpWhiten(sharpPctOfPoints(0)), 0);
  assert.equal(sharpWhiten(sharpPctOfPoints(15)), 0);
  assert.equal(sharpWhiten(sharpPctOfPoints(20)), 0);
});

test("белизна: на +22–23 примерно половина, на +25 полностью", () => {
  const mid = sharpWhiten(sharpPctOfPoints(22)) * 0.5 + sharpWhiten(sharpPctOfPoints(23)) * 0.5;
  assert.ok(mid > 0.3 && mid < 0.7, `+22…23 точки → ${mid}`);
  assert.equal(sharpWhiten(sharpPctOfPoints(25)), 1);
  assert.equal(sharpWhiten(sharpPctOfPoints(33)), 1, "выше +25 остаётся белым");
});

test("белизна растёт монотонно", () => {
  let prev = -1;
  for (let n = 0; n <= 33; n++) {
    const w = sharpWhiten(sharpPctOfPoints(n));
    assert.ok(w >= prev, `на ${n} точках ${w} < ${prev}`);
    prev = w;
  }
});
