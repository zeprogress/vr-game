import { test } from "node:test";
import assert from "node:assert/strict";
import { ZoneSim } from "../../src/server/sim/ZoneSim";
import { ELITE_MOBS } from "../../src/shared/mobs";

test("событие: считает появившихся мобов — половина убита = середина стадии", () => {
  const sim = new ZoneSim();
  const before = sim.eventSpawned;
  const e = ELITE_MOBS.iceGiant;
  const a = sim.spawnEventMob(e.kind, 0, 0, { hp: 100 } as never);
  sim.spawnEventMob(e.kind, 5, 0, { hp: 100 } as never);
  assert.equal(sim.eventSpawned - before, 2);
  assert.equal(sim.eventMobsLeft(), 2);
  sim.mobs.get(a)!.hp = 0;
  sim.mobs.get(a)!.dead = true;
  assert.equal(sim.eventMobsLeft(), 1, "мёртвые не считаются");
  assert.ok(sim.eventMobsLeft() <= sim.eventSpawned * 0.5, "половина убита — середина стадии");
});
