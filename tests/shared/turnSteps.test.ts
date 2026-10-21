import { test } from "node:test";
import assert from "node:assert/strict";
import { turnClip, turnToward, wrapAngle } from "../../src/client/combat/turnSteps";
import { ELITE_MOBS } from "../../src/shared/mobs";

const RATE = (60 * Math.PI) / 180;

test("Разворот шагами: курс догоняет цель не быстрее скорости и не перелетает", () => {
  let yaw = 0;
  const target = Math.PI / 2; // 90°
  let t = 0;
  while (Math.abs(wrapAngle(target - yaw)) > 1e-9 && t < 5) {
    const r = turnToward(yaw, target, 1 / 30, RATE);
    assert.ok(Math.abs(r.speed) <= RATE + 1e-9, "не быстрее 60°/с");
    yaw = r.yaw;
    t += 1 / 30;
  }
  assert.ok(Math.abs(t - 1.5) < 0.05, `90° за ≈1.5 с (вышло ${t.toFixed(2)})`);
  assert.equal(turnToward(yaw, target, 1 / 30, RATE).speed, 0, "довернул — стоит");
});

test("Разворот шагами: короткий путь через ±π и выбор клипа по направлению", () => {
  const r = turnToward(3.0, -3.0, 1 / 30, RATE); // через π — курс растёт
  assert.ok(r.speed > 0);
  assert.equal(turnClip(r.speed, RATE)?.clip, "turnr");
  assert.equal(turnClip(-RATE, RATE)?.clip, "turnl");
  assert.equal(turnClip(RATE, RATE)?.ratio, 1, "на полной скорости — обычный темп клипа");
  assert.equal(turnClip(0.05, RATE), null, "почти не поворачивается — без клипа разворота");
});

test("Владыка Бездны: разворот шагами и темп шага/бега под скорость", () => {
  const d = ELITE_MOBS.catDragon;
  assert.equal(d.turnRate, 60);
  assert.ok(d.walkClipSpeed && d.runClipSpeed && d.blendAnims);
});
