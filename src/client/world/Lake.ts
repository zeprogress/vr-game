import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/discBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

import { LAKE, MOUNTAIN } from "#shared/constants";
import { terrainHeight } from "#shared/terrain";

export interface Lake {
  tick(dt: number): void;
}

/**
 * Озеро + водопад со склона горы (см. план «озеро+горы»). Статичная
 * геометрия — один диск воды, одна лента водопада, по одному материалу на
 * каждый, `maxSimultaneousLights=1` (как весь остальной мир). Никакой
 * честной жидкости/рефлексий/`WaterMaterial` — только мягкая пульсация
 * цвета/прозрачности в `tick()`, без текстур и UV-анимации.
 */
export function createLake(scene: Scene): Lake {
  const waterMat = new StandardMaterial("lakeWaterMat", scene);
  waterMat.diffuseColor = new Color3(0.09, 0.22, 0.28);
  waterMat.emissiveColor = new Color3(0.05, 0.13, 0.17);
  waterMat.specularColor = new Color3(0.25, 0.3, 0.32);
  waterMat.specularPower = 48;
  waterMat.alpha = 0.86;
  waterMat.maxSimultaneousLights = 1;
  waterMat.backFaceCulling = false;

  const water = MeshBuilder.CreateDisc(
    "lakeWater",
    { radius: LAKE.radius, tessellation: 40 },
    scene,
  );
  water.rotation.x = Math.PI / 2;
  water.position.set(LAKE.x, LAKE.waterY, LAKE.z);
  water.material = waterMat;
  water.isPickable = false;
  water.checkCollisions = false;
  water.freezeWorldMatrix();

  // Водопад — прямая лента от склона горы до глади озера, чуть в стороне
  // ближнего берега (между LAKE и MOUNTAIN, по прямой между их центрами).
  const dx = MOUNTAIN.x - LAKE.x;
  const dz = MOUNTAIN.z - LAKE.z;
  const dl = Math.hypot(dx, dz) || 1;
  const nx = dx / dl;
  const nz = dz / dl;
  const baseX = LAKE.x + nx * (LAKE.radius - 3);
  const baseZ = LAKE.z + nz * (LAKE.radius - 3);
  const topX = baseX + nx * 9;
  const topZ = baseZ + nz * 9;
  const topY = terrainHeight(topX, topZ) + 1;
  const fallHeight = Math.max(6, topY - LAKE.waterY);

  const waterfallMat = new StandardMaterial("waterfallMat", scene);
  waterfallMat.diffuseColor = new Color3(0.7, 0.82, 0.88);
  waterfallMat.emissiveColor = new Color3(0.55, 0.68, 0.74);
  waterfallMat.specularColor = new Color3(0, 0, 0);
  waterfallMat.alpha = 0.55;
  waterfallMat.maxSimultaneousLights = 1;
  waterfallMat.backFaceCulling = false;

  const waterfall = MeshBuilder.CreatePlane(
    "waterfall",
    { width: 4.5, height: fallHeight },
    scene,
  );
  waterfall.position.set((baseX + topX) / 2, (LAKE.waterY + topY) / 2, (baseZ + topZ) / 2);
  // Лицом к озеру — навстречу (nx,nz) смотрит на гору, значит сама плоскость
  // разворачивается в обратную сторону, поэтому знак минус.
  waterfall.rotation.y = Math.atan2(-nx, -nz);
  waterfall.material = waterfallMat;
  waterfall.isPickable = false;
  waterfall.checkCollisions = false;
  waterfall.freezeWorldMatrix();

  let clock = 0;
  return {
    tick(dt: number): void {
      clock += dt;
      // Лёгкая пульсация — не UV-анимация (не пересобирает шейдер), просто
      // цвет/альфа чуть «дышат», создавая ощущение подвижной воды.
      const shimmer = 0.5 + 0.5 * Math.sin(clock * 0.6);
      waterMat.alpha = 0.82 + shimmer * 0.06;
      const flow = 0.5 + 0.5 * Math.sin(clock * 2.2);
      waterfallMat.alpha = 0.48 + flow * 0.14;
    },
  };
}
