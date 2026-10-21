import { test } from "node:test";
import assert from "node:assert/strict";
import { Mob, eliteOpts, type SimPlayer } from "../../src/server/sim/ZoneSim";
import { ELITE_MOBS } from "../../src/shared/mobs";
import { DRAW_IN } from "../../src/shared/drawIn";
import { terrainHeight } from "../../src/shared/terrain";

const DT = 1 / 30;

test("Стягивание: моб приходит в точку ровно за DRAW_IN.sec", () => {
  const d = ELITE_MOBS.skeletonReaver ?? ELITE_MOBS.iceGiant;
  const m = new Mob(d.kind, 6, 0, eliteOpts(d));
  const hero: SimPlayer = { sessionId: "h", x: 0, y: terrainHeight(0, 0) + 1.6, z: 0 };
  m.pullTo(0, 4, DRAW_IN.sec);
  for (let t = 0; t < DRAW_IN.sec + DT && m.pullT > 0; t += DT) m.tick(DT, [hero], [], () => {});
  assert.equal(m.pullT, 0, "тяга кончилась в срок");
  assert.ok(Math.hypot(m.x - 0, m.z - 4) < 0.05, `пришёл в точку (${m.x.toFixed(2)}, ${m.z.toFixed(2)})`);
});

test("Стягивание: оглушённый моб после прихода стоит в точке", () => {
  const d = ELITE_MOBS.skeletonReaver ?? ELITE_MOBS.iceGiant;
  const m = new Mob(d.kind, 6, 0, eliteOpts(d));
  const hero: SimPlayer = { sessionId: "h", x: 0, y: terrainHeight(0, 0) + 1.6, z: 0 };
  m.pullTo(0, 4, DRAW_IN.sec);
  m.stun(DRAW_IN.sec + DRAW_IN.holdSec);
  for (let t = 0; t < DRAW_IN.sec + DRAW_IN.holdSec * 0.5; t += DT) m.tick(DT, [hero], [], () => {});
  assert.ok(Math.hypot(m.x - 0, m.z - 4) < 0.05, "стоит в кучке, пока оглушён");
});

test("Стягивание: босса не тянет", () => {
  const d = ELITE_MOBS.iceGiant;
  const boss = new Mob("boss", 6, 0, { ...eliteOpts(d), boss: true } as never);
  boss.pullTo(0, 4, DRAW_IN.sec);
  assert.equal(boss.pullT, 0, "босс не получает тягу");
});
