import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CRAFT,
  CRAFT_METHODS,
  CRAFT_OUTCOMES,
  CRAFT_RECIPES,
  craftCode,
  craftOdds,
  craftCaps,
  craftWeapon,
  matchRecipe,
  parseCraftCode,
  pcInvCraft,
  smithLevel,
  SMITH,
  type CraftInput,
  type CraftStock,
} from "../../src/shared/craft";
import { STAR_CAP, affixCapNote, affixLabel, affixPoints, affixRange, attackPointMul, enchantApply, enchantInfo, heldAffixText, scrapValue, weaponQuality } from "../../src/shared/items";
import { seeded, close } from "./rng";

const RICH: CraftStock = { alloy: 99, web: 99, scale: 99, bone: 99, frost: 1, sting: 1 };
const have = (over: Partial<{ stock: CraftStock; gems: Record<string, number>; scrap: number; book: string[]; smithXp: number }> = {}) => ({
  stock: RICH,
  gems: { "luc:3": 1, "int:1": 1, "str:2": 1 },
  scrap: 100_000,
  book: [] as string[],
  smithXp: 10_000,
  ...over,
});

test("шансы исходов: сумма 100 при любом методе, камне и уровне; скрытый рецепт — без провала и обычного", () => {
  for (const method of Object.keys(CRAFT_METHODS) as (keyof typeof CRAFT_METHODS)[]) {
    for (const cat of [null, "luc:1", "luc:9", "frost"]) {
      for (const lv of [1, 5, SMITH.maxLv]) {
        const o = craftOdds({ method, cat }, lv);
        assert.equal(o.length, CRAFT_OUTCOMES.length);
        assert.ok(close(o.reduce((a, b) => a + b, 0), 100, 1e-9));
        assert.ok(o.every((x) => x >= 0));
        const r = craftOdds({ method, cat }, lv, true);
        assert.equal(r[0], 0);
        assert.equal(r[1], 0);
      }
    }
  }
  // Камень и уровень кузнеца улучшают шансы: провал реже, редкий чаще.
  const plain = craftOdds({ method: "temper", cat: null }, 1);
  const gem = craftOdds({ method: "temper", cat: "luc:5" }, 1);
  const smith = craftOdds({ method: "temper", cat: null }, 20);
  assert.ok(gem[0] < plain[0] && gem[4] > plain[4]);
  assert.ok(smith[0] < plain[0] && smith[4] > plain[4]);
});

test("код крафта: туда и обратно; мусор — null", () => {
  const i: CraftInput = { cls: "bow", mats: ["web", "web", "bone"], cat: "sting", method: "temper" };
  assert.deepEqual(parseCraftCode(craftCode(i)), i);
  assert.deepEqual(parseCraftCode(craftCode({ ...i, cat: "luc:3" })), { ...i, cat: "luc:3" });
  assert.deepEqual(parseCraftCode(craftCode({ ...i, cat: null })), { ...i, cat: null });
  for (const bad of ["", "bow||sting|temper", "shield|web||forge", "bow|web,web,web,web||forge", "bow|frost||forge", "bow|web|zzz|forge", "bow|web||melt", 42]) {
    assert.equal(parseCraftCode(bad), null, String(bad));
  }
});

test("крафт: роллы от материалов, число роллов по исходу, сила и мастерское оружие", () => {
  const rnd = seeded(7);
  const seen = new Set<number>();
  for (let k = 0; k < 400; k++) {
    // Кузнец 1 ур.: на высоком уровне ковка уже не проваливается.
    const r = craftWeapon({ cls: "sword", mats: ["web", "scale"], cat: null, method: "forge" }, have({ smithXp: 0 }), "тест", rnd);
    assert.ok(r.ok);
    if (!r.ok) continue;
    seen.add(r.outcome);
    if (r.outcome === 0) {
      assert.equal(r.weapon, null);
      assert.equal(r.refund, Math.floor(CRAFT_METHODS.forge.cost * CRAFT.failRefund));
      continue;
    }
    const w = r.weapon!;
    assert.equal(w.tier, "craft");
    assert.equal(w.cls, "sword");
    assert.equal(w.by, "тест");
    assert.equal(w.affixes.length, CRAFT_OUTCOMES[r.outcome].rolls);
    // Оба материала дают свой ролл (их ровно столько, сколько мест хватает).
    const subs = w.affixes.map((a) => a.sub);
    assert.ok(subs.includes("atkSpeedPct") && subs.includes("critChance"), subs.join(","));
    assert.equal(new Set(subs).size, subs.length, "роллы не повторяются");
    for (const a of w.affixes) {
      const p = affixPoints(a, w);
      assert.ok(p >= CRAFT_OUTCOMES[r.outcome].floor && p <= 33, `${a.sub} ${p}`);
    }
    assert.ok(close(attackPointMul(w), 1 + CRAFT_OUTCOMES[r.outcome].pow));
    if (CRAFT_OUTCOMES[r.outcome].pow > 0) assert.match(heldAffixText(w), /Мастерство \+\d+(\.\d)?%/);
    // Точится как всё оружие; лом — как у уникального (×1, без рубинового ×100).
    assert.ok(enchantInfo(w, 0));
    assert.equal(scrapValue(w), Math.max(1, weaponQuality(w)));
  }
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3, 4], "все исходы встречаются");
});

test("потолки роллов: копии материала поднимают свой, остальные платят поровну (сумма та же)", () => {
  const near = (a: number[], b: number[]): void => a.forEach((x, k) => assert.ok(close(x, b[k]), `${a} ≠ ${b}`));
  near(craftCaps([3, 0, 0]), [1.3, 0.85, 0.85]);
  near(craftCaps([2, 1, 0]), [1.15, 0.925, 0.925]);
  near(craftCaps([3, 0]), [1.3, 0.7]);
  near(craftCaps([3, 0, 0, 0]), [1.3, 0.9, 0.9, 0.9]);
  near(craftCaps([1, 1, 1]), [1, 1, 1]);
  near(craftCaps([1, 1, 0]), [1, 1, 1]); // особый катализатор и разные материалы — без прибавки
});

test("3 одинаковых материала: ролл ▲ (заточка доводит до нового максимума), остальные ▼; закалка — минимум; резьба — ролл", () => {
  const rnd = seeded(11);
  for (let k = 0; k < 200; k++) {
    const r = craftWeapon({ cls: "dagger", mats: ["web", "web", "web"], cat: null, method: "temper" }, have(), "т", rnd);
    if (!r.ok || !r.weapon) continue;
    const w = r.weapon;
    const n = w.affixes.length;
    const a = w.affixes.find((x) => x.sub === "atkSpeedPct")!;
    assert.ok(close(a.cap ?? 1, 1.3), "свой ролл ×1.30");
    for (const o of w.affixes) if (o !== a) assert.ok(close(o.cap ?? 1, 1 - 0.3 / (n - 1)), `${o.sub} ×${o.cap}`);
    // Очки — только от исхода и метода (копии их больше не поднимают).
    for (const o of w.affixes) assert.ok(affixPoints(o, w) >= Math.min(33, CRAFT_OUTCOMES[r.outcome].floor + CRAFT_METHODS.temper.floorAdd));
    assert.match(affixLabel(a), /▲$/);
  }
  // Заточка до 33 очков — ровно новый потолок (Скорость 5–15% ×1.3 → 19.5%).
  let r = craftWeapon({ cls: "dagger", mats: ["web", "web", "web"], cat: null, method: "temper" }, have(), "т", rnd);
  while (!(r.ok && r.weapon)) r = craftWeapon({ cls: "dagger", mats: ["web", "web", "web"], cat: null, method: "temper" }, have(), "т", rnd);
  const w = r.weapon!;
  const idx = w.affixes.findIndex((x) => x.sub === "atkSpeedPct");
  enchantApply(w, idx, 33);
  assert.equal(affixPoints(w.affixes[idx], w), 33);
  assert.ok(close(w.affixes[idx].value, affixRange("atkSpeedPct", w)[1] * 1.3));
  assert.match(affixCapNote(w.affixes[idx], w), /макс 19\.5% \(▲ \+30%\)/);
  for (let k = 0; k < 200; k++) {
    const r2 = craftWeapon({ cls: "spear", mats: ["bone"], cat: null, method: "carve" }, have(), "т", rnd);
    if (!r2.ok || !r2.weapon) continue;
    assert.equal(r2.weapon.affixes.length, Math.min(CRAFT.maxRolls, CRAFT_OUTCOMES[r2.outcome].rolls + 1));
    assert.ok(r2.weapon.affixes.some((x) => x.sub === "vamp"), "кость на копье — вампиризм");
    assert.ok(r2.weapon.affixes.every((x) => (x.cap ?? 1) === 1), "один материал — потолки обычные");
  }
});

test("скрытый рецепт: ролл-звезда — потолок ×1.5 сразу на максимуме, остальные платят за копии", () => {
  const rnd = seeded(5);
  const crusher = CRAFT_RECIPES.find((x) => x.id === "crusher")!;
  let r = craftWeapon({ cls: crusher.cls, mats: [...crusher.mats], cat: "str:2", method: crusher.method }, have(), "т", rnd);
  while (!(r.ok && r.weapon)) r = craftWeapon({ cls: crusher.cls, mats: [...crusher.mats], cat: "str:2", method: crusher.method }, have(), "т", rnd);
  const w = r.weapon!;
  const star = w.affixes.find((a) => a.sub === crusher.star)!;
  assert.equal(star.cap, STAR_CAP);
  assert.equal(affixPoints(star, w), 33, "сразу на максимуме — точить нечего");
  assert.ok(close(star.value, affixRange(crusher.star, w)[1] * STAR_CAP));
  assert.match(affixLabel(star), /★$/);
  for (const o of w.affixes) if (o !== star) assert.ok((o.cap ?? 1) < 1, `${o.sub}: остальные ▼`);
});

test("кость на луке — пронзание, на посохе — поджог; особый катализатор — свой ролл", () => {
  const rnd = seeded(3);
  const bow = craftWeapon({ cls: "bow", mats: ["bone"], cat: "frost", method: "age" }, have(), "т", rnd);
  for (let k = 0; k < 50 && !(bow.ok && bow.weapon); k++) Object.assign(bow, craftWeapon({ cls: "bow", mats: ["bone"], cat: "frost", method: "age" }, have(), "т", rnd));
  assert.ok(bow.ok && bow.weapon);
  if (bow.ok && bow.weapon) {
    const subs = bow.weapon.affixes.map((a) => a.sub);
    assert.ok(subs.includes("chill"), subs.join(","));
    assert.ok(subs.includes("pierce"), subs.join(","));
  }
  let staff = craftWeapon({ cls: "staff", mats: ["bone"], cat: "sting", method: "forge" }, have(), "т", rnd);
  while (staff.ok && !staff.weapon) staff = craftWeapon({ cls: "staff", mats: ["bone"], cat: "sting", method: "forge" }, have(), "т", rnd);
  assert.ok(staff.ok && staff.weapon);
  if (staff.ok && staff.weapon) {
    const subs = staff.weapon.affixes.map((a) => a.sub);
    assert.ok(subs.includes("venom") && subs.includes("ignite"), subs.join(","));
  }
});

test("отказы: нет материала, катализатора, камня, лома, метод не открыт", () => {
  const i: CraftInput = { cls: "sword", mats: ["web", "web"], cat: null, method: "forge" };
  assert.equal(craftWeapon(i, have({ stock: { web: 1 } }), "т").ok, false);
  assert.equal(craftWeapon({ ...i, cat: "frost" }, have({ stock: { web: 5 } }), "т").ok, false);
  assert.equal(craftWeapon({ ...i, cat: "luc:7" }, have(), "т").ok, false);
  assert.equal(craftWeapon(i, have({ scrap: CRAFT_METHODS.forge.cost - 1 }), "т").ok, false);
  assert.equal(craftWeapon({ ...i, method: "age" }, have({ smithXp: 0 }), "т").ok, false);
  assert.equal(craftWeapon(i, have({ smithXp: 0 }), "т").ok, true);
});

test("скрытые рецепты: точное совпадение, именное оружие, исход не ниже хорошего, ролл сверх предела", () => {
  const rnd = seeded(5);
  for (const rc of CRAFT_RECIPES) {
    const gem = rc.cat?.startsWith("gem:") ? `${rc.cat.slice(4)}:1` : rc.cat;
    const i: CraftInput = { cls: rc.cls, mats: [...rc.mats].reverse(), cat: gem, method: rc.method };
    assert.equal(matchRecipe(i)?.id, rc.id, rc.id);
    // Другой метод — уже не рецепт.
    const other = rc.method === "forge" ? "temper" : "forge";
    assert.equal(matchRecipe({ ...i, method: other })?.id ?? null, null);
    const r = craftWeapon(i, have({ gems: { [gem ?? "x"]: 1 } }), "т", rnd);
    assert.ok(r.ok, rc.id);
    if (!r.ok) continue;
    assert.ok(r.outcome >= 2, `${rc.id}: исход ${r.outcome}`);
    assert.equal(r.found?.id, rc.id);
    assert.equal(r.weapon!.nm, rc.name);
    const star = r.weapon!.affixes.find((a) => a.sub === rc.star)!;
    assert.ok(star, `${rc.id}: нет ролла-звезды ${rc.star}`);
    assert.ok(star.value > affixRange(rc.star, r.weapon!)[1], `${rc.id}: ${star.value}`);
    assert.equal(enchantInfo(r.weapon!, r.weapon!.affixes.indexOf(star))!.max, true, "звезда не точится вниз");
    // Уже в книге — не «найден» повторно.
    const again = craftWeapon(i, have({ gems: { [gem ?? "x"]: 1 }, book: [rc.id] }), "т", rnd);
    assert.ok(again.ok && again.found === null);
  }
});

test("уровень кузнеца: опыт копится, методы открываются по уровням", () => {
  assert.deepEqual(smithLevel(0), { lv: 1, have: 0, need: SMITH.base, maxed: false });
  assert.equal(smithLevel(SMITH.base).lv, 2);
  assert.equal(smithLevel(1e9).maxed, true);
  let xp = 0;
  let total = 0;
  while (!smithLevel(xp).maxed) {
    xp++;
    total++;
  }
  assert.ok(total > 300, `до максимума ${total} опыта — прогрессия долгая`);
  for (const m of Object.values(CRAFT_METHODS)) assert.ok(m.lv >= 1 && m.lv < SMITH.maxLv);
  assert.equal(CRAFT_METHODS.forge.lv, 1, "ковка — с начала");
});

test("данные окна: запас в постоянном порядке, мусор отброшен", () => {
  const v = pcInvCraft({ mats: { sting: 1, web: 3, junk: 5, bone: 0, alloy: "2" }, recipes: ["crusher", "nope"], smithXp: 12.7 });
  assert.deepEqual(v.stock, [["alloy", 2], ["web", 3], ["sting", 1]]);
  assert.deepEqual(v.book, ["crusher"]);
  assert.equal(v.xp, 12);
});
