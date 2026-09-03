import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

// Разрешение текстуры и кегль подняты в ~1.4 раза относительно физического
// размера плашки (BASE_W растёт вместе с ними, planeW считается от их
// отношения) — так плашку можно крупно масштабировать через setScale()
// и она не мылится. Физический размер при этом прежний.
const BASE_W = 448;
const H = 208;
const NAME_FONT = "bold 56px system-ui, sans-serif";
const LVL_FONT = "36px system-ui, sans-serif";

/**
 * Плашка с именем и уровнем над мобом. Всегда развёрнута к камере
 * и параллельна горизонту (BILLBOARDMODE_Y).
 */
export class NameTag {
  private readonly plane: Mesh;
  private readonly tex: DynamicTexture;
  private baseY: number;
  private readonly halfH: number;

  private readonly W: number;
  private readonly accent: Color3;
  private curName = "";
  private curLevel: number | null = null;

  constructor(
    scene: Scene,
    parent: Node,
    offset: Vector3,
    name: string,
    /** Уровень (вторая строка). null — не рисуется. Меняется через setInfo(). */
    level: number | null,
    accent: Color3 = new Color3(1, 0.86, 0.4),
  ) {
    this.accent = accent;

    // Ширину закладываем сразу под имя И вторую строку — чтобы смена уровня
    // не требовала пересоздавать текстуру.
    const measure = document.createElement("canvas").getContext("2d")!;
    measure.font = NAME_FONT;
    let textW = measure.measureText(name).width;
    measure.font = LVL_FONT;
    textW = Math.max(textW, measure.measureText("999 ур.").width);
    const padX = 30;
    this.W = Math.max(BASE_W, Math.ceil(textW + padX * 2 + 16));

    this.tex = new DynamicTexture("nameTagTex", { width: this.W, height: H }, scene, false);
    this.tex.hasAlpha = true;
    this.paint(name, level);

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
    const planeW = 0.9 * (this.W / BASE_W);
    const height = planeW * (H / this.W);
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

  /** Перерисовать содержимое плашки (имя / уровень меняются на лету). */
  setInfo(name: string, level: number | null): void {
    if (name === this.curName && level === this.curLevel) return;
    this.paint(name, level);
  }

  private paint(name: string, level: number | null): void {
    this.curName = name;
    this.curLevel = level;
    const W = this.W;
    const ctx = this.tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const measure = ctx;
    measure.font = NAME_FONT;
    let textW = measure.measureText(name).width;
    if (level !== null) {
      measure.font = LVL_FONT;
      textW = Math.max(textW, measure.measureText(`${level} ур.`).width);
    }
    const padX = 30;
    const padY = 14;
    const contentH = level === null ? 62 : 104;
    const boxW = Math.min(W - 8, textW + padX * 2);
    const boxH = contentH + padY * 2;
    ctx.fillStyle = "rgba(12,14,20,0.34)";
    roundRect(ctx, (W - boxW) / 2, (H - boxH) / 2, boxW, boxH, 14);
    ctx.fill();

    ctx.fillStyle = "#f2f4fb";
    ctx.font = NAME_FONT;
    ctx.fillText(name, W / 2, level === null ? H / 2 : H / 2 - 20);

    if (level !== null) {
      const a = this.accent;
      ctx.fillStyle = `rgb(${a.r * 255},${a.g * 255},${a.b * 255})`;
      ctx.font = LVL_FONT;
      ctx.fillText(`${level} ур.`, W / 2, H / 2 + 42);
    }
    this.tex.update(true);
  }

  setEnabled(v: boolean): void {
    this.plane.setEnabled(v);
  }

  /** Поднять плашку — когда высота модели становится известна позже (боты). */
  setAnchorY(y: number): void {
    this.baseY = y;
    this.plane.position.y = y + (this.plane.scaling.y - 1) * this.halfH;
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
