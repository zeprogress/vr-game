import type { Scene } from "@babylonjs/core/scene";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { TransformNode as TransformNodeCtor } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import "@babylonjs/core/Meshes/Builders/boxBuilder";

/**
 * «Звёздочки» оглушения над головой героя — три жёлтых кубика, вращающихся
 * по кругу, пока герой оглушён (напр. волной "Чародея руин"). Тот же приём,
 * что уже рисует оглушение мобов (см. Mob.ts, MobState.stunned), только для
 * игрока/бота — общий класс для локального и удалённых аватаров.
 */
export class StunStarsFx {
  private readonly spin: TransformNode;
  private readonly mat: StandardMaterial;
  private on = false;

  constructor(scene: Scene, parent: TransformNode, y = 0.5) {
    this.spin = new TransformNodeCtor("stunStars", scene);
    this.spin.parent = parent;
    this.spin.position.y = y;
    this.spin.setEnabled(false);

    this.mat = new StandardMaterial("stunStarsMat", scene);
    this.mat.emissiveColor = new Color3(1, 0.92, 0.4);
    this.mat.diffuseColor = new Color3(0, 0, 0);
    this.mat.specularColor = new Color3(0, 0, 0);
    this.mat.disableLighting = true;

    for (let i = 0; i < 3; i++) {
      const star = MeshBuilder.CreateBox(`stunStar${i}`, { size: 0.13 }, scene);
      star.material = this.mat;
      star.isPickable = false;
      star.parent = this.spin;
      const a = (i / 3) * Math.PI * 2;
      star.position.set(Math.cos(a) * 0.32, Math.sin(a * 2) * 0.05, Math.sin(a) * 0.32);
      star.rotation.set(0.6, a, 0.4);
    }
  }

  setActive(active: boolean): void {
    if (active === this.on) return;
    this.on = active;
    this.spin.setEnabled(active);
  }

  update(dt: number): void {
    if (!this.on) return;
    this.spin.rotation.y += dt * 6;
    this.mat.alpha = 0.75 + Math.sin(this.spin.rotation.y * 3) * 0.2;
  }

  dispose(): void {
    this.mat.dispose();
    this.spin.dispose();
  }
}
