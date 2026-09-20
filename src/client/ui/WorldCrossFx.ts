import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Effect } from "@babylonjs/core/Materials/effect";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { Constants } from "@babylonjs/core/Engines/constants";

import { CROSS_GREEN, CROSS_ORANGE, CROSS_RED } from "./HealCrossFx";

export { CROSS_GREEN, CROSS_ORANGE, CROSS_RED };

/**
 * Мировые «всплывашки»: крестики (лечение / уровень / вампиризм), вспышка крита, «MISS» и числа урона.
 *
 * ВСЁ на GPU: один меш-квад с thin-инстансами и один шейдер на всё. Каждый эффект — запись в
 * буфере инстансов (позиция, время рождения, тип, цвет, параметры); всю анимацию (всплытие,
 * поп-масштаб, затухание, вращение, билборд) считает вершинный шейдер по общему времени `uNow`.
 * Из JS на кадр — одно число-uniform (+ дозапись буфера, только когда появился новый эффект);
 * ни мешей, ни материалов, ни текстур на каждый эффект (раньше: 48 мешей крестиков, 24 текстуры чисел
 * с перерисовкой canvas на каждое попадание, по 2 меша на крит).
 *
 * Глифы — один атлас 1024×512, нарисованный один раз: вспышка крита, кольцо крита, плюс-крестик,
 * «MISS» и цифры 0-9.
 */
const N = 256; // слотов инстансов на всю сцену
const LIFE = 1.5; // с полёта крестика
const SPREAD = 0.9; // м разлёта крестиков по горизонтали
const CRIT_LIFE = 0.5;
const MISS_LIFE = 0.7;
const DMG_LIFE = 0.9;
const MAX_DIGITS = 6;
const DIGIT_W = 20; // px ячейки цифры в атласе
const DIGIT_M = 0.1125; // ширина цифры в мире, м (1 px = 0.005625 м, как у прежнего текста)

const TYPE_FLASH = 0;
const TYPE_RING = 1;
const TYPE_CROSS = 2;
const TYPE_MISS = 3;
const TYPE_DIGIT = 4;

const NAME = "worldFx";

Effect.ShadersStore[`${NAME}VertexShader`] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 world0; // x, y, z, время рождения
attribute vec4 world1; // тип, p1, p2, жизнь
attribute vec4 world2; // r, g, b, множитель непрозрачности
attribute vec4 world3; // dx, dz (снос), —, —
uniform mat4 viewProjection;
#ifdef MULTIVIEW
uniform mat4 viewProjectionR;
#endif
uniform mat4 view;
uniform float uNow;
varying vec2 vUV;
varying vec4 vCol;
void degenerate() {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vCol = vec4(0.0);
  vUV = vec2(0.0);
}
void main() {
  float type = world1.x;
  float age = uNow - world0.w;
  float life = world1.w;
  float t = age / life;
  if (age < 0.0 || t > 1.0) { degenerate(); return; }
  vec3 pos = world0.xyz;
  vec2 quad = vec2(1.0);
  float alpha = 0.0;
  float rot = 0.0;
  vec3 tint = vec3(1.0);
  vec4 rect = vec4(0.0);
  bool full = false;
  bool shiftCam = false;
  float xoff = 0.0;
  if (type < 0.5) {
    // Вспышка крита: резко раздувается и гаснет за первую половину жизни.
    float f = min(1.0, age / (life * 0.55));
    if (f >= 1.0) { degenerate(); return; }
    float ease = 1.0 - (1.0 - f) * (1.0 - f);
    quad = vec2(1.5 + ease * 1.9);
    alpha = min(0.8, 1.6 * (1.0 - f));
    rot = world1.y + age * 0.6;
    rect = vec4(0.0, 0.0, 256.0, 256.0);
    full = true; shiftCam = true;
  } else if (type < 1.5) {
    // Кольцо крита: расходится с 18% жизни и тает.
    float u = (t - 0.18) / 0.82;
    if (u <= 0.0) { degenerate(); return; }
    quad = vec2(1.3 + u * 2.6);
    alpha = min(0.8, 1.5 * (1.0 - u));
    rot = world1.y;
    rect = vec4(256.0, 0.0, 256.0, 256.0);
    full = true; shiftCam = true;
  } else if (type < 2.5) {
    // Крестик: всплывает, сносится, «выпрыгивает» размером и тает.
    float pop = min(1.0, age / 0.12);
    pos += vec3(world3.x * t, 1.6 * t, world3.y * t);
    quad = vec2(0.34 * pop * (1.0 - t * 0.25));
    alpha = min(1.0, (1.0 - t) * 2.2) * 0.95 * world2.w;
    tint = world2.rgb;
    rect = vec4(512.0, 0.0, 64.0, 64.0);
  } else if (type < 3.5) {
    // «MISS».
    float pop = min(1.0, age / 0.1);
    pos.y += 0.8 * t;
    quad = vec2(1.1, 0.4125) * pop * (1.0 - t * 0.15);
    alpha = min(1.0, (1.0 - t) * 2.2);
    tint = vec3(0.92);
    rect = vec4(0.0, 256.0, 256.0, 96.0);
  } else {
    // Цифра числа урона: p1 — цифра, p2 — смещение по горизонтали (м).
    float pop = min(1.0, age / 0.1);
    float sc = pop * (1.0 - t * 0.1);
    pos += vec3(world3.x * t, 1.1 * t, world3.y * t);
    quad = vec2(${DIGIT_M}, 0.36) * sc;
    xoff = world1.z * sc;
    alpha = min(1.0, (1.0 - t) * 2.2);
    tint = vec3(1.0, 0.88, 0.47);
    rect = vec4(256.0 + world1.y * ${DIGIT_W}.0, 256.0, ${DIGIT_W}.0, 64.0);
  }
  // Камера из матрицы вида.
  vec3 tv = view[3].xyz;
  vec3 cam = -vec3(dot(view[0].xyz, tv), dot(view[1].xyz, tv), dot(view[2].xyz, tv));
  vec3 toC = pos - cam;
  float d = max(length(toC), 1e-3);
  float k = 1.0;
  if (shiftCam) {
    // Вспышка в центре моба: сдвиг вдоль луча к камере на его толщину (размер компенсируется).
    float shift = min(0.9, d * 0.8);
    pos -= (toC / d) * shift;
    k = (d - shift) / d;
  }
  vec3 right;
  vec3 up;
  if (full) {
    right = vec3(view[0][0], view[1][0], view[2][0]);
    up = vec3(view[0][1], view[1][1], view[2][1]);
  } else {
    vec3 h = normalize(vec3(-toC.x, 0.0, -toC.z) + vec3(1e-4, 0.0, 0.0));
    right = vec3(-h.z, 0.0, h.x);
    up = vec3(0.0, 1.0, 0.0);
  }
  vec2 l = vec2(position.x * quad.x * k, position.y * quad.y * k);
  float cr = cos(rot);
  float sr = sin(rot);
  l = vec2(l.x * cr - l.y * sr, l.x * sr + l.y * cr);
  vec3 p = pos + right * (xoff + l.x) + up * l.y;
  // uv в атласе: canvas сверху вниз, текстура перевёрнута по V.
  float cxp = rect.x + uv.x * rect.z;
  float cyp = rect.y + (1.0 - uv.y) * rect.w;
  vUV = vec2(cxp / 1024.0, 1.0 - cyp / 512.0);
  vCol = vec4(tint, alpha);
#ifdef MULTIVIEW
  if (gl_ViewID_OVR == 0u) { gl_Position = viewProjection * vec4(p, 1.0); } else { gl_Position = viewProjectionR * vec4(p, 1.0); }
#else
  gl_Position = viewProjection * vec4(p, 1.0);
#endif
}
`;

Effect.ShadersStore[`${NAME}FragmentShader`] = `
precision highp float;
varying vec2 vUV;
varying vec4 vCol;
uniform sampler2D tex;
void main() {
  vec4 c = texture2D(tex, vUV);
  float a = c.a * vCol.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(c.rgb * vCol.rgb, a);
}
`;

/**
 * Крестики, всплывающие ВОКРУГ объекта в мире (зелёные при лечении, оранжевые при уровне,
 * красные от вампиризма), красный крит, «MISS» и числа урона.
 *
 * Отличается от HealCrossFx тем, что тот рисует крестики перед глазами своего игрока, а этот —
 * над чужим телом, чтобы событие читалось со стороны.
 */
export class WorldCrossFx {
  private readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;
  private readonly tex: DynamicTexture;
  private readonly buf = new Float32Array(N * 16);
  private next = 0;
  private clock = 0;
  /** До какого момента (по clock) в буфере есть живые эффекты — после него меш выключен. */
  private activeUntil = 0;
  private dirty = false;
  /** MISS с «следованием» за источником: слот, колбэк и окно жизни. */
  private readonly follows: {
    slot: number;
    birth: number;
    follow: () => { x: number; y: number; z: number } | null;
  }[] = [];

  constructor(private readonly scene: Scene) {
    // Атлас глифов — один раз.
    this.tex = new DynamicTexture("worldFxAtlas", { width: 1024, height: 512 }, scene, false);
    this.tex.hasAlpha = true;
    const g = this.tex.getContext() as CanvasRenderingContext2D;
    g.clearRect(0, 0, 1024, 512);
    const rnd = (i: number): number => {
      const v = Math.sin(i * 127.1 + 311.7) * 43758.5453;
      return v - Math.floor(v);
    };
    {
      const c = g;
      c.save();
      c.translate(0, 0);
      const cx = 128;
      const cy = 128;
      // Широкий красный ореол.
      const halo = c.createRadialGradient(cx, cy, 8, cx, cy, 78);
      halo.addColorStop(0, "rgba(255,40,30,0.95)");
      halo.addColorStop(1, "rgba(255,20,20,0)");
      c.fillStyle = halo;
      c.beginPath();
      c.arc(cx, cy, 78, 0, Math.PI * 2);
      c.fill();
      // Острые лучи: 3 очень длинных, 4 средних, 6 коротких; тонкие, сужаются в иглу.
      const spikes: { len: number; w: number }[] = [
        { len: 126, w: 0.05 }, { len: 118, w: 0.045 }, { len: 124, w: 0.05 },
        { len: 96, w: 0.05 }, { len: 88, w: 0.055 }, { len: 100, w: 0.05 }, { len: 92, w: 0.055 },
        { len: 62, w: 0.06 }, { len: 58, w: 0.065 }, { len: 66, w: 0.06 }, { len: 54, w: 0.07 }, { len: 60, w: 0.065 }, { len: 56, w: 0.07 },
      ];
      spikes.forEach((sp, i) => {
        const ang = (i / spikes.length) * Math.PI * 2 + (rnd(i + 5) - 0.5) * 0.35;
        const len = sp.len * (0.92 + 0.16 * rnd(i + 20));
        const tx = cx + Math.cos(ang) * len;
        const ty = cy + Math.sin(ang) * len;
        const nx = -Math.sin(ang);
        const ny = Math.cos(ang);
        const half = 128 * sp.w * 0.5 * 1.7 + 3; // потолще — читаются издали
        const g = c.createLinearGradient(cx, cy, tx, ty);
        g.addColorStop(0, "rgba(255,190,175,1)");
        g.addColorStop(0.3, "rgba(255,30,20,1)");
        g.addColorStop(1, "rgba(230,0,0,1)");
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(tx, ty);
        c.lineTo(cx + nx * half, cy + ny * half);
        c.lineTo(cx - nx * half, cy - ny * half);
        c.closePath();
        c.fill();
      });
      // Обруч вокруг ядра (как светлое кольцо на референсе).
      c.strokeStyle = "rgba(255,60,50,1)";
      c.lineWidth = 7;
      c.beginPath();
      c.arc(cx, cy, 36, 0, Math.PI * 2);
      c.stroke();
      // Раскалённое ядро.
      const core = c.createRadialGradient(cx, cy, 0, cx, cy, 34);
      core.addColorStop(0, "rgba(255,225,215,1)");
      core.addColorStop(0.4, "rgba(255,70,55,1)");
      core.addColorStop(1, "rgba(240,10,10,1)");
      c.fillStyle = core;
      c.beginPath();
      c.arc(cx, cy, 34, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
    {
      const c = g;
      c.save();
      c.translate(256, 0);
      const cx = 128;
      const cy = 128;
      // Пунктирное кольцо.
      c.strokeStyle = "rgba(255,25,20,1)";
      c.lineWidth = 9;
      c.lineCap = "round";
      const dashes = 20;
      for (let i = 0; i < dashes; i++) {
        const a0 = (i / dashes) * Math.PI * 2;
        c.beginPath();
        c.arc(cx, cy, 98, a0, a0 + (Math.PI * 2) / dashes * 0.55);
        c.stroke();
      }
      // Искры-точки вокруг.
      c.fillStyle = "rgba(255,70,55,1)";
      for (let i = 0; i < 20; i++) {
        const ang = rnd(i + 60) * Math.PI * 2;
        const r = 62 + rnd(i + 80) * 62;
        c.beginPath();
        c.arc(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, 3.5 + rnd(i + 99) * 4, 0, Math.PI * 2);
        c.fill();
      }
      // Короткие радиальные штрихи за кольцом.
      c.strokeStyle = "rgba(255,40,30,1)";
      c.lineWidth = 5;
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2 + rnd(i + 130) * 0.5;
        const r0 = 106 + rnd(i + 140) * 6;
        c.beginPath();
        c.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
        c.lineTo(cx + Math.cos(ang) * (r0 + 14 + rnd(i + 150) * 10), cy + Math.sin(ang) * (r0 + 14 + rnd(i + 150) * 10));
        c.stroke();
      }
      c.restore();
    }
    // Плюс-крестик (белый, красится цветом инстанса): толщина 15 из 64 px.
    g.fillStyle = "white";
    g.fillRect(512, 24, 64, 16);
    g.fillRect(536, 0, 16, 64);
    // «MISS».
    g.font = "700 56px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "rgba(255,255,255,0.95)";
    g.fillText("MISS", 128, 256 + 52);
    // Цифры 0-9: ячейки DIGIT_W×64, шрифт как у прежних чисел урона.
    g.font = "700 34px system-ui, sans-serif";
    g.fillStyle = "rgba(255,255,255,0.97)";
    for (let d = 0; d < 10; d++) g.fillText(String(d), 256 + d * DIGIT_W + DIGIT_W / 2, 256 + 32);
    this.tex.update();

    this.mat = new ShaderMaterial(
      `${NAME}Mat`,
      scene,
      NAME,
      {
        attributes: ["position", "uv"], // world0..3 добавит Babylon для thin-инстансов
        uniforms: ["viewProjection", "view", "uNow"],
        samplers: ["tex"],
        needAlphaBlending: true,
      },
    );
    this.mat.setTexture("tex", this.tex);
    this.mat.setFloat("uNow", 0);
    this.mat.backFaceCulling = false;
    this.mat.alphaMode = Constants.ALPHA_COMBINE;
    this.mat.disableDepthWrite = true;

    this.mesh = MeshBuilder.CreatePlane("worldFx", { size: 1 }, scene);
    this.mesh.material = this.mat;
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.doNotSyncBoundingInfo = true;
    for (let i = 0; i < N; i++) this.buf[i * 16 + 3] = -1e9; // все слоты «давно умерли»
    this.mesh.thinInstanceSetBuffer("matrix", this.buf, 16, false);
    this.mesh.setEnabled(false);
  }

  private write(
    type: number,
    x: number,
    y: number,
    z: number,
    birth: number,
    life: number,
    p1 = 0,
    p2 = 0,
    rgb: Color3 | null = null,
    alpha = 1,
    dx = 0,
    dz = 0,
  ): number {
    const slot = this.next;
    this.next = (this.next + 1) % N;
    const o = slot * 16;
    const b = this.buf;
    b[o] = x;
    b[o + 1] = y;
    b[o + 2] = z;
    b[o + 3] = birth;
    b[o + 4] = type;
    b[o + 5] = p1;
    b[o + 6] = p2;
    b[o + 7] = life;
    b[o + 8] = rgb ? rgb.r : 1;
    b[o + 9] = rgb ? rgb.g : 1;
    b[o + 10] = rgb ? rgb.b : 1;
    b[o + 11] = alpha;
    b[o + 12] = dx;
    b[o + 13] = dz;
    this.dirty = true;
    this.activeUntil = Math.max(this.activeUntil, birth + life);
    return slot;
  }

  /** Красная вспышка критического попадания — на мобе, быстро гаснет (вспышка + расходящееся кольцо). */
  critMark(x: number, y: number, z: number): void {
    const now = this.clock;
    this.write(TYPE_FLASH, x, y, z, now, CRIT_LIFE, Math.random() * Math.PI * 2);
    this.write(TYPE_RING, x, y, z, now, CRIT_LIFE, Math.random() * Math.PI * 2);
  }

  /**
   * Уворот от атаки: «MISS» над источником удара. `delay` — сколько подождать перед показом
   * (чтобы текст всплыл ПОСЛЕ конца замаха). `follow` опрашивается каждый кадр, пока текст живёт —
   * источник (моб) мог убежать вперёд; null — источник исчез, держим последнюю точку.
   */
  missText(
    x: number,
    y: number,
    z: number,
    delay = 0,
    follow: (() => { x: number; y: number; z: number } | null) | null = null,
  ): void {
    const birth = this.clock + delay;
    const slot = this.write(TYPE_MISS, x, y, z, birth, MISS_LIFE);
    if (follow) this.follows.push({ slot, birth, follow });
  }

  /** Число нанесённого урона всплывает над мобом и гаснет: цифры — инстансы из атласа, без canvas на удар. */
  damageNumber(x: number, y: number, z: number, dmg: number): void {
    const s = String(Math.max(0, Math.round(dmg))).slice(0, MAX_DIGITS);
    const dx = (Math.random() - 0.5) * 0.5;
    const dz = (Math.random() - 0.5) * 0.5;
    for (let i = 0; i < s.length; i++) {
      this.write(TYPE_DIGIT, x, y, z, this.clock, DMG_LIFE, s.charCodeAt(i) - 48, (i - (s.length - 1) / 2) * DIGIT_M, null, 1, dx, dz);
    }
  }

  /**
   * Выпустить волну крестиков вокруг точки.
   * @param count сколько штук
   * @param color цвет (CROSS_GREEN / CROSS_ORANGE / CROSS_RED)
   * @param alpha множитель непрозрачности (вампиризм — полупрозрачные)
   */
  burst(x: number, y: number, z: number, count: number, color: Color3, alpha = 1): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = SPREAD * (0.35 + Math.random() * 0.65);
      this.write(
        TYPE_CROSS,
        x + Math.cos(a) * r,
        y + Math.random() * 0.3,
        z + Math.sin(a) * r,
        this.clock + i * 0.07, // волной, а не пачкой
        LIFE,
        0,
        0,
        color,
        alpha,
        Math.cos(a) * 0.18,
        Math.sin(a) * 0.18,
      );
    }
  }

  update(dt: number): void {
    this.clock += dt;
    // Часы — float32 в шейдере: раз в 5 минут сдвигаем начало отсчёта, чтобы не терять точность.
    if (this.clock > 300) {
      const shift = this.clock;
      this.clock = 0;
      this.activeUntil = Math.max(0, this.activeUntil - shift);
      for (let i = 0; i < N; i++) {
        const o = i * 16 + 3;
        this.buf[o] = this.buf[o] < -1e8 ? -1e9 : this.buf[o] - shift;
      }
      for (const f of this.follows) f.birth -= shift;
      this.dirty = true;
    }
    // MISS следует за источником: досаживаем точку, пока текст жив/ждёт (редкие случаи).
    if (this.follows.length) {
      for (let i = this.follows.length - 1; i >= 0; i--) {
        const f = this.follows[i];
        if (this.clock > f.birth + MISS_LIFE) {
          this.follows.splice(i, 1);
          continue;
        }
        const p = f.follow();
        if (p) {
          const o = f.slot * 16;
          this.buf[o] = p.x;
          this.buf[o + 1] = p.y;
          this.buf[o + 2] = p.z;
          this.dirty = true;
        } else {
          this.follows.splice(i, 1); // источник исчез — дальше точка неподвижна
        }
      }
    }
    if (this.dirty) {
      this.mesh.thinInstanceBufferUpdated("matrix");
      this.dirty = false;
    }
    const on = this.clock < this.activeUntil;
    if (this.mesh.isEnabled() !== on) this.mesh.setEnabled(on);
    if (on) this.mat.setFloat("uNow", this.clock);
  }

  dispose(): void {
    this.mesh.dispose();
    this.mat.dispose();
    this.tex.dispose();
    void this.scene;
  }
}
