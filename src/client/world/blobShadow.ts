import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

import { terrainHeight } from "#shared/terrain";
import { radialGlow } from "./Fireflies";

/** Диаметр прототипа, м. Реальный размер задаётся масштабом инстанса. */
const PROTO_SIZE = 2;
/** Непрозрачность пятна, когда объект лежит на земле. */
const ALPHA = 0.38;
/** Выше этой высоты тень уже почти не видна, м. */
const FADE_HEIGHT = 3;
/** Приподнимаем над землёй, чтобы не спорить с ней по глубине. */
const LIFT = 0.04;

/**
 * Мягкое тёмное пятно под объектом — дешёвая замена тени.
 *
 * Настоящие тени в мире не считаются (солнце движется, а на Quest лишний
 * проход глубины дорог), но без опоры прыгающий моб читается как парящий.
 * Пятно остаётся на земле, пока моб в воздухе, и по нему сразу видно высоту
 * прыжка: чем выше, тем шире и бледнее.
 *
 * Один прототип и материал на сцену, дальше — аппаратные инстансы.
 */
const protos = new WeakMap<Scene, Mesh>();

function protoFor(scene: Scene): Mesh {
  const found = protos.get(scene);
  if (found) return found;

  const mat = new StandardMaterial("blobShadowMat", scene);
  // Чёрный диск, форму даёт альфа из того же радиального пятна, что у
  // светлячков: в центре плотно, к краю сходит на нет.
  mat.diffuseColor = new Color3(0, 0, 0);
  mat.emissiveColor = new Color3(0, 0, 0);
  mat.specularColor = new Color3(0, 0, 0);
  mat.opacityTexture = radialGlow(scene);
  mat.disableLighting = true;
  mat.disableDepthWrite = true; // иначе пятна спорят друг с другом
  mat.backFaceCulling = false;
  mat.alpha = ALPHA;

  const proto = MeshBuilder.CreatePlane("blobShadowProto", { size: PROTO_SIZE }, scene);
  proto.material = mat;
  proto.rotation.x = Math.PI / 2; // плашмя на землю
  proto.isPickable = false;
  proto.renderingGroupId = 0;
  proto.isVisible = false; // рисуем только инстансы
  protos.set(scene, proto);
  return proto;
}

/** Пятно под одним объектом. Двигать через `place()`. */
export class BlobShadow {
  private readonly mesh: InstancedMesh;

  constructor(scene: Scene, name: string) {
    this.mesh = protoFor(scene).createInstance(`blobShadow_${name}`);
    this.mesh.rotation.x = Math.PI / 2; // инстанс не наследует поворот прототипа
    this.mesh.isPickable = false;
  }

  /**
   * @param x,y,z мировая точка объекта (y — его низ)
   * @param radius радиус пятна на земле, м
   */
  place(x: number, y: number, z: number, radius: number): void {
    const ground = terrainHeight(x, z);
    // Чем выше объект, тем шире и бледнее пятно — по нему и читается прыжок.
    const h = Math.max(0, y - ground);
    const t = Math.min(1, h / FADE_HEIGHT);
    const grow = 1 + t * 0.6;
    const s = ((radius * 2) / PROTO_SIZE) * grow;
    this.mesh.position.set(x, ground + LIFT, z);
    this.mesh.scaling.set(s, s, s);
    this.mesh.visibility = 1 - t * 0.75;
  }

  setEnabled(on: boolean): void {
    this.mesh.setEnabled(on);
  }

  dispose(): void {
    this.mesh.dispose();
  }
}
