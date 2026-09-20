import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Effect } from "@babylonjs/core/Materials/effect";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Constants } from "@babylonjs/core/Engines/constants";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

/**
 * «WASTED» при смерти (VR) — как в GTA: экран темнеет (вместе с красной виньеткой из
 * VrVignette), по центру красная надпись, медленно чуть растёт. Два экранных квада в
 * clip-space (одинаково в оба глаза, без камеры и матриц): текст рисуется в текстуру ОДИН
 * раз, дальше за кадр меняются только три числа-uniform — нагрузки на CPU почти нет, а
 * пока герой жив, оба меша выключены.
 */
const DIM = "wastedDim";
const TXT = "wastedText";

Effect.ShadersStore[`${DIM}VertexShader`] = `
precision highp float;
attribute vec3 position;
void main() { gl_Position = vec4(position.x * 2.0, position.y * 2.0, -1.0, 1.0); }
`;
Effect.ShadersStore[`${DIM}FragmentShader`] = `
precision highp float;
uniform float a;
void main() { gl_FragColor = vec4(0.02, 0.0, 0.0, a); }
`;

Effect.ShadersStore[`${TXT}VertexShader`] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform float sx;
uniform float sy;
varying vec2 vUV;
void main() {
  vUV = uv;
  gl_Position = vec4(position.x * 2.0 * sx, position.y * 2.0 * sy, -1.0, 1.0);
}
`;
Effect.ShadersStore[`${TXT}FragmentShader`] = `
precision highp float;
varying vec2 vUV;
uniform sampler2D tex;
uniform float alpha;
void main() {
  vec4 c = texture2D(tex, vUV);
  float a = c.a * alpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(c.rgb, a);
}
`;

const TEX_W = 1024;
const TEX_H = 256;
/** Примерное соотношение сторон вьюпорта глаза (Quest 3: ~1680×1760). */
const EYE_ASPECT = 0.95;

export class VrWasted {
  private readonly dim: Mesh;
  private readonly text: Mesh;
  private readonly dimMat: ShaderMaterial;
  private readonly textMat: ShaderMaterial;
  private readonly tex: DynamicTexture;
  private t = 0;
  private on = false;

  constructor(scene: Scene) {
    this.dimMat = new ShaderMaterial(`${DIM}Mat`, scene, DIM, {
      attributes: ["position"],
      uniforms: ["a"],
      needAlphaBlending: true,
    });
    this.dimMat.setFloat("a", 0);
    this.dimMat.backFaceCulling = false;
    this.dimMat.alphaMode = Constants.ALPHA_COMBINE;
    this.dimMat.disableDepthWrite = true;
    this.dim = MeshBuilder.CreatePlane(DIM, { width: 1, height: 1 }, scene);
    this.dim.material = this.dimMat;
    this.dim.isPickable = false;
    this.dim.applyFog = false;
    this.dim.alwaysSelectAsActiveMesh = true;
    this.dim.renderingGroupId = 3;
    this.dim.setEnabled(false);

    // Текст — один раз в текстуру.
    this.tex = new DynamicTexture(`${TXT}Tex`, { width: TEX_W, height: TEX_H }, scene, false);
    this.tex.hasAlpha = true;
    const g = this.tex.getContext() as unknown as CanvasRenderingContext2D;
    g.clearRect(0, 0, TEX_W, TEX_H);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "900 200px Impact, 'Arial Black', 'Helvetica Neue', Arial, sans-serif";
    const cx = TEX_W / 2;
    const cy = TEX_H / 2 + 6;
    // Разрежённые буквы, как у оригинала: рисуем по одной с трекингом.
    const word = "WASTED";
    const widths = [...word].map((ch) => g.measureText(ch).width);
    const track = 8;
    const total = widths.reduce((s, w) => s + w, 0) + track * (word.length - 1);
    let x = cx - total / 2;
    g.textAlign = "left";
    g.shadowColor = "rgba(0,0,0,0.85)";
    g.shadowBlur = 22;
    g.shadowOffsetY = 4;
    g.lineJoin = "round";
    g.lineWidth = 9;
    g.strokeStyle = "rgba(20,0,0,0.85)";
    g.fillStyle = "#c9252b";
    [...word].forEach((ch, i) => {
      g.strokeText(ch, x, cy);
      g.fillText(ch, x, cy);
      x += widths[i] + track;
    });
    this.tex.update();

    this.textMat = new ShaderMaterial(`${TXT}Mat`, scene, TXT, {
      attributes: ["position", "uv"],
      uniforms: ["sx", "sy", "alpha"],
      samplers: ["tex"],
      needAlphaBlending: true,
    });
    this.textMat.setTexture("tex", this.tex);
    this.textMat.setFloat("alpha", 0);
    this.textMat.setFloat("sx", 0.7);
    this.textMat.setFloat("sy", 0.17);
    this.textMat.backFaceCulling = false;
    this.textMat.alphaMode = Constants.ALPHA_COMBINE;
    this.textMat.disableDepthWrite = true;
    this.text = MeshBuilder.CreatePlane(TXT, { width: 1, height: 1 }, scene);
    this.text.material = this.textMat;
    this.text.isPickable = false;
    this.text.applyFog = false;
    this.text.alwaysSelectAsActiveMesh = true;
    this.text.renderingGroupId = 3;
    this.text.setEnabled(false);
  }

  /** true — показать (герой погиб), false — убрать всё (возрождение). */
  setDead(dead: boolean): void {
    if (dead === this.on) return;
    this.on = dead;
    this.t = 0;
    this.dim.setEnabled(dead);
    this.text.setEnabled(dead);
    if (!dead) {
      this.dimMat.setFloat("a", 0);
      this.textMat.setFloat("alpha", 0);
    }
  }

  tick(dt: number): void {
    if (!this.on) return;
    this.t += dt;
    const t = this.t;
    // Затемнение нарастает за ~1.2 с; текст проступает с 0.35 до 1.3 с и медленно растёт.
    this.dimMat.setFloat("a", 0.6 * smooth(t / 1.2));
    this.textMat.setFloat("alpha", 0.95 * smooth((t - 0.35) / 0.95));
    const sx = 0.62 * (0.9 + 0.1 * smooth(t / 1.6) + Math.min(t, 6) * 0.012);
    this.textMat.setFloat("sx", sx);
    this.textMat.setFloat("sy", (sx * EYE_ASPECT * TEX_H) / TEX_W);
  }

  dispose(): void {
    this.dim.dispose();
    this.text.dispose();
    this.dimMat.dispose();
    this.textMat.dispose();
    this.tex.dispose();
  }
}

function smooth(x: number): number {
  const c = x < 0 ? 0 : x > 1 ? 1 : x;
  return c * c * (3 - 2 * c);
}
