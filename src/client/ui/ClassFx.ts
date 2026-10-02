import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Constants } from "@babylonjs/core/Engines/constants";
import "@babylonjs/core/Meshes/Builders/discBuilder";
import "@babylonjs/core/Meshes/Builders/torusBuilder";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import type { SkillVfx } from "./SkillVfx";

/**
 * Эффекты «Классов 2.0» — дешёвые для шлема: всё из заранее созданных
 * пулов (никаких new/clone материалов в бою, никаких систем частиц), один
 * материал на элемент пула, анимация — масштаб и прозрачность из JS раз в
 * кадр. Общий на сцену: игра и спектатор.
 *
 *  - ring:   расходящееся кольцо по земле (волна молота, удар «Сокрушения»);
 *  - dome:   полупрозрачный купол-удар (приземление «Сокрушения»);
 *  - streak: полоса по земле (прокол копья, «Выпад», «Теневой рывок»);
 *  - seal:   печать на земле — диск со знаком, медленно вращается и дышит;
 *  - ghost:  тёмные «следы» рывка (обычное смешивание — тёмное видно).
 */

/**
 * Цвет эффекта умения — по смыслу (2026-10-02): атака — красный, лечение —
 * зелёный, защитный бафф — синий, атакующий бафф — оранжевый, прочее — жёлтый.
 */
export const FX_ROLE = {
  attack: new Color3(1, 0.22, 0.14),
  heal: new Color3(0.4, 1, 0.5),
  defense: new Color3(0.35, 0.6, 1),
  buff: new Color3(1, 0.55, 0.12),
  other: new Color3(1, 0.88, 0.3),
} as const;

export const FX_COLORS = {
  arcane: new Color3(0.72, 0.42, 1), // волна молота, печать пламени (фиолет)
  fire: new Color3(1, 0.42, 0.12), // огонь: печать боевого мага, огненный дождь
  gold: new Color3(1, 0.78, 0.3), // копьё, сокрушение
  holy: new Color3(0.55, 1, 0.75), // печать поддержки
  shadow: new Color3(0.35, 0.2, 0.6), // теневой рывок
} as const;

function addMat(scene: Scene, name: string, color: Color3): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.emissiveColor = color.clone();
  m.diffuseColor = new Color3(0, 0, 0);
  m.specularColor = new Color3(0, 0, 0);
  m.disableLighting = true;
  m.disableDepthWrite = true;
  m.alphaMode = Constants.ALPHA_ADD;
  m.backFaceCulling = false;
  m.zOffset = -4;
  return m;
}

/** Текстура знака печати (рисуется один раз на цвет). */
function sealTexture(scene: Scene, name: string): DynamicTexture {
  const S = 256;
  const t = new DynamicTexture(name, { width: S, height: S }, scene, true);
  t.hasAlpha = true;
  const c = t.getContext() as unknown as CanvasRenderingContext2D;
  c.clearRect(0, 0, S, S);
  c.strokeStyle = "#fff";
  c.lineCap = "round";
  const cx = S / 2;
  // Двойное кольцо.
  c.lineWidth = 7;
  c.beginPath();
  c.arc(cx, cx, S * 0.46, 0, Math.PI * 2);
  c.stroke();
  c.lineWidth = 3;
  c.beginPath();
  c.arc(cx, cx, S * 0.4, 0, Math.PI * 2);
  c.stroke();
  // Гексаграмма.
  c.lineWidth = 5;
  for (const off of [0, Math.PI / 3]) {
    c.beginPath();
    for (let i = 0; i <= 3; i++) {
      const a = off + (i * Math.PI * 2) / 3 - Math.PI / 2;
      const x = cx + Math.cos(a) * S * 0.38;
      const y = cx + Math.sin(a) * S * 0.38;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
  }
  // Руны по кругу — короткие засечки.
  c.lineWidth = 4;
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI * 2) / 12;
    c.beginPath();
    c.moveTo(cx + Math.cos(a) * S * 0.41, cx + Math.sin(a) * S * 0.41);
    c.lineTo(cx + Math.cos(a) * S * 0.455, cx + Math.sin(a) * S * 0.455);
    c.stroke();
  }
  t.update(true);
  return t;
}

interface Ring {
  mesh: Mesh;
  mat: StandardMaterial;
  age: number;
  life: number;
  r0: number;
  r1: number;
  alpha: number;
}
interface Streak {
  mesh: Mesh;
  mat: StandardMaterial;
  age: number;
  life: number;
  width: number;
}
interface Seal {
  disc: Mesh;
  mat: StandardMaterial;
  glow: Mesh;
  glowMat: StandardMaterial;
  age: number;
  life: number;
  radius: number;
}
interface Ghost {
  mesh: Mesh;
  mat: StandardMaterial;
  age: number;
  life: number;
}

export class ClassFx {
  private readonly rings: Ring[] = [];
  private readonly domes: Ring[] = [];
  private readonly streaks: Streak[] = [];
  private readonly seals: Seal[] = [];
  private readonly ghosts: Ghost[] = [];
  private nRing = 0;
  private nDome = 0;
  private nStreak = 0;
  private nSeal = 0;
  private nGhost = 0;
  private readonly sealTex: DynamicTexture;

  constructor(scene: Scene) {
    for (let i = 0; i < 10; i++) {
      const mesh = MeshBuilder.CreateTorus(`cfxRing${i}`, { diameter: 2, thickness: 0.05, tessellation: 40 }, scene);
      const mat = addMat(scene, `cfxRingMat${i}`, FX_COLORS.arcane);
      this.rings.push(this.prep({ mesh, mat, age: 1, life: 1, r0: 0, r1: 1, alpha: 1 }));
    }
    for (let i = 0; i < 4; i++) {
      const mesh = MeshBuilder.CreateSphere(`cfxDome${i}`, { diameter: 2, segments: 14, slice: 0.5 }, scene);
      const mat = addMat(scene, `cfxDomeMat${i}`, FX_COLORS.gold);
      this.domes.push(this.prep({ mesh, mat, age: 1, life: 1, r0: 0, r1: 1, alpha: 1 }));
    }
    for (let i = 0; i < 6; i++) {
      // Плоская полоса длиной 1 вдоль +Z от начала координат — тянем scaling.z.
      const mesh = MeshBuilder.CreatePlane(`cfxStreak${i}`, { width: 1, height: 1 }, scene);
      mesh.rotation.x = Math.PI / 2;
      mesh.bakeCurrentTransformIntoVertices();
      const mat = addMat(scene, `cfxStreakMat${i}`, FX_COLORS.gold);
      this.streaks.push(this.prep({ mesh, mat, age: 1, life: 1, width: 1 }));
    }
    this.sealTex = sealTexture(scene, "cfxSealTex");
    for (let i = 0; i < 4; i++) {
      const disc = MeshBuilder.CreateDisc(`cfxSeal${i}`, { radius: 1, tessellation: 40 }, scene);
      disc.rotation.x = Math.PI / 2;
      const mat = addMat(scene, `cfxSealMat${i}`, FX_COLORS.holy);
      // Знак — только маска прозрачности: цвет даёт emissiveColor (белая текстура его «выбеливала»).
      mat.opacityTexture = this.sealTex;
      disc.material = mat;
      const glow = MeshBuilder.CreateSphere(`cfxSealGlow${i}`, { diameter: 2, segments: 12, slice: 0.5 }, scene);
      const glowMat = addMat(scene, `cfxSealGlowMat${i}`, FX_COLORS.holy);
      glow.material = glowMat;
      for (const m of [disc, glow]) {
        m.isPickable = false;
        m.setEnabled(false);
      }
      this.seals.push({ disc, mat, glow, glowMat, age: 1, life: 1, radius: 1 });
    }
    for (let i = 0; i < 12; i++) {
      const mesh = MeshBuilder.CreateSphere(`cfxGhost${i}`, { diameter: 1, segments: 8 }, scene);
      const mat = new StandardMaterial(`cfxGhostMat${i}`, scene);
      mat.diffuseColor = new Color3(0, 0, 0);
      mat.specularColor = new Color3(0, 0, 0);
      mat.emissiveColor = FX_COLORS.shadow.scale(0.5);
      mat.disableLighting = true;
      mat.disableDepthWrite = true;
      mat.alpha = 0.5;
      this.ghosts.push(this.prep({ mesh, mat, age: 1, life: 1 }));
    }
  }

  private prep<T extends { mesh: Mesh; mat: StandardMaterial }>(o: T): T {
    o.mesh.material = o.mat;
    o.mesh.isPickable = false;
    o.mesh.setEnabled(false);
    return o;
  }

  /** Расходящееся кольцо по земле: от r0 до r1 за life с. */
  ring(x: number, y: number, z: number, r0: number, r1: number, color: Color3, life = 0.45, alpha = 0.9): void {
    const r = this.rings[this.nRing];
    this.nRing = (this.nRing + 1) % this.rings.length;
    r.mat.emissiveColor.copyFrom(color);
    r.mesh.position.set(x, y + 0.06, z);
    Object.assign(r, { age: 0, life, r0, r1, alpha });
    r.mesh.setEnabled(true);
  }

  /** Купол-удар (приземление): быстро раздувается и гаснет. */
  dome(x: number, y: number, z: number, radius: number, color: Color3, life = 0.5): void {
    const d = this.domes[this.nDome];
    this.nDome = (this.nDome + 1) % this.domes.length;
    d.mat.emissiveColor.copyFrom(color);
    d.mesh.position.set(x, y + 0.02, z);
    Object.assign(d, { age: 0, life, r0: radius * 0.2, r1: radius, alpha: 0.35 });
    d.mesh.setEnabled(true);
  }

  /** Полоса по земле от (x1,z1) до (x2,z2). */
  streak(x1: number, y: number, z1: number, x2: number, z2: number, color: Color3, width = 0.5, life = 0.35): void {
    const s = this.streaks[this.nStreak];
    this.nStreak = (this.nStreak + 1) % this.streaks.length;
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 0.1) return;
    s.mat.emissiveColor.copyFrom(color);
    s.mesh.position.set((x1 + x2) / 2, y + 0.08, (z1 + z2) / 2);
    s.mesh.rotation.y = Math.atan2(x2 - x1, z2 - z1);
    s.mesh.scaling.set(width, 1, len);
    Object.assign(s, { age: 0, life, width });
    s.mesh.setEnabled(true);
  }

  /** Печать на земле на `life` с: знак вращается, купол-свечение дышит. */
  seal(x: number, y: number, z: number, radius: number, color: Color3, life: number): void {
    const s = this.seals[this.nSeal];
    this.nSeal = (this.nSeal + 1) % this.seals.length;
    s.mat.emissiveColor.copyFrom(color);
    s.glowMat.emissiveColor.copyFrom(color.scale(0.5));
    s.disc.position.set(x, y + 0.07, z);
    s.glow.position.set(x, y + 0.02, z);
    s.disc.scaling.setAll(radius);
    Object.assign(s, { age: 0, life, radius });
    s.disc.setEnabled(true);
    s.glow.setEnabled(true);
  }

  /** Тёмные следы рывка: несколько сгустков вдоль пути, гаснут по очереди. */
  shadowTrail(x1: number, y: number, z1: number, x2: number, z2: number): void {
    const N = 5;
    for (let i = 0; i < N; i++) {
      const g = this.ghosts[this.nGhost];
      this.nGhost = (this.nGhost + 1) % this.ghosts.length;
      const t = i / (N - 1);
      g.mesh.position.set(x1 + (x2 - x1) * t, y + 0.9, z1 + (z2 - z1) * t);
      Object.assign(g, { age: -t * 0.12, life: 0.55 });
      g.mesh.scaling.setAll(0.01);
      g.mesh.setEnabled(true);
    }
  }

  /** GPU-эффекты (SkillVfx) — для отложенных и повторяющихся вспышек ниже. */
  vfx: SkillVfx | null = null;
  private readonly timers: { t: number; fn: () => void }[] = [];

  /** Запустить fn через `sec` секунд (тикает в update). */
  later(sec: number, fn: () => void): void {
    if (sec <= 0) fn();
    else this.timers.push({ t: sec, fn });
  }

  /** Грозовое поле: каждые 0.5 с молния с неба в случайную точку круга. */
  stormZone(x: number, y: number, z: number, r: number, dur: number): void {
    for (let t = 0.2; t < dur; t += 0.5) {
      this.later(t, () => {
        const a = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(Math.random()) * r * 0.9;
        const px = x + Math.cos(a) * rr;
        const pz = z + Math.sin(a) * rr;
        // Синяя заметная молния с вспышкой на земле (SkillVfx.lightning).
        this.vfx?.lightning(px + 0.6, y + 9, pz, px, y + 0.15, pz, y, 0.3);
      });
    }
  }

  /** Аура исцеления: каждые 0.5 с — зелёные искры всплывают в случайных точках круга вокруг героя. */
  healSparkles(id: string, r: number, dur: number): void {
    const C = FX_ROLE.heal;
    for (let t = 0; t < dur; t += 0.5) {
      this.later(t, () => {
        const at = this.vfx?.follow?.("hero", id);
        if (!at) return;
        const a = Math.random() * Math.PI * 2;
        const rr = Math.random() * r * 0.8;
        this.vfx?.burst(at.x + Math.cos(a) * rr, at.y + 0.2, at.z + Math.sin(a) * rr, C, { count: 10, speed: 1.2, life: 1.1, grav: -2.2, size: 0.2 });
      });
    }
  }

  /** Вихрь: каждые 0.4 с — кольцо искр вокруг героя `id`. */
  spinSparks(id: string, r: number, color: Color3, dur: number): void {
    for (let t = 0; t < dur; t += 0.4) {
      this.later(t, () => {
        const at = this.vfx?.follow?.("hero", id);
        if (!at) return;
        this.vfx?.burst(at.x, at.y + 1, at.z, color, { count: 16, speed: r * 2.4, life: 0.3, grav: 2, size: 0.18, dir: [1, 0, 0], spread: 1 });
      });
    }
  }

  update(dt: number): void {
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      tm.t -= dt;
      if (tm.t <= 0) {
        this.timers.splice(i, 1);
        tm.fn();
      }
    }
    for (const r of this.rings) {
      if (r.age >= r.life) continue;
      r.age += dt;
      if (r.age >= r.life) {
        r.mesh.setEnabled(false);
        continue;
      }
      const t = r.age / r.life;
      const rr = r.r0 + (r.r1 - r.r0) * Math.sqrt(t);
      r.mesh.scaling.set(rr, 1 + 2 * (1 - t), rr);
      r.mat.alpha = r.alpha * (1 - t);
    }
    for (const d of this.domes) {
      if (d.age >= d.life) continue;
      d.age += dt;
      if (d.age >= d.life) {
        d.mesh.setEnabled(false);
        continue;
      }
      const t = d.age / d.life;
      const rr = d.r0 + (d.r1 - d.r0) * Math.sqrt(t);
      d.mesh.scaling.set(rr, rr * 0.5, rr);
      d.mat.alpha = d.alpha * (1 - t);
    }
    for (const s of this.streaks) {
      if (s.age >= s.life) continue;
      s.age += dt;
      if (s.age >= s.life) {
        s.mesh.setEnabled(false);
        continue;
      }
      const t = s.age / s.life;
      s.mesh.scaling.x = s.width * (1 - 0.6 * t);
      s.mat.alpha = 0.85 * (1 - t);
    }
    for (const s of this.seals) {
      if (s.age >= s.life) continue;
      s.age += dt;
      if (s.age >= s.life) {
        s.disc.setEnabled(false);
        s.glow.setEnabled(false);
        continue;
      }
      // Появление 0.3 с, исчезание 0.6 с; знак вращается, свечение дышит.
      const fade = Math.min(1, s.age / 0.3) * Math.min(1, (s.life - s.age) / 0.6);
      s.disc.rotation.y += dt * 0.6;
      s.mat.alpha = 0.75 * fade;
      const breathe = 1 + 0.04 * Math.sin(s.age * 4);
      s.glow.scaling.set(s.radius * breathe, s.radius * 0.35 * breathe, s.radius * breathe);
      s.glowMat.alpha = 0.1 * fade;
    }
    for (const g of this.ghosts) {
      if (g.age >= g.life) continue;
      g.age += dt;
      if (g.age < 0) continue;
      if (g.age >= g.life) {
        g.mesh.setEnabled(false);
        continue;
      }
      const t = g.age / g.life;
      g.mesh.scaling.set(0.7 * (1 - 0.5 * t), 1.5 * (1 - 0.3 * t), 0.7 * (1 - 0.5 * t));
      g.mat.alpha = 0.55 * (1 - t);
    }
  }

  dispose(): void {
    for (const r of [...this.rings, ...this.domes]) {
      r.mat.dispose();
      r.mesh.dispose();
    }
    for (const s of this.streaks) {
      s.mat.dispose();
      s.mesh.dispose();
    }
    for (const s of this.seals) {
      s.mat.dispose();
      s.glowMat.dispose();
      s.disc.dispose();
      s.glow.dispose();
    }
    for (const g of this.ghosts) {
      g.mat.dispose();
      g.mesh.dispose();
    }
    this.sealTex.dispose();
  }
}

// ---------------------------------------------------------------- сетевые события

/** Что нужно обработчику событий умений (общий код игры и спектатора). */
export interface ClassActCtx {
  fx: ClassFx;
  vfx: SkillVfx;
  /** Звук в точке мира. */
  sound: (at: { x: number; y: number; z: number }, kind: "bash" | "swing" | "thud") => void;
  /** Клип/эмоция на модели героя `id` (если она есть). */
  emote: (id: string, emote: "roll" | "jump" | "cheer") => void;
}

/** Теневой рывок — серый дым. */
const SHADOW_GRAY = new Color3(0.62, 0.62, 0.66);
const V_SUPPORT = 2;
const V_BATTLEMAGE = 5;

/**
 * Эффекты событий умений (и старых, и «Классов 2.0»). true — событие
 * полностью обработано здесь; false — пусть отработает старый обработчик
 * (град: древки и звук остаются, мы только добавляем зону и искры).
 */
export function playClassAct(
  c: ClassActCtx,
  k: string,
  x: number,
  y: number,
  z: number,
  id: string,
  d?: number,
  x2?: number,
  z2?: number,
  v?: number,
  r?: number,
  mobId?: string,
): boolean {
  const at = { x, y, z };
  // Цвета по смыслу умения (FX_ROLE), не по классу.
  const ATK = FX_ROLE.attack;
  const HEALC = FX_ROLE.heal;
  const DEF = FX_ROLE.defense;
  const BUFF = FX_ROLE.buff;
  const OTHER = FX_ROLE.other;
  const vfx = c.vfx;
  switch (k) {
    case "stunBash":
      // Замах: тонкое кольцо сходится к герою — удар вот-вот.
      vfx.decal(x, y, z, r ?? 5, ATK, Math.max(0.2, d ?? 0.5), 0, 0.35);
      c.sound(at, "bash");
      return true;
    case "stunHit":
      vfx.decal(x, y, z, r ?? 5, ATK, 0.55, 0, 1);
      vfx.burst(x, y + 0.2, z, ATK, { count: 24, speed: 7, life: 0.55, grav: 14, size: 0.2 });
      return true;
    case "hammerWave":
      vfx.decal(x, y - 0.8, z, d ?? 2.5, ATK, 0.4, 0, 0.9);
      vfx.burst(x, y - 0.4, z, ATK, { count: 10, speed: 4, life: 0.35, grav: 6, size: 0.16 });
      return true;
    case "spearPierce":
      if (x2 !== undefined && z2 !== undefined) {
        // Обычный удар копья — малозаметная волна сектором вперёд на длину
        // и угол удара (сервер шлёт конец оси x2/z2 и полуугол r).
        const ddx = x2 - x;
        const ddz = z2 - z;
        vfx.cone(x, y - 1.5, z, Math.hypot(ddx, ddz), ddx, ddz, r ?? 0.6, ATK, 0.32, 0.75);
      }
      return true;
    case "shadowStep":
      if (x2 !== undefined && z2 !== undefined) {
        c.fx.shadowTrail(x, y, z, x2, z2);
        // Теневой рывок — серый (по просьбе), не по общей схеме.
        c.fx.streak(x, y, z, x2, z2, SHADOW_GRAY, 0.6, 0.4);
        vfx.burst(x, y + 0.9, z, SHADOW_GRAY, { count: 14, speed: 3, life: 0.5, grav: -2, size: 0.3 });
        vfx.burst(x2, y + 0.9, z2, SHADOW_GRAY, { count: 14, speed: 4, life: 0.45, grav: -1, size: 0.25 });
      }
      c.emote(id, "roll");
      c.sound(at, "swing");
      return true;
    case "crushMark":
      vfx.decal(x, y, z, (r ?? 5) * 0.55, ATK, d ?? 0.6, 2, 0.9);
      c.emote(id, "jump");
      return true;
    case "crushHit": {
      const cc = ATK;
      vfx.decal(x, y, z, r ?? 5, cc, 0.65, 0, 1.2);
      vfx.burst(x, y + 0.2, z, cc, { count: 28, speed: 9, life: 0.7, grav: 16, size: 0.26 });
      vfx.pillar(x, y, z, 1.4, 4, cc, 0.35);
      c.sound(at, "bash");
      return true;
    }
    case "seal": {
      // Грозовое поле — атака, Печать стража (воин) — защита, печать поддержки — лечение.
      const cc = v === V_BATTLEMAGE ? ATK : v === 0 ? DEF : v === V_SUPPORT ? HEALC : OTHER;
      vfx.decal(x, y, z, r ?? 5, cc, d ?? 6, 1, 1);
      if (v === V_BATTLEMAGE) c.fx.stormZone(x, y, z, r ?? 5, d ?? 6);
      else vfx.pillar(x, y, z, (r ?? 5) * 0.9, 2.5, cc, 0.8);
      c.emote(id, "cheer");
      c.sound(at, "thud");
      return true;
    }
    case "spearFlurry":
      // Само колющее мелькание — спирпирс на каждый выпад; тут только звук и вспышка старта.
      vfx.burst(x, y + 1.2, z, ATK, { count: 10, speed: 5, life: 0.3, grav: 0, size: 0.14 });
      c.sound(at, "swing");
      return true;
    case "whirl":
      vfx.decal(x, y, z, r ?? 3.2, ATK, d ?? 2, 1, 1, { kind: "hero", id, dy: 0 });
      c.fx.spinSparks(id, r ?? 3.2, ATK, d ?? 2);
      c.sound(at, "swing");
      return true;
    case "warcry": {
      // Клич / Клич сплочения / Благословение — атакующие баффы.
      const cc = BUFF;
      vfx.decal(x, y, z, r ?? 12, cc, 0.9, 0, 0.8);
      vfx.pillar(x, y, z, 0.9, 5, cc, 1.1, { kind: "hero", id });
      vfx.burst(x, y + 1, z, cc, { count: 24, speed: 3, life: 1.1, grav: -3, size: 0.24 });
      c.emote(id, "cheer");
      c.sound(at, "bash");
      return true;
    }
    case "markOn":
      if (mobId) {
        vfx.decal(x, y, z, 1.1, ATK, d ?? 8, 2, 1, { kind: "mob", id: mobId, dy: 0.4 });
        vfx.pillar(x, y, z, 0.5, 9, ATK, 0.5, { kind: "mob", id: mobId });
      }
      return true;
    case "chainHit":
      if (x2 !== undefined && z2 !== undefined) {
        const cc = v === V_SUPPORT ? HEALC : ATK;
        const toY = d ?? y;
        const delay = (r ?? 0) * 0.09;
        c.fx.later(delay, () => {
          if (v === V_SUPPORT) {
            // Лечащая цепь — тонкая зелёная.
            vfx.bolt(x, y, z, x2, toY, z2, cc, 0.32, 0.06);
            vfx.burst(x2, toY, z2, cc, { count: 10, speed: 4, life: 0.35, grav: -3, size: 0.18 });
          } else vfx.lightning(x, y, z, x2, toY, z2, null, 0.38);
        });
      }
      return true;
    case "fanKnives":
      if (x2 !== undefined && z2 !== undefined) {
        const n = d ?? 3;
        for (let i = 0; i < n; i++) {
          c.fx.later(0.1 + i * 0.18, () => {
            vfx.burst(x, y + 1.1, z, ATK, { count: 18, speed: 16, life: 0.5, grav: 1, size: 0.14, dir: [x2 - x, 0, z2 - z], spread: 0.32 });
            c.fx.streak(x, y, z, x2, z2, ATK, 2.5, 0.25);
          });
        }
        c.sound(at, "swing");
      }
      return true;
    case "arrowRain":
      // Зона града поверх древков (их рисует SkillFx в старом обработчике).
      vfx.decal(x, y, z, r ?? 6.5, ATK, (d ?? 0.9) + 3, 1, 0.8);
      return false;
    case "rainTick":
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2;
        const rr = Math.random() * 4;
        vfx.burst(x + Math.cos(a) * rr, y + 0.1, z + Math.sin(a) * rr, ATK, { count: 8, speed: 4, life: 0.35, grav: 12, size: 0.14 });
      }
      return false;
    case "healAura": {
      // Аура исцеления: зона с рунами и столб света ходят за героем, искры всплывают.
      const dur = d ?? 6;
      vfx.decal(x, y, z, r ?? 8, HEALC, dur, 1, 0.9, { kind: "hero", id, dy: 0 });
      vfx.pillar(x, y, z, 0.8, 3.2, HEALC, dur, { kind: "hero", id });
      c.fx.healSparkles(id, r ?? 8, dur);
      c.emote(id, "cheer");
      return true;
    }
    case "healHit":
      vfx.burst(x, y - 0.8, z, HEALC, { count: 12, speed: 1.6, life: 0.9, grav: -2.5, size: 0.2 });
      return false;
    default:
      return false;
  }
}
