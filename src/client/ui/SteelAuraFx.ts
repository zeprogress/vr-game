import type { Scene } from "@babylonjs/core/scene";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Effect } from "@babylonjs/core/Materials/effect";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { FXC } from "./fxColors";
import { GROUND_LIFT_GLSL } from "./groundLift";
import { groundFxThrough } from "./groundFx";
import { MV_HEAD, MV_OUT } from "./FireFx";

/**
 * «Аура раскалённой стали» (воин) — визуал шейдерами, в пуле (два экземпляра на сцену), из JS — позиция и время:
 *  vortex — спираль раскалённых искр: поднимается от ног к пояснице и гаснет (белое → оранжевое);
 *  halo   — раскалённый ореол над головой: тонкое кольцо, по которому бегут яркие дуги;
 *  ring   — светящийся кольцевой узор на земле (швы расплава по кругу);
 *  rays   — излучение от героя до границы ауры: по лучам бегут яркие импульсы наружу.
 * Цвет по режиму: 0 щит (жар), 1 один меч (холодная сталь — замедление), 2 дуалы (багрянец).
 */

const HIDE = "gl_Position = vec4(2.0, 2.0, 2.0, 1.0);";
const VORTEX = 24;
const RAYS = 18;
const HALO_Y = 2.3;
const VORTEX_H = 2.6;

Effect.ShadersStore["steelVortexVertexShader"] = `
precision highp float;
attribute vec3 position;
attribute float aIdx;
uniform mat4 viewProjection;
uniform mat4 view;
${MV_HEAD}
uniform vec3 uC;
uniform float uT;
uniform float uH;
uniform float uR;
uniform float uCount;
uniform float uRate;
varying vec2 vUV;
varying float vPh;
varying float vA;
void main() {
  float i = aIdx;
  if (i >= uCount) { ${HIDE} vUV = vec2(0.0); vPh = 0.0; vA = 0.0; return; }
  float ph = fract(i / uCount + uT * uRate);             // 0 у ног → 1 у пояса
  float a = i * 2.39996 + ph * 6.2831853 * 1.6;          // спираль
  float r = uR * (1.0 - 0.4 * ph);
  vec3 c = uC + vec3(cos(a) * r, 0.1 + ph * uH, sin(a) * r);
  vec3 right = vec3(view[0][0], view[1][0], view[2][0]);
  vec3 up = vec3(view[0][1], view[1][1], view[2][1]);
  float s = 0.13 * (1.0 - 0.5 * ph);
  vec3 p = c + (right * position.x + up * position.y) * s;
  vUV = position.xy + 0.5;
  vPh = ph;
  vA = smoothstep(0.0, 0.12, ph) * (1.0 - smoothstep(0.7, 1.0, ph));
  ${MV_OUT("p")}
}`;
Effect.ShadersStore["steelVortexFragmentShader"] = `
precision highp float;
varying vec2 vUV;
varying float vPh;
varying float vA;
uniform vec3 uHot;
uniform vec3 uMid;
uniform float uAlpha;
void main() {
  float d = length(vUV - 0.5) * 2.0;
  float a = pow(1.0 - clamp(d, 0.0, 1.0), 2.0) * vA * uAlpha;
  if (a <= 0.002) discard;
  vec3 col = mix(uHot, uMid, vPh);
  gl_FragColor = vec4(col * a, a);
}`;

Effect.ShadersStore["steelHaloVertexShader"] = `
precision highp float;
attribute vec3 position;
uniform mat4 viewProjection;
uniform vec3 cameraPosition;
${MV_HEAD}
uniform vec3 uC;
uniform float uR;
uniform float uH;
varying vec2 vUV;
void main() {
  // чуть наклонён: с боку виден как эллипс, сверху — кольцо
  vec4 wp = vec4(uC + vec3(position.x * uR, uH + position.z * uR * 0.22, position.z * uR), 1.0);
  vUV = position.xz * 0.5 + 0.5;
  ${MV_OUT("wp.xyz")}
}`;
Effect.ShadersStore["steelHaloFragmentShader"] = `
precision highp float;
varying vec2 vUV;
uniform float uT;
uniform float uAlpha;
uniform vec3 uHot;
uniform vec3 uMid;
void main() {
  vec2 p = vUV * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float ang = atan(p.y, p.x);
  float arc = pow(0.5 + 0.5 * sin(ang * 3.0 - uT * 2.2), 4.0);   // яркие дуги бегут по кольцу
  float band = smoothstep(0.80, 0.88, r) * (1.0 - smoothstep(0.93, 1.0, r));
  float a = band * (0.25 + 0.75 * arc) * uAlpha;
  if (a <= 0.002) discard;
  vec3 col = mix(uMid, uHot, arc);
  gl_FragColor = vec4(col * a, a);
}`;

Effect.ShadersStore["steelRingVertexShader"] = `
precision highp float;
attribute vec3 position;
uniform mat4 viewProjection;
uniform vec3 cameraPosition;
${MV_HEAD}
uniform vec3 uC;
uniform float uR;
varying vec2 vUV;
void main() {
  vec4 wp = vec4(uC + vec3(position.x * uR, 0.06, position.z * uR), 1.0);
  vUV = position.xz * 0.5 + 0.5;
  ${GROUND_LIFT_GLSL}
  ${MV_OUT("wp.xyz")}
}`;
Effect.ShadersStore["steelRingFragmentShader"] = `
precision highp float;
varying vec2 vUV;
uniform float uT;
uniform float uAlpha;
uniform vec3 uHot;
uniform vec3 uMid;
void main() {
  vec2 p = vUV * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float ang = atan(p.y, p.x);
  float seams = 0.5 + 0.5 * sin(ang * 8.0 + uT * 1.2);
  float seam2 = 0.5 + 0.5 * sin(ang * 16.0 - uT * 2.0 + 1.7);
  float band = smoothstep(0.84, 0.92, r) * (1.0 - smoothstep(0.97, 1.0, r));
  float glow = band * (0.25 + 0.75 * seams * seams) * (0.8 + 0.2 * seam2);
  float inner = (1.0 - smoothstep(0.0, 0.8, r)) * 0.10 * (0.6 + 0.4 * seam2);
  float a = (glow + inner) * uAlpha;
  if (a <= 0.002) discard;
  vec3 col = mix(uMid, uHot, glow);
  gl_FragColor = vec4(col * a, a);
}`;

// Излучение: лучи от героя до границы радиуса; по каждому бегут яркие импульсы наружу.
Effect.ShadersStore["steelRaysVertexShader"] = `
precision highp float;
attribute vec3 position;
attribute float aIdx;
uniform mat4 viewProjection;
uniform vec3 cameraPosition;
${MV_HEAD}
uniform vec3 uC;
uniform float uT;
uniform float uR;
uniform float uCount;
varying vec2 vUV;
varying float vI;
varying float vA;
float h(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
void main() {
  float i = aIdx;
  if (i >= uCount) { ${HIDE} vUV = vec2(0.0); vI = 0.0; vA = 0.0; return; }
  float a = (i + 0.35 * h(i)) / uCount * 6.2831853;
  vec3 dir = vec3(cos(a), 0.0, sin(a));
  vec3 s0 = uC + vec3(0.0, 1.2, 0.0) + dir * 0.9;
  vec3 s1 = uC + vec3(0.0, 1.2, 0.0) + dir * uR;
  vec3 p = mix(s0, s1, position.y);
  vec3 toCam = normalize(cameraPosition - p);
  vec3 side = normalize(cross(dir, toCam) + vec3(0.0001));
  float w = 0.05 * (1.0 - 0.55 * position.y);
  p += side * position.x * w;
  vUV = vec2(position.x + 0.5, position.y);
  vI = h(i + 7.0);
  vA = 1.0;
  ${MV_OUT("p")}
}`;
Effect.ShadersStore["steelRaysFragmentShader"] = `
precision highp float;
varying vec2 vUV;
varying float vI;
varying float vA;
uniform float uT;
uniform float uAlpha;
uniform vec3 uHot;
uniform vec3 uMid;
void main() {
  float s = vUV.y;
  float across = 1.0 - abs(vUV.x - 0.5) * 2.0;
  float speed = 0.55 + 0.35 * vI;
  float ph = fract(s * 1.1 - uT * speed + vI * 3.0);
  float pulse = pow(ph, 5.0) * (1.0 - smoothstep(0.6, 1.0, ph));
  float base = 0.12 * (1.0 - s);
  float fade = smoothstep(0.0, 0.12, s) * (1.0 - smoothstep(0.85, 1.0, s));
  float a = (base + pulse) * across * across * fade * uAlpha;
  if (a <= 0.002) discard;
  vec3 col = mix(uHot, uMid, s);
  gl_FragColor = vec4(col * a, a);
}`;

interface Instance {
  vortex: Mesh;
  vortexMat: ShaderMaterial;
  halo: Mesh;
  haloMat: ShaderMaterial;
  ring: Mesh;
  ringMat: ShaderMaterial;
  rays: Mesh;
  raysMat: ShaderMaterial;
  age: number;
  dur: number;
  R: number;
  track: (() => { x: number; y: number; z: number } | null) | null;
  c: { x: number; y: number; z: number };
  cv: Vector3;
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

  private readonly inst: Instance[] = [];
  private readonly obs: Observer<Scene>;

  private constructor(private readonly scene: Scene) {
    for (let k = 0; k < 2; k++) this.inst.push(this.make(k));
    this.obs = scene.onBeforeRenderObservable.add(() => this.update(Math.min(0.1, scene.getEngine().getDeltaTime() / 1000)));
  }

  /** Квады с атрибутом aIdx (индекс элемента): n элементов. */
  private quads(n: number, corners: [number, number][]): { pos: number[]; idx: number[]; attr: number[] } {
    const pos: number[] = [];
    const idx: number[] = [];
    const attr: number[] = [];
    const k = corners.length;
    for (let i = 0; i < n; i++) {
      for (const [x, y] of corners) {
        pos.push(x, y, 0);
        attr.push(i);
      }
      idx.push(i * k, i * k + 1, i * k + 2, i * k, i * k + 2, i * k + 3);
    }
    return { pos, idx, attr };
  }

  private make(k: number): Instance {
    // Спираль искр: квад на искру, центр в (0,0).
    const v = this.quads(VORTEX, [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]);
    const vortex = new Mesh(`steelVortex${k}`, this.scene);
    const vd = new VertexData();
    vd.positions = v.pos;
    vd.indices = v.idx;
    vd.applyToMesh(vortex);
    vortex.setVerticesData("aIdx", v.attr, false, 1);
    const vortexMat = this.mat("steelVortex", "steelVortex", ["position", "aIdx"], ["view", "uC", "uT", "uH", "uR", "uCount", "uRate", "uHot", "uMid", "uAlpha"]);
    vortex.material = vortexMat;
    vortexMat.setFloat("uCount", VORTEX);
    vortexMat.setFloat("uRate", 0.42);
    vortexMat.setFloat("uH", VORTEX_H);
    vortexMat.setFloat("uR", 1.05);
    this.finish(vortex);

    // Ореол: плоское кольцо над головой.
    const halo = new Mesh(`steelHalo${k}`, this.scene);
    const hd = new VertexData();
    hd.positions = [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1];
    hd.indices = [0, 2, 1, 0, 3, 2];
    hd.applyToMesh(halo);
    const haloMat = this.mat("steelHalo", "steelHalo", ["position"], ["uC", "uR", "uH", "uT", "uAlpha", "uHot", "uMid", "cameraPosition"]);
    halo.material = haloMat;
    haloMat.setFloat("uH", HALO_Y);
    this.finish(halo);

    // Кольцо на земле.
    const ring = new Mesh(`steelRing${k}`, this.scene);
    const rd = new VertexData();
    rd.positions = [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1];
    rd.indices = [0, 2, 1, 0, 3, 2];
    rd.applyToMesh(ring);
    const ringMat = this.mat("steelRing", "steelRing", ["position"], ["uC", "uR", "uT", "uAlpha", "uHot", "uMid", "cameraPosition"]);
    ring.material = ringMat;
    groundFxThrough(ring);
    this.finish(ring);

    // Излучение: лучи от героя до границы.
    const r = this.quads(RAYS, [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]]);
    const rays = new Mesh(`steelRays${k}`, this.scene);
    const rd2 = new VertexData();
    rd2.positions = r.pos;
    rd2.indices = r.idx;
    rd2.applyToMesh(rays);
    rays.setVerticesData("aIdx", r.attr, false, 1);
    const raysMat = this.mat("steelRays", "steelRays", ["position", "aIdx"], ["view", "uC", "uT", "uR", "uCount", "uHot", "uMid", "uAlpha"]);
    rays.material = raysMat;
    raysMat.setFloat("uCount", RAYS);
    this.finish(rays);

    return {
      vortex, vortexMat, halo, haloMat, ring, ringMat, rays, raysMat,
      age: 0, dur: 0, R: 6, track: null, c: { x: 0, y: 0, z: 0 }, cv: new Vector3(), live: false,
    };
  }

  private mat(name: string, base: string, attrs: string[], uniforms: string[]): ShaderMaterial {
    const m = new ShaderMaterial(name, this.scene, base, {
      attributes: attrs,
      uniforms: ["world", "viewProjection", "cameraPosition", ...uniforms],
      needAlphaBlending: true,
    });
    m.alphaMode = Constants.ALPHA_ADD;
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

  private mats(i: Instance): ShaderMaterial[] {
    return [i.vortexMat, i.haloMat, i.ringMat, i.raysMat];
  }

  /**
   * Запустить ауру: track — где воин (у ног), R — радиус кольца и лучей, dur — сколько держится, mode — цвет
   * (0 щит — жар, 1 один меч — холодная сталь, 2 дуалы — багрянец). Занят — самый давний.
   */
  start(track: () => { x: number; y: number; z: number } | null, R: number, dur: number, mode: number): void {
    const i = this.inst.find((x) => !x.live) ?? this.inst.reduce((a, b) => (a.age > b.age ? a : b));
    const p = track() ?? { x: 0, y: 0, z: 0 };
    const pal = mode === 1 ? [FXC.steel, FXC.frost] : mode === 2 ? [FXC.fireRed, FXC.fire] : [FXC.steelHot, FXC.fire];
    for (const m of this.mats(i)) {
      m.setColor3("uHot", pal[0]);
      m.setColor3("uMid", pal[1]);
    }
    i.R = R;
    i.dur = dur;
    i.age = 0;
    i.track = track;
    i.c = { ...p };
    i.live = true;
    for (const m of [i.vortex, i.halo, i.ring, i.rays]) m.setEnabled(true);
    this.apply(i, 0);
  }

  private apply(i: Instance, t: number): void {
    // Плавно появляется за 0.4 с, гаснет за 0.7 с до конца.
    const fin = Math.min(1, i.age / 0.4);
    const fout = Math.min(1, (i.dur - i.age) / 0.7);
    const a = Math.max(0, Math.min(fin, fout));
    i.cv.set(i.c.x, i.c.y, i.c.z);
    for (const m of this.mats(i)) {
      m.setFloat("uAlpha", a);
      m.setFloat("uT", t);
      m.setVector3("uC", i.cv);
    }
    i.haloMat.setFloat("uR", 0.85);
    i.ringMat.setFloat("uR", i.R);
    i.raysMat.setFloat("uR", i.R);
  }

  private update(dt: number): void {
    for (const i of this.inst) {
      if (!i.live) continue;
      i.age += dt;
      if (i.age >= i.dur) {
        i.live = false;
        for (const m of [i.vortex, i.halo, i.ring, i.rays]) m.setEnabled(false);
        continue;
      }
      const p = i.track?.();
      if (p) i.c = { x: p.x, y: p.y, z: p.z };
      this.apply(i, i.age);
    }
  }

  dispose(): void {
    this.scene.onBeforeRenderObservable.remove(this.obs);
    for (const i of this.inst) {
      for (const m of [i.vortex, i.halo, i.ring, i.rays]) m.dispose();
      for (const mt of this.mats(i)) mt.dispose();
    }
    pools.delete(this.scene);
  }
}
