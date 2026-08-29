import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/tubeBuilder";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";

export interface BowParts {
  mesh: Mesh;
  /** Локальные точки: концы плеч и точка покоя тетивы (центр). */
  topTip: Vector3;
  bottomTip: Vector3;
  nockRest: Vector3;
}

/**
 * Низкополигональный лук. Начало координат — в рукояти. Плечи по оси Y,
 * лёгкий прогиб вперёд (-Z). Стрела летит в сторону -Z.
 */
export function createBow(scene: Scene): BowParts {
  const wood = new StandardMaterial("bowWood", scene);
  wood.diffuseColor = new Color3(0.36, 0.24, 0.14);
  wood.emissiveColor = new Color3(0.08, 0.05, 0.03);
  wood.specularColor = new Color3(0.1, 0.1, 0.1);

  const path: Vector3[] = [];
  const N = 8;
  for (let i = 0; i <= N; i++) {
    const f = i / N;
    const y = (f - 0.5) * 1.04;
    const z = 0.02 - 0.07 * Math.sin(f * Math.PI);
    path.push(new Vector3(0, y, z));
  }
  const limb = MeshBuilder.CreateTube(
    "bowLimb",
    { path, radius: 0.013, tessellation: 6, cap: Mesh.CAP_ALL },
    scene,
  );
  limb.material = wood;

  const grip = MeshBuilder.CreateCylinder("bowGrip", { height: 0.14, diameter: 0.045 }, scene);
  grip.material = wood;

  const bow = Mesh.MergeMeshes([limb, grip], true, true, undefined, false, false);
  if (!bow) throw new Error("не удалось собрать лук");
  bow.name = "bow";
  bow.isPickable = false;

  return {
    mesh: bow,
    topTip: new Vector3(0, 0.52, 0.02),
    bottomTip: new Vector3(0, -0.52, 0.02),
    nockRest: new Vector3(0, 0, 0.03),
  };
}
