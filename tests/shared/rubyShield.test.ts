import { test } from "node:test";
import assert from "node:assert/strict";
import { SHIELD } from "../../src/shared/constants";
import { affixRange, aegisHealOf, aegisTier, instanceEffects, isAegis, isRubyRound, RUBY_AEGIS_NAME, RUBY_ROUND_LABEL, rollWeaponInstance, shieldForm, type WeaponInstance } from "../../src/shared/items";
import { seeded } from "./rng";

test("рубиновый щит: круглый и Эгида — по 4 ролла, форма и имя различают их", () => {
  const rnd = seeded(11);
  for (let i = 0; i < 40; i++) {
    const round = rollWeaponInstance("shield", "ruby", rnd, false);
    const aegis = rollWeaponInstance("shield", "ruby", rnd, true);
    assert.equal(round.affixes.length, 4, "круглый: 4 ролла");
    assert.equal(aegis.affixes.length, 4, "Эгида: 4 ролла");
    assert.equal(shieldForm(round), "ruby");
    assert.equal(shieldForm(aegis), "rubyAegis");
    assert.equal(aegis.nm, RUBY_AEGIS_NAME);
    assert.equal(isAegis(round), false);
    assert.equal(isAegis(aegis), true);
    assert.equal(isRubyRound(round), true);
    assert.equal(isRubyRound(aegis), false);
  }
});

test("рубиновый щит: роллы сильнее уникального в SHIELD.rubyMul раз", () => {
  const leg = rollWeaponInstance("shield", "legendary", seeded(3), false);
  const ruby = rollWeaponInstance("shield", "ruby", seeded(3), false);
  for (const sub of ["block", "physDef", "magDef", "regen"] as const) {
    const [, lh] = affixRange(sub, leg);
    const [, rh] = affixRange(sub, ruby);
    assert.ok(Math.abs(rh - lh * SHIELD.rubyMul) < 1e-9, `${sub}: максимум ×${SHIELD.rubyMul}`);
  }
});

test("рубиновая Эгида: Оплот сильнее уникальной; круглый рубиновый Оплота не даёт, а оглушает", () => {
  const aegis = rollWeaponInstance("shield", "ruby", seeded(5), true) as WeaponInstance;
  const round = rollWeaponInstance("shield", "ruby", seeded(5), false) as WeaponInstance;
  assert.equal(aegisHealOf(aegis), SHIELD.rubyAegisHealFrac);
  assert.ok(SHIELD.rubyAegisHealFrac > SHIELD.aegisHealFrac, "Оплот рубиновой Эгиды сильнее уникальной");
  assert.equal(aegisHealOf(round), 0);
  assert.ok(instanceEffects(aegis).some((t) => t.startsWith("Оплот")));
  assert.ok(instanceEffects(round).includes(RUBY_ROUND_LABEL));
  assert.equal(aegisTier("shield", "ruby", "Оплот: блок удара вблизи лечит 8% HP"), "rubyAegis");
  assert.equal(aegisTier("shield", "legendary", "Оплот: блок удара вблизи лечит 5% HP"), "aegis");
});
