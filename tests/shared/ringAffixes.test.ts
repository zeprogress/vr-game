import { test } from "node:test";
import assert from "node:assert/strict";
import { RING_COND, RING_STATS, RING_TIERS, emptyRingSkillBonus, ringRollValue, ringSkillMul, type RingTier } from "../../src/shared/ringAffixes";
import { applyJewelOp, jewelsOf, newRing, pcInvJewels, ringSkillBonusOf, type JewelSave } from "../../src/shared/jewels";
import { seeded } from "./rng";

test("кольца: аффиксов и гнёзд по тиру — обычное 1/0, золотое 1–2/1, уникальное 2/1–2, рубиновое 2–3/2", () => {
  const want: Record<RingTier, { a: number[]; g: number[] }> = {
    base: { a: [1], g: [0] },
    gold: { a: [1, 2], g: [1] },
    legendary: { a: [2], g: [1, 2] },
    ruby: { a: [2, 3], g: [2] },
  };
  const rnd = seeded(5);
  for (const tier of RING_TIERS) {
    const list = Array.from({ length: 300 }, (_, i) => newRing(tier, `r${i}`, rnd));
    assert.deepEqual([...new Set(list.map((r) => r.rolls.length))].sort(), want[tier].a, `${tier}: аффиксы`);
    assert.deepEqual([...new Set(list.map((r) => r.gems.length))].sort(), want[tier].g, `${tier}: гнёзда`);
    for (const r of list) {
      const st = r.rolls.map((x) => x.stat);
      assert.equal(new Set(st).size, st.length);
      assert.deepEqual(st, [...st].sort((a, b) => RING_STATS.indexOf(a) - RING_STATS.indexOf(b)));
    }
  }
});

test("старые кольца без аффиксов: раскатываются одинаково при каждой загрузке; гнёзда и камни не теряются", () => {
  const rec = { rings: [{ id: "old1", tier: "legendary", gems: ["str:3", null] }, { id: "old2", tier: "gold", gems: [null] }], ringOn: ["old1", null] };
  const a = jewelsOf(rec);
  const b = jewelsOf(rec);
  assert.deepEqual(a.rings, b.rings, "одинаково");
  assert.equal(a.rings[0].rolls.length, 2);
  assert.deepEqual(a.rings[0].gems, ["str:3", null], "у старого уникального остаются 2 гнезда с камнем");
  assert.ok(a.rings[1].rolls.length >= 1);
});

test("аффиксы двух колец складываются; урон умения растёт по условиям цели и героя", () => {
  const js: JewelSave = {
    rings: [
      { id: "a", tier: "base", gems: [], rolls: [{ stat: "skill", pts: 33 }] },
      { id: "b", tier: "gold", gems: [null], rolls: [{ stat: "skill", pts: 33 }, { stat: "elite", pts: 33 }] },
    ],
    ringOn: ["a", "b"], gems: {}, necks: [], neckOn: null,
  };
  const b = ringSkillBonusOf(js);
  assert.ok(Math.abs(b.skill - (0.06 + 0.06 * 1.2)) < 1e-9);
  const base = { stunned: false, targetHpFrac: 1, elite: false, heroHpFrac: 0.7, dist: 6, others: 0 };
  assert.ok(Math.abs(ringSkillMul(b, base) - (1 + b.skill)) < 1e-9);
  assert.ok(ringSkillMul(b, { ...base, elite: true }) > ringSkillMul(b, base));
  const e = emptyRingSkillBonus();
  e.crowd = 0.02;
  assert.ok(Math.abs(ringSkillMul(e, { ...base, others: 10 }) - (1 + 0.02 * RING_COND.crowdMax)) < 1e-9, "толпа — не больше crowdMax целей");
  e.rage = 0.1;
  e.confident = 0.05;
  assert.ok(Math.abs(ringSkillMul({ ...emptyRingSkillBonus(), rage: 0.1 }, { ...base, heroHpFrac: 0.3 }) - 1.1) < 1e-9);
  assert.ok(Math.abs(ringSkillMul({ ...emptyRingSkillBonus(), confident: 0.05 }, { ...base, heroHpFrac: 0.9 }) - 1.05) < 1e-9);
  assert.equal(ringSkillMul({ ...emptyRingSkillBonus(), close: 0.1, far: 0.1 }, { ...base, dist: 6 }), 1, "между 4 и 8 м — ни вплотную, ни издалека");
  assert.ok(Math.abs(ringRollValue("ruby", { stat: "pen", pts: 33 }) - 0.09 * 1.4) < 1e-9);
});

test("окно инвентаря: кольцо с аффиксами и заточкой; «Разобрать все» не трогает рубиновое", () => {
  const js = jewelsOf({ rings: [{ id: "x", tier: "ruby", gems: [null, null], rolls: [{ stat: "pen", pts: 5 }, { stat: "far", pts: 7 }] }, { id: "y", tier: "base", gems: [], rolls: [{ stat: "skill", pts: 2 }] }], ringOn: [null, null] });
  const v = pcInvJewels(js).rings[0];
  assert.equal(v.ench.length, 2);
  assert.equal(v.pts, 12);
  const r = applyJewelOp(js, { op: "ringScrapAll" }, 0);
  assert.ok(r.ok);
  assert.deepEqual(js.rings.map((x) => x.id), ["x"]);
});
