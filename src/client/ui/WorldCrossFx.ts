import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Constants } from "@babylonjs/core/Engines/constants";

import { CROSS_GREEN, CROSS_ORANGE } from "./HealCrossFx";

export { CROSS_GREEN, CROSS_ORANGE };

/** Сколько крестиков живёт одновременно на всю сцену. */
const POOL = 48;
const LIFE = 1.5; // с полёта
const RISE = 1.6; // м вверх за жизнь
const SPREAD = 0.9; // м разлёта по горизонтали

/** Красная вспышка критического выстрела — вспыхивает на мобе и гаснет. */
const CRIT_POOL = 12;
const CRIT_LIFE = 0.36; // с

interface CritBurst {
  mesh: Mesh;
  age: number;
  x: number;
  y: number;
  z: number;
}

interface Cross {
  mesh: Mesh;
  age: number; // < 0 — задержка вылета, чтобы шли волной
  x: number;
  y: number;
  z: number;
  dx: number;
  dz: number;
}

/**
 * Крестики, всплывающие ВОКРУГ объекта в мире: зелёные при лечении,
 * оранжевые при повышении уровня.
 *
 * Отличается от HealCrossFx тем, что тот рисует их перед глазами своего
 * игрока (эффект от первого лица), а этот — над чужим телом, чтобы событие
 * читалось со стороны: у бота на стриме, у соседа по зоне.
 *
 * Общий пул на сцену: крестиков может быть много, но меши переиспользуются.
 */
export class WorldCrossFx {
  private readonly pool: Cross[] = [];
  private next = 0;
  private readonly critPool: CritBurst[] = [];
  private critNext = 0;

  constructor(private readonly scene: Scene) {
    const bar = MeshBuilder.CreateBox("wCrossH", { width: 0.34, height: 0.08, depth: 0.08 }, scene);
    const post = MeshBuilder.CreateBox("wCrossV", { width: 0.08, height: 0.34, depth: 0.08 }, scene);
    const merged = Mesh.MergeMeshes([bar, post], true, true);
    const proto = merged ?? bar;
    if (!merged) post.dispose();
    proto.name = "wCrossProto";

    for (let i = 0; i < POOL; i++) {
      const m = i === 0 ? proto : proto.clone(`wCross${i}`);
      const mat = new StandardMaterial(`wCrossMat${i}`, scene);
      mat.emissiveColor = CROSS_GREEN.clone();
      mat.diffuseColor = new Color3(0, 0, 0);
      mat.specularColor = new Color3(0, 0, 0);
      mat.disableLighting = true;
      mat.disableDepthWrite = true;
      m.material = mat;
      m.isPickable = false;
      m.renderingGroupId = 1; // поверх мира, но под интерфейсом
      m.billboardMode = Mesh.BILLBOARDMODE_Y;
      m.setEnabled(false);
      this.pool.push({ mesh: m, age: LIFE + 1, x: 0, y: 0, z: 0, dx: 0, dz: 0 });
    }

    // Крит с лука — маленькая насыщенно-красная вспышка на мобе.
    const critProto = MeshBuilder.CreateSphere("critFlash", { diameter: 1, segments: 10 }, scene);
    critProto.setEnabled(false);
    for (let i = 0; i < CRIT_POOL; i++) {
      const m = i === 0 ? critProto : critProto.clone(`critFlash${i}`);
      const mat = new StandardMaterial(`critFlashMat${i}`, scene);
      mat.emissiveColor = new Color3(1, 0.03, 0.02); // насыщенный глубокий красный
      mat.diffuseColor = new Color3(0, 0, 0);
      mat.specularColor = new Color3(0, 0, 0);
      mat.disableLighting = true;
      mat.disableDepthWrite = true;
      mat.alphaMode = Constants.ALPHA_COMBINE; // сплошной красный, не выбеливается
      m.material = mat;
      m.isPickable = false;
      m.renderingGroupId = 1;
      m.setEnabled(false);
      this.critPool.push({ mesh: m, age: CRIT_LIFE + 1, x: 0, y: 0, z: 0 });
    }
  }

  /** Красная вспышка критического попадания — на мобе, быстро гаснет. */
  critMark(x: number, y: number, z: number): void {
    const c = this.critPool[this.critNext];
    this.critNext = (this.critNext + 1) % this.critPool.length;
    c.x = x;
    c.y = y;
    c.z = z;
    c.age = 0;
    c.mesh.position.set(x, y, z);
    c.mesh.setEnabled(true);
  }

  /**
   * Выпустить волну крестиков вокруг точки.
   * @param count сколько штук
   * @param color цвет (CROSS_GREEN / CROSS_ORANGE)
   */
  burst(x: number, y: number, z: number, count: number, color: Color3): void {
    for (let i = 0; i < count; i++) {
      const c = this.pool[this.next];
      this.next = (this.next + 1) % this.pool.length;
      const a = Math.random() * Math.PI * 2;
      const r = SPREAD * (0.35 + Math.random() * 0.65);
      c.x = x + Math.cos(a) * r;
      c.z = z + Math.sin(a) * r;
      c.y = y + Math.random() * 0.3;
      c.dx = Math.cos(a) * 0.18;
      c.dz = Math.sin(a) * 0.18;
      c.age = -i * 0.07; // волной, а не пачкой
      (c.mesh.material as StandardMaterial).emissiveColor.copyFrom(color);
      c.mesh.setEnabled(true);
    }
  }

  update(dt: number): void {
    for (const c of this.critPool) {
      if (c.age > CRIT_LIFE) continue;
      c.age += dt;
      if (c.age > CRIT_LIFE) {
        c.mesh.setEnabled(false);
        continue;
      }
      const t = c.age / CRIT_LIFE;
      // Резко вспыхивает и быстро гаснет — небольшой размер.
      c.mesh.scaling.setAll(0.3 + t * 0.7);
      (c.mesh.material as StandardMaterial).alpha = (1 - t) * (1 - t);
    }
    for (const c of this.pool) {
      if (c.age > LIFE) continue;
      c.age += dt;
      if (c.age < 0) {
        c.mesh.setEnabled(false);
        continue;
      }
      if (c.age > LIFE) {
        c.mesh.setEnabled(false);
        continue;
      }
      const t = c.age / LIFE;
      c.mesh.setEnabled(true);
      c.mesh.position.set(c.x + c.dx * t, c.y + RISE * t, c.z + c.dz * t);
      // Всплывает и тает; в самом начале ещё и «выпрыгивает» размером.
      const pop = Math.min(1, c.age / 0.12);
      c.mesh.scaling.setAll(pop * (1 - t * 0.25));
      (c.mesh.material as StandardMaterial).alpha = Math.min(1, (1 - t) * 2.2) * 0.95;
    }
  }

  dispose(): void {
    for (const c of this.pool) {
      c.mesh.material?.dispose();
      c.mesh.dispose();
    }
    for (const c of this.critPool) {
      c.mesh.material?.dispose();
      c.mesh.dispose();
    }
    void this.scene;
  }
}
