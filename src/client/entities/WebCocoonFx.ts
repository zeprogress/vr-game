import type { Scene } from "@babylonjs/core/scene";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { TransformNode as TransformNodeCtor } from "@babylonjs/core/Meshes/transformNode";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";

/**
 * Кокон из паутины вокруг героя, пока он «в корне» (удар паука): белая сетка-сфера, чуть дрожит.
 * Тот же приём, что у звёздочек оглушения (StunStarsFx), — общий класс для локального и удалённых аватаров.
 */
export class WebCocoonFx {
  private readonly node: TransformNode;
  private readonly mesh: Mesh;
  private readonly mat: StandardMaterial;
  private on = false;
  private t = 0;

  /** y — от корня аватара; корень стоит на высоте глаз, поэтому середина тела — ниже на ~0.8 м. */
  constructor(scene: Scene, parent: TransformNode, y = -0.8) {
    this.node = new TransformNodeCtor("webCocoon", scene);
    this.node.parent = parent;
    this.node.position.y = y;
    this.node.setEnabled(false);

    this.mat = new StandardMaterial("webCocoonMat", scene);
    this.mat.emissiveColor = new Color3(0.92, 0.94, 0.9);
    this.mat.diffuseColor = new Color3(0, 0, 0);
    this.mat.specularColor = new Color3(0, 0, 0);
    this.mat.disableLighting = true;
    this.mat.wireframe = true;
    this.mat.alpha = 0.55;

    this.mesh = MeshBuilder.CreateSphere("webCocoonSphere", { diameter: 1.1, segments: 6 }, scene);
    this.mesh.material = this.mat;
    this.mesh.isPickable = false;
    this.mesh.parent = this.node;
  }

  setActive(active: boolean): void {
    if (active === this.on) return;
    this.on = active;
    this.node.setEnabled(active);
  }

  update(dt: number): void {
    if (!this.on) return;
    this.t += dt;
    this.node.scaling.setAll(1 + Math.sin(this.t * 9) * 0.03);
    this.mat.alpha = 0.45 + Math.sin(this.t * 5) * 0.15;
  }

  dispose(): void {
    this.mesh.dispose();
    this.mat.dispose();
    this.node.dispose();
  }
}
