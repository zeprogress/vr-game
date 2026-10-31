import { test } from "node:test";
import assert from "node:assert/strict";
import { sharpPctOfPoints, sharpWhiten } from "../../src/shared/items";

/**
 * Свечение заточки: с +20 до +30 точек цвет уходит в белый (просьба 2026-10-31).
 * До +20 — цвет тира, на +30 и выше — чисто белый.
 */
test("белизна: до +20 точек не белеет", () => {
  assert.equal(sharpWhiten(sharpPctOfPoints(0)), 0);
  assert.equal(sharpWhiten(sharpPctOfPoints(15)), 0);
  assert.equal(sharpWhiten(sharpPctOfPoints(20)), 0);
});

test("белизна: на +25 примерно половина, на +30 полностью", () => {
  const mid = sharpWhiten(sharpPctOfPoints(25));
  assert.ok(mid > 0.4 && mid < 0.7, `+25 точек → ${mid}`);
  assert.equal(sharpWhiten(sharpPctOfPoints(30)), 1);
  assert.equal(sharpWhiten(sharpPctOfPoints(33)), 1, "выше +30 остаётся белым");
});

test("белизна растёт монотонно", () => {
  let prev = -1;
  for (let n = 0; n <= 33; n++) {
    const w = sharpWhiten(sharpPctOfPoints(n));
    assert.ok(w >= prev, `на ${n} точках ${w} < ${prev}`);
    prev = w;
  }
});
