import type { ActKind } from "#shared/net/messages";
import { STEEL_AURA } from "#shared/classes2";
import { FXC } from "./fxColors";
import { FireFx } from "./FireFx";
import { SteelAuraFx } from "./SteelAuraFx";
import type { IceGiantCtx } from "./IceGiantAct";

/**
 * 🔥 «Аура раскалённой стали» (воин, сервер — ZoneRoom.castSkill / tickSteelAuras) → огонь. Одно место для игры,
 * спектатора и лаборатории (как playDragonAct). Аура — кольцо языков пламени вокруг воина, которое ходит за ним
 * (SteelAuraFx: клинки, марево и кольцо на земле). Горящие враги — тонкий столбик искр (steelBurn).
 * Режим (v) — цвет: щит — огонь, один меч (замедление) — иней, дуалы — багрянец.
 */

const KINDS = new Set<ActKind>(["steelAura", "steelBurn"]);

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
      // Клинки, марево и кольцо на земле — свой визуал (SteelAuraFx); на старте — вспышка искр от воина.
      const dur = d ?? STEEL_AURA.duration;
      const R = r ?? 6;
      const hero = (): { x: number; y: number; z: number } | null => ctx.follow("hero", id);
      SteelAuraFx.of(ctx.scene).start(hero, R, dur, v ?? 0);
      const p = hero() ?? { x, y, z };
      fire.burst(p.x, p.y + 1.1, p.z, color, { count: 18, speed: 4, life: 0.5, grav: 0, size: 0.18, spread: 1 });
      break;
    }
    case "steelBurn":
      // Горящий враг: тонкий столбик искр вверх — «клеймо» (без накопления, к каждому тику — свежий).
      fire.burst(x, y + 0.4, z, color, { count: 6, speed: 1.6, life: 0.7, grav: -1.2, size: 0.14, dir: [0, 1, 0], spread: 0.25 });
      break;
  }
  return true;
}
