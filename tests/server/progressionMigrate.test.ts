import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateTree, migrateXp, TREE_VER, type PlayerRecord } from "../../src/server/PlayerStore";
import { xpToNext } from "../../src/shared/progression";

const rec = (patch: Record<string, unknown>): PlayerRecord => ({ level: 40, xp: 0, ...patch } as unknown as PlayerRecord);

test("миграция опыта v2 → v3 сохраняет долю уровня, а не старое число", () => {
  const level = 40;
  const oldNeed = 100 * 1.23 ** (level - 1);
  const r = rec({ xpVer: 2, xp: oldNeed * 0.5 });
  assert.equal(migrateXp(r), true);
  assert.equal(r.xpVer, 3);
  assert.ok(Math.abs(r.xp - xpToNext(level) * 0.5) <= 1, `xp=${r.xp}`);
  assert.equal(migrateXp(r), false);
});

test("миграция дерева сбрасывает старые номера узлов, но не уровень", () => {
  const r = rec({ level: 77, treeVer: 1, tree: { warrior: [1, 2, 3] } });
  assert.equal(migrateTree(r), true);
  assert.equal(r.treeVer, TREE_VER);
  assert.deepEqual(r.tree, {});
  assert.equal(r.level, 77);
  assert.equal(migrateTree(r), false);
});
