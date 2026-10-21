/**
 * Разворот на месте шагами (EliteMobDef.turnRate, Владыка Бездны): курс модели догоняет курс сервера не быстрее
 * turnRate, а пока моб стоит и поворачивается, играет клип разворота TurnL/TurnR с темпом «скорость разворота /
 * turnRate». В клипе стоящие стопы плывут против поворота ровно с turnRate (tools/blender/dragon_anim.py,
 * clip_turn) — в мире они стоят на месте, лапы переставляются, а не скользят по полу.
 */

const TAU = Math.PI * 2;

/** Угол в диапазон [−π, π). */
export function wrapAngle(a: number): number {
  return ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

/** Шаг курса к цели не быстрее rateRad (рад/с): новый курс и фактическая скорость разворота (рад/с, > 0 — курс растёт). */
export function turnToward(cur: number, target: number, dt: number, rateRad: number): { yaw: number; speed: number } {
  const d = wrapAngle(target - cur);
  const max = rateRad * dt;
  const step = Math.max(-max, Math.min(max, d));
  return { yaw: cur + step, speed: dt > 0 ? step / dt : 0 };
}

/**
 * Клип разворота по скорости поворота: курс растёт — разворот вправо (в Babylon курс растёт по часовой стрелке,
 * если смотреть сверху), убывает — влево. Темп клипа — доля скорости от rateRad. Почти не поворачивается — null.
 */
export function turnClip(speed: number, rateRad: number, minSpeed = 0.15): { clip: "turnl" | "turnr"; ratio: number } | null {
  if (Math.abs(speed) < minSpeed) return null;
  return { clip: speed > 0 ? "turnr" : "turnl", ratio: Math.min(1.3, Math.max(0.35, Math.abs(speed) / rateRad)) };
}
