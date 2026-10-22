import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { ELITE_MOBS, LAVA } from "../../src/shared/mobs";

const script = readFileSync("tools/blender/lavamonster_anim.py", "utf8");
const num = (name: string): number => {
  const m = script.match(new RegExp(`^${name}\\s*=\\s*([0-9.]+)`, "m"));
  assert.ok(m, `в скрипте нет ${name}`);
  return Number(m![1]);
};

test("Лавовый монстр: таймеры клипов совпадают с tools/blender/lavamonster_anim.py", () => {
  assert.equal(LAVA.clipSec.slam, num("SLAM_SEC"));
  assert.equal(LAVA.clipSec.attack, num("ATTACK_SEC"));
  assert.equal(LAVA.clipSec.hit, num("HIT_SEC"));
  assert.equal(LAVA.clipSec.death, num("DEATH_SEC"));
  assert.equal(LAVA.clipSec.idle, num("IDLE_SEC"));
  assert.equal(LAVA.hitSec.slam, num("SLAM_HIT"));
  assert.equal(LAVA.hitSec.attack, num("ATTACK_HIT"));
});

test("Лавовый монстр: два моба 75 ур., одна модель, модель лежит в public", () => {
  for (const k of ["lavaGuard", "lavaMage"] as const) {
    const d = ELITE_MOBS[k];
    assert.equal(d.level, 75, k);
    assert.equal(d.model, "monLavaMonster", k);
    assert.ok(d.hp > 0 && d.xp > 0, k);
  }
  assert.ok(ELITE_MOBS.lavaGuard.lavaGuard && ELITE_MOBS.lavaMage.lavaMage);
  assert.ok(existsSync("public/models/gen/LavaMonster.glb"));
});
