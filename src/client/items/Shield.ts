import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/boxBuilder";

import { SHIELD } from "#shared/constants";

/**
 * Круглый щит. Плоскость щита — XZ, «наружу» смотрит локальная ось +Y
 * (та же схема, что у меча: клинок вдоль +Y).
 */
export function createShield(scene: Scene): Mesh {
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
