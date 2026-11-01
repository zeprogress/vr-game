import { FXC } from "./fxColors";
import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Constants } from "@babylonjs/core/Engines/constants";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { LAYER } from "../engine/renderLayers";

const AURA_COLOR = FXC.heal; // общая палитра shared/look.ts
/** Сколько аур может гореть одновременно (несколько ботов-лекарей). */
const POOL = 4;

interface Aura {
  dome: Mesh;
  core: Mesh;
  age: number;
  life: number;
  radius: number;
  /** За кем идти (свой герой или бот): аура лечения висит ВОКРУГ тела, а не лежит на земле. */
  follow: (() => { x: number; y: number; z: number } | null) | null;
}

/**
 * Аура массового лечения: мягкое ЗЕЛЁНОЕ СВЕЧЕНИЕ ВОКРУГ ГЕРОЯ и лёгкий купол — без диска
 * и обода по земле. Лечение читается по свету вокруг тела и по искрам, а не по «кругу с рунами»;
 * зона идёт за героем, потому что аура привязана к нему, а не к точке на земле.
 */
export class HealAuraFx {
  private readonly pool: Aura[] = [];
  private next = 0;

  constructor(scene: Scene) {
    for (let i = 0; i < POOL; i++) {
      // «Ядро» — мягкое свечение вокруг тела героя (сфера без граней и без обода).
      const coreMat = new StandardMaterial(`healAuraCoreMat${i}`, scene);
      coreMat.emissiveColor = AURA_COLOR.scale(0.5);
      coreMat.diffuseColor = new Color3(0, 0, 0);
      coreMat.specularColor = new Color3(0, 0, 0);
      coreMat.disableLighting = true;
      coreMat.disableDepthWrite = true;
      coreMat.alphaMode = Constants.ALPHA_ADD;
      coreMat.backFaceCulling = false;
      const core = MeshBuilder.CreateSphere(`healAuraCore${i}`, { diameter: 2, segments: 10 }, scene);
      core.material = coreMat;
      core.isPickable = false;
      core.renderingGroupId = LAYER.overlay;
      core.setEnabled(false);

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
      dome.renderingGroupId = LAYER.overlay;
      dome.setEnabled(false);

      this.pool.push({ dome, core, age: 1, life: 1, radius: 1, follow: null });
    }
  }

  /** Зажечь ауру вокруг героя: `follow` — за кем идти (null — стоим в точке x,y,z). */
  burst(
    x: number, y: number, z: number, radius: number, life: number,
    follow: (() => { x: number; y: number; z: number } | null) | null = null,
  ): void {
    const a = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    a.age = 0;
    a.life = Math.max(0.2, life);
    a.radius = radius;
    a.follow = follow;
    a.dome.position.set(x, y + 0.02, z);
    // Зона на земле (без follow) — свет лежит у пола; аура за героем — на уровне груди.
    a.core.position.set(x, y + (follow ? 1.0 : 0.35), z);
    a.dome.setEnabled(true);
    a.core.setEnabled(true);
  }

  update(dt: number): void {
    for (const a of this.pool) {
      if (a.age >= a.life) continue;
      a.age += dt;
      if (a.age >= a.life) {
        a.core.setEnabled(false);
        a.dome.setEnabled(false);
        continue;
      }
      // Аура идёт за героем: свет вокруг тела, а не пятно на земле.
      if (a.follow) {
        const at = a.follow();
        if (at) {
          a.dome.position.set(at.x, at.y + 0.02, at.z);
          a.core.position.set(at.x, at.y + 1.0, at.z);
        }
      }
      const t = a.age / a.life;
      const grow = Math.min(1, t * 3);
      const pulse = 1 + Math.sin(a.age * 3.4) * 0.05;
      const r = a.radius * 0.55 * grow * pulse;
      // Купол — мягкое свечение вокруг тела; ядро — плотный свет на уровне груди.
      if (a.follow) {
        a.dome.scaling.set(r * 1.15, r * 0.75, r * 1.15);
        a.core.scaling.setAll(r * 0.62);
      } else {
        // Зона на земле — приплюснутый свет, а не шар в воздухе.
        a.dome.scaling.set(r * 1.2, r * 0.22, r * 1.2);
        a.core.scaling.set(r * 0.9, r * 0.12, r * 0.9);
      }
      const k = 0.4 + 0.6 * t;
      (a.dome.material as StandardMaterial).alpha = 0.12 * k;
      (a.core.material as StandardMaterial).alpha = 0.16 * k;
    }
  }

  dispose(): void {
    for (const a of this.pool) {
      a.core.material?.dispose();
      a.dome.material?.dispose();
      a.core.dispose();
      a.dome.dispose();
    }
  }
}
