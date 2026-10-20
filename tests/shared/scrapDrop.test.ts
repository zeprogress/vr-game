import { test } from "node:test";
import assert from "node:assert/strict";
import { scrapDropChance, SCRAP_DROP } from "../../src/shared/scrapDrop";
import { close } from "./rng";
import { ELITE_MOBS } from "../../src/shared/mobs";

test("на 1 уровне моба — 10%, обычный моб (без уровня) — тоже 10%", () => {
  assert.ok(close(scrapDropChance(1), 0.1));
  assert.ok(close(scrapDropChance(0), 0.1));
});

test("на 70 уровне — 100%, выше — не больше 100%", () => {
  assert.ok(close(scrapDropChance(70), 1));
  assert.ok(close(scrapDropChance(100), 1));
});

test("между ними — линейно: на 36 уровне 10% + 90% · 35/69", () => {
  assert.ok(close(scrapDropChance(36), 0.1 + 0.9 * (35 / 69)));
  assert.ok(scrapDropChance(10) < scrapDropChance(20));
});

test("за раз падает один лом", () => {
  assert.equal(SCRAP_DROP.amount, 1);
});

test("с ледяного гиганта лом — 100 за убийство, падает всегда (70 ур.)", () => {
  assert.equal(ELITE_MOBS.iceGiant.scrap, 100);
  assert.equal(scrapDropChance(ELITE_MOBS.iceGiant.level), 1);
});
