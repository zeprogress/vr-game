import { DRAGON } from "#shared/mobs";
import type { ActKind } from "#shared/net/messages";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { FXC } from "./fxColors";
import { FDECAL, FireFx, FLAME } from "./FireFx";
import type { IceGiantCtx } from "./IceGiantAct";

/**
 * События Владыки Бездны (DRAGON, сервер — server/rooms/dragonFight.ts) → огонь и звук. Одно место для игры,
 * спектатора и лаборатории (как playIceGiantAct): дыхание (телеграф конусом → струя из пасти → горит земля →
 * гарь), удар хвостом (дуга-телеграф по ходу хвоста → волна и пыль), метеоры (метки → камни с огненным следом
 * → взрыв, воронка горит), кольцо пламени (край разгорается → взрыв от центра), щит печати, ярость.
 * id — моб-дракон (пасть — по костям модели, если её видно).
 */

type P = { x: number; y: number; z: number };

/** Контекст тот же, что у Ледяного гиганта: сцена, звук, где герой/моб, кость модели, высота пола. */
export type DragonCtx = IceGiantCtx;

const KINDS = new Set<ActKind>([
  "dragonBreath", "dragonBreathGo", "dragonBurn", "dragonTail", "dragonTailHit", "dragonMeteorMark", "dragonMeteorFall",
  "dragonMeteorHit", "dragonRingMark", "dragonRing", "dragonShieldBreak", "dragonRage",
]);

const D = DRAGON;
const DEG = Math.PI / 180;
/** Пыль от хвоста и шагов: серо-бурая (дым шейдера — светлее обычного). */
export const DUST = new Color3(0.32, 0.27, 0.22);
/** Обломки камня метеора. */
const ROCK = new Color3(0.55, 0.22, 0.08);

/** Пачка метеоров одного заряда: звук заряда — один на пачку, падение и взрывы — не больше 4 голосов. */
const batch = new Map<string, { t: number; falls: number; hits: number }>();

/** Пасть дракона: шарнир челюсти + (шарнир челюсти − голова) — точка у кончика морды, идёт за клипом. */
export function lordMouth(bone: (name: string) => P | null): P | null {
  const j = bone("Jaw");
  const h = bone("Head");
  if (!j || !h) return null;
  return { x: 2 * j.x - h.x, y: 2 * j.y - h.y, z: 2 * j.z - h.z };
}

function dragonMouth(ctx: DragonCtx, id: string): P | null {
  return lordMouth((n) => ctx.bone(id, n));
}

/** Метры мира на метр модели: кость груди (Chest → Neck1) в модели — 0.3227 м (art/models/DragonBest.json). */
export function lordScale(bone: (name: string) => P | null): number {
  const a = bone("Chest");
  const b = bone("Neck1");
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) / 0.3227 : 0;
}

/**
 * Шаги Владыки по касанию стоп: кость лапы поднялась выше порога над своей опорой и опустилась — шаг. Один
 * разбор для любого клипа (шаг, бег, разворот, перестановка лап перед ударом хвостом, смерть).
 */
export class LordFeet {
  private readonly feet = ["FrontFoot.L", "FrontFoot.R", "HindFoot.L", "HindFoot.R"].map((bone) => ({ bone, up: false, base: Infinity }));

  /** groundY — пол под драконом, k — lordScale; onStep — стопа встала (мировая точка кости). */
  update(bone: (name: string) => P | null, groundY: number, k: number, dt: number, onStep: (p: P) => void): void {
    for (const f of this.feet) {
      const p = bone(f.bone);
      if (!p) continue;
      const h = p.y - groundY;
      f.base = Math.min(h, f.base + dt * 0.02 * k);
      if (!f.up && h > f.base + 0.035 * k) f.up = true;
      else if (f.up && h < f.base + 0.012 * k) {
        f.up = false;
        onStep(p);
      }
    }
  }

  reset(): void {
    for (const f of this.feet) f.up = false;
  }
}

/** Удар стопы: глухой шаг и пыль у лапы. */
export function lordStep(fire: FireFx, sfx: DragonCtx["sfx"], p: P, groundY: number, k: number, gain: number): void {
  sfx.at(p, () => sfx.lord("step", gain, 0.1));
  fire.flame(FLAME.puff, { x: p.x, y: groundY + 0.15 * k, z: p.z }, {
    r: 0.35 * k, half: 1.4, life: 0.9, size: 0.22 * k, rise: 0.12 * k, count: 8, heat: 0, smoke: DUST,
  });
}

export function playDragonAct(
  ctx: DragonCtx, k: ActKind, x: number, _y: number, z: number, id: string,
  d?: number, x2?: number, z2?: number, r?: number,
): boolean {
  if (!KINDS.has(k)) return false;
  const fire = FireFx.of(ctx.scene);
  const sfx = ctx.sfx;
  const y = ctx.ground(x, z);
  const at = { x, y, z };
  const yaw = x2 !== undefined && z2 !== undefined ? Math.atan2(x2 - x, z2 - z) : 0;
  // Вида модели нет — над точкой сервера (пасть у земли) на высоте головы.
  const mouthOr = (): P => dragonMouth(ctx, id) ?? { x, y: y + 6, z };
  switch (k) {
    case "dragonBreath": {
      // Конус на земле от пасти: заливка бежит к концу — дойдёт, пойдёт пламя. В пасти разгорается жар.
      const T = d ?? D.hitSec.breathStart;
      const half = r ?? D.breath.half;
      fire.decal(FDECAL.tele, { x, y, z, r: D.breath.len, yaw, a0: -half, a1: half }, T, 0.95);
      const m0 = mouthOr();
      sfx.at(m0, () => sfx.lord("breathIn"));
      for (let t = 0.45; t < T - 0.05; t += 0.18) {
        fire.after(t, () => {
          const m = mouthOr();
          fire.burst(m.x, m.y, m.z, FXC.fire, { count: 6, speed: 1.2, life: 0.4, grav: -1, size: 0.3 });
        });
      }
      fire.after(Math.max(0, T - 0.35), () => {
        const m = mouthOr();
        fire.flame(FLAME.puff, m, { r: 0.6, half: 0.9, life: 0.45, size: 0.7, rise: 0.3, count: 14, heat: 1 });
      });
      break;
    }
    case "dragonBreathGo": {
      // Струя: ядро (белое, быстрое) и клубы (крупные, к концу — дым); источник — пасть, идёт за головой.
      const S = d ?? D.hitSec.breathEnd - D.hitSec.breathStart;
      const ex = x2 ?? x;
      const ez = z2 ?? z;
      const end = { x: ex, y: ctx.ground(ex, ez) + 0.5, z: ez };
      const half = r ?? D.breath.half;
      const track = (): P => mouthOr();
      fire.flame(FLAME.stream, mouthOr(), { b: end, r: D.breath.len, half: half * 0.75, dur: S, life: 0.42, size: 0.75, rise: 0.4, count: 64, heat: 1, track });
      fire.flame(FLAME.stream, mouthOr(), { b: end, r: D.breath.len, half, dur: S, life: 0.7, size: 1.25, rise: 2.4, count: 56, heat: 0.82, track });
      fire.decal(FDECAL.wave, { x, y, z, r: D.breath.len, yaw, a0: -half, a1: half }, S + 0.25, 0.9);
      sfx.at(mouthOr(), () => sfx.lord("breath"));
      for (let t = 0.2; t < S + 0.1; t += 0.16) {
        fire.after(t, () => {
          const u = 0.55 + Math.random() * 0.45;
          const px = x + (ex - x) * u;
          const pz = z + (ez - z) * u;
          fire.burst(px, ctx.ground(px, pz) + 0.4, pz, FXC.fireCore, { count: 10, speed: 4, life: 0.6, size: 0.24, dir: [0, 1, 0], spread: 0.8 });
        });
      }
      break;
    }
    case "dragonBurn": {
      // Земля в конусе горит d с: прожилки лавы и языки пламени; гаснет — гарь, остывающие угольки и дым.
      const T = d ?? D.breath.burnSec;
      const half = r ?? D.breath.half;
      const shape = { x, y, z, r: D.breath.len, yaw, a0: -half, a1: half };
      const dir = { x: x2 ?? x, y, z: z2 ?? z };
      fire.decal(FDECAL.burn, shape, T + 0.6, 0.95);
      fire.decal(FDECAL.scorch, shape, T + 6, 0.85);
      fire.flame(FLAME.cone, at, { b: dir, r: D.breath.len, half, dur: T, life: 0.85, size: 1.25, rise: 1.7, count: 60, heat: 0.95 });
      fire.after(T - 0.4, () => fire.flame(FLAME.cone, at, { b: dir, r: D.breath.len, half, dur: 1.4, life: 1.6, size: 1.8, rise: 3.2, count: 28, heat: 0.12 }));
      sfx.at({ x: (x + (x2 ?? x)) / 2, y, z: (z + (z2 ?? z)) / 2 }, () => sfx.lord("burn", 0.8));
      break;
    }
    case "dragonTail": {
      // Дуга справа-спереди: корпус в клипе разворачивается влево, хвост заходит справа-сзади и хлещет к морде —
      // заливка бежит по ходу хвоста (от 110° к −15°), дойдёт до конца — хлёст.
      const T = d ?? D.hitSec.tail;
      const R = r ?? D.tail.rMax;
      fire.decal(FDECAL.tele, { x, y, z, r: R, yaw, a0: D.tail.from * DEG, a1: D.tail.to * DEG, r0: D.tail.rMin / R, sweep: -1 }, T, 0.9);
      sfx.at(at, () => sfx.lord("tail"));
      // След кончика хвоста в размахе: пыль и искры от пола.
      for (let t = T - 0.32; t < T + 0.2; t += 0.08) {
        fire.after(Math.max(0, t), () => {
          const tip = ctx.bone(id, "Tail8");
          if (!tip) return;
          const g = ctx.ground(tip.x, tip.z);
          if (tip.y - g < 1.5) fire.burst(tip.x, g + 0.3, tip.z, FXC.fire, { count: 5, speed: 2.5, life: 0.4, size: 0.2, dir: [0, 1, 0], spread: 0.9 });
          fire.flame(FLAME.puff, { x: tip.x, y: Math.max(g + 0.4, tip.y), z: tip.z }, { r: 0.8, half: 1.2, life: 0.7, size: 0.9, rise: 0.6, count: 6, heat: 0, smoke: DUST });
        });
      }
      break;
    }
    case "dragonTailHit": {
      // Хлёст: волна по дуге и вал пыли по ней, камешки и искры там, где прошёл хвост.
      const R = r ?? D.tail.rMax;
      const shape = { x, y, z, r: R, yaw, a0: D.tail.from * DEG, a1: D.tail.to * DEG, r0: D.tail.rMin / R, sweep: -1 as const };
      fire.decal(FDECAL.wave, shape, 0.45, 1);
      const rr = (D.tail.rMin + R) / 2;
      for (let i = 0; i < 4; i++) {
        const a = yaw + (D.tail.to - ((i + 0.5) / 4) * (D.tail.to - D.tail.from)) * DEG; // по ходу хвоста
        const px = x + Math.sin(a) * rr;
        const pz = z + Math.cos(a) * rr;
        const py = ctx.ground(px, pz);
        fire.after(i * 0.05, () => {
          fire.flame(FLAME.puff, { x: px, y: py + 0.4, z: pz }, { b: { x: px, y: py + 3, z: pz }, r: 2.2, half: 1.1, life: 1.2, size: 1.6, rise: 1.2, count: 14, heat: 0, smoke: DUST });
          fire.burst(px, py + 0.5, pz, ROCK, { count: 12, speed: 6, life: 0.8, size: 0.22, dir: [Math.sin(a - Math.PI / 2), 0.8, Math.cos(a - Math.PI / 2)], spread: 0.6 });
        });
      }
      const mid = yaw + ((D.tail.from + D.tail.to) / 2) * DEG;
      sfx.at({ x: x + Math.sin(mid) * rr, y, z: z + Math.cos(mid) * rr }, () => sfx.lord("tailHit"));
      break;
    }
    case "dragonMeteorMark": {
      // Метка: круг, заливка к краю — к удару метеора. Заряд — один на пачку: рёв к своду и искры из пасти.
      const T = d ?? D.hitSec.charge + D.meteor.fall;
      fire.decal(FDECAL.tele, { x, y, z, r: r ?? D.meteor.r }, T, 0.95);
      const b = batch.get(id);
      if (b && fire.clock - b.t < 0.25) break;
      batch.set(id, { t: fire.clock, falls: 0, hits: 0 });
      const boss = ctx.follow("mob", id);
      if (boss) sfx.at(boss, () => sfx.lord("charge"));
      for (let t = 0.5; t < D.hitSec.charge; t += 0.15) {
        fire.after(t, () => {
          const m = dragonMouth(ctx, id);
          if (m) fire.burst(m.x, m.y, m.z, FXC.fire, { count: 8, speed: 3, life: 0.6, grav: -4, size: 0.28, dir: [0, 1, 0], spread: 0.5 });
        });
      }
      fire.after(D.hitSec.charge, () => {
        const m = dragonMouth(ctx, id);
        if (!m) return;
        fire.flame(FLAME.puff, m, { b: { x: m.x, y: m.y + 6, z: m.z }, r: 4, half: 0.35, life: 0.6, size: 1.2, rise: 1, count: 20, heat: 1 });
        fire.burst(m.x, m.y + 1, m.z, FXC.fireCore, { count: 26, speed: 14, life: 0.9, grav: 2, size: 0.35, dir: [0, 1, 0], spread: 0.25 });
      });
      break;
    }
    case "dragonMeteorFall": {
      // Камень падает со свода по наклонной (d с), за ним — огненный след и дым; свист — не больше 4 голосов.
      const T = d ?? D.meteor.fall;
      const a = Math.random() * Math.PI * 2;
      const from = { x: x + Math.cos(a) * 5, y: y + 18, z: z + Math.sin(a) * 5 };
      const to = { x, y: y + 0.6, z };
      fire.rock(from, to, T, 0.85);
      fire.flame(FLAME.trail, to, { b: from, dur: T, life: 0.32, size: 1.1, rise: 0.4, count: 44, heat: 1 });
      fire.flame(FLAME.trail, to, { b: from, dur: T, life: 0.9, size: 1.4, rise: 1.5, count: 20, heat: 0.15 });
      const b = batch.get(id);
      if (!b || b.falls++ < 4) sfx.at(at, () => sfx.lord("meteorFall", 0.7, 0.08));
      break;
    }
    case "dragonMeteorHit": {
      // Удар: вспышка и огненный клуб, волна, воронка горит и остаётся гарью; обломки и угольки.
      const R = r ?? D.meteor.r;
      fire.decal(FDECAL.wave, { x, y, z, r: R * 1.4 }, 0.45, 1);
      fire.decal(FDECAL.burn, { x, y, z, r: R * 0.85 }, 2.4, 0.9);
      fire.decal(FDECAL.scorch, { x, y, z, r: R }, 8, 0.8);
      fire.flame(FLAME.puff, { x, y: y + 0.5, z }, { b: { x, y: y + 5, z }, r: 2.6, half: 0.9, life: 0.6, size: 1.5, rise: 1.2, count: 26, heat: 1 });
      fire.flame(FLAME.puff, { x, y: y + 0.8, z }, { b: { x, y: y + 5, z }, r: 3, half: 1.1, life: 1.7, size: 2.2, rise: 3, count: 14, heat: 0.12 });
      fire.burst(x, y + 0.6, z, ROCK, { count: 18, speed: 8, life: 1, grav: 14, size: 0.3, dir: [0, 1, 0], spread: 0.7 });
      fire.burst(x, y + 0.6, z, FXC.fireCore, { count: 22, speed: 6, life: 0.8, grav: 4, size: 0.24 });
      const b = batch.get(id);
      if (!b || b.hits++ < 4) sfx.at(at, () => sfx.lord("meteorHit", 0.8, 0.07));
      break;
    }
    case "dragonRingMark": {
      // Кольцо пламени: круг вокруг дракона, заливка к краю, по краю разгорается огонь.
      const T = d ?? D.ring.telegraph;
      const R = r ?? D.ring.r;
      fire.decal(FDECAL.tele, { x, y, z, r: R }, T, 0.95);
      fire.flame(FLAME.disc, at, { r: R, inner: 0.93, dur: T, life: 0.55, size: 0.85, rise: 1.1, count: 52, heat: 0.85 });
      sfx.at(at, () => sfx.lord("ringMark"));
      break;
    }
    case "dragonRing": {
      // Удар крыльями: от центра бежит огненный фронт, встают столбы огня, по краю — искры; земля горит и чернеет.
      const R = r ?? D.ring.r;
      fire.flame(FLAME.blast, at, { r: R, life: 0.75, size: 1.7, rise: 4.2, count: 64, heat: 1 });
      fire.flame(FLAME.blast, at, { r: R, life: 1.4, size: 2.4, rise: 5, count: 26, heat: 0.15 });
      fire.decal(FDECAL.wave, { x, y, z, r: R * 1.05 }, 0.5, 1);
      fire.decal(FDECAL.burn, { x, y, z, r: R }, 1.4, 0.75);
      fire.decal(FDECAL.scorch, { x, y, z, r: R }, 6, 0.6);
      const a0 = Math.random() * Math.PI;
      for (let i = 0; i < 6; i++) {
        const a = a0 + (i / 6) * Math.PI * 2;
        const cx = Math.cos(a);
        const cz = Math.sin(a);
        fire.after(0.3, () => fire.burst(x + cx * R * 0.95, y + 0.6, z + cz * R * 0.95, FXC.fireCore, { count: 14, speed: 7, life: 0.7, size: 0.26, dir: [cx, 1.2, cz], spread: 0.45 }));
      }
      sfx.at(at, () => sfx.lord("ring"));
      break;
    }
    case "dragonShieldBreak": {
      // Печать разбита: дракон взревел от боли — клуб огня из пасти, искры печати и огня.
      const m = mouthOr();
      fire.flame(FLAME.puff, m, { r: 2.5, half: 1.2, life: 0.7, size: 1.3, rise: 1.5, count: 24, heat: 1 });
      fire.burst(x, y + 3, z, FXC.arcane, { count: 28, speed: 10, life: 1.1, grav: 6, size: 0.36 });
      fire.burst(m.x, m.y, m.z, FXC.fire, { count: 20, speed: 6, life: 0.8, grav: 3, size: 0.3 });
      sfx.at(at, () => sfx.lord("shield"));
      break;
    }
    case "dragonRage": {
      // Ярость: рёв к своду (клип заряда), на пике — огненный выдох вверх и волна жара от лап.
      const C = d ?? D.clipSec.charge;
      const peak = D.hitSec.charge;
      sfx.at(at, () => sfx.lord("rage"));
      for (let t = 0.4; t < peak; t += 0.15) {
        fire.after(t, () => {
          const m = dragonMouth(ctx, id);
          if (m) fire.burst(m.x, m.y, m.z, FXC.fire, { count: 8, speed: 3, life: 0.6, grav: -4, size: 0.3, dir: [0, 1, 0], spread: 0.6 });
        });
      }
      fire.after(peak, () => {
        const m = mouthOr();
        fire.flame(FLAME.puff, m, { b: { x: m.x, y: m.y + 8, z: m.z }, r: 6, half: 0.4, life: 0.8, size: 1.6, rise: 1.5, count: 30, heat: 1 });
        fire.flame(FLAME.blast, at, { r: 7, life: 0.7, size: 1.4, rise: 3, count: 40, heat: 0.95 });
        fire.decal(FDECAL.wave, { x, y, z, r: 14 }, 0.8, 1);
        fire.burst(x, y + 1, z, FXC.fireCore, { count: 28, speed: 10, life: 1.1, grav: 3, size: 0.32 });
      });
      fire.after(C, () => fire.decal(FDECAL.scorch, { x, y, z, r: 7 }, 5, 0.6));
      break;
    }
  }
  return true;
}
