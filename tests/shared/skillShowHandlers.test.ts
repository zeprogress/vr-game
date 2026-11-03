import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CLASSES2, CLASS_IDS } from "../../src/shared/classes2";
import { skillShow } from "../../src/shared/skillShow";

const read = (p: string): string => readFileSync(new URL(p, import.meta.url), "utf8");

/** Виды событий, которые умеет рисовать клиент (ClassFx/SteelAct/DrawAct/SkillFx). */
function handledKinds(): Set<string> {
  const out = new Set<string>();
  for (const f of [
    "../../src/client/ui/ClassFx.ts",
    "../../src/client/ui/SteelAct.ts",
    "../../src/client/ui/DrawAct.ts",
    "../../src/client/ui/SkillFx.ts",
    "../../src/client/engine/Game.ts",
    "../../src/client/spectator/Spectator.ts",
  ]) {
    const s = read(f);
    for (const m of s.matchAll(/case\s+"([A-Za-z0-9]+)"/g)) out.add(m[1]);
    for (const set of s.matchAll(/KINDS\s*=\s*new\s+Set<ActKind>\(\[([\s\S]*?)\]\)/g)) {
      for (const m of set[1].matchAll(/"([A-Za-z0-9]+)"/g)) out.add(m[1]);
    }
  }
  return out;
}

/**
 * Лаборатория не должна рисовать событие, которого нет в клиенте, и не должна
 * придумывать событие, которого сервер не шлёт. Это не проверяет порядок и
 * тайминги (их пока держит skillShow), но ловит самый частый рассинхрон:
 * переименовали/убрали акт — лаборатория молча перестала показывать умение.
 */
test("клиент рисует все события skillShow, а сервер шлёт их из общего сценария", () => {
  const handled = handledKinds();
  // События без отдельного case: обрабатываются вручную/служебные.
  const fallback = new Set(["crit", "cast"]);
  const missingHandled: string[] = [];
  for (const cls of CLASS_IDS) {
    for (const id of CLASSES2[cls].skills) {
      const acts = skillShow(id, cls, { x: 0, y: 0, z: 0, mobs: [{ id: "t", x: 0, y: 0, z: 4 }] });
      assert.ok(acts, `${cls}/${id}: нет сценария`);
      for (const a of acts) {
        if (!handled.has(a.k) && !fallback.has(a.k)) missingHandled.push(`${id}→${a.k}`);
      }
    }
  }
  assert.deepEqual([...new Set(missingHandled)], [], `клиент не рисует: ${missingHandled.join(", ")}`);
  // Сервер обязан брать события из того же сценария, а не слать свои копии.
  const zone = read("../../src/server/rooms/ZoneRoom.ts");
  assert.match(zone, /import \{ skillShow, type ShowMob, type ShowStage \}/);
  assert.match(zone, /const show = \(id: SkillId/);
  assert.match(zone, /show\("/);
});
