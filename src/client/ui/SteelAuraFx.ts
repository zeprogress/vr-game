import type { Scene } from "@babylonjs/core/scene";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Effect } from "@babylonjs/core/Materials/effect";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { FXC } from "./fxColors";
import { MV_HEAD, MV_OUT } from "./FireFx";

/**
 * «Аура раскалённой стали» (воин) — горячий воздух.
 *  dome  — прозрачный купол по всей площади ауры: воздух у воина дрожит и поднимается. Поверхность слегка
 *          колышется (вершинный шейдер), по краям ярче (френель), у земли гаснет, вверху растворяется.
 *  wisp  — тепловой столб у каждого врага в ауре: струи жара ползут вверх, живут ~1 с (обновляются каждый тик).
 * Меши и материалы — пулом, из JS — позиция и время за кадр. Цвет по режиму: 0 щит (жар), 1 один меч
 * (холодная сталь — замедление), 2 дуалы (багрянец).
 */

const WISPS = 10;
const WISP_LIFE = 1.0;

Effect.ShadersStore["steelDomeVertexShader"] = `
precision highp float;
attribute vec3 position;
uniform mat4 viewProjection;
uniform vec3 cameraPosition;
${MV_HEAD}
uniform vec3 uC;
uniform float uR;
uniform float uT;
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 n = normalize(position);
  // колыхание воздуха: мягкие волны по поверхности, медленнее у верха
  float wob = sin(n.y * 5.0 + uT * 2.3 + sin(n.x * 7.0 + uT * 1.7) * 0.8) * 0.035 + sin(n.z * 9.0 - uT * 3.1) * 0.02;
  vec3 p = uC + n * uR * (1.0 + wob);
  vN = n;
  vW = p;
  ${MV_OUT("p")}
}`;
Effect.ShadersStore["steelDomeFragmentShader"] = `
precision highp float;
varying vec3 vN;
varying vec3 vW;
uniform vec3 cameraPosition;
uniform vec3 uC;
uniform float uT;
uniform float uAlpha;
uniform vec3 uHot;
uniform vec3 uMid;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float fr = pow(1.0 - abs(dot(N, V)), 2.0);                     // края купола ярче
  float feet = uC.y - 1.0;
  float hgt = vW.y - feet;                                       // высота над ногами
  float fade = smoothstep(0.0, 0.9, hgt) * (1.0 - smoothstep(3.2, 5.4, hgt));
  // дрожание воздуха: ползущие вверх струи, отдельно для каждого направления
  float ang = atan(N.z, N.x);
  float shim = vn(vec2(ang * 4.0, hgt * 1.6 - uT * 1.8)) * 0.65 + vn(vec2(ang * 9.0 + 2.0, hgt * 3.2 - uT * 2.9)) * 0.35;
  float a = (0.035 + 0.25 * fr) * (0.45 + 0.55 * shim) * fade * uAlpha;
  if (a <= 0.002) discard;
  vec3 col = mix(uMid, uHot, fr);
  gl_FragColor = vec4(col * a, a);
}`;

Effect.ShadersStore["steelWispVertexShader"] = `
precision highp float;
attribute vec3 position;
uniform mat4 viewProjection;
uniform mat4 view;
${MV_HEAD}
uniform vec3 uC;
uniform float uH;
uniform float uW;
varying vec2 vUV;
void main() {
  vec3 right = normalize(vec3(view[0][0], 0.0, view[2][0]));
  vec3 p = uC + right * position.x * uW + vec3(0.0, position.y * uH, 0.0);
  vUV = vec2(position.x + 0.5, position.y);
  ${MV_OUT("p")}
}`;
Effect.ShadersStore["steelWispFragmentShader"] = `
precision highp float;
varying vec2 vUV;
uniform float uT;
uniform float uAge;
uniform float uAlpha;
uniform vec3 uHot;
uniform vec3 uMid;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float x = abs(vUV.x - 0.5) * 2.0;
  float y = vUV.y;
  float side = smoothstep(1.0, 0.2, x);
  float streak = vn(vec2(vUV.x * 6.0, y * 2.2 - uT * 2.2)) * 0.7 + vn(vec2(vUV.x * 13.0 + 3.0, y * 3.8 - uT * 3.4)) * 0.3;
  float rise = smoothstep(0.0, 0.2, y) * (1.0 - smoothstep(0.55, 1.0, y));
  float life = 1.0 - uAge;
  float a = side * rise * smoothstep(0.4, 0.8, streak) * life * uAlpha * 0.8;
  if (a <= 0.002) discard;
  vec3 col = mix(uMid, uHot, streak);
  gl_FragColor = vec4(col * a, a);
}`;

interface Dome {
  mesh: Mesh;
  mat: ShaderMaterial;
  age: number;
  dur: number;
  R: number;
  track: (() => { x: number; y: number; z: number } | null) | null;
  /** Чья аура (id героя): повторный старт той же ауры переиспользует купол — две ауры одного воина не рисуются. */
  key?: string;
  c: Vector3;
  live: boolean;
}
interface Wisp {
  mesh: Mesh;
  mat: ShaderMaterial;
  age: number;
  live: boolean;
}

const pools = new WeakMap<Scene, SteelAuraFx>();

export class SteelAuraFx {
  static of(scene: Scene): SteelAuraFx {
    let fx = pools.get(scene);
    if (!fx) {
      fx = new SteelAuraFx(scene);
      pools.set(scene, fx);
    }
    return fx;
  }

  private readonly domes: Dome[] = [];
  private readonly wisps: Wisp[] = [];
  private nW = 0;
  private readonly obs: Observer<Scene>;

  private constructor(private readonly scene: Scene) {
    for (let k = 0; k < 2; k++) this.domes.push(this.makeDome(k));
    for (let k = 0; k < WISPS; k++) this.wisps.push(this.makeWisp(k));
    this.obs = scene.onBeforeRenderObservable.add(() => this.update(Math.min(0.1, scene.getEngine().getDeltaTime() / 1000)));
  }

  private mat(name: string, base: string, attrs: string[], uniforms: string[], mode: number): ShaderMaterial {
    const m = new ShaderMaterial(name, this.scene, base, {
      attributes: attrs,
      uniforms: ["world", "viewProjection", "cameraPosition", ...uniforms],
      needAlphaBlending: true,
    });
    m.alphaMode = mode;
    m.disableDepthWrite = true;
    m.backFaceCulling = false;
    m.setColor3("uHot", FXC.steelHot);
    m.setColor3("uMid", FXC.fire);
    return m;
  }

  private finish(mesh: Mesh): void {
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.setEnabled(false);
  }

  private makeDome(k: number): Dome {
    const mesh = MeshBuilder.CreateSphere(`steelDome${k}`, { diameter: 2, segments: 22 }, this.scene);
    const mat = this.mat("steelDome", "steelDome", ["position"], ["uC", "uR", "uT", "uAlpha"], Constants.ALPHA_ADD);
    mesh.material = mat;
    this.finish(mesh);
    return { mesh, mat, age: 0, dur: 0, R: 6, track: null, c: new Vector3(), live: false };
  }

  private makeWisp(k: number): Wisp {
    const mesh = new Mesh(`steelWisp${k}`, this.scene);
    const vd = new VertexData();
    vd.positions = [-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0];
    vd.indices = [0, 1, 2, 0, 2, 3];
    vd.applyToMesh(mesh);
    const mat = this.mat("steelWisp", "steelWisp", ["position"], ["view", "uC", "uH", "uW", "uT", "uAge", "uAlpha"], Constants.ALPHA_ADD);
    mesh.material = mat;
    mat.setFloat("uH", 2.1);
    mat.setFloat("uW", 0.55);
    this.finish(mesh);
    return { mesh, mat, age: 0, live: false };
  }

  /** Аура: купол на всю площадь (track — ноги воина), R — радиус, dur — сколько держится, mode — цвет. */
  start(track: () => { x: number; y: number; z: number } | null, R: number, dur: number, mode: number, key?: string): void {
    const d = (key !== undefined ? this.domes.find((x) => x.live && x.key === key) : undefined) ?? this.domes.find((x) => !x.live) ?? this.domes.reduce((a, b) => (a.age > b.age ? a : b));
    d.key = key;
    const p = track() ?? { x: 0, y: 0, z: 0 };
    const pal = mode === 1 ? [FXC.steel, FXC.frost] : mode === 2 ? [FXC.fireRed, FXC.fire] : [FXC.steelHot, FXC.fire];
    d.mat.setColor3("uHot", pal[0]);
    d.mat.setColor3("uMid", pal[1]);
    d.R = R;
    d.dur = dur;
    d.age = 0;
    d.track = track;
    d.c.set(p.x, p.y + 1, p.z);
    d.live = true;
    d.mesh.setEnabled(true);
    this.applyDome(d, 0);
  }

  private applyDome(d: Dome, t: number): void {
    const fin = Math.min(1, d.age / 0.5);
    const fout = Math.min(1, (d.dur - d.age) / 0.8);
    d.mat.setFloat("uAlpha", Math.max(0, Math.min(fin, fout)));
    d.mat.setFloat("uT", t);
    d.mat.setFloat("uR", d.R);
    d.mat.setVector3("uC", d.c);
  }

  /** Тепловой столб у врага в ауре (mode — цвет); живёт WISP_LIFE, каждый тик обновляется новым. */
  wisp(x: number, y: number, z: number, mode: number): void {
    const w = this.wisps.find((q) => !q.live) ?? this.wisps[this.nW];
    this.nW = (this.nW + 1) % this.wisps.length;
    const pal = mode === 1 ? [FXC.steel, FXC.frost] : mode === 2 ? [FXC.fireRed, FXC.fire] : [FXC.steelHot, FXC.fire];
    w.mat.setColor3("uHot", pal[0]);
    w.mat.setColor3("uMid", pal[1]);
    w.mat.setVector3("uC", new Vector3(x, y, z));
    w.mat.setFloat("uAge", 0);
    w.age = 0;
    w.live = true;
    w.mesh.setEnabled(true);
  }

  private update(dt: number): void {
    for (const d of this.domes) {
      if (!d.live) continue;
      d.age += dt;
      if (d.age >= d.dur) {
        d.live = false;
        d.mesh.setEnabled(false);
        continue;
      }
      const p = d.track?.();
      if (p) d.c.set(p.x, p.y + 1, p.z);
      this.applyDome(d, d.age);
    }
    for (const w of this.wisps) {
      if (!w.live) continue;
      w.age += dt;
      if (w.age >= WISP_LIFE) {
        w.live = false;
        w.mesh.setEnabled(false);
        continue;
      }
      w.mat.setFloat("uAge", w.age / WISP_LIFE);
      w.mat.setFloat("uT", w.age);
    }
  }

  dispose(): void {
    this.scene.onBeforeRenderObservable.remove(this.obs);
    for (const d of this.domes) {
      d.mesh.dispose();
      d.mat.dispose();
    }
    for (const w of this.wisps) {
      w.mesh.dispose();
      w.mat.dispose();
    }
    pools.delete(this.scene);
  }
}
