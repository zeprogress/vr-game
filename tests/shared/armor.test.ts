import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARMOR_LEVEL_GATE,
  ARMOR_PARTS,
  ARMOR_POINTS_MAX,
  ARMOR_RANGE,
  ARMOR_RUBY,
  ARMOR_SCRAP_RANGE,
  ARMOR_ENCHANT_COST_MUL,
  ARMOR_TIER_MUL,
  ARMOR_WEIGHT_BASE,
  ARMOR_WEIGHTS_BY_TIER,
  armorBaseStats,
  armorBonusOf,
  armorLabel,
  armorName,
  armorEnchantRow,
  armorScrap,
  sanitizeArmorList,
  sortArmorRolls,
  armorLevelMul,
  armorPool,
  armorRollValue,
  armorValue,
  rollArmor,
  type ArmorInstance,
  type ArmorPart,
  type ArmorStat,
  type ArmorTier,
} from "../../src/shared/armor";
import { seeded, close } from "./rng";

const STATS: readonly ArmorStat[] = ["hp", "physDef", "magDef", "regen", "dodge"];

/** Броня `n` штук одной части и тира, для проверки сумм. */
function many(part: ArmorPart, tier: ArmorTier, n: number, seed: number): ArmorInstance[] {
  const rnd = seeded(seed);
  return Array.from({ length: n }, (_, i) => rollArmor(part, `${part}${i}`, rnd, tier));
}

test("значение аффикса растёт с очками и укладывается в диапазон стата", () => {
  for (const s of STATS) {
    const [lo, hi] = ARMOR_RANGE[s];
    assert.ok(close(armorValue(s, 1), lo), `${s}: 1 очко — нижняя граница`);
    assert.ok(close(armorValue(s, ARMOR_POINTS_MAX), hi), `${s}: максимум очков — верхняя граница`);
    for (let p = 2; p <= ARMOR_POINTS_MAX; p++) assert.ok(armorValue(s, p) > armorValue(s, p - 1), `${s} на ${p} очке`);
  }
});

test("обычная часть — один аффикс; уникальный шлем тоже один (два и три — только нагрудник и поножи)", () => {
  for (const part of ARMOR_PARTS) {
    for (const a of many(part, "base", 30, 1)) assert.equal(a.rolls.length, 1, `${part} обычный`);
  }
  for (const a of many("helm", "legendary", 30, 2)) assert.equal(a.rolls.length, 1, "шлем уникальный");
});

test("золотый нагрудник — 1 или 2 аффикса, уникальный нагрудник — 2 или 3", () => {
  const gold = many("chest", "gold", 300, 3).map((a) => a.rolls.length);
  assert.ok(gold.every((n) => n === 1 || n === 2));
  assert.ok(gold.includes(2));
  const lg = many("chest", "legendary", 300, 4).map((a) => a.rolls.length);
  assert.ok(lg.every((n) => n === 2 || n === 3));
  assert.ok(lg.includes(3));
});

test("аффиксы одной части не повторяют стат и берутся из пула её тира", () => {
  for (const tier of ["base", "gold", "legendary", "ruby"] as const) {
    for (const part of ARMOR_PARTS) {
      for (const a of many(part, tier, 60, 5)) {
        const stats = a.rolls.map((r) => r.stat);
        assert.equal(new Set(stats).size, stats.length, `${part}/${tier}: повтор стата`);
        for (const r of a.rolls) assert.ok(armorPool(part, tier).includes(r.stat), `${part}/${tier}: ${r.stat} не из пула`);
      }
    }
  }
});

test("тир усиливает значение: золотой ×1.2, уникальный ×1.35 к обычному", () => {
  const r = { stat: "physDef" as const, pts: 10 };
  const base = armorRollValue({ tier: "base" }, r);
  assert.ok(close(armorRollValue({ tier: "gold" }, r), base * ARMOR_TIER_MUL.gold));
  assert.ok(close(armorRollValue({ tier: "legendary" }, r), base * ARMOR_TIER_MUL.legendary));
});

test("сумма бонусов брони — сумма значений всех её аффиксов", () => {
  assert.deepEqual(armorBonusOf([]), { hp: 0, physDef: 0, magDef: 0, regen: 0, dodge: 0, move: 0, atk: 0 });
  const worn = [...many("helm", "base", 2, 6), ...many("chest", "gold", 2, 7)];
  const bonus = armorBonusOf(worn);
  const empty = { hp: 0, physDef: 0, magDef: 0, regen: 0, dodge: 0, move: 0, atk: 0 } as Record<string, number>;
  for (const a of worn) {
    const base = armorBaseStats(a);
    for (const k of Object.keys(base) as (keyof typeof base)[]) empty[k] += base[k];
    for (const r of a.rolls) empty[r.stat] += armorRollValue(a, r);
  }
  for (const [k, v] of Object.entries(empty)) assert.ok(close(bonus[k as keyof typeof bonus], v), k);
});

test("множитель шанса по уровню моба: 0 на 1-м, 1 с 53-го, линейно между", () => {
  const gate = ARMOR_LEVEL_GATE.gold;
  assert.equal(armorLevelMul(1, gate), 0);
  assert.equal(armorLevelMul(0, gate), 0);
  assert.equal(armorLevelMul(27, gate), 0.5);
  assert.equal(armorLevelMul(53, gate), 1);
  assert.equal(armorLevelMul(100, gate), 1);
});

test("рубиновая броня: нагрудник 3–4 аффикса, поножи 2–3, шлем, перчатки и сапоги 1–2 — из всех статов брони", () => {
  const want: Record<ArmorPart, readonly [number, number]> = { helm: [1, 2], chest: [3, 4], gloves: [1, 2], legs: [2, 3], boots: [1, 2] };
  for (const part of ARMOR_PARTS) {
    assert.deepEqual([...armorPool(part, "ruby")].sort(), [...STATS].sort(), `${part}: пул — все статы`);
    const seen = new Set<ArmorStat>();
    const counts = new Set<number>();
    for (const a of many(part, "ruby", 200, 11)) {
      counts.add(a.rolls.length);
      for (const r of a.rolls) seen.add(r.stat);
    }
    assert.deepEqual([...counts].sort(), [...want[part]], `${part}: число аффиксов`);
    assert.equal(seen.size, STATS.length, `${part}: выпадают все статы`);
  }
});

test("рубиновая броня сильнее уникальной, лом ×100 и заточка ×8 к уникальной; шанс — вдвое выше рубинового оружия", () => {
  assert.ok(ARMOR_TIER_MUL.ruby > ARMOR_TIER_MUL.legendary);
  assert.deepEqual(ARMOR_SCRAP_RANGE.ruby, ARMOR_SCRAP_RANGE.legendary.map((x) => x * 100));
  assert.equal(ARMOR_ENCHANT_COST_MUL.ruby, ARMOR_ENCHANT_COST_MUL.legendary * 8);
  assert.equal(ARMOR_RUBY.dropChance, 0.2);
  const lg: ArmorInstance = { id: "l", part: "chest", tier: "legendary", weight: "medium", lvl: 1, rolls: [{ stat: "hp", pts: 10 }, { stat: "physDef", pts: 20 }] };
  const rb: ArmorInstance = { ...lg, id: "r", tier: "ruby" };
  // Округление по каждому аффиксу — до ±1 на аффикс.
  assert.ok(Math.abs(armorScrap(rb) - armorScrap(lg) * 100) <= 50 * rb.rolls.length, `лом ${armorScrap(rb)} против ${armorScrap(lg)}`);
  const cl = armorEnchantRow(lg, 0)!.cost;
  const cr = armorEnchantRow(rb, 0)!.cost;
  assert.ok(Math.abs(cr - cl * 8) <= 4, `заточка ${cr} против ${cl}`);
});

test("сохранение: рубиновая часть с 4 аффиксами (и уворотом в нагруднике) читается без потерь", () => {
  const a = rollArmor("chest", "x", seeded(12), "ruby");
  const back = sanitizeArmorList(JSON.parse(JSON.stringify([a, { id: "y", part: "boots", tier: "ruby", rolls: [{ stat: "magDef", pts: 7 }, { stat: "dodge", pts: 3 }] }])));
  assert.equal(back.length, 2);
  assert.deepEqual(back[0], a);
  assert.equal(back[1].tier, "ruby");
  assert.equal(back[1].rolls.length, 2);
});

test("веса по грейдам: обычная — средняя, золотая — лёгкая/тяжёлая, уникальная и рубиновая — все три", () => {
  assert.deepEqual(ARMOR_WEIGHTS_BY_TIER.base, ["medium"]);
  assert.deepEqual(ARMOR_WEIGHTS_BY_TIER.gold, ["light", "heavy"]);
  assert.deepEqual(ARMOR_WEIGHTS_BY_TIER.legendary, ["light", "medium", "heavy"]);
  assert.deepEqual(ARMOR_WEIGHTS_BY_TIER.ruby, ["light", "medium", "heavy"]);
});

test("вес даёт характер: тяжёлая — физ. танк, лёгкая — антимагия, средняя — скорость атаки", () => {
  const mk = (weight: "light" | "medium" | "heavy") => rollArmor("chest", weight, seeded(1), "ruby", weight, 30);
  const l = armorBaseStats(mk("light"));
  const m = armorBaseStats(mk("medium"));
  const h = armorBaseStats(mk("heavy"));
  assert.ok(h.physDef > m.physDef && m.physDef > l.physDef, "физ. броня: тяжёлая > средняя > лёгкая");
  assert.ok(l.magDef > m.magDef, "лёгкая — лучшая маг. защита");
  assert.ok(h.magDef === m.magDef, "у тяжёлой маг. защита как у средней");
  assert.ok(h.hp > m.hp && m.hp > l.hp, "HP: тяжёлая > средняя > лёгкая");
  assert.ok(l.move > 0 && h.move < 0 && m.move === 0, "бег: лёгкая быстрее, тяжёлая медленнее");
  assert.ok(m.atk > 0 && h.atk < 0 && l.atk === 0, "атака: средняя быстрее, тяжёлая медленнее");
  assert.ok(l.dodge > 0 && h.dodge < 0, "уворот: лёгкая плюс, тяжёлая минус");
  assert.ok(ARMOR_WEIGHT_BASE.heavy.resist === ARMOR_WEIGHT_BASE.medium.resist);
});

test("полный сет: тяжёлая маг. защита как средняя, но уворот ниже; скорости суммируются", () => {
  const full = (weight: "light" | "medium" | "heavy") =>
    ARMOR_PARTS.map((part, i) => rollArmor(part, `${weight}${i}`, seeded(i + 1), "ruby", weight, 75));
  const l = armorBonusOf(full("light"));
  const m = armorBonusOf(full("medium"));
  const h = armorBonusOf(full("heavy"));
  assert.ok(close(l.move, 0.1), `лёгкая бег ${l.move}`);
  assert.ok(close(m.atk, 0.075), `средняя атака ${m.atk}`);
  assert.ok(close(h.move, -0.1) && close(h.atk, -0.1), "тяжёлая медленная");
  assert.ok(h.physDef > m.physDef && m.physDef > l.physDef);
  assert.ok(close(h.magDef, m.magDef), `маг. защита тяжёлой ${h.magDef}, средней ${m.magDef}`);
  assert.ok(l.magDef > h.magDef, "лёгкая — лучшая антимагия");
  assert.ok(l.dodge > 0 && h.dodge < 0, "уворот: лёгкая плюс, тяжёлая минус");
});

test("имя брони короткое, вес — только в описании", () => {
  const a = rollArmor("chest", "name-test", seeded(2), "ruby", "heavy", 10);
  const name = armorName(a);
  assert.ok(!/лёгк|средн|тяжёл/i.test(name), `вес попал в имя: ${name}`);
  assert.match(armorLabel(a), /Вес: тяжёлая/);
  assert.match(name, /латная кираса/i);
});

test("аффиксы брони всегда в одном порядке (здоровье, физ., маг., регенерация, уворот) — и у новых, и у сохранённых", () => {
  const order = ["hp", "physDef", "magDef", "regen", "dodge"];
  const sorted = (a: ArmorInstance): boolean => a.rolls.every((r, i) => i === 0 || order.indexOf(a.rolls[i - 1].stat) < order.indexOf(r.stat));
  for (const tier of ["gold", "legendary", "ruby"] as const) {
    for (const part of ARMOR_PARTS) for (const a of many(part, tier, 60, 21)) assert.ok(sorted(a), `${part}/${tier}`);
  }
  const old = sanitizeArmorList([{ id: "o", part: "chest", tier: "ruby", rolls: [{ stat: "dodge", pts: 5, ench: { p: 1, s: 2, f: 3 } }, { stat: "hp", pts: 9 }] }]);
  assert.deepEqual(old[0].rolls.map((r) => r.stat), ["hp", "dodge"]);
  assert.deepEqual(old[0].rolls[1].ench, { p: 1, s: 2, f: 3 }, "колода заточки — у своего аффикса");
  const list = [{ stat: "regen" as const, pts: 1 }, { stat: "physDef" as const, pts: 2 }];
  sortArmorRolls(list);
  assert.deepEqual(list.map((r) => r.stat), ["physDef", "regen"]);
});
