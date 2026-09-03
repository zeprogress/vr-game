import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

import { terrainHeight } from "#shared/terrain";

/** Диаметр прототипа, м. Реальный размер задаётся масштабом инстанса. */
const PROTO_SIZE = 2;
/** Непрозрачность пятна, когда объект лежит на земле. */
const ALPHA = 0.42;
/** Выше этой высоты тень уже почти не видна, м. */
const FADE_HEIGHT = 3;
/** Приподнимаем над землёй, чтобы не спорить с ней по глубине. */
const LIFT = 0.07;
/** Плечо для замера уклона земли, м. */
const SLOPE_D = 0.6;

/**
 * Мягкое тёмное пятно под объектом — дешёвая замена тени.
 *
 * Настоящие тени в мире не считаются (солнце движется, а на Quest лишний
 * проход глубины дорог), но без опоры прыгающий моб читается как парящий.
 * Пятно остаётся на земле, пока моб в воздухе, и по нему сразу видно высоту
 * прыжка: чем выше, тем шире и бледнее.
 *
 * Диск НАКЛОНЯЕТСЯ по нормали рельефа. Плоский он резался о склон, и от
 * круга оставалась половина — под землёй его отсекало по глубине.
 *
 * Один прототип и материал на сцену, дальше — аппаратные инстансы.
 */
const protos = new WeakMap<Scene, Mesh>();

/**
 * Пятно с плотной серединой: у светлячков спад `pow(1-r, 2.4)` — он даёт
 * ореол, а не тень, и середина выходит жидкой. Здесь держим почти
 * непрозрачно до 55% радиуса и мягко сводим к краю.
 */
function shadowTexture(scene: Scene): DynamicTexture {
  const S = 128;
  const tex = new DynamicTexture("blobShadowTex", { width: S, height: S }, scene, false);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  const STOPS = 20;
  for (let i = 0; i <= STOPS; i++) {
    const r = i / STOPS;
    const t = Math.max(0, (r - 0.55) / 0.45); // до 55% — плотно
    const a = 1 - t * t * (3 - 2 * t);
    g.addColorStop(r, `rgba(0,0,0,${a.toFixed(4)})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  tex.update(true);
  return tex;
}

function protoFor(scene: Scene): Mesh {
  const found = protos.get(scene);
  if (found) return found;

  const mat = new StandardMaterial("blobShadowMat", scene);
  mat.diffuseColor = new Color3(0, 0, 0);
  mat.emissiveColor = new Color3(0, 0, 0);
  mat.specularColor = new Color3(0, 0, 0);
  mat.opacityTexture = shadowTexture(scene);
  mat.disableLighting = true;
  mat.disableDepthWrite = true; // иначе пятна спорят друг с другом
  mat.backFaceCulling = false; // наклон может повернуть диск изнанкой
  mat.alpha = ALPHA;

  const proto = MeshBuilder.CreatePlane("blobShadowProto", { size: PROTO_SIZE }, scene);
  proto.material = mat;
  proto.isPickable = false;
  proto.renderingGroupId = 0;
  proto.isVisible = false; // рисуем только инстансы
  protos.set(scene, proto);
  return proto;
}

const _n = new Vector3();
const _t = new Vector3();
const _b = new Vector3();
const _fwd = new Vector3(0, 0, 1);

/** Пятно под одним объектом. Двигать через `place()`. */
export class BlobShadow {
  private readonly mesh: InstancedMesh;

  constructor(scene: Scene, name: string) {
    this.mesh = protoFor(scene).createInstance(`blobShadow_${name}`);
    this.mesh.isPickable = false;
  }

  /**
   * @param x,y,z мировая точка объекта (y — его низ)
   * @param radius радиус пятна на земле, м
   */
  place(x: number, y: number, z: number, radius: number): void {
    const ground = terrainHeight(x, z);

    // Нормаль рельефа: по ней кладём диск, иначе он режется о склон.
    const dhdx = (terrainHeight(x + SLOPE_D, z) - terrainHeight(x - SLOPE_D, z)) / (2 * SLOPE_D);
    const dhdz = (terrainHeight(x, z + SLOPE_D) - terrainHeight(x, z - SLOPE_D)) / (2 * SLOPE_D);
    _n.set(-dhdx, 1, -dhdz).normalize();
    // Локальная Z плоскости должна смотреть по нормали. Базис строим от
    // мировой Z: при почти вертикальной нормали он не вырождается.
    Vector3.CrossToRef(_n, _fwd, _t);
    if (_t.lengthSquared() < 1e-6) _t.set(1, 0, 0);
    _t.normalize();
    Vector3.CrossToRef(_n, _t, _b);
    Vector3.RotationFromAxisToRef(_t, _b, _n, this.mesh.rotation);

    // Чем выше объект, тем шире и бледнее пятно — по нему и читается прыжок.
    const h = Math.max(0, y - ground);
    const k = Math.min(1, h / FADE_HEIGHT);
    const s = ((radius * 2) / PROTO_SIZE) * (1 + k * 0.6);
    this.mesh.position.set(x, ground + LIFT, z);
    this.mesh.scaling.set(s, s, s);
    this.mesh.visibility = 1 - k * 0.75;
  }

  setEnabled(on: boolean): void {
    this.mesh.setEnabled(on);
  }

  dispose(): void {
    this.mesh.dispose();
  }
}
