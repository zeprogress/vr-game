import type { Scene } from "@babylonjs/core/scene";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Effect } from "@babylonjs/core/Materials/effect";
import { Constants } from "@babylonjs/core/Engines/constants";

/**
 * Материал языков пламени на горящем мобе. Билборд считается в вершинном шейдере, а центр
 * карточки сдвигается ВДОЛЬ ЛУЧА К КАМЕРЕ на толщину моба (`uShift`, размер при этом
 * компенсируется — на экране карточка остаётся на месте и того же размера). В результате
 * огонь проходит тест глубины против ТЕЛА самого моба и виден сквозь него, а землю и
 * предметы, стоящие между мобом и камерой, по-прежнему не просвечивает (они ближе сдвинутой
 * карточки).
 */
const NAME = "mobBurnFlame";

Effect.ShadersStore[`${NAME}VertexShader`] = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
#ifdef MULTIVIEW
uniform mat4 viewProjectionR;
#endif
uniform mat4 view;
uniform float uShift;
void main() {
  vec3 c = world[3].xyz;
  float sx = length(world[0].xyz);
  float sy = length(world[1].xyz);
  vec3 t = view[3].xyz;
  vec3 cam = -vec3(dot(view[0].xyz, t), dot(view[1].xyz, t), dot(view[2].xyz, t));
  vec3 toC = c - cam;
  float d = max(length(toC), 1e-3);
  float shift = min(uShift, d * 0.8);
  vec3 c2 = c - (toC / d) * shift;
  float k = (d - shift) / d; // держим угловой размер прежним
  vec3 h = normalize(vec3(-toC.x, 0.0, -toC.z) + vec3(1e-4, 0.0, 0.0));
  vec3 right = vec3(-h.z, 0.0, h.x);
  vec3 p = c2 + right * (position.x * sx * k) + vec3(0.0, position.y * sy * k, 0.0);
#ifdef MULTIVIEW
  if (gl_ViewID_OVR == 0u) { gl_Position = viewProjection * vec4(p, 1.0); } else { gl_Position = viewProjectionR * vec4(p, 1.0); }
#else
  gl_Position = viewProjection * vec4(p, 1.0);
#endif
}
`;

Effect.ShadersStore[`${NAME}FragmentShader`] = `
precision highp float;
uniform float uAlpha;
void main() { gl_FragColor = vec4(1.0, 0.5, 0.12, uAlpha); }
`;

export function makeBurnFlameMaterial(scene: Scene): ShaderMaterial {
  const m = new ShaderMaterial("mobBurnMat", scene, NAME, {
    attributes: ["position"],
    uniforms: ["world", "viewProjection", "view", "uShift", "uAlpha"],
    needAlphaBlending: true,
  });
  m.setFloat("uShift", 0.9);
  m.setFloat("uAlpha", 0);
  m.alphaMode = Constants.ALPHA_ADD;
  m.backFaceCulling = false;
  m.disableDepthWrite = true;
  return m;
}
