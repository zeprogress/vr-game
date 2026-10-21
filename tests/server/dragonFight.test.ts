import { test } from "node:test";
import assert from "node:assert/strict";
import { DragonFight, sideAngle, type DragonAct, type DragonHero, type DragonHost } from "../../src/server/rooms/dragonFight";
import { DRAGON, MOB_SWING } from "../../src/shared/mobs";

const DT = 0.02;

/** Поддельный хост: дракон в (0,0) смотрит туда, куда его повернули; журнал событий, клипов и урона. */
function arena(heroes: DragonHero[]) {
  const log = {
    acts: [] as { k: DragonAct; t: number; d?: number }[],
    swings: [] as { kind: number; t: number }[],
    hurts: [] as { id: string; frac: number; t: number; knock?: number }[],
  };
  let t = 0;
  let yaw = 0;
  const host: DragonHost = {
    boss: () => ({ x: 0, z: 0, yaw, scale: 10.8 }),
    heroes: () => heroes,
    swing: (kind) => log.swings.push({ kind, t }),
    lockFacing: (y) => {
      yaw = y;
    },
    act: (k, o) => log.acts.push({ k, t, d: o.d }),
    danger: () => {},
    hurt: (id, frac, _x, _z, o) => log.hurts.push({ id, frac, t, knock: o?.knock }),
  };
  const fight = new DragonFight(host, () => 0);
  fight.start(0);
  const run = (until: number, phase = 1): void => {
    for (; t < until; t = Math.round((t + DT) * 1000) / 1000) fight.tick(t, phase);
  };
  return { log, run, fight };
}

const sum = (xs: { frac: number }[]): number => xs.reduce((s, h) => s + h.frac, 0);

test("Дыхание: телеграф, урон только в конусе и только пока идёт пламя, потом горит земля", () => {
  const front: DragonHero = { id: "front", x: 0, z: 12 };
  const side: DragonHero = { id: "side", x: 14, z: 0 };
  const { log, run } = arena([front, side]);
  run(6 + DRAGON.clipSec.breath + DRAGON.breath.burnSec + 0.5);
  const mark = log.acts.find((a) => a.k === "dragonBreath");
  assert.ok(mark, "телеграф дыхания");
  assert.equal(mark.d, DRAGON.hitSec.breathStart);
  assert.equal(log.swings[0].kind, MOB_SWING.breath);
  const t0 = mark.t;
  const flame = log.hurts.filter((h) => h.id === "front" && h.t <= t0 + DRAGON.hitSec.breathEnd);
  assert.ok(flame.every((h) => h.t >= t0 + DRAGON.hitSec.breathStart - 1e-9), "до пламени урона нет");
  assert.ok(Math.abs(sum(flame) - DRAGON.breath.dmgFrac) < 1e-9, `за пламя — ${DRAGON.breath.dmgFrac} (вышло ${sum(flame)})`);
  assert.ok(log.hurts.filter((h) => h.id === "front" && h.t > t0 + DRAGON.hitSec.breathEnd).length >= 5, "земля горит после пламени");
  assert.equal(log.hurts.filter((h) => h.id === "side").length, 0, "сбоку — мимо конуса");
  assert.ok(log.acts.some((a) => a.k === "dragonBurn"));
});

test("Удар хвостом: по сектору справа-спереди, ровно в кадр хлёста, с отбросом; слева — мимо", () => {
  const target: DragonHero = { id: "target", x: 0, z: 10 };
  const { log, run } = arena([target]);
  run(25);
  const tail = log.acts.find((a) => a.k === "dragonTail");
  assert.ok(tail, "удар хвостом был");
  const hits = log.hurts.filter((h) => h.knock === DRAGON.tail.knock);
  assert.ok(hits.length >= 1, "хвост попал по цели в середине сектора");
  assert.ok(Math.abs(hits[0].t - (tail.t + DRAGON.hitSec.tail)) <= DT + 1e-9, "в кадр хлёста");
  // Сектор: от −15° (левее носа) до 110° (вправо); слева (−60°) — мимо.
  assert.ok(sideAngle(0, 1, 1) > 0, "справа — положительный угол");
  assert.ok(sideAngle(0, -Math.sin(60 * Math.PI / 180), Math.cos(60 * Math.PI / 180)) / (Math.PI / 180) < DRAGON.tail.from);
});

test("Приёмы не накладываются: следующий — только после клипа и паузы", () => {
  const { log, run } = arena([{ id: "a", x: 0, z: 9 }]);
  run(40);
  const clips: Record<number, number> = {
    [MOB_SWING.breath]: DRAGON.clipSec.breath,
    [MOB_SWING.tail]: DRAGON.clipSec.tail,
  };
  for (let i = 1; i < log.swings.length; i++) {
    const prev = log.swings[i - 1];
    assert.ok(log.swings[i].t - prev.t >= (clips[prev.kind] ?? 0) + DRAGON.gap - 1e-9, "пауза между приёмами");
  }
});

test("Печать: метеоры после пика заряда, урон в круге метки", () => {
  const h: DragonHero = { id: "h", x: 20, z: 5 };
  const { log, run } = arena([h]);
  run(1, 1);
  run(8, 2);
  const mark = log.acts.find((a) => a.k === "dragonMeteorMark");
  assert.ok(mark, "метки метеоров");
  assert.equal(mark.d, DRAGON.hitSec.charge + DRAGON.meteor.fall);
  assert.ok(log.swings.some((s) => s.kind === MOB_SWING.magic), "клип заряда");
  const hit = log.hurts.find((x) => x.id === "h");
  assert.ok(hit, "метеор под героем попал");
  assert.ok(Math.abs(hit.t - (mark.t + DRAGON.hitSec.charge + DRAGON.meteor.fall)) <= DT + 1e-9);
});

test("Ярость: рёв, затем кольцо — удар крыльями вниз в кадр с уроном и отбросом", () => {
  const h: DragonHero = { id: "h", x: 5, z: 0 };
  const { log, run } = arena([h]);
  run(1, 2); // печать
  run(2, 2.5); // печать разбита
  run(13, 3);
  assert.ok(log.acts.some((a) => a.k === "dragonShieldBreak"), "печать разбита — щит рассыпался");
  assert.ok(log.acts.some((a) => a.k === "dragonRage"), "рёв ярости");
  const ring = log.acts.find((a) => a.k === "dragonRingMark");
  assert.ok(ring, "кольцо пламени");
  const wings = log.swings.find((s) => s.kind === MOB_SWING.wings);
  assert.ok(wings && Math.abs(wings.t - (ring.t + DRAGON.ring.telegraph - DRAGON.hitSec.wings)) <= DT + 1e-9, "клип крыльев — за 0.85 с до удара");
  const hit = log.hurts.find((x) => x.knock === DRAGON.ring.knock);
  assert.ok(hit && Math.abs(hit.t - (ring.t + DRAGON.ring.telegraph)) <= DT + 1e-9, "урон и отброс — в кадр удара крыльями");
});
