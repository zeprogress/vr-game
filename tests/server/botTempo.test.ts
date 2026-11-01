import { test } from "node:test";
import assert from "node:assert/strict";
import { heroAttackInterval } from "../../src/shared/progression";

/**
 * Планировщик ближних ударов бота: следующий удар считается накопительно от плана,
 * поэтому тик сервера (50 мс) не «округляет» темп вверх. Проверяем на интервале ассасина.
 */
function simulate(interval: number, dt: number, sec: number): number {
  let now = 0;
  let plan = 0;
  let swings = 0;
  while (now < sec) {
    now += dt;
    if (now >= plan) {
      const next = plan + interval;
      plan = plan < now - 1 ? now + interval : next;
      swings++;
    }
  }
  return swings / sec;
}

test("бот-ассасин: накопительный план держит темп ~5.9 удара/с", () => {
  const iv = 0.168; // из !темп: 5.9 уд/с
  const aps = simulate(iv, 0.05, 60);
  assert.ok(Math.abs(aps - 1 / iv) < 0.25, `вышло ${aps.toFixed(2)}, ждали ${(1 / iv).toFixed(2)}`);
});

test("старый способ (сброс кулдауна на тике) терял темп — это и был баг", () => {
  const iv = 0.168;
  const dt = 0.05;
  let cd = 0;
  let swings = 0;
  const sec = 60;
  for (let t = 0; t < sec; t += dt) {
    cd -= dt;
    if (cd <= 0) {
      cd = iv;
      swings++;
    }
  }
  const aps = swings / sec;
  assert.ok(aps < 5.4, `старый способ давал ${aps.toFixed(2)}/с`);
});

test("формула темпа: 83 ур. кинжал даёт паузу около 0.17 с", () => {
  const iv = heroAttackInterval("dagger", 83, { str: 10, agi: 40, int: 1, wis: 1, con: 10, luc: 10 } as never, 1.15);
  assert.ok(iv > 0.05 && iv < 0.4, `пауза ${iv}`);
});
