import { test } from "node:test";
import assert from "node:assert/strict";
import { PROGRESSION } from "../../src/shared/constants";
import { ATTR2 } from "../../src/shared/attrs2";
import { pointsAt, stepCost } from "../../src/shared/classes2";
import {
  atMaxLevel,
  blankProgress,
  grantXp,
  killXp,
  mobXpAt,
  resetAttrs,
  spendPoint,
  statCost,
  XP_CURVE,
  xpToNext,
} from "../../src/shared/progression";
import { close } from "./rng";

test("опыт до следующего уровня растёт; на максимуме — бесконечность", () => {
  assert.equal(xpToNext(1), XP_CURVE.base);
  for (let L = 1; L < PROGRESSION.maxLevel - 1; L++) assert.ok(xpToNext(L + 1) > xpToNext(L), `уровень ${L}`);
  assert.equal(xpToNext(PROGRESSION.maxLevel), Infinity);
});

test("новый герой: 1 уровень, без опыта, атрибуты на старте, очки уровня", () => {
  const p = blankProgress();
  assert.equal(p.level, 1);
  assert.equal(p.xp, 0);
  assert.equal(p.unspent, pointsAt(1));
  for (const k of ["str", "agi", "int", "con", "luc", "wis"] as const) assert.equal(p[k], ATTR2.start);
});

test("grantXp: ровно на порог — уровень вверх и очки уровня", () => {
  const p = blankProgress();
  const before = p.unspent;
  assert.equal(grantXp(p, xpToNext(1)), 1);
  assert.equal(p.level, 2);
  assert.equal(p.xp, 0);
  assert.equal(p.unspent, before + ATTR2.pointsPerLevel);
});

test("grantXp: большой опыт — сразу несколько уровней, остаток ниже порога", () => {
  const p = blankProgress();
  grantXp(p, xpToNext(1) + xpToNext(2) + 5);
  assert.equal(p.level, 3);
  assert.equal(p.xp, 5);
  assert.ok(p.xp < xpToNext(p.level));
});

test("на максимальном уровне опыт не копится", () => {
  const p = blankProgress();
  assert.ok(grantXp(p, 1e15) > 0);
  assert.equal(p.level, PROGRESSION.maxLevel);
  assert.equal(p.xp, 0);
  assert.ok(atMaxLevel(p.level));
  assert.equal(grantXp(p, 100), 0);
});

test("spendPoint: без очков атрибут не растёт, с очками — списывает цену", () => {
  const p = blankProgress();
  p.unspent = 0;
  assert.equal(spendPoint(p, "str"), false);
  assert.equal(p.str, ATTR2.start);
  p.unspent = 2;
  assert.equal(spendPoint(p, "str"), true);
  assert.equal(p.str, ATTR2.start + 1);
  assert.equal(p.unspent, 1);
});

test("цена подъёма растёт с вложенным: одиннадцатое очко стоит 2", () => {
  const p = blankProgress();
  p.str = 11;
  assert.equal(statCost(p, "str"), 2);
  assert.equal(statCost(p, "str"), stepCost(11));
  p.unspent = 1;
  assert.equal(spendPoint(p, "str"), false);
  p.unspent = 2;
  assert.equal(spendPoint(p, "str"), true);
  assert.equal(p.unspent, 0);
});

test("resetAttrs: атрибуты снова на старте, очки — все за текущий уровень", () => {
  const p = blankProgress();
  grantXp(p, xpToNext(1) + xpToNext(2));
  p.str = 25;
  p.wis = 9;
  resetAttrs(p);
  assert.equal(p.str, ATTR2.start);
  assert.equal(p.wis, ATTR2.start);
  assert.equal(p.unspent, pointsAt(p.level));
});

test("опыт за моба растёт с уровнем моба", () => {
  for (let L = 1; L < PROGRESSION.maxLevel - 1; L++) assert.ok(mobXpAt(L + 1) > mobXpAt(L), `моб ${L}`);
});

test("killXp: моб своего уровня даёт базовый опыт, босс — во столько раз больше, сколько bossMul", () => {
  assert.ok(close(killXp(10, 10), mobXpAt(10)));
  assert.ok(close(killXp(10, 10, true), mobXpAt(10) * XP_CURVE.bossMul));
});

test("killXp: слабый моб даёт меньше; сильнее героя — прибавка, и чем выше моб, тем она меньше", () => {
  assert.ok(killXp(5, 10) < killXp(10, 10));
  assert.ok(killXp(11, 10) > killXp(15, 10));
  assert.ok(killXp(15, 10) > killXp(20, 10));
  assert.ok(killXp(20, 10) > mobXpAt(10));
  assert.ok(close(killXp(11, 10), mobXpAt(10) * (1 + XP_CURVE.bonusFirst)));
});

test("killXp: моб без уровня считается 1-го; на максимуме опыта нет", () => {
  assert.ok(close(killXp(0, 1), killXp(1, 1)));
  assert.equal(killXp(10, PROGRESSION.maxLevel), 0);
});
