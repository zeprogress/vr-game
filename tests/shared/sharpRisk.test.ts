import { test } from "node:test";
import assert from "node:assert/strict";
import { ATTACK_POINT, attackPointBonus, attackPointNext, attackPointTry, restoreCost, type WeaponInstance } from "../../src/shared/items";

const wpn = (sharp: number, extra: Partial<WeaponInstance> = {}): WeaponInstance =>
  ({ id: "t", cls: "sword", tier: "legendary", affixes: [], sharp, ...extra }) as WeaponInstance;

test("заточка: урон по ступеням +25 / +85 / +145 / +195 / +245%", () => {
  assert.ok(Math.abs(attackPointBonus(5) - 0.25) < 1e-9);
  assert.ok(Math.abs(attackPointBonus(9) - 0.85) < 1e-9);
  assert.ok(Math.abs(attackPointBonus(12) - 1.45) < 1e-9);
  assert.ok(Math.abs(attackPointBonus(14) - 1.95) < 1e-9);
  assert.ok(Math.abs(attackPointBonus(15) - 2.45) < 1e-9);
});

test("заточка: шансы +6…+14 и фиксированные 3% на +15", () => {
  assert.equal(attackPointNext(wpn(3))!.chance, 0.8);
  assert.equal(attackPointNext(wpn(4))!.chance, 0.7);
  assert.equal(attackPointNext(wpn(5))!.chance, 0.65);
  assert.equal(attackPointNext(wpn(9))!.chance, 0.25);
  assert.equal(attackPointNext(wpn(14))!.chance, 0.03);
  assert.equal(attackPointNext(wpn(5, { sharpFails: 3 }))!.chance, 0.71);
});

test("заточка: безопасные +1…+5 и поломка/защита свитком", () => {
  const safe = wpn(3);
  const rs = attackPointTry(safe, 1e9, false, () => 0.999);
  assert.equal(rs.ok && rs.broke, false);
  assert.equal(safe.sharp, 3);

  const early = wpn(3);
  const re = attackPointTry(early, 1e9, false, () => 0);
  assert.equal(re.ok && re.up, true);
  assert.equal(early.sharp, 4);

  const broke = wpn(5);
  const r1 = attackPointTry(broke, 1e9, false, () => 0.999);
  assert.equal(r1.ok && r1.broke, true);
  assert.equal(broke.broken, true);
  assert.equal(broke.brokenAt, 6);
  assert.equal(broke.sharp, 5);

  const saved = wpn(5);
  const r2 = attackPointTry(saved, 1e9, true, () => 0.999);
  assert.equal(r2.ok && r2.protected, true);
  assert.ok(!saved.broken);
  assert.equal(saved.sharp, 5);
  assert.equal(saved.sharpFails, 1);
});

test("восстановление: цена зависит от уровня поломки", () => {
  assert.deepEqual(restoreCost(6), { scrap: 18_000, scale: 0 });
  assert.deepEqual(restoreCost(9), { scrap: 45_000, scale: 1 });
  assert.deepEqual(restoreCost(14), { scrap: 125_000, scale: 2 });
  assert.equal(ATTACK_POINT.max, 15);
});
