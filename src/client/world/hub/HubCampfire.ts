import { vrLights } from "../vrLights";
import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3, Matrix } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Constants } from "@babylonjs/core/Engines/constants";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import "@babylonjs/core/Meshes/Builders/polyhedronBuilder";

import { relightMaterials } from "../Fireflies";
import { makeFireMaterial } from "../FireShader";

/**
 * Костёр лагеря — портирован из процедурного костра, что дал пользователь
 * (grok-workspace/src/campfire). Взято главное: шейдер пламени (сам шейдер —
 * см. FireShader.ts, его же переиспользует поджог мобов) + свечение + искры
 * + угли. Без PointLight и частиц-систем — под конвенции проекта (бюджет
 * источников, Quest). День/ночь регулирует `tick(daylight)`.
 */

export interface HubCampfire {
  tick(dt: number, daylight: number): void;
  dispose(): void;
}

/** Радиальный градиент для ореола (как makeGlowTexture из исходника). */
function glowTexture(scene: Scene): DynamicTexture {
  const tex = new DynamicTexture("hubFireGlow", { width: 256, height: 256 }, scene, false);
  const g = tex.getContext() as unknown as CanvasRenderingContext2D;
  const grd = g.createRadialGradient(128, 128, 8, 128, 128, 128);
  grd.addColorStop(0, "rgba(255,244,200,1)");
  grd.addColorStop(0.18, "rgba(255,186,74,0.85)");
  grd.addColorStop(0.42, "rgba(255,92,24,0.4)");
  grd.addColorStop(0.7, "rgba(120,20,0,0.12)");
  grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  tex.update();
  tex.hasAlpha = true;
  return tex;
}

export function buildHubCampfire(scene: Scene, pos: Vector3): HubCampfire {
  const root = new TransformNode("hubFire", scene);
  root.position.copyFrom(pos);

  // --- пламя: shader-материал (wrap-конус + пара скрещённых плоскостей) ---
  const fireMats: ShaderMaterial[] = [];
  const makeFireMat = (wrap: boolean): ShaderMaterial => {
    const m = makeFireMaterial(scene, `hubFireMat${fireMats.length}`, wrap);
    fireMats.push(m);
    return m;
  };

  const cone = MeshBuilder.CreateCylinder(
    "hubFireCone",
    { diameterTop: 0.02, diameterBottom: 0.64, height: 1.55, tessellation: 14, cap: Mesh.NO_CAP },
    scene,
  );
  cone.position.set(0, 0.86, 0);
  cone.material = makeFireMat(true);
  cone.parent = root;
  cone.isPickable = false;
  cone.renderingGroupId = 1;

  for (let i = 0; i < 3; i++) {
    const pl = MeshBuilder.CreatePlane("hubFirePlane", { width: 1.0 - i * 0.12, height: 1.8 - i * 0.22 }, scene);
    pl.position.set(0, 0.82 - i * 0.05, 0);
    pl.rotation.y = i * 1.05;
    pl.material = makeFireMat(false);
    pl.parent = root;
    pl.isPickable = false;
    pl.renderingGroupId = 1;
  }

  // --- угли: несколько эмиссивных камешков, пульсируют ---
  const coalMat = new StandardMaterial("hubCoalMat", scene);
  coalMat.diffuseColor = new Color3(0.14, 0.08, 0.05);
  coalMat.emissiveColor = new Color3(1, 0.28, 0.07);
  coalMat.specularColor = new Color3(0, 0, 0);
  const coalMeshes: Mesh[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.2;
    const d = 0.12 + (i % 4) * 0.08;
    const c = MeshBuilder.CreatePolyhedron(`hubCoal${i}`, { type: 2, size: 0.06 + (i % 3) * 0.02 }, scene);
    c.position.set(Math.cos(a) * d, 0.06 + (i % 3) * 0.02, Math.sin(a) * d);
    c.rotation.set(i * 0.7, a, i * 0.3);
    c.material = coalMat;
    c.parent = root;
    c.isPickable = false;
    coalMeshes.push(c);
  }
  // 10 углей одним мешем: материал у них общий (пульс и так был один на всех),
  // а лишние draw call'ы на Quest дороги.
  const coalsMesh = Mesh.MergeMeshes(coalMeshes, true, true, undefined, false, false) ?? coalMeshes[0];
  coalsMesh.name = "hubCoals";
  // MergeMeshes запекает мировые матрицы (включая родителя root) — без parent.
  coalsMesh.parent = null;
  coalsMesh.isPickable = false;
  coalsMesh.freezeWorldMatrix();

  // --- ореол: круглый радиальный градиент, аддитив, билборд, пульс ---
  const gt = glowTexture(scene);
  const mkGlow = (size: number, opacity: number, tint: string): Mesh => {
    const gm = new StandardMaterial(`hubGlowMat${size}`, scene);
    // Круглая форма — из самой текстуры: её RGB и альфа гаснут к краю, при
    // аддитивном блендинге углы плоскости не видны (в отличие от плоского
    // emissiveColor — от него был квадрат).
    gm.emissiveTexture = gt;
    gm.opacityTexture = gt;
    gm.emissiveColor = Color3.FromHexString(tint);
    gm.diffuseColor = new Color3(0, 0, 0);
    gm.specularColor = new Color3(0, 0, 0);
    gm.disableLighting = true;
    gm.alpha = opacity;
    gm.alphaMode = Constants.ALPHA_ADD;
    gm.disableDepthWrite = true;
    const pl = MeshBuilder.CreatePlane(`hubGlow${size}`, { size }, scene);
    pl.material = gm;
    pl.position.set(0, 0.55, 0);
    pl.billboardMode = Mesh.BILLBOARDMODE_ALL;
    pl.parent = root;
    pl.isPickable = false;
    pl.renderingGroupId = 1;
    return pl;
  };
  const glowIn = mkGlow(3.2, 0.5, "#ff8630");
  const glowOut = mkGlow(5.6, 0.2, "#ff5c1a");

  // --- свет костра: PointLight, гаснет днём (переключение на границе суток,
  //     как у факелов ботов; в бюджете LIGHT_BUDGET учтён +1) ---
  const fireLight = new PointLight("hubCampfire", pos.clone(), scene);
  fireLight.range = 15;
  fireLight.diffuse = new Color3(1, 0.54, 0.2);
  fireLight.specular = new Color3(0.18, 0.09, 0.03);
  fireLight.intensity = 0;
  fireLight.setEnabled(false);
  let lightOn = false;

  // --- искры: пул мелких квадов, поднимаются и перерождаются ---
  const sparkMat = new StandardMaterial("hubSparkMat", scene);
  sparkMat.emissiveColor = Color3.FromHexString("#ffc46a");
  sparkMat.diffuseColor = new Color3(0, 0, 0);
  sparkMat.specularColor = new Color3(0, 0, 0);
  sparkMat.disableLighting = true;
  sparkMat.alphaMode = Constants.ALPHA_ADD;
  sparkMat.disableDepthWrite = true;
  interface Spark { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; }
  const rnd = (): number => Math.random();
  const SPARKS = 26;
  const sparks: Spark[] = [];
  for (let i = 0; i < SPARKS; i++) {
    sparks.push({
      x: (rnd() - 0.5) * 0.3, y: 0.2 + rnd() * 0.4, z: (rnd() - 0.5) * 0.3,
      vx: (rnd() - 0.5) * 0.15, vy: 0.55 + rnd() * 0.7, vz: (rnd() - 0.5) * 0.15,
      life: rnd(), max: 0.7 + rnd() * 0.9,
    });
  }
  // Все искры — один динамический меш: квады, повёрнутые к камере на CPU
  // (26 отдельных билбордов = 26 draw call'ов на кадр).
  const sparkPos = new Float32Array(SPARKS * 12);
  const sparkIdx: number[] = [];
  for (let i = 0; i < SPARKS; i++) {
    const o = i * 4;
    sparkIdx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  const sparkMesh = new Mesh("hubSparks", scene);
  const svd = new VertexData();
  svd.positions = sparkPos;
  svd.indices = sparkIdx;
  svd.applyToMesh(sparkMesh, true);
  sparkMesh.material = sparkMat;
  sparkMesh.parent = root;
  sparkMat.backFaceCulling = false;
  sparkMesh.isPickable = false;
  sparkMesh.alwaysSelectAsActiveMesh = true;
  sparkMesh.renderingGroupId = 1;
  const invRoot = new Matrix();
  const camR = new Vector3();
  const camU = new Vector3();

  let time = 0;
  function tick(dt: number, daylight: number): void {
    const d = Math.min(0.1, dt);
    time += d;
    const day = Math.min(1, Math.max(0, daylight));
    // Днём пламя бледнее и мельче не делаем — просто чуть тусклее ореол/искры.
    const alpha = 0.75 + 0.25 * (1 - day);
    for (const m of fireMats) {
      m.setFloat("uTime", time);
      m.setFloat("uAlpha", alpha);
    }
    const pulse = 1 + Math.sin(time * 3.2) * 0.07 + Math.sin(time * 7.1) * 0.04;
    glowIn.scaling.setAll(0.82 * pulse);
    glowOut.scaling.setAll(1.0 * pulse);
    // Днём ореол почти не виден (солнце и так светит), ночью в полную силу.
    (glowIn.material as StandardMaterial).alpha = 0.16 + 0.5 * (1 - day);
    (glowOut.material as StandardMaterial).alpha = 0.06 + 0.24 * (1 - day);
    const ck = 0.55 + Math.sin(time * 3.4) * 0.35;
    coalMat.emissiveColor.set(1 * ck, 0.28 * ck, 0.07 * ck);
    for (const s of sparks) {
      s.life += d;
      if (s.life >= s.max) {
        s.life = 0;
        s.x = (rnd() - 0.5) * 0.32; s.y = 0.18 + rnd() * 0.2; s.z = (rnd() - 0.5) * 0.32;
        s.vx = (rnd() - 0.5) * 0.18; s.vy = 0.5 + rnd() * 0.85; s.vz = (rnd() - 0.5) * 0.18;
        s.max = 0.65 + rnd();
      }
      s.x += s.vx * d; s.y += s.vy * d; s.z += s.vz * d; s.vy += 0.12 * d;
    }
    // Пересобираем квады искр: ось «вправо/вверх» камеры в локальных координатах костра.
    const cam = scene.activeCamera;
    if (cam) {
      root.computeWorldMatrix(true);
      root.getWorldMatrix().invertToRef(invRoot);
      const cw = cam.getWorldMatrix();
      Vector3.TransformNormalFromFloatsToRef(cw.m[0], cw.m[1], cw.m[2], invRoot, camR);
      Vector3.TransformNormalFromFloatsToRef(cw.m[4], cw.m[5], cw.m[6], invRoot, camU);
      const k = 0.6 + 0.5 * (1 - day);
      for (let i = 0; i < SPARKS; i++) {
        const sp = sparks[i];
        const h = 0.025 * (1 - sp.life / sp.max) * k;
        const o = i * 12;
        const rx = camR.x * h, ry = camR.y * h, rz = camR.z * h;
        const ux = camU.x * h, uy = camU.y * h, uz = camU.z * h;
        sparkPos[o] = sp.x - rx - ux; sparkPos[o + 1] = sp.y - ry - uy; sparkPos[o + 2] = sp.z - rz - uz;
        sparkPos[o + 3] = sp.x + rx - ux; sparkPos[o + 4] = sp.y + ry - uy; sparkPos[o + 5] = sp.z + rz - uz;
        sparkPos[o + 6] = sp.x + rx + ux; sparkPos[o + 7] = sp.y + ry + uy; sparkPos[o + 8] = sp.z + rz + uz;
        sparkPos[o + 9] = sp.x - rx + ux; sparkPos[o + 10] = sp.y - ry + uy; sparkPos[o + 11] = sp.z - rz + uz;
      }
      sparkMesh.updateVerticesData(VertexBuffer.PositionKind, sparkPos, false, false);
    }

    // Свет костра: включаем/выключаем ОДИН раз на границе суток (пересбор
    // шейдеров дорогой — как у BotLights), между границами меняем только силу.
    const night = 1 - day;
    const wantOn = night > 0.06 && !vrLights.off;
    if (wantOn !== lightOn) {
      lightOn = wantOn;
      fireLight.setEnabled(wantOn);
      relightMaterials(scene, "HubCampfire");
    }
    if (lightOn) {
      const flick =
        1 + Math.sin(time * 8.2) * 0.09 + Math.sin(time * 13.6) * 0.05 + Math.sin(time * 3.1) * 0.03;
      fireLight.intensity = 2.1 * night * flick;
    }
  }
  tick(0, 1);

  return {
    tick,
    dispose(): void {
      gt.dispose();
      fireLight.dispose();
      root.dispose(false, true);
      sparkMesh.dispose();
      coalsMesh.dispose();
    },
  };
}
