import { test } from "node:test";
import assert from "node:assert/strict";
import { ZoneSim } from "../../src/server/sim/ZoneSim";
import { PLAGUE } from "../../src/shared/classes2";

function firstMob(): { sim: ZoneSim; id: string } {
  const sim = new ZoneSim();
  return { sim, id: [...sim.mobs.keys()][0] };
}

test("яд аффикса и «Чумной клинок» — разные стаки: один не складывается с другим", () => {
  const { sim, id } = firstMob();
  const m = sim.mobs.get(id)!;
  sim.poisonMob(id, 1, 1, "a", 1, true);
  sim.poisonMob(id, 1, 1, "a", 1, true);
  assert.equal(m.venom.stacks, 2, "яд аффикса копит свои стаки");
  assert.equal(m.plague.stacks, 0, "стаков «Чумного клинка» нет");
  sim.poisonMob(id, 1, 1, "a");
  assert.equal(m.plague.stacks, 1, "клинок копит свои стаки");
  assert.equal(m.venom.stacks, 2, "яд аффикса не растёт от клинка");
});

test("взрыв яда аффикса не трогает стаки «Чумного клинка» и наоборот", () => {
  const { sim, id } = firstMob();
  const m = sim.mobs.get(id)!;
  for (let i = 0; i < PLAGUE.maxStacks - 1; i++) sim.poisonMob(id, 1, 1, "a", 1, true);
  sim.poisonMob(id, 1, 1, "a", 1, true);
  assert.ok(sim.poisonFx.some((f) => f.burst && f.venom), "на максимуме яд аффикса взорвался — взрыв зелёный (venom)");
  assert.ok(m.venom.burstCd > 0, "взрыв ушёл на перезарядку");
  assert.equal(m.plague.stacks, 0, "стаков «Чумного клинка» взрыв яда аффикса не трогает");
  sim.poisonFx.length = 0;
  sim.poisonMob(id, 1, 1, "a");
  assert.ok(sim.poisonFx.every((f) => !f.venom), "стак клинка — фиолетовый");
});
