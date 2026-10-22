import { test } from "node:test";
import assert from "node:assert/strict";
import { DUN_MOB_CAMPS, dunFloorLocal, dunWorld, dunZoneAt } from "../../src/shared/dungeon";
import { ELITE_MOBS, MOB } from "../../src/shared/mobs";

const lava = DUN_MOB_CAMPS.filter((c) => c.type === "lavaGuard" || c.type === "lavaMage");

test("лавовый монстр: четыре группы по четыре моба, Стражи и Маги — в Затопленных ступенях (S) и Обвальной галерее (T)", () => {
  assert.equal(lava.length, 4);
  for (const c of lava) {
    assert.equal(c.count, 4);
    const w = dunWorld(c.u, c.v);
    assert.ok(["S", "T"].includes(dunZoneAt(w.x, w.z).id), `${c.type} не в Затопленных ступенях или Обвальной галерее`);
  }
});

test("лавовый монстр: стоянка группы — пол вокруг с запасом на тело", () => {
  for (const c of lava) {
    const pad = MOB.bodyRadius * ELITE_MOBS[c.type].scaleMul;
    const ring = c.spread * (c.ring ?? 1);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const u = c.u + Math.cos(a) * ring;
      const v = c.v + Math.sin(a) * ring;
      assert.notEqual(dunFloorLocal(u, v, pad), null, `${c.type}: точка ${k} — не на полу`);
    }
  }
});
