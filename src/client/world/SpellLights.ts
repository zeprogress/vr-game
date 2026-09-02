import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { PointLight } from "@babylonjs/core/Lights/pointLight";

/**
 * Ночная подсветка от магии: кристалл посоха светит своим цветом, а
 * заряд / снаряд / взрыв огнешара — оранжевым. Два источника, включаются
 * ночью и гаснут днём (setEnabled только на границе суток, как у светлячков);
 * на каждый каст меняется лишь интенсивность — без пересборки шейдеров.
 * Оба учтены в LIGHT_BUDGET.
 */
export class SpellLights {
  private readonly crystal: PointLight;
  private readonly fire: PointLight;
  private night = 0;
  private enabled = false;

  constructor(scene: Scene) {
    this.crystal = new PointLight("spellCrystal", Vector3.Zero(), scene);
    this.crystal.range = 9;
    this.crystal.intensity = 0;
    this.crystal.diffuse = new Color3(0.78, 0.8, 0.9);
    this.crystal.specular = new Color3(0.12, 0.12, 0.14);
    this.crystal.setEnabled(false);

    this.fire = new PointLight("spellFire", Vector3.Zero(), scene);
    this.fire.range = 13;
    this.fire.intensity = 0;
    this.fire.diffuse = new Color3(1, 0.55, 0.2);
    this.fire.specular = new Color3(0.2, 0.1, 0.03);
    this.fire.setEnabled(false);
  }

  /** daylight 0..1 из DayState. Ночь разгорается плавно. */
  setDaylight(dt: number, daylight: number): void {
    const want = Math.max(0, Math.min(1, 1 - daylight * 1.6));
    this.night += (want - this.night) * Math.min(1, dt * 0.8);
    const on = this.night > 0.02;
    if (on !== this.enabled) {
      this.enabled = on;
      this.crystal.setEnabled(on);
      this.fire.setEnabled(on);
    }
  }

  /** Кристалл посоха: мировая позиция (null — посоха в руках нет), цвет, заряд 0..1. */
  setCrystal(pos: Vector3 | null, color: Color3, charge: number): void {
    if (!this.enabled) return;
    if (pos) {
      this.crystal.position.copyFrom(pos);
      this.crystal.diffuse.copyFrom(color);
      this.crystal.intensity = this.night * (0.55 + charge * 1.7);
    } else {
      this.crystal.intensity = 0;
    }
  }

  /** Огненный свет: позиция снаряда / взрыва (null — ничего нет), сила 0..~6. */
  setFire(pos: Vector3 | null, power: number): void {
    if (!this.enabled) return;
    if (pos && power > 0.01) {
      this.fire.position.copyFrom(pos);
      this.fire.intensity = this.night * power;
    } else {
      this.fire.intensity = 0;
    }
  }

  dispose(): void {
    this.crystal.dispose();
    this.fire.dispose();
  }
}
