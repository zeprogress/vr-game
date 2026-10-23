import { test } from "node:test";
import assert from "node:assert/strict";
import { NECK, NECK_STATS, NECK_TIERS, neckBonusOf, neckEnchantRow, neckRollValue, neckScrap, rollNecklace, type NeckInst, type NeckTier } from "../../src/shared/necklaces";
import { applyJewelOp, jewelBonus, jewelPatch, jewelsOf, pcInvJewels, pcJewelBonus, rollJewelDrop, type JewelSave } from "../../src/shared/jewels";
import { parseTradeItem, takeItems, giveItems, type InvSnap } from "../../src/server/trade";
import { seeded } from "./rng";

function many(tier: NeckTier, n: number, seed: number): NeckInst[] {
  const rnd = seeded(seed);
  return Array.from({ length: n }, (_, i) => rollNecklace(tier, `n${i}`, rnd));
}

test("ожерелья: число аффиксов и гнёзд по тиру — как решено (обычное 1/0, золотое 1–2/0–1, уникальное 2/1, рубиновое 2–3/1–2)", () => {
  const want: Record<NeckTier, { a: number[]; g: number[] }> = {
    base: { a: [1], g: [0] },
    gold: { a: [1, 2], g: [0, 1] },
    legendary: { a: [2], g: [1] },
    ruby: { a: [2, 3], g: [1, 2] },
  };
  for (const tier of NECK_TIERS) {
    const list = many(tier, 300, 3);
    assert.deepEqual([...new Set(list.map((x) => x.rolls.length))].sort(), want[tier].a, `${tier}: аффиксы`);
    assert.deepEqual([...new Set(list.map((x) => x.gems.length))].sort(), want[tier].g, `${tier}: гнёзда`);
    for (const x of list) {
      const st = x.rolls.map((r) => r.stat);
      assert.equal(new Set(st).size, st.length, "без повторов");
      assert.deepEqual(st, [...st].sort((a, b) => NECK_STATS.indexOf(a) - NECK_STATS.indexOf(b)), "порядок постоянный");
      assert.ok(x.gems.every((g) => g === null), "гнёзда пустые");
    }
  }
});

test("ожерелья: значения — обычный тир 3–9% радиус и дальность, 5–15% длительность; тир множит как у брони", () => {
  assert.ok(Math.abs(neckRollValue("base", { stat: "radius", pts: 1 }) - 0.03) < 1e-9);
  assert.ok(Math.abs(neckRollValue("base", { stat: "duration", pts: 33 }) - 0.15) < 1e-9);
  assert.ok(Math.abs(neckRollValue("ruby", { stat: "range", pts: 33 }) - 0.09 * 1.4) < 1e-9);
  const n: NeckInst = { id: "x", tier: "gold", rolls: [{ stat: "radius", pts: 33 }, { stat: "range", pts: 1 }], gems: [] };
  const b = neckBonusOf(n);
  assert.ok(Math.abs(b.radius - 0.09 * 1.2) < 1e-9 && Math.abs(b.range - 0.03 * 1.2) < 1e-9 && b.duration === 0);
});

test("ожерелья: лом и цена заточки растут по тиру (рубиновое — дороже всех)", () => {
  const roll = [{ stat: "radius" as const, pts: 20 }];
  const sc = NECK_TIERS.map((tier) => neckScrap({ tier, rolls: roll }));
  for (let i = 1; i < sc.length; i++) assert.ok(sc[i] > sc[i - 1], `лом ${sc.join(" < ")}`);
  const cost = NECK_TIERS.map((tier) => neckEnchantRow({ id: "x", tier, rolls: [{ ...roll[0] }], gems: [] }, 0)!.cost);
  for (let i = 1; i < cost.length; i++) assert.ok(cost[i] > cost[i - 1], `заточка ${cost.join(" < ")}`);
  assert.equal(NECK.enchantCostMul.ruby, 8);
});

test("ожерелья в записи героя: сохранение, надеть/снять, камень в гнездо даёт атрибут, прибавки умений — в бонусе", () => {
  const n: NeckInst = { id: "nk", tier: "legendary", rolls: [{ stat: "radius", pts: 10 }, { stat: "duration", pts: 20 }], gems: [null] };
  const js = jewelsOf({ necks: [n, { bad: 1 }], neckOn: "nope", gems: { "str:2": 1 } });
  assert.equal(js.necks.length, 1, "битая запись отброшена");
  assert.equal(js.neckOn, null, "надето только существующее");
  assert.ok(applyJewelOp(js, { op: "neckOn", id: "nk" }, 0).ok);
  assert.ok(applyJewelOp(js, { op: "gemIn", id: "nk", idx: 0, gem: "str:2" }, 0).ok);
  const b = jewelBonus(js);
  assert.equal(b.str, 2, "камень ожерелья — атрибут");
  assert.ok(b.skRad > 0 && b.skDur > 0 && b.skRng === 0);
  assert.equal(b.rings, 0, "маг. защиту даёт только кольцо");
  // Клиент считает то же по данным окна.
  const pb = pcJewelBonus(pcInvJewels(js));
  assert.ok(Math.abs(pb.skRad - b.skRad) < 1e-9 && pb.str === 2);
  // Надетое не разбирается; снятое — в лом, камни возвращаются.
  assert.equal(applyJewelOp(js, { op: "neckScrap", id: "nk" }, 0).ok, false);
  applyJewelOp(js, { op: "neckOff" }, 0);
  const r = applyJewelOp(js, { op: "neckScrap", id: "nk" }, 0);
  assert.ok(r.ok && (r.scrap ?? 0) > 0);
  assert.equal(js.gems["str:2"], 1, "камень вернулся");
  assert.deepEqual(Object.keys(jewelPatch(js)).sort(), ["gems", "neckOn", "necks", "ringOn", "rings"]);
});

test("«Разобрать все украшения»: ожерелья тоже, кроме надетого, ★ и рубинового", () => {
  const mk = (id: string, tier: NeckTier, fav = false): NeckInst => ({ id, tier, rolls: [{ stat: "range", pts: 5 }], gems: [], ...(fav ? { fav: true } : {}) });
  const js: JewelSave = { rings: [], ringOn: [null, null], gems: {}, necks: [mk("a", "base"), mk("b", "gold", true), mk("c", "ruby"), mk("d", "legendary")], neckOn: "d" };
  const r = applyJewelOp(js, { op: "ringScrapAll" }, 0);
  assert.ok(r.ok);
  assert.deepEqual(js.necks.map((x) => x.id).sort(), ["b", "c", "d"]);
});

test("выпадение: ожерелье — свой бросок с шансами кольца; рубинового с мобов нет", () => {
  const rnd = seeded(7);
  let got = 0;
  const tiers = new Set<string>();
  for (let i = 0; i < 20000; i++) {
    const d = rollJewelDrop(400, 1, 70, rnd);
    if (d.neck) {
      got++;
      tiers.add(d.neck);
    }
  }
  assert.ok(got > 0);
  assert.ok(!tiers.has("ruby"));
});

test("обмен и подарок: код «n:<id>», надетое не отдаётся, ★ снимается при передаче", () => {
  assert.deepEqual(parseTradeItem("n:abc", 1), { k: "neck", id: "abc" });
  const n: NeckInst = { id: "nk", tier: "gold", rolls: [{ stat: "radius", pts: 5 }], gems: [null], fav: true };
  const snap = (necks: NeckInst[], neckOn: string | null): InvSnap => ({
    weapons: [], heldIds: new Set(), bag: [], armor: [], armorWorn: {}, mats: {},
    jewels: { rings: [], ringOn: [null, null], gems: {}, necks, neckOn },
  });
  const worn = snap([{ ...n }], "nk");
  assert.ok("error" in takeItems(worn, [{ k: "neck", id: "nk" }]));
  const from = snap([{ ...n }], null);
  const to = snap([], null);
  const t = takeItems(from, [{ k: "neck", id: "nk" }]);
  assert.ok("taken" in t);
  if ("taken" in t) giveItems(to, t.taken);
  assert.equal(from.jewels.necks.length, 0);
  assert.equal(to.jewels.necks.length, 1);
  assert.equal(to.jewels.necks[0].fav, undefined, "★ не передаётся");
});
