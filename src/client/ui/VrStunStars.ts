import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Effect } from "@babylonjs/core/Materials/effect";
import { Constants } from "@babylonjs/core/Engines/constants";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

/**
 * Оглушение в VR: пять жёлтых звёздочек кружат по эллипсу в верхней части обзора
 * («звёздочки перед глазами»). Один экранный квад в clip-space; звёзды считаются
 * процедурно во фрагментном шейдере (никаких текстур), за кадр меняется одно число —
 * время. Пока герой не оглушён, меш выключен.
 */
const NAME = "stunStars";

Effect.ShadersStore[`${NAME}VertexShader`] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
varying vec2 vUV;
void main() {
  vUV = uv;
  // Полоса вверху обзора: ширина ±0.55, высота ±0.16, центр на y=+0.62.
  gl_Position = vec4(position.x * 2.0 * 0.55, position.y * 2.0 * 0.16 + 0.62, -1.0, 1.0);
}
`;

Effect.ShadersStore[`${NAME}FragmentShader`] = `
precision highp float;
varying vec2 vUV;
uniform float t;
uniform float alpha;
// Пятиконечная звезда: радиус зависит от угла.
float star(vec2 p, float r, float rot) {
  float ang = atan(p.y, p.x) - rot;
  float k = 0.5 + 0.5 * cos(ang * 5.0);
  float rr = r * (0.42 + 0.58 * k);
  return 1.0 - smoothstep(rr * 0.85, rr, length(p));
}
void main() {
  vec2 c = (vUV - 0.5) * 2.0;
  const float A = 3.6; // ширина/высота полосы в пикселях — чтобы звёзды были круглыми
  vec3 col = vec3(0.0);
  float a = 0.0;
  for (int i = 0; i < 5; i++) {
    float ang = t * 3.4 + float(i) * 1.2566;
    vec2 pos = vec2(cos(ang) * 0.78, sin(ang) * 0.45);
    float front = 0.62 + 0.38 * sin(ang); // дальние звёзды мельче
    vec2 q = vec2(c.x - pos.x, (c.y - pos.y) / A * 1.0);
    float r = 0.15 * front;
    float body = star(q, r, t * 4.0 + float(i));
    float edge = star(q, r * 1.28, t * 4.0 + float(i));
    vec3 cc = mix(vec3(0.75, 0.35, 0.05), vec3(1.0, 0.9, 0.25), body);
    if (edge > 0.01) {
      col = mix(col, cc, edge);
      a = max(a, edge);
    }
  }
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a * alpha);
}
`;

export class VrStunStars {
  private readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;
  private t = 0;
  private on = false;

  constructor(scene: Scene) {
    this.mat = new ShaderMaterial(`${NAME}Mat`, scene, NAME, {
      attributes: ["position", "uv"],
      uniforms: ["t", "alpha"],
      needAlphaBlending: true,
    });
    this.mat.setFloat("t", 0);
    this.mat.setFloat("alpha", 0.95);
    this.mat.backFaceCulling = false;
    this.mat.alphaMode = Constants.ALPHA_COMBINE;
    this.mat.disableDepthWrite = true;
    this.mesh = MeshBuilder.CreatePlane(NAME, { width: 1, height: 1 }, scene);
    this.mesh.material = this.mat;
    this.mesh.isPickable = false;
    this.mesh.applyFog = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.renderingGroupId = 3;
    this.mesh.setEnabled(false);
  }

  setStunned(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.mesh.setEnabled(on);
  }

  tick(dt: number): void {
    if (!this.on) return;
    this.t += dt;
    this.mat.setFloat("t", this.t);
  }

  dispose(): void {
    this.mesh.dispose();
    this.mat.dispose();
  }
}
