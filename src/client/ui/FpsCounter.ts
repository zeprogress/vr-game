import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

/**
 * Голый счётчик кадров в секунду — только число, без фона и подписей. Включается `?fps=1`.
 * Плоский режим — надпись над полоской здоровья; VR — крохотная плашка над ней (`attachVr`).
 * Считает кадры сам и обновляется два раза в секунду.
 */
export class FpsCounter {
  private readonly el: HTMLDivElement;
  private acc = 0;
  private frames = 0;
  private shown = -1;
  private tex: DynamicTexture | null = null;
  private plane: Mesh | null = null;

  constructor() {
    this.el = document.createElement("div");
    this.el.style.cssText =
      "position:fixed;left:16px;top:1px;z-index:36;pointer-events:none;" +
      "font:bold 13px system-ui,sans-serif;color:#7ee081;text-shadow:0 1px 3px rgba(0,0,0,0.9);";
    document.body.appendChild(this.el);
  }

  /** VR: число над полоской здоровья (`pos` — её положение в якоре HUD, плашка приподнята). */
  attachVr(scene: Scene, anchor: Node, pos: Vector3): void {
    if (this.plane) return;
    const tex = new DynamicTexture("fpsTex", { width: 128, height: 64 }, scene, false);
    tex.hasAlpha = true;
    const mat = new StandardMaterial("fpsMat", scene);
    mat.diffuseTexture = tex;
    mat.emissiveTexture = tex;
    mat.opacityTexture = tex;
    mat.disableLighting = true;
    mat.specularColor = new Color3(0, 0, 0);
    mat.backFaceCulling = false;
    const plane = MeshBuilder.CreatePlane("fpsPlate", { width: 0.1, height: 0.05 }, scene);
    plane.material = mat;
    plane.parent = anchor;
    plane.position.set(pos.x, pos.y + 0.045, pos.z);
    plane.isPickable = false;
    this.plane = plane;
    this.tex = tex;
    this.shown = -1;
  }

  update(dt: number): void {
    this.acc += dt;
    this.frames++;
    if (this.acc < 0.5) return;
    const fps = Math.round(this.frames / this.acc);
    this.acc = 0;
    this.frames = 0;
    if (fps === this.shown) return;
    this.shown = fps;
    this.el.textContent = String(fps);
    if (this.tex) {
      const ctx = this.tex.getContext() as unknown as CanvasRenderingContext2D;
      ctx.clearRect(0, 0, 128, 64);
      ctx.font = "bold 46px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = fps >= 60 ? "#7ee081" : fps >= 40 ? "#ffd166" : "#ff7a7a";
      ctx.fillText(String(fps), 64, 34);
      this.tex.update(true);
    }
  }

  dispose(): void {
    this.el.remove();
    this.plane?.dispose();
    this.tex?.dispose();
  }
}
