import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Effect } from "@babylonjs/core/Materials/effect";
import { Constants } from "@babylonjs/core/Engines/constants";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

import { VIGNETTE } from "../shared/constants";
import { clamp01 } from "../shared/geometry";

const NAME = "damageVignette";

// Экранный квад: вершинный шейдер игнорирует мировую матрицу и растягивает
// плоскость 1x1 ровно на весь вьюпорт — одинаково в узкий FOV монитора и
// широкий FOV шлема (рисуется отдельно для каждого глаза).
Effect.ShadersStore[`${NAME}VertexShader`] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
varying vec2 vUV;
void main() {
  vUV = uv;
  gl_Position = vec4(position.x * 2.0, position.y * 2.0, -1.0, 1.0);
}
`;

// Радиальная маска: прозрачный центр, насыщенный красный к краям.
// Альфа считается попиксельно.
Effect.ShadersStore[`${NAME}FragmentShader`] = `
precision highp float;
varying vec2 vUV;
uniform vec3 tint;
uniform float intensity;
void main() {
  vec2 d = (vUV - vec2(0.5)) * 2.0;
  float r = length(d);
  // Плотность нарастает от середины кадра к краям — заметно, но центр чист.
  float edge = smoothstep(0.35, 1.15, r);
  float a = pow(edge, 1.1) * intensity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(tint, a);
}
`;

/**
 * Красная виньетка по краям обзора (VR):
 *  - вспышка при уроне (`flash`), быстро гаснет;
 *  - постоянная виньетка нехватки здоровья (`setHealth`) — тем сильнее и
 *    заметнее пульсирует, чем меньше HP; исчезает у полного здоровья.
 * На экран выводится максимум из двух.
 */
export class VrVignette {
  private readonly quad: Mesh;
  private readonly mat: ShaderMaterial;
  private flashAmt = 0;
  private lowAmt = 0; // 0..1 «нехватка здоровья»
  private pulseT = 0;

  constructor(scene: Scene) {
    this.mat = new ShaderMaterial(`${NAME}Mat`, scene, NAME, {
      attributes: ["position", "uv"],
      uniforms: ["tint", "intensity"],
      needAlphaBlending: true,
    });
    this.mat.setColor3("tint", new Color3(1, 0.02, 0.02)); // чистый насыщенный красный
    this.mat.setFloat("intensity", 0);
    this.mat.backFaceCulling = false;
    this.mat.alphaMode = Constants.ALPHA_COMBINE;
    this.mat.alpha = 0.999;
    this.mat.disableDepthWrite = true;

    this.quad = MeshBuilder.CreatePlane(NAME, { width: 1, height: 1 }, scene);
    this.quad.material = this.mat;
    this.quad.isPickable = false;
    this.quad.applyFog = false;
    this.quad.alwaysSelectAsActiveMesh = true;
    this.quad.renderingGroupId = 3; // поверх всего
    this.quad.setEnabled(false);
  }

  flash(damage: number): void {
    const peak = Math.min(
      VIGNETTE.maxAlpha,
      VIGNETTE.hitBase + damage * VIGNETTE.hitPerDamage,
    );
    this.flashAmt = Math.max(this.flashAmt, peak);
    this.apply();
  }

  /** frac — доля здоровья 0..1. */
  setHealth(frac: number): void {
    const t = VIGNETTE.lowHpFrom;
    this.lowAmt = t <= 0 ? 0 : clamp01((t - frac) / t);
    this.apply();
  }

  tick(dt: number): void {
    if (this.flashAmt > 0) {
      this.flashAmt = Math.max(0, this.flashAmt - dt * VIGNETTE.fadeSpeed);
    }
    if (this.lowAmt > 0) this.pulseT += dt * (3 + this.lowAmt * 4);
    this.apply();
  }

  private apply(): void {
    // Пульсация усиливается по мере падения HP.
    const pulse = 1 + VIGNETTE.lowPulse * this.lowAmt * Math.sin(this.pulseT);
    const low = this.lowAmt * this.lowAmt * VIGNETTE.lowMaxAlpha * pulse;
    const amt = Math.max(this.flashAmt, low);
    this.mat.setFloat("intensity", amt);
    this.quad.setEnabled(amt > 0.005);
  }

  dispose(): void {
    this.quad.dispose();
    this.mat.dispose();
  }
}
