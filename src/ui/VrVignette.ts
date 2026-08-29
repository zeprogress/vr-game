import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

/** Красная виньетка по краям обзора при уроне (для VR). */
export class VrVignette {
  private readonly plane: Mesh;
  private readonly mat: StandardMaterial;
  private amt = 0;

  constructor(scene: Scene, camera: Node) {
    const s = 256;
    const tex = new DynamicTexture("vignetteTex", { width: s, height: s }, scene, false);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.28, s / 2, s / 2, s * 0.72);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.6, "rgba(255,255,255,0)");
    g.addColorStop(1, "rgba(255,255,255,1)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    tex.update(false);
    tex.hasAlpha = true;

    this.mat = new StandardMaterial("vignetteMat", scene);
    this.mat.diffuseTexture = tex;
    this.mat.useAlphaFromDiffuseTexture = true;
    this.mat.emissiveColor = new Color3(0.9, 0.05, 0.05);
    this.mat.disableLighting = true;
    this.mat.specularColor = new Color3(0, 0, 0);
    this.mat.backFaceCulling = false;
    this.mat.alpha = 0;

    this.plane = MeshBuilder.CreatePlane("vignette", { width: 1.7, height: 1.5 }, scene);
    this.plane.material = this.mat;
    this.plane.parent = camera;
    this.plane.position.set(0, 0, 0.5);
    this.plane.isPickable = false;
    this.plane.renderingGroupId = 2;
    this.plane.setEnabled(false);
  }

  flash(damage: number): void {
    this.amt = Math.max(this.amt, Math.min(0.85, 0.3 + damage / 60));
  }

  tick(dt: number): void {
    if (this.amt <= 0) return;
    this.amt = Math.max(0, this.amt - dt * 1.7);
    this.mat.alpha = this.amt;
    this.plane.setEnabled(this.amt > 0.01);
  }

  dispose(): void {
    this.plane.dispose();
  }
}
