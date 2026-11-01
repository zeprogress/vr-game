import { test } from "node:test";
import assert from "node:assert/strict";
import { ZoneSim } from "../../src/server/sim/ZoneSim";
import { SCARECROW } from "../../src/shared/mobs";

/** Короткий помощник: сдвинуть время симуляции. */
function tick(sim: ZoneSim, sec: number): void {
  (sim as unknown as { elapsed: number }).elapsed += sec;
}

test("пугало: удары/с = текущий темп автоатаки", () => {
  const sim = new ZoneSim();
  const id = (sim as unknown as { scarecrowId: string }).scarecrowId;
  // 8 ударов по 0.5 с (2 в секунду), с уроном
  for (let i = 0; i < 8; i++) {
    sim.scareHit(id, "hero-a");
    sim.hitMob(id, 100, 0, 1, "hero-a");
    tick(sim, 0.5);
  }
  const info = sim.scareInfo(id)!;
  assert.ok(Math.abs(info.aps - 2) < 0.25, `ударов/с ${info.aps.toFixed(2)} вместо 2`);
});

test("пугало: пауза не разбавляет текущий темп", () => {
  const sim = new ZoneSim();
  const id = (sim as unknown as { scarecrowId: string }).scarecrowId;
  // бьём 2/с две секунды, стоим 3 с (меньше idleSec), снова бьём
  for (let i = 0; i < 4; i++) { sim.scareHit(id, "hero-a"); sim.hitMob(id, 100, 0, 1, "hero-a"); tick(sim, 0.5); }
  for (let i = 0; i < 6; i++) tick(sim, 0.5);
  for (let i = 0; i < 4; i++) { sim.scareHit(id, "hero-a"); sim.hitMob(id, 100, 0, 1, "hero-a"); tick(sim, 0.5); }
  const info = sim.scareInfo(id)!;
  assert.ok(info.aps >= 1.6, `после паузы темп должен остаться ~2, получили ${info.aps.toFixed(2)}`);
  assert.equal(SCARECROW.apsWindow, 2, "окно темпа — 2 секунды");
});
