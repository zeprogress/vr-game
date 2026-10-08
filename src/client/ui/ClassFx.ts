import { FXC } from "./fxColors";
import { liftOnGround } from "./groundLift";
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
import { CAT_SHRINES } from "#shared/catacombs";

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
// Сами цвета — в общей палитре shared/look.ts (FX_RGB); здесь только имена по смыслу.
export const FX_ROLE = {
  attack: FXC.attack,
  heal: FXC.heal,
  defense: FXC.defense,
  buff: FXC.buff,
  other: FXC.other,
} as const;

export const FX_COLORS = {
  arcane: FXC.arcane, // волна молота, печать пламени (фиолет)
  fire: FXC.fire, // огонь: печать боевого мага, огненный дождь
  gold: FXC.gold, // копьё, сокрушение
  holy: FXC.holy, // печать поддержки
  shadow: FXC.shadowDark, // теневой рывок (тёмный след)
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
  liftOnGround(m); // круги на земле — подтянуты к камере, бугры их не срезают (groundLift.ts)
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
  sound: (at: { x: number; y: number; z: number }, kind: "bash" | "swing" | "thud" | "horn" | "volley" | "fire" | "holy" | "fanfare") => void;
  /** Клип/эмоция на модели героя `id` (если она есть). */
  emote: (id: string, emote: "roll" | "jump" | "cheer") => void;
  /** Центр щита в руке героя `id` (null — не видно/нет модели): разряд отражения бьёт от щита. */
  shieldPos?: (id: string) => { x: number; y: number; z: number } | null;
  /** Волна «Прилива» на арене рейд-босса (RaidArenaFx.tide). */
  raidTide?: () => void;
  /** Вспышка «Последнего вздоха» по всей арене (RaidArenaFx.flash). */
  raidFlash?: () => void;
}

/** Теневой рывок — серый дым. */
const SHADOW_GRAY = FXC.shadow;
/** Разряд отражения щита — красный (отличается от синих молний умений). */
const REFLECT_BOLT = new Color3(1, 0.16, 0.1);
const V_SUPPORT = 2;
const V_ASSASSIN = 3;
const V_BATTLEMAGE = 5;

/**
 * Эффекты событий умений (и старых, и «Классов 2.0»). true — событие
 * полностью обработано здесь; false — пусть отработает старый обработчик
 * (град: древки и звук остаются, мы только добавляем зону и искры).
 */
/** Цвет ауры замаха и вспышки удара по классу (порядок CLASS_IDS). */
const ULT_COLOR: readonly Color3[] = [
  new Color3(1, 0.14, 0.12), // воин — красный
  FXC.heal, // лучник — зелёный
  new Color3(0.25, 0.55, 1), // маг поддержки — синий
  new Color3(1, 0.9, 0.2), // ассасин — жёлтый
  new Color3(1, 0.55, 0.12), // копейщик — оранжевый
  new Color3(0.7, 0.3, 1), // боевой маг — фиолетовый
];

/** Эффекты удара ультимейта — каждый показывает ту механику, что на сервере (SKILL → ZoneRoom.applyUlt). */
function ultBlast(c: ClassActCtx, v: number, x: number, y: number, z: number, r: number): void {
  const vfx = c.vfx;
  const C = ULT_COLOR[v] ?? FXC.gold;
  // Круг виден на всю механику: от центра до радиуса, а не на полпути.
  const ringTo = (sec: number, rad: number, life: number, alpha: number): void =>
    c.fx.later(sec, () => vfx.decal(x, y + 0.05, z, rad, C, life, 0, alpha));
  const rndInRing = (): [number, number] => {
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * r;
    return [x + Math.cos(a) * d, z + Math.sin(a) * d];
  };
  switch (v) {
    case 0: // воин: удар по земле — кольцо до полного радиуса, осколки, оглушающий след на 5 с
      vfx.pillar(x, y, z, r * 0.1, 12, C, 1.0);
      for (let k = 1; k <= 4; k++) ringTo(k * 0.12, (r * k) / 4, 0.7, 0.9);
      for (let i = 0; i < 40; i++) {
        const [px, pz] = rndInRing();
        vfx.burst(px, y + 0.3, pz, C, { count: 6, speed: 9, life: 0.8, grav: 14, size: 0.3 });
      }
      vfx.decal(x, y + 0.05, z, r, C, 5, 0, 0.22);
      return;
    case 1: // лучник: три волны стрел по всему кругу, пригвождение — якорь-след на 5 с
      for (let w = 0; w < 3; w++) {
        c.fx.later(w * 1.0, () => {
          for (let i = 0; i < 16; i++) {
            const [px, pz] = rndInRing();
            vfx.bolt(px, y + 18, pz, px, y + 0.2, pz, C, 0.3, 0.1);
            vfx.burst(px, y + 0.2, pz, C, { count: 6, speed: 4, life: 0.5, grav: 6, size: 0.18 });
          }
          ringTo(0, r, 0.6, 0.7);
        });
      }
      vfx.decal(x, y + 0.05, z, r, C, 5, 0, 0.2);
      return;
    case 2: // маг поддержки: колонны света над союзниками (ultHeal), синий круг замедления на 6 с
      for (let k = 1; k <= 3; k++) ringTo((k - 1) * 0.3, (r * (4 - k)) / 3, 1.0, 0.8);
      vfx.decal(x, y + 0.05, z, r, C, 6, 0, 0.18);
      return;
    case 3: // ассасин: 16 ударов по кругу с шагом 0.15 с — жёлтая линия от героя и вспышка на каждом
      for (let i = 0; i < 16; i++) {
        c.fx.later(i * 0.15, () => {
          const [px, pz] = rndInRing();
          vfx.bolt(x, y + 1.2, z, px, y + 1, pz, C, 0.12, 0.05);
          vfx.burst(px, y + 1, pz, C, { count: 8, speed: 6, life: 0.4, grav: 6, size: 0.2 });
        });
      }
      ringTo(0, r, 0.5, 0.5);
      return;
    case 4: // копейщик: втягивание — потоки к центру по всему кругу (6 толчков за 0.6 с), след оглушения на 3 с
      for (let k = 0; k < 6; k++) {
        c.fx.later(0.1 * (k + 1), () => {
          for (let i = 0; i < 28; i++) {
            const [px, pz] = rndInRing();
            const dx = x - px;
            const dz = z - pz;
            const l = Math.hypot(dx, dz) || 1;
            vfx.burst(px, y + 0.4, pz, C, { count: 3, speed: 8, life: 0.5, grav: 0, size: 0.2, dir: [dx / l, 0.1, dz / l], spread: 0.25 });
          }
        });
      }
      ringTo(0, r, 0.5, 0.6);
      vfx.decal(x, y + 0.05, z, r, C, 3, 0, 0.18);
      return;
    case 5: // боевой маг: метеорит падает в центр, взрыв по всему кругу (тяжёлый удар), огонь на земле 10 с
      c.fx.later(0, () => vfx.bolt(x + 2, y + 30, z - 2, x, y + 0.5, z, FXC.fireCore, 0.35, 0.35));
      c.fx.later(0.2, () => vfx.burst(x + 0.6, y + 2, z - 0.6, FXC.fire, { count: 24, speed: 3, life: 0.5, grav: 0, size: 0.4 }));
      c.fx.later(0.35, () => {
        // Удар метеорита: ядро в центре, огненный столб, ударная волна по всему кругу, тяжёлый звук.
        vfx.burst(x, y + 0.5, z, FXC.fireCore, { count: 80, speed: 11, life: 0.6, grav: 4, size: 0.45 });
        vfx.pillar(x, y, z, r * 0.12, 6, FXC.fire, 0.9);
        for (let i = 0; i < 30; i++) {
          const [px, pz] = rndInRing();
          vfx.burst(px, y + 0.4, pz, C, { count: 4, speed: 6, life: 0.7, grav: 6, size: 0.3 });
          vfx.burst(px, y + 0.3, pz, FXC.fire, { count: 3, speed: 3, life: 0.8, grav: -2, size: 0.25 });
        }
        ringTo(0, r, 0.8, 0.9);
        ringTo(0.2, r * 0.6, 0.6, 0.6);
        c.sound({ x, y, z }, "thud");
      });
      // Огонь на земле 10 с: тлеющий круг и периодические языки пламени внутри круга.
      vfx.decal(x, y + 0.05, z, r, FXC.fire, 10, 0, 0.25);
      for (let t = 0.5; t < 10; t += 0.8) {
        c.fx.later(0.35 + t, () => {
          for (let i = 0; i < 3; i++) {
            const [px, pz] = rndInRing();
            vfx.burst(px, y + 0.3, pz, FXC.fire, { count: 4, speed: 1.2, life: 0.6, grav: -3, size: 0.22 });
          }
        });
      }
      return;
    default:
      vfx.decal(x, y, z, r, FXC.gold, 0.8, 0, 1);
  }
}

/** Замах ультимейта вокруг героя: руна под ногами, спираль частиц вверх, кольца на поясе, нарастающее свечение. */
function ultCastFx(c: ClassActCtx, v: number, x: number, y: number, z: number, r: number, d: number): void {
  const vfx = c.vfx;
  const C = ULT_COLOR[v] ?? FXC.gold;
  if (v === V_BATTLEMAGE) {
    // Боевой маг: искры сходятся по спирали к точке падения, метка цели сужается, перед ударом — гул огня.
    const steps = Math.max(1, Math.round(d * 8));
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * d;
      c.fx.later(t, () => {
        const rad = 4 * (1 - t / d) + 0.4;
        const ang = i * 0.9;
        vfx.burst(x + Math.cos(ang) * rad, y + 0.3 + (t / d) * 2.2, z + Math.sin(ang) * rad, FXC.fire, { count: 3, speed: 1.2, life: 0.45, grav: -2, size: 0.18 });
      });
    }
    for (let t = 0; t < d; t += 0.8) {
      c.fx.later(t, () => vfx.decal(x, y + 0.05, z, Math.max(1.5, r * (1 - (0.6 * t) / d)), FXC.fire, 0.7, 0, 0.6));
    }
    c.fx.later(Math.max(0, d - 1.5), () => c.sound({ x, y, z }, "fire"));
    return;
  }
  const rune = Math.max(1, Math.min(r, 3));
  for (let t = 0; t < d; t += 0.6) {
    c.fx.later(t, () => vfx.decal(x, y + 0.05, z, rune + ((t / 0.6) % 2) * 0.6, C, 0.7, 0, 0.8));
  }
  for (let i = 0; i < d * 10; i++) {
    c.fx.later(i * 0.1, () => {
      const ang = i * 0.5;
      const px = x + Math.cos(ang) * 1.1;
      const pz = z + Math.sin(ang) * 1.1;
      vfx.burst(px, y + 0.2 + (i * 0.1 / d) * 2.5, pz, C, { count: 3, speed: 1, life: 0.4, size: 0.15 });
    });
  }
  for (let k = 0; k < Math.floor(d / 0.8); k++) {
    c.fx.later(k * 0.8, () => vfx.decal(x, y + 1.2, z, Math.max(0.8, 2.6 - k * 0.3), C, 0.6, 0, 0.7));
  }
  c.fx.later(Math.max(0, d - 1), () => vfx.burst(x, y + 1, z, C, { count: 40, speed: 4, life: 0.8, size: 0.25 }));
}

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
    case "ultWarn":
      // Замах ультимейта: кольцо сходится к герою, искры, рог — видно и слышно всем в зоне.
      vfx.decal(x, y, z, r ?? 10, ATK, Math.max(0.2, d ?? 5), 0, 0.35);
      vfx.pillar(x, y, z, (r ?? 10) * 0.08, 5, ULT_COLOR[v ?? 0] ?? FXC.gold, Math.max(0.4, d ?? 5));
      ultCastFx(c, v ?? 0, x, y, z, r ?? 10, Math.max(0.4, d ?? 5));
      vfx.burst(x, y + 0.2, z, ATK, { count: 30, speed: 3, life: Math.max(0.4, d ?? 5), grav: 0, size: 0.2 });
      c.sound(at, "horn");
      return true;
    case "ultHeal":
      // Союзник вылечен ультой: столб света над ним.
      vfx.pillar(x, y, z, 0.5, 3.5, FXC.heal, 1.2);
      vfx.burst(x, y + 1, z, FXC.heal, { count: 14, speed: 3, life: 0.8, size: 0.2 });
      return true;
    case "ultSlow":
      // Моб замедлен ультой: синий след под ним.
      vfx.decal(x, y - 0.5, z, 1.2, new Color3(0.3, 0.6, 1), 6, 0, 0.6);
      return true;
    case "ultHit": {
      // Удар: кольцо, взрыв частиц и звук, свой у каждого класса (порядок CLASS_IDS).
      ultBlast(c, v ?? 0, x, y, z, r ?? 10);
      const snd = ["bash", "volley", "holy", "swing", "bash", "fire"][v ?? 0] as "bash" | "volley" | "holy" | "swing" | "fire";
      // Мощный удар у всех в зоне: фанфара поверх звука класса.
      c.sound(at, "fanfare");
      c.sound(at, snd);
      return true;
    }
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
      // Кувырок — отскоку лучника/копейщика; прыжки ассасина (кинжал) — без кувырков.
      if (v !== V_ASSASSIN) c.emote(id, "roll");
      c.sound(at, "swing");
      return true;
    case "leap":
      // Смертельный прыжок ассасина: серый след по дуге и всплеск в точке приземления.
      if (x2 !== undefined && z2 !== undefined) {
        c.fx.streak(x, y, z, x2, z2, SHADOW_GRAY, 0.5, 0.35);
        c.fx.later(d ?? 0.35, () => vfx.burst(x2, y + 0.6, z2, ATK, { count: 16, speed: 5, life: 0.4, grav: 8, size: 0.2 }));
      }
      c.emote(id, "jump");
      c.sound(at, "swing");
      return true;
    case "crushMark":
      vfx.decal(x, y, z, (r ?? 5) * 0.55, ATK, d ?? 0.6, 2, 0.9);
      c.emote(id, "jump");
      return true;
    // ---- мобы 40 ур. (в игре и у спектатора — одним кодом) ----
    case "leapMark":
      // Скалолом целится: круг-предупреждение под героем до самого приземления.
      vfx.decal(x, y, z, r ?? 3.2, ATK, d ?? 1.6, 2, 0.95);
      return true;
    case "leapHit":
      // Скалолом приземлился: вспышка по кругу, пыль и камни.
      vfx.decal(x, y, z, r ?? 3.2, ATK, 0.6, 0, 1.1);
      vfx.burst(x, y + 0.2, z, FXC.gold, { count: 26, speed: 8, life: 0.7, grav: 16, size: 0.26 });
      c.sound({ x, y, z }, "bash");
      return true;
    // ---- мобы 45 ур. ----
    case "burrowDive":
      // Землерой ныряет: земля взрывается пылью и комьями.
      vfx.burst(x, y + 0.3, z, FXC.gold, { count: 22, speed: 6, life: 0.8, grav: 14, size: 0.3 });
      vfx.decal(x, y, z, 2.4, FXC.gold, 0.8, 0, 0.7);
      c.sound(at, "bash");
      return true;
    case "burrowTrail":
      // Ползёт под землёй — бугорок пыли по следу.
      vfx.burst(x, y + 0.1, z, FXC.gold, { count: 5, speed: 2.2, life: 0.55, grav: 7, size: 0.22 });
      return true;
    case "burrowMark":
      // Земля трясётся под героем: круг до самого выныривания — беги из него.
      vfx.decal(x, y, z, r ?? 3.6, ATK, d ?? 1.1, 2, 0.95);
      vfx.burst(x, y + 0.1, z, FXC.gold, { count: 12, speed: 3, life: 0.6, grav: 9, size: 0.2 });
      return true;
    case "burrowHit":
      // Вынырнул: вспышка по кругу, камни и пыль вверх.
      vfx.decal(x, y, z, r ?? 3.6, ATK, 0.6, 0, 1.2);
      vfx.burst(x, y + 0.3, z, FXC.gold, { count: 34, speed: 10, life: 0.8, grav: 16, size: 0.3 });
      vfx.pillar(x, y, z, 1.6, 3.5, FXC.gold, 0.4);
      c.sound(at, "bash");
      return true;
    case "stormMark":
      // Грозовой дух метит героя: синий круг — выйди из него, не стой рядом с другими.
      vfx.decal(x, y, z, r ?? 2.4, FXC.lightning, d ?? 1.4, 2, 0.95);
      return true;
    case "stormHit":
      // Удар молнии с неба в круг.
      vfx.lightning(x + 0.5, y + 12, z, x, y + 0.15, z, y, 0.35);
      vfx.burst(x, y + 0.4, z, FXC.lightningCore, { count: 18, speed: 7, life: 0.4, grav: 6, size: 0.2 });
      c.sound(at, "bash");
      return true;
    case "stormJump":
      // Молния перескочила на соседа.
      if (x2 !== undefined && z2 !== undefined) vfx.lightning(x, y + 1.1, z, x2, y + 1.1, z2, null, 0.38);
      return true;
    case "pierceShot":
      // Пронзание: стрела прошла насквозь и летит ко второму мобу — светлый след и искры у него.
      if (x2 !== undefined && z2 !== undefined) {
        c.fx.streak(x, y + 1.1, z, x2, z2, FXC.gold, 0.25, 0.3);
        vfx.burst(x2, y + 1.1, z2, FXC.gold, { count: 10, speed: 4, life: 0.35, grav: 6, size: 0.15 });
      }
      return true;
    case "ninjaSmoke":
      // Теневой ниндзя: облако дыма (исчез / появилась копия).
      vfx.burst(x, y + 1, z, FXC.shadowDark, { count: 26, speed: 3.5, life: 0.9, grav: -1.5, size: 0.55 });
      vfx.burst(x, y + 0.6, z, SHADOW_GRAY, { count: 14, speed: 2, life: 0.7, grav: -1, size: 0.4 });
      c.sound(at, "swing");
      return true;
    case "parryOn":
      // Теневая стойка: тёмный круг под ниндзя на всё время стойки и тень вокруг — не бей, пережди.
      vfx.decal(x, y, z, r ?? 2.2, FXC.shadowDark, d ?? 1.6, 1, 0.9);
      vfx.burst(x, y + 1, z, FXC.shadowDark, { count: 18, speed: 2.5, life: 0.7, grav: -1, size: 0.4 });
      c.sound(at, "swing");
      return true;
    case "parryHit":
      // Отбил удар: вспышка клинков и контрудар.
      vfx.burst(x, y + 1.2, z, SHADOW_GRAY, { count: 14, speed: 7, life: 0.35, grav: 4, size: 0.18 });
      c.sound(at, "bash");
      return true;
    case "caltrops":
      // Колючки Шипохвоста на земле: зона на всё время, пока лежат.
      vfx.decal(x, y, z, r ?? 1.4, ATK, d ?? 6, 1, 0.55);
      vfx.burst(x, y + 0.1, z, FXC.other, { count: 8, speed: 2, life: 0.4, grav: 8, size: 0.12 });
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
    // ---- 🧪 тестовые умения ассасина ----
    case "plagueOn":
      // Клинки отравлены: зелёный столб на герое на всё время.
      vfx.pillar(x, y, z, 0.5, 2.2, FXC.poison, d ?? 8, { kind: "hero", id });
      vfx.burst(x, y + 1, z, FXC.poison, { count: 14, speed: 2, life: 0.6, grav: -2, size: 0.18 });
      c.sound(at, "swing");
      return true;
    case "catBoss": {
      // Катакомбы: страж встаёт — круг-телеграф сходится, тёмный столб, земля «дышит»; финал — крупнее.
      const fin = r === 1;
      const dur = d ?? 4;
      vfx.decal(x, y, z, fin ? 7 : 4.5, FXC.arcane, dur, 0, 0.9);
      vfx.decal(x, y, z, fin ? 9 : 6, FXC.shadowDark, dur + 1, 2, 1);
      vfx.pillar(x, y, z, fin ? 2.4 : 1.4, fin ? 14 : 9, FXC.shadowDark, dur + 0.6);
      for (let i = 0; i < Math.ceil(dur * 2); i++) {
        c.fx.later(i * 0.5, () => vfx.burst(x, y + 0.3, z, FXC.arcane, { count: fin ? 30 : 18, speed: fin ? 7 : 5, life: 0.8, grav: -3, size: 0.3 }));
      }
      c.fx.later(dur, () => {
        vfx.burst(x, y + 1, z, FXC.arcane, { count: fin ? 80 : 45, speed: fin ? 14 : 9, life: 1.1, grav: 4, size: 0.35 });
        vfx.decal(x, y, z, fin ? 10 : 6, FXC.arcane, 0.8, 0, 1.2);
        c.sound(at, "bash");
      });
      c.sound(at, "thud");
      return true;
    }
    case "catHazard": {
      // Опасность зала — телеграф: кольцо сходится к центру за d с (обвал — пыль со свода, пламя — угли, души — фиолет).
      const col = v === 1 ? FXC.fire : v === 2 ? FXC.arcane : v === 3 ? FXC.moon : FXC.gold;
      const life = d ?? 1.7;
      vfx.decal(x, y, z, r ?? 2.8, col, life, 2, 1);
      vfx.decal(x, y, z, r ?? 2.8, col, life, 1, 0.35);
      if (v === 0) {
        // Сыплется пыль и мелкие камешки сверху.
        for (let i = 0; i < 3; i++) c.fx.later(i * 0.45, () => vfx.burst(x, y + 9, z, SHADOW_GRAY, { count: 10, speed: 1, life: 1.2, grav: 9, size: 0.18 }));
      } else if (v === 1) {
        for (let i = 0; i < 3; i++) c.fx.later(i * 0.45, () => vfx.burst(x, y + 0.2, z, FXC.fire, { count: 8, speed: 1.5, life: 0.6, grav: -4, size: 0.18 }));
      } else if (v === 3) {
        // «Лунная слеза»: сверху мерцает лунная пыль — туда упадёт осколок.
        for (let i = 0; i < 3; i++) c.fx.later(i * 0.45, () => vfx.burst(x, y + 12, z, FXC.moon, { count: 10, speed: 0.8, life: 1.2, grav: 7, size: 0.2 }));
      } else {
        for (let i = 0; i < 3; i++) c.fx.later(i * 0.45, () => vfx.burst(x, y + 0.2, z, FXC.arcane, { count: 8, speed: 2, life: 0.7, grav: -5, size: 0.2 }));
      }
      return true;
    }
    case "catHazardHit": {
      const rr = r ?? 2.8;
      if (v === 0) {
        // Обвал: глыбы падают со свода, удар и облако пыли.
        for (let i = 0; i < 5; i++) {
          const a = Math.random() * Math.PI * 2;
          const d2 = Math.random() * rr * 0.8;
          const rx = x + Math.cos(a) * d2;
          const rz = z + Math.sin(a) * d2;
          c.fx.later(i * 0.05, () => vfx.burst(rx, y + 10, rz, SHADOW_GRAY, { count: 3, speed: 0.4, life: 0.5, grav: 40, size: 0.8 }));
        }
        c.fx.later(0.3, () => {
          vfx.decal(x, y, z, rr * 1.2, FXC.gold, 0.7, 0, 1);
          vfx.burst(x, y + 0.5, z, SHADOW_GRAY, { count: 40, speed: 6, life: 1.4, grav: 2, size: 0.7 });
          c.sound(at, "bash");
        });
      } else if (v === 1) {
        // Столб пламени из пола.
        vfx.pillar(x, y, z, rr * 0.7, 7, FXC.fire, 0.9);
        vfx.burst(x, y + 0.5, z, FXC.fire, { count: 50, speed: 7, life: 0.9, grav: -6, size: 0.45 });
        vfx.burst(x, y + 0.5, z, FXC.fireCore, { count: 25, speed: 4, life: 0.6, grav: -8, size: 0.35 });
        vfx.decal(x, y, z, rr, FXC.fire, 1.2, 0, 1);
        c.sound(at, "thud");
      } else if (v === 3) {
        // «Лунная слеза»: кристалл падает с неба, вспышка лунного света и осколки по кругу.
        vfx.burst(x, y + 14, z, FXC.moon, { count: 6, speed: 0.3, life: 0.35, grav: 60, size: 0.9 });
        c.fx.later(0.3, () => {
          vfx.pillar(x, y, z, rr * 0.45, 9, FXC.moon, 0.8);
          vfx.decal(x, y, z, rr * 1.15, FXC.moon, 0.9, 0, 1);
          vfx.burst(x, y + 0.6, z, FXC.moon, { count: 45, speed: 8, life: 0.9, grav: 6, size: 0.35 });
          c.sound(at, "bash");
        });
      } else {
        // Гейзер душ: фиолетовый столб и вой — отбрасывает.
        vfx.pillar(x, y, z, rr * 0.6, 11, FXC.arcane, 1.1);
        vfx.burst(x, y + 0.5, z, FXC.arcane, { count: 45, speed: 9, life: 1.1, grav: -10, size: 0.35 });
        vfx.decal(x, y, z, rr * 1.3, FXC.shadowDark, 1, 0, 1);
        c.sound(at, "thud");
      }
      return true;
    }
    case "raidTide": {
      // «Прилив»: волна света от центра арены по всему кругу.
      c.raidTide?.();
      vfx.burst(x, y + 1, z, FXC.moon, { count: 70, speed: 16, life: 1.1, grav: 0, size: 0.5 });
      vfx.pillar(x, y, z, 3, 14, FXC.moon, 1);
      c.sound(at, "bash");
      return true;
    }
    case "raidBreath": {
      // «Последний вздох»: вспышка по всей арене и ударная волна.
      c.raidFlash?.();
      vfx.burst(x, y + 0.8, z, FXC.fireCore, { count: 80, speed: 20, life: 0.8, grav: 0, size: 0.45 });
      vfx.decal(x, y, z, 28, FXC.fireCore, 0.6, 0, 1);
      c.sound(at, "bash");
      return true;
    }
    case "raidFall": {
      // Герой сорвался с арены в пустоту.
      vfx.burst(x, y + 0.5, z, FXC.arcane, { count: 30, speed: 3, life: 1, grav: 9, size: 0.4 });
      c.sound(at, "thud");
      return true;
    }
    case "catGate": {
      // Ворота: фиолетовый вихрь-портал — сейчас полезут мертвецы.
      const life = (d ?? 1.4) + 0.6;
      vfx.decal(x, y, z, 2.2, FXC.arcane, life, 1, 1);
      vfx.pillar(x, y, z, 1.3, 5, FXC.shadowDark, life);
      for (let i = 0; i < 5; i++) c.fx.later(i * 0.3, () => vfx.burst(x, y + 1.2, z, FXC.arcane, { count: 16, speed: 3, life: 0.8, grav: -2, size: 0.3 }));
      c.fx.later(d ?? 1.4, () => vfx.burst(x, y + 1, z, FXC.arcane, { count: 36, speed: 7, life: 0.9, grav: 3, size: 0.32 }));
      c.sound(at, "thud");
      return true;
    }
    case "catShield":
      // Щит Печати на Владыке: фиолетовый купол и кольцо, держатся ~6 с (сервер обновляет); разбит — взрыв осколков.
      if (d === 1 && mobId) {
        vfx.pillar(x, y, z, 4.2, 9, FXC.arcane, 6, { kind: "mob", id: mobId });
        vfx.decal(x, y, z, 5, FXC.arcane, 6, 1, 0.8, { kind: "mob", id: mobId, dy: 0.05 });
      } else {
        vfx.burst(x, y + 3, z, FXC.arcane, { count: 90, speed: 14, life: 1.2, grav: 6, size: 0.4 });
        vfx.decal(x, y, z, 9, FXC.arcane, 0.9, 0, 1.2);
        c.sound(at, "bash");
      }
      return true;
    case "catDust":
      // Свита стража рассыпается: тёмный прах вверх и фиолетовые искры.
      vfx.burst(x, y + 0.6, z, SHADOW_GRAY, { count: 26, speed: 3, life: 1.3, grav: -1.5, size: 0.5 + (r ?? 0.5) * 0.3 });
      vfx.burst(x, y + 0.6, z, FXC.arcane, { count: 14, speed: 4, life: 0.8, grav: -3, size: 0.2 });
      return true;
    case "catShrine": {
      // Святилище благословило героя: столб его цвета на герое, кольцо и искры вверх.
      const sh = CAT_SHRINES[v ?? 0] ?? CAT_SHRINES[0];
      const col = new Color3(...sh.color);
      vfx.pillar(x, y, z, 0.9, 6, col, 1.6, { kind: "hero", id });
      vfx.decal(x, y, z, 2.4, col, 1.4, 1, 1, { kind: "hero", id, dy: 0.05 });
      vfx.burst(x, y + 1, z, col, { count: 30, speed: 4, life: 1.1, grav: -4, size: 0.25 });
      return true;
    }
    case "catChest": {
      // Сундук стража: золотой столб и россыпь искр; суперприз — больше и дольше.
      const fin = r === 1;
      vfx.pillar(x, y, z, fin ? 2 : 1.2, fin ? 16 : 10, FXC.gold, fin ? 6 : 4);
      vfx.decal(x, y, z, fin ? 6 : 3.5, FXC.gold, fin ? 6 : 4, 1, 1);
      for (let i = 0; i < (fin ? 8 : 4); i++) {
        c.fx.later(i * 0.35, () => vfx.burst(x, y + 1.2, z, FXC.gold, { count: fin ? 40 : 24, speed: 8, life: 1, grav: 10, size: 0.25 }));
      }
      c.sound(at, "bash");
      return true;
    }
    case "bleedTick":
      // Кровотечение видно языками красного «огня» на самом мобе (Mob.ts, поле bleeding) — тут ничего.
      return true;
    case "poisonStack": {
      // Стак яда на мобе: зелёное кольцо под ним растёт со стаками (1..5), брызги яда.
      const n = r ?? 1;
      if (mobId) vfx.decal(x, y, z, 0.3 + n * 0.11, FXC.poison, d ?? 3, 1, 0.45 + n * 0.1, { kind: "mob", id: mobId, dy: 0.1 });
      vfx.burst(x, y + 0.8, z, FXC.poison, { count: 4 + n * 2, speed: 2.5, life: 0.45, grav: 3, size: 0.14 });
      return true;
    }
    case "plagueBurst":
      vfx.decal(x, y, z, r ?? 3, FXC.poison, 0.6, 0, 1.1);
      vfx.burst(x, y + 0.6, z, FXC.poison, { count: 26, speed: 6, life: 0.6, grav: 4, size: 0.24 });
      c.sound(at, "thud");
      return true;
    case "smoke":
      // Дымовая бомба: серый круг на всё время и клубы дыма.
      vfx.decal(x, y, z, r ?? 3.5, SHADOW_GRAY, d ?? 6, 1, 0.9);
      vfx.pillar(x, y, z, (r ?? 3.5) * 0.85, 2.2, SHADOW_GRAY, d ?? 6);
      for (let i = 0; i < Math.ceil((d ?? 6) * 2); i++) {
        c.fx.later(i * 0.5, () => vfx.burst(x, y + 0.6, z, SHADOW_GRAY, { count: 22, speed: 2.2, life: 1.6, grav: -0.5, size: 0.8 }));
      }
      c.sound(at, "thud");
      return true;
    case "soulSteal":
      if (x2 !== undefined && z2 !== undefined) {
        const toY = d ?? y;
        vfx.bolt(x, y, z, x2, toY, z2, FXC.arcane, 0.4, 0.07);
        vfx.burst(x, y, z, FXC.arcane, { count: 12, speed: 4, life: 0.4, grav: -2, size: 0.2 });
      }
      c.sound(at, "swing");
      return true;
    case "abyss":
      // В тени: тёмный круг ходит за героем, клубы серого дыма.
      vfx.decal(x, y, z, 1.2, FXC.shadowDark, d ?? 3, 1, 1, { kind: "hero", id, dy: 0 });
      vfx.pillar(x, y, z, 0.7, 2.4, FXC.shadowDark, d ?? 3, { kind: "hero", id });
      vfx.burst(x, y + 0.9, z, SHADOW_GRAY, { count: 22, speed: 3, life: 0.6, grav: -2, size: 0.35 });
      c.sound(at, "swing");
      return true;
    case "markOn":
      if (mobId) {
        vfx.decal(x, y, z, 1.1, ATK, d ?? 8, 2, 1, { kind: "mob", id: mobId, dy: 0.4 });
        vfx.pillar(x, y, z, 0.5, 9, ATK, 0.5, { kind: "mob", id: mobId });
      }
      return true;
    case "reflectHit": {
      // Щит отразил удар: вспышка на щите и красный разряд от щита в моба.
      const sp = (id && c.shieldPos?.(id)) || { x, y, z };
      vfx.burst(sp.x, sp.y, sp.z, FXC.reflect, { count: 12, speed: 4, life: 0.35, grav: 0, size: 0.18 });
      if (x2 !== undefined && z2 !== undefined) {
        vfx.bolt(sp.x, sp.y, sp.z, x2, d ?? y, z2, REFLECT_BOLT, 0.22, 0.05);
        vfx.burst(x2, d ?? y, z2, REFLECT_BOLT, { count: 8, speed: 3, life: 0.3, grav: 2, size: 0.16 });
      }
      return true;
    }
    case "lifeArrow":
      // Стрела жизни: золотисто-зелёная стрела в цель, обратно к стрелку — зелёная нить жизни и всплеск лечения.
      if (x2 !== undefined && z2 !== undefined) {
        const toY = d ?? y;
        vfx.bolt(x, y, z, x2, toY, z2, FXC.gold, 0.25, 0.1);
        vfx.burst(x2, toY, z2, FXC.gold, { count: 14, speed: 5, life: 0.4, grav: 2, size: 0.2 });
        c.fx.later(0.15, () => {
          vfx.bolt(x2, toY, z2, x, y, z, HEALC, 0.45, 0.07);
          vfx.burst(x, y - 0.6, z, HEALC, { count: 24, speed: 3, life: 0.9, grav: -4, size: 0.22 });
          vfx.decal(x, y - 1.6, z, 1.6, HEALC, 1, 1, 0.9, { kind: "hero", id, dy: 0.05 });
        });
        c.sound(at, "swing");
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
      // У боевого мага это отхил «Сокрушения бури» (Ауры исцеления у него нет) — без эмоции.
      if (v !== V_BATTLEMAGE) c.emote(id, "cheer");
      return true;
    }
    case "healHit":
      vfx.burst(x, y - 0.8, z, HEALC, { count: 12, speed: 1.6, life: 0.9, grav: -2.5, size: 0.2 });
      return false;
    default:
      return false;
  }
}
