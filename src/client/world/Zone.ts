import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
// props.ts больше не тянет DynamicTexture статически — регистрируем расширение
// движка явно (skyGrad/terrain создают DynamicTexture в buildZone).
import "@babylonjs/core/Engines/Extensions/engine.dynamicTexture";

import { createTerrain } from "./Terrain";
import { createSky } from "./Sky";
import { scatterTrees, scatterGrass, scatterRocks, type Obstacle } from "./props";
import { dayState } from "./DayTime";
import { BotLights } from "./BotLights";
import { Fireflies, relightMaterials } from "./Fireflies";
import { advanceHour } from "#shared/constants";
import { LOADOUT } from "../config/loadout";

export interface Zone {
  /** Ночная подсветка от ботов зрителей (Ф10). Кормит Spectator/Game. */
  botLights: BotLights;
  /** Светлячки — держим ссылку, чтобы урезать бюджет ламп на лету (VR). */
  fireflies: Fireflies;
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
  staffHome: Vector3;
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
  /**
   * false — факелы у ботов зрителей (BotLights) совсем не зажигаются ночью.
   * Те же PointLight, что у светлячков, только раньше не гасли ни на одном
   * пресете — их создают ДО minLights-урезания материалов (см. ниже), и на
   * потом созданных материалах персонажей (recolorCharacter) минимальный
   * бюджет вообще не применялся. Пара факелов на слабом телефоне при паре
   * ботов в кадре ночью — уже заметно.
   */
  botTorches?: boolean;
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
  // Сразу за базовыми: материалы берут первые maxSimultaneousLights из
  // scene.lights по порядку создания. Раньше факелы создавались после зоны,
  // за пятью светлячками, и в шейдер мобов/персонажей/деревьев (потолок 3)
  // не попадали вовсе — бот светил только земле и траве.
  const botLights = new BotLights(scene);
  if (quality.botTorches === false) botLights.setForceOff(true);

  const sky = createSky(scene, day, quality.simpleSky);

  /** Свет и солнце — дёшево, можно каждый кадр. */
  const applyDay = (): void => {
    sun.direction.copyFrom(day.sunDir);
    sun.position = day.sunDir.scale(-60);
    sun.intensity = day.sunIntensity;
    sun.diffuse.copyFrom(day.sunColor);
    ambient.intensity = day.ambientIntensity;
    ambient.diffuse.copyFrom(day.ambientColor);
    // Источник НЕ гасим по setEnabled: смена набора источников заставляет
    // пересобирать шейдеры всех материалов (на Quest — заметный стоп-кадр,
    // а замороженные материалы деревьев вообще ломались). Днём заливка = 0,
    // это и так почти бесплатно на GPU.
    sky.apply(day);
  };
  applyDay();
  /** Когда последний раз перерисовывали градиент купола. */
  let paintedAt = hour;

  const terrain = createTerrain(scene);
  terrain.mesh.freezeWorldMatrix(); // рельеф не двигается
  const trunks = scatterTrees(scene, terrain, quality.minLights);
  const windTick = scatterGrass(scene, terrain, quality.grass ?? 1, quality.minLights);
  const fireflies = new Fireflies(scene, terrain, quality.fireflies ?? 1);

  // Слабый GPU: снимаем с шейдеров материалов лишние источники света.
  if (quality.minLights) {
    for (const m of scene.materials) {
      if (m instanceof StandardMaterial) m.maxSimultaneousLights = 2;
    }
  }

  const swordHome = new Vector3(-1.3, terrain.heightAt(-1.3, -12) + 0.8, -12);
  const bowHome = new Vector3(1.3, terrain.heightAt(1.3, -12) + 0.8, -12);
  const shieldHome = new Vector3(-3.4, terrain.heightAt(-3.4, -12) + 0.75, -12);
  const staffHome = new Vector3(3.4, terrain.heightAt(3.4, -12) + 0.9, -12);

  // Камни из пака: под оружием + по карте. Крупные — препятствия.
  const rockObstacles = scatterRocks(scene, terrain, [
    swordHome,
    bowHome,
    shieldHome,
    staffHome,
  ]);

  return {
    botLights,
    fireflies,
    ground: terrain.mesh,
    groundHeight: terrain.heightAt,
    obstacles: [...trunks, ...rockObstacles],
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
          // Стрелки перевели с пульта — часы прыгают, и порог дня/ночи может
          // проскочить между кадрами. Пересборка шейдеров привязана к этому
          // порогу, поэтому на скачке зовём её отдельно: иначе земля остаётся
          // с прежним набором источников. Обычную посекундную сверку
          // (DAYCYCLE.syncSeconds) не трогаем — там шаг маленький.
          if (Number.isFinite(lastNetHour) && Math.abs(net.hour - lastNetHour) > 0.25) {
            relightMaterials(scene);
          }
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
      fireflies.update(dt, playerPos, day.daylight);

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
    staffHome,
  };
}
