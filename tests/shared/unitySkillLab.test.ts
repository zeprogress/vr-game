import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CLASSES2, CLASS_IDS } from "../../src/shared/classes2";

/**
 * Unity-полигон читает unity/Assets/Resources/skillLab.json, сгенерированный
 * npm run lab:unity из CLASSES2. Если в игре появилось/убралось умение, а JSON
 * не пересобрали, Unity покажет старый список — тест это ловит.
 */
test("skillLab.json для Unity совпадает с умениями классов в игре", () => {
  const raw = readFileSync(new URL("../../unity/Assets/Resources/skillLab.json", import.meta.url), "utf8");
  const data = JSON.parse(raw) as { classes: { id: string; skills: { id: string }[] }[] };
  assert.equal(data.classes.length, CLASS_IDS.length);
  for (const cls of CLASS_IDS) {
    const row = data.classes.find((c) => c.id === cls);
    assert.ok(row, `нет класса ${cls} — запусти npm run lab:unity`);
    assert.deepEqual(
      row.skills.map((s) => s.id),
      [...CLASSES2[cls].skills],
      `${cls}: список умений в Unity устарел — запусти npm run lab:unity`,
    );
  }
});
