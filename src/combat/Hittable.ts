import type { Vector3 } from "@babylonjs/core/Maths/math.vector";

/** Всё, по чему можно попасть мечом или стрелой. */
export interface Hittable {
  readonly alive: boolean;
  /** Вертикальный отрезок тела + радиус — для проверки попадания. */
  hitSegment(): { a: Vector3; b: Vector3; radius: number };
  /** Принять удар. dir — направление в мире, damage — сколько HP снять. true — засчитано. */
  hit(dir: Vector3, damage?: number): boolean;
}
