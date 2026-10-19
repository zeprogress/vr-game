import { test } from "node:test";
import assert from "node:assert/strict";
import { giveItems, itemView, parseTradeItem, parseTradeList, takeItems, takenName, type InvSnap } from "../../src/server/trade";

/** Пустой снимок инвентаря с материалами крафта. */
function snap(mats: InvSnap["mats"]): InvSnap {
  return { weapons: [], heldIds: new Set(), bag: [], jewels: { rings: [], ringOn: [null, null], gems: {} }, armor: [], armorWorn: {}, mats };
}

test("материалы крафта: разбор кода «m:<материал>», мусор — null", () => {
  assert.deepEqual(parseTradeItem("m:web", 3), { k: "mat", id: "web", n: 3 });
  assert.deepEqual(parseTradeItem("m:frost", 0), { k: "mat", id: "frost", n: 1 });
  assert.equal(parseTradeItem("m:junk", 1), null);
  assert.equal(parseTradeItem("m:", 1), null);
  assert.deepEqual(parseTradeList(JSON.stringify([{ c: "m:bone", n: 2 }, { c: "m:sting", n: 1 }])), [
    { k: "mat", id: "bone", n: 2 },
    { k: "mat", id: "sting", n: 1 },
  ]);
});

test("материалы крафта: подарок — из стопки отправителя в стопку получателя", () => {
  const a = snap({ web: 5, frost: 1 });
  const b = snap({ web: 2 });
  const r = takeItems(a, [{ k: "mat", id: "web", n: 3 }, { k: "mat", id: "frost", n: 1 }]);
  assert.ok("taken" in r);
  if (!("taken" in r)) return;
  assert.deepEqual(a.mats, { web: 2 }, "стопка уменьшилась, пустая — исчезла");
  giveItems(b, r.taken);
  assert.deepEqual(b.mats, { web: 5, frost: 1 });
  assert.equal(takenName(r.taken[0]), "Паутина ×3");
  assert.deepEqual(itemView(r.taken[1]), { k: "mat", name: "Ледяное сердце", n: 1, mat: "frost" });
});

test("материалы крафта: не хватает — отказ, ничего не тронуто", () => {
  const a = snap({ scale: 2 });
  const r = takeItems(a, [{ k: "mat", id: "scale", n: 1 }, { k: "mat", id: "scale", n: 2 }]);
  assert.ok("error" in r);
  if ("error" in r) assert.match(r.error, /Чешуя дракона/);
  assert.deepEqual(a.mats, { scale: 2 });
  const r2 = takeItems(a, [{ k: "mat", id: "sting", n: 1 }]);
  assert.ok("error" in r2);
});
