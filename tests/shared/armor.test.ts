import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARMOR_LEVEL_GATE,
  ARMOR_PARTS,
  ARMOR_POINTS_MAX,
  ARMOR_RANGE,
  ARMOR_TIER_MUL,
  armorBonusOf,
  armorLevelMul,
  armorPool,
  armorRollValue,
  armorValue,
  rollArmor,
  type ArmorInstance,
  type ArmorPart,
  type ArmorStat,
  type ArmorTier,
} from "../../src/shared/armor";
import { seeded, close } from "./rng";

const STATS: readonly ArmorStat[] = ["hp", "physDef", "magDef", "regen", "dodge"];

/** Броня `n` штук одной части и тира, для проверки сумм. */
function many(part: ArmorPart, tier: ArmorTier, n: number, seed: number): ArmorInstance[] {
  const rnd = seeded(seed);
  return Array.from({ length: n }, (_, i) => rollArmor(part, `${part}${i}`, rnd, tier));
}

test("значение аффикса растёт с очками и укладывается в диапазон стата", () => {
  for (const s of STATS) {
    const [lo, hi] = ARMOR_RANGE[s];
    assert.ok(close(armorValue(s, 1), lo), `${s}: 1 очко — нижняя граница`);
    assert.ok(close(armorValue(s, ARMOR_POINTS_MAX), hi), `${s}: максимум очков — верхняя граница`);
    for (let p = 2; p <= ARMOR_POINTS_MAX; p++) assert.ok(armorValue(s, p) > armorValue(s, p - 1), `${s} на ${p} очке`);
  }
});

test("обычная часть — один аффикс; уникальный шлем тоже один (два и три — только нагрудник и поножи)", () => {
  for (const part of ARMOR_PARTS) {
    for (const a of many(part, "base", 30, 1)) assert.equal(a.rolls.length, 1, `${part} обычный`);
  }
  for (const a of many("helm", "legendary", 30, 2)) assert.equal(a.rolls.length, 1, "шлем уникальный");
});

test("золотый нагрудник — 1 или 2 аффикса, уникальный нагрудник — 2 или 3", () => {
  const gold = many("chest", "gold", 300, 3).map((a) => a.rolls.length);
  assert.ok(gold.every((n) => n === 1 || n === 2));
  assert.ok(gold.includes(2));
  const lg = many("chest", "legendary", 300, 4).map((a) => a.rolls.length);
  assert.ok(lg.every((n) => n === 2 || n === 3));
  assert.ok(lg.includes(3));
});

test("аффиксы одной части не повторяют стат и берутся из пула её тира", () => {
  for (const tier of ["base", "gold", "legendary"] as const) {
    for (const part of ARMOR_PARTS) {
      for (const a of many(part, tier, 60, 5)) {
        const stats = a.rolls.map((r) => r.stat);
        assert.equal(new Set(stats).size, stats.length, `${part}/${tier}: повтор стата`);
        for (const r of a.rolls) assert.ok(armorPool(part, tier).includes(r.stat), `${part}/${tier}: ${r.stat} не из пула`);
      }
    }
  }
});

test("тир усиливает значение: золотой ×1.2, уникальный ×1.3 к обычному", () => {
  const r = { stat: "physDef" as const, pts: 10 };
  const base = armorRollValue({ tier: "base" }, r);
  assert.ok(close(armorRollValue({ tier: "gold" }, r), base * ARMOR_TIER_MUL.gold));
  assert.ok(close(armorRollValue({ tier: "legendary" }, r), base * ARMOR_TIER_MUL.legendary));
});

test("сумма бонусов брони — сумма значений всех её аффиксов", () => {
  assert.deepEqual(armorBonusOf([]), { hp: 0, physDef: 0, magDef: 0, regen: 0, dodge: 0 });
  const worn = [...many("helm", "base", 2, 6), ...many("chest", "gold", 2, 7)];
  const bonus = armorBonusOf(worn);
  for (const s of STATS) {
    let sum = 0;
    for (const a of worn) for (const r of a.rolls) if (r.stat === s) sum += armorRollValue(a, r);
    assert.ok(close(bonus[s], sum), s);
  }
});

test("множитель шанса по уровню моба: 0 на 1-м, 1 с 53-го, линейно между", () => {
  const gate = ARMOR_LEVEL_GATE.gold;
  assert.equal(armorLevelMul(1, gate), 0);
  assert.equal(armorLevelMul(0, gate), 0);
  assert.equal(armorLevelMul(27, gate), 0.5);
  assert.equal(armorLevelMul(53, gate), 1);
  assert.equal(armorLevelMul(100, gate), 1);
});
