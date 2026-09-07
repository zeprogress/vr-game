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
/** Метка бота зрителя перед ником — единственное отличие от живого игрока со стороны. */
const BOT_MARK = "🤖 ";

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
  private readonly planeW: number;
  private readonly accent: Color3;
  private curName = "";
  private curLevel: number | null = null;

  /** Полоска здоровья под ником (создаётся по требованию через showHp). */
  private hpBg: Mesh | null = null;
  private hpFill: Mesh | null = null;
  private hpFillMat: StandardMaterial | null = null;
  private hpW = 0;
  private hpFrac = 1;

  constructor(
    scene: Scene,
    parent: Node,
    offset: Vector3,
    name: string,
    /** Уровень (вторая строка). null — не рисуется. Меняется через setInfo(). */
    level: number | null,
    accent: Color3 = new Color3(1, 0.86, 0.4),
    /**
     * Бот зрителя, а не живой игрок — оба теперь ходят с одной и той же
     * моделью персонажа (Ф10), со стороны их иначе не отличить.
     */
    private readonly isBot: boolean = false,
  ) {
    this.accent = accent;

    // Ширину закладываем сразу под имя И вторую строку — чтобы смена уровня
    // не требовала пересоздавать текстуру.
    const measure = document.createElement("canvas").getContext("2d")!;
    measure.font = NAME_FONT;
    let textW = measure.measureText((isBot ? BOT_MARK : "") + name).width;
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
    this.planeW = planeW;
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

    ctx.fillStyle = "#f2f4fb";
    ctx.font = NAME_FONT;
    ctx.fillText(
      (this.isBot ? BOT_MARK : "") + name,
      W / 2,
      level === null ? H / 2 : H / 2 - 20,
    );

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

  /**
   * Включить полоску здоровья под ником (зелёная, желтеет/краснеет с уроном).
   * Планки — дети плашки: сами едут за billboard, масштабом и якорем.
   */
  showHp(): void {
    if (this.hpBg) return;
    const scene = this.plane.getScene();
    const w = this.planeW * 0.66;
    const barH = this.planeW * 0.05;
    const y = -this.halfH - barH * 1.1;
    this.hpW = w;

    const bgMat = new StandardMaterial("nameHpBgMat", scene);
    bgMat.disableLighting = true;
    bgMat.emissiveColor = new Color3(0.03, 0.03, 0.03);
    bgMat.specularColor = new Color3(0, 0, 0);
    bgMat.alpha = 0.65;
    this.hpBg = MeshBuilder.CreatePlane("nameHpBg", { width: w + w * 0.06, height: barH * 1.5 }, scene);
    this.hpBg.material = bgMat;
    this.hpBg.parent = this.plane;
    this.hpBg.position.set(0, y, 0.01);
    this.hpBg.isPickable = false;
    this.hpBg.renderingGroupId = 0;

    this.hpFillMat = new StandardMaterial("nameHpFillMat", scene);
    this.hpFillMat.disableLighting = true;
    this.hpFillMat.specularColor = new Color3(0, 0, 0);
    this.hpFillMat.emissiveColor = new Color3(0.25, 0.8, 0.3);
    this.hpFill = MeshBuilder.CreatePlane("nameHpFill", { width: w, height: barH }, scene);
    this.hpFill.material = this.hpFillMat;
    this.hpFill.parent = this.hpBg;
    this.hpFill.position.z = -0.01;
    this.hpFill.isPickable = false;
    this.hpFill.renderingGroupId = 0;
    this.setHp(this.hpFrac);
  }

  /** Доля здоровья 0..1. */
  setHp(frac: number): void {
    const f = Math.max(0, Math.min(1, frac));
    this.hpFrac = f;
    if (!this.hpFill || !this.hpFillMat) return;
    this.hpFill.scaling.x = Math.max(0.001, f);
    this.hpFill.position.x = -(this.hpW * (1 - f)) / 2;
    this.hpFillMat.emissiveColor.set(
      f > 0.5 ? 0.25 : 0.85,
      f > 0.25 ? 0.75 : 0.2,
      f > 0.5 ? 0.3 : 0.15,
    );
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
    this.hpFill?.dispose();
    this.hpBg?.dispose();
    this.plane.dispose();
    this.tex.dispose();
  }
}
