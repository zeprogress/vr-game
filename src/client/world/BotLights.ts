import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { PointLight } from "@babylonjs/core/Lights/pointLight";

/**
 * Ночью бот светит вокруг себя тёплым светом — как факел. Один источник на
 * весь мир: каждый кадр он прыгает к ближайшему к камере/игроку боту. Днём
 * гаснет (setEnabled только на границе суток, как у SpellLights/светлячков),
 * учтён в LIGHT_BUDGET.
 */
export class BotLights {
  private readonly light: PointLight;
  private night = 0;
  private enabled = false;
  private readonly _p = new Vector3();

  constructor(scene: Scene) {
    this.light = new PointLight("botTorch", new Vector3(0, -100, 0), scene);
    this.light.range = 11;
    this.light.intensity = 0;
    this.light.diffuse = new Color3(1, 0.86, 0.62);
    this.light.specular = new Color3(0.12, 0.1, 0.06);
    this.light.setEnabled(false);
  }

  /**
   * @param daylight 0..1 (1 — день)
   * @param ref      откуда мерить «ближайшего» (камера спектатора / голова игрока)
   * @param bots     мировые позиции ботов (корпус); пусто — гасим
   */
  update(dt: number, daylight: number, ref: Vector3, bots: readonly Vector3[]): void {
    const want = Math.max(0, Math.min(1, 1 - daylight * 1.6));
    this.night += (want - this.night) * Math.min(1, dt * 0.8);

    const on = this.night > 0.02 && bots.length > 0;
    if (on !== this.enabled) {
      this.enabled = on;
      this.light.setEnabled(on);
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
      return;
    }
    this._p.copyFrom(best);
    this._p.y += 1.1;
    this.light.position.copyFrom(this._p);
    this.light.intensity = this.night * 1.7;
  }

  dispose(): void {
    this.light.dispose();
  }
}
