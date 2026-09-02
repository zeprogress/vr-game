import {
  BOSS,
  BOSS_CFG,
  COMBAT,
  MOB,
  PLAYER,
  SHARD,
  SHARD_CFG,
  SLIME_CFG,
  SPITTER,
  SPITTER_CFG,
} from "#shared/constants";
import { terrainHeight } from "#shared/terrain";
import { trees } from "#shared/trees";
import { rocks } from "#shared/rocks";
import {
  BAG,
  isItemId,
  ITEMS,
  rollLoot,
  weaponKey,
  type ItemId,
  type WeaponClass,
  type WeaponTier,
} from "#shared/items";
import type { MobKind } from "#shared/net/schema";
import { segDist } from "./math";

/** Каким предметом каждое оружие лежит в мире. */
const WEAPON_DROP: Partial<Record<string, ItemId>> = {
  "sword:gold": "gold_sword",
  "bow:gold": "gold_bow",
  "shield:gold": "gold_shield",
  "staff:gold": "gold_staff",
};

/** Препятствия (стволы + крупные камни) — общие с клиентом, один раз. */
const OBSTACLES: { x: number; z: number; r: number }[] = [
  ...trees().map((t) => ({ x: t.x, z: t.z, r: t.r })),
  ...rocks()
    .filter((rk) => rk.solid)
    .map((rk) => ({ x: rk.x, z: rk.z, r: rk.r })),
];

/** Насколько далеко вперёд моб смотрит, выбирая куда прыгнуть. */
const TREE_LOOKAHEAD = 3.5;

/**
 * Отклоняет намеченное направление прыжка в сторону от ствола на пути.
 *
 * Без этого моб бьётся в дерево и стоит: выталкивание не даёт залезть внутрь,
 * но и обойти само не помогает. Здесь моб заранее берёт по касательной —
 * с той стороны, к которой ствол и так ближе, так что крюк выходит короткий.
 */
function steerAroundTrees(
  x: number,
  z: number,
  dx: number,
  dz: number,
): [number, number] {
  const clr = MOB.bodyRadius + 0.35; // запас, чтобы не тереться боком о ствол
  let hit: { along: number; perp: number; wide: number } | null = null;
  for (const t of OBSTACLES) {
    const rx = t.x - x;
    const rz = t.z - z;
    const along = rx * dx + rz * dz; // вдоль хода
    if (along <= 0 || along > TREE_LOOKAHEAD) continue;
    const perp = rx * -dz + rz * dx; // влево от хода
    const wide = t.r + clr;
    if (Math.abs(perp) >= wide) continue;
    if (!hit || along < hit.along) hit = { along, perp, wide };
  }
  if (!hit) return [dx, dz];

  // Уходим в сторону, противоположную стволу; чем он ближе к оси хода, тем круче.
  const side = hit.perp >= 0 ? -1 : 1;
  const force = 1 - Math.abs(hit.perp) / hit.wide;
  const nx = -dz * side;
  const nz = dx * side;
  const sx = dx + nx * (0.6 + force);
  const sz = dz + nz * (0.6 + force);
  const len = Math.hypot(sx, sz);
  return len > 1e-4 ? [sx / len, sz / len] : [dx, dz];
}

/** Середина торса куклы над её основанием (см. клиентский Dummy). */
const DUMMY_CENTER_Y = 1.5;

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
  /** true — снаряд (плевок): мечом отбивается полностью, а не на 75%. */
  projectile: boolean;
  /** Ник атакующего игрока (PvP) — для кил-фида; нет — урон от моба/среды. */
  byName?: string;
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
  /** Куда лениво бредём вне боя. По приходе выбираем новую точку у дома. */
  private wanderX = 0;
  private wanderZ = 0;
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
  readonly scale: number;

  // --- босс ---
  private slamCd: number = BOSS.slamCooldown;
  /** Время до слэма, пока > 0 — телеграф (босс стоит). */
  private slamWindupT = 0;
  slamSeq = 0;
  /** Рывок-таран: замах, полёт, куда летим и был ли уже удар за этот рывок. */
  private lungeCd = 0; // первый рывок — сразу по агро
  private lungeWindupT = 0;
  private lungeT = 0;
  private lungeDirX = 0;
  private lungeDirZ = 1;
  private lungeHit = false;
  /** Плевок босса: кулдаун очереди, сколько сгустков осталось и пауза между ними. */
  private shootCd = BOSS.shootCooldown;
  private shootQueue = 0;
  private shootGap = 0;
  private splitsDone = 0;
  /** ZoneSim прочтёт и сбросит: босс пересёк порог HP — выбросить осколки. */
  pendingSplit = false;
  /** Осколки не возрождаются — их убирают из симуляции насовсем. */
  get permanent(): boolean {
    return this.kind !== "shard";
  }
  get enraged(): boolean {
    return this.kind === "boss" && !this.dead && this.hp / this.maxHp < BOSS.enrageAt;
  }
  /** Готовность слэма/рывка 0..1 (для телеграфа на клиенте). */
  get slamTelegraph(): number {
    if (this.slamWindupT > 0) return 1 - this.slamWindupT / BOSS.slamWindup;
    if (this.lungeWindupT > 0) return 1 - this.lungeWindupT / BOSS.lungeWindup;
    return 0;
  }
  /** 1 — босс копит или выполняет рывок-таран (клиент вытягивает тело). */
  get charging(): boolean {
    return this.lungeWindupT > 0 || this.lungeT > 0;
  }

  constructor(
    readonly kind: MobKind,
    hx: number,
    hz: number,
  ) {
    this.homeX = hx;
    this.homeZ = hz;
    this.x = hx;
    this.z = hz;
    this.wanderX = hx;
    this.wanderZ = hz;
    this.y = terrainHeight(hx, hz);
    const cfg =
      kind === "spitter"
        ? SPITTER_CFG
        : kind === "boss"
          ? BOSS_CFG
          : kind === "shard"
            ? SHARD_CFG
            : SLIME_CFG;
    this.hp = cfg.hp;
    this.maxHp = cfg.hp;
    this.ranged = cfg.ranged;
    this.xp = cfg.xp;
    this.scale = kind === "boss" ? BOSS.scale : kind === "shard" ? SHARD.scale : 1;
  }

  get aggro(): boolean {
    return this.aggroed;
  }

  forceAggro(): void {
    this.aggroed = true;
    this.outOfRange = 0;
    this.y = terrainHeight(this.x, this.z) + 1.5;
    this.grounded = false;
  }

  /** true — моб убит этим ударом. */
  applyHit(dmg: number, dx: number, dz: number): boolean {
    if (this.dead || this.hurtCd > 0) return false;
    this.hurtCd = 0.2;
    const before = this.hp / this.maxHp;
    this.hp -= dmg;
    this.aggroed = true;
    this.outOfRange = 0;
    // Босс пересёк порог доли HP — пора выбросить осколки.
    if (this.kind === "boss") {
      const after = this.hp / this.maxHp;
      while (this.splitsDone < BOSS.splitAt.length && after <= BOSS.splitAt[this.splitsDone]) {
        this.splitsDone++;
        if (before > BOSS.splitAt[this.splitsDone - 1]) this.pendingSplit = true;
      }
    }
    // Босса не сдвинуть с места ударом, осколок — легко.
    const kb = this.kind === "boss" ? 0 : Math.min(2.5 + dmg * 1.5, 7);
    this.vx += dx * kb;
    this.vz += dz * kb;
    if (kb > 0) {
      this.vy += 2.5;
      this.grounded = false;
    }
    this.hurtSeq = (this.hurtSeq + 1) & 0xffff;
    this.hurtDx = dx;
    this.hurtDz = dz;
    if (this.hp <= 0) {
      this.dead = true;
      this.deadT = 0;
      this.slamWindupT = 0;
      this.lungeWindupT = 0;
      this.lungeT = 0;
      this.respawnIn = this.kind === "boss" ? BOSS.respawn : MOB.respawn;
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

    const isBoss = this.kind === "boss";
    const aggroRange = isBoss
      ? BOSS.aggroRange
      : this.ranged
        ? SPITTER.aggroRange
        : MOB.aggroRange;
    if (dist < aggroRange || (this.kind === "shard" && np)) {
      this.aggroed = true;
      this.outOfRange = 0;
    } else if (this.aggroed && dist > aggroRange * 1.4) {
      this.outOfRange += dt;
      if (this.outOfRange > MOB.leash) this.aggroed = false;
    } else {
      this.outOfRange = 0;
    }
    const chasing = this.aggroed && np !== null;

    const rage = this.enraged ? 1.5 : 1;
    const hopSpeed =
      (isBoss ? BOSS.hopSpeed : this.kind === "shard" ? SHARD.hopSpeed : MOB.hopSpeed) * rage;
    const hopInterval =
      (isBoss ? BOSS.hopInterval : this.kind === "shard" ? SHARD.hopInterval : MOB.hopInterval) /
      rage;

    // Босс копит слэм: подошёл близко — замахивается (стоит на месте),
    // на исходе телеграфа бьёт по площади вокруг себя.
    if (isBoss) {
      if (this.slamCd > 0) this.slamCd -= dt;
      if (this.slamWindupT > 0) {
        this.slamWindupT -= dt;
        this.vx *= 0.02;
        this.vz *= 0.02;
        if (this.slamWindupT <= 0) {
          this.slamSeq = (this.slamSeq + 1) & 0xffff;
          this.slamCd = BOSS.slamCooldown / rage;
          this.vy = MOB.hopUp * 0.6;
          this.grounded = false;
          for (const p of players) {
            if (Math.hypot(p.x - this.x, p.z - this.z) > BOSS.slamRadius) continue;
            hits.push({
              target: p.sessionId,
              dmg: BOSS.slamDamage,
              fromX: this.x,
              fromZ: this.z,
              projectile: false,
            });
          }
        }
      } else if (
        chasing &&
        this.grounded &&
        this.slamCd <= 0 &&
        dist < BOSS.slamRange &&
        this.lungeT <= 0 &&
        this.lungeWindupT <= 0
      ) {
        this.slamWindupT = BOSS.slamWindup;
      }

      // Рывок-таран: летит в самого ДАЛЁКОГО игрока в пределах агро — так
      // достаёт того, кто держит дистанцию, пока второй вяжет боем вблизи.
      // Разгоняется и проносится по прямой. Один удар за рывок; не толкает.
      let lungeTgt: SimPlayer | null = null;
      let lungeFar = -1;
      for (const p of players) {
        const d = Math.hypot(p.x - this.x, p.z - this.z);
        if (d <= BOSS.aggroRange && d > lungeFar) {
          lungeFar = d;
          lungeTgt = p;
        }
      }
      if (this.lungeCd > 0) this.lungeCd -= dt;
      if (this.lungeWindupT > 0) {
        this.lungeWindupT -= dt;
        this.vx *= 0.02;
        this.vz *= 0.02;
        if (lungeTgt && lungeFar > 1e-3) {
          this.lungeDirX = (lungeTgt.x - this.x) / lungeFar;
          this.lungeDirZ = (lungeTgt.z - this.z) / lungeFar;
        }
        if (this.lungeWindupT <= 0) {
          this.lungeT = BOSS.lungeDuration;
          this.lungeHit = false;
          this.lungeCd = BOSS.lungeCooldown / rage;
        }
      } else if (this.lungeT > 0) {
        this.lungeT -= dt;
        this.vx = this.lungeDirX * BOSS.lungeSpeed * rage;
        this.vz = this.lungeDirZ * BOSS.lungeSpeed * rage;
        if (!this.lungeHit) {
          for (const p of players) {
            if (Math.hypot(p.x - this.x, p.z - this.z) > BOSS.slamRadius * 0.7 + PLAYER.radius) {
              continue;
            }
            hits.push({
              target: p.sessionId,
              dmg: BOSS.lungeDamage,
              fromX: this.x,
              fromZ: this.z,
              projectile: false,
            });
            this.lungeHit = true;
          }
        }
      } else if (
        this.aggroed &&
        lungeTgt &&
        this.grounded &&
        this.slamWindupT <= 0 &&
        this.lungeCd <= 0 &&
        lungeFar > BOSS.slamRange * 1.15
      ) {
        this.lungeWindupT = BOSS.lungeWindup;
        this.lungeDirX = (lungeTgt.x - this.x) / lungeFar;
        this.lungeDirZ = (lungeTgt.z - this.z) / lungeFar;
      }

      // Плевок: изредка очередь слизистых сгустков в игрока на средней
      // дистанции. Работает и во время замаха/рывка — босс многозадачен.
      if (this.shootCd > 0) this.shootCd -= dt;
      if (this.shootGap > 0) this.shootGap -= dt;
      // Цель плевка — тот, кто в полосе средних дистанций (обычно дальний).
      const shootTgt =
        lungeTgt &&
        lungeFar > BOSS.shootRange[0] &&
        lungeFar < BOSS.shootRange[1]
          ? lungeTgt
          : null;
      if (this.shootQueue === 0 && this.shootCd <= 0 && shootTgt) {
        this.shootQueue = BOSS.shootBurst;
        this.shootCd = BOSS.shootCooldown;
        this.shootGap = 0;
      }
      if (this.shootQueue > 0 && this.shootGap <= 0) {
        const t = shootTgt ?? lungeTgt ?? np;
        if (t) {
          const tl = Math.hypot(t.x - this.x, t.z - this.z) || 1;
          const nx = (t.x - this.x) / tl;
          const nz = (t.z - this.z) / tl;
          const j = (Math.random() - 0.5) * BOSS.shootSpread;
          // Смещаем цель вбок перпендикулярно направлению на неё.
          spit(this, { ...t, x: t.x - nz * j, z: t.z + nx * j });
          this.shootQueue--;
          this.shootGap = BOSS.shootGap;
        } else {
          this.shootQueue = 0;
        }
      }
    }

    if (this.grounded && this.slamWindupT <= 0 && this.lungeWindupT <= 0 && this.lungeT <= 0) {
      this.hopCd -= dt;
      if (this.hopCd <= 0 && chasing) {
        this.hopCd = hopInterval;
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
          [hx, hz] = steerAroundTrees(this.x, this.z, hx, hz);
          this.vx = hx * hopSpeed;
          this.vz = hz * hopSpeed;
          this.vy = MOB.hopUp;
          this.grounded = false;
        }
      } else if (this.hopCd <= 0) {
        // Праздношатание вне боя: лениво скачем к точке в пределах wanderRadius от дома.
        this.hopCd = MOB.idleHopInterval * (0.7 + Math.random() * 0.7);
        const wr = isBoss ? BOSS.wanderRadius : MOB.wanderRadius;
        let wdx = this.wanderX - this.x;
        let wdz = this.wanderZ - this.z;
        if (Math.hypot(wdx, wdz) < 1.5) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.sqrt(Math.random()) * wr;
          this.wanderX = this.homeX + Math.cos(a) * r;
          this.wanderZ = this.homeZ + Math.sin(a) * r;
          wdx = this.wanderX - this.x;
          wdz = this.wanderZ - this.z;
        }
        const wl = Math.hypot(wdx, wdz) || 1;
        const [hx, hz] = steerAroundTrees(this.x, this.z, wdx / wl, wdz / wl);
        const spd = isBoss ? MOB.idleHopSpeed * 0.7 : MOB.idleHopSpeed;
        this.vx = hx * spd;
        this.vz = hz * spd;
        this.vy = MOB.hopUp * 0.7;
        this.grounded = false;
        this.yaw = Math.atan2(hx, hz);
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

    // не проходит сквозь стволы деревьев
    for (const t of OBSTACLES) {
      const tx = this.x - t.x;
      const tz = this.z - t.z;
      const clr = t.r + MOB.bodyRadius * this.scale;
      const td = Math.hypot(tx, tz);
      if (td > 1e-4 && td < clr) {
        const push = (clr - td) / td;
        this.x += tx * push;
        this.z += tz * push;
        // Гасим скорость внутрь ствола, иначе моб упрётся и будет дрожать.
        const inward = (this.vx * tx + this.vz * tz) / td;
        if (inward < 0) {
          this.vx -= (tx / td) * inward;
          this.vz -= (tz / td) * inward;
        }
      }
    }

    // не проходит сквозь игроков
    for (const p of players) {
      const gx = this.x - p.x;
      const gz = this.z - p.z;
      const gd = Math.hypot(gx, gz);
      const clr = PLAYER.radius + MOB.bodyRadius * this.scale;
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

    if (chasing && np && !isBoss) {
      if (this.ranged) {
        if (dist < SPITTER.fireRange && this.attackCd <= 0) {
          this.attackCd = SPITTER.fireCooldown;
          spit(this, np);
        }
      } else if (dist < MOB.attackRange && this.attackCd <= 0) {
        this.attackCd = MOB.attackCooldown;
        hits.push({
          target: np.sessionId,
          dmg: MOB.attackDamage,
          fromX: this.x,
          fromZ: this.z,
          projectile: false,
        });
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
    this.wanderX = this.x;
    this.wanderZ = this.z;
    this.y = terrainHeight(this.x, this.z) + 5;
    this.slamCd = BOSS.slamCooldown;
    this.slamWindupT = 0;
    this.lungeCd = 0;
    this.lungeWindupT = 0;
    this.lungeT = 0;
    this.shootCd = BOSS.shootCooldown;
    this.shootQueue = 0;
    this.shootGap = 0;
    this.splitsDone = 0;
    this.hp = this.maxHp;
    this.dead = false;
    this.aggroed = false;
    this.outOfRange = 0;
    this.vx = this.vy = this.vz = 0;
    this.grounded = false;
  }
}

/** Лут, лежащий на земле. Тает через BAG.dropLife секунд. */
class Drop {
  readonly id = nid();
  life = 0;

  constructor(
    readonly item: ItemId,
    readonly count: number,
    readonly x: number,
    readonly y: number,
    readonly z: number,
  ) {}

  /** true — пора убрать. Оружие не тает: лежит, пока его не подберут. */
  tick(dt: number): boolean {
    if (ITEMS[this.item].weapon) return false;
    this.life += dt;
    return this.life > BAG.dropLife;
  }
}

/** Лут на земле в виде простых данных — для сохранения между запусками. */
export interface DropSave {
  item: ItemId;
  count: number;
  x: number;
  y: number;
  z: number;
  life: number;
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
    public boss = false,
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
        // «Откуда» — точка ВВЕРХ по траектории, а не текущая позиция шара:
        // на скорости плевок за тик пролетает мимо игрока, и направление
        // "от игрока к шару" могло указывать вбок/назад — блок щитом мимо.
        const vh = Math.hypot(this.vx, this.vz) || 1;
        hits.push({
          target: p.sessionId,
          dmg: SPITTER.ballDamage,
          fromX: this.x - (this.vx / vh) * 4,
          fromZ: this.z - (this.vz / vh) * 4,
          projectile: true,
        });
        return true;
      }
    }
    return false;
  }
}

/**
 * Огненный снаряд игрока (посох). Летит по прямой с лёгкой гравитацией,
 * бьёт мобов и кукол; урон и радиус уже посчитаны при касте.
 */
class Bolt {
  readonly id = nid();
  life = 0;
  constructor(
    public x: number,
    public y: number,
    public z: number,
    public vx: number,
    public vy: number,
    public vz: number,
    public readonly radius: number,
    public readonly dmg: number,
    public readonly owner: string,
    public readonly maxLife: number,
  ) {}
}

/** Авторитетная симуляция зоны: мобы, куклы, плевки, снаряды игроков. */
export class ZoneSim {
  readonly mobs = new Map<string, Mob>();
  readonly dummies = new Map<string, Dummy>();
  readonly balls = new Map<string, Ball>();
  readonly bolts = new Map<string, Bolt>();
  readonly drops = new Map<string, Drop>();
  private boss!: Mob;

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
    // Босс — в дальнем углу.
    this.boss = new Mob("boss", BOSS.home[0], BOSS.home[1]);
    this.mobs.set(this.boss.id, this.boss);
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
        mob.kind === "boss",
      );
      this.balls.set(b.id, b);
    };

    for (const m of this.mobs.values()) m.tick(dt, players, hits, spit);
    for (const d of this.dummies.values()) d.tick(dt);
    for (const [id, b] of this.balls) if (b.tick(dt, players, hits)) this.balls.delete(id);
    this.boltXp.length = 0;
    for (const [id, bo] of this.bolts) if (this.tickBolt(bo, dt)) this.bolts.delete(id);
    for (const [id, d] of this.drops) if (d.tick(dt)) this.drops.delete(id);
    return hits;
  }

  /** Опыт с добитых снарядами игрока мобов за последний тик: комната разошлёт. */
  readonly boltXp: { owner: string; xp: number }[] = [];

  /** Запустить огненный снаряд игрока. */
  castBolt(
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
    speed: number,
    radius: number,
    dmg: number,
    owner: string,
    life: number,
  ): void {
    if (this.bolts.size >= 24) {
      const first = this.bolts.keys().next().value as string | undefined;
      if (first) this.bolts.delete(first);
    }
    const dl = Math.hypot(dx, dy, dz) || 1;
    const b = new Bolt(
      x, y, z,
      (dx / dl) * speed, (dy / dl) * speed, (dz / dl) * speed,
      radius, dmg, owner, life,
    );
    this.bolts.set(b.id, b);
  }

  /** true — снаряд отработал, удалить. */
  private tickBolt(b: Bolt, dt: number): boolean {
    const px = b.x;
    const py = b.y;
    const pz = b.z;
    b.vy -= SPITTER.ballGravity * 0.35 * dt; // огонь почти не проседает
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    b.life += dt;
    if (b.life > b.maxLife) return true;
    if (b.y <= terrainHeight(b.x, b.z)) return true;

    for (const m of this.mobs.values()) {
      if (m.dead) continue;
      const r = b.radius + MOB.bodyRadius * m.scale;
      const d = segDist(px, py, pz, b.x, b.y, b.z, m.x, m.y, m.z, m.x, m.y + MOB.bodyRadius * m.scale, m.z);
      if (d < r) {
        const vh = Math.hypot(b.vx, b.vz) || 1;
        const xp = this.hitMob(m.id, b.dmg, b.vx / vh, b.vz / vh);
        if (xp > 0) this.boltXp.push({ owner: b.owner, xp });
        return true;
      }
    }
    for (const d of this.dummies.values()) {
      if (d.dead) continue;
      const dist = segDist(px, py, pz, b.x, b.y, b.z, d.x, d.y, d.z, d.x, d.y + 0.9, d.z);
      if (dist < b.radius + 0.5) {
        this.hitDummy(d.id, b.dmg);
        return true;
      }
    }
    return false;
  }

  /** Урон по мобу. Возвращает опыт за добивание (0 — если не убит). */
  hitMob(id: string, dmg: number, dx: number, dz: number): number {
    const m = this.mobs.get(id);
    if (!m) return 0;
    const killed = m.applyHit(dmg, dx, dz);

    if (m.kind === "boss" && m.pendingSplit) {
      m.pendingSplit = false;
      this.spawnShards(m);
    }

    if (!killed) return 0;

    if (m.kind === "shard") {
      this.mobs.delete(m.id); // осколки не возрождаются
      return m.xp;
    }
    if (m.kind === "boss") {
      // Босс пал — осколки осыпаются.
      for (const [sid, s] of this.mobs) if (s.kind === "shard") this.mobs.delete(sid);
    }
    this.spawnLoot(m);
    return m.xp;
  }

  /** Выбросить осколки вокруг босса. */
  private spawnShards(boss: Mob): void {
    for (let i = 0; i < BOSS.splitCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = new Mob("shard", boss.x + Math.cos(a) * 1.6, boss.z + Math.sin(a) * 1.6);
      s.forceAggro();
      this.mobs.set(s.id, s);
    }
  }

  /** Разыграть и разложить добычу вокруг убитого моба. */
  private spawnLoot(m: Mob): void {
    for (const { id, count } of rollLoot(m.kind, Math.random)) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * BAG.dropSpread;
      const x = m.x + Math.cos(a) * r;
      const z = m.z + Math.sin(a) * r;
      const d = new Drop(id, count, x, terrainHeight(x, z) + BAG.dropHeight, z);
      this.drops.set(d.id, d);
    }
  }

  /** Положить оружие на землю. Базовое не роняем — оно всегда доступно. */
  dropWeapon(cls: WeaponClass, tier: WeaponTier, x: number, z: number): void {
    if (tier === "base") return;
    const item = WEAPON_DROP[weaponKey(cls, tier)];
    if (!item) return;
    const d = new Drop(item, 1, x, terrainHeight(x, z) + BAG.dropHeight, z);
    this.drops.set(d.id, d);
  }

  /** Весь лут на земле — чтобы записать его перед остановкой сервера. */
  saveDrops(): DropSave[] {
    return [...this.drops.values()].map((d) => ({
      item: d.item,
      count: d.count,
      x: d.x,
      y: d.y,
      z: d.z,
      life: d.life,
    }));
  }

  /** Вернуть лут в мир после перезапуска. */
  restoreDrops(list: DropSave[]): void {
    for (const s of list) {
      if (!s || !isItemId(s.item)) continue;
      const count = Math.floor(Number(s.count));
      if (!Number.isFinite(count) || count <= 0) continue;
      const d = new Drop(s.item, count, Number(s.x), Number(s.y), Number(s.z));
      if (!Number.isFinite(d.x) || !Number.isFinite(d.y) || !Number.isFinite(d.z)) continue;
      d.life = Number.isFinite(s.life) ? Number(s.life) : 0;
      this.drops.set(d.id, d);
    }
  }

  /** Убрать весь лежащий лут. Возвращает, сколько предметов было. */
  clearDrops(): number {
    const n = this.drops.size;
    this.drops.clear();
    return n;
  }

  /** Забрать лут из мира. null — его уже нет (успел другой игрок). */
  takeDrop(id: string): Drop | null {
    const d = this.drops.get(id);
    if (!d) return null;
    this.drops.delete(id);
    return d;
  }

  hitDummy(id: string, dmg: number): void {
    this.dummies.get(id)?.applyHit(dmg);
  }

  /**
   * Центр тела цели в мире — сервер меряет по нему досягаемость удара.
   * null — цели нет или она уже мертва.
   */
  targetCenter(target: "mob" | "dummy", id: string): { x: number; y: number; z: number } | null {
    if (target === "dummy") {
      const d = this.dummies.get(id);
      if (!d || d.dead) return null;
      return { x: d.x, y: d.y + DUMMY_CENTER_Y, z: d.z };
    }
    const m = this.mobs.get(id);
    if (!m || m.dead) return null;
    return { x: m.x, y: m.y + MOB.bodyRadius * m.scale, z: m.z };
  }
}
