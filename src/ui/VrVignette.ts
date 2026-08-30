import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Effect } from "@babylonjs/core/Materials/effect";
import { Constants } from "@babylonjs/core/Engines/constants";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

import { VIGNETTE } from "../shared/constants";

const NAME = "damageVignette";

// Экранный квад: вершинный шейдер игнорирует мировую матрицу и растягивает
// плоскость 1x1 ровно на весь вьюпорт. Так виньетка одинаково ложится и в
// узкий FOV монитора, и в широкий FOV шлема (и рисуется отдельно для каждого глаза).
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

// Плавная радиальная маска: прозрачный центр, плотный красный к краям.
// Альфа считается попиксельно — не зависит от текстур.
Effect.ShadersStore[`${NAME}FragmentShader`] = `
precision highp float;
varying vec2 vUV;
uniform vec3 tint;
uniform float intensity;
void main() {
  vec2 d = (vUV - vec2(0.5)) * 2.0;
  float r = length(d);
  // Широкий чистый центр, плотность нарастает только к самым краям.
  float edge = smoothstep(0.62, 1.35, r);
  float a = pow(edge, 1.4) * intensity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(tint, a);
}
`;

/** Красная виньетка по краям обзора при уроне (VR). */
export class VrVignette {
  private readonly quad: Mesh;
  private readonly mat: ShaderMaterial;
  private amt = 0;

  constructor(scene: Scene) {
    this.mat = new ShaderMaterial(`${NAME}Mat`, scene, NAME, {
      attributes: ["position", "uv"],
      uniforms: ["tint", "intensity"],
      needAlphaBlending: true,
    });
    this.mat.setColor3("tint", new Color3(0.95, 0.05, 0.05));
    this.mat.setFloat("intensity", 0);
    this.mat.backFaceCulling = false;
    this.mat.alphaMode = Constants.ALPHA_COMBINE;
    this.mat.alpha = 0.999; // включает альфа-блендинг
    this.mat.disableDepthWrite = true;

    // Ровно 1x1: вершинный шейдер рассчитывает на этот размер.
    this.quad = MeshBuilder.CreatePlane(NAME, { width: 1, height: 1 }, scene);
    this.quad.material = this.mat;
    this.quad.isPickable = false;
    this.quad.applyFog = false;
    this.quad.alwaysSelectAsActiveMesh = true; // мировая матрица не важна, но и не отсекаем
    this.quad.renderingGroupId = 3; // поверх всего
    this.quad.setEnabled(false);
  }

  flash(damage: number): void {
    this.amt = Math.max(this.amt, Math.min(VIGNETTE.maxAlpha, 0.35 + damage / 45));
    this.apply();
  }

  tick(dt: number): void {
    if (this.amt <= 0) return;
    this.amt = Math.max(0, this.amt - dt * VIGNETTE.fadeSpeed);
    this.apply();
  }

  private apply(): void {
    this.mat.setFloat("intensity", this.amt);
    this.quad.setEnabled(this.amt > 0.005);
  }

  dispose(): void {
    this.quad.dispose();
    this.mat.dispose();
  }
}
