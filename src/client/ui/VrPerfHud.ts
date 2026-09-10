import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

const TEX_W = 620;
const TEX_H = 210;

/**
 * Отладочная плашка в VR: `?perf=1`. Висит перед лицом снизу, показывает
 * fps / частоту шлема / разрешение буфера глаза / hardwareScaling / число
 * мешей и света. Нужна потому, что chrome://inspect с Quest часто «offline».
 */
export class VrPerfHud {
  private readonly plane: Mesh;
  private readonly tex: DynamicTexture;
  private acc = 0;

  constructor(scene: Scene, parent: Node) {
    this.tex = new DynamicTexture("perfTex", { width: TEX_W, height: TEX_H }, scene, false);
    const mat = new StandardMaterial("perfMat", scene);
    mat.diffuseTexture = this.tex;
    mat.emissiveTexture = this.tex;
    mat.disableLighting = true;
    mat.specularColor = new Color3(0, 0, 0);
    mat.backFaceCulling = false;
    this.tex.hasAlpha = true;

    this.plane = MeshBuilder.CreatePlane(
      "vrPerfHud",
      { width: 0.34, height: 0.34 * (TEX_H / TEX_W) },
      scene,
    );
    this.plane.material = mat;
    this.plane.parent = parent;
    this.plane.position.set(0, -0.22, 0.9); // ниже центра взгляда, чуть впереди
    this.plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.plane.isPickable = false;
    this.plane.renderingGroupId = 3;
    this.draw({});
  }

  /** stats — то же, что отдаёт game.vrDiag(). Троттлится внутри. */
  update(dt: number, stats: Record<string, unknown>): void {
    this.acc += dt;
    if (this.acc < 0.3) return;
    this.acc = 0;
    this.draw(stats);
  }

  private draw(s: Record<string, unknown>): void {
    const ctx = this.tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, TEX_W, TEX_H);
    ctx.fillStyle = "rgba(8,10,16,0.82)";
    ctx.fillRect(0, 0, TEX_W, TEX_H);
    ctx.strokeStyle = "#5a6480";
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, TEX_W - 4, TEX_H - 4);

    ctx.textBaseline = "top";
    const line = (y: number, label: string, val: unknown, warn = false): void => {
      ctx.font = "20px system-ui, sans-serif";
      ctx.fillStyle = "#8c96ad";
      ctx.fillText(label, 18, y);
      ctx.font = "bold 20px system-ui, sans-serif";
      ctx.fillStyle = warn ? "#ff8a8a" : "#dbe2f2";
      ctx.fillText(String(val ?? "—"), 250, y);
    };

    const fps = Number(s.fps ?? 0);
    line(14, "FPS", s.fps, fps > 0 && fps < 60);
    line(42, "Частота шлема", s.xrFrameRate);
    line(70, "Буфер глаза", s.eyeBuffer);
    line(98, "hardwareScaling", s.hardwareScaling, Number(s.hardwareScaling ?? 1) !== 1);
    line(126, "Мешей (актив/всего)", `${s.activeMeshes ?? "?"} / ${s.totalMeshes ?? "?"}`);
    line(154, "Света / фовеация", `${s.lights ?? "?"} / ${s.fixedFoveation ?? "?"}`);
    line(182, "inVR / профиль", `${s.inVR} / ${s.vrProfileOn}`);

    this.tex.update(true);
  }

  dispose(): void {
    this.plane.dispose();
    this.tex.dispose();
  }
}
