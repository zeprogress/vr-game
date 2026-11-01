import { test } from "node:test";
import assert from "node:assert/strict";
import { WHIRL, SKILLS2 } from "../../src/shared/classes2";

/**
 * Пока идёт своё умение, автоатака молчит: герой сначала докатывает скилл.
 * Вихрь занимает всё вращение (WHIRL.duration), остальные умения — время каста.
 */
test("вихрь: занятость героя покрывает всё вращение", () => {
  assert.ok(WHIRL.duration >= 1.5, `вихрь ${WHIRL.duration} с — должен занимать ощутимо`);
  assert.ok(SKILLS2.whirlwind.castTime < WHIRL.duration, "каст короче вращения — иначе окно занятости не покрывало бы вихрь");
});

test("умения с кастом занимают героя хотя бы на время каста", () => {
  for (const [id, sk] of Object.entries(SKILLS2)) {
    if (sk.castTime <= 0) continue;
    assert.ok(sk.castTime > 0, `${id}: каст ${sk.castTime} с`);
  }
});
