import { test } from "node:test";
import assert from "node:assert/strict";
import { CLASSES2, CLASS_IDS, SKILLS2 } from "../../src/shared/classes2";
import { skillShow, skillShowCoverage } from "../../src/shared/skillShow";

/**
 * Полигон умений не должен молча разойтись с игрой: каждое умение каждого класса
 * обязано иметь визуальный сценарий. Появилось новое умение в CLASSES2 — тест
 * падает, пока для него не описан показ.
 */
test("у каждого умения каждого класса есть визуальный сценарий", () => {
  const cov = skillShowCoverage();
  assert.deepEqual(cov.missing, [], `нет сценария: ${cov.missing.join(", ")}`);
  assert.equal(cov.total, CLASS_IDS.reduce((n, c) => n + CLASSES2[c].skills.length, 0));
  assert.equal(cov.covered, cov.total);
});

test("сценарий каждого умения возвращает события и не врёт про время", () => {
  const mobs = [
    { id: "front", x: 0, y: 0, z: 4, r: 0.6, h: 1.6 },
    { id: "side", x: 3, y: 0, z: 3, r: 0.6, h: 1.6 },
  ];
  for (const cls of CLASS_IDS) {
    for (const id of CLASSES2[cls].skills) {
      const acts = skillShow(id, cls, { x: 0, y: 0, z: 0, targetId: "front", mobs });
      assert.ok(acts, `${cls}/${id}: нет сценария`);
      assert.ok(acts.length > 0, `${cls}/${id}: пустой сценарий`);
      for (const a of acts) {
        assert.ok(Number.isFinite(a.at) && a.at >= 0, `${cls}/${id}: плохое время ${a.at}`);
        assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z), `${cls}/${id}: плохая точка`);
        assert.equal(typeof a.k, "string");
      }
    }
  }
});

test("радиус в сценарии берётся из данных умения, а не из головы", () => {
  const r = SKILLS2.seal.radius;
  const acts = skillShow("seal", "support", { x: 0, y: 0, z: 0, mobs: [] });
  assert.ok(acts);
  const seal = acts.find((a) => a.k === "seal");
  assert.ok(seal);
  assert.equal(seal.r, r);
});
