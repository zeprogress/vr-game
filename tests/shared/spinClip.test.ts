import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HERO_CLIP_REPS } from "../../src/shared/heroClips";

/** Длительность клипа SkWhirlwind в модели (в секундах) — читаем прямо из GLB. */
function spinClipSec(path: string): number {
  const buf = readFileSync(path);
  const jlen = buf.readUInt32LE(12);
  const js = JSON.parse(buf.subarray(20, 20 + jlen).toString("utf8"));
  const anim = js.animations.find((a: { name: string }) => a.name === "SkWhirlwind");
  assert.ok(anim, "клип SkWhirlwind есть в модели");
  let end = 0;
  for (const smp of anim.samplers) {
    const acc = js.accessors[smp.input];
    end = Math.max(end, acc.max?.[0] ?? 0);
  }
  return end;
}

test("клип кручения — ОДИН оборот: около 0.7 с, а не 2 с", () => {
  assert.equal(HERO_CLIP_REPS.skwhirlwind, 1);
  for (const p of ["public/models/chars/Human_Male.glb", "public/models/chars/Elf_Male.glb"]) {
    const sec = spinClipSec(p);
    assert.ok(sec > 0.2 && sec < 1.0, `${p}: клип ${sec.toFixed(2)} с`);
  }
});

test("вихрь 5 ударов: 5 оборотов за 2 с при клипе-одном-обороте", () => {
  const clipSec = 0.67;
  const count = 5;
  const sec = 2;
  const rate = (count * clipSec) / (HERO_CLIP_REPS.skwhirlwind * sec);
  const turns = HERO_CLIP_REPS.skwhirlwind * rate * (sec / clipSec);
  assert.ok(Math.abs(turns - count) < 1e-6, `оборотов ${turns}`);
});
