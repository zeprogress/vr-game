import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

const FULL_W = 1200;
const FULL_H = 780;
const LITE_W = 420;
const LITE_H = 150;

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
  private prevMatDirty = 0;
  private prevLightTog = 0;
  private readonly w: number;
  private readonly h: number;

  constructor(
    scene: Scene,
    parent: Node,
    private readonly lite = false,
  ) {
    this.w = lite ? LITE_W : FULL_W;
    this.h = lite ? LITE_H : FULL_H;
    this.tex = new DynamicTexture("perfTex", { width: this.w, height: this.h }, scene, false);
    const mat = new StandardMaterial("perfMat", scene);
    mat.diffuseTexture = this.tex;
    mat.emissiveTexture = this.tex;
    mat.disableLighting = true;
    mat.specularColor = new Color3(0, 0, 0);
    mat.backFaceCulling = false;
    this.tex.hasAlpha = true;

    const width = lite ? 0.4 : 1.1;
    this.plane = MeshBuilder.CreatePlane(
      "vrPerfHud",
      { width, height: width * (this.h / this.w) },
      scene,
    );
    this.plane.material = mat;
    this.plane.parent = parent;
    this.plane.position.set(0, lite ? -0.28 : -0.05, lite ? 0.9 : 0.75);
    this.plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.plane.isPickable = false;
    this.plane.renderingGroupId = 3;
    this.draw({});
  }

  /** getStats — вернуть game.vrDiag(). Зовётся ТОЛЬКО на троттле. */
  update(dt: number, getStats: () => Record<string, unknown>): void {
    this.acc += dt;
    if (this.acc < (this.lite ? 0.5 : 0.5)) return;
    this.acc = 0;
    this.draw(getStats());
  }

  private draw(s: Record<string, unknown>): void {
    const ctx = this.tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = "rgba(6,8,14,0.9)";
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.strokeStyle = "#5a6480";
    ctx.lineWidth = 4;
    ctx.strokeRect(3, 3, this.w - 6, this.h - 6);
    ctx.textBaseline = "top";

    if (this.lite) {
      const fpsL = Number(s.fps ?? 0);
      ctx.font = "bold 48px system-ui, sans-serif";
      ctx.fillStyle = fpsL > 0 && fpsL < 55 ? "#ff7a7a" : "#7ee081";
      ctx.fillText(`FPS ${s.fps ?? "?"}`, 24, 16);
      ctx.font = "24px system-ui, sans-serif";
      ctx.fillStyle = "#c9d2e6";
      ctx.fillText(`${s.xrFrameRate ?? "?"} Гц · буфер ${s.eyeBuffer ?? "?"}`, 24, 74);
      ctx.fillText(
        `мешей ${s.activeMeshes ?? "?"}/${s.totalMeshes ?? "?"} · scale ${s.hardwareScaling ?? "?"}`,
        24,
        104,
      );
      this.tex.update(true);
      return;
    }

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

    row(20, "FPS", s.fps, fps > 0 && fps < 55);
    row(70, "мс  кадр / JS", `${s.msFrame ?? "?"} / ${s.msJS ?? "?"}`);
    row(120, "Шейдеры всего / +тик", `${shaderN} / +${delta}`, delta > 0);

    const md = Number(s.probeMatDirty ?? 0);
    const lt = Number(s.probeLightToggle ?? 0);
    const dMd = md - this.prevMatDirty;
    const dLt = lt - this.prevLightTog;
    this.prevMatDirty = md;
    this.prevLightTog = lt;
    ctx.font = "24px monospace";
    ctx.fillStyle = dMd > 0 || dLt > 0 ? "#ff7a7a" : "#ffd166";
    ctx.fillText(
      `markDirty +${dMd}/тик · свет toggle +${dLt}/тик · ${s.probeLastLight ?? ""}`,
      30,
      164,
    );
    ctx.font = "16px monospace";
    ctx.fillStyle = "#ffd166";
    const who = String(s.probeMadWho ?? "");
    ctx.fillText(who.slice(0, 96), 30, 186);
    ctx.fillText(who.slice(96, 192), 30, 206);
    ctx.fillText(`${s.probeRelight ?? ""}`, 30, 226);

    ctx.font = "bold 24px system-ui, sans-serif";
    ctx.fillStyle = "#ff9d9d";
    ctx.fillText("Свежие компиляции шейдеров:", 30, 252);

    const eff = (s.newEffects as string[]) ?? [];
    let y = 286;
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
