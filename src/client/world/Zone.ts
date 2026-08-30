import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";

import { createTerrain } from "./Terrain";
import { createSky } from "./Sky";
import { scatterTrees, scatterGrass } from "./props";
import { dayState } from "./DayTime";
import { LOADOUT } from "../config/loadout";

export interface Zone {
  /** Меш «земли» — нужен WebXR как пол и raycast'ам игрока. */
  ground: Mesh;
  /** Высота земли в точке (аналитическая). */
  groundHeight: (x: number, z: number) => number;
  /** Двигает ветер в траве. Звать каждый кадр. */
  tick: (dt: number) => void;
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
  let hour = LOADOUT.world.hour;
  let day = dayState(hour);

  const ambient = new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
  const sun = new DirectionalLight("sun", day.sunDir, scene);

  const sky = createSky(scene, day);

  /** Разложить состояние часа по свету и небу. */
  const applyDay = (): void => {
    sun.direction.copyFrom(day.sunDir);
    sun.position = day.sunDir.scale(-60);
    sun.intensity = day.sunIntensity;
    sun.diffuse.copyFrom(day.sunColor);
    ambient.intensity = day.ambientIntensity;
    ambient.diffuse.copyFrom(day.ambientColor);
    sky.apply(day);
  };
  applyDay();

  const terrain = createTerrain(scene);
  scatterTrees(scene, terrain);
  const windTick = scatterGrass(scene, terrain);

  const swordHome = new Vector3(-1.3, terrain.heightAt(-1.3, -12) + 1.1, -12);
  const bowHome = new Vector3(1.3, terrain.heightAt(1.3, -12) + 1.1, -12);
  const shieldHome = new Vector3(-3.4, terrain.heightAt(-3.4, -12) + 1.0, -12);

  return {
    ground: terrain.mesh,
    groundHeight: terrain.heightAt,
    tick: (dt: number) => {
      windTick(dt);
      // Час правится в панели настройки — подхватываем на лету.
      if (LOADOUT.world.hour !== hour) {
        hour = LOADOUT.world.hour;
        day = dayState(hour);
        applyDay();
      }
    },
    swordHome,
    bowHome,
    shieldHome,
  };
}
