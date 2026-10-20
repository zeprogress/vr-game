import { test } from "node:test";
import assert from "node:assert/strict";
import { ZoneSim } from "../../src/server/sim/ZoneSim";
import { ICE_GIANT } from "../../src/shared/mobs";

const F = ICE_GIANT.frost;

test("холод: стаки «Обморожения» 1..4, на 5-м — «Ледяная глыба» (моб стоит freezeSec), потом пауза", () => {
  const sim = new ZoneSim();
  const id = [...sim.mobs.keys()][0];
  const m = sim.mobs.get(id)!;
  for (let i = 1; i < F.maxStacks; i++) assert.deepEqual(sim.chillMob(id), { k: "stack", n: i });
  assert.deepEqual(sim.chillMob(id), { k: "encase", n: F.maxStacks });
  assert.ok(m.stunned, "в глыбе моб не двигается и не бьёт");
  assert.equal(sim.chillMob(id), null, "после глыбы стаки не копятся");
});

test("холод: стаки тают, если по мобу долго не били холодом", () => {
  const sim = new ZoneSim();
  const id = [...sim.mobs.keys()][0];
  const m = sim.mobs.get(id)!;
  sim.chillMob(id);
  sim.chillMob(id);
  m.tickFrost(F.stackSec + 0.1);
  assert.deepEqual(sim.chillMob(id), { k: "stack", n: 1 }, "счёт начался заново");
});
