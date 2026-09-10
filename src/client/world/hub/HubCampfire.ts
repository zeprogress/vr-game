import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Constants } from "@babylonjs/core/Engines/constants";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import "@babylonjs/core/Meshes/Builders/polyhedronBuilder";

import { relightMaterials } from "../Fireflies";

/**
 * Костёр лагеря — портирован из процедурного костра, что дал пользователь
 * (grok-workspace/src/campfire). Взято главное: шейдер пламени + свечение +
 * искры + угли. Без PointLight и частиц-систем — под конвенции проекта
 * (бюджет источников, Quest). День/ночь регулирует `tick(daylight)`.
 */

const FIRE_VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
uniform float uTime;
uniform float uAmp;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  float top = uv.y;
  float n1 = sin(p.x * 9.0 + uTime * 4.4) * cos(p.z * 7.5 - uTime * 3.1);
  float n2 = cos(p.x * 5.2 - uTime * 5.6) * sin(p.z * 6.1 + uTime * 2.7);
  p.x += (n1 + n2 * 0.55) * uAmp * top;
  p.z += (n2 - n1 * 0.4) * uAmp * top * 0.85;
  p.y += abs(n1) * 0.07 * top;
  gl_Position = worldViewProjection * vec4(p, 1.0);
}
`;

const FIRE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uWrap;
uniform float uAlpha;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
  float a = hash(i), b = hash(i+vec2(1.0,0.0)), c = hash(i+vec2(0.0,1.0)), d = hash(i+vec2(1.0,1.0));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  v += a*noise(p); p *= 2.07; a *= 0.5;
  v += a*noise(p); p *= 2.03; a *= 0.5;
  v += a*noise(p); p *= 2.11; a *= 0.5;
  v += a*noise(p);
  return v;
}
void main(){
  vec2 uv = vUv;
  float n = fbm(vec2(uv.x*3.4, uv.y*2.15 - uTime*1.15));
  float n2 = fbm(vec2(uv.x*6.2 + 17.0, uv.y*3.1 - uTime*1.8));
  float warp = (n - 0.5) * 0.5;
  float mask;
  if (uWrap > 0.5) {
    float around = abs(fract(uv.x*5.0 + warp*0.8 + uTime*0.12) - 0.5) * 2.0;
    float tongue = 1.0 - smoothstep(0.12, 0.95, around + pow(uv.y, 0.55) * 0.85);
    mask = tongue * (1.0 - smoothstep(0.35, 1.0, uv.y));
    mask *= smoothstep(0.0, 0.05, uv.y);
    mask *= 0.55 + 0.6 * n2;
  } else {
    float x = uv.x - 0.5 + warp * uv.y;
    float width = mix(0.44, 0.045, pow(uv.y, 0.7));
    mask = 1.0 - smoothstep(width * 0.25, width, abs(x));
    mask *= 1.0 - smoothstep(0.45, 1.0, uv.y);
    mask *= smoothstep(0.0, 0.06, uv.y);
    mask *= 0.55 + 0.6 * n2;
  }
  vec3 col = mix(uColorA, uColorB, clamp(uv.y*1.05 + (n-0.5)*0.2, 0.0, 1.0));
  col = mix(col, uColorC, pow(uv.y, 1.25));
  col *= 1.2 + (n2 - 0.35) * 0.75;
  gl_FragColor = vec4(col * 1.65, clamp(mask, 0.0, 1.0) * uAlpha);
}
`;

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
    const m = new ShaderMaterial(
      `hubFireMat${fireMats.length}`,
      scene,
      { vertexSource: FIRE_VERT, fragmentSource: FIRE_FRAG },
      {
        attributes: ["position", "uv"],
        uniforms: ["worldViewProjection", "uTime", "uAmp", "uWrap", "uAlpha",
          "uColorA", "uColorB", "uColorC"],
        needAlphaBlending: true,
      },
    );
    m.setFloat("uTime", 0);
    m.setFloat("uAmp", wrap ? 0.16 : 0.22);
    m.setFloat("uWrap", wrap ? 1 : 0);
    m.setFloat("uAlpha", 1);
    m.setColor3("uColorA", Color3.FromHexString("#ffdf9c"));
    m.setColor3("uColorB", Color3.FromHexString("#ff560c"));
    m.setColor3("uColorC", Color3.FromHexString("#5c0a00"));
    m.alphaMode = Constants.ALPHA_ADD;
    m.backFaceCulling = false;
    m.disableDepthWrite = true;
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
  const coals: { m: Mesh; phase: number }[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.2;
    const d = 0.12 + (i % 4) * 0.08;
    const c = MeshBuilder.CreatePolyhedron(`hubCoal${i}`, { type: 2, size: 0.06 + (i % 3) * 0.02 }, scene);
    c.position.set(Math.cos(a) * d, 0.06 + (i % 3) * 0.02, Math.sin(a) * d);
    c.rotation.set(i * 0.7, a, i * 0.3);
    c.material = coalMat;
    c.parent = root;
    c.isPickable = false;
    coals.push({ m: c, phase: i * 0.73 });
  }

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
  const sparkProto = MeshBuilder.CreatePlane("hubSparkProto", { size: 0.05 }, scene);
  sparkProto.material = sparkMat;
  sparkProto.billboardMode = Mesh.BILLBOARDMODE_ALL;
  sparkProto.isPickable = false;
  sparkProto.renderingGroupId = 1;
  sparkProto.setEnabled(false);
  interface Spark { m: Mesh; x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; }
  const rnd = (): number => Math.random();
  const sparks: Spark[] = [];
  for (let i = 0; i < 26; i++) {
    const m = sparkProto.clone(`hubSpark${i}`);
    m.setEnabled(true);
    m.parent = root;
    sparks.push({
      m,
      x: (rnd() - 0.5) * 0.3, y: 0.2 + rnd() * 0.4, z: (rnd() - 0.5) * 0.3,
      vx: (rnd() - 0.5) * 0.15, vy: 0.55 + rnd() * 0.7, vz: (rnd() - 0.5) * 0.15,
      life: rnd(), max: 0.7 + rnd() * 0.9,
    });
  }

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
    for (const c of coals) {
      const k = 0.55 + Math.sin(time * (2.4 + (c.phase % 1) * 2) + c.phase) * 0.35;
      (c.m.material as StandardMaterial).emissiveColor.set(1 * k, 0.28 * k, 0.07 * k);
    }
    for (const s of sparks) {
      s.life += d;
      if (s.life >= s.max) {
        s.life = 0;
        s.x = (rnd() - 0.5) * 0.32; s.y = 0.18 + rnd() * 0.2; s.z = (rnd() - 0.5) * 0.32;
        s.vx = (rnd() - 0.5) * 0.18; s.vy = 0.5 + rnd() * 0.85; s.vz = (rnd() - 0.5) * 0.18;
        s.max = 0.65 + rnd();
      }
      s.x += s.vx * d; s.y += s.vy * d; s.z += s.vz * d; s.vy += 0.12 * d;
      s.m.position.set(s.x, s.y, s.z);
      s.m.scaling.setAll((1 - s.life / s.max) * (0.6 + 0.5 * (1 - day)));
    }

    // Свет костра: включаем/выключаем ОДИН раз на границе суток (пересбор
    // шейдеров дорогой — как у BotLights), между границами меняем только силу.
    const night = 1 - day;
    const wantOn = night > 0.06;
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
      sparkProto.dispose();
    },
  };
}
