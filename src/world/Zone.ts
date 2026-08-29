import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";

import { createTerrain } from "./Terrain";
import { createSky } from "./Sky";
import { scatterTrees, scatterGrass } from "./props";
import { Dummy } from "../combat/Dummy";
import { Mob } from "../combat/Mob";
import { MOB } from "../shared/constants";

export interface Zone {
  /** Меш «земли» — нужен WebXR как пол и raycast'ам игрока. */
  ground: Mesh;
  dummies: Dummy[];
  mobs: Mob[];
  /** Высота земли в точке (аналитическая) — для AI мобов. */
  groundHeight: (x: number, z: number) => number;
  /** Точки, где лежат меч и лук (над камнями). */
  swordHome: Vector3;
  bowHome: Vector3;
}

/**
 * Тестовая зона: рельеф, небо с облаками, деревья и трава,
 * несколько неподвижных кукол-противников.
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

  // Куклы дугой перед спавном.
  const dummies: Dummy[] = [];
  for (const [dx, dz] of [
    [-4, -6],
    [-1.5, -8],
    [1.5, -8],
    [4, -6],
  ] as const) {
    dummies.push(new Dummy(scene, new Vector3(dx, terrain.heightAt(dx, dz), dz)));
  }

  // Мобы — по кругу подальше от спавна.
  const mobs: Mob[] = [];
  for (let i = 0; i < MOB.count; i++) {
    const a = (i / MOB.count) * Math.PI * 2 + 0.4;
    const r = 22 + Math.random() * 12;
    const mx = Math.cos(a) * r;
    const mz = Math.sin(a) * r - 4;
    mobs.push(new Mob(scene, new Vector3(mx, terrain.heightAt(mx, mz), mz)));
  }

  const swordHome = new Vector3(-1.3, terrain.heightAt(-1.3, -12) + 1.1, -12);
  const bowHome = new Vector3(1.3, terrain.heightAt(1.3, -12) + 1.1, -12);

  return { ground: terrain.mesh, dummies, mobs, groundHeight: terrain.heightAt, swordHome, bowHome };
}
