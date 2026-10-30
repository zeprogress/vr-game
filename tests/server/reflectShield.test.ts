import { test } from "node:test";
import assert from "node:assert/strict";
import { ZoneSim, eliteOpts } from "../../src/server/sim/ZoneSim";
import { ELITE_MOBS, REFLECT, reflectCapped } from "../../src/shared/mobs";

/** Щит отражения у моба и у босса: атакующему уходит REFLECT.frac снятого урона. */
for (const boss of [false, true]) {
  test(`Щит отражения (${boss ? "босс" : "моб"}): атакующему — ${Math.round(REFLECT.frac * 100)}% снятого урона`, () => {
    const sim = new ZoneSim();
    sim.mobs.clear();
    const e = ELITE_MOBS.frostDemon;
    sim.spawnEventMob(e.kind, 40, 40, boss ? { ...eliteOpts(e), boss: true } : eliteOpts(e));
    const m = [...sim.mobs.values()][0];
    m.reflectT = REFLECT.duration;
    const hp0 = m.hp;
    sim.hitMob(m.id, 200, 1, 0, "archer", true);
    const dealt = hp0 - m.hp;
    assert.ok(dealt > 0, "удар снял здоровье");
    // reflectHits приватный (отдаётся через tick) — в тесте читаем напрямую.
    const hits = (sim as unknown as { reflectHits: { dmg: number }[] }).reflectHits;
    const back = hits[hits.length - 1]?.dmg ?? 0;
    assert.ok(Math.abs(back - dealt * REFLECT.frac) < 1e-6, `отражено ${back.toFixed(3)} из ${dealt.toFixed(3)}`);
  });
}

test("Отражение: потолок по макс. HP атакующего — не убивает с одного удара", () => {
  const maxHp = 30000;
  // Огромный удар героя: 15% вернулись бы 30 000 (весь пул) — потолок режет до 10% HP.
  assert.equal(reflectCapped(200_000 * REFLECT.frac, maxHp), maxHp * REFLECT.maxHpFrac);
  // Мелкий удар потолком не задевается.
  const small = 500 * REFLECT.frac;
  assert.equal(reflectCapped(small, maxHp), small);
  // Нет данных о HP — не режем.
  assert.equal(reflectCapped(1234, 0), 1234);
});
