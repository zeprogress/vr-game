import { test } from "node:test";
import assert from "node:assert/strict";
import { scrapDropChance, SCRAP_DROP } from "../../src/shared/scrapDrop";
import { close } from "./rng";

test("на 1 уровне моба — 1%, обычный моб (без уровня) — тоже 1%", () => {
  assert.ok(close(scrapDropChance(1), 0.01));
  assert.ok(close(scrapDropChance(0), 0.01));
});

test("на 53 уровне — 50%, выше — не больше 50%", () => {
  assert.ok(close(scrapDropChance(53), 0.5));
  assert.ok(close(scrapDropChance(100), 0.5));
});

test("между ними — линейно: на 27 уровне около 25.5%", () => {
  assert.ok(close(scrapDropChance(27), 0.01 + 0.49 * 0.5));
  assert.ok(scrapDropChance(10) < scrapDropChance(20));
});

test("за раз падает один лом", () => {
  assert.equal(SCRAP_DROP.amount, 1);
});
