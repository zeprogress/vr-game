import { test } from "node:test";
import assert from "node:assert/strict";
import { addLoot } from "../../src/server/rooms/catacombs";
import type { LootItem } from "../../src/shared/net/messages";

test("добыча забега: камни и кольца с заглушкой id не склеиваются между собой", () => {
  const list: LootItem[] = [];
  addLoot(list, { id: "scrap", count: 1, jw: "str:1" });
  addLoot(list, { id: "scrap", count: 1, jw: "luc:3" });
  addLoot(list, { id: "scrap", count: 1, jw: "str:1" });
  assert.equal(list.length, 2);
  assert.equal(list.find((l) => l.jw === "str:1")!.count, 2);
  assert.equal(list.find((l) => l.jw === "luc:3")!.count, 1);
});

test("добыча забега: лом из сундука не складывается с камнем", () => {
  const list: LootItem[] = [];
  addLoot(list, { id: "scrap", count: 1, jw: "str:1" });
  addLoot(list, { id: "scrap", count: 1500 });
  assert.equal(list.length, 2);
  assert.equal(list.find((l) => !l.jw)!.count, 1500);
  assert.equal(list.find((l) => l.jw === "str:1")!.count, 1);
});
