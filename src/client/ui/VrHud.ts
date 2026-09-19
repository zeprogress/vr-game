import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

/**
 * Надписи поверх мира в VR: плоский DOM-HUD в шлеме не виден, поэтому события
 * мира, всплывающие подсказки и «кто говорит» рисуются панелями в пространстве
 * перед лицом (крепятся к якорю, который следует за поворотом головы).
 *  • banner — крупная надпись сверху по центру (события, босс), ~6 с;
 *  • toast — короткая строка под ней (подсказки, ошибки), ~3 с;
 *  • speakers — значки «динамик + ник» справа сверху: голос игроков и озвучка
 *    чата Twitch выглядят одинаково.
 */
export class VrHud {
  private readonly banner: Panel;
  private readonly toastP: Panel;
  private readonly spk: Panel;
  private bannerT = 0;
  private toastT = 0;
  private speakers: string[] = [];

  constructor(scene: Scene, anchor: Node) {
    this.banner = new Panel(scene, anchor, "vrBanner", 1100, 260, 1.2, 0, 0.36, 1.5);
    this.toastP = new Panel(scene, anchor, "vrToast", 1000, 90, 1.0, 0, 0.14, 1.5);
    this.spk = new Panel(scene, anchor, "vrSpeakers", 520, 300, 0.42, 0.62, 0.33, 1.5);
  }

  /** Крупная надпись события. tone: warn — тревожный, win — победа. */
  showBanner(title: string, sub = "", tone: "warn" | "win" = "warn"): void {
    const ctx = this.banner.ctx;
    ctx.clearRect(0, 0, 1100, 260);
    ctx.fillStyle = "rgba(10,12,18,.72)";
    roundRect(ctx, 20, 20, 1060, 220, 22);
    ctx.fill();
    ctx.strokeStyle = tone === "win" ? "#ffd166" : "#ff7a6a";
    ctx.lineWidth = 5;
    roundRect(ctx, 20, 20, 1060, 220, 22);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = tone === "win" ? "#ffe08a" : "#ffb0a4";
    ctx.font = "bold 68px system-ui, sans-serif";
    ctx.fillText(fit(ctx, title, 1000), 550, 44);
    if (sub) {
      ctx.fillStyle = "#e6ebf7";
      ctx.font = "34px system-ui, sans-serif";
      ctx.fillText(fit(ctx, sub, 1000), 550, 146);
    }
    this.banner.tex.update();
    this.bannerT = 6.5;
    this.banner.mesh.setEnabled(true);
    this.banner.mesh.visibility = 1;
  }

  showToast(text: string): void {
    const ctx = this.toastP.ctx;
    ctx.clearRect(0, 0, 1000, 90);
    ctx.fillStyle = "rgba(10,12,18,.72)";
    roundRect(ctx, 10, 10, 980, 70, 18);
    ctx.fill();
    ctx.fillStyle = "#f2f5ff";
    ctx.font = "bold 38px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(fit(ctx, text, 940), 500, 46);
    this.toastP.tex.update();
    this.toastT = 3.2;
    this.toastP.mesh.setEnabled(true);
    this.toastP.mesh.visibility = 1;
  }

  /** Кто сейчас говорит (голос игроков и озвучка чата) — значок и ник, до 5 строк. */
  setSpeakers(names: string[]): void {
    const same = names.length === this.speakers.length && names.every((n, i) => n === this.speakers[i]);
    if (same) return;
    this.speakers = names.slice(0, 5);
    const ctx = this.spk.ctx;
    ctx.clearRect(0, 0, 520, 300);
    if (this.speakers.length === 0) {
      this.spk.tex.update();
      this.spk.mesh.setEnabled(false);
      return;
    }
    this.speakers.forEach((n, i) => {
      const y = 8 + i * 56;
      ctx.fillStyle = "rgba(10,12,18,.72)";
      roundRect(ctx, 6, y, 508, 50, 14);
      ctx.fill();
      drawSpeakerIcon(ctx, 18, y + 8, 34);
      ctx.fillStyle = "#eaf1ff";
      ctx.font = "bold 30px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(fit(ctx, n, 420), 68, y + 27);
    });
    this.spk.tex.update();
    this.spk.mesh.setEnabled(true);
  }

  update(dt: number): void {
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      this.banner.mesh.visibility = Math.max(0, Math.min(1, this.bannerT / 0.8));
      if (this.bannerT <= 0) this.banner.mesh.setEnabled(false);
    }
    if (this.toastT > 0) {
      this.toastT -= dt;
      this.toastP.mesh.visibility = Math.max(0, Math.min(1, this.toastT / 0.6));
      if (this.toastT <= 0) this.toastP.mesh.setEnabled(false);
    }
  }

  dispose(): void {
    this.banner.dispose();
    this.toastP.dispose();
    this.spk.dispose();
  }
}

class Panel {
  readonly mesh: Mesh;
  readonly tex: DynamicTexture;
  readonly ctx: CanvasRenderingContext2D;

  constructor(
    scene: Scene,
    anchor: Node,
    name: string,
    tw: number,
    th: number,
    width: number,
    x: number,
    y: number,
    z: number,
  ) {
    this.tex = new DynamicTexture(`${name}Tex`, { width: tw, height: th }, scene, false);
    this.tex.hasAlpha = true;
    this.ctx = this.tex.getContext() as unknown as CanvasRenderingContext2D;
    const mat = new StandardMaterial(`${name}Mat`, scene);
    mat.diffuseTexture = this.tex;
    mat.emissiveTexture = this.tex;
    mat.opacityTexture = this.tex;
    mat.useAlphaFromDiffuseTexture = true;
    mat.disableLighting = true;
    mat.specularColor = new Color3(0, 0, 0);
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    this.mesh = MeshBuilder.CreatePlane(name, { width, height: width * (th / tw) }, scene);
    this.mesh.material = mat;
    this.mesh.parent = anchor;
    this.mesh.position.set(x, y, z);
    this.mesh.isPickable = false;
    this.mesh.renderingGroupId = 2;
    this.mesh.setEnabled(false);
  }

  dispose(): void {
    this.mesh.material?.dispose();
    this.mesh.dispose();
    this.tex.dispose();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Обрезает строку многоточием, чтобы влезла в ширину. */
function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

/** Значок «динамик с волнами» — один и тот же для голоса игроков и озвучки чата. */
function drawSpeakerIcon(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.save();
  ctx.translate(x, y);
  const u = s / 34;
  ctx.fillStyle = "#7ee081";
  ctx.strokeStyle = "#7ee081";
  ctx.lineWidth = 3 * u;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(2 * u, 12 * u);
  ctx.lineTo(9 * u, 12 * u);
  ctx.lineTo(18 * u, 4 * u);
  ctx.lineTo(18 * u, 30 * u);
  ctx.lineTo(9 * u, 22 * u);
  ctx.lineTo(2 * u, 22 * u);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(19 * u, 17 * u, 8 * u, -Math.PI / 3, Math.PI / 3);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(19 * u, 17 * u, 14 * u, -Math.PI / 3, Math.PI / 3);
  ctx.stroke();
  ctx.restore();
}
