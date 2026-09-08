import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/boxBuilder";

import { CROSS_GREEN, CROSS_ORANGE, CROSS_RED } from "./HealCrossFx";

export { CROSS_GREEN, CROSS_ORANGE, CROSS_RED };

/** Сколько крестиков живёт одновременно на всю сцену. */
const POOL = 48;
const LIFE = 1.5; // с полёта
const RISE = 1.6; // м вверх за жизнь
const SPREAD = 0.9; // м разлёта по горизонтали

/** Красный «X» критического удара — держится на мобе и тает. */
const CRIT_POOL = 14;
const CRIT_LIFE = 0.6; // с

interface CritX {
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
  private readonly critPool: CritX[] = [];
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

    // Крит с лука — ОДИН красный крест, повёрнутый на 45° («X»), прямо на мобе.
    const xa = MeshBuilder.CreateBox("critXa", { width: 0.62, height: 0.11, depth: 0.05 }, scene);
    xa.rotation.z = Math.PI / 4;
    const xb = MeshBuilder.CreateBox("critXb", { width: 0.62, height: 0.11, depth: 0.05 }, scene);
    xb.rotation.z = -Math.PI / 4;
    const xMerged = Mesh.MergeMeshes([xa, xb], true, true);
    const xProto = xMerged ?? xa;
    if (!xMerged) xb.dispose();
    xProto.name = "critXProto";
    for (let i = 0; i < CRIT_POOL; i++) {
      const m = i === 0 ? xProto : xProto.clone(`critX${i}`);
      const mat = new StandardMaterial(`critXMat${i}`, scene);
      mat.emissiveColor = CROSS_RED.clone();
      mat.diffuseColor = new Color3(0, 0, 0);
      mat.specularColor = new Color3(0, 0, 0);
      mat.disableLighting = true;
      mat.disableDepthWrite = true;
      m.material = mat;
      m.isPickable = false;
      m.renderingGroupId = 1;
      m.billboardMode = Mesh.BILLBOARDMODE_ALL;
      m.setEnabled(false);
      this.critPool.push({ mesh: m, age: CRIT_LIFE + 1, x: 0, y: 0, z: 0 });
    }
  }

  /** Красный «X» критического попадания — держится на мобе ~0.6 с и тает. */
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
      // Выпрыгивает крупнее, затем оседает; всплывает чуть-чуть.
      const pop = t < 0.18 ? t / 0.18 : 1;
      const settle = 1.35 - 0.35 * Math.min(1, (t - 0.18) / 0.3);
      c.mesh.scaling.setAll(pop * settle);
      c.mesh.position.set(c.x, c.y + t * 0.25, c.z);
      (c.mesh.material as StandardMaterial).alpha = Math.min(1, (1 - t) * 2.5);
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
    for (const c of [...this.pool, ...this.critPool]) {
      c.mesh.material?.dispose();
      c.mesh.dispose();
    }
    void this.scene;
  }
}
