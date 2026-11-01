import { test } from "node:test";
import assert from "node:assert/strict";
import { affixAtPoints, affixLabel, LOOT_VER, migrateLoot, type WeaponInstance, type WeaponClass } from "../../src/shared/items";

/** Пределы вампиризма по оружию (src/shared/items.ts VAMP_RANGES) — доля макс. HP за удар. */
const MAX: Record<string, number> = { sword: 0.004, dagger: 0.0032, spear: 0.0036, hammer: 0.005 };

test("крафт: вампиризм роллится в диапазоне СВОЕГО оружия, а не 2–10%", () => {
  for (const [cls, hi] of Object.entries(MAX)) {
    const a = affixAtPoints("vamp", 33, 1, cls as WeaponClass);
    assert.ok(a.value <= hi + 1e-9, `${cls}: максимум ${a.value} должен быть ≤ ${hi}`);
    const lo = affixAtPoints("vamp", 1, 1, cls as WeaponClass);
    assert.ok(lo.value > 0, `${cls}: минимум больше нуля`);
    assert.ok(lo.value < a.value, `${cls}: минимум меньше максимума`);
  }
});

test("крафт: подпись вампиризма — «% макс. HP за удар», а не проценты урона", () => {
  const a = affixAtPoints("vamp", 33, 1, "hammer");
  const label = affixLabel(a);
  assert.match(label, /макс\. HP за удар/);
  assert.match(label, /\+0\.5%/, `максимум молота — 0.5% (сейчас «${label}»)`);
});

test("миграция: оружие, скрафченное со старым вампиризмом, пересчитывается по качеству", () => {
  // 5% «урона» из старого диапазона 2–10% — это 37.5% качества → ~0.2% макс. HP у меча.
  const w = {
    id: "old", cls: "sword", tier: "craft", lv: 14,
    affixes: [{ kind: "vamp", sub: "vamp", value: 0.05 }],
  } as unknown as WeaponInstance;
  migrateLoot(w);
  assert.equal(w.lv, LOOT_VER);
  const v = w.affixes[0].value;
  assert.ok(v > 0 && v <= MAX.sword + 1e-9, `после миграции ${v} в пределах меча (≤ ${MAX.sword})`);
  assert.ok(v > 0.0012, `качество сохранено: не самый низ (${v})`);
});

test("миграция: уже правильный вампиризм не трогается", () => {
  const w = {
    id: "new", cls: "hammer", tier: "craft", lv: 14,
    affixes: [{ kind: "vamp", sub: "vamp", value: 0.0037 }],
  } as unknown as WeaponInstance;
  migrateLoot(w);
  assert.equal(w.affixes[0].value, 0.0037);
});
