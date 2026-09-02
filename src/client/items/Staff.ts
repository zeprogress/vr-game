import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Quaternion } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { type WeaponTier } from "#shared/items";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";

import { containerFor, recolorFlat } from "../world/models";
import { LIGHT_BUDGET } from "../world/Fireflies";

/**
 * Посох — фокус для магии и слабое двуручное оружие ближнего боя.
 *
 * Древко процедурное, кристалл — модель из пака (`Crystal1`), светится.
 * Оси как у меча: посох вдоль +Y, начало координат — в НИЖНЕЙ точке хвата.
 * Три равные трети; профиль конический: тонкий низ → толстый верх у камня.
 *
 *   y=BOTTOM ─ железный шип
 *   y=0      ─ НИЖНИЙ хват (origin)
 *   y=0.5    ─ ВЕРХНИЙ хват (за него берут в бою и в двуручном хвате)
 *   y≈1.02   ─ кристалл (ударный конец; здесь же копится заряд)
 */

const BOTTOM = -0.5;
const TOP = 0.9;
/** Точки хвата вдоль +Y. */
export const STAFF_GRIP_LOW = 0;
export const STAFF_GRIP_HIGH = 0.5;
/** Локальная точка кристалла — от неё летит снаряд, к ней тянут заряд. */
export const STAFF_CRYSTAL_LOCAL: readonly [number, number, number] = [0, 1.05, 0];

export function createStaff(scene: Scene, tier: WeaponTier = "base"): Mesh {
  const gold = tier === "gold";

  const wood = new StandardMaterial("staffWood", scene);
  wood.diffuseColor = gold ? new Color3(0.62, 0.5, 0.2) : new Color3(0.3, 0.2, 0.12);
  wood.emissiveColor = wood.diffuseColor.scale(0.12);
  wood.specularColor = new Color3(0.05, 0.05, 0.05);
  wood.maxSimultaneousLights = LIGHT_BUDGET;

  // Обмотки — белая ткань, заподлицо с древком (без утолщения).
  const cloth = new StandardMaterial("staffGrip", scene);
  cloth.diffuseColor = new Color3(0.86, 0.86, 0.82);
  cloth.emissiveColor = new Color3(0.14, 0.14, 0.13);
  cloth.specularColor = new Color3(0, 0, 0);
  cloth.maxSimultaneousLights = LIGHT_BUDGET;

  const metal = new StandardMaterial("staffFerrule", scene);
  metal.diffuseColor = gold ? new Color3(0.85, 0.7, 0.3) : new Color3(0.4, 0.42, 0.48);
  metal.emissiveColor = metal.diffuseColor.scale(0.12);
  metal.specularColor = new Color3(0.75, 0.75, 0.8);
  metal.specularPower = 80;
  metal.maxSimultaneousLights = LIGHT_BUDGET;

  const parts: Mesh[] = [];

  // Древко тремя коническими сегментами: низ тонкий, верх у камня толстый.
  const seg = (name: string, y0: number, y1: number, d0: number, d1: number): void => {
    const m = MeshBuilder.CreateCylinder(
      name,
      { height: y1 - y0, diameterBottom: d0, diameterTop: d1, tessellation: 10 },
      scene,
    );
    m.position.y = (y0 + y1) / 2;
    m.material = wood;
    parts.push(m);
  };
  seg("st_low", BOTTOM, STAFF_GRIP_LOW, 0.022, 0.036); // нижний хват → конец: утоньшение
  seg("st_mid", STAFF_GRIP_LOW, STAFF_GRIP_HIGH, 0.036, 0.046);
  seg("st_high", STAFF_GRIP_HIGH, TOP, 0.046, 0.062); // верхний хват → камень: утолщение

  // Навершие вплотную к камню.
  const collar = MeshBuilder.CreateCylinder(
    "st_collar",
    { height: 0.12, diameterBottom: 0.064, diameterTop: 0.08, tessellation: 10 },
    scene,
  );
  collar.position.y = TOP + 0.05;
  collar.material = wood;
  parts.push(collar);

  // Тканевые обмотки — диаметр как у древка в этих местах, чуть выпуклые.
  const wrap = (y: number, dia: number): void => {
    const m = MeshBuilder.CreateCylinder(
      "st_grip",
      { height: 0.13, diameter: dia + 0.004, tessellation: 10 },
      scene,
    );
    m.position.y = y;
    m.material = cloth;
    parts.push(m);
  };
  wrap(STAFF_GRIP_LOW, 0.036);
  wrap(STAFF_GRIP_HIGH, 0.046);

  // Железный шип на нижнем конце: сходится в остриё, сидит на тонком низе древка.
  const spike = MeshBuilder.CreateCylinder(
    "st_spike",
    { height: 0.12, diameterTop: 0.03, diameterBottom: 0.006, tessellation: 10 },
    scene,
  );
  spike.position.y = BOTTOM - 0.05;
  spike.material = metal;
  parts.push(spike);
  // Кольцо-муфта, где шип крепится к древку.
  const collarLo = MeshBuilder.CreateCylinder(
    "st_muff",
    { height: 0.035, diameter: 0.034, tessellation: 10 },
    scene,
  );
  collarLo.position.y = BOTTOM + 0.005;
  collarLo.material = metal;
  parts.push(collarLo);

  const staff = Mesh.MergeMeshes(parts, true, true, undefined, false, true);
  if (!staff) throw new Error("не удалось собрать посох");
  staff.name = "staff";

  attachGem(scene, staff, gold);
  return staff;
}

/** Кристалл на верхушке — грузится асинхронно и подвешивается на посох. */
function attachGem(scene: Scene, staff: Mesh, gold: boolean): void {
  void containerFor(scene, "/models/weapons/crystal.glb").then((c) => {
    if (staff.isDisposed()) return;
    const inst = c.instantiateModelsToScene((n) => n, false);
    const src = inst.rootNodes[0] as TransformNode | undefined;
    if (!src) return;
    src.parent = staff;
    src.rotationQuaternion = Quaternion.RotationYawPitchRoll(0.25, 0, 0);
    src.scaling.setAll(0.19);
    src.position.set(0, TOP + 0.13, 0);

    recolorFlat(src);
    for (const m of src.getChildMeshes(false)) {
      const mat = m.material as StandardMaterial | null;
      if (mat && "emissiveColor" in mat) {
        const glow = gold
          ? new Color3(0.9, 0.78, 0.38)
          : new Color3(0.78, 0.8, 0.9); // белый светящийся камень
        mat.diffuseColor = glow.scale(0.6);
        mat.emissiveColor = glow;
        mat.specularColor = new Color3(0.7, 0.7, 0.8);
        mat.specularPower = 90;
        mat.maxSimultaneousLights = LIGHT_BUDGET;
      }
      m.isPickable = false;
      m.applyFog = true;
    }
  });
}
