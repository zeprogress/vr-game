import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Effect } from "@babylonjs/core/Materials/effect";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";

/**
 * GPU-эффекты умений: всё рисуют шейдеры, из JS — пара чисел за кадр.
 * Пулы создаются один раз (никаких new/clone материалов в бою), смешивание
 * аддитивное, глубина не пишется. Вершинные шейдеры поддерживают MULTIVIEW
 * (стерео в шлеме за один проход).
 *
 *  decal  — плоский квад на земле: ударная волна с трещинами / зона с рунами / прицел;
 *  sparks — N квадов-искр, траектории считает вершинный шейдер (разлёт, гравитация);
 *  bolt   — молния: ломаная лента, дрожит в шейдере;
 *  pillar — столб света: открытый цилиндр с бегущими полосами.
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

const LIGHTNING = new Color3(0.3, 0.55, 1);
const LIGHTNING_CORE = new Color3(0.85, 0.93, 1);
const FIRE_CORE = new Color3(1, 0.9, 0.45);
const FIRE_ORANGE = new Color3(1, 0.5, 0.1);
const FIRE_RED = new Color3(1, 0.18, 0.06);

// ---------------------------------------------------------------- decal

Effect.ShadersStore["fxDecalVertexShader"] = `
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
Effect.ShadersStore["fxDecalFragmentShader"] = `
precision highp float;
varying vec2 vUV;
uniform vec3 uColor;
uniform float uT;      // прогресс 0..1 (волна) или время, с (зона/прицел)
uniform float uMode;   // 0 — ударная волна, 1 — зона, 2 — прицел, 3 — волна сектором (ось +x)
uniform float uHalf;   // полуугол сектора, рад (режим 3)
uniform float uAlpha;
uniform float uSeed;
float hash(float n) { return fract(sin(n * 12.9898 + uSeed) * 43758.5453); }
void main() {
  vec2 p = vUV * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);
  float al = 0.0;
  if (uMode < 0.5) {
    // Ударная волна: яркий фронт, за ним гаснущие радиальные трещины.
    float front = 0.12 + 0.88 * sqrt(uT);
    float band = exp(-pow((r - front) / 0.07, 2.0));
    float sector = floor((a + 3.14159) / 6.28318 * 11.0);
    float crackA = abs(fract((a + 3.14159) / 6.28318 * 11.0) - 0.5 + (hash(sector) - 0.5) * 0.5);
    float crack = smoothstep(0.06, 0.0, crackA) * step(r, front) * smoothstep(0.1, 0.35, r);
    float fill = step(r, front) * 0.18 * (1.0 - r);
    al = (band * 1.2 + crack * 0.9 + fill) * (1.0 - uT * uT);
  } else if (uMode < 1.5) {
    // Зона: светящийся край, кольцо рун (бегущие штрихи), мягкая заливка.
    float edge = exp(-pow((r - 0.965) / 0.03, 2.0));
    float runeBand = smoothstep(0.78, 0.8, r) * smoothstep(0.9, 0.88, r);
    float runes = step(0.55, fract((a + 3.14159) / 6.28318 * 18.0 + uT * 0.12)) * runeBand;
    float inner = exp(-pow((r - 0.6) / 0.015, 2.0)) * 0.6;
    float fill = 0.14 * smoothstep(1.0, 0.2, r);
    float pulse = 0.75 + 0.25 * sin(uT * 3.0);
    al = (edge * 1.1 + runes * 0.8 + inner + fill) * pulse;
  } else if (uMode > 2.5) {
    // Волна сектором (удар копья): тонкая дуга катится вперёд и гаснет,
    // края сектора мягкие — малозаметно, без заливки.
    float ang = abs(a);
    float side = smoothstep(uHalf, uHalf * 0.7, ang);
    float front = 0.15 + 0.85 * sqrt(uT);
    float band = exp(-pow((r - front) / 0.05, 2.0));
    float trail = step(r, front) * 0.1 * smoothstep(0.15, front, r);
    al = (band + trail) * side * (1.0 - uT) * smoothstep(0.05, 0.2, r);
  } else {
    // Прицел: кольцо и четыре засечки, крутится.
    float ring = exp(-pow((r - 0.78) / 0.05, 2.0));
    float aa = a + uT * 1.6;
    float ticks = smoothstep(0.92, 1.0, abs(cos(aa * 2.0))) * smoothstep(0.55, 0.62, r) * smoothstep(1.0, 0.92, r);
    al = ring + ticks * 1.2;
  }
  gl_FragColor = vec4(uColor * al * uAlpha, al * uAlpha);
}`;

// ---------------------------------------------------------------- sparks

const SPARKS = 28;
Effect.ShadersStore["fxSparksVertexShader"] = `
precision highp float;
attribute vec3 position;
attribute float aIdx;
uniform mat4 viewProjection;
uniform mat4 view;
${MV_HEAD}
uniform vec3 uCenter;
uniform vec3 uDir;     // направление разлёта (нулевое — во все стороны вверх)
uniform float uSpread; // 0..1: ширина конуса (1 — полусфера)
uniform float uT;      // секунд с начала
uniform float uLife;
uniform float uSpeed;
uniform float uGrav;   // >0 падают, <0 всплывают
uniform float uSize;
uniform float uSeed;
uniform float uCount;  // сколько искр показывать (остальные спрятаны)
varying vec2 vUV;
varying float vA;
float hash(float n) { return fract(sin(n * 12.9898 + uSeed) * 43758.5453); }
void main() {
  if (aIdx >= uCount || uT > uLife) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; vUV = vec2(0.0); return; }
  float k = aIdx;
  float delay = hash(k * 7.1) * 0.15 * uLife;
  float t = max(0.0, uT - delay);
  float u = hash(k * 1.7) * 6.28318;
  float w = hash(k * 3.3);
  vec3 rnd = normalize(vec3(cos(u) * sqrt(1.0 - w * w), w, sin(u) * sqrt(1.0 - w * w)));
  vec3 dir = length(uDir) > 0.01 ? normalize(mix(normalize(uDir), rnd, uSpread)) : rnd;
  float sp = uSpeed * (0.45 + 0.55 * hash(k * 5.9));
  vec3 c = uCenter + dir * sp * t + vec3(0.0, -0.5 * uGrav * t * t, 0.0);
  vec3 right = vec3(view[0][0], view[1][0], view[2][0]);
  vec3 up = vec3(view[0][1], view[1][1], view[2][1]);
  float life = clamp(t / max(0.01, uLife - delay), 0.0, 1.0);
  float s = uSize * (0.6 + 0.6 * hash(k * 9.1)) * (1.0 - 0.7 * life);
  vec3 p = c + (right * position.x + up * position.y) * s;
  vUV = position.xy + 0.5;
  vA = (1.0 - life) * step(delay, uT);
  ${MV_OUT("p")}
}`;
Effect.ShadersStore["fxSparksFragmentShader"] = `
precision highp float;
varying vec2 vUV;
varying float vA;
uniform vec3 uColor;
void main() {
  float d = length(vUV - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d) * vA;
  float core = smoothstep(0.45, 0.0, d);
  gl_FragColor = vec4(mix(uColor, vec3(1.0), core * 0.6) * a, a);
}`;

// ---------------------------------------------------------------- bolt

const BOLT_SEG = 14;
Effect.ShadersStore["fxBoltVertexShader"] = `
precision highp float;
attribute vec3 position; // x — доля вдоль (0..1), y — сторона (-1/1)
uniform mat4 viewProjection;
uniform mat4 view;
${MV_HEAD}
uniform vec3 uA;
uniform vec3 uB;
uniform float uTime;
uniform float uWidth;
uniform float uSeed;
uniform float uAmp;
varying float vSide;
float hash(float n) { return fract(sin(n * 12.9898 + uSeed) * 43758.5453); }
void main() {
  float t = position.x;
  vec3 ab = uB - uA;
  vec3 tv = view[3].xyz;
  vec3 cam = -vec3(dot(view[0].xyz, tv), dot(view[1].xyz, tv), dot(view[2].xyz, tv));
  vec3 mid = uA + ab * t;
  vec3 side = normalize(cross(ab, cam - mid) + vec3(1e-4, 0.0, 0.0));
  vec3 up2 = normalize(cross(side, ab) + vec3(0.0, 1e-4, 0.0));
  // Излом молнии: шум по сегментам, перескакивает ~12 раз в секунду.
  float seg = floor(t * ${BOLT_SEG.toFixed(1)});
  float tick = floor(uTime * 12.0);
  float env = sin(3.14159 * t);
  vec3 off = (side * (hash(seg + tick * 13.0) - 0.5) + up2 * (hash(seg * 3.0 + tick * 7.0) - 0.5)) * uAmp * env;
  vec3 p = mid + off + side * position.y * uWidth;
  vSide = position.y;
  ${MV_OUT("p")}
}`;
Effect.ShadersStore["fxBoltFragmentShader"] = `
precision highp float;
varying float vSide;
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  float s = 1.0 - abs(vSide);
  float a = (s * s * 0.8 + smoothstep(0.6, 1.0, s)) * uAlpha;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), smoothstep(0.7, 1.0, s)) * a, a);
}`;

// ---------------------------------------------------------------- pillar

Effect.ShadersStore["fxPillarVertexShader"] = `
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
Effect.ShadersStore["fxPillarFragmentShader"] = `
precision highp float;
varying vec2 vUV;
uniform vec3 uColor;
uniform float uTime;
uniform float uAlpha;
void main() {
  float v = vUV.y;
  float bands = 0.65 + 0.35 * sin(v * 18.0 - uTime * 7.0);
  float a = pow(1.0 - v, 1.6) * bands * uAlpha;
  gl_FragColor = vec4(uColor * a, a);
}`;

function shader(scene: Scene, name: string, base: string, attrs: string[], uniforms: string[]): ShaderMaterial {
  const m = new ShaderMaterial(name, scene, base, {
    attributes: attrs,
    uniforms: ["world", "view", "viewProjection", ...uniforms],
    needAlphaBlending: true,
  });
  m.alphaMode = Constants.ALPHA_ADD;
  m.backFaceCulling = false;
  m.disableDepthWrite = true;
  return m;
}

/** Откуда брать позицию «следящих» эффектов (вихрь вокруг героя, метка над мобом). */
export type FollowFn = (kind: "hero" | "mob", id: string) => { x: number; y: number; z: number } | null;

interface Decal {
  mesh: Mesh;
  mat: ShaderMaterial;
  age: number;
  life: number;
  mode: number;
  /** Сдвиг по высоте и цель слежения. */
  follow: { kind: "hero" | "mob"; id: string; dy: number } | null;
  fadeIn: number;
}
interface Sparks {
  mesh: Mesh;
  mat: ShaderMaterial;
  age: number;
  life: number;
  /** Свои векторы: setVector3 хранит ссылку, общий вектор испортил бы все эффекты. */
  center: Vector3;
  dir: Vector3;
}
interface Bolt {
  mesh: Mesh;
  mat: ShaderMaterial;
  age: number;
  life: number;
  a: Vector3;
  b: Vector3;
}
interface Pillar {
  mesh: Mesh;
  mat: ShaderMaterial;
  age: number;
  life: number;
  follow: { kind: "hero" | "mob"; id: string } | null;
}


export class SkillVfx {
  private readonly decals: Decal[] = [];
  private readonly sparks: Sparks[] = [];
  private readonly bolts: Bolt[] = [];
  private readonly pillars: Pillar[] = [];
  private nD = 0;
  private nS = 0;
  private nB = 0;
  private nP = 0;
  private time = 0;
  follow: FollowFn | null = null;

  constructor(scene: Scene) {
    for (let i = 0; i < 14; i++) {
      const mesh = MeshBuilder.CreatePlane(`vfxDecal${i}`, { size: 2 }, scene);
      mesh.rotation.x = Math.PI / 2;
      mesh.bakeCurrentTransformIntoVertices();
      const mat = shader(scene, `vfxDecalMat${i}`, "fxDecal", ["position", "uv"], ["uColor", "uT", "uMode", "uAlpha", "uSeed", "uHalf"]);
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.setEnabled(false);
      this.decals.push({ mesh, mat, age: 1, life: 1, mode: 0, follow: null, fadeIn: 0 });
    }
    // Искры: SPARKS квадов в одном меше.
    const pos: number[] = [];
    const idx: number[] = [];
    const attr: number[] = [];
    for (let k = 0; k < SPARKS; k++) {
      for (const [x, y] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
        pos.push(x, y, 0);
        attr.push(k);
      }
      idx.push(k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3);
    }
    for (let i = 0; i < 12; i++) {
      const mesh = new Mesh(`vfxSparks${i}`, scene);
      const vd = new VertexData();
      vd.positions = pos;
      vd.indices = idx;
      vd.applyToMesh(mesh);
      mesh.setVerticesData("aIdx", attr, false, 1);
      const mat = shader(scene, `vfxSparksMat${i}`, "fxSparks", ["position", "aIdx"], [
        "uCenter", "uDir", "uSpread", "uT", "uLife", "uSpeed", "uGrav", "uSize", "uSeed", "uCount", "uColor",
      ]);
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.setEnabled(false);
      const center = new Vector3();
      const dir = new Vector3();
      mat.setVector3("uCenter", center);
      mat.setVector3("uDir", dir);
      this.sparks.push({ mesh, mat, age: 1, life: 1, center, dir });
    }
    // Молния: лента из BOLT_SEG сегментов (x — доля, y — сторона).
    const bp: number[] = [];
    const bi: number[] = [];
    for (let s = 0; s <= BOLT_SEG; s++) {
      bp.push(s / BOLT_SEG, -1, 0, s / BOLT_SEG, 1, 0);
      if (s > 0) {
        const a = (s - 1) * 2;
        bi.push(a, a + 1, a + 3, a, a + 3, a + 2);
      }
    }
    for (let i = 0; i < 24; i++) {
      const mesh = new Mesh(`vfxBolt${i}`, scene);
      const vd = new VertexData();
      vd.positions = bp;
      vd.indices = bi;
      vd.applyToMesh(mesh);
      const mat = shader(scene, `vfxBoltMat${i}`, "fxBolt", ["position"], ["uA", "uB", "uTime", "uWidth", "uSeed", "uAmp", "uColor", "uAlpha"]);
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.setEnabled(false);
      const a = new Vector3();
      const b = new Vector3();
      mat.setVector3("uA", a);
      mat.setVector3("uB", b);
      this.bolts.push({ mesh, mat, age: 1, life: 1, a, b });
    }
    for (let i = 0; i < 6; i++) {
      const mesh = MeshBuilder.CreateCylinder(`vfxPillar${i}`, { height: 1, diameter: 2, tessellation: 24, cap: Mesh.NO_CAP }, scene);
      const mat = shader(scene, `vfxPillarMat${i}`, "fxPillar", ["position", "uv"], ["uColor", "uTime", "uAlpha"]);
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      this.pillars.push({ mesh, mat, age: 1, life: 1, follow: null });
    }
  }

  /** Ударная волна по земле (mode 0), зона (1, life — длительность), прицел (2). */
  decal(
    x: number, y: number, z: number, radius: number, color: Color3, life: number,
    mode: 0 | 1 | 2 | 3 = 0, alpha = 1, follow: { kind: "hero" | "mob"; id: string; dy: number } | null = null,
  ): void {
    const d = this.decals[this.nD];
    this.nD = (this.nD + 1) % this.decals.length;
    d.mesh.rotation.y = 0;
    d.mesh.position.set(x, y + 0.07 + (mode === 2 ? 0 : (this.nD % 5) * 0.004), z);
    d.mesh.scaling.set(radius, 1, radius);
    d.mat.setColor3("uColor", color);
    d.mat.setFloat("uMode", mode);
    d.mat.setFloat("uAlpha", alpha);
    d.mat.setFloat("uSeed", Math.random() * 50);
    d.mat.setFloat("uT", 0);
    Object.assign(d, { age: 0, life, mode, follow, fadeIn: mode === 0 || mode === 3 ? 0 : 0.25 });
    d.mesh.setEnabled(true);
  }

  /**
   * Волна сектором по земле: из (x,z) в сторону (dx,dz) на radius, полуугол
   * half (рад) — малозаметная дуга, катится вперёд за life с (удар копья).
   */
  cone(x: number, y: number, z: number, radius: number, dx: number, dz: number, half: number, color: Color3, life = 0.3, alpha = 0.5): void {
    const l = Math.hypot(dx, dz) || 1;
    this.decal(x, y, z, radius, color, life, 3, alpha);
    const d = this.decals[(this.nD + this.decals.length - 1) % this.decals.length];
    // Ось сектора в шейдере — локальная +x; поворот вокруг Y: (1,0,0) → (cos, 0, −sin).
    d.mesh.rotation.y = Math.atan2(-dz / l, dx / l);
    d.mat.setFloat("uHalf", half);
  }

  /**
   * Огненное дыхание (дракон): из пасти на высоте `mouthY` к (x2,z2) конусом
   * ±half — струя искр (жёлтое ядро → красные края), огненная волна по земле
   * и всплывающие угли по зоне. Всё из пулов, без новых мешей.
   */
  fireBreath(x: number, y: number, z: number, x2: number, z2: number, half: number, mouthY = 3): void {
    const dx = x2 - x;
    const dz = z2 - z;
    const len = Math.max(1, Math.hypot(dx, dz));
    const ux = dx / len;
    const uz = dz / len;
    const my = y + mouthY;
    // Волна по земле: красный широкий сектор + жёлтое ядро уже.
    this.cone(x, y, z, len, dx, dz, half, FIRE_RED, 0.75, 1);
    this.cone(x, y + 0.01, z, len * 0.8, dx, dz, half * 0.5, FIRE_CORE, 0.55, 0.9);
    // Струя: три снопа разной скорости и ширины (ядро быстрее и уже).
    const dir: [number, number, number] = [ux, -0.12, uz];
    this.burst(x + ux, my, z + uz, FIRE_CORE, { count: 28, speed: len * 1.6, life: 0.55, grav: -1, size: 0.55, dir, spread: half * 0.35 });
    this.burst(x + ux, my, z + uz, FIRE_ORANGE, { count: 28, speed: len * 1.3, life: 0.7, grav: -2, size: 0.7, dir, spread: half * 0.65 });
    this.burst(x + ux, my, z + uz, FIRE_RED, { count: 24, speed: len * 1.1, life: 0.8, grav: -3, size: 0.8, dir, spread: half });
    // Угли: всплывают по зоне поражения.
    for (const f of [0.35, 0.65, 0.95]) {
      this.burst(x + ux * len * f, y + 0.2, z + uz * len * f, FIRE_ORANGE, { count: 14, speed: 2.2, life: 1.2, grav: -2.5, size: 0.22 });
    }
  }

  /** Сноп искр: dir — направление (null — во все стороны), spread 0..1, grav >0 — падают, <0 — всплывают. */
  burst(
    x: number, y: number, z: number, color: Color3,
    o: { count?: number; speed?: number; life?: number; size?: number; grav?: number; dir?: [number, number, number] | null; spread?: number } = {},
  ): void {
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
    Object.assign(s, { age: 0, life });
    s.mesh.setEnabled(true);
  }

  /** Молния из A в B на life с. */
  bolt(ax: number, ay: number, az: number, bx: number, by: number, bz: number, color: Color3, life = 0.3, width = 0.08): void {
    const b = this.bolts[this.nB];
    this.nB = (this.nB + 1) % this.bolts.length;
    b.a.set(ax, ay, az);
    b.b.set(bx, by, bz);
    b.mat.setFloat("uWidth", width);
    b.mat.setFloat("uAmp", Math.min(1.2, Math.hypot(bx - ax, bz - az) * 0.12 + 0.2));
    b.mat.setFloat("uSeed", Math.random() * 50);
    b.mat.setColor3("uColor", color);
    b.mat.setFloat("uAlpha", 1);
    Object.assign(b, { age: 0, life });
    b.mesh.setEnabled(true);
  }

  /**
   * Молния атаки (синяя, заметная): толстый ствол + белое ядро, в точке
   * удара — вспышка на земле (если известна земля groundY) и сноп искр.
   */
  lightning(ax: number, ay: number, az: number, bx: number, by: number, bz: number, groundY: number | null, life = 0.35): void {
    this.bolt(ax, ay, az, bx, by, bz, LIGHTNING, life, 0.2);
    this.bolt(ax, ay, az, bx, by, bz, LIGHTNING_CORE, life * 0.8, 0.07);
    if (groundY !== null) this.decal(bx, groundY, bz, 1.6, LIGHTNING, 0.35, 0, 1.3);
    // Вспышка-шар в самой точке удара — видно и у летающих целей.
    this.burst(bx, by, bz, LIGHTNING, { count: 6, speed: 0.6, life: 0.2, grav: 0, size: 0.9 });
    this.burst(bx, by, bz, LIGHTNING, { count: 20, speed: 6, life: 0.45, grav: 8, size: 0.26 });
    this.burst(bx, by, bz, LIGHTNING_CORE, { count: 8, speed: 3, life: 0.25, grav: 0, size: 0.4 });
  }

  /** Столб света высотой h, радиус r; follow — держится над героем/мобом. */
  pillar(x: number, y: number, z: number, r: number, h: number, color: Color3, life: number, follow: { kind: "hero" | "mob"; id: string } | null = null): void {
    const p = this.pillars[this.nP];
    this.nP = (this.nP + 1) % this.pillars.length;
    p.mesh.position.set(x, y + h / 2, z);
    p.mesh.scaling.set(r, h, r);
    p.mat.setColor3("uColor", color);
    p.mat.setFloat("uAlpha", 0);
    Object.assign(p, { age: 0, life, follow });
    p.mesh.setEnabled(true);
  }

  update(dt: number): void {
    this.time += dt;
    for (const d of this.decals) {
      if (d.age >= d.life) continue;
      d.age += dt;
      if (d.age >= d.life) {
        d.mesh.setEnabled(false);
        continue;
      }
      if (d.follow && this.follow) {
        const at = this.follow(d.follow.kind, d.follow.id);
        if (at) d.mesh.position.set(at.x, at.y + d.follow.dy, at.z);
        else {
          // Цель умерла/пропала — не висим на месте до конца (метка — 8 с), а быстро гаснем.
          d.follow = null;
          d.life = Math.min(d.life, d.age + 0.3);
        }
      }
      if (d.mode === 0 || d.mode === 3) d.mat.setFloat("uT", d.age / d.life);
      else {
        d.mat.setFloat("uT", d.age);
        const fade = Math.min(1, d.age / d.fadeIn) * Math.min(1, (d.life - d.age) / 0.4);
        d.mat.setFloat("uAlpha", fade);
      }
    }
    for (const s of this.sparks) {
      if (s.age >= s.life) continue;
      s.age += dt;
      if (s.age >= s.life) s.mesh.setEnabled(false);
      else s.mat.setFloat("uT", s.age);
    }
    for (const b of this.bolts) {
      if (b.age >= b.life) continue;
      b.age += dt;
      if (b.age >= b.life) {
        b.mesh.setEnabled(false);
        continue;
      }
      b.mat.setFloat("uTime", this.time);
      b.mat.setFloat("uAlpha", 1 - (b.age / b.life) ** 2);
    }
    for (const p of this.pillars) {
      if (p.age >= p.life) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.mesh.setEnabled(false);
        continue;
      }
      if (p.follow && this.follow) {
        const at = this.follow(p.follow.kind, p.follow.id);
        if (at) p.mesh.position.set(at.x, at.y + p.mesh.scaling.y / 2, at.z);
        else {
          p.follow = null;
          p.life = Math.min(p.life, p.age + 0.3);
        }
      }
      p.mat.setFloat("uTime", this.time);
      p.mat.setFloat("uAlpha", Math.min(1, p.age / 0.15) * Math.min(1, (p.life - p.age) / 0.35) * 0.8);
    }
  }

  dispose(): void {
    for (const e of [...this.decals, ...this.sparks, ...this.bolts, ...this.pillars]) {
      e.mat.dispose();
      e.mesh.dispose();
    }
  }
}
