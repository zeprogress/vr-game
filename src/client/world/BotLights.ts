import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Constants } from "@babylonjs/core/Engines/constants";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

import { PLAYER } from "#shared/constants";
import { radialGlow, BOT_TORCHES } from "./Fireflies";

/** Докуда добивает свет бота, м. */
const RANGE = 22;
const INTENSITY = 4.6;
/** Радиус светлого пятна на земле, м. */
const POOL_RADIUS = 8;
/** Яркость пятна в глубокую ночь. Аддитивно и складывается у соседних ботов,
 *  поэтому скромнее, чем у одиночного источника. */
const POOL_ALPHA = 0.22;

/**
 * Ночная подсветка от ботов зрителей (Ф10).
 *
 * Видимую «лужицу» на земле даёт не PointLight (его вклад в затенение мягкий
 * и на траве почти не читается), а лежащий на земле аддитивный спрайт с
 * радиальным пятном — он есть у КАЖДОГО бота и стоит почти ничего.
 * Настоящих PointLight'ов раздаём только BOT_TORCHES штук — ближайшим к
 * камере: они дороги (каждый попадает в шейдер земли, травы и деревьев).
 *
 * Днём всё гаснет; setEnabled дёргаем только на границе суток — как у
 * SpellLights и светлячков, чтобы не пересобирать шейдеры каждый кадр.
 */
export class BotLights {
  private readonly lights: PointLight[] = [];
  private readonly poolProto: Mesh;
  private readonly poolMat: StandardMaterial;
  private readonly pools: InstancedMesh[] = [];
  private night = 0;
  private enabled = false;
  private shown = 0; // сколько пятен сейчас включено
  private readonly _order: number[] = [];

  constructor(scene: Scene) {
    for (let i = 0; i < BOT_TORCHES; i++) {
      const l = new PointLight(`botTorch${i}`, new Vector3(0, -100, 0), scene);
      l.range = RANGE;
      l.intensity = 0;
      l.diffuse = new Color3(1, 0.86, 0.62);
      l.specular = new Color3(0.12, 0.1, 0.06);
      l.setEnabled(false);
      this.lights.push(l);
    }

    this.poolMat = new StandardMaterial("botTorchPoolMat", scene);
    const glow = radialGlow(scene);
    this.poolMat.emissiveTexture = glow;
    this.poolMat.opacityTexture = glow;
    this.poolMat.diffuseColor = new Color3(0, 0, 0);
    this.poolMat.specularColor = new Color3(0, 0, 0);
    this.poolMat.emissiveColor = new Color3(1, 0.8, 0.5);
    this.poolMat.disableLighting = true;
    this.poolMat.alphaMode = Constants.ALPHA_ADD;
    this.poolMat.disableDepthWrite = true;
    this.poolMat.backFaceCulling = false;
    this.poolMat.alpha = 0;

    this.poolProto = MeshBuilder.CreatePlane("botTorchPool", { size: POOL_RADIUS * 2 }, scene);
    this.poolProto.material = this.poolMat;
    this.poolProto.rotation.x = Math.PI / 2; // плашмя на землю
    this.poolProto.isPickable = false;
    this.poolProto.renderingGroupId = 0;
    this.poolProto.isVisible = false; // рисуем только инстансы
  }

  /**
   * @param daylight 0..1 (1 — день)
   * @param ref      откуда мерить «ближайших» (камера спектатора / голова игрока)
   * @param bots     мировые позиции ботов (корпус = земля + PLAYER.eyeHeight)
   */
  update(dt: number, daylight: number, ref: Vector3, bots: readonly Vector3[]): void {
    const want = Math.max(0, Math.min(1, 1 - daylight * 1.6));
    this.night += (want - this.night) * Math.min(1, dt * 0.8);

    const on = this.night > 0.02 && bots.length > 0;
    if (on !== this.enabled) {
      this.enabled = on;
      for (const l of this.lights) l.setEnabled(on);
      if (!on) {
        for (const p of this.pools) p.setEnabled(false);
        this.shown = 0;
      }
    }
    if (!this.enabled) return;

    // Пятно на земле — каждому боту.
    this.poolMat.alpha = this.night * POOL_ALPHA;
    for (let i = 0; i < bots.length; i++) {
      let pool = this.pools[i];
      if (!pool) {
        pool = this.poolProto.createInstance(`botTorchPool${i}`);
        // Инстанс НЕ наследует трансформ прототипа — кладём плашмя сами.
        pool.rotation.x = Math.PI / 2;
        pool.isPickable = false;
        this.pools.push(pool);
      }
      const b = bots[i];
      // Корпус стоит на terrainHeight + eyeHeight — отсюда и земля под ним.
      pool.position.set(b.x, b.y - PLAYER.eyeHeight + 0.12, b.z);
      if (i >= this.shown) pool.setEnabled(true);
    }
    for (let i = bots.length; i < this.shown; i++) this.pools[i].setEnabled(false);
    this.shown = bots.length;

    // Настоящие источники — ближайшим к камере.
    this._order.length = 0;
    for (let i = 0; i < bots.length; i++) this._order.push(i);
    if (bots.length > this.lights.length) {
      this._order.sort(
        (a, b) => Vector3.DistanceSquared(bots[a], ref) - Vector3.DistanceSquared(bots[b], ref),
      );
    }
    for (let i = 0; i < this.lights.length; i++) {
      const bi = this._order[i];
      const l = this.lights[i];
      if (bi === undefined) {
        l.intensity = 0;
        continue;
      }
      const b = bots[bi];
      l.position.set(b.x, b.y + 0.9, b.z);
      l.intensity = this.night * INTENSITY;
    }
  }

  dispose(): void {
    for (const l of this.lights) l.dispose();
    for (const p of this.pools) p.dispose();
    this.poolProto.dispose();
    this.poolMat.dispose();
  }
}
