import { test } from "node:test";
import assert from "node:assert/strict";
import { ZoneSim } from "../../src/server/sim/ZoneSim";

/**
 * Счётчики лечения катакомб (панель у спектатора): отдельно «себе» и «союзникам»,
 * вампиризм сюда не входит — его учитывает vampHeal, а не skillHeal.
 */
test("катакомбы: карты лечения себе и другим есть и стартуют пустыми", () => {
  const sim = new ZoneSim();
  assert.equal(sim.catHealSelf.size, 0);
  assert.equal(sim.catHealOthers.size, 0);
  sim.catHealSelf.set("bot:1", 100);
  sim.catHealOthers.set("bot:1", 250);
  assert.equal(sim.catHealSelf.get("bot:1"), 100);
  assert.equal(sim.catHealOthers.get("bot:1"), 250);
});

test("катакомбы: лечение не смешивается с уроном", () => {
  const sim = new ZoneSim();
  sim.catDamage.set("bot:1", 5000);
  sim.catHealSelf.set("bot:1", 1200);
  assert.notEqual(sim.catDamage.get("bot:1"), sim.catHealSelf.get("bot:1"));
});
