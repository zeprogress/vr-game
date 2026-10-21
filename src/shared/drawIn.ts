/**
 * 🧲 «Стягивание» (воин, 2026-10-21): резко стягивает мобов в радиусе DRAW_IN.radius в точку, которую задаёт
 * оружие воина. Режим: 0 — щит (перед собой, все в одну кучку), 1 — один меч, вторая рука свободна (по бокам,
 * половина мобов слева, половина справа), 2 — два меча (вокруг себя кольцом). Точки — здесь, сервер и клиент
 * (визуал) читают одно и то же.
 */
export const DRAW_IN = {
  radius: 10, sec: 0.45, holdSec: 1.0, front: 4, side: 3.5, ring: 1.3, spacing: 1.1,
} as const;

export type DrawMode = 0 | 1 | 2;
export const DRAW_MODE_NAMES = ["front", "side", "ring"] as const;

/** Режим по рукам воина: щит — перед собой; два меча — вокруг; один меч (вторая рука пуста) — по бокам. */
export function drawModeOf(left: string, right: string): DrawMode {
  if (left === "shield" || right === "shield") return 0;
  if (left === "sword" && right === "sword") return 2;
  return 1;
}

/**
 * Точки стягивания для мобов (в порядке mobs). fx, fz — куда смотрит воин (взгляд (sin yaw, cos yaw)),
 * hx, hz — воин. Вправо — (fz, −fx), как в DragonFight.sideAngle.
 */
export function drawInPlan(mode: DrawMode, fx: number, fz: number, hx: number, hz: number, mobs: readonly { x: number; z: number }[]): { x: number; z: number }[] {
  const rx = fz;
  const rz = -fx;
  const D = DRAW_IN;
  return mobs.map((m, i) => {
    // Точки кружатся золотым углом — кучка не выстраивается в линию.
    const a = i * 2.4;
    if (mode === 0) {
      const rad = Math.min(D.spacing * Math.sqrt(i + 1) * 0.5, 2.2);
      return { x: hx + fx * D.front + Math.cos(a) * rad, z: hz + fz * D.front + Math.sin(a) * rad };
    }
    if (mode === 1) {
      const lat = (m.x - hx) * rx + (m.z - hz) * rz;
      const s = lat >= 0 ? 1 : -1;
      const rad = Math.min(D.spacing * Math.sqrt(i + 1) * 0.35, 1.6);
      return {
        x: hx + rx * s * D.side + fx * 0.5 + Math.cos(a) * rad,
        z: hz + rz * s * D.side + fz * 0.5 + Math.sin(a) * rad,
      };
    }
    const rad = D.ring + D.spacing * 0.3 * Math.floor(i / 8);
    return { x: hx + Math.cos(a) * rad, z: hz + Math.sin(a) * rad };
  });
}
