import { ICE_GIANT } from "#shared/mobs";
import type { ActKind } from "#shared/net/messages";
import type { Scene } from "@babylonjs/core/scene";
import type { Sfx } from "../audio/Sfx";
import { FXC } from "./fxColors";
import { DECAL, IceFx, SHARD, type ShardGroup } from "./IceFx";
import type { FollowFn } from "./SkillVfx";

/**
 * События Ледяного гиганта (ICE_GIANT, сервер — ZoneSim.tickGiant) → лёд и звук. Одно место для игры и
 * спектатора (как playClassAct): раскол, глыба (в руке → полёт по дуге → удар и наледь), разлом, ярость,
 * стаки «Обморожения» на герое и «Ледяная глыба» вокруг вмёрзшего.
 */

type P = { x: number; y: number; z: number };

export interface IceGiantCtx {
  scene: Scene;
  sfx: Sfx;
  /** Где герой (у земли) или моб. */
  follow: FollowFn;
  /** Мировая точка кости модели моба (рука с глыбой); null — вида моба нет. */
  bone: (mobId: string, bone: string) => P | null;
  ground: (x: number, z: number) => number;
}

const KINDS = new Set<ActKind>([
  "giantSlam", "giantSlamHit", "giantThrowMark", "giantThrowFly", "giantThrowHit", "giantFissure", "giantFissureGo",
  "giantFury", "frostStack", "iceEncase",
]);

/** Глыба гиганта: в руке до броска и в полёте до удара (id моба → кристаллы). */
const held = new Map<string, ShardGroup>();
const flying = new Map<string, ShardGroup>();

const G = ICE_GIANT;
/** Глыба: кристаллы во все стороны (радиус сдвига, длина кристалла, сколько, оборотов в секунду). */
const BOULDER = { r: 0.9, size: 1.25, count: 18, spin: 1.5 };

export function playIceGiantAct(
  ctx: IceGiantCtx, k: ActKind, x: number, y: number, z: number, id: string,
  d?: number, x2?: number, z2?: number, r?: number,
): boolean {
  if (!KINDS.has(k)) return false;
  const ice = IceFx.of(ctx.scene);
  const sfx = ctx.sfx;
  const at = { x, y, z };
  switch (k) {
    case "giantSlam":
      // Круг вокруг гиганта: лёд нарастает от центра к краю — дойдёт до края, будет удар.
      ice.decal(DECAL.circle, x, y, z, r ?? G.slam.radius, d ?? G.slam.windup, 0.9);
      break;
    case "giantSlamHit": {
      const R = r ?? G.slam.radius;
      ice.shards(SHARD.ring, at, { r: R * 0.9, hold: 1.1, size: 2.8 });
      ice.shards(SHARD.crater, at, { r: 3.4, hold: 0.9, size: 1.6, count: 24 });
      ice.decal(DECAL.wave, x, y, z, R * 1.05, 0.55);
      ice.decal(DECAL.frost, x, y, z, R * 0.8, 3.5, 0.85);
      const a0 = Math.random() * Math.PI;
      for (let i = 0; i < 4; i++) {
        const a = a0 + (i / 4) * Math.PI * 2;
        const cx = Math.cos(a);
        const cz = Math.sin(a);
        ice.burst(x + cx * R * 0.8, y + 0.6, z + cz * R * 0.8, FXC.iceRim, { count: 14, speed: 6, life: 0.7, size: 0.3, dir: [cx, 1.4, cz], spread: 0.45 });
      }
      ice.burst(x, y + 1.2, z, FXC.frost, { count: 28, speed: 9, life: 0.9, grav: 6, size: 0.45 });
      sfx.at(at, () => {
        sfx.ice("slam");
        sfx.ice("spikes", 0.8, 0.08, 0.04);
      });
      ice.after(1.15, () => {
        ice.burst(x, y + 1, z, FXC.iceRim, { count: 26, speed: 7, life: 0.8, size: 0.25 });
        sfx.at(at, () => sfx.ice("shatter", 0.6));
      });
      break;
    }
    case "giantThrowMark": {
      // Круг под героем — сюда упадёт глыба; гигант выламывает её из земли (клип Throw, 0.62 с) и держит в руке.
      ice.decal(DECAL.circle, x, y, z, r ?? G.throw.radius, d ?? G.throw.windup + G.throw.flight, 0.9);
      const mob = ctx.follow("mob", id);
      if (mob) sfx.at(mob, () => sfx.ice("throw", 1, 0.03, 0.62));
      ice.after(0.62, () => {
        const hand = (): P | null => ctx.bone(id, "Hand.R");
        const p = hand();
        if (!p) return;
        held.set(id, ice.shards(SHARD.boulder, p, { ...BOULDER, hold: G.throw.windup - 0.62 + 0.3, track: hand }));
        ice.burst(p.x, p.y, p.z, FXC.frost, { count: 16, speed: 3, life: 0.6, grav: 4, size: 0.3 });
      });
      break;
    }
    case "giantThrowFly": {
      // Бросок: глыба из руки (или над гигантом, если его вида нет) летит по дуге к кругу, за ней — иней.
      const T = d ?? G.throw.flight;
      const to = { x, y: y + 0.8, z };
      let gr = held.get(id);
      held.delete(id);
      const from: P = gr
        ? { x: gr.a.x, y: gr.a.y, z: gr.a.z }
        : (ctx.bone(id, "Hand.R") ?? { x: x2 ?? x, y: ctx.ground(x2 ?? x, z2 ?? z) + 4.5, z: z2 ?? z });
      const arc = Math.max(3, Math.hypot(to.x - from.x, to.z - from.z) * 0.3);
      const t0 = ice.clock;
      const path = (): P => {
        const u = Math.min(1, (ice.clock - t0) / T);
        return {
          x: from.x + (to.x - from.x) * u,
          y: from.y + (to.y - from.y) * u + arc * 4 * u * (1 - u),
          z: from.z + (to.z - from.z) * u,
        };
      };
      if (gr) ice.retrack(gr, path, T + 0.05);
      else gr = ice.shards(SHARD.boulder, from, { ...BOULDER, hold: T + 0.05, track: path });
      flying.set(id, gr);
      const steps = Math.max(3, Math.round(T / 0.12));
      for (let i = 1; i < steps; i++) {
        ice.after((i / steps) * T, () => {
          const p = path();
          ice.burst(p.x, p.y, p.z, FXC.frost, { count: 6, speed: 0.8, life: 0.55, grav: 2, size: 0.4 });
        });
      }
      break;
    }
    case "giantThrowHit": {
      const gr = flying.get(id);
      flying.delete(id);
      if (gr) ice.end(gr);
      ice.shards(SHARD.crater, at, { r: 2.6, hold: 1.0, size: 1.7, count: 26 });
      ice.shards(SHARD.ring, at, { r: G.throw.radius * 0.8, hold: 0.8, size: 1.3, count: 18 });
      ice.decal(DECAL.wave, x, y, z, G.throw.radius * 1.2, 0.5);
      ice.decal(DECAL.frost, x, y, z, r ?? G.throw.patchR, d ?? G.throw.patchSec, 0.95); // наледь
      ice.burst(x, y + 1, z, FXC.iceRim, { count: 28, speed: 8, life: 0.9, grav: 9, size: 0.35 });
      ice.burst(x, y + 0.5, z, FXC.frost, { count: 20, speed: 4, life: 1.2, grav: 1, size: 0.6 });
      sfx.at(at, () => sfx.ice("impact"));
      break;
    }
    case "giantFissure":
      // Полоса к герою: через d с по ней побегут шипы (и ещё len/speed, пока бегут).
      ice.strip(x, y, z, x2 ?? x, z2 ?? z, r ?? G.fissure.halfWidth, (d ?? G.fissure.windup) + G.fissure.len / G.fissure.speed);
      break;
    case "giantFissureGo": {
      const ex = x2 ?? x;
      const ez = z2 ?? z;
      const ey = ctx.ground(ex, ez);
      const len = Math.hypot(ex - x, ez - z);
      const speed = len / Math.max(0.1, d ?? G.fissure.len / G.fissure.speed);
      ice.shards(SHARD.line, at, { b: { x: ex, y: ey, z: ez }, w: r ?? G.fissure.halfWidth, speed, hold: 0.9, size: 3.1 });
      ice.decal(DECAL.wave, x, y, z, 3, 0.4);
      sfx.at(at, () => sfx.ice("spikes", 0.9));
      // По пути — искры и треск там, где сейчас фронт.
      const n = 4;
      for (let i = 1; i <= n; i++) {
        const u = i / n;
        const px = x + (ex - x) * u;
        const pz = z + (ez - z) * u;
        const py = ctx.ground(px, pz);
        ice.after((len * u) / speed, () => {
          ice.burst(px, py + 0.8, pz, FXC.iceRim, { count: 12, speed: 5, life: 0.6, size: 0.28, dir: [0, 1, 0], spread: 0.6 });
          if (i % 2 === 0) sfx.at({ x: px, y: py, z: pz }, () => sfx.ice("spikes", 0.6, 0.1));
        });
      }
      ice.after(len / speed + 0.9, () => sfx.at({ x: ex, y: ey, z: ez }, () => sfx.ice("shatter", 0.45)));
      break;
    }
    case "giantFury":
      // «Ледяная ярость»: рёв (клип Roar раскрывается на 0.4 с), волна холода, вихрь снега; дальше — метель (аура).
      ice.decal(DECAL.wave, x, y, z, 14, 0.9);
      ice.after(0.4, () => ice.burst(x, y + 3, z, FXC.frost, { count: 28, speed: 10, life: 1.4, grav: 2, size: 0.5 }));
      sfx.at(at, () => sfx.ice("roar", 1.1, 0.02, 0.35));
      break;
    case "frostStack": {
      // Стак «Обморожения»: кристаллы кружат вокруг героя — сколько стаков, столько кристаллов.
      const fol = (): P | null => ctx.follow("hero", id);
      ice.frostOrbit(id, Math.max(1, Math.round(d ?? 1)), G.frost.stackSec, fol);
      sfx.at(fol() ?? at, () => sfx.ice("stack", 0.55, 0.08));
      break;
    }
    case "iceEncase": {
      // «Ледяная глыба»: стаки сгорели, герой в клетке из кристаллов d с, потом лёд разлетается.
      ice.clearOrbit(id);
      const p = ctx.follow("hero", id) ?? { x, y: ctx.ground(x, z), z };
      const T = d ?? G.frost.freezeSec;
      ice.shards(SHARD.cage, p, { r: 0.62, hold: T, size: 2.1, count: 14 });
      ice.decal(DECAL.frost, p.x, p.y, p.z, 1.6, T + 0.8, 0.9);
      ice.burst(p.x, p.y + 1, p.z, FXC.frost, { count: 20, speed: 3, life: 0.7, grav: 2, size: 0.35 });
      sfx.at(p, () => sfx.ice("freeze"));
      ice.after(T, () => {
        ice.burst(p.x, p.y + 1.1, p.z, FXC.iceRim, { count: 28, speed: 6, life: 0.8, grav: 9, size: 0.28 });
        sfx.at(p, () => sfx.ice("shatter", 0.8));
      });
      break;
    }
  }
  return true;
}
