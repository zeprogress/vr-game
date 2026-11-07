import { test } from "node:test";
import assert from "node:assert/strict";
import { ATTACK_POINT, attackPointBonus, attackPointMul, attackPointNext, attackPointTry, attackPoints, heldAffixText, powerMulOfText, restoreCost, restoreSharp, scrapValue, type WeaponInstance } from "../../src/shared/items";

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
  assert.equal(attackPointNext(wpn(14, { sharpFails: 5 }))!.chance, 0.13);
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
  assert.equal(broke.sharp, 3);

  const saved = wpn(5);
  const r2 = attackPointTry(saved, 1e9, true, () => 0.999);
  assert.equal(r2.ok && r2.protected, true);
  assert.ok(!saved.broken);
  assert.equal(saved.sharp, 5);
  assert.equal(saved.sharpFails, 1);
});


test("со свитком с +13: 20% поломки, 80% сохранения", () => {
  const broke = wpn(13);
  const rb = attackPointTry(broke, 1e9, true, (() => { const v = [0.99, 0.1]; return () => v.shift()!; })());
  assert.equal(rb.ok && rb.broke, true);
  assert.equal(broke.broken, true);

  const kept = wpn(13);
  const rk = attackPointTry(kept, 1e9, true, (() => { const v = [0.99, 0.9]; return () => v.shift()!; })());
  assert.equal(rk.ok && rk.protected, true);
  assert.equal(kept.broken, undefined);
  assert.equal(kept.sharp, 13);
  assert.equal(kept.sharpFails, 1);
});

test("восстановление: цена зависит от уровня поломки", () => {
  assert.deepEqual(restoreCost(4), { scrap: 8_000, scale: 0 });
  assert.deepEqual(restoreCost(4, "craft"), { scrap: 5_600, scale: 0 });
  assert.deepEqual(restoreCost(4, "legendary"), { scrap: 3_900, scale: 0 });
  assert.deepEqual(restoreCost(5), { scrap: 14_700, scale: 0 });
  assert.deepEqual(restoreCost(6), { scrap: 22_800, scale: 0 });
  assert.deepEqual(restoreCost(6, "craft"), { scrap: 16_000, scale: 0 });
  assert.deepEqual(restoreCost(9), { scrap: 55_500, scale: 1 });
  assert.deepEqual(restoreCost(14), { scrap: 138_000, scale: 2 });
  assert.ok(restoreCost(7).scrap > restoreCost(6).scrap);
  assert.ok(restoreCost(15).scrap > restoreCost(14).scrap);
  assert.equal(ATTACK_POINT.max, 15);
  assert.equal(restoreSharp(4), 3);
  assert.equal(restoreSharp(5), 3);
  assert.equal(restoreSharp(6), 3);
  assert.equal(restoreSharp(7), 4);
  assert.equal(restoreSharp(8), 5);
  assert.equal(restoreSharp(14), 11);
  assert.equal(restoreSharp(15), 12);
});

test("разбор возвращает 50% вложенного лома", () => {
  const w = wpn(5, { scrapSpent: 10_000 });
  assert.equal(scrapValue(w), 5_000);
  const noInvest = wpn(5);
  assert.ok(scrapValue(noInvest) > 0);
});

test("сломанное оружие бьёт как +3 и остаётся в руках", () => {
  const b = wpn(0, { broken: true, brokenAt: 6 });
  assert.equal(attackPoints(b), 3);
  assert.ok(Math.abs(attackPointMul(b) - 1.15) < 1e-9);
});

test("урон от точки совпадает с текстом и серверным множителем", () => {
  for (const n of [1, 3, 4, 5, 6, 9, 10, 12, 13, 14, 15]) {
    const w = wpn(n);
    const mul = attackPointMul(w);
    assert.ok(Math.abs(mul - (1 + attackPointBonus(n))) < 1e-9, `attackPointMul +${n}`);
    assert.ok(Math.abs(powerMulOfText(heldAffixText(w)) - mul) < 1e-6, `текст +${n}`);
  }
  assert.ok(Math.abs(attackPointMul(wpn(15)) - 3.45) < 1e-9);
});
