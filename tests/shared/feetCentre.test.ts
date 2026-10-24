import { test } from "node:test";
import assert from "node:assert/strict";
import { feetCentre, lowFootHalf } from "../../src/shared/feetCentre";
import { close } from "./rng";

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
/** Мировая матрица с переносом в (tx, tz) — как у меша, стоящего в мире. */
const at = (tx: number, tz: number): number[] => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, 0, tz, 1];
/** Тело: две стопы внизу (x около -0.45 и 1.05) и макушка (y = 2). xyz подряд. */
const BODY = [-0.5, 0, 0.2, -0.4, 0, 0.1, 1.0, 0, 0.0, 1.1, 0, -0.1, 0, 2, 0];

test("середина между стопами: посередине между группами нижних вершин", () => {
  const c = feetCentre([{ pos: BODY, world: IDENTITY }], { x: 0, z: 0 });
  assert.ok(c);
  // левая стопа: x -0.45, z 0.15; правая: x 1.05, z -0.05 → середина (0.3, 0.05)
  assert.ok(close(c.x, 0.3), `x ${c.x}`);
  assert.ok(close(c.z, 0.05), `z ${c.z}`);
});

test("корень в мире: результат в координатах корня, а не мира", () => {
  // Меш стоит в (10, 5), корень тоже там: центр должен совпасть с центром у начала координат.
  const c = feetCentre([{ pos: BODY, world: at(10, 5) }], { x: 10, z: 5 });
  assert.ok(c);
  assert.ok(close(c.x, 0.3), `x ${c.x}`);
  assert.ok(close(c.z, 0.05), `z ${c.z}`);
});

test("без вычета корня центр уезжает на его положение в мире (так и было в багу с пропавшей тенью)", () => {
  const c = feetCentre([{ pos: BODY, world: at(10, 5) }], { x: 0, z: 0 });
  assert.ok(c);
  assert.ok(close(c.x, 10.3), `x ${c.x}`);
  assert.ok(close(c.z, 5.05), `z ${c.z}`);
});

test("нет вершин или все на одной высоте — центра нет", () => {
  assert.equal(feetCentre([], { x: 0, z: 0 }), null);
  assert.equal(feetCentre([{ pos: [0, 1, 0, 1, 1, 0], world: IDENTITY }], { x: 0, z: 0 }), null);
});

test("след по стопам: полуоси по нижней полосе, руки и макушка не входят", () => {
  // Стопы: x от -0.5 до 1.1, z от -0.2 до 0.1; плечо на y=1.5 с x=3 — выше полосы, в след не идёт.
  const verts = [...BODY, 3, 1.5, 0];
  const half = lowFootHalf([{ pos: verts, world: IDENTITY }], { x: 0, z: 0 }, 0.6);
  assert.ok(half);
  assert.ok(close(half.hx, 0.8, 1e-9));
  assert.ok(close(half.hz, 0.15, 1e-9));
});
