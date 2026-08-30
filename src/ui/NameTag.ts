import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

const W = 320;
const H = 150;

/**
 * Плашка с именем и уровнем над мобом. Всегда развёрнута к камере
 * и параллельна горизонту (BILLBOARDMODE_Y).
 */
export class NameTag {
  private readonly plane: Mesh;
  private readonly tex: DynamicTexture;

  constructor(
    scene: Scene,
    parent: Node,
    offset: Vector3,
    name: string,
    level: number,
    accent: Color3 = new Color3(1, 0.86, 0.4),
  ) {
    this.tex = new DynamicTexture("nameTagTex", { width: W, height: H }, scene, false);
    this.tex.hasAlpha = true;

    const ctx = this.tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, W, H);

    // Тёмная скруглённая подложка по центру.
    const pad = 18;
    ctx.fillStyle = "rgba(12,14,20,0.72)";
    roundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, 16);
    ctx.fill();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#f2f4fb";
    ctx.font = "bold 40px system-ui, sans-serif";
    ctx.fillText(name, W / 2, H / 2 - 14);

    ctx.fillStyle = `rgb(${accent.r * 255},${accent.g * 255},${accent.b * 255})`;
    ctx.font = "26px system-ui, sans-serif";
    ctx.fillText(`${level} ур.`, W / 2, H / 2 + 30);

    this.tex.update(true);

    const mat = new StandardMaterial("nameTagMat", scene);
    mat.diffuseTexture = this.tex;
    mat.emissiveTexture = this.tex;
    mat.opacityTexture = this.tex;
    mat.useAlphaFromDiffuseTexture = true;
    mat.disableLighting = true;
    mat.specularColor = new Color3(0, 0, 0);
    mat.backFaceCulling = false;

    this.plane = MeshBuilder.CreatePlane("nameTag", { width: 0.9, height: 0.9 * (H / W) }, scene);
    this.plane.material = mat;
    this.plane.parent = parent;
    this.plane.position.copyFrom(offset);
    this.plane.isPickable = false;
    this.plane.renderingGroupId = 1;
    this.plane.billboardMode = Mesh.BILLBOARDMODE_Y;
  }

  setEnabled(v: boolean): void {
    this.plane.setEnabled(v);
  }

  dispose(): void {
    this.plane.dispose();
    this.tex.dispose();
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
