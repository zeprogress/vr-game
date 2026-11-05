import { test } from "node:test";
import assert from "node:assert/strict";
import { mobDamageLevelMul, mobHpLevelMul } from "../../src/shared/mobs";

test("урон и HP мобов растут с уровнем: 1 ур. — база, 75 ур. — потолок", () => {
  assert.equal(mobDamageLevelMul(1), 1);
  assert.equal(mobDamageLevelMul(75), 2.5);
  assert.equal(mobHpLevelMul(1), 1);
  assert.equal(mobHpLevelMul(75), 2);
  assert.ok(mobDamageLevelMul(40) > mobDamageLevelMul(20));
  assert.ok(mobHpLevelMul(40) > mobHpLevelMul(20));
});
