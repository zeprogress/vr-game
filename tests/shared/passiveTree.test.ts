import { test } from "node:test";
import assert from "node:assert/strict";
import { armorFrac, CLASS_IDS, CLASSES2, critChance2, maxHpFor, moveSpeedFor, skillCdMul2, weaponDamageBase } from "../../src/shared/classes2";
import { magicPowerFor } from "../../src/shared/magic";
import { ATTR_NODE, attrsFromTree, autoTree, canTake, cleanTaken, dropNode, skillModsFor, takeAttr, treeBonusTotals, treeOf, treePointsAt, treeSkillState } from "../../src/shared/passiveTree";

test("дерево: у каждого класса 168 узлов, форма одинаковая, в каждом направлении есть ключевые", () => {
  const shape = treeOf("warrior").edges.map((e) => `${e.a}-${e.b}`).join(",");
  for (const c of CLASS_IDS) {
    const t = treeOf(c);
    assert.equal(t.nodes.length - 1, 168, c);
    assert.equal(t.edges.map((e) => `${e.a}-${e.b}`).join(","), shape, `${c}: форма как у воина`);
    assert.equal(t.nodes.filter((n) => n.kind === "key").length, 10, c);
  }
});

test("дерево: каждый узел связан с корнем", () => {
  for (const c of CLASS_IDS) {
    const t = treeOf(c);
    const all = t.nodes.map((n) => n.id).filter((id) => id > 0);
    assert.equal(cleanTaken(c, all).length, all.length, c);
  }
});

test("дерево: очко за уровень, узел берётся только рядом со взятым", () => {
  assert.equal(treePointsAt(1), 1);
  assert.equal(treePointsAt(100), 100);
  const t = treeOf("warrior");
  const low = t.adj[0][0];
  const far = t.nodes.find((n) => n.row === 6)!.id;
  assert.equal(canTake("warrior", [], 5, low), true);
  assert.equal(canTake("warrior", [], 5, far), false);
  assert.equal(canTake("warrior", [low], 1, t.adj[low].find((x) => x !== 0)!), false, "на 1 уровне очко одно");
});

test("дерево: !str берёт ближайший узел СИЛ с путём, узел даёт +4", () => {
  const taken: number[] = [];
  assert.equal(takeAttr("warrior", taken, 10, "str", 2), 2);
  assert.equal(attrsFromTree("warrior", taken, 1).str, 1 + 2 * ATTR_NODE);
  assert.ok(taken.length <= 10);
  assert.equal(cleanTaken("warrior", taken).length, taken.length, "путь связан с корнем");
});

test("дерево: снятие узла снимает всё, что от него оторвалось", () => {
  const taken: number[] = [];
  takeAttr("warrior", taken, 20, "str", 3);
  const left = dropNode("warrior", taken, taken[0]);
  assert.ok(left.length < taken.length);
  assert.equal(cleanTaken("warrior", left).length, left.length);
});

test("дерево: бот тратит очки в пределах уровня и только по своим атрибутам", () => {
  for (const c of CLASS_IDS) {
    const taken: number[] = [];
    autoTree(c, taken, 60, CLASSES2[c].build);
    assert.ok(taken.length <= 60 && taken.length >= 55, `${c}: взято ${taken.length}`);
    const a = attrsFromTree(c, taken, 1);
    for (const [k, w] of Object.entries(CLASSES2[c].build)) if (!w) assert.equal(a[k as keyof typeof a], 1, `${c}: ${k} без веса не растёт`);
  }
});

test("бонусы: малые узлы с механикой действуют, суммы складываются", () => {
  for (const c of CLASS_IDS) {
    const t = treeOf(c);
    const small = t.nodes.filter((n) => n.kind === "small");
    const active = small.filter((n) => n.active);
    assert.ok(active.length >= small.length * 0.6, `${c}: действует ${active.length} из ${small.length} малых`);
    for (const n of t.nodes) if (n.kind === "attr") assert.equal(n.active, true);
    // Вампиризм — множитель к роллу оружия (может быть 15–30%), остальные бонусы — доли до 20%.
    for (const n of active) {
      const lim = n.fx?.key === "vamp" ? 1 : 0.2;
      assert.ok((n.fx && n.fx.value > 0 && n.fx.value < lim) || (n.smallSp && n.smallSp.value > 0), `${c}: ${n.name} ${n.desc}`);
    }
  }
  const t = treeOf("warrior");
  const two = t.nodes.filter((n) => n.fx?.key === "hp").slice(0, 2);
  const sum = treeBonusTotals("warrior", two.map((n) => n.id));
  assert.equal(Math.round(sum.hp * 1000), Math.round((two[0].fx!.value + two[1].fx!.value) * 1000));
});

test("бонусы: tb героя идёт в формулы боя", () => {
  const a = { str: 1, agi: 1, int: 1, con: 1, luc: 1, wis: 1 };
  const tb = { hp: 0.1, physDef: 0.1, crit: 0.05, move: 0.1, cd: 0.1, dmg: 0.1, magic: 0.1 };
  const b = { ...a, tb };
  assert.ok(Math.abs(maxHpFor(10, b) / maxHpFor(10, a) - 1.1) < 1e-6);
  assert.ok(armorFrac(b) > armorFrac(a));
  assert.ok(Math.abs(critChance2(b, 0.05) - critChance2(a, 0.05) - 0.05) < 1e-9);
  assert.ok(Math.abs(moveSpeedFor(10, b) / moveSpeedFor(10, a) - 1.1) < 1e-6);
  assert.ok(skillCdMul2("warrior", b) < skillCdMul2("warrior", a));
  assert.ok(Math.abs(weaponDamageBase(10, b) / weaponDamageBase(10, a) - 1.1) < 1e-6);
  assert.ok(Math.abs(magicPowerFor(10, b) / magicPowerFor(10, a) - 1.1) < 1e-6);
});

test("умения и ключевые: у каждого ◆ и ★ есть механика", () => {
  for (const c of CLASS_IDS) {
    for (const n of treeOf(c).nodes) {
      if (n.kind === "key") assert.ok(n.keyFx && n.active, `${c}: ◆ ${n.name}`);
      if (n.kind === "skill") assert.ok(n.skillMod && n.active, `${c}: ★ ${n.name} — ${n.desc}`);
    }
  }
});

test("умения и ключевые: прибавки складываются, множители перемножаются, «*» — для всех умений", () => {
  const m = skillModsFor({ "*": { cdAdd: 2, durMul: 1.5 }, seal: { cdAdd: 4, dur: 1, durMul: 2 } }, "seal");
  assert.equal(m.cdAdd, 6);
  assert.equal(m.dur, 1);
  assert.equal(m.durMul, 3);
  assert.equal(skillModsFor({ "*": { cdAdd: 2 } }, "mark").cdAdd, 2);
  const t = treeOf("warrior");
  const all = t.nodes.map((n) => n.id).filter((id) => id > 0);
  const st = treeSkillState("warrior", all);
  assert.ok(st.special.doubleEvery === 4, "Шквал у воина — каждая 4-я");
  assert.ok((st.special.execute ?? 0) > 0, "Палач");
  assert.ok(Object.keys(st.skills).length > 0);
});

test("дерево: все узлы действуют в бою", () => {
  for (const c of CLASS_IDS) {
    const off = treeOf(c).nodes.filter((n) => n.id > 0 && !n.active).map((n) => n.name);
    assert.deepEqual(off, [], `${c}: не действуют ${off.join(", ")}`);
  }
});
