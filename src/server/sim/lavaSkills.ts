/**
 * Лавовый монстр 75 ур. (LAVA, shared/mobs.ts): Страж — «Удар о землю», «Разлив магмы», «Ярость» ниже 40% HP;
 * Маг — «Метка лавы» (удар с задержкой), «Кольцо углей». Чистая логика таймеров: моб (ZoneSim) передаёт, где он
 * и кто рядом, а получает события — урон, оглушение, эффекты и номер клипа. Клип, телеграф и урон бьют в один
 * кадр: время удара — windup (он же кадр клипа, LAVA.hitSec.slam и LAVA.clipSec).
 *
 * Пока идёт приём, моб стоит (casting) и обычным ударом не бьёт; оглушение посреди замаха срывает приём.
 */
import { LAVA, MOB_SWING } from "#shared/mobs";

export type LavaRole = "guard" | "mage";

export type LavaFxKind =
  | "lavaSlam" | "lavaSlamHit"
  | "lavaSpill" | "lavaSpillHit"
  | "lavaFury" | "lavaFuryHit"
  | "lavaMark" | "lavaMarkHit"
  | "lavaRing" | "lavaRingHit";

export interface LavaFx {
  k: LavaFxKind;
  x: number;
  z: number;
  /** Радиус (м), или полуширина линии. */
  r?: number;
  /** Конец линии (разлив магмы). */
  x2?: number;
  z2?: number;
  /** Через сколько секунд событие (телеграф / удар). */
  d?: number;
}

export interface LavaHero {
  id: string;
  x: number;
  z: number;
}

export interface LavaCtx {
  x: number;
  z: number;
  /** Курс моба (рад). */
  yaw: number;
  hpFrac: number;
  aggroed: boolean;
  /** Оглушён: посреди замаха приём срывается. */
  stunned: boolean;
  heroes: LavaHero[];
  /** Урон обычного удара моба (MOB.attackDamage × dmgMul). */
  base: number;
}

export type LavaEvent =
  | { t: "swing"; k: number }
  | { t: "fx"; fx: LavaFx }
  | {
      t: "hit";
      target: string;
      dmg: number;
      fromX: number;
      fromZ: number;
      stunSec?: number;
      slowSec?: number;
      slowFrac?: number;
      knockback?: number;
      dot?: boolean;
    };

const SWING: Record<LavaFxKind, number> = {
  lavaSlam: MOB_SWING.lavaSlam, lavaSlamHit: MOB_SWING.lavaSlam,
  lavaSpill: MOB_SWING.lavaSpill, lavaSpillHit: MOB_SWING.lavaSpill,
  lavaFury: MOB_SWING.lavaRoar, lavaFuryHit: MOB_SWING.lavaRoar,
  lavaMark: MOB_SWING.lavaMark, lavaMarkHit: MOB_SWING.lavaMark,
  lavaRing: MOB_SWING.lavaRing, lavaRingHit: MOB_SWING.lavaRing,
};

interface Timed {
  left: number;
  fire: () => LavaEvent[];
  /** Удар приёма (моб стоит); горение после удара — без блокировки. */
  block?: boolean;
}

/** Приём: имя (для кулдауна), кулдаун, телеграф в начале и таймеры удара. */
interface Cast {
  skill: string;
  cdSec: number;
  telegraph: LavaEvent[];
  steps: Timed[];
}

export class LavaSkills {
  /** Ярость стража уже была (раз за бой). */
  fury = false;
  private readonly cd = new Map<string, number>();
  private gapLeft = 0;
  private timers: Timed[] = [];
  /** Последний кадр моба: удар берёт героев, где они стоят в момент удара, а не при начале приёма. */
  private now!: LavaCtx;

  /** Клип приёма идёт: моб стоит, обычным ударом не бьёт (горение после удара не считается). */
  get casting(): boolean {
    return this.timers.some((t) => t.block !== false);
  }

  constructor(readonly role: LavaRole) {}

  /** Множитель скорости: у стража в ярости быстрее. */
  get speedMul(): number {
    return this.role === "guard" && this.fury ? LAVA.guard.fury.speedMul : 1;
  }

  tick(dt: number, c: LavaCtx): LavaEvent[] {
    const out: LavaEvent[] = [];
    this.now = c;
    for (const [k, v] of this.cd) if (v > 0) this.cd.set(k, v - dt);
    if (this.gapLeft > 0) this.gapLeft -= dt;

    if (c.stunned && this.casting) {
      // Оглушили посреди замаха — приём сорван, урона нет.
      this.timers = [];
      this.gapLeft = LAVA.gap;
      return out;
    }

    // Отсчёт приёма: события с истёкшим временем — урон и эффект.
    const wasCasting = this.casting;
    for (const t of this.timers) t.left -= dt;
    const due = this.timers.filter((t) => t.left <= 0);
    this.timers = this.timers.filter((t) => t.left > 0);
    for (const t of due) out.push(...t.fire());
    if (wasCasting && !this.casting) this.gapLeft = LAVA.gap;

    if (this.role === "guard" && !this.fury && c.hpFrac < LAVA.guard.fury.at) {
      this.fury = true;
      this.start(out, this.furyCast(c));
      return out;
    }
    if (!this.casting && c.aggroed && this.gapLeft <= 0) {
      const pick = this.role === "guard" ? this.pickGuard(c) : this.pickMage(c);
      if (pick) this.start(out, pick);
    }
    return out;
  }

  /** Начать приём: клип, телеграф сразу, удар (и хвост) — по таймерам. */
  private start(out: LavaEvent[], cast: Cast): void {
    this.cd.set(cast.skill, cast.cdSec * (this.fury ? LAVA.guard.fury.cdMul : 1));
    out.push(...cast.telegraph);
    this.timers.push(...cast.steps);
  }

  private nearest(c: LavaCtx, maxDist: number): LavaHero | null {
    let best: LavaHero | null = null;
    let bestD = maxDist;
    for (const h of this.now.heroes) {
      const d = Math.hypot(h.x - c.x, h.z - c.z);
      if (d <= bestD) {
        best = h;
        bestD = d;
      }
    }
    return best;
  }

  private ready(skill: string): boolean {
    return (this.cd.get(skill) ?? 0) <= 0;
  }

  private pickGuard(c: LavaCtx): Cast | null {
    const G = LAVA.guard;
    if (this.ready("slam") && this.nearest(c, G.slam.radius + 1)) return this.slamCast(c);
    if (this.ready("spill") && this.nearest(c, 10)) return this.spillCast(c);
    return null;
  }

  private pickMage(c: LavaCtx): Cast | null {
    const M = LAVA.mage;
    if (this.ready("ring") && this.nearest(c, M.ringRange)) return this.ringCast(c);
    if (this.ready("mark")) {
      const h = this.nearest(c, M.markRange);
      if (h) return this.markCast(c, h);
    }
    return null;
  }

  private slamCast(c: LavaCtx): Cast {
    const S = LAVA.guard.slam;
    const dmg = c.base * S.dmgMul;
    return {
      skill: "slam",
      cdSec: S.cooldown,
      telegraph: [
        { t: "swing", k: SWING.lavaSlam } as LavaEvent,
        { t: "fx", fx: { k: "lavaSlam", x: c.x, z: c.z, r: S.radius, d: S.windup } } as LavaEvent,
      ],
      steps: [{
        left: S.windup,
        fire: () => [
          { t: "fx", fx: { k: "lavaSlamHit", x: c.x, z: c.z, r: S.radius } },
          ...this.now.heroes
            .filter((h) => Math.hypot(h.x - c.x, h.z - c.z) <= S.radius)
            .map((h) => ({ t: "hit", target: h.id, dmg, fromX: c.x, fromZ: c.z, stunSec: S.stunSec }) as LavaEvent),
        ],
      }],
    };
  }

  private spillCast(c: LavaCtx): Cast {
    const S = LAVA.guard.spill;
    const h = this.nearest(c, 10)!;
    const dx = h.x - c.x;
    const dz = h.z - c.z;
    const len = Math.hypot(dx, dz) || 1;
    const ex = c.x + (dx / len) * S.length;
    const ez = c.z + (dz / len) * S.length;
    const dmg = c.base * S.dmgMul;
    const dist = (px: number, pz: number): number => {
      // Расстояние от точки до отрезка «моб → конец линии».
      const vx = ex - c.x;
      const vz = ez - c.z;
      const u = Math.max(0, Math.min(1, ((px - c.x) * vx + (pz - c.z) * vz) / (vx * vx + vz * vz)));
      return Math.hypot(px - (c.x + vx * u), pz - (c.z + vz * u));
    };
    const burned = new Set<string>();
    const steps: Timed[] = [{
      left: S.windup,
      fire: () => {
        const ev: LavaEvent[] = [{ t: "fx", fx: { k: "lavaSpillHit", x: c.x, z: c.z, x2: ex, z2: ez, r: S.halfWidth } }];
        for (const p of this.now.heroes) {
          if (dist(p.x, p.z) > S.halfWidth) continue;
          burned.add(p.id);
          ev.push({ t: "hit", target: p.id, dmg, fromX: c.x, fromZ: c.z });
        }
        return ev;
      },
    }];
    // Горение: тем, кого задело, тики по земле после удара (dot — щит и уворот не спасают); моб уже свободен.
    for (let i = 1; i <= S.burnSec / S.burnTick; i++) {
      steps.push({
        left: S.windup + S.burnTick * i,
        block: false,
        fire: () => this.now.heroes.filter((p) => burned.has(p.id)).map((p) => ({
          t: "hit", target: p.id, dmg: c.base * S.burnFrac, fromX: c.x, fromZ: c.z, dot: true,
        }) as LavaEvent),
      });
    }
    return {
      skill: "spill",
      cdSec: S.cooldown,
      telegraph: [
        { t: "swing", k: SWING.lavaSpill } as LavaEvent,
        { t: "fx", fx: { k: "lavaSpill", x: c.x, z: c.z, x2: ex, z2: ez, r: S.halfWidth, d: S.windup } } as LavaEvent,
      ],
      steps,
    };
  }

  private furyCast(c: LavaCtx): Cast {
    const F = LAVA.guard.fury;
    const dmg = c.base * F.dmgMul;
    return {
      skill: "fury",
      cdSec: 0,
      telegraph: [
        { t: "swing", k: SWING.lavaFury } as LavaEvent,
        { t: "fx", fx: { k: "lavaFury", x: c.x, z: c.z, r: F.radius, d: F.windup } } as LavaEvent,
      ],
      steps: [{
        left: F.windup,
        fire: () => [
          { t: "fx", fx: { k: "lavaFuryHit", x: c.x, z: c.z, r: F.radius } },
          ...this.now.heroes
            .filter((h) => Math.hypot(h.x - c.x, h.z - c.z) <= F.radius)
            .map((h) => ({ t: "hit", target: h.id, dmg, fromX: c.x, fromZ: c.z, knockback: F.knockback }) as LavaEvent),
        ],
      }],
    };
  }

  private markCast(c: LavaCtx, h: LavaHero): Cast {
    const M = LAVA.mage.mark;
    const mx = h.x;
    const mz = h.z;
    const total = M.windup + M.delaySec;
    const dmg = c.base * M.dmgMul;
    return {
      skill: "mark",
      cdSec: M.cooldown,
      telegraph: [
        { t: "swing", k: SWING.lavaMark } as LavaEvent,
        // Круг под героем сразу (что он сделает, видно); удар — через windup + delaySec.
        { t: "fx", fx: { k: "lavaMark", x: mx, z: mz, r: M.radius, d: total } } as LavaEvent,
      ],
      steps: [{
        left: total,
        fire: () => [
          { t: "fx", fx: { k: "lavaMarkHit", x: mx, z: mz, r: M.radius } },
          ...this.now.heroes
            .filter((p) => Math.hypot(p.x - mx, p.z - mz) <= M.radius)
            .map((p) => ({ t: "hit", target: p.id, dmg, fromX: mx, fromZ: mz }) as LavaEvent),
        ],
      }],
    };
  }

  private ringCast(c: LavaCtx): Cast {
    const R = LAVA.mage.ring;
    const dmg = c.base * R.dmgMul;
    return {
      skill: "ring",
      cdSec: R.cooldown,
      telegraph: [
        { t: "swing", k: SWING.lavaRing } as LavaEvent,
        { t: "fx", fx: { k: "lavaRing", x: c.x, z: c.z, r: R.radius, d: R.windup } } as LavaEvent,
      ],
      steps: [{
        left: R.windup,
        fire: () => [
          { t: "fx", fx: { k: "lavaRingHit", x: c.x, z: c.z, r: R.radius } },
          ...this.now.heroes
            .filter((h) => Math.hypot(h.x - c.x, h.z - c.z) <= R.radius)
            .map((h) => ({ t: "hit", target: h.id, dmg, fromX: c.x, fromZ: c.z, slowSec: R.slowSec, slowFrac: R.slowFrac }) as LavaEvent),
        ],
      }],
    };
  }
}
