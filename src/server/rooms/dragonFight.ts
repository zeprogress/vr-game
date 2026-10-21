/**
 * Владыка Бездны (дракон катакомб, catDragon) — свои приёмы по стадиям (2026-10-21, процесс существа:
 * docs/pipelines/creatures.md). Остальные супербоссы катакомб бьют набором огнекрылого (ZoneRoom.tickHuntAttacks).
 *
 *   Пламя (стадии 1 и 2.5) — «Огненное дыхание» конусом (после него земля в конусе горит) и «Удар хвостом» —
 *                            разворот, хвост хлещет по сектору справа-спереди с отбросом;
 *   Печать (2)              — «Метеоры» под героями (клип заряда — рёв к своду);
 *   Ярость (3)              — «Кольцо пламени» (удар крыльями вниз — в кадр с уроном), дыхание и хвост чаще.
 *
 * Клип, телеграф, урон, эффект и звук бьют в один кадр: времена — DRAGON.hitSec (те же числа в dragon_anim.py).
 * Пока доигрывается клип приёма, дракон стоит лицом к удару (Mob.castLock) и не кусает; приёмы не накладываются.
 * Урон — доля здоровья героя (хост домножает её на CATACOMBS.hazardScale и размер отряда, как у опасностей зала).
 */
import { DRAGON, MOB_SWING } from "#shared/mobs";

export interface DragonHero {
  id: string;
  x: number;
  z: number;
}

export interface DragonBoss {
  x: number;
  z: number;
  /** Курс: взгляд — (sin yaw, cos yaw). */
  yaw: number;
  /** Масштаб моба (пасть — DRAGON.headFwd × scale впереди корня). */
  scale: number;
}

export type DragonAct =
  | "dragonBreath"
  | "dragonBreathGo"
  | "dragonBurn"
  | "dragonTail"
  | "dragonTailHit"
  | "dragonMeteorMark"
  | "dragonMeteorFall"
  | "dragonMeteorHit"
  | "dragonRingMark"
  | "dragonRing"
  | "dragonShieldBreak"
  | "dragonRage";

export interface DragonHost {
  /** Дракон жив — где он; иначе null. */
  boss(): DragonBoss | null;
  /** Живые герои забега. */
  heroes(): DragonHero[];
  /** Клип приёма (MOB_SWING). */
  swing(kind: number): void;
  /** Стоять лицом к yaw sec с (клип приёма), не кусать. */
  lockFacing(yaw: number, sec: number): void;
  /** Событие эффекта всем клиентам. */
  act(k: DragonAct, o: { x: number; z: number; x2?: number; z2?: number; d?: number; r?: number }): void;
  /** Опасная зона для ботов (уворачиваются). */
  danger(x: number, z: number, r: number, sec: number): void;
  /** Урон герою: доля его здоровья; отброс от (fromX, fromZ). */
  hurt(id: string, frac: number, fromX: number, fromZ: number, o?: { knock?: number; phys?: boolean }): void;
}

/** Угол героя от взгляда дракона, рад: > 0 — справа (правая рука — (cos yaw, −sin yaw)). */
export function sideAngle(yaw: number, dx: number, dz: number): number {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  return Math.atan2(dx * fz - dz * fx, dx * fx + dz * fz);
}

const DEG = Math.PI / 180;

interface Burn {
  x: number;
  z: number;
  fx: number;
  fz: number;
  until: number;
  tickAt: number;
}

export class DragonFight {
  private phase = 0;
  private breathAt = 0;
  private tailAt = 0;
  private meteorAt = 0;
  private ringAt = 0;
  private busyUntil = 0;
  private events: { at: number; run: () => void }[] = [];
  private burns: Burn[] = [];

  constructor(
    private readonly host: DragonHost,
    private readonly rnd: () => number = Math.random,
  ) {}

  /** Начало боя (now — секунды комнаты). */
  start(now: number): void {
    this.phase = 1;
    this.breathAt = now + 6;
    this.tailAt = now + 11;
    this.meteorAt = now + 2.5;
    this.ringAt = now + 3;
    this.busyUntil = 0;
    this.events = [];
    this.burns = [];
  }

  /** Тик боя: phase — стадия Владыки (1 Пламя, 2 Печать, 2.5 печать разбита, 3 Ярость). */
  tick(now: number, phase: number): void {
    for (let i = 0; i < this.events.length; ) {
      if (now >= this.events[i].at) this.events.splice(i, 1)[0].run();
      else i++;
    }
    this.tickBurns(now);
    const b = this.host.boss();
    if (!b) return;
    if (phase !== this.phase) this.enterPhase(now, phase, b);
    if (now < this.busyUntil) return;
    if (phase === 2) {
      if (now >= this.meteorAt) this.castMeteors(now, b);
      return;
    }
    if (phase >= 3 && now >= this.ringAt) {
      this.castRing(now, b);
      return;
    }
    if (now >= this.breathAt && this.castBreath(now, b)) return;
    if (now >= this.tailAt) this.castTail(now, b);
  }

  private at(t: number, run: () => void): void {
    this.events.push({ at: t, run });
  }

  private enterPhase(now: number, phase: number, b: DragonBoss): void {
    const was = this.phase;
    this.phase = phase;
    if (phase === 2) {
      // На трон под щит: начатые приёмы обрываются (дракон перенесён), горящая земля гаснет.
      this.events = [];
      this.burns = [];
      this.busyUntil = 0;
      this.meteorAt = now + 2.5;
      return;
    }
    if (was === 2) this.host.act("dragonShieldBreak", { x: b.x, z: b.z, r: DRAGON.headFwd * b.scale });
    if (phase >= 3 && was < 3) {
      // Ярость: рёв к своду (клип заряда), пламя по телу; первое кольцо — чуть погодя.
      const C = DRAGON.clipSec.charge;
      this.host.lockFacing(b.yaw, C);
      this.host.swing(MOB_SWING.magic);
      this.host.act("dragonRage", { x: b.x, z: b.z, d: C });
      this.busyUntil = now + C + 0.5;
      this.ringAt = now + C + 1.5;
      this.breathAt = Math.max(this.breathAt, now + C + 4);
      this.tailAt = Math.max(this.tailAt, now + C + 6);
    }
  }

  /** Герои в конусе от (ox, oz) по (fx, fz): длина len, полуугол half; у самой пасти (< 2 м) — тоже. */
  private inCone(h: DragonHero, ox: number, oz: number, fx: number, fz: number, len: number, half: number): boolean {
    const vx = h.x - ox;
    const vz = h.z - oz;
    const d = Math.hypot(vx, vz);
    if (d > len) return false;
    if (d < 2) return true;
    return (vx * fx + vz * fz) / d >= Math.cos(half);
  }

  private hurtCone(ox: number, oz: number, fx: number, fz: number, len: number, half: number, frac: number): void {
    for (const h of this.host.heroes()) {
      if (this.inCone(h, ox, oz, fx, fz, len, half)) this.host.hurt(h.id, frac, ox, oz);
    }
  }

  private tickBurns(now: number): void {
    const B = DRAGON.breath;
    for (let i = this.burns.length - 1; i >= 0; i--) {
      const w = this.burns[i];
      if (now >= w.until) {
        this.burns.splice(i, 1);
        continue;
      }
      if (now < w.tickAt) continue;
      w.tickAt += B.burnTick;
      this.hurtCone(w.x, w.z, w.fx, w.fz, B.len, B.half, B.burnFrac);
    }
  }

  /** «Огненное дыхание»: к случайному герою в досягаемости; false — некого (попробует позже). */
  private castBreath(now: number, b: DragonBoss): boolean {
    const B = DRAGON.breath;
    const H = DRAGON.hitSec;
    const near = this.host.heroes().filter((h) => Math.hypot(h.x - b.x, h.z - b.z) <= B.len + DRAGON.headFwd * b.scale + 4);
    if (near.length === 0) {
      this.breathAt = now + 1.5;
      return false;
    }
    const t = near[Math.floor(this.rnd() * near.length) % near.length];
    const yaw = Math.atan2(t.x - b.x, t.z - b.z);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const head = DRAGON.headFwd * b.scale;
    const ox = b.x + fx * head;
    const oz = b.z + fz * head;
    const geo = { x: ox, z: oz, x2: ox + fx * B.len, z2: oz + fz * B.len, r: B.half };
    this.host.lockFacing(yaw, DRAGON.clipSec.breath);
    this.host.swing(MOB_SWING.breath);
    this.host.act("dragonBreath", { ...geo, d: H.breathStart });
    for (const k of [0.25, 0.5, 0.75, 0.95]) {
      const dd = B.len * k;
      this.host.danger(ox + fx * dd, oz + fz * dd, Math.tan(B.half) * dd + 1.5, H.breathEnd + B.burnSec);
    }
    const stream = H.breathEnd - H.breathStart;
    const ticks = Math.max(1, Math.round(stream / B.tick));
    this.at(now + H.breathStart, () => this.host.act("dragonBreathGo", { ...geo, d: stream }));
    for (let i = 0; i < ticks; i++) {
      this.at(now + H.breathStart + (i * stream) / ticks, () => this.hurtCone(ox, oz, fx, fz, B.len, B.half, B.dmgFrac / ticks));
    }
    this.at(now + H.breathEnd, () => {
      this.burns.push({ x: ox, z: oz, fx, fz, until: now + H.breathEnd + B.burnSec, tickAt: now + H.breathEnd + B.burnTick });
      this.host.act("dragonBurn", { ...geo, d: B.burnSec });
    });
    this.breathAt = now + (this.phase >= 3 ? B.rageCooldown : B.cooldown);
    this.busyUntil = now + DRAGON.clipSec.breath + DRAGON.gap;
    return true;
  }

  /** «Удар хвостом»: ближайший герой в досягаемости — в середине сектора; некого — попробует позже. */
  private castTail(now: number, b: DragonBoss): void {
    const T = DRAGON.tail;
    let best: DragonHero | null = null;
    let bestD = Infinity;
    for (const h of this.host.heroes()) {
      const d = Math.hypot(h.x - b.x, h.z - b.z);
      if (d >= T.rMin && d <= T.rMax && d < bestD) {
        best = h;
        bestD = d;
      }
    }
    if (!best) {
      this.tailAt = now + 1.5;
      return;
    }
    const mid = ((T.from + T.to) / 2) * DEG;
    const yaw = Math.atan2(best.x - b.x, best.z - b.z) - mid; // цель — в середине сектора справа-спереди
    const geo = { x: b.x, z: b.z, x2: b.x + Math.sin(yaw), z2: b.z + Math.cos(yaw), r: T.rMax };
    const hit = DRAGON.hitSec.tail;
    this.host.lockFacing(yaw, DRAGON.clipSec.tail);
    this.host.swing(MOB_SWING.tail);
    this.host.act("dragonTail", { ...geo, d: hit });
    for (let a = T.from; a <= T.to; a += 25) {
      const ang = yaw + a * DEG;
      const rr = (T.rMin + T.rMax) / 2;
      this.host.danger(b.x + Math.sin(ang) * rr, b.z + Math.cos(ang) * rr, (T.rMax - T.rMin) / 2 + 1, hit + 0.2);
    }
    this.at(now + hit, () => {
      for (const h of this.host.heroes()) {
        const dx = h.x - b.x;
        const dz = h.z - b.z;
        const d = Math.hypot(dx, dz);
        if (d < T.rMin || d > T.rMax) continue;
        const a = sideAngle(yaw, dx, dz) / DEG;
        if (a < T.from || a > T.to) continue;
        this.host.hurt(h.id, T.dmgFrac, b.x, b.z, { knock: T.knock, phys: true });
      }
      this.host.act("dragonTailHit", geo);
    });
    this.tailAt = now + (this.phase >= 3 ? T.rageCooldown : T.cooldown);
    this.busyUntil = now + DRAGON.clipSec.tail + DRAGON.gap;
  }

  /** «Метеоры» (Печать): под героями и ещё несколько вокруг; падают после пика заряда. */
  private castMeteors(now: number, b: DragonBoss): void {
    const M = DRAGON.meteor;
    const heroes = this.host.heroes();
    const pts: { x: number; z: number }[] = [];
    const n = Math.min(10, heroes.length + M.extra);
    for (let i = 0; i < n; i++) {
      const h = heroes.length ? heroes[i % heroes.length] : null;
      const a = this.rnd() * Math.PI * 2;
      const r = i < heroes.length ? this.rnd() * 1.5 : 2 + this.rnd() * M.spread;
      const cx = h ? h.x : b.x + Math.sin(a) * 10;
      const cz = h ? h.z : b.z + Math.cos(a) * 10;
      pts.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r });
    }
    const peak = DRAGON.hitSec.charge;
    this.host.lockFacing(b.yaw, DRAGON.clipSec.charge);
    this.host.swing(MOB_SWING.magic);
    for (const p of pts) {
      this.host.act("dragonMeteorMark", { x: p.x, z: p.z, r: M.r, d: peak + M.fall });
      this.host.danger(p.x, p.z, M.r + 0.6, peak + M.fall + 0.2);
    }
    this.at(now + peak, () => {
      for (const p of pts) this.host.act("dragonMeteorFall", { x: p.x, z: p.z, d: M.fall });
    });
    this.at(now + peak + M.fall, () => {
      for (const p of pts) {
        for (const h of this.host.heroes()) {
          if (Math.hypot(h.x - p.x, h.z - p.z) <= M.r) this.host.hurt(h.id, M.dmgFrac, p.x, p.z);
        }
        this.host.act("dragonMeteorHit", { x: p.x, z: p.z, r: M.r });
      }
    });
    this.meteorAt = now + M.every;
    this.busyUntil = now + DRAGON.clipSec.charge + 0.3;
  }

  /** «Кольцо пламени» (Ярость): круг вокруг дракона; удар крыльями вниз — в кадр с уроном. */
  private castRing(now: number, b: DragonBoss): void {
    const R = DRAGON.ring;
    const W = DRAGON.hitSec.wings;
    const x = b.x;
    const z = b.z;
    this.host.lockFacing(b.yaw, R.telegraph + DRAGON.clipSec.wings - W);
    this.host.act("dragonRingMark", { x, z, r: R.r, d: R.telegraph });
    this.host.danger(x, z, R.r + 1, R.telegraph + 0.2);
    this.at(now + R.telegraph - W, () => this.host.swing(MOB_SWING.wings));
    this.at(now + R.telegraph, () => {
      for (const h of this.host.heroes()) {
        if (Math.hypot(h.x - x, h.z - z) <= R.r) this.host.hurt(h.id, R.dmgFrac, x, z, { knock: R.knock });
      }
      this.host.act("dragonRing", { x, z, r: R.r });
    });
    this.ringAt = now + R.every;
    this.busyUntil = now + R.telegraph + DRAGON.clipSec.wings - W + 0.3;
  }
}
