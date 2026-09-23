import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/discBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";

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

  // Диск воды кроет ВЕСЬ радиус вместе с прибрежной отмелью (см. terrain.ts:
  // дно там строго ровное floorY на всём этом круге) — иначе между кромкой
  // воды и настоящим подъёмом берега виден провал голой земли.
  const shoreOuter = LAKE.radius + LAKE.shoreFade;
  const water = MeshBuilder.CreateDisc(
    "lakeWater",
    { radius: shoreOuter, tessellation: 48 },
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
  const baseX = LAKE.x + nx * (shoreOuter - 3);
  const baseZ = LAKE.z + nz * (shoreOuter - 3);
  const topX = baseX + nx * 9;
  const topZ = baseZ + nz * 9;
  const topY = terrainHeight(topX, topZ) + 1;
  const fallHeight = Math.max(6, topY - LAKE.waterY);

  const waterfallMat = new StandardMaterial("waterfallMat", scene);
  waterfallMat.diffuseColor = new Color3(0.72, 0.84, 0.9);
  waterfallMat.emissiveColor = new Color3(0.56, 0.69, 0.76);
  waterfallMat.specularColor = new Color3(0, 0, 0);
  waterfallMat.alpha = 0.55;
  waterfallMat.maxSimultaneousLights = 1;
  waterfallMat.backFaceCulling = false;

  const faceYaw = Math.atan2(-nx, -nz); // лицом к озеру (см. ниже)
  const midX = (baseX + topX) / 2;
  const midY = (LAKE.waterY + topY) / 2;
  const midZ = (baseZ + topZ) / 2;
  // Не одна ровная лента, а 3 неровные полосы вразнобой по ширине/сдвигу —
  // читается как рассыпающийся поток, а не гладкая плитка.
  const strips: Mesh[] = [];
  const STRIP_N = 3;
  for (let i = 0; i < STRIP_N; i++) {
    const w = 1.6 + Math.random() * 1.6;
    const strip = MeshBuilder.CreatePlane(
      `waterfallStrip${i}`,
      { width: w, height: fallHeight * (0.88 + Math.random() * 0.12) },
      scene,
    );
    const along = (i - (STRIP_N - 1) / 2) * 1.6; // сдвиг поперёк потока
    const forward = (Math.random() - 0.5) * 0.6; // лёгкая «глубина» — не в одну плоскость
    strip.position.set(
      midX + Math.cos(faceYaw) * along + Math.sin(faceYaw) * forward,
      midY,
      midZ - Math.sin(faceYaw) * along + Math.cos(faceYaw) * forward,
    );
    strip.rotation.y = faceYaw + (Math.random() - 0.5) * 0.08;
    strip.material = waterfallMat;
    strip.isPickable = false;
    strip.checkCollisions = false;
    strip.freezeWorldMatrix();
    strips.push(strip);
  }

  // Пена у подножия — мягкое светлое пятно на глади озера в месте падения.
  const foamMat = new StandardMaterial("waterfallFoamMat", scene);
  foamMat.diffuseColor = new Color3(0, 0, 0);
  foamMat.specularColor = new Color3(0, 0, 0);
  foamMat.emissiveColor = new Color3(0.78, 0.86, 0.9);
  foamMat.alpha = 0.6;
  foamMat.disableLighting = true;
  foamMat.backFaceCulling = false;
  const foam = MeshBuilder.CreateDisc("waterfallFoam", { radius: 3.6, tessellation: 20 }, scene);
  foam.rotation.x = Math.PI / 2;
  foam.position.set(baseX, LAKE.waterY + 0.03, baseZ);
  foam.material = foamMat;
  foam.isPickable = false;
  foam.checkCollisions = false;
  foam.freezeWorldMatrix();

  // Лёгкая дымка-брызги над пеной — несколько полупрозрачных сфер, как
  // облака в Sky.ts (низкополигональные, один меш, без частиц).
  const mistMat = new StandardMaterial("waterfallMistMat", scene);
  mistMat.diffuseColor = new Color3(1, 1, 1);
  mistMat.emissiveColor = new Color3(0.8, 0.86, 0.9);
  mistMat.specularColor = new Color3(0, 0, 0);
  mistMat.alpha = 0.22;
  mistMat.disableLighting = true;
  mistMat.disableDepthWrite = true;
  mistMat.backFaceCulling = false;
  const puffs: Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const puff = MeshBuilder.CreateSphere(`waterfallMist${i}`, { diameter: 1, segments: 5 }, scene);
    const sc = 1.4 + Math.random() * 1.3;
    puff.scaling.set(sc, sc * 0.6, sc);
    puff.position.set(
      baseX + (Math.random() - 0.5) * 3,
      LAKE.waterY + 0.6 + Math.random() * 1.4,
      baseZ + (Math.random() - 0.5) * 3,
    );
    puffs.push(puff);
  }
  const mist = Mesh.MergeMeshes(puffs, true, true) as Mesh;
  mist.material = mistMat;
  mist.isPickable = false;
  mist.checkCollisions = false;
  mist.freezeWorldMatrix();

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
      const foamPulse = 0.5 + 0.5 * Math.sin(clock * 1.7 + 1.1);
      foamMat.alpha = 0.5 + foamPulse * 0.18;
      const mistPulse = 0.5 + 0.5 * Math.sin(clock * 0.9 + 2.2);
      mistMat.alpha = 0.16 + mistPulse * 0.1;
    },
  };
}
