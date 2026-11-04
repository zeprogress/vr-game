import { test } from "node:test";
import assert from "node:assert/strict";
import { RUNE_SLOTS_BY_TIER, runePts, runeKey, parseRuneKey, runeSlots, rollSolid, SOLID_DEFS } from "../../src/shared/runes";
import { insertRune, removeRune, hasFreeSlot, runeKeyOf } from "../../src/server/runes";
import { rollWeaponInstance, affixPoints } from "../../src/shared/items";
import { rollArmor } from "../../src/shared/armor";
import { seeded } from "./rng";

test("гнёзда по грейду: обычное 2, золотое 3, уникальное 4, рубиновое 5", () => {
  assert.equal(runeSlots("base"), 2);
  assert.equal(runeSlots("gold"), 3);
  assert.equal(runeSlots("legendary"), 4);
  assert.equal(runeSlots("ruby"), 5);
  assert.deepEqual(Object.keys(RUNE_SLOTS_BY_TIER).length > 0, true);
});

test("твердь выдаётся при дропе оружия и брони", () => {
  for (let i = 0; i < 20; i++) {
    const w = rollWeaponInstance("sword", "legendary", seeded(i + 1));
    assert.ok(w.solid && w.solid in SOLID_DEFS, `твердь меча: ${w.solid}`);
  }
  const a = rollArmor("chest", "a1", seeded(3), "ruby", "heavy", 10);
  assert.ok(a.solid && a.solid in SOLID_DEFS);
  assert.ok(rollSolid("shield", seeded(1)));
});

test("руна ставится новой гранью с силой по очкам; слабее уже стоящей — отказ", () => {
  const w = rollWeaponInstance("sword", "legendary", seeded(5));
  w.affixes = [];
  assert.ok(hasFreeSlot(w));
  assert.equal(insertRune(w, runeKey("dmgFlat", 3)), null);
  assert.equal(w.affixes.length, 1);
  assert.equal(affixPoints(w.affixes[0], w), runePts(3));
  assert.ok(insertRune(w, runeKey("dmgFlat", 2)), "руна слабее стоящей — отказ");
  assert.equal(insertRune(w, runeKey("dmgFlat", 5)), null, "руна сильнее — повышает грань");
  assert.equal(affixPoints(w.affixes[0], w), runePts(5));
});

test("руна чужого вида в предмет не встаёт", () => {
  const w = rollWeaponInstance("shield", "legendary", seeded(9));
  w.affixes = [];
  assert.ok(insertRune(w, "vamp:3"), "вампиризм щиту не годится");
});

test("вынутая грань возвращает руну с ближайшей силой", () => {
  assert.equal(runeKeyOf("critChance", runePts(5)), "critChance:5");
  assert.equal(parseRuneKey("critChance:5")?.power, 5);
  const w = rollWeaponInstance("sword", "legendary", seeded(11));
  w.affixes = [];
  insertRune(w, "critChance:4");
  const r = removeRune(w, 0);
  assert.equal(r.key, "critChance:4");
  assert.equal(w.affixes.length, 0);
});

test("броня тоже принимает руны своего пула", () => {
  const a = rollArmor("chest", "b2", seeded(7), "ruby", "heavy", 20);
  a.rolls = [];
  assert.equal(insertRune(a, "physDef:3"), null);
  assert.ok(a.rolls.some((r) => r.stat === "physDef"));
});
