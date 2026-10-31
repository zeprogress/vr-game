import { test } from "node:test";
import assert from "node:assert/strict";
import { skillDamageText } from "../../src/shared/skillDamage";
import { skillDesc } from "../../src/shared/classes2";
import { skillModsFor, treeSkillState } from "../../src/shared/passiveTree";
import type { SkillAttrs } from "../../src/shared/classes2";
import type { ClassId } from "../../src/shared/classes2";

/**
 * Улучшения умений из дерева прокачки обязаны менять числа в окне умений: иначе игрок
 * качает узел и не видит разницы (жалоба 2026-10-31).
 */
const a = { str: 60, agi: 40, int: 40, con: 30, luc: 20, wis: 20, gb: {} } as unknown as SkillAttrs;
const modsOf = (cls: ClassId, skill: string, taken: number[]) =>
  skillModsFor(treeSkillState(cls, taken).skills, skill);

test("★ узел «+1 удар» увеличивает число ударов в описании урона", () => {
  const plain = skillDamageText("whirlwind", "battlemage", 1000, a, undefined, {});
  const withNode = skillDamageText("whirlwind", "battlemage", 1000, a, undefined, modsOf("battlemage", "whirlwind", [0, 12]));
  assert.ok(plain && withNode);
  const hits = (s: string): number => Number(s.match(/× (\d+)/)?.[1]);
  assert.equal(hits(withNode) - hits(plain), 1, `было ${plain}, стало ${withNode}`);
});

test("★ узел «+урон умения» увеличивает урон в описании", () => {
  const plain = skillDamageText("crush", "battlemage", 1000, a, undefined, {});
  const withNode = skillDamageText("crush", "battlemage", 1000, a, undefined, { dmg: 0.3 });
  const num = (s: string): number => Number(s.match(/Урон (\d+)/)?.[1]);
  assert.ok(plain && withNode);
  assert.ok(num(withNode) > num(plain), `было ${plain}, стало ${withNode}`);
  assert.equal(num(withNode), Math.round(num(plain) * 1.3));
});

test("★ узел «длительность +1 с» увеличивает время в описании умения", () => {
  const plain = skillDesc("seal", "support", a, {});
  const withNodes = skillDesc("seal", "support", a, modsOf("support", "seal", [0, 25, 35]));
  assert.match(plain, /на 6 с/);
  assert.match(withNodes, /на 8 с/);
});

test("★ узел «+1 волна» увеличивает число волн «Шквала стрел»", () => {
  const plain = skillDamageText("arrowStorm", "archer", 1000, a, undefined, {});
  const withNode = skillDamageText("arrowStorm", "archer", 1000, a, undefined, { count: 1 });
  const waves = (s: string): number => Number(s.match(/× (\d+)/)?.[1]);
  assert.ok(plain && withNode);
  assert.equal(waves(withNode) - waves(plain), 1);
});

test("без прибавок дерева числа те же, что и раньше", () => {
  assert.equal(
    skillDamageText("crush", "battlemage", 1000, a, undefined, {}),
    skillDamageText("crush", "battlemage", 1000, a),
  );
});
