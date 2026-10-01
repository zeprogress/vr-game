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

  update(dt: number): void {
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
  /** Звук в точке мира. */
  sound: (at: { x: number; y: number; z: number }, kind: "bash" | "swing" | "thud") => void;
  /** Клип/эмоция на модели героя `id` (если она есть). */
  emote: (id: string, emote: "roll" | "jump" | "cheer") => void;
}

/** Индекс боевого мага в CLASS_IDS (0 воин, 1 лучник, 2 поддержка, 3 ассасин, 4 копейщик, 5 боевой маг). */
const V_BATTLEMAGE = 5;

/**
 * Эффекты событий «Классов 2.0» (молот, копьё, новые умения). true — событие
 * наше и обработано. y — как прислал сервер (у умений — уровень ног).
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
): boolean {
  const at = { x, y, z };
  switch (k) {
    case "hammerWave":
      c.fx.ring(x, y - 0.6, z, 0.3, d ?? 2.5, FX_COLORS.arcane, 0.4, 0.9);
      return true;
    case "spearPierce":
      if (x2 !== undefined && z2 !== undefined) c.fx.streak(x, y - 1.5, z, x2, z2, FX_COLORS.gold, 0.35, 0.3);
      return true;
    case "shadowStep":
      if (x2 !== undefined && z2 !== undefined) {
        c.fx.shadowTrail(x, y, z, x2, z2);
        c.fx.streak(x, y, z, x2, z2, FX_COLORS.shadow, 0.6, 0.4);
      }
      c.emote(id, "roll");
      c.sound(at, "swing");
      return true;
    case "crushMark":
      // Прыжок: на земле в точке удара сжимается кольцо-телеграф.
      c.fx.ring(x, y, z, r ?? 5, (r ?? 5) * 0.75, v === V_BATTLEMAGE ? FX_COLORS.arcane : FX_COLORS.gold, d ?? 0.6, 0.5);
      c.emote(id, "jump");
      return true;
    case "crushHit": {
      const col = v === V_BATTLEMAGE ? FX_COLORS.arcane : FX_COLORS.gold;
      c.fx.dome(x, y, z, r ?? 5, col, 0.5);
      c.fx.ring(x, y, z, 0.5, r ?? 5, col, 0.5, 1);
      c.sound(at, "bash");
      return true;
    }
    case "seal":
      c.fx.seal(x, y, z, r ?? 5, v === V_BATTLEMAGE ? FX_COLORS.fire : FX_COLORS.holy, d ?? 6);
      c.emote(id, "cheer");
      c.sound(at, "thud");
      return true;
    default:
      return false;
  }
}
