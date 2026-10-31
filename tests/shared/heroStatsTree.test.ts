import { test } from "node:test";
import assert from "node:assert/strict";
import { heroStatRows } from "../../src/shared/heroStats";
import type { HeroStatInput } from "../../src/shared/heroStats";

/**
 * Характеристики персонажа обязаны учитывать узлы дерева прокачки (PlayerState.tb):
 * блок, крит, сила крита, вампиризм. Иначе игрок качает узел и не видит разницы
 * в окне, хотя в бою эффект работает (жалоба 2026-10-31).
 */
const base: HeroStatInput = {
  level: 50, str: 40, agi: 30, int: 20, con: 30, luc: 20, wis: 20,
  rightCls: "sword", rightTier: "gold", leftCls: "shield", leftTier: "gold",
  rightAffix: "Урон +10%", leftAffix: "Блок +12%",
};

const valueOf = (p: HeroStatInput, label: string): string => heroStatRows(p).find((r) => r.label === label)?.value ?? "";
const num = (s: string): number => Number(s.replace(/[^\d.,]/g, "").replace(",", "."));

test("блок: узлы дерева прибавляются к шансу блока щитом", () => {
  const plain = num(valueOf(base, "Блок щитом"));
  const withNodes = num(valueOf({ ...base, tb: { block: 0.2 } }, "Блок щитом"));
  assert.equal(withNodes - plain, 20, `было ${plain}%, стало ${withNodes}%`);
});

test("крит: узлы дерева дают шанс и силу крита", () => {
  const plainChance = num(valueOf(base, "Шанс крита"));
  const plainMult = num(valueOf(base, "Сила крита"));
  const withNodes = { ...base, tb: { crit: 0.05, critDmg: 0.1 } };
  assert.equal(num(valueOf(withNodes, "Шанс крита")) - plainChance, 5);
  assert.ok(Math.abs(num(valueOf(withNodes, "Сила крита")) - plainMult - 0.1) < 0.005);
});

test("вампиризм: узлы дерева видны в строке вампиризма", () => {
  assert.equal(valueOf(base, "Вампиризм"), "", "без роллов и узлов строки нет");
  assert.match(valueOf({ ...base, tb: { vamp: 0.1 } }, "Вампиризм"), /10%/);
});

test("без щита нет строки блока даже с узлами", () => {
  const noShield: HeroStatInput = { ...base, leftCls: "", leftTier: "", leftAffix: "", tb: { block: 0.2 } };
  assert.equal(valueOf(noShield, "Блок щитом"), "");
});
