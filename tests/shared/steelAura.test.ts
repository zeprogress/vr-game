import { test } from "node:test";
import assert from "node:assert/strict";
import { STEEL_AURA, SKILLS2, CLASSES2, steelAuraSelfDamage, steelAuraTick, steelModeOf } from "../../src/shared/classes2";

test("Аура раскалённой стали: режим по оружию — щит, один меч, дуалы", () => {
  assert.equal(steelModeOf("shield", "sword"), "shield");
  assert.equal(steelModeOf("sword", "shield"), "shield");
  assert.equal(steelModeOf("sword", "sword"), "dual");
  assert.equal(steelModeOf("", "sword"), "sword");
  assert.equal(steelModeOf("sword", ""), "sword");
});

test("Аура раскалённой стали: урон в секунду — 300% регенерации; дуалы не жгут", () => {
  assert.equal(steelAuraTick("shield", 4).dmg, 12);
  assert.equal(steelAuraTick("sword", 4).dmg, 12);
  assert.equal(steelAuraTick("dual", 4).dmg, 0);
});

test("Аура раскалённой стали: один меч замедляет врагов; дуалы дают воину 10% защиты; лечения нет", () => {
  assert.equal(steelAuraTick("sword", 1).slow, true);
  assert.equal(steelAuraTick("shield", 1).slow, false);
  assert.equal(steelAuraTick("dual", 1).slow, false);
  assert.equal(steelAuraTick("dual", 1).defense, 0.1);
  assert.equal(steelAuraTick("sword", 1).defense, 0);
  assert.equal(STEEL_AURA.slowMul, 0.8, "замедление 20%");
  assert.equal(STEEL_AURA.dualDef, 0.1, "защита 10%");
  assert.ok(!("healPerEnemy" in steelAuraTick("shield", 1)), "у ауры нет лечения");
});

test("Аура раскалённой стали: радиус 6 м, откат 15 с, на длительность 6 с; у воина в списке умений", () => {
  const sk = SKILLS2.steelAura;
  assert.equal(sk.radius, 6);
  assert.equal(sk.cooldown, 15);
  assert.equal(STEEL_AURA.duration, 6);
  assert.ok(CLASSES2.warrior.skills.includes("steelAura"));
});

test("Аура раскалённой стали: самосожжение 10% макс. HP, к 30% HP — ноль", () => {
  assert.ok(Math.abs(steelAuraSelfDamage(1000, 1000) - 100) < 1e-9);
  assert.ok(Math.abs(steelAuraSelfDamage(1000, 650) - 50) < 1e-9);
  assert.equal(steelAuraSelfDamage(1000, 300), 0);
  assert.equal(steelAuraSelfDamage(1000, 100), 0);
});
