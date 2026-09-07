export const FIRE_VERT = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform float uAmp;

void main() {
  vUv = uv;
  vec3 p = position;
  float top = uv.y;
  float n1 = sin(p.x * 9.0 + uTime * 4.4) * cos(p.z * 7.5 - uTime * 3.1);
  float n2 = cos(p.x * 5.2 - uTime * 5.6) * sin(p.z * 6.1 + uTime * 2.7);
  p.x += (n1 + n2 * 0.55) * uAmp * top;
  p.z += (n2 - n1 * 0.4) * uAmp * top * 0.85;
  p.y += abs(n1) * 0.07 * top;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

export const FIRE_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform float uWrap;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  v += a * noise(p); p *= 2.07; a *= 0.5;
  v += a * noise(p); p *= 2.03; a *= 0.5;
  v += a * noise(p); p *= 2.11; a *= 0.5;
  v += a * noise(p);
  return v;
}

void main() {
  vec2 uv = vUv;
  float n = fbm(vec2(uv.x * 3.4, uv.y * 2.15 - uTime * 1.15));
  float n2 = fbm(vec2(uv.x * 6.2 + 17.0, uv.y * 3.1 - uTime * 1.8));
  float warp = (n - 0.5) * 0.5;

  float mask;
  if (uWrap > 0.5) {
    float around = abs(fract(uv.x * 5.0 + warp * 0.8 + uTime * 0.12) - 0.5) * 2.0;
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

  vec3 col = mix(uColorA, uColorB, clamp(uv.y * 1.05 + (n - 0.5) * 0.2, 0.0, 1.0));
  col = mix(col, uColorC, pow(uv.y, 1.25));
  col *= 1.2 + (n2 - 0.35) * 0.75;

  gl_FragColor = vec4(col * 1.65, clamp(mask, 0.0, 1.0));
}
`;

export const SMOKE_VERT = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform float uSpeed;

void main() {
  vUv = uv;
  vec3 p = position;
  float t = uTime * uSpeed;
  p.x += sin(t + uv.y * 4.0) * 0.12 * uv.y;
  p.z += cos(t * 0.8 + uv.y * 3.0) * 0.1 * uv.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

export const SMOKE_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform float uOpacity;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  v += a * noise(p); p *= 2.1; a *= 0.5;
  v += a * noise(p); p *= 2.1; a *= 0.5;
  v += a * noise(p);
  return v;
}

void main() {
  vec2 uv = vUv;
  float n = fbm(vec2(uv.x * 2.4, uv.y * 1.6 - uTime * 0.18));
  float x = abs(uv.x - 0.5);
  float mask = (1.0 - smoothstep(0.12, 0.48, x + uv.y * 0.18));
  mask *= (1.0 - uv.y);
  mask *= smoothstep(0.0, 0.12, uv.y);
  mask *= 0.45 + 0.7 * n;
  vec3 col = mix(vec3(0.42, 0.4, 0.38), vec3(0.22, 0.22, 0.24), uv.y);
  gl_FragColor = vec4(col, mask * uOpacity);
}
`;

export const SKY_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const SKY_FRAG = /* glsl */ `
varying vec3 vWorld;
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uNadir;
void main() {
  float h = normalize(vWorld).y;
  vec3 col = mix(uHorizon, uTop, smoothstep(-0.02, 0.62, h));
  col = mix(uNadir, col, smoothstep(-0.45, 0.08, h));
  gl_FragColor = vec4(col, 1.0);
}
`;
