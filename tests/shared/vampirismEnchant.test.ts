import { test } from "node:test";
import assert from "node:assert/strict";
import { affixAtPoints, affixLabel, enchantApply, enchantInfo } from "../../src/shared/items";

/**
 * Заточка вампиризма должна двигать значение: у ролла свой диапазон для каждого оружия,
 * и очки считаются по нему (иначе значение всегда «1 очко» и заточка ничего не меняла).
 */
for (const cls of ["sword", "dagger", "spear", "hammer"] as const) {
  test(`вампиризм на ${cls} точится`, () => {
    const start = affixAtPoints("vamp", 10, 1, cls);
    const w = { id: "t", cls, tier: "gold" as const, lv: 14, affixes: [start] };
    const before = enchantInfo(w, 0);
    assert.ok(before && !before.max, "ролл не на максимуме");
    assert.equal(before.points, 10);
    const val0 = w.affixes[0].value;
    enchantApply(w, 0, 5);
    assert.equal(enchantInfo(w, 0)!.points, 15);
    assert.ok(w.affixes[0].value > val0, `${affixLabel(w.affixes[0])} должно вырасти`);
  });
}
