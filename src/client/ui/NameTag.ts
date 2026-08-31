import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

const BASE_W = 320; // ширина, под которую подобран физический размер плашки
const H = 150;

/**
 * Плашка с именем и уровнем над мобом. Всегда развёрнута к камере
 * и параллельна горизонту (BILLBOARDMODE_Y).
 */
export class NameTag {
  private readonly plane: Mesh;
  private readonly tex: DynamicTexture;
  private readonly baseY: number;
  private readonly halfH: number;

  constructor(
    scene: Scene,
    parent: Node,
    offset: Vector3,
    name: string,
    /** Уровень для мобов; null у игроков (вторая строка не рисуется). */
    level: number | null,
    accent: Color3 = new Color3(1, 0.86, 0.4),
  ) {
    const nameFont = "bold 40px system-ui, sans-serif";
    const lvlFont = "26px system-ui, sans-serif";

    // Меряем текст ОТДЕЛЬНЫМ канвасом и расширяем текстуру, если длинное имя
    // не влезает в базовую ширину — иначе буквы срезаются по краям.
    const measure = document.createElement("canvas").getContext("2d")!;
    measure.font = nameFont;
    let textW = measure.measureText(name).width;
    if (level !== null) {
      measure.font = lvlFont;
      textW = Math.max(textW, measure.measureText(`${level} ур.`).width);
    }
    const padX = 22;
    const W = Math.max(BASE_W, Math.ceil(textW + padX * 2 + 12));

    this.tex = new DynamicTexture("nameTagTex", { width: W, height: H }, scene, false);
    this.tex.hasAlpha = true;

    const ctx = this.tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, W, H);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const padY = 10;
    const contentH = level === null ? 44 : 74;
    const boxW = Math.min(W - 6, textW + padX * 2);
    const boxH = contentH + padY * 2;
    const bx = (W - boxW) / 2;
    const by = (H - boxH) / 2;
    ctx.fillStyle = "rgba(12,14,20,0.34)";
    roundRect(ctx, bx, by, boxW, boxH, 10);
    ctx.fill();

    ctx.fillStyle = "#f2f4fb";
    ctx.font = nameFont;
    ctx.fillText(name, W / 2, level === null ? H / 2 : H / 2 - 14);

    if (level !== null) {
      ctx.fillStyle = `rgb(${accent.r * 255},${accent.g * 255},${accent.b * 255})`;
      ctx.font = lvlFont;
      ctx.fillText(`${level} ур.`, W / 2, H / 2 + 30);
    }

    this.tex.update(true);

    const mat = new StandardMaterial("nameTagMat", scene);
    mat.diffuseTexture = this.tex;
    mat.emissiveTexture = this.tex;
    mat.opacityTexture = this.tex;
    mat.useAlphaFromDiffuseTexture = true;
    mat.disableLighting = true;
    mat.specularColor = new Color3(0, 0, 0);
    mat.backFaceCulling = false;

    // Физическую ширину тянем вслед за текстурой — так буквы в мире остаются
    // прежнего размера, плашка просто становится длиннее.
    const planeW = 0.9 * (W / BASE_W);
    const height = planeW * (H / W);
    this.plane = MeshBuilder.CreatePlane("nameTag", { width: planeW, height }, scene);
    this.plane.material = mat;
    this.plane.parent = parent;
    this.plane.position.copyFrom(offset);
    this.plane.isPickable = false;
    // Группа 0 + проверка глубины: плашку загораживают стены, деревья и пол.
    this.plane.renderingGroupId = 0;
    this.plane.billboardMode = Mesh.BILLBOARDMODE_Y;

    this.baseY = offset.y;
    this.halfH = height / 2;
  }

  setEnabled(v: boolean): void {
    this.plane.setEnabled(v);
  }

  /**
   * Множитель размера плашки. Растёт нижним краем на месте, чтобы увеличенная
   * плашка не налезала на моба.
   */
  setScale(k: number): void {
    this.plane.scaling.setAll(k);
    this.plane.position.y = this.baseY + (k - 1) * this.halfH;
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
