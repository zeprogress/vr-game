import { test } from "node:test";
import assert from "node:assert/strict";
import { DUN_MOB_CAMPS, dunFloorLocal, dunWorld, dunZoneAt } from "../../src/shared/dungeon";
import { ELITE_MOBS, MOB } from "../../src/shared/mobs";

const lava = DUN_MOB_CAMPS.filter((c) => c.type === "lavaGuard" || c.type === "lavaMage");

test("лавовый монстр: по два моба на точку, Стража и Мага — в Кузне (Y)", () => {
  assert.equal(lava.length, 2);
  for (const c of lava) {
    assert.equal(c.count, 2);
    const w = dunWorld(c.u, c.v);
    assert.equal(dunZoneAt(w.x, w.z).id, "Y", `${c.type} вне Кузни`);
  }
});

test("лавовый монстр: вокруг стоянки пол с запасом на тело (кольцо spread)", () => {
  for (const c of lava) {
    const pad = MOB.bodyRadius * ELITE_MOBS[c.type].scaleMul;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const u = c.u + Math.cos(a) * c.spread;
      const v = c.v + Math.sin(a) * c.spread;
      assert.notEqual(dunFloorLocal(u, v, pad), null, `${c.type}: точка ${k} — не на полу`);
    }
  }
});
