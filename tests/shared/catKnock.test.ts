import { test } from "node:test";
import assert from "node:assert/strict";
import { CAT_RING_KNOCK, CAT_SOULS_KNOCK, CAT_SUPERBOSSES } from "../../src/shared/mobs";

/** Отброс приёмов катакомб: у Костяного Императора ослаблен, у остальных стражей — базовый. */
test("отброс: Костяной Император толкает заметно слабее остальных супербоссов", () => {
  const emperor = CAT_SUPERBOSSES.find((b) => b.key === "boneChief");
  assert.ok(emperor, "в списке супербоссов есть Костяной Император");
  const mul = emperor.knockMul ?? 1;
  assert.ok(mul < 1, `множитель отброса меньше 1 (сейчас ${mul})`);
  // Кольца: 7 м/с → примерно 0.7 м вместо 1.75 м при затухании 4/с.
  const ring = CAT_RING_KNOCK * mul;
  assert.ok(ring > 0 && ring <= 3.2, `кольца толкают не дальше ~0.8 м (сейчас ${ring} м/с)`);
  const souls = CAT_SOULS_KNOCK * mul;
  assert.ok(souls > 0 && souls <= 2.8, `гейзеры душ толкают не дальше ~0.7 м (сейчас ${souls} м/с)`);
});

test("урон: кольца и опасности Императора бьют на 30% слабее", () => {
  const emperor = CAT_SUPERBOSSES.find((b) => b.key === "boneChief")!;
  const mul = emperor.hazardDmgMul ?? 1;
  assert.ok(mul < 1, `множитель урона меньше 1 (сейчас ${mul})`);
  // Потолок опасности 18% макс. HP; после множителя — около 12.6%.
  const capped = 0.18 * mul;
  assert.ok(capped <= 0.135, `удар не больнее ~13% макс. HP (сейчас ${(capped * 100).toFixed(1)}%)`);
});

test("отброс и урон: прочие супербоссы не тронуты", () => {
  for (const b of CAT_SUPERBOSSES) {
    if (b.key === "boneChief") continue;
    assert.equal(b.knockMul ?? 1, 1, `${b.name}: множитель отброса по умолчанию`);
    assert.equal(b.hazardDmgMul ?? 1, 1, `${b.name}: множитель урона по умолчанию`);
  }
});
