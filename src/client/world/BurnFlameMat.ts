import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Effect } from "@babylonjs/core/Materials/effect";
import { Constants } from "@babylonjs/core/Engines/constants";

/**
 * Огонь на горящем мобе — ВЕСЬ на GPU: один меш из 23 квадов на моба (5 крупных + 18 мелких)
 * вместо 23 отдельных мешей с покадровым обновлением позиции/масштаба из JS. Всплытие,
 * пульсацию и размер языков считает вершинный шейдер по времени (`uTime`) и силе горения
 * (`uGlow`); из JS за кадр на моба — три числа-uniform и один draw call.
 *
 * Билборд тоже в шейдере, а центр карточки сдвигается вдоль луча к камере на толщину моба
 * (`uShift`, размер компенсируется): огонь проходит тест глубины против тела самого моба и
 * виден сквозь него, но землю и предметы между мобом и камерой не просвечивает.
 */
const NAME = "mobBurnFlame";

/** Размеры мелких языков (множитель к радиусу тела). */
const SMALL_SIZES = [0.78, 0.68, 0.42, 0.36, 0.4, 0.32, 0.38, 0.34, 0.44, 0.3, 0.37, 0.33, 0.41, 0.31, 0.39, 0.35, 0.3, 0.36];
const BIG = 5;

Effect.ShadersStore[`${NAME}VertexShader`] = `
precision highp float;
attribute vec3 position;
attribute vec4 aFlame; // x — угол на окружности, y — индекс (фаза), z — размер (× радиус тела), w — радиус орбиты (× радиус тела)
uniform mat4 world;
uniform mat4 viewProjection;
#ifdef MULTIVIEW
uniform mat4 viewProjectionR;
#endif
uniform mat4 view;
uniform float uTime;
uniform float uGlow;
uniform float uShift;
uniform float uR;
varying float vAlpha;
void main() {
  float ph = uTime * 7.0 + aFlame.y * 1.7;
  float rise = fract(uTime * 1.8 + aFlame.y * 0.37);
  float s = (1.0 - rise) * (0.7 + 0.5 * sin(ph)) * uGlow;
  float size = max(0.03, s * aFlame.z) * uR;
  // Центр языка в системе моба, затем в мир.
  vec3 local = vec3(cos(aFlame.x) * aFlame.w * uR, uR * (0.15 + rise * 1.5), sin(aFlame.x) * aFlame.w * uR);
  vec3 c = (world * vec4(local, 1.0)).xyz;
  float sc = length(world[0].xyz); // масштаб корня моба
  float sizeW = size * sc;
  vec3 t = view[3].xyz;
  vec3 cam = -vec3(dot(view[0].xyz, t), dot(view[1].xyz, t), dot(view[2].xyz, t));
  vec3 toC = c - cam;
  float d = max(length(toC), 1e-3);
  float shift = min(uShift, d * 0.8);
  vec3 c2 = c - (toC / d) * shift;
  float k = (d - shift) / d;
  vec3 h = normalize(vec3(-toC.x, 0.0, -toC.z) + vec3(1e-4, 0.0, 0.0));
  vec3 right = vec3(-h.z, 0.0, h.x);
  vec3 p = c2 + right * (position.x * sizeW * k) + vec3(0.0, position.y * sizeW * k, 0.0);
  vAlpha = (aFlame.z > 1.5 ? 0.275 : 0.38) * uGlow;
#ifdef MULTIVIEW
  if (gl_ViewID_OVR == 0u) { gl_Position = viewProjection * vec4(p, 1.0); } else { gl_Position = viewProjectionR * vec4(p, 1.0); }
#else
  gl_Position = viewProjection * vec4(p, 1.0);
#endif
}
`;

Effect.ShadersStore[`${NAME}FragmentShader`] = `
precision highp float;
varying float vAlpha;
void main() { gl_FragColor = vec4(1.0, 0.5, 0.12, vAlpha); }
`;

/** Общая геометрия (23 квада); у каждого горящего моба — клон, делящий буферы. */
let source: Mesh | null = null;

export function createBurnFlameMesh(scene: Scene, name: string): Mesh {
  if (!source || source.isDisposed() || source.getScene() !== scene) {
    const flames: { a: number; i: number; size: number; rad: number }[] = [];
    for (let i = 0; i < SMALL_SIZES.length; i++) {
      flames.push({ a: (i / SMALL_SIZES.length) * Math.PI * 2 * 2.3, i, size: SMALL_SIZES[i], rad: 0.95 });
    }
    for (let i = 0; i < BIG; i++) flames.push({ a: (i / BIG) * Math.PI * 2, i, size: 1.7, rad: 0.55 });
    const positions: number[] = [];
    const attr: number[] = [];
    const indices: number[] = [];
    flames.forEach((f, n) => {
      for (const [x, y] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
        positions.push(x, y, 0);
        attr.push(f.a, f.i, f.size, f.rad);
      }
      const o = n * 4;
      indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
    });
    source = new Mesh("mobBurnSrc", scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.applyToMesh(source);
    source.setVerticesData("aFlame", attr, false, 4);
    source.isPickable = false;
    source.setEnabled(false);
  }
  const m = source.clone(name);
  m.setEnabled(true);
  m.isPickable = false;
  m.alwaysSelectAsActiveMesh = true;
  return m;
}

export function makeBurnFlameMaterial(scene: Scene): ShaderMaterial {
  const m = new ShaderMaterial("mobBurnMat", scene, NAME, {
    attributes: ["position", "aFlame"],
    uniforms: ["world", "viewProjection", "view", "uTime", "uGlow", "uShift", "uR"],
    needAlphaBlending: true,
  });
  m.setFloat("uTime", 0);
  m.setFloat("uGlow", 0);
  m.setFloat("uShift", 0.9);
  m.setFloat("uR", 0.45);
  m.alphaMode = Constants.ALPHA_ADD;
  m.backFaceCulling = false;
  m.disableDepthWrite = true;
  return m;
}
