import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

const TEX_W = 680;
const TEX_H = 470;

/**
 * Отладочная плашка в VR: `?perf=1`. Висит перед лицом снизу, показывает
 * fps / частоту шлема / разрешение буфера глаза / hardwareScaling / число
 * мешей и света. Нужна потому, что chrome://inspect с Quest часто «offline».
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
    ctx.fillStyle = "rgba(8,10,16,0.82)";
    ctx.fillRect(0, 0, TEX_W, TEX_H);
    ctx.strokeStyle = "#5a6480";
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, TEX_W - 4, TEX_H - 4);

    ctx.textBaseline = "top";
    const line = (y: number, label: string, val: unknown, warn = false): void => {
      ctx.font = "19px system-ui, sans-serif";
      ctx.fillStyle = "#8c96ad";
      ctx.fillText(label, 16, y);
      ctx.font = "bold 19px system-ui, sans-serif";
      ctx.fillStyle = warn ? "#ff8a8a" : "#dbe2f2";
      ctx.fillText(String(val ?? "—"), 240, y);
    };

    const fps = Number(s.fps ?? 0);
    const shaderN = Number(s.shaderN ?? 0);
    const shaderDelta = shaderN - this.prevShaderN;
    this.prevShaderN = shaderN;
    line(12, "FPS", s.fps, fps > 0 && fps < 55);
    line(35, "мс: кадр / JS / cull / render",
      `${s.msFrame ?? "?"} / ${s.msJS ?? "?"} / ${s.msCull ?? "?"} / ${s.msRender ?? "?"}`);
    line(58, "Компиляций шейдеров: всего / +тик",
      `${shaderN} / +${shaderDelta}`, shaderDelta > 0);
    line(81, "Буфер глаза", s.eyeBuffer);
    line(104, "hardwareScaling", s.hardwareScaling, Number(s.hardwareScaling ?? 1) !== 1);
    line(127, "Мешей актив / всего", `${s.activeMeshes ?? "?"} / ${s.totalMeshes ?? "?"}`);
    line(150, "Света / частота шлема", `${s.lights ?? "?"} / ${s.xrFrameRate ?? "?"}`);

    // Недавно скомпилированные шейдеры — если тут что-то каждый тик, это оно.
    ctx.font = "16px system-ui, sans-serif";
    ctx.fillStyle = "#ff8a8a";
    ctx.fillText("Свежие компиляции шейдеров:", 16, 182);
    const eff = (s.newEffects as string[]) ?? [];
    let y = 204;
    for (const e of eff.slice(-4)) {
      ctx.fillStyle = "#dbe2f2";
      ctx.font = "14px monospace";
      ctx.fillText(e.slice(0, 52), 20, y);
      y += 19;
    }

    // Разбивка активных мешей по «основе» имени.
    ctx.font = "17px system-ui, sans-serif";
    ctx.fillStyle = "#9fd0ff";
    ctx.fillText("Активные меши (топ):", 16, y + 8);
    y += 30;
    const cats = Object.entries((s.byCategory as Record<string, number>) ?? {}).sort(
      (a, b) => b[1] - a[1],
    );
    for (const [name, n] of cats.slice(0, 5)) {
      ctx.font = "15px system-ui, sans-serif";
      ctx.fillStyle = "#8c96ad";
      ctx.fillText(name.slice(0, 34), 28, y);
      ctx.fillStyle = n >= 100 ? "#ff8a8a" : "#dbe2f2";
      ctx.fillText(String(n), 470, y);
      y += 20;
    }

    this.tex.update(true);
  }

  dispose(): void {
    this.plane.dispose();
    this.tex.dispose();
  }
}
