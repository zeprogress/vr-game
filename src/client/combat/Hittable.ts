import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";

/** Всё, по чему можно попасть мечом или стрелой. */
export interface Hittable {
  readonly alive: boolean;
  /** Вертикальный отрезок тела + радиус — для проверки попадания. */
  hitSegment(): { a: Vector3; b: Vector3; radius: number };
  /**
   * Принять удар. dir — направление в мире, damage — сколько HP снять,
   * contact — точка касания в мире (для раны/следа). true — засчитано.
   */
  hit(dir: Vector3, damage?: number, contact?: Vector3): boolean;
  /** Узел, к которому крепятся застрявшие стрелы (двигается вместе с целью). */
  hitNode?(): TransformNode | null;
  /** Толчок предметом в руке (не урон). dir — куда, strength — м/с. */
  shove?(dir: Vector3, strength: number): void;
  /** Центр тела в мире — для расчёта направления толчка. */
  center?(): Vector3;
}
