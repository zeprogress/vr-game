import { test } from "node:test";
import assert from "node:assert/strict";
import { DRAW_IN, drawInPlan, drawModeOf } from "../../src/shared/drawIn";

const mobs = (n: number, r: number) => Array.from({ length: n }, (_, i) => ({ x: Math.cos(i) * r, z: Math.sin(i) * r }));

test("Стягивание: режим по рукам — щит перед собой, один меч по бокам, два меча вокруг", () => {
  assert.equal(drawModeOf("shield", "sword"), 0);
  assert.equal(drawModeOf("sword", "shield"), 0);
  assert.equal(drawModeOf("sword", "sword"), 2);
  assert.equal(drawModeOf("", "sword"), 1);
  assert.equal(drawModeOf("sword", ""), 1);
});

test("Стягивание щитом: все точки в кучке перед воином", () => {
  const plan = drawInPlan(0, 0, 1, 0, 0, mobs(12, 6));
  for (const p of plan) {
    assert.ok(p.z > DRAW_IN.front - 2.5, "перед воином");
    assert.ok(Math.hypot(p.x, p.z - DRAW_IN.front) <= 2.3, "в кучке");
  }
});

test("Стягивание одним мечом: мобы слева уходят влево, справа — вправо", () => {
  // Воин смотрит на +Z; вправо — (fz, −fx) = (1, 0) → +X.
  const left = [{ x: -5, z: 3 }, { x: -4, z: 1 }];
  const right = [{ x: 5, z: 3 }, { x: 4, z: 1 }];
  const pl = drawInPlan(1, 0, 1, 0, 0, left);
  const pr = drawInPlan(1, 0, 1, 0, 0, right);
  for (const p of pl) assert.ok(p.x < -DRAW_IN.side + 2, "левая сторона");
  for (const p of pr) assert.ok(p.x > DRAW_IN.side - 2, "правая сторона");
});

test("Стягивание двумя мечами: кольцо вокруг воина, не дальше радиуса кольца с разбросом", () => {
  const plan = drawInPlan(2, 0, 1, 0, 0, mobs(20, 8));
  for (const p of plan) assert.ok(Math.hypot(p.x, p.z) <= DRAW_IN.ring + DRAW_IN.spacing * 0.3 * 2 + 1e-6);
});

test("Стягивание: радиус 10 м, удержание 1 с", () => {
  assert.equal(DRAW_IN.radius, 10);
  assert.equal(DRAW_IN.holdSec, 1);
});
