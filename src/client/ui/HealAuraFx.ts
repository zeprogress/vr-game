import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Constants } from "@babylonjs/core/Engines/constants";
import "@babylonjs/core/Meshes/Builders/discBuilder";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";

const AURA_COLOR = new Color3(0.35, 1, 0.55);
/** Сколько аур может гореть одновременно (несколько ботов-лекарей). */
const POOL = 4;

interface Aura {
  disc: Mesh;
  dome: Mesh;
  age: number;
  life: number;
  radius: number;
}

/**
 * Аура массового лечения: светящийся круг по земле + полупрозрачный купол,
 * растущие за время каста. Видно и своему игроку, и со стороны (спектатор),
 * так что каст бота-лекаря читается заранее — а не «внезапно все полечились».
 */
export class HealAuraFx {
  private readonly pool: Aura[] = [];
  private next = 0;

  constructor(scene: Scene) {
    for (let i = 0; i < POOL; i++) {
      const discMat = new StandardMaterial(`healAuraDiscMat${i}`, scene);
      discMat.emissiveColor = AURA_COLOR.clone();
      discMat.diffuseColor = new Color3(0, 0, 0);
      discMat.specularColor = new Color3(0, 0, 0);
      discMat.disableLighting = true;
      discMat.disableDepthWrite = true;
      discMat.alphaMode = Constants.ALPHA_ADD;
      discMat.backFaceCulling = false;

      const disc = MeshBuilder.CreateDisc(`healAuraDisc${i}`, { radius: 1, tessellation: 40 }, scene);
      disc.material = discMat;
      disc.rotation.x = Math.PI / 2;
      disc.isPickable = false;
      disc.renderingGroupId = 1;
      disc.setEnabled(false);

      const domeMat = new StandardMaterial(`healAuraDomeMat${i}`, scene);
      domeMat.emissiveColor = AURA_COLOR.scale(0.55);
      domeMat.diffuseColor = new Color3(0, 0, 0);
      domeMat.specularColor = new Color3(0, 0, 0);
      domeMat.disableLighting = true;
      domeMat.disableDepthWrite = true;
      domeMat.alphaMode = Constants.ALPHA_ADD;
      domeMat.backFaceCulling = false;

      const dome = MeshBuilder.CreateSphere(
        `healAuraDome${i}`,
        { diameter: 2, segments: 14, slice: 0.5 },
        scene,
      );
      dome.material = domeMat;
      dome.isPickable = false;
      dome.renderingGroupId = 1;
      dome.setEnabled(false);

      this.pool.push({ disc, dome, age: 1, life: 1, radius: 1 });
    }
  }

  /** Зажечь ауру радиусом `radius` м в точке на `life` секунд (время каста). */
  burst(x: number, y: number, z: number, radius: number, life: number): void {
    const a = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    a.age = 0;
    a.life = Math.max(0.2, life);
    a.radius = radius;
    a.disc.position.set(x, y + 0.06, z);
    a.dome.position.set(x, y + 0.02, z);
    a.disc.setEnabled(true);
    a.dome.setEnabled(true);
  }

  update(dt: number): void {
    for (const a of this.pool) {
      if (a.age >= a.life) continue;
      a.age += dt;
      if (a.age >= a.life) {
        a.disc.setEnabled(false);
        a.dome.setEnabled(false);
        continue;
      }
      const t = a.age / a.life;
      // Круг разворачивается за первую треть каста, дальше пульсирует.
      const grow = Math.min(1, t * 3);
      const pulse = 1 + Math.sin(a.age * 9) * 0.04;
      const r = a.radius * grow * pulse;
      a.disc.scaling.setAll(r);
      a.dome.scaling.set(r, r * 0.55, r);
      // Ярче к концу каста — момент выброса лечения читается.
      const k = 0.35 + 0.65 * t;
      (a.disc.material as StandardMaterial).alpha = 0.5 * k;
      (a.dome.material as StandardMaterial).alpha = 0.22 * k;
    }
  }

  dispose(): void {
    for (const a of this.pool) {
      a.disc.material?.dispose();
      a.dome.material?.dispose();
      a.disc.dispose();
      a.dome.dispose();
    }
  }
}
