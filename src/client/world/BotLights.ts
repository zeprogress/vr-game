import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Light } from "@babylonjs/core/Lights/light";
import { BOT_TORCHES } from "./Fireflies";

/** Докуда добивает свет бота, м. */
const RANGE = 18;
/**
 * Яркость источника. Подбор вживую: `?botlight=6`. Если и на большом значении
 * окружение не светлеет — значит источник вообще не попадает в шейдер земли
 * (упёрлись в maxSimultaneousLights), и лечить надо бюджет, а не яркость.
 */
const INTENSITY = (() => {
  const v = Number(new URLSearchParams(location.search).get("botlight"));
  return Number.isFinite(v) && v >= 0 && v <= 40 ? v : 1.5;
})();

/**
 * Ночная подсветка от ботов зрителей (Ф10) — настоящий свет, без спрайтов.
 *
 * Аддитивный ореол (как у светлячков) отсюда убран: он рисуется ПОВЕРХ того,
 * что за ним, поэтому «подсвечивал» вертикальное — стволы и траву, — почти
 * не задевал землю и не мог осветить самого бота (тот непрозрачный и рисуется
 * раньше). Выглядело это белым пятном, а не освещением.
 *
 * PointLight'ов раздаём BOT_TORCHES штук, ближайшим к камере: каждый лишний
 * источник попадает в шейдер земли, травы и деревьев. Днём гаснут.
 */
export class BotLights {
  private readonly lights: PointLight[] = [];
  private night = 0;
  private enabled = false;
  private readonly _order: number[] = [];

  constructor(scene: Scene) {
    for (let i = 0; i < BOT_TORCHES; i++) {
      const l = new PointLight(`botTorch${i}`, new Vector3(0, -100, 0), scene);
      l.range = RANGE;
      // Явно линейное затухание по range: у StandardMaterial поведение
      // FALLOFF_DEFAULT зависит от дефайнов материала, и подбирать яркость
      // вслепую под него — гадание.
      l.falloffType = Light.FALLOFF_STANDARD;
      l.intensity = 0;
      l.diffuse = new Color3(1, 0.86, 0.62);
      l.specular = new Color3(0.12, 0.1, 0.06);
      l.setEnabled(false);
      this.lights.push(l);
    }

  }

  /**
   * @param daylight 0..1 (1 — день)
   * @param ref      откуда мерить «ближайших» (камера спектатора / голова игрока)
   * @param bots     мировые позиции корпусов ботов
   */
  update(dt: number, daylight: number, ref: Vector3, bots: readonly Vector3[]): void {
    const want = Math.max(0, Math.min(1, 1 - daylight * 1.6));
    this.night += (want - this.night) * Math.min(1, dt * 0.8);

    const on = this.night > 0.02 && bots.length > 0;
    if (on !== this.enabled) {
      this.enabled = on;
      for (const l of this.lights) l.setEnabled(on);
    }
    if (!this.enabled) return;


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
      l.position.set(b.x, b.y + 0.6, b.z);
      l.intensity = this.night * INTENSITY;
    }
  }

  dispose(): void {
    for (const l of this.lights) l.dispose();
  }
}
