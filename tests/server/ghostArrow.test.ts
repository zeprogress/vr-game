import { test } from "node:test";
import assert from "node:assert/strict";
import { ZoneSim, eliteOpts, seesGhosts, type PlayerHit, type SimPlayer } from "../../src/server/sim/ZoneSim";
import { ELITE_MOBS } from "../../src/shared/mobs";
import { terrainHeight } from "../../src/shared/terrain";

const DT = 1 / 30;

/** Симуляция с одним мобом рядом с героем (остальные мобы мира убраны). */
function arena(boss: boolean): { sim: ZoneSim; hero: SimPlayer } {
  const sim = new ZoneSim();
  sim.mobs.clear();
  const x = 40;
  const z = 40;
  const e = ELITE_MOBS.skeletonReaver;
  sim.spawnEventMob(e.kind, x + 1.5, z, boss ? { ...eliteOpts(e), boss: true } : eliteOpts(e));
  return { sim, hero: { sessionId: "archer", x, y: terrainHeight(x, z) + 1.6, z } };
}

function hitsOn(sim: ZoneSim, hero: SimPlayer, sec: number, ghost: boolean): PlayerHit[] {
  const out: PlayerHit[] = [];
  for (let t = 0; t < sec; t += DT) out.push(...sim.tick(DT, [{ ...hero, ...(ghost ? { ghost } : {}) }]).filter((h) => h.target === hero.sessionId));
  return out;
}

test("Стрела-призрак: обычный моб призрака не бьёт, без призрака — бьёт", () => {
  const a = arena(false);
  assert.equal(hitsOn(a.sim, a.hero, 6, true).length, 0, "призрак: ни одного удара");
  const b = arena(false);
  assert.ok(hitsOn(b.sim, b.hero, 6, false).length > 0, "обычный герой получает удары");
});

test("Стрела-призрак: босс (бой с боссом) призрака видит и бьёт", () => {
  const a = arena(true);
  const m = [...a.sim.mobs.values()][0];
  assert.ok(seesGhosts(m), "босс события видит призраков");
  assert.ok(hitsOn(a.sim, a.hero, 6, true).length > 0, "босс бьёт призрака");
});
