import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
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

/** «MISS» — уворот от атаки. Всплывает НАД ИСТОЧНИКОМ удара (мобом). */
const MISS_POOL = 6;
const MISS_LIFE = 0.7; // с всплытия/угасания
const MISS_RISE = 0.8; // м

interface CritBurst {
  mesh: Mesh;
  age: number;
  x: number;
  y: number;
  z: number;
}

interface MissText {
  mesh: Mesh;
  age: number; // < 0 — задержка перед показом (ждём конца атаки), см. missText()
  x: number;
  y: number;
  z: number;
  /** Источник удара движется (моб гонится) — держим текст над ним, а не на
   *  застывшей точке атаки; null — источника нет/уже нет, точка неподвижна. */
  follow: (() => { x: number; y: number; z: number } | null) | null;
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
  private readonly missPool: MissText[] = [];
  private missNext = 0;

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

    // «MISS» — один общий текстовый материал (не клонируем — дорого пересобирать
    // шейдеры в горячем пути), пул планок отличается только позицией/видимостью.
    const missTex = new DynamicTexture("missTex", { width: 256, height: 96 }, scene, false);
    missTex.hasAlpha = true;
    const ctx = missTex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 256, 96);
    ctx.font = "700 56px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(235,235,235,0.95)";
    ctx.fillText("MISS", 128, 52);
    missTex.update();
    const missMat = new StandardMaterial("missMat", scene);
    missMat.diffuseTexture = missTex;
    missMat.emissiveTexture = missTex;
    missMat.opacityTexture = missTex;
    missMat.useAlphaFromDiffuseTexture = true;
    missMat.disableLighting = true;
    missMat.specularColor = new Color3(0, 0, 0);
    missMat.backFaceCulling = false;
    missMat.disableDepthWrite = true;
    const missProto = MeshBuilder.CreatePlane("missText", { width: 1.1, height: (1.1 * 96) / 256 }, scene);
    missProto.setEnabled(false);
    for (let i = 0; i < MISS_POOL; i++) {
      const m = i === 0 ? missProto : missProto.clone(`missText${i}`);
      m.material = missMat; // ОБЩИЙ материал на все планки — без клонов текстуры
      m.isPickable = false;
      m.renderingGroupId = 1;
      m.billboardMode = Mesh.BILLBOARDMODE_Y;
      m.setEnabled(false);
      this.missPool.push({ mesh: m, age: MISS_LIFE + 1, x: 0, y: 0, z: 0, follow: null });
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
   * Уворот от атаки: «MISS» над источником удара. `delay` — сколько подождать
   * перед показом (чтобы текст всплыл ПОСЛЕ того, как замах/выстрел визуально
   * долетел, а не в момент броска кубика на сервере).
   */
  missText(
    x: number,
    y: number,
    z: number,
    delay = 0,
    /** Опрашивается каждый кадр, пока текст живёт — источник (моб) мог
     *  убежать вперёд за время задержки/показа. null — источник исчез,
     *  дальше держим последнюю известную точку неподвижно. */
    follow: (() => { x: number; y: number; z: number } | null) | null = null,
  ): void {
    const t = this.missPool[this.missNext];
    this.missNext = (this.missNext + 1) % this.missPool.length;
    t.x = x;
    t.y = y;
    t.z = z;
    t.follow = follow;
    t.age = -delay;
    t.mesh.setEnabled(false); // включится в update(), когда age дойдёт до 0
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
    for (const t of this.missPool) {
      if (t.age > MISS_LIFE) continue;
      t.age += dt;
      // Источник (моб) мог убежать вперёд — досаживаем точку на его текущее
      // место и во время задержки, и всё время показа (не только в момент
      // появления), иначе текст «отстаёт» и повисает между целью и игроком.
      if (t.follow) {
        const p = t.follow();
        if (p) {
          t.x = p.x;
          t.y = p.y;
          t.z = p.z;
        } else {
          t.follow = null; // источник исчез — дальше точка неподвижна
        }
      }
      if (t.age < 0) continue; // ещё ждём (задержка до конца атаки)
      if (t.age > MISS_LIFE) {
        t.mesh.setEnabled(false);
        continue;
      }
      const k = t.age / MISS_LIFE;
      t.mesh.setEnabled(true);
      t.mesh.position.set(t.x, t.y + MISS_RISE * k, t.z);
      const pop = Math.min(1, t.age / 0.1);
      t.mesh.scaling.setAll(pop * (1 - k * 0.15));
      t.mesh.visibility = Math.min(1, (1 - k) * 2.2);
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
    this.missPool[0]?.mesh.material?.dispose(); // общий на весь пул
    for (const t of this.missPool) t.mesh.dispose();
    void this.scene;
  }
}
