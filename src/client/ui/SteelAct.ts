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

const KINDS = new Set<ActKind>(["steelAura", "steelBurn"]);

/** Цвет по режиму: 0 щит, 1 один меч (замедление), 2 дуалы. */
const MODE_COLOR = [FXC.fire, FXC.frost, FXC.fireRed];
/** Высота пояса воина, м — куда поднимается «воздушная» часть ауры (над кольцом у ног). */
const AIR_Y = 2.4;

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
      // Кольцо языков у ног воина и второе, выше — в воздухе вокруг пояса; держатся dur с и ходят за ним.
      const airAt = (): { x: number; y: number; z: number } | null => {
        const p = hero();
        return p ? { x: p.x, y: p.y + AIR_Y, z: p.z } : null;
      };
      fire.flame(FLAME.disc, { x, y, z }, {
        r: R, inner: 0.55, dur, life: 0.8, size: 0.9, rise: 2.2, count: 40, heat: 0.95, track: hero,
      });
      fire.flame(FLAME.disc, { x, y: y + AIR_Y, z }, {
        r: R * 0.9, inner: 0.35, dur, life: 1.3, size: 0.85, rise: 1.0, count: 44, heat: 0.85, track: airAt,
      });
      // Кольцо у ног — один знак, который каждый кадр идёт за воином (без рывков по секундам).
      fire.decal(FDECAL.burn, { x, y, z, r: R, track: hero }, dur, 0.55);
      // Раз в секунду — россыпь искр от воина вверх.
      const pulse = (t: number): void => {
        const p = hero();
        if (p) fire.burst(p.x, p.y + 0.6, p.z, color, { count: 14, speed: 3, life: 0.7, grav: -2, size: 0.22, dir: [0, 1, 0], spread: 1 });
        if (t + 1 < dur) fire.after(1, () => pulse(t + 1));
      };
      pulse(0);
      // В воздухе: искры кружат на высоте 1–3 м по кольцу и тянутся вверх (каждые 0.3 с, без сети).
      const air = (t: number): void => {
        const p = hero();
        if (p) {
          for (let i = 0; i < 3; i++) {
            const a = Math.random() * Math.PI * 2;
            const rr = R * (0.6 + 0.35 * Math.random());
            fire.burst(p.x + Math.cos(a) * rr, p.y + 1 + Math.random() * 2, p.z + Math.sin(a) * rr, color, {
              count: 7, speed: 1.2, life: 1.0, grav: -1.2, size: 0.22, dir: [0, 1, 0], spread: 0.35,
            });
          }
        }
        if (t + 0.3 < dur) fire.after(0.3, () => air(t + 0.3));
      };
      air(0);
      break;
    }
    case "steelBurn":
      // Горящий враг: искры из его тела (к каждому тику — свежие, без накопления).
      fire.burst(x, y + 0.9, z, color, { count: 10, speed: 2.5, life: 0.6, grav: -2.5, size: 0.2, dir: [0, 1, 0], spread: 0.8 });
      break;
  }
  return true;
}
