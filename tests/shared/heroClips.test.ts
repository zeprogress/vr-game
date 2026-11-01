import { test } from "node:test";
import assert from "node:assert/strict";
import { HERO_CLIP_REPS } from "../../src/shared/heroClips";

/** Сколько оборотов сделает модель при заданном множителе скорости, с учётом запечённых повторов. */
function spinsInClip(clip: string, clipSec: number, sec: number, needed: number): number {
  const reps = HERO_CLIP_REPS[clip] ?? 1;
  const rate = (needed * clipSec) / (reps * sec);
  return reps * rate * (sec / clipSec);
}

test("вихрь: клип содержит ОДИН оборот, удары его повторяют", () => {
  assert.equal(HERO_CLIP_REPS.skwhirlwind, 1);
  // Клип 0.7 с = один оборот; 5 ударов за 2 с → ровно 5 оборотов
  const s = spinsInClip("skwhirlwind", 0.7, 2, 5);
  assert.ok(Math.abs(s - 5) < 1e-6, `оборотов ${s}`);
});

test("град выпадов: клип уже содержит 8 выпадов", () => {
  assert.equal(HERO_CLIP_REPS.skflurry, 8);
  const s = spinsInClip("skflurry", 2.1, 1.6, 8);
  assert.ok(Math.abs(s - 8) < 1e-6, `выпадов ${s}`);
});

test("неизвестный клип считается одним движением", () => {
  assert.equal(HERO_CLIP_REPS["skunknown"], undefined);
});
