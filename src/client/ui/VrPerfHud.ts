import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

const TEX_W = 1200;
const TEX_H = 780;

/**
 * Крупная отладочная плашка в VR: `?perf=1`. Висит перед лицом, крупный текст —
 * читать прямо в шлеме (chrome://inspect с Quest часто «offline»). Сейчас важнее
 * всего строка компиляций шейдеров и список свежих компиляций.
 */
export class VrPerfHud {
  private readonly plane: Mesh;
  private readonly tex: DynamicTexture;
  private acc = 0;
  private prevShaderN = 0;

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
      { width: 1.1, height: 1.1 * (TEX_H / TEX_W) },
      scene,
    );
    this.plane.material = mat;
    this.plane.parent = parent;
    this.plane.position.set(0, -0.05, 0.75); // почти по центру взгляда, близко
    this.plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.plane.isPickable = false;
    this.plane.renderingGroupId = 3;
    this.draw({});
  }

  /** getStats — вернуть game.vrDiag(). Зовётся ТОЛЬКО на троттле (дорогой обход мешей). */
  update(dt: number, getStats: () => Record<string, unknown>): void {
    this.acc += dt;
    if (this.acc < 0.5) return;
    this.acc = 0;
    this.draw(getStats());
  }

  private draw(s: Record<string, unknown>): void {
    const ctx = this.tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, TEX_W, TEX_H);
    ctx.fillStyle = "rgba(6,8,14,0.9)";
    ctx.fillRect(0, 0, TEX_W, TEX_H);
    ctx.strokeStyle = "#5a6480";
    ctx.lineWidth = 4;
    ctx.strokeRect(3, 3, TEX_W - 6, TEX_H - 6);
    ctx.textBaseline = "top";

    const row = (y: number, label: string, val: unknown, warn = false): void => {
      ctx.font = "34px system-ui, sans-serif";
      ctx.fillStyle = "#8c96ad";
      ctx.fillText(label, 30, y);
      ctx.font = "bold 40px system-ui, sans-serif";
      ctx.fillStyle = warn ? "#ff7a7a" : "#e8ecf8";
      ctx.fillText(String(val ?? "—"), 620, y - 3);
    };

    const fps = Number(s.fps ?? 0);
    const shaderN = Number(s.shaderN ?? 0);
    const delta = shaderN - this.prevShaderN;
    this.prevShaderN = shaderN;

    row(24, "FPS", s.fps, fps > 0 && fps < 55);
    row(78, "мс  кадр / JS", `${s.msFrame ?? "?"} / ${s.msJS ?? "?"}`);
    row(132, "Шейдеры  всего / +тик", `${shaderN} / +${delta}`, delta > 0);
    row(186, "Мешей актив", s.activeMeshes);

    ctx.font = "bold 34px system-ui, sans-serif";
    ctx.fillStyle = "#ff9d9d";
    ctx.fillText("Свежие компиляции шейдеров:", 30, 258);

    const eff = (s.newEffects as string[]) ?? [];
    let y = 306;
    if (eff.length === 0) {
      ctx.font = "30px system-ui, sans-serif";
      ctx.fillStyle = "#7ee081";
      ctx.fillText("— пусто (ничего не пересобирается) —", 40, y);
    }
    for (const e of eff.slice(-6)) {
      ctx.font = "26px monospace";
      ctx.fillStyle = "#dbe2f2";
      ctx.fillText(e.slice(0, 66), 40, y);
      y += 40;
    }

    this.tex.update(true);
  }

  dispose(): void {
    this.plane.dispose();
    this.tex.dispose();
  }
}
