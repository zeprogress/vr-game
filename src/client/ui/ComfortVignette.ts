import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Effect } from "@babylonjs/core/Materials/effect";
import { Constants } from "@babylonjs/core/Engines/constants";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

const NAME = "comfortVignette";

// Тоннель — плоскость в 40 м перед головой (ребёнок камеры гарнитуры),
// поэтому координата на плоскости / 40 = tan угла от взгляда. Издалека параллакс между глазами
// пропадает (плоскость «на бесконечности»): круг для обоих глаз общий, а не два тоннеля-бинокля. Так одна и та же геометрия
// работает при любом режиме отрисовки (два прохода или multiview), а апертуры обоих
// глаз смотрят в одну точку и при слиянии дают ровный круг.
const DIST = 40;
const SIZE = 6 * DIST;

Effect.ShadersStore[`${NAME}VertexShader`] = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
#ifdef MULTIVIEW
uniform mat4 viewProjectionR;
#endif
varying vec2 vP;
void main() {
  vP = position.xy * ${SIZE.toFixed(1)};
  vec4 wp = world * vec4(position, 1.0);
#ifdef MULTIVIEW
  if (gl_ViewID_OVR == 0u) { gl_Position = viewProjection * wp; } else { gl_Position = viewProjectionR * wp; }
#else
  gl_Position = viewProjection * wp;
#endif
}
`;

Effect.ShadersStore[`${NAME}FragmentShader`] = `
precision highp float;
varying vec2 vP;
uniform float intensity;  // 0..1 — сила тоннеля движения
uniform float blink;      // 0..1 — сплошное затемнение (телепорт-блинк)
void main() {
  float r = length(vP) / ${DIST.toFixed(1)};   // tan угла от направления взгляда
  float inner = mix(1.16, 0.40, clamp(intensity, 0.0, 1.0));
  float tunnel = smoothstep(inner, inner + 0.24, r);
  float a = max(tunnel, clamp(blink, 0.0, 1.0));
  if (a < 0.003) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}
`;

/**
 * Чёрная виньетка комфорта в VR:
 *  - тоннель при перемещении стиком и при повороте — мгновенно появляется
 *    (любое, даже лёгкое отклонение стика) и мгновенно исчезает, без плавности;
 *  - короткий сплошной блинк на телепорт-прыжок.
 * Рисуется отдельно для каждого глаза, чтобы не было полосы по центру.
 */
export class ComfortVignette {
  private readonly quad: Mesh;
  private readonly mat: ShaderMaterial;
  private amt = 0; // сила тоннеля 0..1 (со сглаживанием)
  private blinkAmt = 0;

  constructor(scene: Scene, camera: Node | null) {
    this.mat = new ShaderMaterial(`${NAME}Mat`, scene, NAME, {
      attributes: ["position", "uv"],
      uniforms: ["intensity", "blink", "world", "viewProjection"],
      needAlphaBlending: true,
    });
    this.mat.setFloat("intensity", 0);
    this.mat.setFloat("blink", 0);
    this.mat.backFaceCulling = false;
    this.mat.alphaMode = Constants.ALPHA_COMBINE;
    this.mat.alpha = 0.999;
    this.mat.disableDepthWrite = true;

    this.quad = MeshBuilder.CreatePlane(NAME, { width: 1, height: 1 }, scene);
    this.quad.material = this.mat;
    if (camera) this.quad.parent = camera;
    this.quad.position.set(0, 0, DIST);
    this.quad.scaling.setAll(SIZE);
    this.quad.isPickable = false;
    this.quad.applyFog = false;
    this.quad.alwaysSelectAsActiveMesh = true;
    this.quad.renderingGroupId = 3; // поверх всего
    this.quad.setEnabled(false);
  }

  /** Мгновенно затемнить на телепорт-прыжок — дальше само гаснет. */
  blink(): void {
    this.blinkAmt = 1;
  }

  /**
   * @param dt     шаг кадра, с
   * @param want   едет стиком и/или повернулся только что — включить на полную,
   *               без деления на "насколько сильно" (любое отклонение — сразу максимум)
   * @param enabled false — виньетку отключили глобально: гасим и не рисуем
   */
  tick(dt: number, want: boolean, enabled: boolean): void {
    // Заявка: без плавности вообще — появляется и исчезает мгновенно.
    this.amt = enabled && want ? 1 : 0;

    if (this.blinkAmt > 0) this.blinkAmt = Math.max(0, this.blinkAmt - dt * 3.5);

    this.mat.setFloat("intensity", this.amt);
    this.mat.setFloat("blink", enabled ? this.blinkAmt : 0);
    this.quad.setEnabled(this.amt > 0 || this.blinkAmt > 0);
  }

  dispose(): void {
    this.quad.dispose();
    this.mat.dispose();
  }
}
