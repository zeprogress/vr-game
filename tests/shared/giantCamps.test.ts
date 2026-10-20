import { test } from "node:test";
import assert from "node:assert/strict";
import { DUN_MOB_CAMPS, dunFloorLocal, dunWorld, dunZoneAt } from "../../src/shared/dungeon";
import { ELITE_MOBS, MOB } from "../../src/shared/mobs";

const giants = DUN_MOB_CAMPS.filter((c) => c.type === "iceGiant");

test("ледяные гиганты: четыре стоянки по два — залы K, Q, G, D", () => {
  assert.equal(giants.length, 4);
  for (const c of giants) assert.equal(c.count, 2);
});

test("стоянка гиганта — в центре своего зала (центр зоны совпадает со стоянкой, до 1 м)", () => {
  for (const c of giants) {
    const w = dunWorld(c.u, c.v);
    const zone = dunZoneAt(w.x, w.z);
    const off = Math.hypot(zone.u - c.u, zone.v - c.v);
    assert.ok(off <= 1, `зона ${zone.id}: стоянка (${c.u}, ${c.v}) в ${off.toFixed(1)} м от центра (${zone.u}, ${zone.v})`);
  }
});

test("гиганты стоят у стоянки (кольцо 5 м) — пол под ними с запасом на тело", () => {
  const pad = MOB.bodyRadius * ELITE_MOBS.iceGiant.scaleMul;
  for (const c of giants) {
    const ring = c.spread * (c.ring ?? 1);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const u = c.u + Math.cos(a) * ring;
      const v = c.v + Math.sin(a) * ring;
      assert.notEqual(dunFloorLocal(u, v, pad), null, `стоянка (${c.u}, ${c.v}): точка ${k} на ${ring.toFixed(1)} м — не на полу`);
    }
  }
});
