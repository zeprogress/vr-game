import { test } from "node:test";
import assert from "node:assert/strict";
import { ZoneSim, eliteOpts } from "../../src/server/sim/ZoneSim";
import { ELITE_MOBS } from "../../src/shared/mobs";
import { RING } from "../../src/shared/jewels";

/** Кольца с каждого моба: после смерти от героя награда несёт шанс кольца (jm > 0, ringMul > 0). */
for (const key of Object.keys(ELITE_MOBS)) {
  test(`кольца падают с моба «${key}»`, () => {
    const sim = new ZoneSim();
    sim.mobs.clear();
    const e = ELITE_MOBS[key];
    sim.spawnEventMob(e.kind, 40, 40, eliteOpts(e));
    const m = [...sim.mobs.values()][0];
    assert.ok(m, "моб появился");
    // Голем раскалывается (до смерти): хватает первого раскола — он уже засчитывает награду.
    for (let i = 0; i < 200 && !m.dead && sim.mobKills.length === 0; i++) sim.hitMob(m.id, 1e12, 1, 0, "archer");
    const k = sim.mobKills.find((x) => x.owner === "archer");
    assert.ok(k, "убийство записано в награды");
    assert.ok(k.jm > 0, `множитель шанса колец ${k.jm}`);
    assert.ok(k.jr > 0, `ringMul ${k.jr}`);
    assert.ok(RING.ringChance * k.jm * k.jr > 0, "шанс кольца не нулевой");
  });
}
