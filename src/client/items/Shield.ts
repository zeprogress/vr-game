import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/boxBuilder";

import { SHIELD } from "#shared/constants";
import { weaponDef, type WeaponTier } from "#shared/items";
import "@babylonjs/core/Meshes/Builders/polygonBuilder";

/**
 * Щит. Плоскость щита — XZ, «наружу» смотрит локальная ось +Y
 * (та же схема, что у меча: клинок вдоль +Y).
 *
 * base — круглый деревянный, gold — вытянутый треугольник («капля»),
 * какими бывают кавалерийские щиты. Держатся одинаково: положение в руке
 * настраивается один раз на класс.
 */
export function createShield(scene: Scene, tier: WeaponTier = "base"): Mesh {
  if (tier !== "base") return createTriangleShield(scene, tier);
  const wood = new StandardMaterial("shieldWood", scene);
  wood.diffuseColor = new Color3(0.42, 0.26, 0.15);
  wood.emissiveColor = new Color3(0.1, 0.06, 0.04);
  wood.specularColor = new Color3(0.1, 0.1, 0.1);

  const iron = new StandardMaterial("shieldIron", scene);
  iron.diffuseColor = new Color3(0.62, 0.65, 0.7);
  iron.emissiveColor = new Color3(0.16, 0.17, 0.2);
  iron.specularColor = new Color3(0.7, 0.7, 0.7);
  iron.specularPower = 48;

  const r = SHIELD.radius;

  const body = MeshBuilder.CreateCylinder(
    "sh_body",
    { height: 0.035, diameter: r * 2, tessellation: 16 },
    scene,
  );
  body.material = wood;

  const rim = MeshBuilder.CreateCylinder(
    "sh_rim",
    { height: 0.05, diameter: r * 2.06, tessellation: 16 },
    scene,
  );
  rim.material = iron;
  rim.scaling.y = 0.6;

  const boss = MeshBuilder.CreateSphere("sh_boss", { diameter: r * 0.55, segments: 8 }, scene);
  boss.position.y = 0.03;
  boss.scaling.y = 0.55;
  boss.material = iron;

  const grip = MeshBuilder.CreateBox("sh_grip", { width: 0.12, height: 0.03, depth: 0.03 }, scene);
  grip.position.y = -0.05;
  grip.material = wood;

  const shield = Mesh.MergeMeshes([body, rim, boss, grip], true, true, undefined, false, true);
  if (!shield) throw new Error("не удалось собрать щит");
  shield.name = "shield";
  return shield;
}

/**
 * Вытянутый треугольный щит: широкий верх, острый низ. Собран из трёх
 * плоских «долей», чтобы не тянуть построитель полигонов.
 */
function createTriangleShield(scene: Scene, tier: WeaponTier): Mesh {
  const tint = weaponDef("shield", tier).tint;

  const face = new StandardMaterial("shieldFace", scene);
  face.diffuseColor = new Color3(tint[0], tint[1], tint[2]);
  face.emissiveColor = new Color3(tint[0] * 0.22, tint[1] * 0.2, tint[2] * 0.1);
  face.specularColor = new Color3(0.85, 0.8, 0.5);
  face.specularPower = 64;

  const dark = new StandardMaterial("shieldFaceDark", scene);
  dark.diffuseColor = new Color3(tint[0] * 0.5, tint[1] * 0.45, tint[2] * 0.3);
  dark.specularColor = new Color3(0.3, 0.3, 0.2);

  const w = SHIELD.radius * 2; // ширина вверху
  const h = SHIELD.radius * 3.1; // высота: заметно вытянут

  // Треугольник набираем полосами убывающей ширины — верх широкий, низ острый.
  const parts: Mesh[] = [];
  const bands = 7;
  for (let i = 0; i < bands; i++) {
    const f = i / bands;
    const next = (i + 1) / bands;
    const bw = w * (1 - f) || 0.01;
    const band = MeshBuilder.CreateBox(
      `sh_band${i}`,
      { width: bw, height: 0.03, depth: (h * (next - f)) / 1 },
      scene,
    );
    band.position.z = h * 0.5 - h * (f + (next - f) / 2);
    band.material = face;
    parts.push(band);
  }

  const spine = MeshBuilder.CreateBox("sh_spine", { width: 0.035, height: 0.05, depth: h * 0.96 }, scene);
  spine.position.y = 0.02;
  spine.material = dark;
  parts.push(spine);

  const grip = MeshBuilder.CreateBox("sh_grip", { width: 0.12, height: 0.03, depth: 0.03 }, scene);
  grip.position.y = -0.05;
  grip.material = dark;
  parts.push(grip);

  const shield = Mesh.MergeMeshes(parts, true, true, undefined, false, true);
  if (!shield) throw new Error("не удалось собрать треугольный щит");
  shield.name = "shield";
  return shield;
}
