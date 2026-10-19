import { test } from "node:test";
import assert from "node:assert/strict";
import { EVENT, huntPhaseFor } from "../../src/shared/constants";
import { ELITE_MOBS } from "../../src/shared/mobs";
import { ZoneSim, eliteOpts } from "../../src/server/sim/ZoneSim";

test("охота на элиту: фаза по общему DPS — пороги 2000 / 5000 / 10000", () => {
  assert.deepEqual(EVENT.eliteHunt.phaseDps, [2000, 5000, 10000]);
  const cases: [number, number][] = [[0, 1], [1999, 1], [2000, 2], [4999, 2], [5000, 3], [9999, 3], [10000, 4], [1e6, 4]];
  for (const [dps, ph] of cases) assert.equal(huntPhaseFor(dps), ph, `DPS ${dps}`);
});

test("охота на элиту: удары — по доле на каждого бьющего; попадание снимает одно при любом уроне, тик — нет; урон идёт в DPS", () => {
  const sim = new ZoneSim();
  const e = ELITE_MOBS[EVENT.eliteHunt.eliteKey];
  const per = EVENT.eliteHunt.hitsPerHero;
  const id = sim.spawnEventMob(e.kind, 0, 0, { ...eliteOpts(e), boss: true, hp: per });
  const m = sim.mobs.get(id)!;
  m.hitCounter = true;
  m.huntPhase = 1;
  assert.equal(m.hp, per);
  sim.hitMob(id, 5000, 0, 1, "hero-a");
  assert.equal(m.hp, per - 1, "удар в 5000 — минус один удар; первый бьющий — запас не растёт");
  sim.hitMob(id, 3, 0, 1, "hero-b");
  assert.equal(m.maxHp, 2 * per, "второй бьющий — ещё доля ударов");
  assert.equal(m.hp, 2 * per - 2, "удар в 3 — тоже минус один");
  sim.hitMob(id, 700, 0, 1, "hero-a", false, true);
  assert.equal(m.hp, 2 * per - 2, "тик горения ударом не считается");
  sim.hitMob(id, 10, 0, 1, "hero-a");
  assert.equal(m.maxHp, 2 * per, "тот же бьющий — запас не растёт");
  const dps = m.dpsAt(Date.now(), EVENT.eliteHunt.dpsWindow);
  assert.ok(Math.abs(dps - (5000 + 3 + 700 + 10) / EVENT.eliteHunt.dpsWindow) < 1e-6, `DPS ${dps}`);
  assert.equal(huntPhaseFor(dps), 1);
  // Цифры урона над драконом — настоящий урон, а не «1».
  assert.ok(sim.dmgHits.some((h) => h.dmg === 5000));
  // Добиваем: ровно на последнем ударе запаса.
  const left = m.hp;
  for (let k = 0; k < left - 1; k++) sim.hitMob(id, 10, 0, 1, "hero-b");
  assert.equal(m.hp, 1);
  assert.ok(!m.dead);
  sim.hitMob(id, 10, 0, 1, "hero-b");
  assert.ok(m.dead, "последний удар — повержен");
});
