import { test } from "node:test";
import assert from "node:assert/strict";
import { ZoneSim, eliteOpts } from "../../src/server/sim/ZoneSim";
import { ELITE_MOBS } from "../../src/shared/mobs";
import { RING } from "../../src/shared/jewels";

/** Шанс кольца за одно убийство героем (2026-10-21): элитные 0.25%, жнец 0.15%, ледяной гигант 10%. */
const SPECIAL_CHANCE: Record<string, number> = { skeletonReaver: 0.0015, iceGiant: 0.1 };
const expectedChance = (key: string): number => SPECIAL_CHANCE[key] ?? 0.0025;

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
    const chance = RING.ringChance * k.jm * k.jr;
    assert.ok(Math.abs(chance - expectedChance(key)) < 1e-9, `шанс кольца ${chance}, ждали ${expectedChance(key)}`);
  });
}
