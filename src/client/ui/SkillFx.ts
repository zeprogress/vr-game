import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Effect } from "@babylonjs/core/Materials/effect";
import "@babylonjs/core/Meshes/Builders/discBuilder";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/Builders/torusBuilder";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";


const STUN = new Color3(1, 0.16, 0.1); // красная волна оглушения
const SPORE_C = new Color3(0.65, 0.25, 1); // фиолетовые споры (Грибной колосс)
const WRAITH_C = new Color3(0.6, 0.6, 0.64); // серая дымка (Костяной призрак)
const SQUID_C = new Color3(1, 0.22, 0.14); // красное щупальце (Небесный спрут) — атака, как и все атакующие эффекты
const BREATH_C = new Color3(1, 0.35, 0.05); // огонь дракона

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
  shafts: Mesh;
  shaftMat: ShaderMaterial;
  age: number;
  life: number;
  /** Замах до падения (телеграф); дальше ещё `life - cast` секунд идёт град. */
  cast: number;
  radius: number;
}

/** Облако спор: сначала `cast` с телеграфа (кольцо сжимается к центру), потом `hold` с яда. */
interface Spore {
  ring: Mesh;
  cloud: Mesh;
  puffs: Mesh;
  age: number;
  cast: number;
  life: number;
  radius: number;
}

/** Вспышка призрака: расширяющийся фиолетовый шар (out — схлопывается, in — вспыхивает). */
interface Puff {
  ball: Mesh;
  age: number;
  life: number;
  grow: boolean;
}

/** Щупальце спрута: линия от спрута к цели; телеграф — пульсирует, хват — вспышка и гаснет. */
interface Tentacle {
  rope: Mesh;
  age: number;
  life: number;
  snap: boolean;
}

/** Конус дыхания дракона: веер на земле (+Z вперёд, длина 1 — тянем scaling). */
interface Breath {
  fan: Mesh;
  age: number;
  life: number;
  hit: boolean;
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
  private readonly spores: Spore[] = [];
  private readonly puffs: Puff[] = [];
  private nextSpore = 0;
  private nextPuff = 0;
  private readonly ropes: Tentacle[] = [];
  private nextRope = 0;
  private readonly breaths: Breath[] = [];
  private nextBreath = 0;

  constructor(scene: Scene) {
    for (let i = 0; i < 4; i++) {
      // Веер-сектор ±0.45 рад (как EVENT.eliteHunt.breathHalf), радиус 1.
      const pos = [0, 0, 0];
      const idx: number[] = [];
      const N = 14;
      for (let k = 0; k <= N; k++) {
        const a = -0.45 + (0.9 * k) / N;
        pos.push(Math.sin(a), 0, Math.cos(a));
        if (k > 0) idx.push(0, k, k + 1);
      }
      const fan = new Mesh(`dragonBreath${i}`, scene);
      const vd = new VertexData();
      vd.positions = pos;
      vd.indices = idx;
      vd.applyToMesh(fan);
      fan.material = addMat(scene, `dragonBreathMat${i}`, BREATH_C);
      fan.isPickable = false;
      fan.setEnabled(false);
      this.breaths.push({ fan, age: 1, life: 1, hit: false });
    }
    for (let i = 0; i < 6; i++) {
      // Цилиндр длиной 1 вдоль +Z с основанием в начале координат — тянем scaling.z.
      const rope = MeshBuilder.CreateCylinder(`squidRope${i}`, { height: 1, diameterTop: 0.12, diameterBottom: 0.3, tessellation: 8 }, scene);
      rope.bakeTransformIntoVertices(
        Matrix.RotationX(Math.PI / 2).multiply(Matrix.Translation(0, 0, 0.5)),
      );
      rope.material = addMat(scene, `squidRopeMat${i}`, SQUID_C);
      rope.isPickable = false;
      rope.setEnabled(false);
      this.ropes.push({ rope, age: 1, life: 1, snap: false });
    }
    for (let i = 0; i < 8; i++) {
      const ring = MeshBuilder.CreateTorus(`sporeRing${i}`, { diameter: 2, thickness: 0.08, tessellation: 40 }, scene);
      ring.material = addMat(scene, `sporeRingMat${i}`, SPORE_C);
      const cloud = MeshBuilder.CreateSphere(`sporeCloud${i}`, { diameter: 2, segments: 12, slice: 0.5 }, scene);
      cloud.material = addMat(scene, `sporeCloudMat${i}`, SPORE_C.scale(0.6));
      // Клубы — несколько шариков одним мешем (одна отрисовка), крутятся и «дышат».
      const parts: Mesh[] = [];
      for (let k = 0; k < 7; k++) {
        const b = MeshBuilder.CreateSphere(`sporePuff${i}_${k}`, { diameter: 0.5 + (k % 3) * 0.25, segments: 6 }, scene);
        const a = (k / 7) * Math.PI * 2;
        b.position.set(Math.cos(a) * 0.55, 0.25 + (k % 2) * 0.3, Math.sin(a) * 0.55);
        parts.push(b);
      }
      const puffs = Mesh.MergeMeshes(parts, true) ?? parts[0];
      puffs.name = `sporePuffs${i}`;
      puffs.material = addMat(scene, `sporePuffMat${i}`, SPORE_C.scale(0.8));
      for (const m of [ring, cloud, puffs]) {
        m.isPickable = false;
        m.setEnabled(false);
      }
      this.spores.push({ ring, cloud, puffs, age: 1, cast: 1, life: 1, radius: 1 });
    }
    for (let i = 0; i < 8; i++) {
      const ball = MeshBuilder.CreateSphere(`wraithPuff${i}`, { diameter: 2, segments: 12 }, scene);
      ball.material = addMat(scene, `wraithPuffMat${i}`, WRAITH_C);
      ball.isPickable = false;
      ball.setEnabled(false);
      this.puffs.push({ ball, age: 1, life: 1, grow: true });
    }
    for (let i = 0; i < POOL; i++) {
      const shaftMat = makeShaftMaterial(scene, `rainShaftMat${i}`);
      const shafts = makeShaftMesh(scene, `rainShafts${i}`);
      shafts.material = shaftMat;
      this.rains.push({ shafts, shaftMat, age: 1, life: 1, cast: 1, radius: 1 });
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
    r.shaftMat.setVector3("uCenter", new Vector3(x, y + 0.02, z));
    r.shaftMat.setFloat("uRadius", radius);
    r.shaftMat.setFloat("uSeed", Math.random() * 100);
    r.shaftMat.setFloat("uT", 0);
    r.shaftMat.setFloat("uCast", r.cast);
    r.shaftMat.setFloat("uDur", hold);
    r.shafts.setEnabled(true);
  }

  /** Колосс пометил землю: `cast` с кольцо сжимается, дальше `hold` с клубится яд. */
  sporeZone(x: number, y: number, z: number, radius: number, cast: number, hold: number): void {
    const sp = this.spores[this.nextSpore];
    this.nextSpore = (this.nextSpore + 1) % this.spores.length;
    sp.age = 0;
    sp.cast = Math.max(0.2, cast);
    sp.life = sp.cast + hold;
    sp.radius = radius;
    sp.ring.position.set(x, y + 0.08, z);
    sp.cloud.position.set(x, y + 0.02, z);
    sp.puffs.position.set(x, y, z);
    sp.ring.setEnabled(true);
    sp.cloud.setEnabled(false);
    sp.puffs.setEnabled(false);
  }

  /** Призрак: `grow=false` — тает на месте (d с), `true` — вспышка появления. */
  wraithPuff(x: number, y: number, z: number, life: number, grow: boolean): void {
    const pf = this.puffs[this.nextPuff];
    this.nextPuff = (this.nextPuff + 1) % this.puffs.length;
    pf.age = 0;
    pf.life = Math.max(0.2, life);
    pf.grow = grow;
    pf.ball.position.set(x, y + 1.35, z);
    pf.ball.setEnabled(true);
  }

  /** Конус дыхания от (x,z) к (x2,z2): hit=false — телеграф на `life` с, true — вспышка огня. */
  breathCone(x: number, y: number, z: number, x2: number, z2: number, life: number, hit: boolean): void {
    const b = this.breaths[this.nextBreath];
    this.nextBreath = (this.nextBreath + 1) % this.breaths.length;
    b.age = 0;
    b.life = Math.max(0.2, life);
    b.hit = hit;
    const len = Math.max(1, Math.hypot(x2 - x, z2 - z));
    b.fan.position.set(x, y + 0.15, z);
    b.fan.rotation.y = Math.atan2(x2 - x, z2 - z);
    b.fan.scaling.set(len, 1, len);
    b.fan.setEnabled(true);
  }

  /** Щупальце от (fx,fy,fz) к (tx,ty,tz): snap=false — телеграф `life` с, true — хват (вспышка). */
  tentacle(fx: number, fy: number, fz: number, tx: number, ty: number, tz: number, life: number, snap: boolean): void {
    const t = this.ropes[this.nextRope];
    this.nextRope = (this.nextRope + 1) % this.ropes.length;
    t.age = 0;
    t.life = Math.max(0.15, life);
    t.snap = snap;
    const from = new Vector3(fx, fy, fz);
    const to = new Vector3(tx, ty, tz);
    const len = Vector3.Distance(from, to);
    t.rope.position.copyFrom(from);
    t.rope.lookAt(to);
    t.rope.scaling.set(1, 1, Math.max(0.1, len));
    t.rope.setEnabled(true);
  }

  update(dt: number): void {
    for (const b of this.breaths) {
      if (b.age >= b.life) continue;
      b.age += dt;
      if (b.age >= b.life) {
        b.fan.setEnabled(false);
        continue;
      }
      const k = b.age / b.life;
      const m = b.fan.material as StandardMaterial;
      // Телеграф: пульсирует и наливается; удар — яркая вспышка и гаснет.
      m.alpha = b.hit ? 0.95 * (1 - k) : (0.18 + 0.4 * k) * (0.6 + 0.4 * Math.abs(Math.sin(b.age * 16)));
    }
    for (const t of this.ropes) {
      if (t.age >= t.life) continue;
      t.age += dt;
      if (t.age >= t.life) {
        t.rope.setEnabled(false);
        continue;
      }
      const k = t.age / t.life;
      const m = t.rope.material as StandardMaterial;
      if (t.snap) {
        // Хват: толстая вспышка, быстро гаснет.
        t.rope.scaling.x = t.rope.scaling.y = 1.8 * (1 - k) + 0.4;
        m.alpha = 0.9 * (1 - k);
      } else {
        // Телеграф: щупальце пульсирует и «наливается» к моменту хвата.
        const pulse = 0.5 + 0.5 * Math.sin(t.age * 22);
        t.rope.scaling.x = t.rope.scaling.y = 0.6 + 0.6 * k;
        m.alpha = (0.25 + 0.45 * k) * (0.6 + 0.4 * pulse);
      }
    }
    for (const sp of this.spores) {
      if (sp.age >= sp.life) continue;
      sp.age += dt;
      if (sp.age >= sp.life) {
        sp.ring.setEnabled(false);
        sp.cloud.setEnabled(false);
        sp.puffs.setEnabled(false);
        continue;
      }
      const R = sp.radius;
      if (sp.age < sp.cast) {
        // Телеграф: кольцо на земле пульсирует и сжимается к центру — «беги отсюда».
        const t = sp.age / sp.cast;
        const r = R * (1 - 0.35 * t);
        sp.ring.scaling.set(r, 1, r);
        (sp.ring.material as StandardMaterial).alpha = 0.25 + 0.3 * Math.abs(Math.sin(sp.age * 14));
        continue;
      }
      // Облако: купол-туман на всю зону + клубы, в конце плавно гаснет.
      if (!sp.cloud.isEnabled()) {
        sp.cloud.setEnabled(true);
        sp.puffs.setEnabled(true);
      }
      const hold = sp.age - sp.cast;
      const rest = sp.life - sp.age;
      const fade = Math.min(1, hold / 0.3) * Math.min(1, rest / 0.8);
      sp.ring.scaling.set(R, 1, R);
      (sp.ring.material as StandardMaterial).alpha = 0.3 * fade;
      const breathe = 1 + 0.06 * Math.sin(sp.age * 3);
      sp.cloud.scaling.set(R * breathe, R * 0.45 * breathe, R * breathe);
      (sp.cloud.material as StandardMaterial).alpha = 0.09 * fade; // прозрачнее по просьбе (было 0.22)
      const pr = R * 0.9;
      sp.puffs.scaling.set(pr, pr * (0.8 + 0.2 * Math.sin(sp.age * 2.2)), pr);
      sp.puffs.rotation.y += dt * 0.6;
      (sp.puffs.material as StandardMaterial).alpha = 0.12 * fade; // было 0.3
    }
    for (const pf of this.puffs) {
      if (pf.age >= pf.life) continue;
      pf.age += dt;
      if (pf.age >= pf.life) {
        pf.ball.setEnabled(false);
        continue;
      }
      const t = pf.age / pf.life;
      // Исчезновение: тёмный сгусток сжимается в точку; появление — вспышка наружу.
      const r = pf.grow ? 0.4 + 1.8 * Math.sqrt(t) : 1.4 * (1 - t) + 0.1;
      pf.ball.scaling.setAll(r);
      // Прозрачнее, чем было (×0.7 → ×0.45) — по просьбе.
      (pf.ball.material as StandardMaterial).alpha = (pf.grow ? 1 - t : 0.4 + 0.5 * t) * 0.45;
    }

    for (const r of this.rains) {
      if (r.age >= r.life) continue;
      r.age += dt;
      const done = r.age >= r.life;
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
    for (const b of this.breaths) {
      b.fan.material?.dispose();
      b.fan.dispose();
    }
    for (const t of this.ropes) {
      t.rope.material?.dispose();
      t.rope.dispose();
    }
    for (const sp of this.spores) {
      for (const m of [sp.ring, sp.cloud, sp.puffs]) {
        m.material?.dispose();
        m.dispose();
      }
    }
    for (const pf of this.puffs) {
      pf.ball.material?.dispose();
      pf.ball.dispose();
    }
    for (const st of this.stuns) {
      st.dome.material?.dispose();
      st.dome.dispose();
    }
    for (const r of this.rains) {
      r.shaftMat.dispose();
      r.shafts.dispose();
    }
  }
}
