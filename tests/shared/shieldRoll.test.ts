import { test } from "node:test";
import assert from "node:assert/strict";
import { ARMOR_RANGE, armorValue, ARMOR_POINTS_MAX } from "../../src/shared/armor";
import { LOOT_VER, affixAtPoints, affixPoints, migrateLoot, shieldRegen, shieldReflect, type WeaponInstance } from "../../src/shared/items";
import { close } from "./rng";

test("регенерация брони: плоские 0.004–0.12 HP/с за ролл", () => {
  assert.ok(close(ARMOR_RANGE.regen[0], 0.004));
  assert.ok(close(ARMOR_RANGE.regen[1], 0.12));
  assert.ok(close(armorValue("regen", ARMOR_POINTS_MAX), 0.12));
});

test("регенерация щита — плоские HP/с, отражение Эгиды до 35%", () => {
  assert.ok(close(affixAtPoints("regen", 33).value, 15));
  assert.ok(close(affixAtPoints("regen", 1).value, 0.5));
  assert.ok(close(affixAtPoints("reflect", 33).value, 0.35));
  assert.ok(close(affixAtPoints("reflect", 1).value, 0.14));
});

test("выпавшие щиты (lv 11) пересчитываются на новый диапазон с теми же очками", () => {
  const shield = (value: number, sub: "regen" | "reflect", cls: "shield" = "shield"): WeaponInstance =>
    ({ id: "t", cls, tier: "base", affixes: [{ kind: sub, sub, value }], lv: 11 }) as unknown as WeaponInstance;
  // старый максимум 1% → новый 2%; старый минимум 0.3% → новый 0.6%
  const hi = shield(0.01, "regen");
  const lo = shield(0.003, "regen");
  const ref = shield(0.1, "reflect");
  assert.equal(migrateLoot(hi), true);
  assert.equal(hi.lv, LOOT_VER);
  assert.ok(close(shieldRegen(hi), 15));
  assert.equal(affixPoints(hi.affixes[0], hi), 33, "старый максимум (33 очка) остаётся максимумом");
  migrateLoot(lo);
  assert.ok(close(shieldRegen(lo), 0.5));
  migrateLoot(ref);
  assert.ok(close(shieldReflect(ref), 0.35));
});
