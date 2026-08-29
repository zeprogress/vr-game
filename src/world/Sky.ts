import { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Ray } from "@babylonjs/core/Culling/ray";
import { Constants } from "@babylonjs/core/Engines/constants";
import "@babylonjs/core/Culling/ray";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/discBuilder";

const FORWARD = new Vector3(0, 0, 1);

import { WORLD } from "../shared/constants";

/**
 * Дешёвое небо: большая сфера с вертикальным градиентом (без тяжёлых
 * шейдеров — важно для Quest), солнце, туман под цвет горизонта и
 * низкополигональные облака, медленно плывущие по ветру.
 */
export function createSky(scene: Scene, sunDir: Vector3): void {
  const dome = MeshBuilder.CreateSphere("skyDome", { diameter: 900, segments: 16, sideOrientation: 1 }, scene);
  dome.material = gradientMaterial(scene);
  dome.infiniteDistance = true;
  dome.isPickable = false;
  dome.applyFog = false;

  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.0055;
  scene.fogColor = new Color3(0.78, 0.85, 0.92);

  createSun(scene, sunDir);
  createClouds(scene);
}

/**
 * Солнце: несколько аддитивных дисков (ядро + гало) даёт «пересвет» без
 * тяжёлого bloom, а большая пелена вспыхивает белым, когда смотришь прямо
 * на солнце. За деревьями/холмом солнце гаснет.
 */
function createSun(scene: Scene, sunDir: Vector3): void {
  // Солнце «бесконечно далеко»: держим группу на камере, диск — по фиксированному смещению.
  const root = new TransformNode("sunRoot", scene);
  const toSun = sunDir.scale(-1); // от земли к солнцу
  const offset = toSun.scale(350); // внутри купола неба (радиус 450)

  const layer = (name: string, radius: number, color: Color3, alpha: number): Mesh => {
    const mat = new StandardMaterial(name + "Mat", scene);
    mat.emissiveColor = color;
    mat.diffuseColor = new Color3(0, 0, 0);
    mat.disableLighting = true;
    mat.specularColor = new Color3(0, 0, 0);
    mat.alpha = alpha;
    mat.alphaMode = Constants.ALPHA_ADD;
    mat.backFaceCulling = false;
    const d = MeshBuilder.CreateDisc(name, { radius, tessellation: 32 }, scene);
    d.material = mat;
    d.parent = root;
    d.position.copyFrom(offset);
    d.isPickable = false;
    d.applyFog = false;
    d.billboardMode = 7;
    d.renderingGroupId = 0;
    return d;
  };

  const core = layer("sun", 6, new Color3(1, 1, 0.98), 1);
  const inner = layer("sunInner", 11, new Color3(1, 0.95, 0.84), 0.45);
  const glow1 = layer("sunGlow1", 22, new Color3(1, 0.9, 0.72), 0.16);
  const glow2 = layer("sunGlow2", 46, new Color3(1, 0.88, 0.7), 0.06);
  const blind = layer("sunBlind", 520, new Color3(1, 0.99, 0.96), 0);
  const layers = [core, inner, glow1, glow2];

  const isSolid = (m: AbstractMesh): boolean => m.isPickable && m.checkCollisions;

  scene.onBeforeRenderObservable.add(() => {
    const cam = scene.activeCamera;
    if (!cam) return;
    const camPos = cam.globalPosition;
    root.position.copyFrom(camPos);

    const sunWorld = camPos.add(offset);
    const dir = sunWorld.subtract(camPos).normalize();
    const fwd = cam.getDirection(FORWARD);
    const align = Vector3.Dot(fwd, dir); // 1 — смотрим точно на солнце

    const occluded = align > 0 && !!scene.pickWithRay(new Ray(camPos, dir, 500), isSolid)?.hit;

    for (const m of layers) m.setEnabled(!occluded);

    const blindAmt = occluded ? 0 : smoothstep(0.9982, 0.99992, align);
    blind.setEnabled(blindAmt > 0.002);
    (blind.material as StandardMaterial).alpha = blindAmt * 0.95;
  });
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function gradientMaterial(scene: Scene): StandardMaterial {
  const h = 128;
  const tex = new DynamicTexture("skyGrad", { width: 4, height: h }, scene, false);
  const ctx = tex.getContext();
  const zenith = [82, 132, 205];
  const horizon = [206, 226, 240];
  for (let y = 0; y < h; y++) {
    const v = y / (h - 1); // v сферы: 0 — нижний полюс, 1 — зенит
    const k = Math.pow(Math.max(0, (v - 0.45) / 0.55), 0.8); // синеет только к зениту
    const c = zenith.map((t, i) => Math.round(horizon[i] + (t - horizon[i]) * k));
    ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
    ctx.fillRect(0, h - 1 - y, 4, 1);
  }
  tex.update();

  const mat = new StandardMaterial("skyMat", scene);
  mat.emissiveTexture = tex;
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mat.specularColor = new Color3(0, 0, 0);
  return mat;
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
