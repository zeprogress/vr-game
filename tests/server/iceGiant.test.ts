import { test } from "node:test";
import assert from "node:assert/strict";
import { Mob, eliteOpts, type MobFx, type PlayerHit, type SimPlayer } from "../../src/server/sim/ZoneSim";
import { ELITE_MOBS, ICE_GIANT } from "../../src/shared/mobs";
import { terrainHeight } from "../../src/shared/terrain";

const DT = 1 / 30;
/** Дистанция кайтящего лучника: дальше броска глыбы (minDist), в пределах разлома (maxDist). */
const KITE = 24;

function giant(): Mob {
  const d = ELITE_MOBS.iceGiant;
  return new Mob(d.kind, 0, 0, eliteOpts(d));
}

function hero(id: string, x: number, z: number): SimPlayer {
  return { sessionId: id, x, y: terrainHeight(x, z) + 1.6, z };
}

/** Тикать гиганта sec секунд; move — двигать героев перед тиком. Возвращает удары и визуальные события. */
function run(m: Mob, players: SimPlayer[], sec: number, move?: (t: number) => void): { hits: PlayerHit[]; fx: MobFx[] } {
  const hits: PlayerHit[] = [];
  for (let t = 0; t < sec; t += DT) {
    move?.(t);
    m.tick(DT, players, hits, () => {});
  }
  const fx = [...m.fx];
  m.fx.length = 0;
  return { hits, fx };
}

test("Ледяной гигант: толпа рядом — «Ледяной раскол» по кругу (2 стака, отброс) и размах по дуге (стак каждому)", () => {
  const m = giant();
  const ps = [hero("a", 0, 9), hero("b", 4, 8), hero("c", -4, 8)];
  const { hits, fx } = run(m, ps, 14);
  assert.ok(fx.some((f) => f.k === "giantSlam"), "телеграф раскола");
  const slam = fx.find((f) => f.k === "giantSlamHit");
  assert.ok(slam, "раскол ударил");
  const slamHits = hits.filter((h) => h.frost === ICE_GIANT.slam.stacks && h.knockback === ICE_GIANT.slam.knockback);
  assert.equal(new Set(slamHits.map((h) => h.target)).size, 3, "раскол задел всех троих");
  const cleave = hits.filter((h) => h.frost === 1 && !h.stunSec && !h.dot);
  assert.ok(cleave.length >= 2, "размах когтями бил");
  assert.ok(new Set(cleave.map((h) => h.target)).size >= 2, "размах задевает нескольких в дуге");
  assert.ok(hits.some((h) => h.dot && h.dmg === 0 && h.slowFrac === ICE_GIANT.aura.slowFrac), "аура «Стужа» замедляет без урона");
});

test("Ледяной гигант: дальнего героя достаёт глыбой (круг → полёт → удар и наледь) и разломом (оглушение)", () => {
  const m = giant();
  const p = hero("archer", 0, KITE);
  // Лучник держит дистанцию KITE м от гиганта (кайтит и стреляет — агр держится) — когтями не дотянуться.
  const { hits, fx } = run(m, [p], 30, () => {
    const dx = p.x - m.x;
    const dz = p.z - m.z;
    const d = Math.hypot(dx, dz) || 1;
    p.x = m.x + (dx / d) * KITE;
    p.z = m.z + (dz / d) * KITE;
    p.y = terrainHeight(p.x, p.z) + 1.6;
    m.forceAggroIfIdle();
  });
  const kinds = new Set(fx.map((f) => f.k));
  for (const k of ["giantThrowMark", "giantThrowFly", "giantThrowHit", "giantFissure", "giantFissureGo"] as const) assert.ok(kinds.has(k), k);
  const mark = fx.find((f) => f.k === "giantThrowMark")!;
  const land = fx.find((f) => f.k === "giantThrowHit")!;
  assert.equal(land.x, mark.x, "глыба падает в отмеченный круг");
  assert.ok(hits.some((h) => h.stunSec === ICE_GIANT.fissure.stunSec && h.frost === 1), "разлом оглушил и положил стак");
});

test("Ледяной гигант: наледь замедляет, пока стоишь на ней (урона нет)", () => {
  const m = giant();
  const p = hero("archer", 0, KITE);
  // Кайтим, пока глыба не упадёт (наледь живёт patchSec — дальше не ждём).
  let land: MobFx | undefined;
  for (let t = 0; t < 30 && !land; t += DT) {
    const dx = p.x - m.x;
    const dz = p.z - m.z;
    const d = Math.hypot(dx, dz) || 1;
    p.x = m.x + (dx / d) * KITE;
    p.z = m.z + (dz / d) * KITE;
    m.forceAggroIfIdle();
    m.tick(DT, [p], [], () => {});
    land = m.fx.find((f) => f.k === "giantThrowHit");
  }
  assert.ok(land);
  const onIce = hero("slow", land.x, land.z);
  const { hits } = run(m, [onIce], 1);
  assert.ok(hits.some((h) => h.target === "slow" && h.dmg === 0 && h.slowFrac === ICE_GIANT.throw.patchSlow));
});

test("Ледяной гигант: «Ледяная ярость» на 30% HP — рёв один раз, оглушение срывает раскол", () => {
  const m = giant();
  const ps = [hero("a", 0, 9), hero("b", 4, 8)];
  run(m, ps, 1);
  m.hp = m.maxHp * (ICE_GIANT.fury.at - 0.01);
  const { fx } = run(m, ps, 0.5);
  assert.equal(fx.filter((f) => f.k === "giantFury").length, 1);
  assert.ok(m.giantFury);
  const again = run(m, ps, 3);
  assert.equal(again.fx.filter((f) => f.k === "giantFury").length, 0, "ярость — один раз за жизнь");
  // Оглушили на замахе раскола — удара нет.
  const m2 = giant();
  let stunned = false;
  const r = run(m2, [hero("a", 0, 9), hero("b", 4, 8)], 14, () => {
    if (!stunned && m2.fx.some((f) => f.k === "giantSlam")) {
      m2.stun(1.5);
      stunned = true;
    }
  });
  assert.ok(stunned, "раскол начался");
  const firstMark = r.fx.findIndex((f) => f.k === "giantSlam");
  const firstHit = r.fx.findIndex((f) => f.k === "giantSlamHit");
  assert.ok(firstHit < 0 || firstHit > r.fx.findIndex((f, i) => i > firstMark && f.k === "giantSlam"), "первый раскол сорван оглушением");
});
