import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";

import { createTerrain } from "./Terrain";
import { createSky } from "./Sky";
import { scatterTrees, scatterGrass } from "./props";

export interface Zone {
  /** Меш «земли» — нужен WebXR как пол и raycast'ам игрока. */
  ground: Mesh;
  /** Высота земли в точке (аналитическая). */
  groundHeight: (x: number, z: number) => number;
  /** Точки, где лежат меч, лук и щит (над камнями). */
  swordHome: Vector3;
  bowHome: Vector3;
  shieldHome: Vector3;
}

/**
 * Тестовая зона: рельеф, небо с облаками, деревья и трава.
 * Мобы и куклы живут на сервере (этап 6) — их создаёт NetMobs.
 */
export function buildZone(scene: Scene): Zone {
  const sunDir = new Vector3(-0.5, -0.9, -0.35).normalize();

  new HemisphericLight("ambient", new Vector3(0, 1, 0), scene).intensity = 0.55;
  const sun = new DirectionalLight("sun", sunDir, scene);
  sun.position = sunDir.scale(-60);
  sun.intensity = 1.1;
  sun.diffuse = new Color3(1, 0.96, 0.86);

  createSky(scene, sunDir);

  const terrain = createTerrain(scene);
  scatterTrees(scene, terrain);
  scatterGrass(scene, terrain);

  const swordHome = new Vector3(-1.3, terrain.heightAt(-1.3, -12) + 1.1, -12);
  const bowHome = new Vector3(1.3, terrain.heightAt(1.3, -12) + 1.1, -12);
  const shieldHome = new Vector3(-3.4, terrain.heightAt(-3.4, -12) + 1.0, -12);

  return {
    ground: terrain.mesh,
    groundHeight: terrain.heightAt,
    swordHome,
    bowHome,
    shieldHome,
  };
}
