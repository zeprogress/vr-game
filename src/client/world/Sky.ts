import { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
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
export function createSky(scene: Scene, start: DayState = dayState(12)): Sky {
  const grad = gradientMaterial(scene);
  const dome = MeshBuilder.CreateSphere("skyDome", { diameter: 900, segments: 16, sideOrientation: 1 }, scene);
  dome.material = grad.mat;
  dome.infiniteDistance = true;
  dome.isPickable = false;
  dome.applyFog = false;

  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.0055;
  scene.fogColor = new Color3(0.78, 0.85, 0.92);

  const sun = createSun(scene);
  const sky: Sky = {
    apply(d) {
      scene.fogColor.copyFrom(d.fog);
      sun.apply(d);
    },
    repaint(d) {
      grad.paint(d.zenith, d.horizon);
    },
  };
  sky.apply(start);
  sky.repaint(start);
  createClouds(scene);
  return sky;
}

/** Диск солнца + мягкое гало, закреплены на небе (infiniteDistance). */
function createSun(scene: Scene): { apply(d: DayState): void } {
  const haloMat = new StandardMaterial("sunHaloMat", scene);
  haloMat.emissiveColor = new Color3(1, 0.95, 0.8);
  haloMat.disableLighting = true;
  haloMat.specularColor = new Color3(0, 0, 0);
  haloMat.alpha = 0.28;
  const halo = MeshBuilder.CreateDisc("sunHalo", { radius: 42, tessellation: 24 }, scene);
  halo.material = haloMat;
  halo.isPickable = false;
  halo.applyFog = false;
  halo.billboardMode = 7;

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
      // Диск стоит там, откуда светит: чуть дальше гало, чтобы не спорили по глубине.
      sun.position.copyFrom(d.sunPos.scale(380));
      halo.position.copyFrom(d.sunPos.scale(380 * 1.03));
      sunMat.emissiveColor.copyFrom(d.disc);
      haloMat.emissiveColor.copyFrom(d.disc);
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

function createClouds(scene: Scene): void {
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

  const clouds: { root: Mesh; speed: number }[] = [];
  const span = WORLD.size * 1.6;

  for (let i = 0; i < 8; i++) {
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
}
