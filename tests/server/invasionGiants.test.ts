import { test } from "node:test";
import assert from "node:assert/strict";
import { EVENT } from "../../src/shared/constants";
import { ELITE_MOBS } from "../../src/shared/mobs";
import { ZoneSim, eliteOpts } from "../../src/server/sim/ZoneSim";

test("нашествие: гигант — 100 ударов, второй бьющий их не добавляет, фаз нет", () => {
  const sim = new ZoneSim();
  const e = ELITE_MOBS.iceGiant;
  const id = sim.spawnEventMob(e.kind, 0, 0, { ...eliteOpts(e), hp: EVENT.invasion.giants.hits });
  const m = sim.mobs.get(id)!;
  m.hitCounter = true;
  m.hitsFixed = true;
  assert.equal(m.hp, 100);
  sim.hitMob(id, 5000, 0, 1, "hero-a");
  sim.hitMob(id, 3, 0, 1, "hero-b");
  assert.equal(m.hp, 98, "каждое попадание — минус один удар");
  assert.equal(m.maxHp, 100, "новый бьющий не добавляет ударов");
  assert.equal(m.huntPhase, 0);
});

test("нашествие: с гиганта — 5 лома за убийство, с гиганта лагеря — 100", () => {
  const sim = new ZoneSim();
  const e = ELITE_MOBS.iceGiant;
  const inv = sim.spawnEventMob(e.kind, 0, 0, { ...eliteOpts(e), hp: EVENT.invasion.giants.hits, scrap: EVENT.invasion.giants.scrap });
  assert.equal(sim.mobs.get(inv)!.scrapN, 5);
  const camp = sim.spawnEventMob(e.kind, 0, 0, eliteOpts(e));
  assert.equal(sim.mobs.get(camp)!.scrapN, 100);
});

test("лом гиганта делится поровну между всеми, кто бил (остаток — первому)", () => {
  const sim = new ZoneSim();
  const e = ELITE_MOBS.iceGiant;
  const id = sim.spawnEventMob(e.kind, 0, 0, { ...eliteOpts(e), scrap: 100, scrapShared: true });
  const m = sim.mobs.get(id)!;
  sim.hitMob(id, 1000, 0, 1, "hero-b");
  sim.hitMob(id, 1000, 0, 1, "hero-c");
  sim.hitMob(id, 2e9, 0, 1, "hero-a");
  const k = sim.mobKills.at(-1)!;
  assert.equal(k.sc, 100);
  assert.deepEqual([...(k.pt ?? [])].sort(), ["hero-a", "hero-b", "hero-c"]);
  assert.ok(m.dead);
});
