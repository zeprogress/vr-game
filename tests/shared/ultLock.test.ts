import { test } from "node:test";
import assert from "node:assert/strict";
import { ULTS, ULT_COOLDOWN } from "../../src/shared/ultimates";
import { SKILLS2, WHIRL, warriorWhirlHits } from "../../src/shared/classes2";

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

test("вихрь воина: ударов всегда 5, ЛОВ и скорость атаки их не множат", () => {
  assert.equal(SKILLS2.whirlwind.hits, 5);
  const attrs = { str: 60, agi: 120, int: 5, wis: 5, con: 20, luc: 40 } as never;
  // Функция оставлена ради описания умения: любой вход — те же 5.
  assert.equal(warriorWhirlHits(attrs, 3), 5);
  assert.equal(warriorWhirlHits(attrs, 1), 5);
});
