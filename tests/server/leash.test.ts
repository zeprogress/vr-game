import { test } from "node:test";
import assert from "node:assert/strict";
import { leashCut } from "../../src/server/sim/leash";

const LIM = 22; // круг поводка (центр — 0,0), м
const OUT = { px: LIM + 1, pz: 0 }; // бот за краем круга

test("внутрь круга скорость не меняется", () => {
  const [vx, vz] = leashCut(3, 1, 5, 0, 0, 0, LIM);
  assert.equal(vx, 3);
  assert.equal(vz, 1);
});

test("за краем, но уже летит внутрь: скорость не растёт (раньше — до 26 м/с)", () => {
  const [vx, vz] = leashCut(-20, 0, OUT.px, OUT.pz, 0, 0, LIM);
  assert.ok(Math.hypot(vx, vz) <= 20 + 1e-9, `скорость ${Math.hypot(vx, vz)}`);
  assert.ok(vx <= 0, "остаётся внутрь");
});

test("за краем и тянет наружу: тяга назад внутрь, скорость не выше исходной", () => {
  const [vx] = leashCut(8, 0, OUT.px, OUT.pz, 0, 0, LIM);
  assert.ok(vx < 0, `вектор направлен внутрь, vx=${vx}`);
  assert.ok(Math.abs(vx) <= 8 + 1e-9);
});

test("в замкнутом цикле за краем скорость остаётся в пределах бега", () => {
  let vx = 8;
  let vz = 0;
  let maxV = 0;
  for (let i = 0; i < 300; i++) {
    // разгон к желаемой скорости наружу (7.8 м/с), как на сервере (dt·6 при тике 56 мс)
    vx += (7.8 - vx) * 0.336;
    vz += (0 - vz) * 0.336;
    [vx, vz] = leashCut(vx, vz, OUT.px, OUT.pz, 0, 0, LIM);
    maxV = Math.max(maxV, Math.hypot(vx, vz));
  }
  assert.ok(maxV <= 11, `макс. скорость за краем ${maxV}`);
});
