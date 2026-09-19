import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Constants } from "@babylonjs/core/Engines/constants";

/**
 * Процедурный шейдер пламени костра лагеря — портирован из
 * grok-workspace/src/campfire, см. HubCampfire.ts. (Пробовали переиспользовать
 * его же для поджога мобов — попросили вернуть прежний эффект там, так что
 * этот модуль сейчас нужен только костру.)
 */
export const FIRE_VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 viewProjection;
#ifdef MULTIVIEW
uniform mat4 viewProjectionR; // правый глаз: Babylon кладёт сюда матрицу сам
#endif
uniform float uTime;
uniform float uAmp;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  float top = uv.y;
  float n1 = sin(p.x * 9.0 + uTime * 4.4) * cos(p.z * 7.5 - uTime * 3.1);
  float n2 = cos(p.x * 5.2 - uTime * 5.6) * sin(p.z * 6.1 + uTime * 2.7);
  p.x += (n1 + n2 * 0.55) * uAmp * top;
  p.z += (n2 - n1 * 0.4) * uAmp * top * 0.85;
  p.y += abs(n1) * 0.07 * top;
  vec4 wp = world * vec4(p, 1.0);
#ifdef MULTIVIEW
  if (gl_ViewID_OVR == 0u) { gl_Position = viewProjection * wp; } else { gl_Position = viewProjectionR * wp; }
#else
  gl_Position = viewProjection * wp;
#endif
}
`;

export const FIRE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uWrap;
uniform float uAlpha;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
  float a = hash(i), b = hash(i+vec2(1.0,0.0)), c = hash(i+vec2(0.0,1.0)), d = hash(i+vec2(1.0,1.0));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  v += a*noise(p); p *= 2.07; a *= 0.5;
  v += a*noise(p); p *= 2.03; a *= 0.5;
  v += a*noise(p); p *= 2.11; a *= 0.5;
  v += a*noise(p);
  return v;
}
void main(){
  vec2 uv = vUv;
  float n = fbm(vec2(uv.x*3.4, uv.y*2.15 - uTime*1.15));
  float n2 = fbm(vec2(uv.x*6.2 + 17.0, uv.y*3.1 - uTime*1.8));
  float warp = (n - 0.5) * 0.5;
  float mask;
  if (uWrap > 0.5) {
    float around = abs(fract(uv.x*5.0 + warp*0.8 + uTime*0.12) - 0.5) * 2.0;
    float tongue = 1.0 - smoothstep(0.12, 0.95, around + pow(uv.y, 0.55) * 0.85);
    mask = tongue * (1.0 - smoothstep(0.35, 1.0, uv.y));
    mask *= smoothstep(0.0, 0.05, uv.y);
    mask *= 0.55 + 0.6 * n2;
  } else {
    float x = uv.x - 0.5 + warp * uv.y;
    float width = mix(0.44, 0.045, pow(uv.y, 0.7));
    mask = 1.0 - smoothstep(width * 0.25, width, abs(x));
    mask *= 1.0 - smoothstep(0.45, 1.0, uv.y);
    mask *= smoothstep(0.0, 0.06, uv.y);
    mask *= 0.55 + 0.6 * n2;
  }
  vec3 col = mix(uColorA, uColorB, clamp(uv.y*1.05 + (n-0.5)*0.2, 0.0, 1.0));
  col = mix(col, uColorC, pow(uv.y, 1.25));
  col *= 1.2 + (n2 - 0.35) * 0.75;
  gl_FragColor = vec4(col * 1.65, clamp(mask, 0.0, 1.0) * uAlpha);
}
`;

export function makeFireMaterial(scene: Scene, name: string, wrap: boolean): ShaderMaterial {
  const m = new ShaderMaterial(
    name,
    scene,
    { vertexSource: FIRE_VERT, fragmentSource: FIRE_FRAG },
    {
      attributes: ["position", "uv"],
      uniforms: [
        "world", "viewProjection", "uTime", "uAmp", "uWrap", "uAlpha",
        "uColorA", "uColorB", "uColorC",
      ],
      needAlphaBlending: true,
    },
  );
  m.setFloat("uTime", 0);
  m.setFloat("uAmp", wrap ? 0.16 : 0.22);
  m.setFloat("uWrap", wrap ? 1 : 0);
  m.setFloat("uAlpha", 1);
  m.setColor3("uColorA", Color3.FromHexString("#ffdf9c"));
  m.setColor3("uColorB", Color3.FromHexString("#ff560c"));
  m.setColor3("uColorC", Color3.FromHexString("#5c0a00"));
  m.alphaMode = Constants.ALPHA_ADD;
  m.backFaceCulling = false;
  m.disableDepthWrite = true;
  return m;
}
