import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Constants } from "@babylonjs/core/Engines/constants";
import "@babylonjs/core/Meshes/Builders/discBuilder";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";


const RAIN = new Color3(1, 0.78, 0.28);
const STUN = new Color3(1, 0.92, 0.4); // жёлтая волна оглушения

const POOL = 3;
/** Сколько древков падает в граде (визуал, урон считает сервер). */
const SHAFTS = 22;

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
  ring: Mesh;
  shafts: Mesh[];
  seeds: { a: number; r: number; t: number }[];
  age: number;
  life: number;
  radius: number;
}

interface Stun {
  ring: Mesh;
  dome: Mesh;
  age: number;
  life: number;
  radius: number;
}

/**
 * Визуал массовых скиллов ботов: жёлтая волна «Оглушающего удара» и
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
      const ring = MeshBuilder.CreateDisc(`rainRing${i}`, { radius: 1, tessellation: 44 }, scene);
      ring.material = addMat(scene, `rainRingMat${i}`, RAIN);
      ring.rotation.x = Math.PI / 2;
      ring.isPickable = false;
      ring.setEnabled(false);

      const shafts: Mesh[] = [];
      const shaftMat = addMat(scene, `rainShaftMat${i}`, RAIN);
      for (let k = 0; k < SHAFTS; k++) {
        const sh = MeshBuilder.CreateCylinder(
          `rainShaft${i}_${k}`,
          { height: 1.1, diameterTop: 0.02, diameterBottom: 0.06, tessellation: 4 },
          scene,
        );
        sh.material = shaftMat;
        sh.isPickable = false;
        sh.setEnabled(false);
        shafts.push(sh);
      }
      this.rains.push({ ring, shafts, seeds: [], age: 1, life: 1, radius: 1 });
    }

    for (let i = 0; i < POOL; i++) {
      const ring = MeshBuilder.CreateDisc(`stunRing${i}`, { radius: 1, tessellation: 40 }, scene);
      ring.material = addMat(scene, `stunRingMat${i}`, STUN);
      ring.rotation.x = Math.PI / 2;
      ring.isPickable = false;
      ring.setEnabled(false);
      // Купол над кольцом — прозрачности как у массового хила (купол 0.16, нижний диск 0.13).
      const dome = MeshBuilder.CreateSphere(`stunDome${i}`, { diameter: 2, segments: 14, slice: 0.5 }, scene);
      dome.material = addMat(scene, `stunDomeMat${i}`, STUN.scale(0.55));
      dome.isPickable = false;
      dome.setEnabled(false);
      this.stuns.push({ ring, dome, age: 1, life: 1, radius: 1 });
    }
  }

  /** Жёлтая волна оглушения по земле: расходится из-под бота на всю область. */
  stunBash(x: number, y: number, z: number, radius: number, life: number): void {
    const st = this.stuns[this.nextStun];
    this.nextStun = (this.nextStun + 1) % this.stuns.length;
    st.age = 0;
    st.life = Math.max(0.2, life);
    st.radius = radius;
    st.ring.position.set(x, y + 0.06, z);
    st.ring.setEnabled(true);
    st.dome.position.set(x, y + 0.02, z);
    st.dome.setEnabled(true);
  }

  /** Круг града стрел на земле + падающие древки. */
  arrowRain(x: number, y: number, z: number, radius: number, life: number): void {
    const r = this.rains[this.nextRain];
    this.nextRain = (this.nextRain + 1) % this.rains.length;
    r.age = 0;
    r.life = Math.max(0.3, life);
    r.radius = radius;
    r.ring.position.set(x, y + 0.06, z);
    r.ring.setEnabled(true);
    r.seeds = r.shafts.map((_, k) => ({
      a: Math.random() * Math.PI * 2,
      r: Math.sqrt(Math.random()) * radius,
      // Древки сыплются волной к концу замаха, а не все разом.
      t: 0.45 + (k / SHAFTS) * 0.55 + Math.random() * 0.12,
    }));
    for (const sh of r.shafts) sh.setEnabled(false);
  }

  update(dt: number): void {
    for (const r of this.rains) {
      if (r.age >= r.life) continue;
      r.age += dt;
      const done = r.age >= r.life;
      const t = Math.min(1, r.age / r.life);
      // Круг пульсирует и наливается — телеграф «сюда сейчас прилетит».
      const pulse = 1 + Math.sin(r.age * 11) * 0.03;
      r.ring.scaling.setAll(r.radius * pulse);
      (r.ring.material as StandardMaterial).alpha = (0.18 + 0.42 * t) * (done ? 0 : 1);
      if (done) r.ring.setEnabled(false);

      for (let k = 0; k < r.shafts.length; k++) {
        const sh = r.shafts[k];
        const seed = r.seeds[k];
        if (!seed) continue;
        // Каждое древко летит свой отрезок времени: от t0 до t0+0.35.
        const local = (t - seed.t) / 0.35;
        if (local < 0 || local > 1) {
          sh.setEnabled(false);
          continue;
        }
        sh.setEnabled(true);
        const px = r.ring.position.x + Math.cos(seed.a) * seed.r;
        const pz = r.ring.position.z + Math.sin(seed.a) * seed.r;
        sh.position.set(px, r.ring.position.y + (1 - local) * 9 + 0.5, pz);
        (sh.material as StandardMaterial).alpha = Math.min(1, (1 - local) * 3) * 0.9;
      }
      if (done) for (const sh of r.shafts) sh.setEnabled(false);
    }

    for (const st of this.stuns) {
      if (st.age >= st.life) continue;
      st.age += dt;
      if (st.age >= st.life) {
        st.ring.setEnabled(false);
        st.dome.setEnabled(false);
        continue;
      }
      const t = st.age / st.life;
      // Волна стремительно расходится наружу и гаснет: нижний диск и купол над ним, с теми же
      // прозрачностями, что у массового хила (диск 0.13, купол 0.16).
      const r = st.radius * (0.15 + 0.95 * Math.sqrt(t));
      st.ring.scaling.setAll(r);
      st.dome.scaling.set(r, r * 0.55, r);
      const fade = 1 - t;
      (st.ring.material as StandardMaterial).alpha = 0.13 * fade;
      (st.dome.material as StandardMaterial).alpha = 0.16 * fade;
    }
  }

  dispose(): void {
    for (const st of this.stuns) {
      st.ring.material?.dispose();
      st.ring.dispose();
      st.dome.material?.dispose();
      st.dome.dispose();
    }
    for (const r of this.rains) {
      r.ring.material?.dispose();
      r.ring.dispose();
      r.shafts[0]?.material?.dispose();
      for (const sh of r.shafts) sh.dispose();
    }
  }
}
