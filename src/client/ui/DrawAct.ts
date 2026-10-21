import { DRAW_IN } from "#shared/drawIn";
import type { ActKind } from "#shared/net/messages";
import { FXC } from "./fxColors";
import { FDECAL, FireFx } from "./FireFx";
import { DrawFx } from "./DrawFx";
import type { IceGiantCtx } from "./IceGiantAct";

/**
 * 🧲 «Стягивание» воина (сервер — ZoneRoom.castSkill case "drawIn") → визуал и звук. Одно место для игры,
 * спектатора и лаборатории (как playSteelAct). Старт — сжимающееся кольцо на радиус 10 м и звон сбора;
 * каждый моб — полоска-хвост по прямой к своей точке; приход — удар о землю: волна, искры, звук.
 * Режим (v): 0 щит (перед собой), 1 меч (по бокам), 2 дуалы (вокруг).
 */

const KINDS = new Set<ActKind>(["drawIn", "drawPull", "drawImpact"]);
/** Звук полёта — не чаще раза в 150 мс: группа мобов даёт один шорох, а не десяток. */
let lastPullSound = -1;

export function playDrawAct(
  ctx: IceGiantCtx, k: ActKind, x: number, y: number, z: number, _id: string,
  d?: number, x2?: number, z2?: number, r?: number, _mobId?: string, v?: number,
): boolean {
  if (!KINDS.has(k)) return false;
  const draw = DrawFx.of(ctx.scene);
  const fire = FireFx.of(ctx.scene);
  const sfx = ctx.sfx;
  const at = { x, y, z };
  switch (k) {
    case "drawIn":
      draw.implode(x, y, z, r ?? DRAW_IN.radius, d ?? DRAW_IN.sec);
      sfx.at(at, () => sfx.draw("start", 0.9, 0.04));
      break;
    case "drawPull": {
      // Моб летит к точке: полоска и искры по его ходу (цвет — сталь, у дуалов — красный край).
      const ty = ctx.ground(x2 ?? x, z2 ?? z) + 1.1;
      const to = { x: x2 ?? x, y: ty, z: z2 ?? z };
      draw.streak({ x, y, z }, to, d ?? DRAW_IN.sec);
      const dx = to.x - x;
      const dz = to.z - z;
      fire.burst(x, y, z, v === 2 ? FXC.steelHot : FXC.steel, {
        count: 6, speed: 3, life: 0.4, size: 0.16, dir: [dx, 0.2, dz], spread: 0.2,
      });
      const now = performance.now();
      if (now - lastPullSound > 150) {
        lastPullSound = now;
        sfx.at({ x, y, z }, () => sfx.draw("pull", 0.5, 0.08));
      }
      break;
    }
    case "drawImpact":
      // Мобы сбились в кучку: удар о землю — кольцо, искры и звон.
      fire.decal(FDECAL.wave, { x, y, z, r: 1.6 }, 0.4, 0.8);
      fire.burst(x, y + 0.5, z, FXC.steel, { count: 16, speed: 5, life: 0.5, grav: 8, size: 0.2, dir: [0, 1, 0], spread: 0.8 });
      fire.burst(x, y + 0.4, z, v === 2 ? FXC.steelHot : FXC.steel, { count: 10, speed: 2.5, life: 0.6, size: 0.18 });
      sfx.at(at, () => sfx.draw("impact", 0.9, 0.05));
      break;
  }
  return true;
}
