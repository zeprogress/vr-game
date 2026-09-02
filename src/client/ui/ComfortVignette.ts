import type { Scene } from "@babylonjs/core/scene";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Effect } from "@babylonjs/core/Materials/effect";
import { Constants } from "@babylonjs/core/Engines/constants";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

const NAME = "comfortVignette";

// Точки во view-space для считывания проекции: ось глаза и смещения на tan=1.
const AXIS = new Vector3(0, 0, 1);
const OFF_X = new Vector3(1, 0, 1);
const OFF_Y = new Vector3(0, 1, 1);

// Экранный квад на весь вьюпорт — растягивается одинаково в любой FOV.
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

// Круглый тоннель в УГЛОВЫХ координатах глаза. Центр — оптическая ось (не центр
// вьюпорта: у каждого глаза фрустум асимметричный), масштаб — NDC на единицу
// tan(угла). Поэтому апертуры обоих глаз смотрят в одну точку и при слиянии
// дают ровный круг, без овала и без полосы у носа.
Effect.ShadersStore[`${NAME}FragmentShader`] = `
precision highp float;
varying vec2 vUV;
uniform float intensity;  // 0..1 — сила тоннеля движения
uniform float blink;      // 0..1 — сплошное затемнение (телепорт-блинк)
uniform vec2 center;      // оптическая ось глаза в NDC
uniform vec2 angScale;    // NDC на единицу tan(угла) по осям
void main() {
  vec2 d = (vUV - vec2(0.5)) * 2.0;
  vec2 ang = (d - center) / angScale;   // угловое смещение от оси (в tan)
  float r = length(ang);
  float inner = mix(1.16, 0.40, clamp(intensity, 0.0, 1.0));
  float tunnel = smoothstep(inner, inner + 0.24, r);
  float a = max(tunnel, clamp(blink, 0.0, 1.0));
  if (a < 0.003) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}
`;

/**
 * Чёрная виньетка комфорта в VR:
 *  - тоннель при перемещении стиком (резко появляется на старте движения,
 *    плавно уходит на остановке);
 *  - короткий сплошной блинк на телепорт-прыжок.
 * Рисуется отдельно для каждого глаза, чтобы не было полосы по центру.
 */
export class ComfortVignette {
  private readonly quad: Mesh;
  private readonly mat: ShaderMaterial;
  private amt = 0; // сила тоннеля 0..1 (со сглаживанием)
  private blinkAmt = 0;
  private readonly camObs: Observer<Camera> | null;
  private readonly center = new Vector2(0, 0);
  private readonly angScale = new Vector2(1, 1);

  constructor(scene: Scene) {
    this.mat = new ShaderMaterial(`${NAME}Mat`, scene, NAME, {
      attributes: ["position", "uv"],
      uniforms: ["intensity", "blink", "center", "angScale"],
      needAlphaBlending: true,
    });
    this.mat.setFloat("intensity", 0);
    this.mat.setFloat("blink", 0);
    this.mat.setVector2("center", this.center);
    this.mat.setVector2("angScale", this.angScale);
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

    // Перед отрисовкой каждого глаза берём его оптическую ось и угловой масштаб
    // из матрицы проекции — у левого/правого глаза фрустум разный.
    this.camObs = scene.onBeforeCameraRenderObservable.add((cam) => {
      const proj = cam.getProjectionMatrix();
      const axis = Vector3.TransformCoordinates(AXIS, proj); // ось глаза в NDC
      const hx = Vector3.TransformCoordinates(OFF_X, proj);
      const hy = Vector3.TransformCoordinates(OFF_Y, proj);
      this.center.set(axis.x, axis.y);
      this.angScale.set(
        Math.max(1e-3, Math.abs(hx.x - axis.x)),
        Math.max(1e-3, Math.abs(hy.y - axis.y)),
      );
      this.mat.setVector2("center", this.center);
      this.mat.setVector2("angScale", this.angScale);
    });
  }

  /** Мгновенно затемнить на телепорт-прыжок — дальше само гаснет. */
  blink(): void {
    this.blinkAmt = 1;
  }

  /**
   * @param dt     шаг кадра, с
   * @param moving 0..1 — насколько активно игрок едет стиком (0 — стоит)
   * @param enabled false — виньетку отключили глобально: гасим и не рисуем
   */
  tick(dt: number, moving: number, enabled: boolean): void {
    const target = enabled ? Math.min(1, Math.max(0, moving)) : 0;
    if (target >= this.amt) {
      this.amt = target; // старт движения — виньетка встаёт сразу
    } else {
      this.amt += (target - this.amt) * Math.min(1, dt * 4.5); // остановка — плавно
    }
    if (this.amt < 0.004) this.amt = 0;

    if (this.blinkAmt > 0) this.blinkAmt = Math.max(0, this.blinkAmt - dt * 3.5);

    this.mat.setFloat("intensity", this.amt);
    this.mat.setFloat("blink", enabled ? this.blinkAmt : 0);
    this.quad.setEnabled(this.amt > 0 || this.blinkAmt > 0);
  }

  dispose(): void {
    this.camObs?.remove();
    this.quad.dispose();
    this.mat.dispose();
  }
}
