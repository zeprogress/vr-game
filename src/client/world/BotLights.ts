import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Constants } from "@babylonjs/core/Engines/constants";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

import { PLAYER } from "#shared/constants";
import { radialGlow } from "./Fireflies";

/** Докуда добивает свет бота, м. */
const RANGE = 15;
const INTENSITY = 5.2;
/** Радиус светлого пятна на земле, м. */
const POOL_RADIUS = 4.5;
/** Яркость пятна в глубокую ночь (аддитивно поверх земли). */
const POOL_ALPHA = 0.32;

/**
 * Ночью бот светит вокруг себя тёплым светом — как факел. Один источник на
 * весь мир: каждый кадр он прыгает к ближайшему к камере/игроку боту.
 *
 * Как у светлячков, видимую «лужицу» на земле даёт не сам PointLight (его
 * вклад в затенение мягкий и на траве почти не читается), а лежащий на земле
 * аддитивный спрайт с радиальным пятном. PointLight добавляет настоящее
 * затенение по нормалям поверх.
 *
 * Днём гаснет (setEnabled только на границе суток, как у SpellLights и
 * светлячков), учтён в LIGHT_BUDGET.
 */
export class BotLights {
  private readonly light: PointLight;
  private readonly pool: Mesh;
  private readonly poolMat: StandardMaterial;
  private night = 0;
  private enabled = false;

  constructor(scene: Scene) {
    this.light = new PointLight("botTorch", new Vector3(0, -100, 0), scene);
    this.light.range = RANGE;
    this.light.intensity = 0;
    this.light.diffuse = new Color3(1, 0.86, 0.62);
    this.light.specular = new Color3(0.12, 0.1, 0.06);
    this.light.setEnabled(false);

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

    this.pool = MeshBuilder.CreatePlane("botTorchPool", { size: POOL_RADIUS * 2 }, scene);
    this.pool.material = this.poolMat;
    this.pool.rotation.x = Math.PI / 2; // кладём плашмя на землю
    this.pool.isPickable = false;
    this.pool.renderingGroupId = 0;
    this.pool.position.set(0, -100, 0);
    this.pool.setEnabled(false);
  }

  /**
   * @param daylight 0..1 (1 — день)
   * @param ref      откуда мерить «ближайшего» (камера спектатора / голова игрока)
   * @param bots     мировые позиции ботов (голова, т.е. земля + PLAYER.eyeHeight)
   */
  update(dt: number, daylight: number, ref: Vector3, bots: readonly Vector3[]): void {
    const want = Math.max(0, Math.min(1, 1 - daylight * 1.6));
    this.night += (want - this.night) * Math.min(1, dt * 0.8);

    const on = this.night > 0.02 && bots.length > 0;
    if (on !== this.enabled) {
      this.enabled = on;
      this.light.setEnabled(on);
      this.pool.setEnabled(on);
    }
    if (!this.enabled) return;

    let best: Vector3 | null = null;
    let bd = Infinity;
    for (const b of bots) {
      const d = Vector3.DistanceSquared(b, ref);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    if (!best) {
      this.light.intensity = 0;
      this.poolMat.alpha = 0;
      return;
    }

    this.light.position.set(best.x, best.y + 0.9, best.z);
    this.light.intensity = this.night * INTENSITY;

    // Земля под ботом: корпус стоит на terrainHeight + eyeHeight.
    this.pool.position.set(best.x, best.y - PLAYER.eyeHeight + 0.12, best.z);
    this.poolMat.alpha = this.night * POOL_ALPHA;
  }

  dispose(): void {
    this.light.dispose();
    this.pool.dispose();
    this.poolMat.dispose();
  }
}
