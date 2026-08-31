import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Effect } from "@babylonjs/core/Materials/effect";
import { Constants } from "@babylonjs/core/Engines/constants";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

const NAME = "comfortVignette";

// Экранный квад на весь вьюпорт — так же, как у красной виньетки урона.
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

// Чёрный тоннель: центр чист, к краям быстро уходит в непрозрачную темноту.
Effect.ShadersStore[`${NAME}FragmentShader`] = `
precision highp float;
varying vec2 vUV;
uniform float intensity;
void main() {
  vec2 d = (vUV - vec2(0.5)) * 2.0;
  float r = length(d);
  // Радиус чистого центра сжимается по мере роста intensity.
  float inner = mix(1.15, 0.32, clamp(intensity, 0.0, 1.0));
  float a = smoothstep(inner, inner + 0.45, r);
  if (a < 0.003) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}
`;

/**
 * Чёрная виньетка при перемещении стиком (VR): сужает поле зрения на время
 * движения, чтобы меньше укачивало. Плавно появляется на разгоне и уходит,
 * когда игрок остановился. Общий выключатель — на стороне вызывающего.
 */
export class ComfortVignette {
  private readonly quad: Mesh;
  private readonly mat: ShaderMaterial;
  private amt = 0; // текущая сила 0..1 (со сглаживанием)

  constructor(scene: Scene) {
    this.mat = new ShaderMaterial(`${NAME}Mat`, scene, NAME, {
      attributes: ["position", "uv"],
      uniforms: ["intensity"],
      needAlphaBlending: true,
    });
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
    this.quad.renderingGroupId = 3; // поверх всего, но под красной виньеткой урона по смыслу
    this.quad.setEnabled(false);
  }

  /**
   * @param dt     шаг кадра, с
   * @param moving 0..1 — насколько активно игрок едет стиком (0 — стоит)
   * @param enabled false — виньетку отключили (глобально): гасим и не рисуем
   */
  tick(dt: number, moving: number, enabled: boolean): void {
    const target = enabled ? Math.min(1, Math.max(0, moving)) : 0;
    // Появляется быстрее, чем уходит — резкий старт заметнее, чем плавная остановка.
    const rate = target > this.amt ? 9 : 4;
    this.amt += (target - this.amt) * Math.min(1, dt * rate);
    if (this.amt < 0.004) this.amt = 0;
    this.mat.setFloat("intensity", this.amt);
    this.quad.setEnabled(this.amt > 0);
  }

  dispose(): void {
    this.quad.dispose();
    this.mat.dispose();
  }
}
