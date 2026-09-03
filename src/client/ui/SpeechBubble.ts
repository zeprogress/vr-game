import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

const W = 640;
const H = 320;
const FONT_PX = 46;
const FONT = `600 ${FONT_PX}px system-ui, sans-serif`;
const PAD = 26;
const LINE = FONT_PX * 1.22;
const MAX_LINES = 4;
/** Физическая ширина плашки в мире, м. Крупно — читается со стрима. */
const PLANE_W = 3.2;
/** Сколько держится реплика и сколько гаснет, с. */
const HOLD = 7;
const FADE = 1.2;

/**
 * Облачко с репликой над ботом зрителя (Ф10): что хозяин написал в чат
 * канала. Крупный текст в несколько строк, всегда повёрнут к камере,
 * сам гаснет через несколько секунд.
 */
export class SpeechBubble {
  private readonly plane: Mesh;
  private readonly tex: DynamicTexture;
  private readonly mat: StandardMaterial;
  private left = 0;

  constructor(scene: Scene, parent: Node, y: number) {
    this.tex = new DynamicTexture("sayTex", { width: W, height: H }, scene, false);
    this.tex.hasAlpha = true;

    this.mat = new StandardMaterial("sayMat", scene);
    this.mat.diffuseTexture = this.tex;
    this.mat.emissiveTexture = this.tex;
    this.mat.opacityTexture = this.tex;
    this.mat.useAlphaFromDiffuseTexture = true;
    this.mat.disableLighting = true;
    this.mat.specularColor = new Color3(0, 0, 0);
    this.mat.backFaceCulling = false;

    this.plane = MeshBuilder.CreatePlane("sayBubble", { width: PLANE_W, height: (PLANE_W * H) / W }, scene);
    this.plane.material = this.mat;
    this.plane.parent = parent;
    this.plane.position.set(0, y, 0);
    this.plane.isPickable = false;
    this.plane.renderingGroupId = 0;
    this.plane.billboardMode = Mesh.BILLBOARDMODE_Y;
    this.plane.setEnabled(false);
  }

  /** Показать реплику. Повторный вызов перебивает предыдущую. */
  show(text: string): void {
    this.paint(text);
    this.left = HOLD + FADE;
    this.mat.alpha = 1;
    this.plane.setEnabled(true);
  }

  /** Высота плашки над родителем — подстраивается под рост модели. */
  setAnchorY(y: number): void {
    this.plane.position.y = y;
  }

  update(dt: number): void {
    if (this.left <= 0) return;
    this.left -= dt;
    if (this.left <= 0) {
      this.plane.setEnabled(false);
      return;
    }
    this.mat.alpha = this.left < FADE ? this.left / FADE : 1;
  }

  private paint(text: string): void {
    const ctx = this.tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, W, H);
    ctx.font = FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const lines = wrap(ctx, text, W - PAD * 4).slice(0, MAX_LINES);
    if (lines.length === 0) return;
    let boxW = 0;
    for (const l of lines) boxW = Math.max(boxW, ctx.measureText(l).width);
    boxW = Math.min(W - 8, boxW + PAD * 2);
    const boxH = lines.length * LINE + PAD * 1.4;
    const x = (W - boxW) / 2;
    const y = (H - boxH) / 2;

    ctx.fillStyle = "rgba(14,16,24,0.72)";
    roundRect(ctx, x, y, boxW, boxH, 22);
    ctx.fill();
    ctx.strokeStyle = "rgba(232,236,248,0.35)";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Хвостик вниз — чтобы читалось как речь, а не как ещё одна плашка.
    ctx.beginPath();
    ctx.moveTo(W / 2 - 20, y + boxH - 1);
    ctx.lineTo(W / 2 + 20, y + boxH - 1);
    ctx.lineTo(W / 2, y + boxH + 30);
    ctx.closePath();
    ctx.fillStyle = "rgba(14,16,24,0.72)";
    ctx.fill();

    ctx.fillStyle = "#f2f4fb";
    ctx.font = FONT;
    const top = y + PAD * 0.7 + LINE / 2;
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], W / 2, top + i * LINE);

    this.tex.update(true);
  }

  dispose(): void {
    this.plane.dispose();
    this.tex.dispose();
    this.mat.dispose();
  }
}

/** Разбить текст по словам под ширину. Слишком длинное слово режем силой. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const probe = line ? `${line} ${word}` : word;
    if (ctx.measureText(probe).width <= maxW) {
      line = probe;
      continue;
    }
    if (line) out.push(line);
    if (ctx.measureText(word).width <= maxW) {
      line = word;
      continue;
    }
    let chunk = "";
    for (const ch of word) {
      if (ctx.measureText(chunk + ch).width > maxW) {
        out.push(chunk);
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    line = chunk;
  }
  if (line) out.push(line);
  return out;
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
