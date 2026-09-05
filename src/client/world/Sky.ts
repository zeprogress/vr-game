import { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/discBuilder";

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
  dome.freezeWorldMatrix();

  // LINEAR (не EXP2): даёт «радиус» напрямую — ясно до fogStart, полная
  // стена с fogEnd. Границы приходят из DayState (палитра + FOG_TUNE, ?fog=1).
  scene.fogMode = Scene.FOGMODE_LINEAR;
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

  const proto = MeshBuilder.CreateSphere("starProto", { diameter: 1, segments: 3 }, scene);
  proto.material = mat;
  proto.isPickable = false;
  proto.isVisible = false;
  proto.applyFog = false;

  // Узел едет за головой, поэтому звёзды не смещаются, когда игрок идёт.
  const root = new TransformNode("starRoot", scene);
  proto.parent = root;

  for (let i = 0; i < COUNT; i++) {
    // Равномерно по сфере, но только верхняя половина — под землёй звёзд не видно.
    const u = Math.random();
    const y = Math.pow(Math.random(), 0.7); // гуще к горизонту, как в жизни
    const r = Math.sqrt(1 - y * y);
    const a = u * Math.PI * 2;
    const star = proto.createInstance(`star${i}`);
    star.parent = root;
    star.position.set(Math.cos(a) * r * R, y * R, Math.sin(a) * r * R);
    // Достаточно крупные, чтобы сглаживание их не «размазывало» кадр в кадр,
    // но не раздувались в кляксы.
    const size = 0.8 + Math.random() * 0.4;
    star.scaling.setAll(size);
    star.isPickable = false;
  }

  scene.onBeforeRenderObservable.add(() => {
    const cam = scene.activeCamera;
    if (cam) root.position.copyFrom(cam.globalPosition);
  });

  root.setEnabled(false);

  return {
    apply(d) {
      const night = 1 - d.daylight;
      mat.alpha = night;
      const on = night > 0.02;
      if (root.isEnabled() !== on) root.setEnabled(on);
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

function createClouds(scene: Scene): { apply(d: DayState): void } {
  const mat = new StandardMaterial("cloudMat", scene);
  mat.diffuseColor = new Color3(1, 1, 1);
  mat.emissiveColor = new Color3(0.6, 0.63, 0.68);
  mat.specularColor = new Color3(0, 0, 0);
  mat.alpha = 0.95;
  mat.disableLighting = true;

  const proto = MeshBuilder.CreateSphere("cloudProto", { diameter: 1, segments: 6 }, scene);
  proto.material = mat;
  proto.isPickable = false;
  proto.isVisible = false;
  mat.disableDepthWrite = true; // облака полупрозрачные и не должны спорить по глубине

  const clouds: { root: Mesh; speed: number }[] = [];
  const span = WORLD.size * 1.6;

  for (let i = 0; i < 13; i++) {
    const root = proto.clone(`cloud${i}`);
    root.isVisible = false;
    const puffs = 3 + Math.floor(Math.random() * 4);
    for (let p = 0; p < puffs; p++) {
      const puff = proto.createInstance(`cloud${i}_${p}`);
      puff.parent = root;
      puff.position.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 8);
      const sc = 4 + Math.random() * 5;
      puff.scaling.set(sc, sc * 0.55, sc);
    }
    root.position.set(
      (Math.random() - 0.5) * span,
      50 + Math.random() * 25,
      (Math.random() - 0.5) * span,
    );
    clouds.push({ root, speed: 0.5 + Math.random() * 0.8 });
  }

  scene.onBeforeRenderObservable.add(() => {
    const dt = scene.getEngine().getDeltaTime() / 1000;
    for (const c of clouds) {
      c.root.position.x += c.speed * dt;
      if (c.root.position.x > span / 2) c.root.position.x = -span / 2;
    }
  });

  const FULL = 0.95; // непрозрачность облаков среди бела дня
  return {
    apply(d) {
      // Днём белые, на заре и закате малиновые — цвет берём из состояния часа.
      mat.emissiveColor.copyFrom(d.cloud);
      mat.alpha = FULL * d.daylight;
      const on = mat.alpha > 0.02;
      for (const c of clouds) {
        if (c.root.isEnabled() !== on) c.root.setEnabled(on);
      }
    },
  };
}
