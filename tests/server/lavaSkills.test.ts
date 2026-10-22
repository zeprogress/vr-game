import { test } from "node:test";
import assert from "node:assert/strict";
import { LavaSkills, type LavaCtx, type LavaEvent } from "../../src/server/sim/lavaSkills";
import { LAVA, MOB_SWING } from "../../src/shared/mobs";

const DT = 0.05;
const base = 10;
const ctx = (over: Partial<LavaCtx> = {}): LavaCtx => ({
  x: 0, z: 0, yaw: 0, hpFrac: 1, aggroed: true, stunned: false,
  heroes: [{ id: "a", x: 2, z: 0 }], base, ...over,
});
/** Прогнать секунды; вернуть все события с меткой времени (с). */
function run(s: LavaSkills, sec: number, c: LavaCtx | (() => LavaCtx)): { at: number; ev: LavaEvent }[] {
  const out: { at: number; ev: LavaEvent }[] = [];
  for (let t = 0; t < sec; t += DT) {
    const cc = typeof c === "function" ? c() : c;
    for (const ev of s.tick(DT, cc)) out.push({ at: Math.round(t * 100) / 100, ev });
  }
  return out;
}
const hits = (evs: { at: number; ev: LavaEvent }[]) => evs.filter((e) => e.ev.t === "hit");

test("Страж: удар о землю — телеграф сразу, урон по кадру удара, оглушение", () => {
  const s = new LavaSkills("guard");
  const evs = run(s, 2, ctx());
  const first = evs.find((e) => e.ev.t === "swing")!;
  assert.equal(first.ev.t === "swing" && first.ev.k, MOB_SWING.lavaSlam);
  assert.ok(evs.some((e) => e.ev.t === "fx" && e.ev.fx.k === "lavaSlam"), "телеграф круга");
  const h = hits(evs);
  assert.equal(h.length, 1);
  assert.ok(h[0].at >= LAVA.guard.slam.windup - DT && h[0].at <= LAVA.guard.slam.windup + DT, `урон в ${h[0].at}`);
  const e = h[0].ev as Extract<LavaEvent, { t: "hit" }>;
  assert.equal(e.dmg, base * LAVA.guard.slam.dmgMul);
  assert.equal(e.stunSec, LAVA.guard.slam.stunSec);
});

test("Страж: удар о землю не чаще кулдауна; пока приём идёт — моб стоит", () => {
  const s = new LavaSkills("guard");
  const evs = run(s, 20, ctx());
  const slams = evs.filter((e) => e.ev.t === "fx" && e.ev.fx.k === "lavaSlam");
  assert.ok(slams.length >= 2);
  assert.ok(slams[1].at - slams[0].at >= LAVA.guard.slam.cooldown - 0.2, `интервал ${slams[1].at - slams[0].at}`);
});

test("Страж: оглушение посреди замаха срывает удар — урона нет", () => {
  const s = new LavaSkills("guard");
  const first = run(s, 0.3, ctx());
  assert.ok(first.some((e) => e.ev.t === "fx"));
  const after = run(s, 3, ctx({ stunned: true }));
  assert.equal(hits(after).length, 0);
  assert.equal(s.casting, false);
});

test("Страж: разлив магмы — линия по герою, горение тиками после удара; моб свободен раньше", () => {
  const s = new LavaSkills("guard");
  // Слэм неготов (кулдаун) — пусть герой далеко от круга, но в линии.
  const c = ctx({ heroes: [{ id: "a", x: 5, z: 0 }] });
  const evs = run(s, 9, c);
  const spill = evs.find((e) => e.ev.t === "fx" && e.ev.fx.k === "lavaSpill");
  assert.ok(spill, "телеграф линии");
  const h = hits(evs);
  assert.ok(h.some((e) => !(e.ev as Extract<LavaEvent, { t: "hit" }>).dot), "прямой удар");
  const burns = h.filter((e) => (e.ev as Extract<LavaEvent, { t: "hit" }>).dot);
  assert.equal(burns.length, LAVA.guard.spill.burnSec / LAVA.guard.spill.burnTick);
  assert.equal(s.casting, false, "горение не держит моба в приёме");
});

test("Страж: ярость один раз, на доле HP — рёв-кольцо, потом ярость ускоряет", () => {
  const s = new LavaSkills("guard");
  const evs = run(s, 3, ctx({ hpFrac: 0.35, heroes: [{ id: "a", x: 1, z: 0 }] }));
  const roar = evs.find((e) => e.ev.t === "swing" && e.ev.k === MOB_SWING.lavaRoar);
  assert.ok(roar, "рёв ярости");
  assert.ok(evs.some((e) => e.ev.t === "fx" && e.ev.fx.k === "lavaFuryHit"));
  assert.equal(s.fury, true);
  assert.equal(s.speedMul, LAVA.guard.fury.speedMul);
  const again = run(s, 20, ctx({ hpFrac: 0.2, heroes: [] }));
  assert.equal(again.filter((e) => e.ev.t === "swing" && e.ev.k === MOB_SWING.lavaRoar).length, 0, "ярость только раз");
});

test("Маг: кольцо углей — слабый удар по кругу и замедление", () => {
  const s = new LavaSkills("mage");
  const evs = run(s, 1.5, ctx({ heroes: [{ id: "a", x: 2, z: 0 }] }));
  const h = hits(evs)[0];
  assert.ok(h, "удар кольца");
  const e = h.ev as Extract<LavaEvent, { t: "hit" }>;
  assert.equal(e.dmg, base * LAVA.mage.ring.dmgMul);
  assert.equal(e.slowSec, LAVA.mage.ring.slowSec);
  assert.equal(e.slowFrac, LAVA.mage.ring.slowFrac);
});

test("Маг: метка лавы — круг под героем сразу, удар через windup + задержку по месту метки", () => {
  const s = new LavaSkills("mage");
  const c = ctx({ heroes: [{ id: "a", x: 10, z: 0 }] });
  const evs = run(s, 4.5, c);
  const mark = evs.find((e) => e.ev.t === "fx" && e.ev.fx.k === "lavaMark");
  assert.ok(mark && mark.at === 0, "метка с первого кадра");
  const h = hits(evs);
  assert.equal(h.length, 1);
  const total = LAVA.mage.mark.windup + LAVA.mage.mark.delaySec;
  assert.ok(Math.abs(h[0].at - total) <= DT + 0.001, `удар в ${h[0].at}`);
  assert.equal((h[0].ev as Extract<LavaEvent, { t: "hit" }>).dmg, base * LAVA.mage.mark.dmgMul);
});

test("Маг: метка не бьёт тех, кто ушёл с круга", () => {
  const s = new LavaSkills("mage");
  let t = 0;
  // Герой стоит у метки первую секунду, потом уходит далеко — к удару его уже нет.
  const hero = () => ({ id: "a", x: t < 1 ? 10 : 40, z: 0 });
  const evs: { at: number; ev: LavaEvent }[] = [];
  for (; t < 5; t += DT) for (const ev of s.tick(DT, ctx({ heroes: [hero()] }))) evs.push({ at: t, ev });
  assert.ok(evs.some((e) => e.ev.t === "fx" && e.ev.fx.k === "lavaMark"));
  assert.equal(hits(evs).length, 0);
});

test("Маг и страж не делают приёмов без цели рядом", () => {
  assert.equal(hits(run(new LavaSkills("guard"), 15, ctx({ heroes: [] }))).length, 0);
  assert.equal(hits(run(new LavaSkills("mage"), 15, ctx({ heroes: [] }))).length, 0);
});
