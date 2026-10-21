import type { ActKind } from "#shared/net/messages";
import { STEEL_AURA } from "#shared/classes2";
import { FXC } from "./fxColors";
import { FDECAL, FireFx, FLAME } from "./FireFx";
import type { IceGiantCtx } from "./IceGiantAct";

/**
 * 🔥 «Аура раскалённой стали» (воин, сервер — ZoneRoom.castSkill / tickSteelAuras) → огонь. Одно место для игры,
 * спектатора и лаборатории (как playDragonAct). Аура — кольцо языков пламени вокруг воина, которое ходит за ним
 * (FireFx, track), раз в секунду — пятно жара у ног и искры. Горящие враги — всплеск искр на каждом (steelBurn).
 * Режим (v) — цвет: щит — огонь, один меч (замедление) — иней, дуалы — багрянец.
 */

const KINDS = new Set<ActKind>(["steelAura", "steelBurn", "steelHit"]);

/** Цвет по режиму: 0 щит, 1 один меч (замедление), 2 дуалы. */
const MODE_COLOR = [FXC.fire, FXC.frost, FXC.fireRed];

export function playSteelAct(
  ctx: IceGiantCtx, k: ActKind, x: number, y: number, z: number, id: string,
  d?: number, _x2?: number, _z2?: number, r?: number, _mobId?: string, v?: number,
): boolean {
  if (!KINDS.has(k)) return false;
  const fire = FireFx.of(ctx.scene);
  const color = MODE_COLOR[v ?? 0] ?? FXC.fire;
  switch (k) {
    case "steelAura": {
      const dur = d ?? STEEL_AURA.duration;
      const R = r ?? 6;
      const hero = (): { x: number; y: number; z: number } | null => ctx.follow("hero", id);
      // Кольцо языков вокруг воина: держится dur с и ходит за ним.
      fire.flame(FLAME.disc, { x, y, z }, {
        r: R, inner: 0.55, dur, life: 0.8, size: 0.9, rise: 2.2, count: 40, heat: 0.95, track: hero,
      });
      // Раз в секунду — пятно жара у ног воина и россыпь искр вверх.
      const pulse = (t: number): void => {
        const p = hero();
        if (p) {
          fire.decal(FDECAL.burn, { x: p.x, y: p.y, z: p.z, r: R }, 1.1, 0.45);
          fire.burst(p.x, p.y + 0.6, p.z, color, { count: 12, speed: 3, life: 0.6, grav: -2, size: 0.2, dir: [0, 1, 0], spread: 1 });
        }
        if (t + 1 < dur) fire.after(1, () => pulse(t + 1));
      };
      pulse(0);
      break;
    }
    case "steelBurn":
      // Горящий враг: искры из его тела (к каждому тику — свежие, без накопления).
      fire.burst(x, y + 0.9, z, color, { count: 10, speed: 2.5, life: 0.6, grav: -2.5, size: 0.2, dir: [0, 1, 0], spread: 0.8 });
      break;
    case "steelHit":
      // Дуалы: доп. удар по горящему — красная вспышка на ударе.
      fire.burst(x, y + 1, z, FXC.fireRed, { count: 12, speed: 5, life: 0.4, size: 0.22, spread: 0.9 });
      break;
  }
  return true;
}
