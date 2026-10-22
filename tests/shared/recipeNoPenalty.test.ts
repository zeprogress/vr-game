import { test } from "node:test";
import assert from "node:assert/strict";
import { LOOT_VER, affixAtPoints, affixPoints, migrateLoot, type WeaponInstance } from "../../src/shared/items";
import { attackValue } from "../../src/shared/heroStats";
import { CRAFT } from "../../src/shared/craft";

test("оружие по скрытому рецепту: выпавшие роллы со штрафом (cap < 1) поднимаются до 1 с теми же очками (lv 13)", () => {
  const w = {
    id: "r", cls: "sword", tier: "craft", rc: "crusher", lv: 12,
    affixes: [affixAtPoints("dmgPct", 20, 0.85), affixAtPoints("critChance", 9, 1.15)],
  } as unknown as WeaponInstance;
  assert.equal(migrateLoot(w), true);
  assert.equal(w.lv, LOOT_VER);
  assert.equal(w.affixes[0].cap, undefined, "штраф снят");
  assert.equal(affixPoints(w.affixes[0], w), 20, "очки сохранены");
  assert.equal(w.affixes[1].cap, 1.15, "бонус своих копий остаётся");
});

test("оружие не по рецепту: штраф не трогаем", () => {
  const w = { id: "r", cls: "sword", tier: "craft", lv: 12, affixes: [affixAtPoints("dmgPct", 20, 0.85)] } as unknown as WeaponInstance;
  migrateLoot(w);
  assert.equal(w.affixes[0].cap, 0.85);
});

test("«Атака» на карточке оружия по рецепту — с прибавкой ×1.15 (тот же множитель, что в бою)", () => {
  const base = attackValue("sword", "craft");
  const rc = attackValue("sword", "craft", 0, 0, true);
  assert.ok(base && rc);
  assert.ok(Math.abs(rc.total / base.total - CRAFT.recipeDmg) < 1e-9);
});
