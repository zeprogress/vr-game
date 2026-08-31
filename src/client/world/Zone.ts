import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";

import { createTerrain } from "./Terrain";
import { createSky } from "./Sky";
import { scatterTrees, scatterGrass, type Obstacle } from "./props";
import { dayState } from "./DayTime";
import { Fireflies } from "./Fireflies";
import { DAYCYCLE } from "#shared/constants";
import { LOADOUT } from "../config/loadout";

export interface Zone {
  /** Меш «земли» — нужен WebXR как пол и raycast'ам игрока. */
  ground: Mesh;
  /** Высота земли в точке (аналитическая). */
  groundHeight: (x: number, z: number) => number;
  /** Стволы деревьев: сквозь них ходить нельзя. */
  obstacles: Obstacle[];
  /**
   * Двигает время суток, ветер и светлячков. Звать каждый кадр.
   * `netHour` — час с сервера: если задан, часы ведёт он, а не клиент.
   */
  tick: (dt: number, playerPos: Vector3, netHour?: number | null) => void;
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
  // Часы мира идут сами; LOADOUT.world.hour — их текущее показание,
  // и его же можно перевести вручную в панели настройки.
  let hour = LOADOUT.world.hour;
  let shown = hour;
  let day = dayState(hour);

  const ambient = new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
  const sun = new DirectionalLight("sun", day.sunDir, scene);

  const sky = createSky(scene, day);

  /** Свет и солнце — дёшево, можно каждый кадр. */
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
  /** Когда последний раз перерисовывали градиент купола. */
  let paintedAt = hour;

  const terrain = createTerrain(scene);
  const trunks = scatterTrees(scene, terrain);
  const windTick = scatterGrass(scene, terrain);
  const fireflies = new Fireflies(scene, terrain);

  const swordHome = new Vector3(-1.3, terrain.heightAt(-1.3, -12) + 1.1, -12);
  const bowHome = new Vector3(1.3, terrain.heightAt(1.3, -12) + 1.1, -12);
  const shieldHome = new Vector3(-3.4, terrain.heightAt(-3.4, -12) + 1.0, -12);

  return {
    ground: terrain.mesh,
    groundHeight: terrain.heightAt,
    obstacles: trunks,
    tick: (dt: number, playerPos: Vector3, netHour?: number | null) => {
      // Часы двигаем ПЕРВЫМИ: если что-то ниже упадёт, время всё равно идёт.
      if (typeof netHour === "number" && Number.isFinite(netHour)) {
        // Онлайн: временем владеет сервер, клиент только показывает.
        hour = netHour;
      } else {
        // Офлайн: крутим сами. Перевели стрелки в панели — приняли.
        if (LOADOUT.world.hour !== shown) hour = LOADOUT.world.hour;
        // Ночью часы бегут быстрее, иначе темнота занимает половину круга.
        // Тумблер в панели останавливает время на выставленном часе.
        // Останавливаемся только по явному нулю: если в настройку затесался
        // мусор, часы должны идти, а не замереть навсегда.
        if (LOADOUT.world.auto !== 0) {
          const speed = 1 + (1 - day.daylight) * (DAYCYCLE.nightSpeedup - 1);
          hour = (hour + (dt * 24 * speed) / DAYCYCLE.seconds) % 24;
        }
      }
      // В панель кладём округлённое: иначе строка дрожала бы каждый кадр.
      shown = Math.round(hour * 100) / 100;
      LOADOUT.world.hour = shown;

      day = dayState(hour);
      applyDay();

      windTick(dt, day.daylight);
      fireflies.update(dt, playerPos, day.daylight, terrain);

      // Градиент купола — не каждый кадр (это заливка текстуры), но часто:
      // на пороге 0.05 небо перекрашивалось раз в две с половиной секунды,
      // и рассвет шёл заметными ступенями.
      const moved = Math.abs(hour - paintedAt);
      if (moved > 0.004 || moved > 23) {
        paintedAt = hour;
        sky.repaint(day);
      }
    },
    swordHome,
    bowHome,
    shieldHome,
  };
}
