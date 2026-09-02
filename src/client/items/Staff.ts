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
 * Посох — фокус для магии, а заодно слабое двуручное оружие ближнего боя.
 *
 * Собран здесь: древко процедурное (тонкий конус), кристалл — модель из пака
 * (`Crystal1`, светится эмиссивом) на верхнем конце.
 *
 * Локальные оси как у меча: посох вдоль +Y, начало координат — в НИЖНЕЙ
 * точке хвата. Древко делится на 3 равные части: нижний стык хвата в начале
 * координат (y = 0), верхний — на y ≈ 0.5. Ударный конец (кристалл) у
 * y ≈ 1.02, поэтому попадание считается тем же путём, что у меча
 * (`COMBAT.swordTipLocal`).
 */

const BOTTOM = -0.5; // низ древка
const TOP = 0.92; // верх древка (дальше — кристалл)
/** Точки хвата: нижняя в origin, верхняя на трети выше. */
export const STAFF_GRIP_LOW = 0;
export const STAFF_GRIP_HIGH = 0.5;

export function createStaff(scene: Scene, tier: WeaponTier = "base"): Mesh {
  const gold = tier === "gold";

  const wood = new StandardMaterial("staffWood", scene);
  wood.diffuseColor = gold ? new Color3(0.62, 0.5, 0.2) : new Color3(0.32, 0.21, 0.12);
  wood.emissiveColor = wood.diffuseColor.scale(0.12);
  wood.specularColor = new Color3(0.05, 0.05, 0.05);
  wood.maxSimultaneousLights = LIGHT_BUDGET;

  const grip = new StandardMaterial("staffGrip", scene);
  grip.diffuseColor = new Color3(0.13, 0.09, 0.06); // тёмная кожа обмотки
  grip.emissiveColor = new Color3(0.025, 0.018, 0.012);
  grip.specularColor = new Color3(0, 0, 0);
  grip.maxSimultaneousLights = LIGHT_BUDGET;

  const metal = new StandardMaterial("staffFerrule", scene);
  metal.diffuseColor = gold ? new Color3(0.85, 0.7, 0.3) : new Color3(0.42, 0.44, 0.5);
  metal.emissiveColor = metal.diffuseColor.scale(0.14);
  metal.specularColor = new Color3(0.7, 0.7, 0.7);
  metal.specularPower = 64;
  metal.maxSimultaneousLights = LIGHT_BUDGET;

  const shaft = MeshBuilder.CreateCylinder(
    "st_shaft",
    { height: TOP - BOTTOM, diameterBottom: 0.032, diameterTop: 0.02, tessellation: 8 },
    scene,
  );
  shaft.position.y = (BOTTOM + TOP) / 2;
  shaft.material = wood;

  const wrap = (y: number): Mesh => {
    const m = MeshBuilder.CreateCylinder(
      "st_grip",
      { height: 0.14, diameter: 0.05, tessellation: 8 }, // заметно толще древка
      scene,
    );
    m.position.y = y;
    m.material = grip;
    return m;
  };

  const ferrule = MeshBuilder.CreateCylinder(
    "st_ferrule",
    { height: 0.07, diameterBottom: 0.024, diameterTop: 0.036, tessellation: 8 },
    scene,
  );
  ferrule.position.y = BOTTOM + 0.035;
  ferrule.material = metal;

  const staff = Mesh.MergeMeshes(
    [shaft, wrap(STAFF_GRIP_LOW), wrap(STAFF_GRIP_HIGH), ferrule],
    true,
    true,
    undefined,
    false,
    true,
  );
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
    src.scaling.setAll(0.19); // нативная высота ~0.76 → ~0.14 м
    src.position.set(0, TOP + 0.05, 0);

    recolorFlat(src);
    for (const m of src.getChildMeshes(false)) {
      const mat = m.material as StandardMaterial | null;
      if (mat && "emissiveColor" in mat) {
        const glow = gold
          ? new Color3(0.9, 0.72, 0.28)
          : new Color3(0.42, 0.2, 0.88); // глубокий фиолет, не выбеливает
        mat.diffuseColor = glow.scale(0.35);
        mat.emissiveColor = glow; // светится — это магический фокус
        mat.specularColor = new Color3(0.6, 0.6, 0.7);
        mat.specularPower = 80;
        mat.maxSimultaneousLights = LIGHT_BUDGET;
      }
      m.isPickable = false;
      m.applyFog = true;
    }
  });
}
