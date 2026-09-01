import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";

import { createTerrain } from "./Terrain";
import { createSky } from "./Sky";
import { scatterTrees, scatterGrass, type Obstacle } from "./props";
import { dayState } from "./DayTime";
import { Fireflies } from "./Fireflies";
import { advanceHour } from "#shared/constants";
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
   * `net` — часы с сервера (редкие сверки): между ними клиент крутит сам.
   */
  tick: (
    dt: number,
    playerPos: Vector3,
    net?: { hour: number; auto: number } | null,
  ) => void;
  /** Точки, где лежат меч, лук и щит (над камнями). */
  swordHome: Vector3;
  bowHome: Vector3;
  shieldHome: Vector3;
}

/**
 * Тестовая зона: рельеф, небо с облаками, деревья и трава.
 * Мобы и куклы живут на сервере (этап 6) — их создаёт NetMobs.
 */
/**
 * Пресет качества для слабого железа (стрим на TOX3, этап 17).
 * `grass`/`fireflies` — доля от обычного количества (0..1).
 */
export interface ZoneQuality {
  grass?: number;
  fireflies?: number;
  /**
   * true — материалы зоны считают максимум 2 источника света (солнце + небо)
   * вместо LIGHT_BUDGET. Дёшево для слабых GPU (Mali-G31), но подсветка от
   * светлячков пропадает — включать только вместе с `fireflies: 0`.
   */
  minLights?: boolean;
  /** true — небо без облаков и без периодической перерисовки градиента. */
  simpleSky?: boolean;
}

export function buildZone(scene: Scene, quality: ZoneQuality = {}): Zone {
  // Часы мира идут сами; LOADOUT.world.hour — их текущее показание,
  // и его же можно перевести вручную в панели настройки.
  let hour = LOADOUT.world.hour;
  let shown = hour;
  let day = dayState(hour);
  /** Последняя сверка с сервера — по её смене клиент подстраивает часы. */
  let lastNetHour = Number.NaN;

  const ambient = new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
  const sun = new DirectionalLight("sun", day.sunDir, scene);

  const sky = createSky(scene, day, quality.simpleSky);

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
  terrain.mesh.freezeWorldMatrix(); // рельеф не двигается
  const trunks = scatterTrees(scene, terrain);
  const windTick = scatterGrass(scene, terrain, quality.grass ?? 1);
  const fireflies = new Fireflies(scene, terrain, quality.fireflies ?? 1);

  // Слабый GPU: снимаем с шейдеров материалов лишние источники света.
  if (quality.minLights) {
    for (const m of scene.materials) {
      if (m instanceof StandardMaterial) m.maxSimultaneousLights = 2;
    }
  }

  const swordHome = new Vector3(-1.3, terrain.heightAt(-1.3, -12) + 1.15, -12);
  const bowHome = new Vector3(1.3, terrain.heightAt(1.3, -12) + 1.15, -12);
  const shieldHome = new Vector3(-3.4, terrain.heightAt(-3.4, -12) + 1.05, -12);

  // Этап 12 — первый внешний ассет: постаменты под стартовым оружием.
  // glTF-загрузчик тяжёлый — тянем его отдельным чанком, не в основной бандл.
  void import("./models").then(({ placeModel }) => {
    for (const home of [swordHome, bowHome, shieldHome]) {
      void placeModel(scene, "pedestal", {
        position: new Vector3(home.x, terrain.heightAt(home.x, home.z), home.z),
        scale: 0.82,
      });
    }
  });

  return {
    ground: terrain.mesh,
    groundHeight: terrain.heightAt,
    obstacles: trunks,
    tick: (
      dt: number,
      playerPos: Vector3,
      net?: { hour: number; auto: number } | null,
    ) => {
      // Часы двигаем ПЕРВЫМИ: если что-то ниже упадёт, время всё равно идёт.
      // Останавливаемся только по явному нулю auto: если в настройку затесался
      // мусор, часы должны идти, а не замереть навсегда.
      const auto = (net ? net.auto : LOADOUT.world.auto) !== 0;
      if (net) {
        // Онлайн: пришла новая сверка с сервера — подхватываем её точно.
        if (net.hour !== lastNetHour) {
          hour = net.hour;
          lastNetHour = net.hour;
        } else if (auto) {
          hour = advanceHour(hour, dt);
        }
        // Тумблер автосмены в панели показывает состояние сервера.
        LOADOUT.world.auto = net.auto;
      } else {
        // Офлайн: крутим сами. Перевели стрелки в панели — приняли.
        if (LOADOUT.world.hour !== shown) hour = LOADOUT.world.hour;
        if (auto) hour = advanceHour(hour, dt);
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
      // simpleSky — перерисовка градиента (заливка 4×128 canvas) на слабом GPU
      // тоже стоит времени, но большой шаг давал ступени на рассвете/закате.
      // В сумерках (небо быстро меняет цвет) красим часто, днём и ночью — редко.
      const moved = Math.abs(hour - paintedAt);
      const twilight = day.daylight > 0.03 && day.daylight < 0.97;
      const step = quality.simpleSky ? (twilight ? 0.03 : 0.4) : 0.004;
      if (moved > step || moved > 23) {
        paintedAt = hour;
        sky.repaint(day);
      }
    },
    swordHome,
    bowHome,
    shieldHome,
  };
}
