import { test } from "node:test";
import assert from "node:assert/strict";
import { ATTR2 } from "../../src/shared/attrs2";
import {
  armorFrac,
  blankAttrs,
  castTempo2,
  classOf2,
  critChance2,
  dodge2,
  heroAttackInterval,
  holdsOneItem,
  isDualPair,
  moveSpeed2,
  physPower2,
  pointsAt,
  spentOn,
  staffCastInterval,
  stepCost,
  totalCost,
} from "../../src/shared/classes2";
import { magicResistFrac } from "../../src/shared/magic";
import { levelGain } from "../../src/shared/levelGain";
import { close } from "./rng";

const WEAPONS = ["sword", "dagger", "spear", "hammer", "bow", "fist"] as const;

test("цена очка: первые 10 подъёмов по 1, следующие по 2, затем по 3", () => {
  assert.equal(stepCost(1), 1);
  assert.equal(stepCost(10), 1);
  assert.equal(stepCost(11), 2);
  assert.equal(stepCost(21), 3);
});

test("totalCost — сумма цен от старта до значения", () => {
  assert.equal(totalCost(ATTR2.start), 0);
  assert.equal(totalCost(ATTR2.start + 1), 1);
  assert.equal(totalCost(ATTR2.start + 10), 10);
  assert.equal(totalCost(12), 12);
});

test("очки: 0 на первом уровне, 297 к сотому (как в описании атрибутов)", () => {
  assert.equal(pointsAt(1), 0);
  assert.equal(pointsAt(2), ATTR2.pointsPerLevel);
  assert.equal(pointsAt(100), 297);
  assert.equal(spentOn(blankAttrs()), 0);
});

test("класс — по оружию в руках", () => {
  assert.equal(classOf2("spear", ""), "spearman");
  assert.equal(classOf2("hammer", "shield"), "battlemage");
  assert.equal(classOf2("staff", ""), "support");
  assert.equal(classOf2("bow", ""), "archer");
  assert.equal(classOf2("dagger", "dagger"), "assassin");
  assert.equal(classOf2("dagger", "sword"), "warrior");
  assert.equal(classOf2("sword", "shield"), "warrior");
  assert.equal(classOf2("", ""), null);
  assert.equal(classOf2("shield", ""), null);
});

test("пара одинаковых клинков — только кинжалы или мечи", () => {
  assert.equal(isDualPair("dagger", "dagger"), true);
  assert.equal(isDualPair("sword", "sword"), true);
  assert.equal(isDualPair("dagger", "sword"), false);
  assert.equal(isDualPair("bow", "bow"), false);
  assert.equal(isDualPair(null, null), false);
});

test("один предмет в руках: пустая рука или один двуручник в обеих", () => {
  assert.equal(holdsOneItem("", ""), true);
  assert.equal(holdsOneItem("bow", "bow"), true);
  assert.equal(holdsOneItem("sword", "shield"), false);
  assert.equal(holdsOneItem("sword", "sword"), false);
});

test("ТЕЛ даёт физ. броню: больше вложений — больше брони, но не выше предела", () => {
  assert.equal(armorFrac(blankAttrs()), 0);
  const low = { ...blankAttrs(), con: 10 };
  const high = { ...blankAttrs(), con: 40 };
  assert.ok(armorFrac(low) > 0);
  assert.ok(armorFrac(high) > armorFrac(low));
  assert.ok(armorFrac(high) < 1);
});

test("МДР даёт магзащиту; кольца магзащиту не дают", () => {
  assert.equal(magicResistFrac(blankAttrs()), 0);
  const base = { ...blankAttrs(), wis: 30 };
  assert.ok(magicResistFrac(base) > 0);
  assert.ok(magicResistFrac(base) < 1);
});

test("ЛОВ ускоряет удары и бег: больше ЛОВ — меньше пауза, быстрее бег", () => {
  const slow = blankAttrs();
  const fast = { ...blankAttrs(), agi: 30 };
  assert.ok(heroAttackInterval("sword", 10, fast) < heroAttackInterval("sword", 10, slow));
  assert.ok(heroAttackInterval("bow", 10, fast) < heroAttackInterval("bow", 10, slow));
  assert.ok(moveSpeed2(10, fast) > moveSpeed2(10, slow));
});

test("множитель темпа делит паузу (пара клинков — без прибавки темпа, 2026-10-19)", () => {
  const a = blankAttrs();
  assert.ok(close(heroAttackInterval("sword", 5, a, 2), heroAttackInterval("sword", 5, a, 1) / 2));
});

test("пауза любого оружия положительна и не растёт с уровнем", () => {
  const a = blankAttrs();
  for (const w of WEAPONS) {
    let prev = Infinity;
    for (let L = 1; L <= 100; L += 9) {
      const v = heroAttackInterval(w, L, a);
      assert.ok(v > 0, `${w} на ${L} ур.`);
      assert.ok(v <= prev + 1e-12, `${w} медленнее на ${L} ур.`);
      prev = v;
    }
  }
});

test("МДР ускоряет каст посоха и откат", () => {
  const slow = blankAttrs();
  const fast = { ...blankAttrs(), wis: 30 };
  assert.ok(castTempo2(10, fast) > castTempo2(10, slow));
  assert.ok(staffCastInterval(10, fast) < staffCastInterval(10, slow));
});

test("уворот и крит ограничены потолками; один предмет в руках увёртывается лучше", () => {
  const lucky = { ...blankAttrs(), luc: 1000 };
  assert.ok(dodge2(lucky, true) <= ATTR2.luc.dodgeCap + 1e-12);
  assert.ok(critChance2(lucky, 0.1) <= 0.75);
  const some = { ...blankAttrs(), luc: 10 };
  assert.ok(dodge2(some, true) > dodge2(some, false));
  assert.ok(dodge2(some, false, true) > dodge2(some, false));
});

test("СИЛ и уровень повышают физ. урон", () => {
  assert.ok(physPower2(10, { ...blankAttrs(), str: 20 }) > physPower2(10, blankAttrs()));
  assert.ok(physPower2(20, blankAttrs()) > physPower2(10, blankAttrs()));
});

test("рост от уровня: прирост копится и ускоряется", () => {
  assert.equal(levelGain(1, { perLevel: 1, accel: 0.5 }), 0);
  assert.equal(levelGain(2, { perLevel: 1, accel: 0.5 }), 1);
  assert.equal(levelGain(3, { perLevel: 1, accel: 0.5 }), 2.5);
});
