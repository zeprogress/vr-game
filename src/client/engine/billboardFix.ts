import { TransformNode } from "@babylonjs/core/Meshes/transformNode";

/**
 * Все билборды в игре поворачиваем к ПОЗИЦИИ камеры (BILLBOARDMODE_USE_POSITION),
 * а не по её ориентации: в Babylon по умолчанию карточка выравнивается по
 * плоскости камеры, и в VR при повороте головы все такие карточки (солнце,
 * ореолы, плашки) вращаются вместе с взглядом, хотя должны стоять на месте.
 */
const desc = Object.getOwnPropertyDescriptor(TransformNode.prototype, "billboardMode");
if (desc?.get && desc.set) {
  const set = desc.set;
  Object.defineProperty(TransformNode.prototype, "billboardMode", {
    configurable: true,
    enumerable: desc.enumerable,
    get: desc.get,
    set(this: TransformNode, v: number) {
      const on = (v & 7) !== 0;
      set.call(this, on ? v | TransformNode.BILLBOARDMODE_USE_POSITION : v);
      // В режиме USE_POSITION Babylon разворачивает локальный +Z на камеру, и лицевая
      // сторона плоскости (−Z) смотрит от зрителя — картинка зеркальная (и режется
      // backface culling). Разворот на 180° по Y до билборда это чинит.
      if (on && !this.rotationQuaternion) this.rotation.y = Math.PI;
    },
  });
}
