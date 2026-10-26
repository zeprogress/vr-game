import { test } from "node:test";
import assert from "node:assert/strict";
import { wallSlide } from "../../src/server/sim/wallSlide";

/** Стена x ≥ 1: прямая проходима, если обе точки в x < 1. */
const clear = (_x0: number, _z0: number, x1: number, z1: number): boolean => x1 < 1 && z1 < 100;

test("свободный шаг проходит как есть", () => {
  const r = wallSlide(0, 0, 0.5, 0.5, clear);
  assert.deepEqual([r.x, r.z, r.blockX, r.blockZ], [0.5, 0.5, false, false]);
});

test("шаг в стену по диагонали: скользит вдоль стены (x срезан, z идёт)", () => {
  const r = wallSlide(0.5, 0, 1.5, 0.4, clear);
  assert.equal(r.x, 0.5);
  assert.equal(r.z, 0.4);
  assert.equal(r.blockX, true);
  assert.equal(r.blockZ, false);
});

test("упёрся всеми осями — стоит на месте и гасится обе оси", () => {
  const wall = (_a: number, _b: number, x1: number, z1: number): boolean => x1 === 0 && z1 === 0;
  const r = wallSlide(0, 0, -1, -1, wall);
  assert.deepEqual([r.x, r.z, r.blockX, r.blockZ], [0, 0, true, true]);
});
