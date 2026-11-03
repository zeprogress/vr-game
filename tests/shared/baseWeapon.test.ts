import { test } from "node:test";
import assert from "node:assert/strict";
import { ATTACK_CLASSES, ITEMS, rollWeaponInstance, type WeaponClass } from "../../src/shared/items";
import { HUB } from "../../src/shared/hub";
import { WEAPON_DROP, ZoneSim } from "../../src/server/sim/ZoneSim";

const BASE_CLASSES: WeaponClass[] = [...ATTACK_CLASSES, "shield"];

test("базовое оружие есть в ITEMS для всех классов и падает как обычный дроп", () => {
  for (const cls of BASE_CLASSES) {
    const id = `base_${cls}` as keyof typeof ITEMS;
    assert.ok(ITEMS[id], `${cls}: нет ITEMS.${String(id)}`);
    assert.equal(ITEMS[id].weapon?.cls, cls);
    assert.equal(ITEMS[id].weapon?.tier, "base");
    assert.equal(WEAPON_DROP[`${cls}:base`], id, `${cls}: нет WEAPON_DROP`);
  }
});

test("базовое оружие получает ролл, как остальные тиры", () => {
  const w = rollWeaponInstance("sword", "base", () => 0.5);
  assert.equal(w.affixes.length, 1, "у базового меча должен быть ролл");
});

test("базовое оружие реально падает на землю, как остальные тиры", () => {
  const sim = new ZoneSim();
  assert.equal(sim.dropWeapon("sword", "base", 0, 0), "base_sword");
  assert.equal(sim.dropWeapon("bow", "base", 1, 1), "base_bow");
  assert.equal([...sim.drops.values()].filter((d) => d.instance?.tier === "base").length, 2);
});

test("в лагере больше нет оружейной стойки и главного шатра", () => {
  assert.ok(!("weapons" in HUB.zones), "зона оружейной осталась");
  assert.ok(!("mainTent" in HUB.zones), "главный шатёр остался");
});
