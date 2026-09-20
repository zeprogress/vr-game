import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Effect } from "@babylonjs/core/Materials/effect";
import "@babylonjs/core/Meshes/Builders/discBuilder";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";


const RAIN = new Color3(1, 0.78, 0.28);
const STUN = new Color3(1, 0.16, 0.1); // красная волна оглушения

const POOL = 3;

/** Сколько древков падает в граде (визуал, урон считает сервер). */
const SHAFTS = 22;

/**
 * Древки града стрел — ОДИН меш из SHAFTS вертикальных квадов на каждый круг; позицию, момент
 * падения и прозрачность каждого древка считает вершинный шейдер (хэш от индекса и сида каста).
 * Из JS за кадр — одно число (`uT`, прогресс каста), вместо покадрового обновления 22 мешей.
 */
const SHAFT = "rainShafts";
Effect.ShadersStore[`${SHAFT}VertexShader`] = `
precision highp float;
attribute vec3 position;
attribute float aShaft;
uniform mat4 viewProjection;
#ifdef MULTIVIEW
uniform mat4 viewProjectionR;
#endif
uniform mat4 view;
uniform vec3 uCenter;
uniform float uRadius;
uniform float uT;    // секунд с начала каста
uniform float uCast; // длительность замаха: до неё древков нет
uniform float uDur;  // сколько секунд после замаха идёт град
uniform float uSeed;
varying float vAlpha;
float hash(float n) { return fract(sin(n * 12.9898 + uSeed) * 43758.5453); }
void main() {
  float k = aShaft;
  // После замаха древки сыплются по кругу: у каждого свой сдвиг, период 0.7 с, летит 0.35 с,
  // при каждом новом заходе — новая точка внутри круга.
  float t2 = uT - uCast;
  float off = hash(k * 5.3 + 2.1) * 0.7;
  float cyc = (t2 - off) / 0.7;
  float local = fract(cyc) / 0.5;
  if (t2 < 0.0 || t2 > uDur || cyc < 0.0 || local > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlpha = 0.0; return; }
  float n = floor(cyc);
  float a = hash(k * 3.1 + n * 17.0) * 6.2831853;
  float r = sqrt(hash(k * 7.7 + 1.3 + n * 29.0)) * uRadius;
  vec3 c = uCenter + vec3(cos(a) * r, (1.0 - local) * 9.0 + 0.5, sin(a) * r);
  vec3 tv = view[3].xyz;
  vec3 cam = -vec3(dot(view[0].xyz, tv), dot(view[1].xyz, tv), dot(view[2].xyz, tv));
  vec3 h = normalize(vec3(cam.x - c.x, 0.0, cam.z - c.z) + vec3(1e-4, 0.0, 0.0));
  vec3 right = vec3(-h.z, 0.0, h.x);
  // Тонкое древко 1.1 м: внизу шире (0.06), вверху уже (0.02).
  float w = mix(0.06, 0.02, position.y + 0.5);
  vec3 p = c + right * (position.x * w) + vec3(0.0, position.y * 1.1, 0.0);
  vAlpha = min(1.0, (1.0 - local) * 3.0) * 0.9;
#ifdef MULTIVIEW
  if (gl_ViewID_OVR == 0u) { gl_Position = viewProjection * vec4(p, 1.0); } else { gl_Position = viewProjectionR * vec4(p, 1.0); }
#else
  gl_Position = viewProjection * vec4(p, 1.0);
#endif
}
`;
Effect.ShadersStore[`${SHAFT}FragmentShader`] = `
precision highp float;
varying float vAlpha;
void main() { gl_FragColor = vec4(1.0, 0.78, 0.28, vAlpha); }
`;

let shaftSource: Mesh | null = null;
function makeShaftMesh(scene: Scene, name: string): Mesh {
  if (!shaftSource || shaftSource.isDisposed() || shaftSource.getScene() !== scene) {
    const pos: number[] = [];
    const idx: number[] = [];
    const attr: number[] = [];
    for (let k = 0; k < SHAFTS; k++) {
      for (const [x, y] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
        pos.push(x, y, 0);
        attr.push(k);
      }
      idx.push(k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3);
    }
    shaftSource = new Mesh("rainShaftSrc", scene);
    const vd = new VertexData();
    vd.positions = pos;
    vd.indices = idx;
    vd.applyToMesh(shaftSource);
    shaftSource.setVerticesData("aShaft", attr, false, 1);
    shaftSource.isPickable = false;
    shaftSource.setEnabled(false);
  }
  const m = shaftSource.clone(name);
  m.isPickable = false;
  m.alwaysSelectAsActiveMesh = true;
  m.setEnabled(false);
  return m;
}

function makeShaftMaterial(scene: Scene, name: string): ShaderMaterial {
  const m = new ShaderMaterial(name, scene, SHAFT, {
    attributes: ["position", "aShaft"],
    uniforms: ["viewProjection", "view", "uCenter", "uRadius", "uT", "uCast", "uDur", "uSeed"],
    needAlphaBlending: true,
  });
  m.setVector3("uCenter", Vector3.Zero());
  m.setFloat("uRadius", 1);
  m.setFloat("uT", 0);
  m.setFloat("uCast", 1);
  m.setFloat("uDur", 3);
  m.setFloat("uSeed", 0);
  m.alphaMode = Constants.ALPHA_ADD;
  m.backFaceCulling = false;
  m.disableDepthWrite = true;
  return m;
}


function addMat(scene: Scene, name: string, color: Color3): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.emissiveColor = color.clone();
  m.diffuseColor = new Color3(0, 0, 0);
  m.specularColor = new Color3(0, 0, 0);
  m.disableLighting = true;
  m.disableDepthWrite = true;
  m.alphaMode = Constants.ALPHA_ADD;
  m.backFaceCulling = false;
  // Раньше эффекты сидели в renderingGroupId=1 (там глубина стирается) и просвечивали сквозь землю и
  // предметы; теперь обычная очередь с тестом глубины, а круги на земле подтянуты к камере.
  m.zOffset = -4;
  return m;
}

interface Rain {
  dome: Mesh;
  shafts: Mesh;
  shaftMat: ShaderMaterial;
  age: number;
  life: number;
  /** Замах до падения (телеграф); дальше ещё `life - cast` секунд идёт град. */
  cast: number;
  radius: number;
}

interface Stun {
  dome: Mesh;
  age: number;
  life: number;
  radius: number;
}

/**
 * Визуал массовых скиллов ботов: красная волна «Оглушающего удара» и
 * золотой круг «Града стрел» с падающими древками. Общий пул на сцену —
 * используется и в игре, и у спектатора.
 */
export class SkillFx {
  private readonly rains: Rain[] = [];
  private readonly stuns: Stun[] = [];
  private nextRain = 0;
  private nextStun = 0;

  constructor(scene: Scene) {
    for (let i = 0; i < POOL; i++) {
      // Купол вместо плоского круга на земле (как у оглушения), нижний диск убран.
      const dome = MeshBuilder.CreateSphere(`rainDome${i}`, { diameter: 2, segments: 14, slice: 0.5 }, scene);
      dome.material = addMat(scene, `rainDomeMat${i}`, RAIN.scale(0.55));
      dome.isPickable = false;
      dome.setEnabled(false);

      const shaftMat = makeShaftMaterial(scene, `rainShaftMat${i}`);
      const shafts = makeShaftMesh(scene, `rainShafts${i}`);
      shafts.material = shaftMat;
      this.rains.push({ dome, shafts, shaftMat, age: 1, life: 1, cast: 1, radius: 1 });
    }

    for (let i = 0; i < POOL; i++) {
      // Купол над кольцом — прозрачности как у массового хила (купол 0.16, нижний диск 0.13).
      const dome = MeshBuilder.CreateSphere(`stunDome${i}`, { diameter: 2, segments: 14, slice: 0.5 }, scene);
      dome.material = addMat(scene, `stunDomeMat${i}`, STUN.scale(0.55));
      dome.isPickable = false;
      dome.setEnabled(false);
      this.stuns.push({ dome, age: 1, life: 1, radius: 1 });
    }
  }

  /** Красная волна оглушения по земле: расходится из-под бота на всю область. */
  stunBash(x: number, y: number, z: number, radius: number, life: number): void {
    const st = this.stuns[this.nextStun];
    this.nextStun = (this.nextStun + 1) % this.stuns.length;
    st.age = 0;
    st.life = Math.max(0.2, life);
    st.radius = radius;
    st.dome.position.set(x, y + 0.02, z);
    st.dome.setEnabled(true);
  }

  /** Круг града стрел на земле + падающие древки: `cast` — замах, потом `hold` секунд град. */
  arrowRain(x: number, y: number, z: number, radius: number, cast: number, hold: number): void {
    const r = this.rains[this.nextRain];
    this.nextRain = (this.nextRain + 1) % this.rains.length;
    r.age = 0;
    r.cast = Math.max(0.3, cast);
    r.life = r.cast + hold;
    r.radius = radius;
    r.dome.position.set(x, y + 0.02, z);
    r.dome.setEnabled(true);
    r.shaftMat.setVector3("uCenter", new Vector3(x, y + 0.02, z));
    r.shaftMat.setFloat("uRadius", radius);
    r.shaftMat.setFloat("uSeed", Math.random() * 100);
    r.shaftMat.setFloat("uT", 0);
    r.shaftMat.setFloat("uCast", r.cast);
    r.shaftMat.setFloat("uDur", hold);
    r.shafts.setEnabled(true);
  }

  update(dt: number): void {
    for (const r of this.rains) {
      if (r.age >= r.life) continue;
      r.age += dt;
      const done = r.age >= r.life;
      // Замах: купол пульсирует и наливается («сюда сейчас прилетит»); потом держится, пока
      // сыплются стрелы, и гаснет в последние 0.4 с.
      const pulse = 1 + Math.sin(r.age * 11) * 0.03;
      const rr = r.radius * pulse;
      r.dome.scaling.set(rr, rr * 0.55, rr);
      const t = Math.min(1, r.age / r.cast);
      const fadeOut = Math.min(1, (r.life - r.age) / 0.4);
      (r.dome.material as StandardMaterial).alpha = done ? 0 : 0.32 * (0.45 + 0.55 * t) * fadeOut;
      if (done) r.dome.setEnabled(false);

      // Древки целиком на GPU: из JS только время.
      if (done) r.shafts.setEnabled(false);
      else r.shaftMat.setFloat("uT", r.age);
    }

    for (const st of this.stuns) {
      if (st.age >= st.life) continue;
      st.age += dt;
      if (st.age >= st.life) {
        st.dome.setEnabled(false);
        continue;
      }
      const t = st.age / st.life;
      // Волна стремительно расходится наружу и гаснет: только купол (нижний диск убран по
      // просьбе), прозрачность как у купола массового хила — 0.16.
      const r = st.radius * (0.15 + 0.95 * Math.sqrt(t));
      st.dome.scaling.set(r, r * 0.55, r);
      const fade = 1 - t;
      (st.dome.material as StandardMaterial).alpha = 0.32 * fade; // было 0.16 — плотнее вдвое
    }
  }

  dispose(): void {
    for (const st of this.stuns) {
      st.dome.material?.dispose();
      st.dome.dispose();
    }
    for (const r of this.rains) {
      r.dome.material?.dispose();
      r.dome.dispose();
      r.shaftMat.dispose();
      r.shafts.dispose();
    }
  }
}
