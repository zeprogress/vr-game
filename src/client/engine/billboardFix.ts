import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Camera } from "@babylonjs/core/Cameras/camera";

/**
 * Все билборды поворачиваем к ПОЗИЦИИ камеры (BILLBOARDMODE_USE_POSITION), а не по её
 * ориентации: в Babylon по умолчанию карточка выравнивается по плоскости камеры, и в
 * VR при повороте головы все такие карточки (солнце, ореолы, плашки) вращаются вместе
 * с взглядом, хотя должны стоять на месте.
 *
 * Нюанс: в режиме USE_POSITION Babylon разворачивает локальный +Z объекта НА камеру, а
 * лицевая сторона плоскости — это −Z, поэтому картинка получается зеркальной. Лечится
 * подачей в расчёт камеры, отражённой через центр объекта (тогда на настоящую камеру
 * смотрит −Z, как у обычного билборда).
 *
 * Подмена computeWorldMatrix ставится ТОЛЬКО на сами билборд-узлы (свойством экземпляра),
 * а не на прототип: иначе обёртка платила бы за каждый вызов у всех ~1700 узлов сцены
 * (в профиле шлема это было ~1% кадра).
 */
const USE_POSITION = TransformNode.BILLBOARDMODE_USE_POSITION;
const protoCompute = TransformNode.prototype.computeWorldMatrix;

interface FakeCam {
  globalPosition: Vector3;
  real: Camera | null;
  getViewMatrix(): ReturnType<Camera["getViewMatrix"]>;
  getWorldMatrix(): ReturnType<Camera["getWorldMatrix"]>;
}
const fake: FakeCam = {
  globalPosition: new Vector3(),
  real: null,
  getViewMatrix() {
    return (this.real as Camera).getViewMatrix();
  },
  getWorldMatrix() {
    return (this.real as Camera).getWorldMatrix();
  },
};

function billboardCompute(this: TransformNode, force = false, camera: Camera | null = null) {
  const cam = camera ?? this.getScene().activeCamera;
  if (cam) {
    // _absolutePosition — с прошлого расчёта (getAbsolutePosition() тут зациклился бы).
    const p = (this as unknown as { _absolutePosition: Vector3 })._absolutePosition;
    const g = cam.globalPosition;
    fake.real = cam;
    fake.globalPosition.copyFromFloats(2 * p.x - g.x, 2 * p.y - g.y, 2 * p.z - g.z);
    return protoCompute.call(this, force, fake as unknown as Camera);
  }
  return protoCompute.call(this, force, camera);
}

const desc = Object.getOwnPropertyDescriptor(TransformNode.prototype, "billboardMode");
if (desc?.get && desc.set) {
  const set = desc.set;
  Object.defineProperty(TransformNode.prototype, "billboardMode", {
    configurable: true,
    enumerable: desc.enumerable,
    get: desc.get,
    set(this: TransformNode, v: number) {
      const on = (v & 7) !== 0;
      set.call(this, on ? v | USE_POSITION : v);
      const own = Object.prototype.hasOwnProperty.call(this, "computeWorldMatrix");
      if (on && !own) {
        (this as unknown as { computeWorldMatrix: typeof billboardCompute }).computeWorldMatrix = billboardCompute;
      } else if (!on && own) {
        delete (this as unknown as { computeWorldMatrix?: unknown }).computeWorldMatrix;
      }
    },
  });
}
