import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import "@babylonjs/core/Meshes/Builders/linesBuilder";

/**
 * Панель в мире для VR (где HTML не виден): картинка на плоскости в стиле
 * ПК-окон (тёмная, карточки, полоски, кнопки). Нажатия — лазер правой руки
 * + курок. Содержимое рисует владелец через `draw(ui)` — простые помощники
 * ниже (текст, кнопка, полоска, карточка), кнопки сами становятся кликабельны.
 */

export const VR_UI = {
  bg: "#100f15",
  card: "#1d1c25",
  cardHard: "#261e2e",
  cardStory: "#1e2430",
  text: "#e6e0d0",
  title: "#f1ead6",
  dim: "#8f8a7e",
  sub: "#a9a498",
  good: "#8fd18f",
  gold: "#e8c26a",
  purple: "#c79bff",
  barBg: "#2c2b35",
  barFill: "#6fbf6f",
  barHard: "#b57bff",
  btn: "#23222b",
  btnMain: "#243a26",
  btnEdge: "#3a3e48",
  btnMainEdge: "#3f7a45",
} as const;

interface Hit {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  act: () => void;
  enabled: boolean;
}

export class PanelUi {
  readonly hits: Hit[] = [];
  constructor(
    readonly ctx: CanvasRenderingContext2D,
    readonly W: number,
    readonly H: number,
    private readonly hoverId: string,
  ) {}

  text(s: string, x: number, y: number, size: number, color: string = VR_UI.text, weight = 500, align: CanvasTextAlign = "left"): number {
    const c = this.ctx;
    c.font = `${weight} ${size}px system-ui, sans-serif`;
    c.fillStyle = color;
    c.textAlign = align;
    c.textBaseline = "top";
    c.fillText(s, x, y);
    return c.measureText(s).width;
  }

  /** Текст с переносом по словам в ширину w; вернёт высоту блока. */
  wrap(s: string, x: number, y: number, w: number, size: number, color: string = VR_UI.sub, weight = 500): number {
    const c = this.ctx;
    c.font = `${weight} ${size}px system-ui, sans-serif`;
    const words = s.split(" ");
    let line = "";
    let yy = y;
    for (const wd of words) {
      const t = line ? `${line} ${wd}` : wd;
      if (c.measureText(t).width > w && line) {
        this.text(line, x, yy, size, color, weight);
        yy += size * 1.3;
        line = wd;
      } else line = t;
    }
    if (line) {
      this.text(line, x, yy, size, color, weight);
      yy += size * 1.3;
    }
    return yy - y;
  }

  rect(x: number, y: number, w: number, h: number, fill: string, r = 12, stroke?: string, lw = 2): void {
    const c = this.ctx;
    c.beginPath();
    c.roundRect(x, y, w, h, r);
    c.fillStyle = fill;
    c.fill();
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = lw;
      c.stroke();
    }
  }

  bar(x: number, y: number, w: number, frac: number, fill: string = VR_UI.barFill, h = 12): void {
    this.rect(x, y, w, h, VR_UI.barBg, h / 2);
    if (frac > 0) this.rect(x, y, Math.max(h, w * Math.min(1, frac)), h, fill, h / 2);
  }

  /** Кнопка; enabled=false — серая и не нажимается. */
  button(id: string, label: string, x: number, y: number, w: number, h: number, act: () => void, main = false, enabled = true): void {
    const hover = this.hoverId === id && enabled;
    const fill = main ? VR_UI.btnMain : VR_UI.btn;
    this.rect(x, y, w, h, hover ? (main ? "#2f4d32" : "#302f3a") : fill, 10, hover ? "#9fd0ff" : main ? VR_UI.btnMainEdge : VR_UI.btnEdge, hover ? 4 : 2);
    this.ctx.globalAlpha = enabled ? 1 : 0.4;
    this.text(label, x + w / 2, y + h / 2 - 17, 30, VR_UI.text, 700, "center");
    this.ctx.globalAlpha = 1;
    this.hits.push({ id, x, y, w, h, act, enabled });
  }
}

export class VrPanel {
  private readonly plane: Mesh;
  private readonly tex: DynamicTexture;
  private readonly laser: LinesMesh;
  private readonly laserPts = [new Vector3(), new Vector3(0, 0, 1)];
  private hits: Hit[] = [];
  private hoverId = "";
  private prevTrigger = false;
  private dirty = true;
  private lastDraw = 0;
  private open = false;
  private drawFn: ((ui: PanelUi) => void) | null = null;

  constructor(
    scene: Scene,
    name: string,
    private readonly texW = 1024,
    private readonly texH = 1024,
    private readonly planeW = 0.85,
  ) {
    this.tex = new DynamicTexture(`${name}Tex`, { width: texW, height: texH }, scene, true);
    this.tex.hasAlpha = true;
    const mat = new StandardMaterial(`${name}Mat`, scene);
    mat.diffuseTexture = this.tex;
    mat.emissiveTexture = this.tex;
    mat.opacityTexture = this.tex;
    mat.disableLighting = true;
    mat.specularColor = new Color3(0, 0, 0);
    mat.backFaceCulling = false;
    this.plane = MeshBuilder.CreatePlane(name, { width: planeW, height: planeW * (texH / texW) }, scene);
    this.plane.material = mat;
    this.plane.isPickable = false;
    this.plane.renderingGroupId = 2;
    this.plane.setEnabled(false);
    this.laser = MeshBuilder.CreateLines(`${name}Laser`, { points: this.laserPts, updatable: true }, scene);
    this.laser.color = new Color3(0.4, 0.85, 1);
    this.laser.isPickable = false;
    this.laser.renderingGroupId = 2;
    this.laser.alwaysSelectAsActiveMesh = true;
    this.laser.setEnabled(false);
  }

  get visible(): boolean {
    return this.open;
  }

  /** Показать с содержимым draw (перерисовывается по markDirty / раз в ~0.5 с). */
  show(draw: (ui: PanelUi) => void): void {
    this.drawFn = draw;
    this.dirty = true;
    this.lastDraw = 0;
    if (this.open) return;
    this.open = true;
    this.plane.setEnabled(true);
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.plane.setEnabled(false);
    this.laser.setEnabled(false);
    this.drawFn = null;
  }

  markDirty(): void {
    this.dirty = true;
  }

  /** Поставить панель в точку (мир) лицом к голове игрока. */
  place(pos: Vector3, head: Vector3): void {
    this.plane.position.copyFrom(pos);
    const dx = head.x - pos.x;
    const dz = head.z - pos.z;
    // Плоскость смотрит «лицом» по −Z — разворачиваем к игроку.
    this.plane.rotation.set(0, Math.atan2(dx, dz) + Math.PI, 0);
  }

  /** Кадр: лазер правой руки → наведение/нажатие. Вернёт true, если лазер на панели (оружие правой руки глушим). */
  update(ray: { origin: Vector3; dir: Vector3 } | null, trigger: boolean): boolean {
    if (!this.open) return false;
    const hit = ray ? this.rayToUv(ray) : null;
    if (ray && hit) {
      const len = hit.t;
      this.laserPts[0].copyFrom(ray.origin);
      this.laserPts[1].set(ray.origin.x + ray.dir.x * len, ray.origin.y + ray.dir.y * len, ray.origin.z + ray.dir.z * len);
      MeshBuilder.CreateLines("vrPanelLaser", { points: this.laserPts, instance: this.laser as never });
      this.laser.setEnabled(true);
    } else this.laser.setEnabled(false);
    const w = hit ? this.hits.find((b) => b.enabled && hit.u >= b.x && hit.u <= b.x + b.w && hit.v >= b.y && hit.v <= b.y + b.h) : undefined;
    const hover = w?.id ?? "";
    if (hover !== this.hoverId) {
      this.hoverId = hover;
      this.dirty = true;
    }
    if (w && trigger && !this.prevTrigger) {
      w.act();
      this.dirty = true;
      this.lastDraw = 0;
    }
    this.prevTrigger = trigger;
    const now = performance.now();
    if ((this.dirty && now - this.lastDraw > 50) || now - this.lastDraw > 500) {
      this.lastDraw = now;
      this.dirty = false;
      this.redraw();
    }
    return !!hit;
  }

  private redraw(): void {
    const ctx = this.tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, this.texW, this.texH);
    const ui = new PanelUi(ctx, this.texW, this.texH, this.hoverId);
    ui.rect(4, 4, this.texW - 8, this.texH - 8, "rgba(16,15,21,0.68)", 28);
    this.drawFn?.(ui);
    this.hits = ui.hits;
    this.tex.update(true);
  }

  private readonly _inv = new Matrix();
  private readonly _ol = new Vector3();
  private readonly _dl = new Vector3();

  private rayToUv(ray: { origin: Vector3; dir: Vector3 }): { u: number; v: number; t: number } | null {
    const m = this.plane.computeWorldMatrix(true);
    m.invertToRef(this._inv);
    Vector3.TransformCoordinatesToRef(ray.origin, this._inv, this._ol);
    Vector3.TransformNormalToRef(ray.dir, this._inv, this._dl);
    if (Math.abs(this._dl.z) < 1e-5) return null;
    const t = -this._ol.z / this._dl.z;
    if (t < 0 || t > 6) return null;
    const x = this._ol.x + this._dl.x * t;
    const y = this._ol.y + this._dl.y * t;
    const hh = this.planeW * (this.texH / this.texW);
    const u = (x / this.planeW + 0.5) * this.texW;
    const v = (0.5 - y / hh) * this.texH;
    if (u < 0 || u > this.texW || v < 0 || v > this.texH) return null;
    // t в локальных единицах = мировые (панель без масштаба).
    return { u, v, t };
  }

  dispose(): void {
    this.laser.dispose();
    this.plane.dispose();
    this.tex.dispose();
  }
}
