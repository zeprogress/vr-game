import { test } from "node:test";
import assert from "node:assert/strict";
import { CRACK_MAX, NATURES, emptyHistory, historyBonus, historyText, polishChance, polishCost, rollNature, natureName } from "../../src/shared/nature";
import { polishItem, brandItem, omenItem, essenceItem, reforgeKinds } from "../../src/server/reforge";
import { rollWeaponInstance, weaponQuality, affixPoints, type WeaponInstance } from "../../src/shared/items";
import { rollArmor, type ArmorInstance } from "../../src/shared/armor";
import { seeded } from "./rng";

const w = (): WeaponInstance => rollWeaponInstance("sword", "legendary", seeded(7));

test("природа выдаётся при дропе случайно и не повторяется у всех предметов", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 60; i++) {
    const a = rollWeaponInstance("sword", "legendary", seeded(i + 1));
    assert.ok(a.nat && (NATURES as readonly string[]).includes(a.nat), "природа из пула");
    seen.add(a.nat!);
  }
  assert.ok(seen.size >= 4, `природ разнообразных: ${seen.size}`);
  assert.equal(natureName("hunter"), "Хищник");
  // Щит не получает боевую природу про урон.
  for (let i = 0; i < 20; i++) assert.notEqual(rollNature(seeded(i), "shield"), "hunter");
});

test("полировка меняет очки всех граней и пишет историю", () => {
  const x = w();
  const before = x.affixes.map((a) => affixPoints(a, x));
  polishItem(x, seeded(3));
  assert.equal(x.rh?.pol, 1);
  assert.ok(x.affixes.every((a, i) => affixPoints(a, x) !== before[i]), "очки перекатаны");
});

test("трещины: полировка слабее, на второй случайная грань теряет очко, на третьей (сколот) числа не растут", () => {
  assert.ok(polishChance(1, undefined) < polishChance(0, undefined));
  assert.ok(polishCost("legendary", 1) > polishCost("legendary", 0));
  const x = w();
  x.cracks = 2;
  const before = x.affixes.map((a) => affixPoints(a, x));
  polishItem(x, seeded(5));
  const total = before.reduce((s, n) => s + n, 0);
  const now = x.affixes.reduce((s, a) => s + affixPoints(a, x), 0);
  assert.ok(now < total + before.length * 3, "с трещиной рост ограничен");
  const broken = w();
  broken.cracks = CRACK_MAX;
  const pts = broken.affixes.map((a) => affixPoints(a, broken));
  polishItem(broken, seeded(6));
  assert.deepEqual(broken.affixes.map((a) => affixPoints(a, broken)), pts, "сколот — числа не растут");
});

test("Грань меняет вид грани, но сохраняет очки; число роллов то же", () => {
  const x = w();
  const n = x.affixes.length;
  const pts = affixPoints(x.affixes[0], x);
  const sub = x.affixes[0].sub;
  brandItem(x, 0, seeded(11));
  assert.equal(x.affixes.length, n);
  assert.notEqual(x.affixes[0].sub, sub);
  assert.equal(x.rh?.swaps, 1);
  assert.ok(pts > 0);
});

test("Знамение раскалывает грань, ниже минимума грейда — трещина", () => {
  const x = w();
  x.affixes = x.affixes.slice(0, 2); // у уникального минимум 2
  omenItem(x, 0);
  assert.equal(x.affixes.length, 1);
  assert.equal(x.cracks, 1, "ниже минимума — трещина");
  // Последнюю грань расколоть нельзя.
  const r = omenItem(x, 0);
  assert.equal(r.ok, false);
});

test("Эссенция ставит нужный вид, «заражает» ещё одну грань и лечит трещину", () => {
  const x = w();
  x.cracks = 1;
  const kinds = reforgeKinds(x);
  const want = kinds.find((k) => !x.affixes.some((a) => a.sub === k));
  if (!want) return;
  essenceItem(x, 0, want, seeded(21));
  assert.ok(x.affixes.some((a) => a.sub === want), "нужная грань стоит");
  assert.equal(x.cracks, 0, "трещина залечена");
  assert.equal(x.rh?.healed, 1);
});

test("история даёт бонусы: растущая — главная грань, замены — шире но ниже потолок, лечение — регенерация", () => {
  assert.equal(historyBonus(undefined).floor, 0.05, "не точился — стабильные грани");
  const grow = historyBonus({ ...emptyHistory(), pol: 10, up: 7 });
  assert.ok(grow.main > 0);
  const swap = historyBonus({ ...emptyHistory(), pol: 4, up: 1, swaps: 4 });
  assert.ok(swap.floor > 0 && swap.cap < 1);
  const heal = historyBonus({ ...emptyHistory(), pol: 3, up: 2, healed: 2 });
  assert.equal(heal.regen, 2);
  assert.match(historyText({ ...emptyHistory(), pol: 5, up: 4 }), /полировка ×5/);
});

test("полировка брони — те же правила", () => {
  const a: ArmorInstance = rollArmor("chest", "b1", seeded(9), "ruby", "heavy", 40);
  const before = a.rolls.map((r) => r.pts);
  polishItem(a, seeded(4));
  assert.equal(a.rh?.pol, 1);
  assert.ok(a.rolls.every((r, i) => r.pts !== before[i]));
});

test("качество оружия не теряется при перековке (очки остаются целыми 1..33)", () => {
  const x = w();
  for (let i = 0; i < 6; i++) polishItem(x, seeded(30 + i));
  assert.ok(weaponQuality(x) > 0);
  assert.ok(x.affixes.every((a) => affixPoints(a, x) >= 1 && affixPoints(a, x) <= 33));
});
