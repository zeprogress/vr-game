import type { Scene } from "@babylonjs/core/scene";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Effect } from "@babylonjs/core/Materials/effect";
import { Constants } from "@babylonjs/core/Engines/constants";
import { FXC } from "./fxColors";
import { GROUND_LIFT_GLSL } from "./groundLift";
import { groundFxThrough } from "./groundFx";
import { MV_HEAD, MV_OUT } from "./FireFx";

/**
 * «Аура раскалённой стали» (воин) — свой визуал, без колец пламени:
 *  blades — шесть раскалённых клинков кружат вокруг воина на поясе (билборды; белое ядро → оранжевый край);
 *  column — мягкое марево-столб: вертикальные струи жара поднимаются вверх и гаснут;
 *  ring   — светящийся кольцевой узор на земле: расплавленные швы бегут по кругу, внутри — тлеющая сталь.
 * Всё ведёт шейдер по времени и позиции (uC), из JS — пара чисел за кадр; меши пулом, два экземпляра на сцену.
 * Цвет по режиму: 0 щит (жар), 1 один меч (холодная сталь — замедление), 2 дуалы (багрянец).
 */

const BLADES = 6;
const HIDE = "gl_Position = vec4(2.0, 2.0, 2.0, 1.0);";

Effect.ShadersStore["steelBladeVertexShader"] = `
precision highp float;
attribute vec3 position;
attribute float aIdx;
uniform mat4 viewProjection;
uniform mat4 view;
${MV_HEAD}
uniform vec3 uC;
uniform float uT;
uniform float uR;
uniform float uH;
uniform float uCount;
uniform float uSpin;
varying vec2 vUV;
varying float vA;
void main() {
  float i = aIdx;
  if (i >= uCount) { ${HIDE} vUV = vec2(0.0); vA = 0.0; return; }
  float a = i / uCount * 6.2831853 + uT * uSpin;
  float bob = sin(uT * 2.3 + i * 1.7) * 0.12;
  float tilt = 0.55 + 0.25 * sin(uT * 1.1 + i * 2.0);
  vec3 c = uC + vec3(cos(a) * uR, uH + bob, sin(a) * uR);
  vec3 tang = vec3(-sin(a), 0.0, cos(a));
  vec3 along = normalize(tang * cos(tilt) + vec3(0.0, 1.0, 0.0) * sin(tilt));
  vec3 right = vec3(view[0][0], view[1][0], view[2][0]);
  vec3 p = c + along * (position.y - 0.4) * 0.62 + right * position.x * 0.085;
  vUV = vec2(position.x + 0.5, position.y);
  vA = 0.75 + 0.25 * sin(uT * 9.0 + i * 2.1);
  ${MV_OUT("p")}
}`;
Effect.ShadersStore["steelBladeFragmentShader"] = `
precision highp float;
varying vec2 vUV;
varying float vA;
uniform vec3 uHot;
uniform vec3 uMid;
uniform vec3 uEdge;
uniform float uAlpha;
void main() {
  float w = 1.0 - abs(vUV.x - 0.5) * 2.0;           // поперёк: светлая сердцевина, мягкий край
  float along = vUV.y;                              // вдоль: раскалённое основание → остывающий кончик
  float core = smoothstep(0.0, 0.7, w);
  vec3 col = mix(uEdge, uMid, smoothstep(0.0, 0.8, along));
  col = mix(col, uHot, core * (1.0 - along * 0.8));
  float tip = smoothstep(1.0, 0.55, along);
  float a = w * w * tip * vA * uAlpha;
  if (a <= 0.002) discard;
  gl_FragColor = vec4(col * a, a);
}`;

Effect.ShadersStore["steelColumnVertexShader"] = `
precision highp float;
attribute vec3 position;
uniform mat4 viewProjection;
uniform mat4 view;
${MV_HEAD}
uniform vec3 uC;
uniform float uW;
uniform float uH;
varying vec2 vUV;
void main() {
  vec3 right = normalize(vec3(view[0][0], 0.0, view[2][0]));
  vec3 p = uC + right * position.x * uW + vec3(0.0, position.y * uH, 0.0);
  vUV = vec2(position.x + 0.5, position.y);
  ${MV_OUT("p")}
}`;
Effect.ShadersStore["steelColumnFragmentShader"] = `
precision highp float;
varying vec2 vUV;
uniform float uT;
uniform vec3 uHot;
uniform vec3 uMid;
uniform float uAlpha;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float x = abs(vUV.x - 0.5) * 2.0;                // 0 — ось столба, 1 — край
  float y = vUV.y;                                 // 0 — земля, 1 — верх
  float side = smoothstep(1.0, 0.25, x);
  // струи жара: вытянутый шум, ползущий вверх
  float streak = vn(vec2(vUV.x * 6.0, y * 2.0 - uT * 1.6)) * 0.7 + vn(vec2(vUV.x * 13.0 + 3.0, y * 3.5 - uT * 2.4)) * 0.3;
  float rise = smoothstep(0.0, 0.25, y) * (1.0 - smoothstep(0.6, 1.0, y));
  float a = side * rise * smoothstep(0.35, 0.8, streak) * uAlpha * 0.7;
  if (a <= 0.002) discard;
  vec3 col = mix(uMid, uHot, streak);
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
  // швы расплавленного металла: бегут по кругу, перемежаются тёмной сталью
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

interface Instance {
  blades: Mesh;
  bladesMat: ShaderMaterial;
  column: Mesh;
  columnMat: ShaderMaterial;
  ring: Mesh;
  ringMat: ShaderMaterial;
  age: number;
  dur: number;
  R: number;
  track: (() => { x: number; y: number; z: number } | null) | null;
  c: { x: number; y: number; z: number };
  /** Центр в шейдерах (без новых векторов на кадр). */
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

  private make(k: number): Instance {
    // Клинки: восемь слотов, из них BLADES видимых — квад на клинок (x — ширина, y — длина).
    const bladeQuads = { pos: [] as number[], idx: [] as number[], attr: [] as number[] };
    for (let i = 0; i < 8; i++) {
      for (const [x, y] of [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]]) {
        bladeQuads.pos.push(x, y, 0);
        bladeQuads.attr.push(i);
      }
      bladeQuads.idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    }
    const blades = new Mesh(`steelBlades${k}`, this.scene);
    const bd = new VertexData();
    bd.positions = bladeQuads.pos;
    bd.indices = bladeQuads.idx;
    bd.applyToMesh(blades);
    blades.setVerticesData("aIdx", bladeQuads.attr, false, 1);
    const bladesMat = this.mat("steelBlade", "steelBlade", ["position", "aIdx"], ["view", "uC", "uT", "uR", "uH", "uCount", "uSpin", "uHot", "uMid", "uEdge", "uAlpha"]);
    blades.material = bladesMat;
    bladesMat.setFloat("uCount", BLADES);
    bladesMat.setFloat("uSpin", 1.6);
    bladesMat.setFloat("uR", 1.6);
    bladesMat.setFloat("uH", 1.1);
    this.finish(blades);

    const column = new Mesh(`steelColumn${k}`, this.scene);
    const cd = new VertexData();
    cd.positions = [-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0];
    cd.indices = [0, 1, 2, 0, 2, 3];
    cd.applyToMesh(column);
    const columnMat = this.mat("steelColumn", "steelColumn", ["position"], ["view", "uC", "uW", "uH", "uT", "uHot", "uMid", "uAlpha"]);
    column.material = columnMat;
    columnMat.setFloat("uW", 1.1);
    columnMat.setFloat("uH", 3.2);
    this.finish(column);

    const ring = new Mesh(`steelRing${k}`, this.scene);
    const rd = new VertexData();
    rd.positions = [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1];
    rd.indices = [0, 2, 1, 0, 3, 2];
    rd.applyToMesh(ring);
    const ringMat = this.mat("steelRing", "steelRing", ["position"], ["uC", "uR", "uT", "uAlpha", "uHot", "uMid", "cameraPosition"]);
    ring.material = ringMat;
    groundFxThrough(ring);
    this.finish(ring);

    return {
      blades, bladesMat, column, columnMat, ring, ringMat,
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
    m.setColor3("uEdge", FXC.fireRed);
    return m;
  }

  private finish(mesh: Mesh): void {
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.setEnabled(false);
  }

  /**
   * Запустить ауру: track — где воин (у ног), R — радиус кольца на земле, dur — сколько держится, mode — цвет
   * (0 щит — жар, 1 один меч — холодная сталь, 2 дуалы — багрянец). Занят — самый давний.
   */
  start(track: () => { x: number; y: number; z: number } | null, R: number, dur: number, mode: number): void {
    const i = this.inst.find((x) => !x.live) ?? this.inst.reduce((a, b) => (a.age > b.age ? a : b));
    const p = track() ?? { x: 0, y: 0, z: 0 };
    const pal = mode === 1 ? [FXC.steel, FXC.steelHot, FXC.frost] : mode === 2 ? [FXC.fireRed, FXC.fire, FXC.fireRed] : [FXC.steelHot, FXC.fire, FXC.fireRed];
    for (const m of [i.bladesMat, i.columnMat, i.ringMat]) {
      m.setColor3("uHot", pal[0]);
      m.setColor3("uMid", pal[1]);
      m.setColor3("uEdge", pal[2]);
    }
    i.R = R;
    i.dur = dur;
    i.age = 0;
    i.track = track;
    i.c = { ...p };
    i.live = true;
    i.blades.setEnabled(true);
    i.column.setEnabled(true);
    i.ring.setEnabled(true);
    this.apply(i, 0);
  }

  private apply(i: Instance, t: number): void {
    // Плавно появляется за 0.4 с, гаснет за 0.7 с до конца.
    const fin = Math.min(1, i.age / 0.4);
    const fout = Math.min(1, (i.dur - i.age) / 0.7);
    const a = Math.max(0, Math.min(fin, fout));
    const c = i.c;
    i.cv.set(c.x, c.y, c.z);
    for (const m of [i.bladesMat, i.columnMat, i.ringMat]) {
      m.setFloat("uAlpha", a);
      m.setFloat("uT", t);
      m.setVector3("uC", i.cv);
    }
    i.ringMat.setFloat("uR", i.R);
  }

  private update(dt: number): void {
    for (const i of this.inst) {
      if (!i.live) continue;
      i.age += dt;
      if (i.age >= i.dur) {
        i.live = false;
        i.blades.setEnabled(false);
        i.column.setEnabled(false);
        i.ring.setEnabled(false);
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
      for (const m of [i.blades, i.column, i.ring]) m.dispose();
      for (const mt of [i.bladesMat, i.columnMat, i.ringMat]) mt.dispose();
    }
    pools.delete(this.scene);
  }
}

export const STEEL_RING_COLOR = new Color3(1, 0.62, 0.28);
