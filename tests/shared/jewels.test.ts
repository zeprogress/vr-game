import { test } from "node:test";
import assert from "node:assert/strict";
import { RING_LEVEL_GATE, rollJewelDrop, type RingTier } from "../../src/shared/jewels";
import { seeded } from "./rng";

/** Сколько колец каждого тира выпало за `n` бросков. chanceMul 1000 — кольца падают часто, выборка заметна. */
function ringsAt(level: number, n: number, seed: number): Record<RingTier, number> {
  const rnd = seeded(seed);
  const out: Record<RingTier, number> = { base: 0, gold: 0, legendary: 0, ruby: 0 };
  for (let i = 0; i < n; i++) {
    const d = rollJewelDrop(1000, 1, level, rnd);
    if (d.ring) out[d.ring]++;
  }
  return out;
}

test("кольцо с 1-го уровня моба — только обычное", () => {
  const r = ringsAt(RING_LEVEL_GATE.from, 20000, 1);
  assert.ok(r.base > 1000, "обычные кольца должны выпадать");
  assert.equal(r.gold, 0);
  assert.equal(r.legendary, 0);
});

test("на 53-м уровне золотые и уникальные кольца выпадают", () => {
  const r = ringsAt(RING_LEVEL_GATE.full, 20000, 2);
  assert.ok(r.gold > 0);
  assert.ok(r.legendary > 0);
});

test("золотых колец на 27-м уровне меньше, чем на 53-м (шанс растёт с уровнем)", () => {
  const mid = ringsAt(27, 20000, 3);
  const top = ringsAt(RING_LEVEL_GATE.full, 20000, 3);
  assert.ok(mid.gold > 0 && mid.gold < top.gold);
});

test("без бросков шанс нулевой: нет ни камня, ни кольца", () => {
  const d = rollJewelDrop(0, 1, RING_LEVEL_GATE.full, () => 0.999999);
  assert.deepEqual(d, {});
});

test("рубиновое кольцо с мобов не падает (только из сундука катакомб)", () => {
  assert.equal(ringsAt(RING_LEVEL_GATE.full, 20000, 4).ruby, 0);
});
