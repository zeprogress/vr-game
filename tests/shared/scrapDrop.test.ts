import { test } from "node:test";
import assert from "node:assert/strict";
import { scrapDropChance, SCRAP_DROP } from "../../src/shared/scrapDrop";
import { close } from "./rng";

test("на 1 уровне моба — 3%, обычный моб (без уровня) — тоже 3%", () => {
  assert.ok(close(scrapDropChance(1), 0.03));
  assert.ok(close(scrapDropChance(0), 0.03));
});

test("на 53 уровне — 75%, выше — не больше 75%", () => {
  assert.ok(close(scrapDropChance(53), 0.75));
  assert.ok(close(scrapDropChance(100), 0.75));
});

test("между ними — линейно: на 27 уровне около 39%", () => {
  assert.ok(close(scrapDropChance(27), 0.03 + 0.72 * 0.5));
  assert.ok(scrapDropChance(10) < scrapDropChance(20));
});

test("за раз падает один лом", () => {
  assert.equal(SCRAP_DROP.amount, 1);
});
