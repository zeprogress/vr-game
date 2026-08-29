import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

/**
 * Красная виньетка по краям обзора при уроне (для VR). Сделана из рамки
 * плоскостей — надёжнее, чем текстурный градиент (DynamicTexture с плавной
 * альфой в этой сборке не отображается).
 */
export class VrVignette {
  private readonly quads: Mesh[] = [];
  private readonly mat: StandardMaterial;
  private amt = 0;

  constructor(scene: Scene, camera: Node) {
    this.mat = new StandardMaterial("vignetteMat", scene);
    this.mat.diffuseColor = new Color3(0, 0, 0);
    this.mat.emissiveColor = new Color3(0.9, 0.02, 0.02);
    this.mat.disableLighting = true;
    this.mat.specularColor = new Color3(0, 0, 0);
    this.mat.backFaceCulling = false;
    this.mat.alpha = 0;

    const Z = 0.42; // плоскости на этом расстоянии перед камерой
    // [ширина, высота, x, y] — рамка по краям поля зрения VR (~100° FOV)
    const frame: [number, number, number, number][] = [
      [1.5, 0.55, 0, 0.46], // верх
      [1.5, 0.55, 0, -0.46], // низ
      [0.55, 1.7, -0.55, 0], // лево
      [0.55, 1.7, 0.55, 0], // право
      // тонкий внутренний слой (мягче переход)
      [1.5, 0.18, 0, 0.24],
      [1.5, 0.18, 0, -0.24],
      [0.18, 1.7, -0.34, 0],
      [0.18, 1.7, 0.34, 0],
    ];
    for (let i = 0; i < frame.length; i++) {
      const [w, h, x, y] = frame[i];
      const q = MeshBuilder.CreatePlane(`vignette${i}`, { width: w, height: h }, scene);
      q.material = this.mat;
      q.parent = camera;
      q.position.set(x, y, Z);
      q.isPickable = false;
      q.applyFog = false;
      q.renderingGroupId = 1;
      q.setEnabled(false);
      this.quads.push(q);
    }
  }

  flash(damage: number): void {
    this.amt = Math.min(0.9, Math.max(this.amt, 0.4 + damage / 55));
    this.apply();
  }

  tick(dt: number): void {
    if (this.amt <= 0) return;
    this.amt = Math.max(0, this.amt - dt * 1.4);
    this.apply();
  }

  private apply(): void {
    this.mat.alpha = this.amt;
    const on = this.amt > 0.01;
    for (const q of this.quads) q.setEnabled(on);
  }

  dispose(): void {
    for (const q of this.quads) q.dispose();
    this.mat.dispose();
  }
}
