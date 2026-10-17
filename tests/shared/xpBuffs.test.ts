import { test } from "node:test";
import assert from "node:assert/strict";
import { EVENT } from "../../src/shared/constants";
import { SCROLL } from "../../src/shared/shop";

test("благословение победы и свиток мудрости — по ×1.5 каждый", () => {
  assert.equal(EVENT.invasion.buffXpMult, 1.5);
  assert.equal(SCROLL.xpMul, 1.5);
});

test("вместе — ×2: благословение задаёт множитель, свиток добавляет (xpMul − 1), как в ZoneRoom", () => {
  // ZoneRoom: m = buffXpMult (благословение); если есть свиток — m += xpMul − 1
  const m = EVENT.invasion.buffXpMult + (SCROLL.xpMul - 1);
  assert.equal(m, 2);
});
