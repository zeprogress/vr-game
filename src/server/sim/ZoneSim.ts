import {
  COMBAT,
  MOB,
  PLAYER,
  SLIME_CFG,
  SPITTER,
  SPITTER_CFG,
} from "#shared/constants";
import { terrainHeight } from "#shared/terrain";
import type { MobKind } from "#shared/net/schema";
import { segDist } from "./math";

let seq = 1;
const nid = (): string => `e${seq++}`;

export interface SimPlayer {
  sessionId: string;
  /** голова/глаза */
  x: number;
  y: number;
  z: number;
}

/** Событие «моб/плевок ударил игрока» — комната разошлёт его. */
export interface PlayerHit {
  target: string;
  dmg: number;
  fromX: number;
  fromZ: number;
}

class Mob {
  readonly id = nid();
  x: number;
  y: number;
  z: number;
  yaw = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  hp: number;
  readonly maxHp: number;
  dead = false;
  private deadT = 0;
  private respawnIn = 0;
  grounded = true;
  private hopCd = Math.random() * MOB.hopInterval;
  private attackCd = 0;
  private hurtCd = 0;
  private aggroed = false;
  private outOfRange = 0;
  hurtSeq = 0;
  hurtDx = 0;
  hurtDz = 0;
  private readonly homeX: number;
  private readonly homeZ: number;
  readonly ranged: boolean;
  readonly xp: number;

  constructor(
    readonly kind: MobKind,
    hx: number,
    hz: number,
  ) {
    this.homeX = hx;
    this.homeZ = hz;
    this.x = hx;
    this.z = hz;
    this.y = terrainHeight(hx, hz);
    const cfg = kind === "spitter" ? SPITTER_CFG : SLIME_CFG;
    this.hp = cfg.hp;
    this.maxHp = cfg.hp;
    this.ranged = cfg.ranged;
    this.xp = cfg.xp;
  }

  get aggro(): boolean {
    return this.aggroed;
  }

  /** true — моб убит этим ударом. */
  applyHit(dmg: number, dx: number, dz: number): boolean {
    if (this.dead || this.hurtCd > 0) return false;
    this.hurtCd = 0.2;
    this.hp -= dmg;
    this.aggroed = true;
    this.outOfRange = 0;
    const kb = Math.min(2.5 + dmg * 1.5, 7);
    this.vx += dx * kb;
    this.vz += dz * kb;
    this.vy += 2.5;
    this.grounded = false;
    this.hurtSeq = (this.hurtSeq + 1) & 0xffff;
    this.hurtDx = dx;
    this.hurtDz = dz;
    if (this.hp <= 0) {
      this.dead = true;
      this.deadT = 0;
      this.respawnIn = MOB.respawn;
      return true;
    }
    return false;
  }

  tick(
    dt: number,
    players: SimPlayer[],
    hits: PlayerHit[],
    spit: (mob: Mob, target: SimPlayer) => void,
  ): void {
    if (this.hurtCd > 0) this.hurtCd -= dt;
    if (this.attackCd > 0) this.attackCd -= dt;

    if (this.dead) {
      this.deadT += dt;
      this.y -= dt * 0.6;
      this.respawnIn -= dt;
      if (this.respawnIn <= 0) this.respawn();
      return;
    }

    // ближайший игрок
    let np: SimPlayer | null = null;
    let best = Infinity;
    for (const p of players) {
      const d = (p.x - this.x) ** 2 + (p.z - this.z) ** 2;
      if (d < best) {
        best = d;
        np = p;
      }
    }
    const dist = np ? Math.sqrt(best) : Infinity;
    let dx = 0;
    let dz = 1;
    if (np && dist > 1e-3) {
      dx = (np.x - this.x) / dist;
      dz = (np.z - this.z) / dist;
    }

    const aggroRange = this.ranged ? SPITTER.aggroRange : MOB.aggroRange;
    if (dist < aggroRange) {
      this.aggroed = true;
      this.outOfRange = 0;
    } else if (this.aggroed && dist > aggroRange * 1.4) {
      this.outOfRange += dt;
      if (this.outOfRange > MOB.leash) this.aggroed = false;
    } else {
      this.outOfRange = 0;
    }
    const chasing = this.aggroed && np !== null;

    if (this.grounded) {
      this.hopCd -= dt;
      if (this.hopCd <= 0 && chasing) {
        this.hopCd = MOB.hopInterval;
        let hx = 0;
        let hz = 0;
        if (this.ranged) {
          if (dist < SPITTER.keepDistance) {
            hx = -dx;
            hz = -dz;
          } else if (dist > SPITTER.fireRange) {
            hx = dx;
            hz = dz;
          } else {
            const s = Math.random() < 0.5 ? 1 : -1;
            hx = -dz * s;
            hz = dx * s;
          }
        } else if (dist > MOB.attackRange * 0.7) {
          hx = dx;
          hz = dz;
        }
        if (hx !== 0 || hz !== 0) {
          this.vx = hx * MOB.hopSpeed;
          this.vz = hz * MOB.hopSpeed;
          this.vy = MOB.hopUp;
          this.grounded = false;
        }
      }
    } else {
      this.vy -= MOB.gravity * dt;
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;

    const gy = terrainHeight(this.x, this.z);
    if (this.y <= gy) {
      this.y = gy;
      this.vy = 0;
      this.vx *= 0.25;
      this.vz *= 0.25;
      this.grounded = true;
    }

    // не проходит сквозь игроков
    for (const p of players) {
      const gx = this.x - p.x;
      const gz = this.z - p.z;
      const gd = Math.hypot(gx, gz);
      const clr = PLAYER.radius + MOB.bodyRadius;
      if (gd > 1e-4 && gd < clr) {
        const push = (clr - gd) / gd;
        this.x += gx * push;
        this.z += gz * push;
        const inward = (this.vx * gx + this.vz * gz) / gd;
        if (inward < 0) {
          this.vx -= (gx / gd) * inward;
          this.vz -= (gz / gd) * inward;
        }
      }
    }

    if (chasing) this.yaw = Math.atan2(dx, dz);

    if (chasing && np) {
      if (this.ranged) {
        if (dist < SPITTER.fireRange && this.attackCd <= 0) {
          this.attackCd = SPITTER.fireCooldown;
          spit(this, np);
        }
      } else if (dist < MOB.attackRange && this.attackCd <= 0) {
        this.attackCd = MOB.attackCooldown;
        hits.push({ target: np.sessionId, dmg: MOB.attackDamage, fromX: this.x, fromZ: this.z });
        this.vx -= dx * 2;
        this.vz -= dz * 2;
      }
    }
  }

  private respawn(): void {
    const a = Math.random() * Math.PI * 2;
    const r = 3 + Math.random() * MOB.wanderRadius;
    this.x = this.homeX + Math.cos(a) * r;
    this.z = this.homeZ + Math.sin(a) * r;
    this.y = terrainHeight(this.x, this.z) + 5;
    this.hp = this.maxHp;
    this.dead = false;
    this.aggroed = false;
    this.outOfRange = 0;
    this.vx = this.vy = this.vz = 0;
    this.grounded = false;
  }
}

class Dummy {
  readonly id = nid();
  hp = COMBAT.dummyHp;
  dead = false;
  private respawnIn = 0;
  hurtSeq = 0;

  constructor(
    readonly x: number,
    readonly y: number,
    readonly z: number,
  ) {}

  applyHit(dmg: number): boolean {
    if (this.dead) return false;
    this.hp -= dmg;
    this.hurtSeq = (this.hurtSeq + 1) & 0xffff;
    if (this.hp <= 0) {
      this.dead = true;
      this.respawnIn = COMBAT.dummyRespawn;
      return true;
    }
    return false;
  }

  tick(dt: number): void {
    if (!this.dead) return;
    this.respawnIn -= dt;
    if (this.respawnIn <= 0) {
      this.dead = false;
      this.hp = COMBAT.dummyHp;
    }
  }
}

class Ball {
  readonly id = nid();
  private life = 0;

  constructor(
    public x: number,
    public y: number,
    public z: number,
    public vx: number,
    public vy: number,
    public vz: number,
  ) {}

  /** true — шарик надо удалить. */
  tick(dt: number, players: SimPlayer[], hits: PlayerHit[]): boolean {
    const px = this.x;
    const py = this.y;
    const pz = this.z;
    this.vy -= SPITTER.ballGravity * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;
    this.life += dt;
    if (this.life > SPITTER.ballMaxLife) return true;
    if (this.y <= terrainHeight(this.x, this.z)) return true;

    for (const p of players) {
      const feetY = p.y - PLAYER.eyeHeight;
      const d = segDist(
        px, py, pz, this.x, this.y, this.z,
        p.x, feetY, p.z, p.x, p.y, p.z,
      );
      if (d < SPITTER.ballRadius + PLAYER.radius) {
        hits.push({ target: p.sessionId, dmg: SPITTER.ballDamage, fromX: this.x, fromZ: this.z });
        return true;
      }
    }
    return false;
  }
}

/** Авторитетная симуляция зоны: мобы, куклы, плевки. Без Babylon. */
export class ZoneSim {
  readonly mobs = new Map<string, Mob>();
  readonly dummies = new Map<string, Dummy>();
  readonly balls = new Map<string, Ball>();

  constructor() {
    for (let i = 0; i < MOB.count; i++) {
      const a = (i / MOB.count) * Math.PI * 2 + 0.4;
      const r = 22 + Math.random() * 12;
      const m = new Mob("slime", Math.cos(a) * r, Math.sin(a) * r - 4);
      this.mobs.set(m.id, m);
    }
    const [rMin, rMax] = SPITTER.spawnRadius;
    for (let i = 0; i < SPITTER.count; i++) {
      const a = (i / SPITTER.count) * Math.PI * 2 + 1.1;
      const r = rMin + Math.random() * (rMax - rMin);
      const m = new Mob("spitter", Math.cos(a) * r, Math.sin(a) * r - 4);
      this.mobs.set(m.id, m);
    }
    for (const [dx, dz] of [
      [-4, -6],
      [-1.5, -8],
      [1.5, -8],
      [4, -6],
    ] as const) {
      const d = new Dummy(dx, terrainHeight(dx, dz), dz);
      this.dummies.set(d.id, d);
    }
  }

  tick(dt: number, players: SimPlayer[]): PlayerHit[] {
    const hits: PlayerHit[] = [];
    const spit = (mob: Mob, target: SimPlayer): void => {
      if (this.balls.size >= SPITTER.maxBalls) {
        const first = this.balls.keys().next().value as string | undefined;
        if (first) this.balls.delete(first);
      }
      const mx = mob.x;
      const my = mob.y + MOB.bodyRadius;
      const mz = mob.z;
      const aimX = target.x;
      const aimZ = target.z;
      let aimY = target.y - 0.4;
      const L = Math.hypot(aimX - mx, aimZ - mz);
      const t = L / SPITTER.ballSpeed;
      aimY += 0.5 * SPITTER.ballGravity * t * t;
      let dx = aimX - mx;
      let dy = aimY - my;
      let dz = aimZ - mz;
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl;
      dy /= dl;
      dz /= dl;
      const b = new Ball(
        mx,
        my,
        mz,
        dx * SPITTER.ballSpeed,
        dy * SPITTER.ballSpeed,
        dz * SPITTER.ballSpeed,
      );
      this.balls.set(b.id, b);
    };

    for (const m of this.mobs.values()) m.tick(dt, players, hits, spit);
    for (const d of this.dummies.values()) d.tick(dt);
    for (const [id, b] of this.balls) if (b.tick(dt, players, hits)) this.balls.delete(id);
    return hits;
  }

  /** Урон по мобу. Возвращает опыт за добивание (0 — если не убит). */
  hitMob(id: string, dmg: number, dx: number, dz: number): number {
    const m = this.mobs.get(id);
    if (!m) return 0;
    return m.applyHit(dmg, dx, dz) ? m.xp : 0;
  }

  hitDummy(id: string, dmg: number): void {
    this.dummies.get(id)?.applyHit(dmg);
  }
}
