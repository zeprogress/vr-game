import { test } from "node:test";
import assert from "node:assert/strict";
import { isSnapTeleport, snapshotStep } from "../../src/shared/snapTiming";

test("рывок за кадр (6 м за 55 мс) — телепорт", () => {
  assert.equal(isSnapTeleport(6, 55, false), true);
});

test("пройденное за подвисание кадра (3.5 м за 690 мс, ~5 м/с) — не телепорт", () => {
  assert.equal(isSnapTeleport(3.5, 690, false), false);
});

test("обычный шаг (0.1 м за 16 мс) — не телепорт", () => {
  assert.equal(isSnapTeleport(0.1, 16, false), false);
});

test("возрождение (смена «мёртв → жив») — всегда телепорт", () => {
  assert.equal(isSnapTeleport(0.5, 16, true), true);
});

test("после подвисания метка идёт по реальному времени, в обычном кадре — по шагу сетки", () => {
  assert.equal(snapshotStep(690, 55), 690);
  assert.equal(snapshotStep(55, 55), 55);
  assert.equal(snapshotStep(100, 55), 55);
});
