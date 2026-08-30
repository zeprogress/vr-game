import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { weaponDef, type WeaponTier } from "#shared/items";
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
export function createBow(scene: Scene, tier: WeaponTier = "base"): BowParts {
  const tint = weaponDef("bow", tier).tint;
  const wood = new StandardMaterial("bowWood", scene);
  wood.diffuseColor = new Color3(tint[0] * 0.65, tint[1] * 0.62, tint[2] * 0.6);
  wood.emissiveColor = new Color3(tint[0] * 0.18, tint[1] * 0.16, tint[2] * 0.1);
  wood.specularColor = new Color3(tier === "base" ? 0.1 : 0.8, 0.1, 0.1);

  // Один цельный изгиб дуги — без отдельной рукояти. Чуть длиннее прежнего.
  const HALF = 0.68; // м, половина длины дуги
  const path: Vector3[] = [];
  const N = 14;
  for (let i = 0; i <= N; i++) {
    const f = i / N;
    const y = (f - 0.5) * (HALF * 2);
    const z = 0.02 - 0.08 * Math.sin(f * Math.PI);
    // К концам дуга тоньше — «плечи».
    path.push(new Vector3(0, y, z));
  }
  const limb = MeshBuilder.CreateTube(
    "bowLimb",
    {
      path,
      radiusFunction: (i) => 0.016 - 0.008 * Math.abs(i / N - 0.5) * 2,
      tessellation: 6,
      cap: Mesh.CAP_ALL,
    },
    scene,
  );
  limb.material = wood;

  const bow = Mesh.MergeMeshes([limb], true, true, undefined, false, false) ?? limb;
  bow.name = "bow";
  bow.isPickable = false;

  return {
    mesh: bow,
    topTip: new Vector3(0, HALF, 0.02),
    bottomTip: new Vector3(0, -HALF, 0.02),
    nockRest: new Vector3(0, 0, 0.03),
  };
}
