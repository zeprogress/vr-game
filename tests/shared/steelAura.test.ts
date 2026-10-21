import { test } from "node:test";
import assert from "node:assert/strict";
import { STEEL_AURA, SKILLS2, CLASSES2, steelAuraTick, steelModeOf } from "../../src/shared/classes2";

test("Аура раскалённой стали: режим по оружию — щит, один меч, дуалы", () => {
  assert.equal(steelModeOf("shield", "sword"), "shield");
  assert.equal(steelModeOf("sword", "shield"), "shield");
  assert.equal(steelModeOf("sword", "sword"), "dual");
  assert.equal(steelModeOf("", "sword"), "sword");
  assert.equal(steelModeOf("sword", ""), "sword");
});

test("Аура раскалённой стали: урон в секунду — 500% регенерации; дуалы — вдвое слабее", () => {
  const regen = 4;
  assert.equal(steelAuraTick("shield", regen, 1000).dmg, regen * 5);
  assert.equal(steelAuraTick("sword", regen, 1000).dmg, regen * 5);
  assert.equal(steelAuraTick("dual", regen, 1000).dmg, regen * 5 * STEEL_AURA.dualMul);
  assert.equal(STEEL_AURA.dualMul, 0.5);
});

test("Аура раскалённой стали: щит лечит 1% HP за врага, меч замедляет, остальные — нет", () => {
  const t = steelAuraTick("shield", 1, 800);
  assert.equal(t.healPerEnemy, 8);
  assert.equal(t.slow, false);
  assert.equal(steelAuraTick("sword", 1, 800).healPerEnemy, 0);
  assert.equal(steelAuraTick("sword", 1, 800).slow, true);
  assert.equal(steelAuraTick("dual", 1, 800).slow, false);
  assert.equal(STEEL_AURA.slowMul, 0.8, "замедление 20%");
});

test("Аура раскалённой стали: радиус 6 м, откат 15 с, на длительность 6 с; у воина в списке умений", () => {
  const sk = SKILLS2.steelAura;
  assert.equal(sk.radius, 6);
  assert.equal(sk.cooldown, 15);
  assert.equal(STEEL_AURA.duration, 6);
  assert.ok(CLASSES2.warrior.skills.includes("steelAura"));
});
