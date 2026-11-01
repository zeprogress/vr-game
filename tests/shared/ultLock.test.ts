import { test } from "node:test";
import assert from "node:assert/strict";
import { ULTS, ULT_COOLDOWN } from "../../src/shared/ultimates";
import { SKILLS2, WHIRL } from "../../src/shared/classes2";

/** Ульта и «своё» умение занимают героя: пока идёт замах/вращение, удары и умения не проходят. */
test("ульта: замах есть у всех классов и он длится больше нуля", () => {
  for (const [cls, u] of Object.entries(ULTS)) {
    assert.ok(u.cast > 0, `${cls}: замах ${u.cast} с`);
    assert.ok(u.cast <= 4, `${cls}: замах не дольше 4 с (${u.cast})`);
  }
  assert.ok(ULT_COOLDOWN >= 60, "откат ульты — минуты, а не секунды");
});

test("своё умение: вихрь занимает героя на всё вращение, остальные — на каст", () => {
  assert.ok(WHIRL.duration > 1, `вихрь длится ${WHIRL.duration} с`);
  assert.equal(SKILLS2.whirlwind.castTime, 0, "у вихря нет отдельного каста — он весь в вращении");
  // Пример «своего» умения с кастом: клич.
  assert.ok(SKILLS2.warcry.castTime > 0, "клич кастуется, значит занимает героя");
});
