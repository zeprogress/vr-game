import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/discBuilder";
import "@babylonjs/core/Meshes/Builders/icoSphereBuilder";

import { WORLD } from "#shared/constants";
import { dayState, type DayState } from "./DayTime";

/** Небо, которое умеет меняться со временем суток. */
export interface Sky {
  /** Дёшево: туман и солнце. Можно звать каждый кадр. */
  apply(d: DayState): void;
  /** Дорого: перерисовать градиент купола. Только когда цвет заметно уехал. */
  repaint(d: DayState): void;
}

/**
 * Дешёвое небо: большая сфера с вертикальным градиентом (без тяжёлых
 * шейдеров — важно для Quest), солнце, туман под цвет горизонта и
 * низкополигональные облака, медленно плывущие по ветру.
 */
export function createSky(scene: Scene, start: DayState = dayState(12), simple = false): Sky {
  const grad = gradientMaterial(scene);
  const dome = MeshBuilder.CreateSphere("skyDome", { diameter: 900, segments: simple ? 10 : 16, sideOrientation: 1 }, scene);
  dome.material = grad.mat;
  dome.infiniteDistance = true;
  dome.isPickable = false;
  dome.applyFog = false;
  // Купол — ВОКРУГ КАМЕРЫ (infiniteDistance, матрицу НЕ замораживаем). Раньше
  // он был заморожен в центре карты: свободная камера спектатора улетала к
  // краю, смотрела через центр — до дальней стенки купола выходило дальше
  // дальности камеры (600 м), и в центре кадра зияла чёрная «дыра». Одна
  // матрица за кадр — бесплатно.

  // LINEAR (не EXP2): даёт «радиус» напрямую — ясно до fogStart, полная
  // стена с fogEnd. Границы приходят из DayState (палитра + FOG_TUNE, ?fog=1).
  // ?nofog=1 — полностью выключить туман (диагностика производительности).
  const noFog = new URLSearchParams(location.search).has("nofog");
  scene.fogMode = noFog ? Scene.FOGMODE_NONE : Scene.FOGMODE_LINEAR;
  scene.fogStart = start.fogNear;
  scene.fogEnd = start.fogFar;
  scene.fogColor = new Color3(0.78, 0.85, 0.92);

  const sun = createSun(scene);
  const stars = createStars(scene);
  // simple — слабый GPU (стрим на TOX3): без облаков, их полупрозрачная
  // «пена» — заметная нагрузка по заполнению, когда камера смотрит в небо.
  const clouds = simple ? null : createClouds(scene);
  const sky: Sky = {
    apply(d) {
      scene.fogColor.copyFrom(d.fog);
      scene.fogStart = d.fogNear;
      scene.fogEnd = d.fogFar;
      sun.apply(d);
      // Днём облака, ночью звёзды — обе смены плавные, по доле дневного света.
      clouds?.apply(d);
      stars.apply(d);
    },
    repaint(d) {
      grad.paint(d.zenith, d.horizon);
    },
  };
  sky.apply(start);
  sky.repaint(start);
  return sky;
}

/**
 * Звёзды: россыпь мелких точек вокруг игрока, проступающая к ночи.
 *
 * Сделаны геометрией, а не текстурой на куполе. Текстуру пришлось бы сильно
 * уменьшать, и без мип-уровней выборка просто перескакивает через отдельные
 * точки — звёзды то пропадают, то раздуваются в кляксы. Инстансы одного
 * крошечного меша дают один драв-колл и предсказуемый размер.
 */
function createStars(scene: Scene): { apply(d: DayState): void } {
  const R = 420; // радиус небесной сферы, на которой висят звёзды
  const COUNT = 260;

  const mat = new StandardMaterial("starMat", scene);
  // Чуть мягче белого: при включённом FXAA резкая белая точка в один пиксель
  // дёргается от кадра к кадру, а звезда покрупнее и потусклее — стоит ровно.
  mat.emissiveColor = new Color3(0.9, 0.9, 0.86);
  mat.diffuseColor = new Color3(0, 0, 0);
  mat.specularColor = new Color3(0, 0, 0);
  mat.disableLighting = true;
  mat.disableDepthWrite = true;
  mat.alpha = 0;

  // 260 звёзд — ОДИН меш (склейка), иначе на слабом GPU шлема это 260
  // прозрачных вызовов отрисовки каждый кадр ночью.
  const parts: Mesh[] = [];
  for (let i = 0; i < COUNT; i++) {
    // Равномерно по сфере, но только верхняя половина — под землёй звёзд не видно.
    const u = Math.random();
    const y = Math.pow(Math.random(), 0.7); // гуще к горизонту, как в жизни
    const r = Math.sqrt(1 - y * y);
    const a = u * Math.PI * 2;
    const s = MeshBuilder.CreateSphere(`starPart${i}`, { diameter: 1, segments: 3 }, scene);
    s.position.set(Math.cos(a) * r * R, y * R, Math.sin(a) * r * R);
    s.scaling.setAll(0.8 + Math.random() * 0.4);
    parts.push(s);
  }
  const merged = Mesh.MergeMeshes(parts, true, true) as Mesh;
  merged.name = "stars";
  merged.material = mat;
  merged.isPickable = false;
  merged.applyFog = false;
  merged.doNotSyncBoundingInfo = true;
  merged.alwaysSelectAsActiveMesh = true;
  // Звёзды — тоже вокруг камеры, как купол (иначе у края карты уходили за него).
  merged.infiniteDistance = true;
  // Прозрачные меши сортируются по расстоянию до центра ограничивающего объёма, а у звёзд он остался в нуле
  // карты (bbox не пересчитываем): чем дальше от центра, тем «дальше» звёзды — и их рисовало ПОСЛЕ облаков,
  // чей буфер глубины закрывал небо. Звёзды — самый дальний слой: рисуем первыми среди прозрачных.
  merged.alphaIndex = 0;

  merged.setEnabled(false);

  return {
    apply(d) {
      const night = 1 - d.daylight;
      mat.alpha = night;
      const on = night > 0.02;
      if (merged.isEnabled() !== on) merged.setEnabled(on);
    },
  };
}

/** Диск солнца, закреплён на небе (infiniteDistance). */
function createSun(scene: Scene): { apply(d: DayState): void } {
  const sunMat = new StandardMaterial("sunMat", scene);
  sunMat.emissiveColor = new Color3(1, 0.98, 0.9);
  sunMat.disableLighting = true;
  sunMat.specularColor = new Color3(0, 0, 0);
  const sun = MeshBuilder.CreateDisc("sun", { radius: 16, tessellation: 24 }, scene);
  sun.material = sunMat;
  sun.isPickable = false;
  sun.applyFog = false;
  sun.billboardMode = 7;

  return {
    apply(d) {
      sun.position.copyFrom(d.sunPos.scale(380));
      sunMat.emissiveColor.copyFrom(d.disc);
    },
  };
}


function gradientMaterial(scene: Scene): {
  mat: StandardMaterial;
  paint(zenith: [number, number, number], horizon: [number, number, number]): void;
} {
  const h = 128;
  const tex = new DynamicTexture("skyGrad", { width: 4, height: h }, scene, false);
  const ctx = tex.getContext();

  const paint = (
    zenith: [number, number, number],
    horizon: [number, number, number],
  ): void => {
    for (let y = 0; y < h; y++) {
      const v = y / (h - 1); // v сферы: 0 — нижний полюс, 1 — зенит
      const k = Math.pow(Math.max(0, (v - 0.45) / 0.55), 0.8); // цвет зенита набирается кверху
      const c = zenith.map((t, i) => Math.round(horizon[i] + (t - horizon[i]) * k));
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      ctx.fillRect(0, h - 1 - y, 4, 1);
    }
    tex.update();
  };

  const mat = new StandardMaterial("skyMat", scene);
  mat.emissiveTexture = tex;
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mat.specularColor = new Color3(0, 0, 0);
  return { mat, paint };
}

/**
 * Облака — максимально дёшево: ОДИН меш (склейка), куски — икосферы с 80 треугольниками
 * (всего ~4 тыс. на всё небо). Освещения нет (только emissive), поэтому форма читается
 * силуэтом. Днём материал НЕПРОЗРАЧНЫЙ (alpha 1, пишет глубину) — без смешивания и
 * перерисовки одних и тех же пикселей; прозрачность — только на заре/закате, когда
 * облака проявляются или гаснут. Ночью меш выключен.
 */
function createClouds(scene: Scene): { apply(d: DayState): void } {
  const mat = new StandardMaterial("cloudMat", scene);
  mat.diffuseColor = new Color3(0, 0, 0);
  mat.emissiveColor = new Color3(0.94, 0.96, 0.99);
  mat.specularColor = new Color3(0, 0, 0);
  mat.disableLighting = true;
  mat.alpha = 1;

  // Дрейф общий на меш; чтобы край поля не «прыгал» при возврате, вторая копия
  // облаков сдвинута на −span (узор периодичен по span).
  const span = WORLD.size * 1.6;
  const speed = 0.8; // м/с
  const puffs: Mesh[] = [];
  for (let i = 0; i < 9; i++) {
    const cx = (Math.random() - 0.5) * span;
    const cy = 50 + Math.random() * 25;
    const cz = (Math.random() - 0.5) * span;
    for (let p = 0; p < 3; p++) {
      const lx = (p - 1) * 6 + (Math.random() - 0.5) * 3;
      const lz = (Math.random() - 0.5) * 6;
      const sc = (p === 1 ? 9 : 6) + Math.random() * 3; // средний кусок крупнее
      for (const shift of [0, -span]) {
        const puff = MeshBuilder.CreateIcoSphere("cloudPuff", { radius: 0.5, subdivisions: 1 }, scene);
        puff.position.set(cx + lx + shift, cy, cz + lz);
        puff.scaling.set(sc, sc * 0.5, sc);
        puffs.push(puff);
      }
    }
  }
  const mesh = Mesh.MergeMeshes(puffs, true, true) as Mesh;
  mesh.name = "clouds";
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.applyFog = false;

  let off = 0;
  scene.onBeforeRenderObservable.add(() => {
    if (!mesh.isEnabled()) return;
    off = (off + speed * (scene.getEngine().getDeltaTime() / 1000)) % span;
    mesh.position.x = off;
  });

  return {
    apply(d) {
      // Днём белые, на заре и закате малиновые — цвет берём из состояния часа.
      mat.emissiveColor.copyFrom(d.cloud);
      const a = d.daylight > 0.97 ? 1 : d.daylight;
      if (mat.alpha !== a) mat.alpha = a;
      // Глубину пишут только непрозрачные; флаг меняется лишь на переходе день/сумерки.
      const fade = a < 1;
      if (mat.disableDepthWrite !== fade) mat.disableDepthWrite = fade;
      const on = a > 0.02;
      if (mesh.isEnabled() !== on) mesh.setEnabled(on);
    },
  };
}
