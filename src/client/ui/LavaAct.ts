import type { ActKind } from "#shared/net/messages";
import { FXC } from "./fxColors";
import { FDECAL, FireFx } from "./FireFx";
import type { IceGiantCtx } from "./IceGiantAct";

/**
 * События Лавового монстра (сервер — server/sim/lavaSkills.ts) → огонь. Одно место для игры и спектатора:
 * удар о землю (круг нарастает → волна и ожог), разлив магмы (сектор-телеграф по линии → жар вдоль линии),
 * ярость (кольцо-телеграф → рёв), метка лавы (круг под героем до удара), кольцо углей (круг → вспышка).
 * Звуки — Sfx.lava (tools/sfx/lava_sfx.py): удар, разлив, рёв, метка, кольцо, хлопок.
 */

const KINDS = new Set<ActKind>([
  "lavaSlam", "lavaSlamHit", "lavaSpill", "lavaSpillHit", "lavaFury", "lavaFuryHit", "lavaMark", "lavaMarkHit", "lavaRing", "lavaRingHit",
]);

/** Сектор линии магмы: от моба к концу линии, полуширина r — как угол на радиусе длины. */
function spillShape(x: number, y: number, z: number, x2: number, z2: number, r: number) {
  const dx = x2 - x;
  const dz = z2 - z;
  const len = Math.hypot(dx, dz) || 1;
  const half = Math.atan2(r, len);
  return { x, y, z, r: len, yaw: Math.atan2(dx, dz), a0: -half, a1: half, r0: 0 };
}

export function playLavaAct(
  ctx: IceGiantCtx, k: ActKind, x: number, y: number, z: number, _id: string,
  d?: number, x2?: number, z2?: number, r?: number,
): boolean {
  if (!KINDS.has(k)) return false;
  const fire = FireFx.of(ctx.scene);
  const sfx = ctx.sfx;
  const at = { x, y, z };
  const R = r ?? 3;
  switch (k) {
    case "lavaSlam":
      fire.decal(FDECAL.tele, { x, y, z, r: R }, d ?? 1.2, 0.9);
      break;
    case "lavaSlamHit":
      fire.decal(FDECAL.wave, { x, y, z, r: R * 1.05 }, 0.55);
      fire.decal(FDECAL.scorch, { x, y, z, r: R * 0.9 }, 5);
      fire.burst(x, y + 0.4, z, FXC.fire, { count: 30, speed: 7, life: 0.8, size: 0.4, grav: 5 });
      sfx.at(at, () => sfx.lava("slam"));
      break;
    case "lavaSpill":
      if (x2 !== undefined && z2 !== undefined) fire.decal(FDECAL.tele, spillShape(x, y, z, x2, z2, R), d ?? 1, 0.9);
      sfx.at(at, () => sfx.lava("spill", 0.6));
      break;
    case "lavaSpillHit":
      if (x2 !== undefined && z2 !== undefined) {
        const s = spillShape(x, y, z, x2, z2, R);
        fire.decal(FDECAL.scorch, s, 4);
        sfx.at(at, () => sfx.lava("hit", 0.5));
        // Жар вдоль линии — несколько вспышек от моба к концу.
        for (let i = 1; i <= 4; i++) {
          const u = i / 4;
          fire.burst(x + (x2 - x) * u, y + 0.3, z + (z2 - z) * u, FXC.fireRed, { count: 10, speed: 4, life: 0.6, size: 0.35, grav: 3 });
        }
      }
      break;
    case "lavaFury":
      fire.decal(FDECAL.tele, { x, y, z, r: R }, d ?? 1.5, 0.9);
      sfx.at(at, () => sfx.lava("roar"));
      break;
    case "lavaFuryHit":
      fire.decal(FDECAL.wave, { x, y, z, r: R }, 0.7);
      fire.burst(x, y + 1.2, z, FXC.fireCore, { count: 36, speed: 9, life: 0.9, size: 0.45, grav: 2 });
      break;
    case "lavaMark":
      // Метка держится до удара: круг у героя (телеграф на всё время).
      fire.decal(FDECAL.tele, { x, y, z, r: R }, d ?? 3, 0.95);
      sfx.at(at, () => sfx.lava("mark"));
      break;
    case "lavaMarkHit":
      fire.decal(FDECAL.burn, { x, y, z, r: R }, 1.2);
      fire.burst(x, y + 0.5, z, FXC.fire, { count: 24, speed: 6, life: 0.7, size: 0.4 });
      sfx.at(at, () => sfx.lava("hit"));
      break;
    case "lavaRing":
      fire.decal(FDECAL.tele, { x, y, z, r: R }, d ?? 1, 0.9);
      sfx.at(at, () => sfx.lava("ring", 0.7));
      break;
    case "lavaRingHit":
      fire.decal(FDECAL.wave, { x, y, z, r: R }, 0.6);
      fire.decal(FDECAL.burn, { x, y, z, r: R * 0.8 }, 3);
      fire.burst(x, y + 0.3, z, FXC.fireRed, { count: 22, speed: 5, life: 0.7, size: 0.35 });
      sfx.at(at, () => sfx.lava("hit", 0.7));
      break;
  }
  return true;
}
