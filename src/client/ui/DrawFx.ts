import type { Scene } from "@babylonjs/core/scene";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Effect } from "@babylonjs/core/Materials/effect";
import { Constants } from "@babylonjs/core/Engines/constants";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import { FXC } from "./fxColors";
import { groundFxThrough } from "./groundFx";
import { MV_HEAD, MV_OUT } from "./FireFx";

/**
 * «Стягивание» воина (🧲, DRAW_IN) — визуал шейдерами, как FireFx: без клонов в бою, пул мешей один раз.
 *  streak   — полоска-хвост: моб летит по прямой к точке, хвост стелется за ним (билборд, вершинный шейдер
 *             сам ведёт голову и хвост по времени — из JS только uT за кадр);
 *  implode  — кольцо на земле, которое сжимается от радиуса стягивания к воину (схлопывание).
 * Искры вдоль полоски и вспышка в точке удара — FireFx (тот же пул искр).
 */

Effect.ShadersStore["drawStreakVertexShader"] = `
precision highp float;
attribute vec3 position;
uniform mat4 viewProjection;
uniform vec3 cameraPosition;
uniform vec3 uA;
uniform vec3 uB;
uniform float uT;
uniform float uDur;
uniform float uW;
uniform float uTail;
${MV_HEAD}
varying float vX;
varying float vY;
varying float vA;
void main() {
  float u = clamp(uT / max(uDur, 0.01), 0.0, 1.0);
  u = u * u;                     // рывок: сначала медленно, к концу — резко
  vec3 head = mix(uA, uB, u);
  vec3 tail = mix(uA, uB, max(0.0, u - uTail));
  vec3 p = mix(tail, head, position.x);
  vec3 dir = normalize(uB - uA + vec3(0.0001));
  vec3 toCam = normalize(cameraPosition - p);
  vec3 side = normalize(cross(dir, toCam) + vec3(0.0001));
  p += side * position.y * uW * (0.3 + 0.7 * position.x);
  vX = position.x;
  vY = position.y;
  vA = smoothstep(0.0, 0.08, uT) * (1.0 - smoothstep(uDur, uDur + 0.25, uT));
  ${MV_OUT("p")}
}`;
Effect.ShadersStore["drawStreakFragmentShader"] = `
precision highp float;
varying float vX;
varying float vY;
varying float vA;
uniform vec3 uSteel;
uniform vec3 uHot;
void main() {
  float edge = 1.0 - abs(vY);
  float a = pow(edge, 2.0) * pow(vX, 1.6) * vA;
  if (a <= 0.001) discard;
  vec3 c = mix(uSteel, uHot, vX);
  gl_FragColor = vec4(c * a, a);
}`;

Effect.ShadersStore["drawImplodeVertexShader"] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 viewProjection;
${MV_HEAD}
varying vec2 vUV;
void main() {
  vUV = uv;
  vec4 wp = world * vec4(position, 1.0);
  ${MV_OUT("wp.xyz")}
}`;
Effect.ShadersStore["drawImplodeFragmentShader"] = `
precision highp float;
varying vec2 vUV;
uniform float uT;
uniform float uAlpha;
uniform vec3 uSteel;
uniform vec3 uHot;
void main() {
  vec2 p = vUV * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float rr = 1.0 - 0.9 * uT;                 // кольцо сжимается к центру
  float band = exp(-pow((r - rr) / (0.05 + 0.05 * (1.0 - uT)), 2.0));
  float a = band * (1.0 - uT) * (1.0 - uT) * uAlpha;
  if (a <= 0.001) discard;
  gl_FragColor = vec4(mix(uSteel, uHot, uT * 0.6) * a, a);
}`;

const STREAKS = 16;
const IMPLODES = 2;

interface Streak {
  mesh: Mesh;
  mat: ShaderMaterial;
  age: number;
  dur: number;
}
interface Implode {
  mesh: Mesh;
  mat: ShaderMaterial;
  age: number;
  dur: number;
  r: number;
}

const pools = new WeakMap<Scene, DrawFx>();

export class DrawFx {
  static of(scene: Scene): DrawFx {
    let fx = pools.get(scene);
    if (!fx) {
      fx = new DrawFx(scene);
      pools.set(scene, fx);
    }
    return fx;
  }

  private readonly streaks: Streak[] = [];
  private readonly implodes: Implode[] = [];
  private nS = 0;
  private nI = 0;
  private readonly obs: Observer<Scene>;

  private constructor(private readonly scene: Scene) {
    const quad = new VertexData();
    // position.x — вдоль полоски (0 хвост → 1 голова), position.y — поперёк (−1..1).
    quad.positions = [0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0];
    quad.indices = [0, 1, 2, 0, 2, 3];
    for (let i = 0; i < STREAKS; i++) {
      const mesh = new Mesh(`drawStreak${i}`, scene);
      quad.applyToMesh(mesh);
      const mat = new ShaderMaterial(`drawStreakMat${i}`, scene, "drawStreak", {
        attributes: ["position"],
        uniforms: ["world", "viewProjection", "cameraPosition", "uA", "uB", "uT", "uDur", "uW", "uTail", "uSteel", "uHot"],
        needAlphaBlending: true,
      });
      mat.alphaMode = Constants.ALPHA_ADD;
      mat.disableDepthWrite = true;
      mat.backFaceCulling = false;
      mat.setColor3("uSteel", FXC.steel);
      mat.setColor3("uHot", FXC.steelHot);
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.setEnabled(false);
      this.streaks.push({ mesh, mat, age: 1, dur: 0 });
    }
    for (let i = 0; i < IMPLODES; i++) {
      const mesh = MeshBuilder.CreatePlane(`drawImplode${i}`, { size: 2 }, scene);
      mesh.rotation.x = Math.PI / 2;
      mesh.bakeCurrentTransformIntoVertices();
      const mat = new ShaderMaterial(`drawImplodeMat${i}`, scene, "drawImplode", {
        attributes: ["position", "uv"],
        uniforms: ["world", "viewProjection", "uT", "uAlpha", "uSteel", "uHot"],
        needAlphaBlending: true,
      });
      mat.alphaMode = Constants.ALPHA_ADD;
      mat.disableDepthWrite = true;
      mat.backFaceCulling = false;
      mat.setColor3("uSteel", FXC.steel);
      mat.setColor3("uHot", FXC.steelHot);
      mesh.material = mat;
      groundFxThrough(mesh);
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.setEnabled(false);
      this.implodes.push({ mesh, mat, age: 1, dur: 0, r: 1 });
    }
    this.obs = scene.onBeforeRenderObservable.add(() => this.update(Math.min(0.1, scene.getEngine().getDeltaTime() / 1000)));
  }

  /** Полоска: моб из (a) в (b) за sec с. */
  streak(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, sec: number, width = 0.22): void {
    const s = this.streaks[this.nS];
    this.nS = (this.nS + 1) % this.streaks.length;
    s.mat.setVector3("uA", new Vector3(a.x, a.y, a.z));
    s.mat.setVector3("uB", new Vector3(b.x, b.y, b.z));
    s.mat.setFloat("uDur", sec);
    s.mat.setFloat("uW", width);
    s.mat.setFloat("uTail", 0.35);
    s.mat.setFloat("uT", 0);
    s.age = 0;
    s.dur = sec + 0.3;
    s.mesh.setEnabled(true);
  }

  /** Кольцо, которое сжимается с радиуса r к воину за sec с (ставится на землю в (x,y,z)). */
  implode(x: number, y: number, z: number, r: number, sec: number, alpha = 0.9): void {
    const i = this.implodes[this.nI];
    this.nI = (this.nI + 1) % this.implodes.length;
    i.mesh.position.set(x, y + 0.06, z);
    i.mesh.scaling.set(r, 1, r);
    i.mat.setFloat("uAlpha", alpha);
    i.mat.setFloat("uT", 0);
    i.age = 0;
    i.dur = sec;
    i.r = r;
    i.mesh.setEnabled(true);
  }

  private update(dt: number): void {
    for (const s of this.streaks) {
      if (s.age >= s.dur) continue;
      s.age += dt;
      if (s.age >= s.dur) s.mesh.setEnabled(false);
      else s.mat.setFloat("uT", s.age);
    }
    for (const i of this.implodes) {
      if (i.age >= i.dur) continue;
      i.age += dt;
      if (i.age >= i.dur) i.mesh.setEnabled(false);
      else i.mat.setFloat("uT", i.age / i.dur);
    }
  }

  dispose(): void {
    this.scene.onBeforeRenderObservable.remove(this.obs);
    for (const e of [...this.streaks, ...this.implodes]) {
      e.mat.dispose();
      e.mesh.dispose();
    }
    pools.delete(this.scene);
  }
}

/** Цвет для вспышек стягивания (холодная сталь). */
export const DRAW_COLOR = new Color3(0.82, 0.88, 0.98);
