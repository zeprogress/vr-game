import type { Scene } from "@babylonjs/core/scene";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { WebXRDefaultExperience } from "@babylonjs/core/XR/webXRDefaultExperience";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Effect } from "@babylonjs/core/Materials/effect";
import { Constants } from "@babylonjs/core/Engines/constants";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

const NAME = "comfortVignette";

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

// Чёрный тоннель прямоугольной формы (скруглённая рамка). На НОСОВОЙ стороне
// каждого глаза вырезан прямоугольный проём — затемнение получает форму
// буквы «П», лежащей набок: у левого глаза открытой стороной вправо (⊏),
// у правого — влево (⊐). Так носовые части двух картинок не складываются в
// полосу по центру и не оставляют просветов. Переход градиента — средний.
Effect.ShadersStore[`${NAME}FragmentShader`] = `
precision highp float;
varying vec2 vUV;
uniform float intensity; // 0..1 — сила тоннеля движения
uniform float blink;     // 0..1 — сплошное затемнение (телепорт-блинк)
uniform float eye;       // -1 левый, +1 правый, 0 моно
void main() {
  vec2 d = (vUV - vec2(0.5)) * 2.0;
  vec2 ad = abs(d);
  // Прямоугольная рамка со скруглёнными углами (суперэллипс). По горизонтали
  // вес больше — слева и справа полосы затемнения шире.
  float frame = pow(pow(ad.x * 1.45, 5.0) + pow(ad.y, 5.0), 0.2);
  float inner = mix(1.16, 0.44, clamp(intensity, 0.0, 1.0));
  float tunnel = smoothstep(inner, inner + 0.26, frame);

  // Прямоугольный проём на носовой стороне (nasal>0 — в сторону носа глаза).
  float nasal = -eye * d.x;
  float openH = smoothstep(0.05, 0.17, nasal);           // резковатый вход
  float openV = 1.0 - smoothstep(0.46, 0.60, ad.y);      // резковатый верх/низ проёма
  float cut = (eye == 0.0) ? 0.0 : openH * openV;

  float a = max(tunnel * (1.0 - cut), clamp(blink, 0.0, 1.0));
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

  constructor(
    scene: Scene,
    private readonly xr: WebXRDefaultExperience | null,
  ) {
    this.mat = new ShaderMaterial(`${NAME}Mat`, scene, NAME, {
      attributes: ["position", "uv"],
      uniforms: ["intensity", "blink", "eye"],
      needAlphaBlending: true,
    });
    this.mat.setFloat("intensity", 0);
    this.mat.setFloat("blink", 0);
    this.mat.setFloat("eye", 0);
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

    // Перед отрисовкой каждого глаза выставляем uniform eye под эту камеру.
    this.camObs = scene.onBeforeCameraRenderObservable.add((cam) => {
      this.mat.setFloat("eye", this.eyeOf(cam));
    });
  }

  private eyeOf(cam: Camera): number {
    const rig = this.xr?.baseExperience.camera.rigCameras;
    if (!rig || rig.length < 2) return 0;
    if (cam === rig[0]) return -1;
    if (cam === rig[1]) return 1;
    return 0;
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
