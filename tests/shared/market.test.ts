import { test } from "node:test";
import assert from "node:assert/strict";
import { MARKET } from "../../src/shared/market";
import { marketForbidden } from "../../src/server/market";

test("рынок: лимиты заявок и предложений", () => {
  assert.equal(MARKET.maxListings, 20);
  assert.equal(MARKET.maxOfferItems, 10);
  assert.equal(MARKET.fee, 0.05);
});

test("рынок: зелья нельзя выставлять и предлагать", () => {
  assert.equal(marketForbidden({ k: "bag", item: "potion", n: 1 }), true);
  assert.equal(marketForbidden({ k: "bag", item: "fish", n: 1 }), false);
});
