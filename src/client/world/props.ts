import type { Scene } from "@babylonjs/core/scene";

import { trees as treeList } from "#shared/trees";
import type { Terrain } from "./Terrain";

/** Круг ствола на плоскости — по нему игрока выталкивает наружу. */
export interface Obstacle {
  x: number;
  z: number;
  r: number;
}

/**
 * Деревья: позиции и радиусы стволов берём из общего списка (тот же лес на
 * сервере и у всех клиентов). Модели грузим лениво из `nature.ts`
 * (glTF-загрузчик тяжёлый) — коллизии готовы сразу, деревья появляются следом.
 */
export function scatterTrees(scene: Scene, terrain: Terrain, lite = false): Obstacle[] {
  void import("./nature").then((m) => m.loadTrees(scene, terrain, lite));
  return treeList().map((t) => ({ x: t.x, z: t.z, r: t.r }));
}

/**
 * Трава вокруг спавна (thin-инстансы + ветер в вершинном шейдере). Возвращает
 * тик ветра — звать каждый кадр. `density` 0..1, `daylight` 0..1.
 */
export function scatterGrass(
  scene: Scene,
  terrain: Terrain,
  density = 1,
  lite = false,
): (dt: number, daylight: number) => void {
  let tick: (dt: number, daylight: number) => void = () => {};
  void import("./nature").then(async (m) => {
    tick = await m.loadGrass(scene, terrain, density, lite);
  });
  return (dt, daylight) => tick(dt, daylight);
}
