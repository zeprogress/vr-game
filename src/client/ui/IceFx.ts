import { FXC } from "./fxColors";
import { GROUND_LIFT_GLSL } from "./groundLift";
import { groundFxThrough } from "./groundFx";
import "./SkillVfx"; // шейдер искр fxSparks (Effect.ShadersStore)
import type { Scene } from "@babylonjs/core/scene";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Effect } from "@babylonjs/core/Materials/effect";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

/**
 * Лёд Ледяного гиганта (ICE_GIANT) — всё рисуют шейдеры, из JS — пара чисел за кадр; меши и материалы
 * создаются пулом один раз (никаких clone в бою), стерео в шлеме — MULTIVIEW за один проход.
 *
 *  shards — группа кристаллов-шипов, позы считает вершинный шейдер по номеру кристалла:
 *           кольцо (раскол), гряда (разлом), клетка вокруг героя («Ледяная глыба»), воронка осколков
 *           (удар глыбы), сама глыба (кристаллы во все стороны, крутится), кристаллы стаков вокруг героя;
 *  decal  — на земле: иней (наледь), кольцо ауры «Стужа», круг-телеграф, полоса-телеграф, ударная волна;
 *  snow   — снег вокруг гиганта (метель в «Ледяной ярости»);
 *  sparks — искры инея (тот же шейдер, что у SkillVfx).
 * Один экземпляр на сцену: IceFx.of(scene) — сам обновляется перед кадром.
 */

const MV_HEAD = `
#ifdef MULTIVIEW
uniform mat4 viewProjectionR;
#endif`;
const MV_OUT = (p: string) => `
#ifdef MULTIVIEW
  if (gl_ViewID_OVR == 0u) { gl_Position = viewProjection * vec4(${p}, 1.0); } else { gl_Position = viewProjectionR * vec4(${p}, 1.0); }
#else
  gl_Position = viewProjection * vec4(${p}, 1.0);
#endif`;
const HIDE = "gl_Position = vec4(2.0, 2.0, 2.0, 1.0);";

/** Режимы группы кристаллов (uMode). */
export const SHARD = { ring: 0, line: 1, cage: 2, crater: 3, boulder: 4, orbit: 5 } as const;
/** Режимы знака на земле (uMode). */
export const DECAL = { frost: 0, aura: 1, circle: 2, strip: 3, wave: 4 } as const;

// ---------------------------------------------------------------- кристаллы

const SHARDS = 36;
Effect.ShadersStore["iceShardVertexShader"] = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute float aIdx;
uniform mat4 viewProjection;
${MV_HEAD}
uniform vec3 uA;
uniform vec3 uB;
uniform float uR;
uniform float uW;
uniform float uSpeed;
uniform float uTime;
uniform float uHold;
uniform float uSize;
uniform float uMode;
uniform float uSeed;
uniform float uCount;
uniform float uSpin;
varying vec3 vN;
varying vec3 vW;
varying float vTop;
varying float vFlash;
varying float vFade;
float hash(float n) { return fract(sin(n * 12.9898 + uSeed) * 43758.5453); }
void main() {
  float i = aIdx;
  if (i >= uCount) { ${HIDE} vN = vec3(0.0); vW = vec3(0.0); vTop = 0.0; vFlash = 0.0; vFade = 0.0; return; }
  float h1 = hash(i * 1.7 + 0.3);
  float h2 = hash(i * 3.1 + 1.1);
  float h3 = hash(i * 5.3 + 2.7);
  float h4 = hash(i * 7.9 + 3.9);
  float h5 = hash(i * 9.7 + 5.1);
  const float TAU = 6.2831853;
  vec3 base = uA;
  vec3 axis = vec3(0.0, 1.0, 0.0);
  float height = uSize;
  float t0 = 0.0;
  bool airborne = uMode > 3.5; // глыба и кристаллы стаков — в воздухе, не растут из земли
  if (uMode < 0.5) {
    // кольцо: внешнее — крупные наклонены наружу, треть — мельче и ближе к центру
    float inner = step(0.66, h5);
    float ang = (i + h1 * 0.7) / uCount * TAU;
    float rad = uR * mix(0.8 + 0.28 * h2, 0.45 + 0.2 * h2, inner);
    vec2 d = vec2(cos(ang), sin(ang));
    base = uA + vec3(d.x * rad, 0.0, d.y * rad);
    float lean = 0.25 + 0.4 * h3;
    axis = normalize(vec3(d.x * lean, 1.0, d.y * lean));
    height = uSize * (0.6 + 0.7 * h4) * mix(1.0, 0.6, inner);
    t0 = 0.04 * h1 + rad / max(uR, 0.01) * 0.1;
  } else if (uMode < 1.5) {
    // гряда: от A к B, по обе стороны оси; поднимается, когда до кристалла добежит фронт
    vec2 ab = uB.xz - uA.xz;
    float len = length(ab);
    vec2 dir = len > 0.01 ? ab / len : vec2(0.0, 1.0);
    vec2 perp = vec2(-dir.y, dir.x);
    float along = (i + h1 * 0.9) / uCount * len;
    float side = (h2 - 0.5) * 2.0;
    float lat = side * uW * (0.2 + 0.8 * h3);
    vec2 p = uA.xz + dir * along + perp * lat;
    base = vec3(p.x, mix(uA.y, uB.y, along / max(len, 0.01)), p.y);
    float s = sign(side) * 0.35 * h4;
    axis = normalize(vec3(dir.x * 0.3 + perp.x * s, 1.0, dir.y * 0.3 + perp.y * s));
    height = uSize * (0.55 + 0.75 * h4) * (1.0 - 0.45 * abs(lat) / max(uW, 0.01));
    t0 = along / max(uSpeed, 0.1);
  } else if (uMode < 2.5) {
    // клетка: кристаллы вокруг героя, наклонены внутрь — «вмёрз»
    float ang = i / uCount * TAU + h1 * 0.5;
    float rad = uR * (0.8 + 0.35 * h2);
    vec2 d = vec2(cos(ang), sin(ang));
    base = uA + vec3(d.x * rad, 0.0, d.y * rad);
    float lean = 0.3 + 0.25 * h3;
    axis = normalize(vec3(-d.x * lean, 1.0, -d.y * lean));
    height = uSize * (0.7 + 0.55 * h4);
    t0 = 0.1 * h1;
  } else if (uMode < 3.5) {
    // воронка: осколки по кругу, сильно наклонены наружу, к краю ниже
    float ang = h1 * TAU;
    float rr = sqrt(h2);
    vec2 d = vec2(cos(ang), sin(ang));
    base = uA + vec3(d.x * rr * uR, 0.0, d.y * rr * uR);
    float lean = 0.5 + 0.7 * h3;
    axis = normalize(vec3(d.x * lean, 1.0, d.y * lean));
    height = uSize * (0.35 + 0.65 * h4) * (1.0 - 0.5 * rr);
    t0 = 0.03 * h1 + rr * 0.07;
  } else if (uMode < 4.5) {
    // глыба: кристаллы во все стороны от центра, вся глыба крутится
    float z = h1 * 2.0 - 1.0;
    float a = h2 * TAU + uTime * uSpin;
    float s = sqrt(1.0 - z * z);
    axis = vec3(s * cos(a), z, s * sin(a));
    base = uA - axis * uR * 0.35;
    height = uSize * (0.6 + 0.6 * h4);
  } else {
    // стаки обморожения: кристаллы кружат вокруг героя на уровне пояса
    float ang = i / max(uCount, 1.0) * TAU + uTime * 1.7;
    base = uA + vec3(cos(ang) * uR, 1.0 + 0.12 * sin(uTime * 2.3 + i * 1.9), sin(ang) * uR);
    axis = normalize(vec3(-sin(ang) * 0.5, 1.0, cos(ang) * 0.5));
    height = uSize;
  }
  float age = uTime - t0;
  float fade = 1.0 - smoothstep(uHold, uHold + 0.4, age);
  if (age < 0.0 || fade <= 0.0) { ${HIDE} vN = vec3(0.0); vW = vec3(0.0); vTop = 0.0; vFlash = 0.0; vFade = 0.0; return; }
  float g = airborne ? 1.0 : clamp(age / 0.14, 0.0, 1.0);
  float gm = g - 1.0;
  float grow = 1.0 + 2.70158 * gm * gm * gm + 1.70158 * gm * gm; // рост с перелётом
  float hgt = height * grow * mix(0.25, 1.0, fade);
  float rad = height * (0.15 + 0.08 * h5) * mix(0.5, 1.0, g) * mix(0.3, 1.0, fade);
  vec3 ref = abs(axis.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 tx = normalize(cross(ref, axis));
  vec3 tz = cross(axis, tx);
  float sp = h3 * TAU;
  vec3 bx = tx * cos(sp) + tz * sin(sp);
  vec3 bz = -tx * sin(sp) + tz * cos(sp);
  vec3 sink = airborne ? vec3(0.0) : vec3(0.0, -height * 0.18 - (1.0 - fade) * height * 0.5, 0.0);
  vec3 wp = base + sink + bx * position.x * rad + axis * position.y * hgt + bz * position.z * rad;
  vN = normalize(bx * normal.x * hgt + axis * normal.y * rad + bz * normal.z * hgt);
  vW = wp;
  vTop = position.y;
  vFlash = 1.0 - g;
  vFade = fade;
  ${MV_OUT("wp")}
}`;
Effect.ShadersStore["iceShardFragmentShader"] = `
precision highp float;
varying vec3 vN;
varying vec3 vW;
varying float vTop;
varying float vFlash;
varying float vFade;
uniform vec3 cameraPosition;
uniform vec3 uDeep;
uniform vec3 uIce;
uniform vec3 uRim;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  if (dot(N, V) < 0.0) N = -N;
  vec3 L = normalize(vec3(0.35, 0.85, 0.4));
  float dif = 0.45 + 0.55 * max(dot(N, L), 0.0);
  float fr = pow(1.0 - max(dot(N, V), 0.0), 2.2);
  float spec = pow(max(dot(reflect(-L, N), V), 0.0), 28.0);
  vec3 body = mix(uDeep, uIce, smoothstep(0.0, 0.95, vTop));
  vec3 c = body * dif + uRim * (fr * 0.85 + spec * 0.8) + uDeep * 0.35;
  c += vec3(0.9, 0.97, 1.0) * vFlash * 0.7;
  c = mix(c, uRim, (1.0 - vFade) * 0.5);
  gl_FragColor = vec4(c, 1.0);
}`;

/** Кристалл: шестигранная призма с острой верхушкой и дном (ось +Y, высота 1, радиус 1), грани — плоские. */
function shardGeometry(): { pos: number[]; nrm: number[]; idx: number[]; aIdx: number[] } {
  const ring = (y: number, r: number) => Array.from({ length: 6 }, (_, k) => {
    const a = (k / 6) * Math.PI * 2;
    return new Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
  });
  const lo = ring(0, 1);
  const hi = ring(0.68, 0.92);
  const top = new Vector3(0.06, 1, -0.04);
  const bot = new Vector3(0, -0.12, 0);
  const tris: Vector3[][] = [];
  for (let k = 0; k < 6; k++) {
    const n = (k + 1) % 6;
    tris.push([lo[k], hi[k], hi[n]], [lo[k], hi[n], lo[n]], [hi[k], top, hi[n]], [lo[n], bot, lo[k]]);
  }
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const aIdx: number[] = [];
  for (let s = 0; s < SHARDS; s++) {
    for (const [a, b, c] of tris) {
      const fn = Vector3.Cross(c.subtract(a), b.subtract(a)).normalize();
      for (const v of [a, b, c]) {
        idx.push(pos.length / 3);
        pos.push(v.x, v.y, v.z);
        nrm.push(fn.x, fn.y, fn.z);
        aIdx.push(s);
      }
    }
  }
  return { pos, nrm, idx, aIdx };
}

export interface ShardGroup {
  mesh: Mesh;
  mat: ShaderMaterial;
  a: Vector3;
  b: Vector3;
  age: number;
  life: number;
  /** Глыба / кристаллы стаков: центр каждый кадр (null — стоит на месте). */
  track: (() => { x: number; y: number; z: number } | null) | null;
  /** Чьи кристаллы стаков (id героя), "" — не стаки. */
  owner: string;
}

// ---------------------------------------------------------------- знаки на земле

Effect.ShadersStore["iceDecalVertexShader"] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 viewProjection;
uniform vec3 cameraPosition;
${MV_HEAD}
varying vec2 vUV;
void main() {
  vUV = uv;
  vec4 wp = world * vec4(position, 1.0);
  ${GROUND_LIFT_GLSL}
  ${MV_OUT("wp.xyz")}
}`;
Effect.ShadersStore["iceDecalFragmentShader"] = `
precision highp float;
varying vec2 vUV;
uniform vec3 uIce;
uniform vec3 uRim;
uniform float uT;      // прогресс 0..1 (телеграф, волна) или секунды (иней, аура)
uniform float uMode;   // 0 иней, 1 аура, 2 круг-телеграф, 3 полоса-телеграф, 4 ударная волна
uniform float uAlpha;
uniform float uSeed;
uniform float uTime;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453); }
// Кристаллы инея: лучи от центра с отростками (n лучей, ширина w).
float rays(float ang, float r, float n, float w, float seed) {
  float k = (ang / 6.2831853 + 0.5) * n + seed;
  float d = abs(fract(k) - 0.5) / n * 6.2831853 * r;
  return smoothstep(w, 0.0, d);
}
void main() {
  vec2 p = vUV * 2.0 - 1.0;
  float r = length(p);
  float ang = atan(p.y, p.x);
  float a = 0.0;
  vec3 col = uRim;
  if (uMode < 0.5) {
    // иней: ветви кристаллов + ячейки льда + искорки; края неровные
    if (r > 1.0) discard;
    float edge = 0.86 + 0.14 * hash(vec2(floor((ang + 3.1416) * 4.0), 1.0));
    float body = smoothstep(edge, edge - 0.18, r);
    float br = rays(ang, r, 9.0, 0.03 * (1.2 - r), 0.13) * step(r, edge)
             + rays(ang + 0.21, r, 17.0, 0.018, 0.71) * smoothstep(0.25, 0.4, r) * step(r, edge * 0.92);
    vec2 cell = floor(p * 7.0);
    float cells = smoothstep(0.42, 0.5, abs(fract(p.x * 7.0 + hash(cell) * 0.3) - 0.5)) * 0.25;
    float tw = step(0.985, hash(floor(p * 46.0))) * (0.5 + 0.5 * sin(uTime * 6.0 + hash(floor(p * 46.0) + 3.0) * 30.0));
    a = (body * 0.32 + br * 0.65 * body + cells * body + tw * body * 1.2);
    col = mix(uIce, uRim, 0.6 + 0.4 * br);
  } else if (uMode < 1.5) {
    // аура «Стужа»: мягкое кольцо, морозная дымка внутри, медленно бегущие лучи
    if (r > 1.0) discard;
    float ring = exp(-pow((r - 0.94) / 0.05, 2.0));
    float mist = 0.12 * smoothstep(1.0, 0.35, r) * (0.75 + 0.25 * sin(ang * 5.0 + uTime * 0.7));
    float spokes = rays(ang + uTime * 0.08, r, 12.0, 0.025, 0.0) * smoothstep(0.55, 0.9, r) * 0.35;
    a = ring * 0.8 + mist + spokes;
    col = mix(uIce, uRim, ring);
  } else if (uMode < 2.5) {
    // круг-телеграф: яркий край, лёд нарастает от центра к краю; дойдёт до края — удар
    if (r > 1.0) discard;
    float edge = exp(-pow((r - 0.965) / 0.03, 2.0));
    float front = uT;
    float fill = step(r, front) * (0.18 + 0.25 * smoothstep(front - 0.08, front, r));
    float cracks = rays(ang, r, 11.0, 0.02, 0.37) * step(r, front) * 0.5;
    float pulse = 0.8 + 0.2 * sin(uTime * 12.0);
    a = (edge * 1.1 + fill + cracks) * pulse;
    col = mix(uIce, uRim, edge);
  } else if (uMode < 3.5) {
    // полоса-телеграф (вдоль +y, полуширина 1): края, бегущие «ёлочки», заливка растёт к концу
    float ax = abs(p.x);
    float edge = exp(-pow((ax - 0.94) / 0.05, 2.0));
    float along = vUV.y;
    float fill = step(along, uT) * 0.2;
    float chev = smoothstep(0.08, 0.0, abs(fract(along * 9.0 - ax * 0.6 - uTime * 2.2) - 0.5) - 0.38) * 0.4;
    a = edge + fill + chev * step(ax, 0.9);
    col = mix(uIce, uRim, edge);
  } else {
    // ударная волна: фронт бежит наружу, за ним гаснущие ледяные трещины
    if (r > 1.0) discard;
    float front = 0.12 + 0.88 * sqrt(uT);
    float band = exp(-pow((r - front) / 0.06, 2.0));
    float cracks = rays(ang, r, 13.0, 0.025, 0.5) * step(r, front) * smoothstep(0.1, 0.3, r);
    a = (band * 1.2 + cracks * 0.8) * (1.0 - uT * uT);
    col = mix(uIce, uRim, band);
  }
  a = clamp(a * uAlpha, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}`;

interface Decal {
  mesh: Mesh;
  mat: ShaderMaterial;
  age: number;
  life: number;
  mode: number;
  /** Знак следит за мобом/героем (кольцо ауры). */
  track: (() => { x: number; y: number; z: number } | null) | null;
  alpha: number;
}

// ---------------------------------------------------------------- снег

const FLAKES = 110;
Effect.ShadersStore["iceSnowVertexShader"] = `
precision highp float;
attribute vec3 position;
attribute float aIdx;
uniform mat4 viewProjection;
uniform mat4 view;
${MV_HEAD}
uniform vec3 uC;
uniform float uR;
uniform float uH;
uniform float uTime;
uniform float uCount;
uniform float uSpin;
uniform float uFall;
uniform float uSize;
uniform float uSeed;
varying vec2 vUV;
varying float vA;
float hash(float n) { return fract(sin(n * 12.9898 + uSeed) * 43758.5453); }
void main() {
  if (aIdx >= uCount) { ${HIDE} vUV = vec2(0.0); vA = 0.0; return; }
  float k = aIdx;
  float a0 = hash(k * 1.3) * 6.2831853;
  float rr = uR * (0.25 + 0.75 * sqrt(hash(k * 2.7)));
  float w = (0.35 + 0.65 * hash(k * 4.1)) * uSpin;
  float th = a0 + uTime * w;
  float fy = fract(hash(k * 6.3) - uTime * uFall * (0.5 + 0.5 * hash(k * 8.9)) / uH);
  vec3 c = uC + vec3(cos(th) * rr, fy * uH, sin(th) * rr);
  c.x += sin(uTime * 1.7 + k) * 0.25;
  vec3 right = vec3(view[0][0], view[1][0], view[2][0]);
  vec3 up = vec3(view[0][1], view[1][1], view[2][1]);
  float s = uSize * (0.5 + hash(k * 9.7));
  vec3 p = c + (right * position.x + up * position.y) * s;
  vUV = position.xy + 0.5;
  vA = smoothstep(0.0, 0.15, fy) * smoothstep(1.0, 0.7, fy);
  ${MV_OUT("p")}
}`;
Effect.ShadersStore["iceSnowFragmentShader"] = `
precision highp float;
varying vec2 vUV;
varying float vA;
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  float d = length(vUV - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.2, d) * vA * uAlpha;
  gl_FragColor = vec4(uColor * a, a);
}`;

interface Snow {
  mesh: Mesh;
  mat: ShaderMaterial;
  c: Vector3;
  time: number;
  /** Плавно к целевым значениям (метель в ярости). */
  count: number;
  want: number;
  spin: number;
  wantSpin: number;
  alpha: number;
  wantAlpha: number;
  free: boolean;
}

/** Аура одного гиганта: кольцо «Стужи» на земле и снег вокруг (метель в ярости). */
export interface IceAura {
  /** Каждый кадр: где гигант, радиус ауры, ярость, в бою ли. */
  place(x: number, y: number, z: number, r: number, fury: boolean, active: boolean): void;
  release(): void;
}

// ---------------------------------------------------------------- искры

interface Sparks {
  mesh: Mesh;
  mat: ShaderMaterial;
  age: number;
  life: number;
  center: Vector3;
  dir: Vector3;
}
const SPARKS = 28;

function shaderMat(scene: Scene, name: string, base: string, attrs: string[], uniforms: string[], blend: number | null): ShaderMaterial {
  const m = new ShaderMaterial(name, scene, base, {
    attributes: attrs,
    uniforms: ["world", "view", "viewProjection", "cameraPosition", ...uniforms],
    needAlphaBlending: blend !== null,
  });
  if (blend !== null) {
    m.alphaMode = blend;
    m.disableDepthWrite = true;
  }
  m.backFaceCulling = blend === null;
  return m;
}

const pools = new WeakMap<Scene, IceFx>();

export class IceFx {
  /** Один на сцену (игра, спектатор): создаётся при первом обращении и сам обновляется перед кадром. */
  static of(scene: Scene): IceFx {
    let fx = pools.get(scene);
    if (!fx) {
      fx = new IceFx(scene);
      pools.set(scene, fx);
    }
    return fx;
  }

  private readonly groups: ShardGroup[] = [];
  private readonly orbits: ShardGroup[] = [];
  private readonly decals: Decal[] = [];
  private readonly snows: Snow[] = [];
  private readonly sparks: Sparks[] = [];
  private nG = 0;
  private nD = 0;
  private nS = 0;
  private time = 0;
  /** Отложенные действия (шипы гряды по пути, осколки после клетки): [секунда, что сделать]. */
  private readonly later: [number, () => void][] = [];
  private readonly obs: Observer<Scene>;

  private constructor(private readonly scene: Scene) {
    const g = shardGeometry();
    const mkGroup = (name: string): ShardGroup => {
      const mesh = new Mesh(name, scene);
      const vd = new VertexData();
      vd.positions = g.pos;
      vd.normals = g.nrm;
      vd.indices = g.idx;
      vd.applyToMesh(mesh);
      mesh.setVerticesData("aIdx", g.aIdx, false, 1);
      const mat = shaderMat(scene, name + "Mat", "iceShard", ["position", "normal", "aIdx"], [
        "uA", "uB", "uR", "uW", "uSpeed", "uTime", "uHold", "uSize", "uMode", "uSeed", "uCount", "uSpin", "uDeep", "uIce", "uRim",
      ], null);
      mat.setColor3("uDeep", FXC.iceDeep);
      mat.setColor3("uIce", FXC.ice);
      mat.setColor3("uRim", FXC.iceRim);
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.setEnabled(false);
      const a = new Vector3();
      const b = new Vector3();
      mat.setVector3("uA", a);
      mat.setVector3("uB", b);
      return { mesh, mat, a, b, age: 1, life: 0, track: null, owner: "" };
    };
    for (let i = 0; i < 14; i++) this.groups.push(mkGroup(`iceShards${i}`));
    for (let i = 0; i < 8; i++) this.orbits.push(mkGroup(`iceOrbit${i}`));

    for (let i = 0; i < 12; i++) {
      const mesh = MeshBuilder.CreatePlane(`iceDecal${i}`, { size: 2 }, scene);
      mesh.rotation.x = Math.PI / 2;
      mesh.bakeCurrentTransformIntoVertices();
      const mat = shaderMat(scene, `iceDecalMat${i}`, "iceDecal", ["position", "uv"], ["uIce", "uRim", "uT", "uMode", "uAlpha", "uSeed", "uTime"], Constants.ALPHA_COMBINE);
      mat.setColor3("uIce", FXC.ice);
      mat.setColor3("uRim", FXC.iceRim);
      mesh.material = mat;
      groundFxThrough(mesh);
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.setEnabled(false);
      this.decals.push({ mesh, mat, age: 1, life: 0, mode: 0, track: null, alpha: 1 });
    }

    // Снег и искры — квадраты-«точки», позы в шейдере.
    const quads = (n: number): { pos: number[]; idx: number[]; attr: number[] } => {
      const pos: number[] = [];
      const idx: number[] = [];
      const attr: number[] = [];
      for (let k = 0; k < n; k++) {
        for (const [x, y] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
          pos.push(x, y, 0);
          attr.push(k);
        }
        idx.push(k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3);
      }
      return { pos, idx, attr };
    };
    const fq = quads(FLAKES);
    for (let i = 0; i < 4; i++) {
      const mesh = new Mesh(`iceSnow${i}`, scene);
      const vd = new VertexData();
      vd.positions = fq.pos;
      vd.indices = fq.idx;
      vd.applyToMesh(mesh);
      mesh.setVerticesData("aIdx", fq.attr, false, 1);
      const mat = shaderMat(scene, `iceSnowMat${i}`, "iceSnow", ["position", "aIdx"], [
        "uC", "uR", "uH", "uTime", "uCount", "uSpin", "uFall", "uSize", "uSeed", "uColor", "uAlpha",
      ], Constants.ALPHA_ADD);
      mat.setColor3("uColor", FXC.frost);
      mat.setFloat("uSeed", i * 7.3);
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.setEnabled(false);
      const c = new Vector3();
      mat.setVector3("uC", c);
      this.snows.push({ mesh, mat, c, time: 0, count: 0, want: 0, spin: 0.4, wantSpin: 0.4, alpha: 0, wantAlpha: 0, free: true });
    }
    const sq = quads(SPARKS);
    for (let i = 0; i < 12; i++) {
      const mesh = new Mesh(`iceSparks${i}`, scene);
      const vd = new VertexData();
      vd.positions = sq.pos;
      vd.indices = sq.idx;
      vd.applyToMesh(mesh);
      mesh.setVerticesData("aIdx", sq.attr, false, 1);
      const mat = shaderMat(scene, `iceSparksMat${i}`, "fxSparks", ["position", "aIdx"], [
        "uCenter", "uDir", "uSpread", "uT", "uLife", "uSpeed", "uGrav", "uSize", "uSeed", "uCount", "uColor",
      ], Constants.ALPHA_ADD);
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.setEnabled(false);
      const center = new Vector3();
      const dir = new Vector3();
      mat.setVector3("uCenter", center);
      mat.setVector3("uDir", dir);
      this.sparks.push({ mesh, mat, age: 1, life: 0, center, dir });
    }
    this.obs = scene.onBeforeRenderObservable.add(() => this.update(Math.min(0.1, scene.getEngine().getDeltaTime() / 1000)));
  }

  // ---------------------------------------------------------------- кристаллы

  /**
   * Группа кристаллов. mode — SHARD; a — центр/начало, b — конец (гряда); r — радиус (кольцо, клетка,
   * воронка, глыба) или полуширина (гряда — w); speed — бег фронта гряды, м/с; hold — сколько стоят, с.
   */
  shards(mode: number, a: { x: number; y: number; z: number }, o: {
    b?: { x: number; y: number; z: number }; r?: number; w?: number; speed?: number; hold: number; size: number; count?: number; spin?: number;
    track?: () => { x: number; y: number; z: number } | null;
  }): ShardGroup {
    const gr = this.groups[this.nG];
    this.nG = (this.nG + 1) % this.groups.length;
    this.setupGroup(gr, mode, a, o);
    return gr;
  }

  private setupGroup(gr: ShardGroup, mode: number, a: { x: number; y: number; z: number }, o: {
    b?: { x: number; y: number; z: number }; r?: number; w?: number; speed?: number; hold: number; size: number; count?: number; spin?: number;
    track?: () => { x: number; y: number; z: number } | null;
  }): void {
    gr.a.set(a.x, a.y, a.z);
    if (o.b) gr.b.set(o.b.x, o.b.y, o.b.z);
    else gr.b.copyFrom(gr.a);
    const m = gr.mat;
    m.setFloat("uMode", mode);
    m.setFloat("uR", o.r ?? 1);
    m.setFloat("uW", o.w ?? 1);
    m.setFloat("uSpeed", o.speed ?? 10);
    m.setFloat("uHold", o.hold);
    m.setFloat("uSize", o.size);
    m.setFloat("uCount", Math.min(SHARDS, o.count ?? SHARDS));
    m.setFloat("uSpin", o.spin ?? 0);
    m.setFloat("uSeed", Math.random() * 50);
    m.setFloat("uTime", 0);
    const run = mode === SHARD.line && o.b ? Math.hypot(o.b.x - a.x, o.b.z - a.z) / Math.max(0.1, o.speed ?? 10) : 0.2;
    gr.age = 0;
    gr.life = run + o.hold + 0.5;
    gr.track = o.track ?? null;
    gr.mesh.setEnabled(true);
  }

  /** Часы эффектов, с. */
  get clock(): number {
    return this.time;
  }

  /** Новый путь группы и ещё hold с жизни (глыба: из руки — в полёт). */
  retrack(gr: ShardGroup, track: (() => { x: number; y: number; z: number } | null) | null, hold: number): void {
    gr.track = track;
    gr.mat.setFloat("uHold", gr.age + hold);
    gr.life = gr.age + hold + 0.45;
  }

  /** Погасить группу сейчас (глыба упала). */
  end(gr: ShardGroup): void {
    if (gr.age >= gr.life) return;
    gr.track = null;
    gr.mat.setFloat("uHold", gr.age);
    gr.life = Math.min(gr.life, gr.age + 0.45);
  }

  /** Кристаллы стаков «Обморожения» вокруг героя id: n штук, держатся hold с (новый стак — обновляет). */
  frostOrbit(id: string, n: number, hold: number, track: () => { x: number; y: number; z: number } | null): void {
    let gr = this.orbits.find((o) => o.owner === id && o.age < o.life);
    if (!gr) {
      // Свободная группа, а если все заняты — самая старая.
      gr = this.orbits.find((o) => o.age >= o.life) ?? this.orbits.reduce((a, o) => (o.age > a.age ? o : a));
      const p = track() ?? { x: 0, y: 0, z: 0 };
      this.setupGroup(gr, SHARD.orbit, p, { r: 0.75, hold, size: 0.34, count: n, track });
      gr.owner = id;
      return;
    }
    gr.mat.setFloat("uCount", Math.min(SHARDS, n));
    gr.mat.setFloat("uHold", gr.age + hold);
    gr.life = gr.age + hold + 0.5;
  }

  /** Убрать кристаллы стаков героя (вмёрз — стаки сгорели). */
  clearOrbit(id: string): void {
    for (const o of this.orbits) {
      if (o.owner !== id || o.age >= o.life) continue;
      o.mat.setFloat("uHold", o.age);
      o.life = o.age + 0.45;
    }
  }

  // ---------------------------------------------------------------- земля

  /** Знак на земле: mode — DECAL; life — секунды; для круга/волны/полосы uT идёт 0..1 за life. */
  decal(mode: number, x: number, y: number, z: number, r: number, life: number, alpha = 1): Decal {
    const d = this.decals[this.nD];
    this.nD = (this.nD + 1) % this.decals.length;
    d.mesh.rotation.y = 0;
    d.mesh.position.set(x, y + 0.06 + (this.nD % 5) * 0.004, z);
    d.mesh.scaling.set(r, 1, r);
    d.mat.setFloat("uMode", mode);
    d.mat.setFloat("uSeed", Math.random() * 50);
    d.mat.setFloat("uT", 0);
    d.mat.setFloat("uAlpha", 0);
    Object.assign(d, { age: 0, life, mode, track: null, alpha });
    d.mesh.setEnabled(true);
    return d;
  }

  /** Полоса-телеграф от (x,z) до (x2,z2) полушириной w. */
  strip(x: number, y: number, z: number, x2: number, z2: number, w: number, life: number): void {
    const len = Math.max(0.5, Math.hypot(x2 - x, z2 - z));
    const d = this.decal(DECAL.strip, (x + x2) / 2, y, (z + z2) / 2, 1, life, 0.9);
    d.mesh.scaling.set(w, 1, len / 2);
    // Плоскость: локальная +z (uv.y) — вдоль полосы; поворот вокруг Y: (0,0,1) → (sin, 0, cos).
    d.mesh.rotation.y = Math.atan2(x2 - x, z2 - z);
  }

  // ---------------------------------------------------------------- аура

  /** Кольцо «Стужи» и снег одного гиганта (null — все заняты). */
  aura(): IceAura | null {
    const snow = this.snows.find((s) => s.free);
    if (!snow) return null;
    snow.free = false;
    const ring = this.decals.splice(this.decals.length - 1, 1)[0]; // своё кольцо — вне общего круга знаков
    this.nD %= this.decals.length;
    ring.mat.setFloat("uMode", DECAL.aura);
    ring.mat.setFloat("uSeed", Math.random() * 50);
    ring.mode = DECAL.aura;
    let on = false;
    return {
      place: (x, y, z, r, fury, active) => {
        snow.c.set(x, y, z);
        snow.want = active ? (fury ? FLAKES : 46) : 14;
        snow.wantSpin = fury ? 1.6 : 0.35;
        snow.wantAlpha = active ? (fury ? 0.95 : 0.6) : 0.35;
        snow.mat.setFloat("uR", r * (fury ? 1 : 0.85));
        snow.mat.setFloat("uH", fury ? 16 : 13);
        snow.mat.setFloat("uFall", fury ? 3.5 : 1.2);
        snow.mat.setFloat("uSize", fury ? 0.2 : 0.14);
        if (!on) {
          on = true;
          snow.mesh.setEnabled(true);
          ring.mesh.setEnabled(true);
        }
        ring.mesh.position.set(x, y + 0.05, z);
        ring.mesh.scaling.set(r, 1, r);
        ring.alpha += ((active ? (fury ? 1 : 0.75) : 0.25) - ring.alpha) * 0.05;
        ring.mat.setFloat("uAlpha", ring.alpha);
        ring.mat.setFloat("uT", this.time);
        ring.mat.setFloat("uTime", this.time);
      },
      release: () => {
        snow.free = true;
        snow.count = snow.want = 0;
        snow.mesh.setEnabled(false);
        ring.mesh.setEnabled(false);
        ring.alpha = 0;
        this.decals.push(ring);
      },
    };
  }

  // ---------------------------------------------------------------- искры

  burst(x: number, y: number, z: number, color: Color3, o: { count?: number; speed?: number; life?: number; size?: number; grav?: number; dir?: [number, number, number] | null; spread?: number } = {}): void {
    const s = this.sparks[this.nS];
    this.nS = (this.nS + 1) % this.sparks.length;
    const life = o.life ?? 0.6;
    s.center.set(x, y, z);
    s.dir.set(...(o.dir ?? [0, 0, 0]));
    s.mat.setFloat("uSpread", o.spread ?? 1);
    s.mat.setFloat("uLife", life);
    s.mat.setFloat("uSpeed", o.speed ?? 5);
    s.mat.setFloat("uGrav", o.grav ?? 9);
    s.mat.setFloat("uSize", o.size ?? 0.22);
    s.mat.setFloat("uSeed", Math.random() * 50);
    s.mat.setFloat("uCount", Math.min(SPARKS, o.count ?? 20));
    s.mat.setColor3("uColor", color);
    s.mat.setFloat("uT", 0);
    s.age = 0;
    s.life = life;
    s.mesh.setEnabled(true);
  }

  /** Сделать fn через sec секунд (по часам эффектов). */
  after(sec: number, fn: () => void): void {
    this.later.push([this.time + sec, fn]);
  }

  // ---------------------------------------------------------------- кадр

  private update(dt: number): void {
    this.time += dt;
    for (let i = this.later.length - 1; i >= 0; i--) {
      if (this.later[i][0] > this.time) continue;
      const fn = this.later[i][1];
      this.later.splice(i, 1);
      fn();
    }
    for (const gr of [...this.groups, ...this.orbits]) {
      if (gr.age >= gr.life) continue;
      gr.age += dt;
      if (gr.age >= gr.life) {
        gr.mesh.setEnabled(false);
        gr.track = null;
        gr.owner = "";
        continue;
      }
      if (gr.track) {
        const p = gr.track();
        if (p) gr.a.set(p.x, p.y, p.z);
        else if (gr.owner) {
          // Герой пропал (умер, ушёл из вида) — кристаллы стаков гаснут.
          gr.mat.setFloat("uHold", gr.age);
          gr.life = Math.min(gr.life, gr.age + 0.45);
          gr.track = null;
        }
      }
      gr.mat.setFloat("uTime", gr.age);
    }
    for (const d of this.decals) {
      if (d.age >= d.life) continue;
      d.age += dt;
      if (d.age >= d.life) {
        d.mesh.setEnabled(false);
        continue;
      }
      const u = d.age / d.life;
      if (d.mode === DECAL.frost || d.mode === DECAL.aura) d.mat.setFloat("uT", d.age);
      else d.mat.setFloat("uT", u);
      d.mat.setFloat("uTime", this.time);
      const fade = d.mode === DECAL.wave ? 1 : Math.min(1, d.age / 0.2) * Math.min(1, (d.life - d.age) / (d.mode === DECAL.frost ? 1 : 0.25));
      d.mat.setFloat("uAlpha", fade * d.alpha);
    }
    for (const s of this.snows) {
      if (s.free) continue;
      s.time += dt;
      const k = Math.min(1, dt * 1.5);
      s.count += (s.want - s.count) * k;
      s.spin += (s.wantSpin - s.spin) * k;
      s.alpha += (s.wantAlpha - s.alpha) * k;
      s.mat.setFloat("uTime", s.time);
      s.mat.setFloat("uCount", Math.round(s.count));
      s.mat.setFloat("uSpin", s.spin);
      s.mat.setFloat("uAlpha", s.alpha);
    }
    for (const s of this.sparks) {
      if (s.age >= s.life) continue;
      s.age += dt;
      if (s.age >= s.life) s.mesh.setEnabled(false);
      else s.mat.setFloat("uT", s.age);
    }
  }

  dispose(): void {
    this.scene.onBeforeRenderObservable.remove(this.obs);
    for (const e of [...this.groups, ...this.orbits, ...this.decals, ...this.snows, ...this.sparks]) {
      e.mat.dispose();
      e.mesh.dispose();
    }
    pools.delete(this.scene);
  }
}
