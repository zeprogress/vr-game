import { FXC } from "./fxColors";
import { GROUND_LIFT_GLSL } from "./groundLift";
import { groundFxThrough } from "./groundFx";
import "./SkillVfx"; // шейдер искр fxSparks (Effect.ShadersStore)
import type { Scene } from "@babylonjs/core/scene";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Effect } from "@babylonjs/core/Materials/effect";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import "@babylonjs/core/Meshes/Builders/icoSphereBuilder";

/**
 * Огонь Владыки Бездны (DRAGON) — по образцу IceFx: всё рисуют шейдеры, из JS — пара чисел за кадр; меши и
 * материалы — пулом один раз (никаких clone в бою), стерео в шлеме — MULTIVIEW за один проход.
 *
 *  decal  — знак на земле любой формы «сектор кольца» (круг, конус дыхания, дуга хвоста, кольцо): телеграф
 *           с бегущим заполнением, горящая земля (лавовые прожилки), гарь с остывающими угольками, волна;
 *  flames — языки пламени и дым (мягкие пятна с шумом, цвет по «жару»: ядро → огонь → красный → дым):
 *           струя дыхания, горящая земля конусом и кругом, взрыв кольца, след метеора, клуб (дым, пыль);
 *  rock   — метеор: камень с лавовыми трещинами;
 *  sparks — искры и угольки (тот же шейдер, что у SkillVfx).
 * Смешивание — premultiplied: огонь светит (складывается), дым и гарь затемняют. Один экземпляр на сцену:
 * FireFx.of(scene) — сам обновляется перед кадром.
 */

export const MV_HEAD = `
#ifdef MULTIVIEW
uniform mat4 viewProjectionR;
#endif`;
export const MV_OUT = (p: string) => `
#ifdef MULTIVIEW
  if (gl_ViewID_OVR == 0u) { gl_Position = viewProjection * vec4(${p}, 1.0); } else { gl_Position = viewProjectionR * vec4(${p}, 1.0); }
#else
  gl_Position = viewProjection * vec4(${p}, 1.0);
#endif`;
const HIDE = "gl_Position = vec4(2.0, 2.0, 2.0, 1.0);";

/** Шум для шейдеров огня: значение в узлах решётки, сглаженное (дёшево и без текстур). */
const NOISE_GLSL = `
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { return vnoise(p) * 0.55 + vnoise(p * 2.13 + 3.7) * 0.3 + vnoise(p * 4.37 + 1.3) * 0.15; }`;

/** Режимы знака на земле (uMode). */
export const FDECAL = { tele: 0, burn: 1, scorch: 2, wave: 3 } as const;
/** Режимы пламени (uMode). */
export const FLAME = { stream: 0, cone: 1, disc: 2, blast: 3, trail: 4, puff: 5 } as const;

// ---------------------------------------------------------------- знаки на земле

Effect.ShadersStore["fireDecalVertexShader"] = `
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
Effect.ShadersStore["fireDecalFragmentShader"] = `
precision highp float;
varying vec2 vUV;
uniform vec3 uCore;
uniform vec3 uFire;
uniform vec3 uRed;
uniform float uT;      // прогресс 0..1 (телеграф, волна) или секунды (горение, гарь)
uniform float uMode;   // 0 телеграф, 1 горит, 2 гарь, 3 волна
uniform float uAlpha;
uniform float uSeed;
uniform float uTime;
uniform float uA0;     // сектор: от угла (рад, 0 — вперёд, > 0 — вправо)
uniform float uA1;     // ... до угла
uniform float uR0;     // внутренний радиус, доля
uniform float uRm;     // радиус в метрах (края — постоянной ширины)
uniform float uSweep;  // 1 — заполнение и волна бегут по углу от a0 к a1, −1 — от a1 к a0 (хвост), 0 — от центра наружу
${NOISE_GLSL}
void main() {
  vec2 p = vUV * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float ang = atan(p.x, p.y);
  float full = step(6.2, uA1 - uA0);
  // расстояние до края фигуры, м (> 0 — внутри)
  float dSide = mix(min(ang - uA0, uA1 - ang) * max(r, 0.04), 2.0, full);
  float dIn = uR0 > 0.001 ? r - uR0 : 2.0;
  float e = min(min(dSide, 1.0 - r), dIn) * uRm;
  if (e < -0.35) discard;
  float inside = smoothstep(-0.12, 0.12, e);
  float prog = abs(uSweep) > 0.5
    ? clamp((ang - uA0) / max(uA1 - uA0, 0.01), 0.0, 1.0)
    : clamp((r - uR0) / max(1.0 - uR0, 0.01), 0.0, 1.0);
  if (uSweep < -0.5) prog = 1.0 - prog;
  vec2 q = p * uRm * 0.22 + uSeed;
  vec3 emit = vec3(0.0);
  float cover = 0.0;
  if (uMode < 0.5) {
    // телеграф: яркий край, заливка бежит к краю (дойдёт — удар), по ней ходят языки жара
    float edge = exp(-pow(e / 0.16, 2.0));
    float filled = step(prog, uT) * inside;
    float fill = filled * (0.14 + 0.32 * smoothstep(uT - 0.12, uT, prog));
    float heat = fbm(q * 1.6 + vec2(0.0, -uTime * 0.9));
    float lick = filled * smoothstep(0.5, 0.85, heat) * 0.45;
    float pulse = 0.72 + 0.28 * sin(uTime * (7.0 + 12.0 * uT));
    emit = mix(uRed, uFire, clamp(edge * 0.7 + lick, 0.0, 1.0)) * (edge * 1.25 + fill + lick) * pulse;
    cover = 0.22 * filled;
  } else if (uMode < 1.5) {
    // горит: лавовые прожилки и пляшущий жар; затемнённое основание
    float n = fbm(q * 1.3 + vec2(uTime * 0.2, -uTime * 0.55));
    float veins = smoothstep(0.09, 0.0, abs(fbm(q * 2.2 + 11.0) - 0.5));
    float glow = (0.3 + 0.7 * n) * (0.3 + 0.7 * veins) * (0.85 + 0.15 * sin(uTime * 13.0 + n * 9.0));
    vec3 col = mix(uRed, uFire, n);
    col = mix(col, uCore, veins * n);
    emit = col * glow * inside * 1.15;
    cover = 0.5 * inside;
  } else if (uMode < 2.5) {
    // гарь: обугленное пятно, угольки остывают за несколько секунд
    float n = fbm(q * 1.8);
    vec2 cell = floor(q * 6.0);
    float ember = step(0.92, h21(cell + 7.3)) * (0.55 + 0.45 * sin(uTime * 3.0 + h21(cell) * 20.0));
    float cool = exp(-uT * 0.55);
    emit = uRed * (ember * 0.9 + smoothstep(0.62, 0.9, n) * 0.25) * cool * inside;
    cover = (0.4 + 0.25 * n) * inside;
  } else {
    // волна: фронт пробегает фигуру, за ним гаснет жар
    float front = 0.06 + 0.94 * sqrt(uT);
    float band = exp(-pow((prog - front) / 0.07, 2.0));
    float behind = step(prog, front) * fbm(q * 1.5 - uTime * 1.5) * 0.6 * (1.0 - uT);
    emit = mix(uFire, uCore, band) * (band * 1.5 + behind) * inside * (1.0 - uT * uT);
    cover = behind * 0.3 * inside;
  }
  gl_FragColor = vec4(emit * uAlpha, clamp(cover * uAlpha, 0.0, 1.0));
}`;

interface Decal {
  mesh: Mesh;
  mat: ShaderMaterial;
  age: number;
  life: number;
  mode: number;
  alpha: number;
  /** Знак следит за точкой каждый кадр (аура у ног героя), null — стоит. */
  track: (() => { x: number; y: number; z: number } | null) | null;
  /** Сколько секунд в начале и в конце жизни знак проявляется и гаснет. */
  fadeIn: number;
  fadeOut: number;
}

/** Фигура знака: центр, радиус (м), курс (взгляд — (sin, cos)), сектор от a0 до a1 (рад), внутренний радиус r0 (доля). */
export interface FireShape {
  x: number;
  y: number;
  z: number;
  r: number;
  yaw?: number;
  a0?: number;
  a1?: number;
  r0?: number;
  /** Заполнение и волна бегут по углу: 1 — от a0 к a1, −1 — от a1 к a0 (удар хвостом); нет — от центра. */
  sweep?: 1 | -1;
  /** Знак каждый кадр — в эту точку (центр — её x/z; высота — точки). */
  track?: () => { x: number; y: number; z: number } | null;
}

// ---------------------------------------------------------------- пламя

const FLAMES = 64;
Effect.ShadersStore["fireFlameVertexShader"] = `
precision highp float;
attribute vec3 position;
attribute float aIdx;
uniform mat4 viewProjection;
uniform mat4 view;
${MV_HEAD}
uniform vec3 uA;       // источник: пасть, центр, точка удара
uniform vec3 uB;       // струя — куда (конец у земли), конус — направление, след — откуда падает (без «;»: препроцессор режет комментарий по «;»)
uniform float uMode;
uniform float uTime;
uniform float uDur;    // сколько секунд рождаются новые языки
uniform float uLife;   // жизнь языка, с
uniform float uHalf;   // полуугол конуса, рад
uniform float uR;      // длина струи / радиус
uniform float uIn;     // круг: внутренний радиус, доля (кольцо по краю — 0.9)
uniform float uSize;
uniform float uRise;   // насколько поднимается за жизнь, м
uniform float uCount;
uniform float uSeed;
uniform float uInt;    // общая сила 0..1
uniform float uHeat;   // жар при рождении (1 — белое ядро, 0 — дым)
varying vec2 vUV;
varying float vHeat;
varying float vA;
varying float vSeed;
float hash(float n) { return fract(sin(n * 12.9898 + uSeed) * 43758.5453); }
void main() {
  float i = aIdx;
  if (i >= uCount || uInt <= 0.001) { ${HIDE} vUV = vec2(0.0); vHeat = 0.0; vA = 0.0; vSeed = 0.0; return; }
  const float TAU = 6.2831853;
  float h1 = hash(i * 1.7 + 0.3);
  float h2 = hash(i * 3.1 + 1.1);
  float life = uLife * (0.75 + 0.5 * h1);
  bool oneShot = uMode > 2.5 && uMode < 3.5 || uMode > 4.5;
  float age;
  float cyc = 0.0;
  if (oneShot) {
    // разом: взрыв кольца — по мере того как фронт добежит до языка; клуб — почти сразу
    float delay = uMode < 3.5 ? 0.0 : h2 * 0.12;
    age = uTime - delay;
  } else {
    float t0 = h2 * life;
    if (uTime < t0) { ${HIDE} vUV = vec2(0.0); vHeat = 0.0; vA = 0.0; vSeed = 0.0; return; }
    cyc = floor((uTime - t0) / life);
    age = uTime - t0 - cyc * life;
    if (uTime - age > uDur) { ${HIDE} vUV = vec2(0.0); vHeat = 0.0; vA = 0.0; vSeed = 0.0; return; }
  }
  // новый язык — новое место (у повторяющихся)
  float h3 = hash(i * 5.3 + cyc * 7.77 + 2.7);
  float h4 = hash(i * 7.9 + cyc * 3.31 + 3.9);
  float h5 = hash(i * 9.7 + 5.1);
  float h6 = hash(i * 11.3 + cyc * 1.93 + 6.2);
  vec3 c = uA;
  float size = uSize;
  float heat = uHeat;
  float a = 1.0;
  float s = 0.0;
  vec3 UP = vec3(0.0, 1.0, 0.0);
  if (uMode < 0.5) {
    // струя дыхания: из пасти к концу конуса, быстро и с торможением, расширяется; в конце — поднимается
    s = age / life;
    vec3 D = uB - uA;
    float L = max(length(D), 0.001);
    vec3 f = D / L;
    vec3 side = normalize(cross(UP, f) + vec3(0.0001));
    vec3 up2 = cross(f, side);
    float reach = L * (1.0 - pow(1.0 - s, 1.7));
    float spread = tan(uHalf) * reach * 0.9;
    c = uA + f * reach + side * (h3 * 2.0 - 1.0) * spread + up2 * (h4 * 2.0 - 1.0) * spread * 0.35;
    c.y += uRise * s * s;
    c.y = max(c.y, uB.y - 0.2);
    size = uSize * (0.3 + 2.1 * s) * (0.7 + 0.6 * h5);
    heat = uHeat * (1.0 - 0.95 * s);
    a = smoothstep(0.0, 0.05, s) * (1.0 - smoothstep(0.7, 1.0, s));
  } else if (uMode < 1.5) {
    // горит земля конусом: языки на случайных местах, поднимаются и гаснут
    s = age / life;
    vec2 fd = normalize(uB.xz - uA.xz + vec2(0.0, 0.0001));
    vec2 sd = vec2(fd.y, -fd.x);
    float dist = uR * sqrt(mix(0.03, 1.0, h3));
    float an = (h4 * 2.0 - 1.0) * uHalf * 0.92;
    vec2 xz = uA.xz + (fd * cos(an) + sd * sin(an)) * dist;
    c = vec3(xz.x, uA.y, xz.y) + UP * (uRise * s + size * 0.3);
    size = uSize * (0.5 + 0.8 * h5) * (1.0 - 0.45 * s) * (0.55 + 0.6 * dist / uR);
    heat = uHeat * (1.0 - s);
    a = smoothstep(0.0, 0.12, s) * (1.0 - smoothstep(0.55, 1.0, s));
  } else if (uMode < 2.5) {
    // горит земля кругом (кольцо по краю — uIn ближе к 1; аура ярости — вокруг тела)
    s = age / life;
    float an = h4 * TAU;
    float rr = uR * mix(uIn, 1.0, sqrt(h3));
    c = uA + vec3(cos(an) * rr, uRise * s + size * 0.3, sin(an) * rr);
    size = uSize * (0.5 + 0.8 * h5) * (1.0 - 0.45 * s);
    heat = uHeat * (1.0 - s);
    a = smoothstep(0.0, 0.12, s) * (1.0 - smoothstep(0.55, 1.0, s));
  } else if (uMode < 3.5) {
    // взрыв кольца пламени: фронт бежит от центра (0.32 с до края), за ним встают столбы огня
    float rr = uR * mix(0.18, 1.0, pow(h3, 0.6));
    float delay = 0.32 * rr / uR;
    age -= delay;
    s = age / life;
    if (s < 0.0 || s > 1.0) { ${HIDE} vUV = vec2(0.0); vHeat = 0.0; vA = 0.0; vSeed = 0.0; return; }
    float an = h4 * TAU;
    c = uA + vec3(cos(an), 0.0, sin(an)) * (rr + s * 1.4) + UP * uRise * (1.0 - (1.0 - s) * (1.0 - s));
    size = uSize * (0.45 + 1.3 * s) * (0.6 + 0.6 * h5);
    heat = uHeat * (1.0 - 0.9 * s);
    a = smoothstep(0.0, 0.06, s) * (1.0 - smoothstep(0.6, 1.0, s));
  } else if (uMode < 4.5) {
    // след метеора: камень летит от uB к uA за uDur, языки рождаются на пути и отстают
    s = age / life;
    float u = clamp((uTime - age) / max(uDur, 0.01), 0.0, 1.0);
    vec3 at = mix(uB, uA, u);
    c = at + (vec3(h3, h4, h6) - 0.5) * uSize * (0.4 + 1.2 * s) + UP * uRise * s;
    size = uSize * (0.55 + 1.5 * s) * (0.7 + 0.6 * h5);
    heat = uHeat * (1.0 - s);
    a = smoothstep(0.0, 0.05, s) * (1.0 - smoothstep(0.5, 1.0, s));
  } else {
    // клуб: разлетается из точки (в сторону uB, если задан) и тормозит — дым из ноздрей, пыль от шага, вспышка
    s = age / life;
    if (s < 0.0 || s > 1.0) { ${HIDE} vUV = vec2(0.0); vHeat = 0.0; vA = 0.0; vSeed = 0.0; return; }
    vec3 D = uB - uA;
    float L = length(D);
    vec3 f = L > 0.001 ? D / L : UP;
    vec3 rnd = normalize(vec3(h3, h4, h6) * 2.0 - 1.0 + vec3(0.0001));
    vec3 dir = normalize(f + rnd * tan(uHalf));
    c = uA + dir * uR * (1.0 - (1.0 - s) * (1.0 - s)) * (0.5 + 0.5 * h5) + UP * uRise * s;
    size = uSize * (0.45 + 1.4 * s) * (0.7 + 0.6 * h5);
    heat = uHeat * (1.0 - s);
    a = smoothstep(0.0, 0.08, s) * (1.0 - smoothstep(0.45, 1.0, s));
  }
  // дрожь — языки не летят по линейке
  c += vec3(sin(uTime * 9.0 + i * 1.7), sin(uTime * 7.3 + i * 2.3) * 0.6, cos(uTime * 8.1 + i)) * 0.18 * s * size;
  vec3 right = vec3(view[0][0], view[1][0], view[2][0]);
  vec3 up = vec3(view[0][1], view[1][1], view[2][1]);
  float rot = h5 * TAU + uTime * (h1 - 0.5) * 2.0;
  vec2 qd = vec2(position.x * cos(rot) - position.y * sin(rot), position.x * sin(rot) + position.y * cos(rot));
  vec3 p = c + (right * qd.x + up * qd.y) * size;
  vUV = position.xy + 0.5;
  vHeat = heat;
  vA = a * uInt;
  vSeed = h5 * 17.0 + h1 * 5.0;
  ${MV_OUT("p")}
}`;
Effect.ShadersStore["fireFlameFragmentShader"] = `
precision highp float;
varying vec2 vUV;
varying float vHeat;
varying float vA;
varying float vSeed;
uniform vec3 uCore;
uniform vec3 uFire;
uniform vec3 uRed;
uniform vec3 uSmoke;
uniform float uTime;
${NOISE_GLSL}
void main() {
  vec2 p = vUV - 0.5;
  float d = length(p) * 2.0;
  if (d > 1.0 || vA <= 0.0) discard;
  float n = vnoise(p * 3.5 + vec2(vSeed, vSeed * 1.7 - uTime * 1.6)) * 0.65 + vnoise(p * 7.0 + vSeed * 3.1) * 0.35;
  float shape = smoothstep(1.0, 0.2, d + (n - 0.5) * 0.6);
  if (shape <= 0.0) discard;
  float h = clamp(vHeat + (n - 0.5) * 0.3 - d * 0.25, 0.0, 1.0);
  vec3 col = h > 0.6 ? mix(uFire, uCore, (h - 0.6) / 0.4) : h > 0.28 ? mix(uRed, uFire, (h - 0.28) / 0.32) : mix(uSmoke, uRed, h / 0.28);
  float glow = smoothstep(0.1, 0.42, h);
  float a = shape * vA;
  gl_FragColor = vec4(col * a * (0.3 + 1.05 * glow), a * (1.0 - glow) * 0.62);
}`;

export interface Flames {
  mesh: Mesh;
  mat: ShaderMaterial;
  a: Vector3;
  b: Vector3;
  age: number;
  life: number;
  dur: number;
  /** Сила 0..1 (гаснет в конце). */
  int: number;
  /** Источник каждый кадр (пасть дракона); null — стоит. */
  track: (() => { x: number; y: number; z: number } | null) | null;
  /** Занят аурой ярости — общий круг пула его не берёт. */
  held: boolean;
}

/** Параметры пламени. dur — сколько секунд рождаются языки, life — жизнь языка, size — размер, м. */
export interface FlameOpts {
  b?: { x: number; y: number; z: number };
  r?: number;
  half?: number;
  inner?: number;
  dur?: number;
  life: number;
  size: number;
  rise?: number;
  count?: number;
  heat?: number;
  smoke?: Color3;
  track?: () => { x: number; y: number; z: number } | null;
}

// ---------------------------------------------------------------- метеор

Effect.ShadersStore["fireRockVertexShader"] = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
uniform mat4 world;
uniform mat4 viewProjection;
${MV_HEAD}
varying vec3 vN;
varying vec3 vW;
varying vec3 vL;
void main() {
  vec4 wp = world * vec4(position, 1.0);
  vN = normalize(mat3(world) * normal);
  vW = wp.xyz;
  vL = position;
  ${MV_OUT("wp.xyz")}
}`;
Effect.ShadersStore["fireRockFragmentShader"] = `
precision highp float;
varying vec3 vN;
varying vec3 vW;
varying vec3 vL;
uniform vec3 cameraPosition;
uniform vec3 uCore;
uniform vec3 uFire;
uniform vec3 uRed;
uniform float uTime;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float dif = 0.35 + 0.65 * max(dot(N, normalize(vec3(0.3, 0.9, 0.2))), 0.0);
  // трещины: пересечения «волн» по локальным осям — сетка разломов на корке
  float w = sin(vL.x * 6.3 + sin(vL.y * 4.1) * 1.7) * sin(vL.z * 5.7 + cos(vL.x * 3.3) * 1.9) * sin(vL.y * 5.1 + 1.3);
  float crack = smoothstep(0.16, 0.0, abs(w));
  float pulse = 0.75 + 0.25 * sin(uTime * 11.0 + vL.x * 4.0);
  vec3 crust = vec3(0.07, 0.05, 0.045) * dif;
  vec3 lava = mix(uFire, uCore, crack * pulse);
  float fr = pow(1.0 - max(dot(N, V), 0.0), 2.0);
  vec3 c = mix(crust, lava * 1.3, crack) + uFire * fr * 0.9 + uRed * 0.12;
  gl_FragColor = vec4(c, 1.0);
}`;

interface Rock {
  mesh: Mesh;
  from: Vector3;
  to: Vector3;
  age: number;
  life: number;
  spin: Vector3;
}

/** Камень: икосфера с вмятинами (смещение по направлению — у совпадающих вершин одно, швов нет). */
function rockGeometry(scene: Scene): Mesh {
  const m = MeshBuilder.CreateIcoSphere("fireRockSrc", { radius: 1, subdivisions: 2, flat: true }, scene);
  const pos = m.getVerticesData("position")!;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i];
    const y = pos[i + 1];
    const z = pos[i + 2];
    const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
    const k = 0.78 + 0.3 * (h - Math.floor(h)) + 0.12 * Math.sin(x * 3 + z * 2);
    pos[i] = x * k;
    pos[i + 1] = y * k * 0.9;
    pos[i + 2] = z * k;
  }
  const idx = m.getIndices()!;
  const nrm: number[] = [];
  VertexData.ComputeNormals(pos, idx, nrm);
  m.setVerticesData("position", pos);
  m.setVerticesData("normal", nrm);
  return m;
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

/** Аура ярости Владыки: огонь у лап и угольки, пока он в ярости. */
export interface FireAura {
  /** Каждый кадр: где дракон, радиус, горит ли (false — плавно гаснет). */
  place(x: number, y: number, z: number, r: number, on: boolean): void;
  release(): void;
}

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

const SMOKE = new Color3(0.07, 0.06, 0.055);
const pools = new WeakMap<Scene, FireFx>();

export class FireFx {
  /** Один на сцену (игра, спектатор, лаборатория): создаётся при первом обращении и сам обновляется перед кадром. */
  static of(scene: Scene): FireFx {
    let fx = pools.get(scene);
    if (!fx) {
      fx = new FireFx(scene);
      pools.set(scene, fx);
    }
    return fx;
  }

  /** Доля языков пламени (шлем, слабое качество — меньше): 0.3..1. */
  density = 1;

  private readonly decals: Decal[] = [];
  private readonly flames: Flames[] = [];
  private readonly rocks: Rock[] = [];
  private readonly sparks: Sparks[] = [];
  private readonly rockMat: ShaderMaterial;
  private nD = 0;
  private nF = 0;
  private nR = 0;
  private nS = 0;
  private time = 0;
  private readonly later: [number, () => void][] = [];
  private readonly obs: Observer<Scene>;

  private constructor(private readonly scene: Scene) {
    const fire = (m: ShaderMaterial): void => {
      m.setColor3("uCore", FXC.fireCore);
      m.setColor3("uFire", FXC.fire);
      m.setColor3("uRed", FXC.fireRed);
    };
    for (let i = 0; i < 28; i++) {
      const mesh = MeshBuilder.CreatePlane(`fireDecal${i}`, { size: 2 }, scene);
      mesh.rotation.x = Math.PI / 2;
      mesh.bakeCurrentTransformIntoVertices();
      const mat = shaderMat(scene, `fireDecalMat${i}`, "fireDecal", ["position", "uv"], [
        "uCore", "uFire", "uRed", "uT", "uMode", "uAlpha", "uSeed", "uTime", "uA0", "uA1", "uR0", "uRm", "uSweep",
      ], Constants.ALPHA_PREMULTIPLIED);
      fire(mat);
      mesh.material = mat;
      groundFxThrough(mesh);
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.setEnabled(false);
      this.decals.push({ mesh, mat, age: 1, life: 0, mode: 0, alpha: 1, fadeIn: 0.15, fadeOut: 0.25, track: null });
    }

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
    const fq = quads(FLAMES);
    for (let i = 0; i < 22; i++) {
      const mesh = new Mesh(`fireFlames${i}`, scene);
      const vd = new VertexData();
      vd.positions = fq.pos;
      vd.indices = fq.idx;
      vd.applyToMesh(mesh);
      mesh.setVerticesData("aIdx", fq.attr, false, 1);
      const mat = shaderMat(scene, `fireFlamesMat${i}`, "fireFlame", ["position", "aIdx"], [
        "uA", "uB", "uMode", "uTime", "uDur", "uLife", "uHalf", "uR", "uIn", "uSize", "uRise", "uCount", "uSeed", "uInt", "uHeat",
        "uCore", "uFire", "uRed", "uSmoke",
      ], Constants.ALPHA_PREMULTIPLIED);
      fire(mat);
      mat.setColor3("uSmoke", SMOKE);
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.setEnabled(false);
      const a = new Vector3();
      const b = new Vector3();
      mat.setVector3("uA", a);
      mat.setVector3("uB", b);
      this.flames.push({ mesh, mat, a, b, age: 1, life: 0, dur: 0, int: 0, track: null, held: false });
    }

    const src = rockGeometry(scene);
    this.rockMat = shaderMat(scene, "fireRockMat", "fireRock", ["position", "normal"], ["uCore", "uFire", "uRed", "uTime"], null);
    fire(this.rockMat);
    src.material = this.rockMat;
    src.isPickable = false;
    src.setEnabled(false);
    for (let i = 0; i < 10; i++) {
      const mesh = i === 0 ? src : src.clone(`fireRock${i}`);
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.setEnabled(false);
      this.rocks.push({ mesh, from: new Vector3(), to: new Vector3(), age: 1, life: 0, spin: new Vector3() });
    }

    const sq = quads(SPARKS);
    for (let i = 0; i < 20; i++) {
      const mesh = new Mesh(`fireSparks${i}`, scene);
      const vd = new VertexData();
      vd.positions = sq.pos;
      vd.indices = sq.idx;
      vd.applyToMesh(mesh);
      mesh.setVerticesData("aIdx", sq.attr, false, 1);
      const mat = shaderMat(scene, `fireSparksMat${i}`, "fxSparks", ["position", "aIdx"], [
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

  /** Часы эффектов, с. */
  get clock(): number {
    return this.time;
  }

  /** Сделать fn через sec секунд (по часам эффектов). */
  after(sec: number, fn: () => void): void {
    this.later.push([this.time + sec, fn]);
  }

  // ---------------------------------------------------------------- земля

  /** Знак на земле: mode — FDECAL; life — секунды; телеграф и волна: uT идёт 0..1 за life. */
  decal(mode: number, s: FireShape, life: number, alpha = 1): void {
    const d = this.decals[this.nD];
    this.nD = (this.nD + 1) % this.decals.length;
    d.mesh.rotation.y = s.yaw ?? 0;
    d.mesh.position.set(s.x, s.y + 0.06 + (this.nD % 7) * 0.004, s.z);
    d.mesh.scaling.set(s.r, 1, s.r);
    const m = d.mat;
    m.setFloat("uMode", mode);
    m.setFloat("uSeed", Math.random() * 50);
    m.setFloat("uT", 0);
    m.setFloat("uAlpha", 0);
    m.setFloat("uA0", s.a0 ?? -Math.PI);
    m.setFloat("uA1", s.a1 ?? Math.PI);
    m.setFloat("uR0", s.r0 ?? 0);
    m.setFloat("uRm", s.r);
    m.setFloat("uSweep", s.sweep ?? 0);
    Object.assign(d, {
      age: 0, life, mode, alpha, track: s.track ?? null,
      fadeIn: mode === FDECAL.wave ? 0 : mode === FDECAL.tele ? 0.12 : 0.3,
      fadeOut: mode === FDECAL.wave ? 0 : mode === FDECAL.tele ? 0.08 : mode === FDECAL.scorch ? Math.min(3, life * 0.5) : 0.8,
    });
    d.mesh.setEnabled(true);
  }

  // ---------------------------------------------------------------- пламя

  /** Пламя: mode — FLAME; a — источник (пасть, центр, точка удара); см. FlameOpts. */
  flame(mode: number, a: { x: number; y: number; z: number }, o: FlameOpts): Flames {
    let f = this.flames[this.nF];
    for (let k = 0; k < this.flames.length && f.held; k++) {
      this.nF = (this.nF + 1) % this.flames.length;
      f = this.flames[this.nF];
    }
    this.nF = (this.nF + 1) % this.flames.length;
    this.setupFlames(f, mode, a, o);
    return f;
  }

  private setupFlames(f: Flames, mode: number, a: { x: number; y: number; z: number }, o: FlameOpts): void {
    f.a.set(a.x, a.y, a.z);
    if (o.b) f.b.set(o.b.x, o.b.y, o.b.z);
    else f.b.copyFrom(f.a);
    const m = f.mat;
    const dur = o.dur ?? 0;
    m.setFloat("uMode", mode);
    m.setFloat("uDur", dur);
    m.setFloat("uLife", o.life);
    m.setFloat("uHalf", o.half ?? 0.4);
    m.setFloat("uR", o.r ?? 1);
    m.setFloat("uIn", o.inner ?? 0);
    m.setFloat("uSize", o.size);
    m.setFloat("uRise", o.rise ?? 1);
    m.setFloat("uCount", Math.max(4, Math.round(Math.min(FLAMES, o.count ?? FLAMES) * this.density)));
    m.setFloat("uHeat", o.heat ?? 1);
    m.setFloat("uSeed", Math.random() * 50);
    m.setFloat("uTime", 0);
    m.setFloat("uInt", 1);
    m.setColor3("uSmoke", o.smoke ?? SMOKE);
    f.age = 0;
    f.dur = dur;
    f.life = dur + o.life * 1.3 + (mode === FLAME.blast ? 0.35 : 0) + (mode === FLAME.puff ? 0.15 : 0);
    f.int = 1;
    f.track = o.track ?? null;
    f.mesh.setEnabled(true);
  }

  /** Аура ярости: свой язык пламени вне общего круга (null — все заняты). */
  aura(): FireAura | null {
    const f = this.flames.find((x) => !x.held && x.age >= x.life);
    if (!f) return null;
    f.held = true;
    let on = false;
    let emberAt = 0;
    return {
      place: (x, y, z, r, burning) => {
        if (!on && burning) {
          on = true;
          this.setupFlames(f, FLAME.disc, { x, y, z }, { r, inner: 0.35, dur: 1e9, life: 0.9, size: Math.max(1.2, r * 0.25), rise: r * 0.45, count: 40, heat: 0.95 });
          f.int = 0;
        }
        if (!on) return;
        f.a.set(x, y, z);
        f.mat.setFloat("uR", r);
        f.int += ((burning ? 1 : 0) - f.int) * 0.05;
        f.mat.setFloat("uInt", f.int);
        // угольки вверх от спины — не каждый кадр
        if (burning && this.time >= emberAt) {
          emberAt = this.time + 0.35;
          this.burst(x, y + r * 0.4, z, FXC.fire, { count: 10, speed: 2.5, life: 1.2, grav: -2.5, size: 0.22, dir: [0, 1, 0], spread: 1.2 });
        }
        if (!burning && f.int < 0.02) {
          on = false;
          f.mesh.setEnabled(false);
          f.age = f.life;
        }
      },
      release: () => {
        f.held = false;
        f.age = f.life;
        f.mesh.setEnabled(false);
      },
    };
  }

  // ---------------------------------------------------------------- метеор

  /** Камень летит из from в to за sec (след пламени — отдельно, FLAME.trail с тем же путём). */
  rock(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, sec: number, size: number): void {
    const r = this.rocks[this.nR];
    this.nR = (this.nR + 1) % this.rocks.length;
    r.from.set(from.x, from.y, from.z);
    r.to.set(to.x, to.y, to.z);
    r.age = 0;
    r.life = sec;
    r.spin.set(Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3);
    r.mesh.scaling.setAll(size);
    r.mesh.position.copyFrom(r.from);
    r.mesh.setEnabled(true);
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
    s.mat.setFloat("uCount", Math.min(SPARKS, Math.max(3, Math.round((o.count ?? 20) * this.density))));
    s.mat.setColor3("uColor", color);
    s.mat.setFloat("uT", 0);
    s.age = 0;
    s.life = life;
    s.mesh.setEnabled(true);
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
    for (const d of this.decals) {
      if (d.age >= d.life) continue;
      d.age += dt;
      if (d.age >= d.life) {
        d.mesh.setEnabled(false);
        continue;
      }
      if (d.track) {
        const p = d.track();
        if (p) d.mesh.position.set(p.x, p.y + 0.06, p.z);
      }
      const prog = d.mode === FDECAL.tele || d.mode === FDECAL.wave;
      d.mat.setFloat("uT", prog ? d.age / d.life : d.age);
      d.mat.setFloat("uTime", this.time);
      const fin = d.fadeIn > 0 ? Math.min(1, d.age / d.fadeIn) : 1;
      const fout = d.fadeOut > 0 ? Math.min(1, (d.life - d.age) / d.fadeOut) : 1;
      d.mat.setFloat("uAlpha", fin * fout * d.alpha);
    }
    for (const f of this.flames) {
      if (f.age >= f.life) continue;
      f.age += dt;
      if (f.age >= f.life) {
        if (!f.held) f.mesh.setEnabled(false);
        f.track = null;
        continue;
      }
      if (f.track) {
        const p = f.track();
        if (p) f.a.set(p.x, p.y, p.z);
      }
      f.mat.setFloat("uTime", f.age);
    }
    if (this.rocks.some((r) => r.age < r.life)) this.rockMat.setFloat("uTime", this.time);
    for (const r of this.rocks) {
      if (r.age >= r.life) continue;
      r.age += dt;
      if (r.age >= r.life) {
        r.mesh.setEnabled(false);
        continue;
      }
      Vector3.LerpToRef(r.from, r.to, r.age / r.life, r.mesh.position);
      r.mesh.rotation.addInPlace(r.spin.scale(dt));
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
    for (const e of [...this.decals, ...this.flames, ...this.sparks]) {
      e.mat.dispose();
      e.mesh.dispose();
    }
    for (const r of this.rocks) r.mesh.dispose();
    this.rockMat.dispose();
    pools.delete(this.scene);
  }
}
