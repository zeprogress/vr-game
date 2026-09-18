import type { Scene } from "@babylonjs/core/scene";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Constants } from "@babylonjs/core/Engines/constants";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";

/**
 * Синяя аура благословения (бафф победы над событием): полупрозрачная
 * пульсирующая сфера вокруг героя. Общая для локального и удалённых аватаров.
 */
export class BuffAura {
  private readonly shell: Mesh;
  private readonly mat: StandardMaterial;
  private t = 0;
  private on = false;

  constructor(scene: Scene, parent: TransformNode, radius = 0.85, y = 0.95) {
    // Сегментов вдвое больше прежнего (12→24) — на низкополигональной сфере
    // были видны грани-«огранка», просили сгладить силуэт.
    this.shell = MeshBuilder.CreateSphere("buffAura", { diameter: radius * 2, segments: 24 }, scene);
    this.mat = new StandardMaterial("buffAuraMat", scene);
    this.mat.emissiveColor = new Color3(0.25, 0.55, 1);
    this.mat.diffuseColor = new Color3(0, 0, 0);
    this.mat.specularColor = new Color3(0, 0, 0);
    this.mat.disableLighting = true;
    this.mat.alphaMode = Constants.ALPHA_ADD;
    // Было 0.14 — вдвое прозрачнее по просьбе.
    this.mat.alpha = 0.07;
    this.mat.backFaceCulling = false;
    this.shell.material = this.mat;
    this.shell.isPickable = false;
    this.shell.parent = parent;
    this.shell.position.y = y;
    this.shell.setEnabled(false);
  }

  setActive(active: boolean): void {
    if (active === this.on) return;
    this.on = active;
    this.shell.setEnabled(active);
  }

  update(dt: number): void {
    if (!this.on) return;
    this.t += dt;
    const pulse = 0.85 + Math.sin(this.t * 3.2) * 0.15;
    this.shell.scaling.setAll(pulse);
    // Было 0.1 + pulse*0.1 — вдвое прозрачнее по просьбе.
    this.mat.alpha = 0.05 + pulse * 0.05;
  }

  dispose(): void {
    this.mat.dispose();
    this.shell.dispose();
  }
}
