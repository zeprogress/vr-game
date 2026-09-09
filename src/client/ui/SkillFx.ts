import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Constants } from "@babylonjs/core/Engines/constants";
import "@babylonjs/core/Meshes/Builders/discBuilder";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";

import { BOT } from "#shared/constants";

const RED = new Color3(1, 0.16, 0.12);
const RED_HOT = new Color3(1, 0.62, 0.3);
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
  return m;
}

/** Плоский сектор радиуса 1 в XZ, раскрытый вдоль +Z на ±halfAngle. */
function coneFan(scene: Scene, name: string, halfAngle: number, segs = 28): Mesh {
  const pos: number[] = [0, 0, 0];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = -halfAngle + (i / segs) * halfAngle * 2;
    pos.push(Math.sin(a), 0, Math.cos(a));
  }
  for (let i = 1; i <= segs; i++) idx.push(0, i + 1, i);
  const m = new Mesh(name, scene);
  const vd = new VertexData();
  const nrm: number[] = [];
  VertexData.ComputeNormals(pos, idx, nrm);
  vd.positions = pos;
  vd.indices = idx;
  vd.normals = nrm;
  vd.applyToMesh(m);
  return m;
}

interface Cleave {
  fan: Mesh;
  age: number;
  life: number;
  radius: number;
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
  age: number;
  life: number;
  radius: number;
}

/**
 * Визуал массовых скиллов ботов: красный сектор «Рассекающего удара» и
 * золотой круг «Града стрел» с падающими древками. Общий пул на сцену —
 * используется и в игре, и у спектатора.
 */
export class SkillFx {
  private readonly cleaves: Cleave[] = [];
  private readonly rains: Rain[] = [];
  private readonly stuns: Stun[] = [];
  private nextCleave = 0;
  private nextRain = 0;
  private nextStun = 0;

  constructor(scene: Scene) {
    for (let i = 0; i < POOL; i++) {
      const fan = coneFan(scene, `cleaveFan${i}`, BOT.cleaveCone);
      fan.material = addMat(scene, `cleaveFanMat${i}`, RED);
      fan.isPickable = false;
      fan.renderingGroupId = 1;
      fan.setEnabled(false);
      this.cleaves.push({ fan, age: 1, life: 1, radius: 1 });
    }

    for (let i = 0; i < POOL; i++) {
      const ring = MeshBuilder.CreateDisc(`rainRing${i}`, { radius: 1, tessellation: 44 }, scene);
      ring.material = addMat(scene, `rainRingMat${i}`, RAIN);
      ring.rotation.x = Math.PI / 2;
      ring.isPickable = false;
      ring.renderingGroupId = 1;
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
        sh.renderingGroupId = 1;
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
      ring.renderingGroupId = 1;
      ring.setEnabled(false);
      this.stuns.push({ ring, age: 1, life: 1, radius: 1 });
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
  }

  /** Красный сектор перед ботом: `yaw` — куда смотрит, `life` — время замаха. */
  cleave(x: number, y: number, z: number, yaw: number, radius: number, life: number): void {
    const c = this.cleaves[this.nextCleave];
    this.nextCleave = (this.nextCleave + 1) % this.cleaves.length;
    c.age = 0;
    c.life = Math.max(0.15, life);
    c.radius = radius;
    c.fan.position.set(x, y + 0.07, z);
    c.fan.rotation.y = yaw;
    c.fan.setEnabled(true);
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
    for (const c of this.cleaves) {
      if (c.age >= c.life) continue;
      c.age += dt;
      if (c.age >= c.life) {
        c.fan.setEnabled(false);
        continue;
      }
      const t = c.age / c.life;
      // Сектор выстреливает вперёд к концу замаха и вспыхивает на самом ударе.
      const grow = 0.25 + 0.75 * (t * t);
      c.fan.scaling.set(c.radius * grow, 1, c.radius * grow);
      const mat = c.fan.material as StandardMaterial;
      mat.alpha = 0.22 + 0.5 * t;
      mat.emissiveColor.copyFrom(t > 0.85 ? RED_HOT : RED);
    }

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
        continue;
      }
      const t = st.age / st.life;
      // Кольцо стремительно расходится наружу и гаснет.
      st.ring.scaling.setAll(st.radius * (0.15 + 0.95 * Math.sqrt(t)));
      (st.ring.material as StandardMaterial).alpha = (1 - t) * 0.55;
    }
  }

  dispose(): void {
    for (const c of this.cleaves) {
      c.fan.material?.dispose();
      c.fan.dispose();
    }
    for (const st of this.stuns) {
      st.ring.material?.dispose();
      st.ring.dispose();
    }
    for (const r of this.rains) {
      r.ring.material?.dispose();
      r.ring.dispose();
      r.shafts[0]?.material?.dispose();
      for (const sh of r.shafts) sh.dispose();
    }
  }
}
