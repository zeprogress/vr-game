import { test } from "node:test";
import assert from "node:assert/strict";
import { LOW_MOB_DROP, lowMobDropMul, scaleCount } from "../../src/shared/progression";

test("штраф дропа: до 5 уровней разницы — полный, дальше −10% за уровень, не ниже 10%", () => {
  assert.equal(lowMobDropMul(30, 30), 1);
  assert.equal(lowMobDropMul(30, 40), 1, "моб выше героя — без штрафа");
  assert.equal(lowMobDropMul(30, 25), 1);
  assert.ok(Math.abs(lowMobDropMul(30, 24) - 0.9) < 1e-9);
  assert.ok(Math.abs(lowMobDropMul(30, 20) - 0.5) < 1e-9);
  assert.equal(lowMobDropMul(70, 1), LOW_MOB_DROP.min);
  assert.equal(lowMobDropMul(70, 0), LOW_MOB_DROP.min, "обычный моб без уровня — как 1-й");
});

test("штраф дропа: количество делится, дробная часть — шансом", () => {
  assert.equal(scaleCount(12, 1), 12);
  assert.equal(scaleCount(12, 0.25, () => 0.99), 3);
  assert.equal(scaleCount(3, 0.25, () => 0.1), 1);
  assert.equal(scaleCount(3, 0.25, () => 0.9), 0);
});
