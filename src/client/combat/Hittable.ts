import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { WeaponKind } from "#shared/combat";

/** Всё, по чему можно попасть мечом или стрелой. */
export interface Hittable {
  readonly alive: boolean;
  /** Вертикальный отрезок тела + радиус — для проверки попадания. */
  hitSegment(): { a: Vector3; b: Vector3; radius: number };
  /**
   * Заявить удар. dir — направление в мире, weapon — чем ударили,
   * contact — точка касания (для раны/следа). true — заявка отправлена.
   * Урон считает сервер: клиент только сообщает о попадании.
   */
  hit(dir: Vector3, weapon: WeaponKind, contact?: Vector3): boolean;
  /** Узел, к которому крепятся застрявшие стрелы (двигается вместе с целью). */
  hitNode?(): TransformNode | null;
  /** Толчок предметом в руке (не урон). dir — куда, strength — м/с. */
  shove?(dir: Vector3, strength: number): void;
  /** Центр тела в мире — для расчёта направления толчка. */
  center?(): Vector3;
}

/** Что за цель — для отправки попадания на сервер (этап 6, PvP — этап 10). */
export type HitTargetKind = "mob" | "dummy" | "player";

/**
 * Сообщить серверу о попадании: id цели, тип цели, вид оружия и
 * горизонтальное направление удара. Урон и досягаемость решает сервер.
 */
export type HitReporter = (
  id: string,
  target: HitTargetKind,
  weapon: WeaponKind,
  dx: number,
  dz: number,
) => void;
