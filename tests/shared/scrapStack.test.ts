import { test } from "node:test";
import assert from "node:assert/strict";
import { addToBag, emptyBag } from "../../src/shared/items";

test("лом: копится в одной ячейке без практического предела", () => {
  const bag = emptyBag();
  assert.equal(addToBag(bag, "scrap", 200_000), 0);
  assert.equal(addToBag(bag, "scrap", 5_000_000), 0);
  const slots = bag.filter((s) => s.item === "scrap");
  assert.equal(slots.length, 1);
  assert.equal(slots[0].count, 5_200_000);
});
