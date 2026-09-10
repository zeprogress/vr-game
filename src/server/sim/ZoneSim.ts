import {
  BOSS,
  BOSS_CFG,
  COMBAT,
  ELITE_MOBS,
  MOB,
  MOB_CAMPS,
  PLAYER,
  SHARD,
  SHARD_CFG,
  SLIME_CFG,
  SPITTER,
  SPITTER_CFG,
} from "#shared/constants";
import { terrainHeight } from "#shared/terrain";
import { HUB, HUB_CENTER } from "#shared/hub";
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
  "staff:gold": "gold_staff",
  "sword:legendary": "leg_sword",
  "bow:legendary": "leg_bow",
  "shield:legendary": "leg_shield",
  "staff:legendary": "leg_staff",
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
 * Выталкивает точку спавна моба за пределы лагеря (HUB): в безопасной зоне
 * мобов быть не должно. Толкаем радиально от центра лагеря.
 */
function awayFromHub(x: number, z: number): [number, number] {
  const dx = x - HUB_CENTER.x;
  const dz = z - HUB_CENTER.z;
  const d = Math.hypot(dx, dz);
  if (d >= HUB.mobExclusionRadius) return [x, z];
  const k = d < 1e-3 ? 1 : HUB.mobExclusionRadius / d;
  return [HUB_CENTER.x + dx * k * 1.05, HUB_CENTER.z + dz * k * 1.05];
}

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

/** Вклад одного участника в бой с боссом. */
interface BossContrib {
  dmg: number;
  heal: number;
  taken: number;
  /** sim-время (сек) последнего вклада — для окна давности. */
  last: number;
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
  /** id моба-источника урона (плевун, слизень) — бот по нему переключается. */
  byMob?: string;
}

class Mob {
  readonly id = nid();
  x: number;
  y: number;
  z: number;
  yaw = 0;
  /** Куда моб смотрит в покое (сейчас задаётся только боссу — в сторону поляны). */
  restYaw = 0;
  faceRest = false;
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
  /** Плевун: сколько уже пятится и сколько ещё нельзя пятиться. */
  private retreatT = 0;
  private restT = 0;
  private retreatSide = Math.random() < 0.5 ? 1 : -1;
  private hurtCd = 0;
  private aggroed = false;
  private outOfRange = 0;
  hurtSeq = 0;
  /** ++ на каждую атаку (укус, плевок, слэм) — клиент играет замах моба. */
  attackSeq = 0;
  hurtDx = 0;
  hurtDz = 0;
  private readonly homeX: number;
  private readonly homeZ: number;
  readonly ranged: boolean;
  readonly xp: number;
  readonly scale: number;
  /**
   * Вклад участников боя с боссом (для гибридного дележа опыта):
   * урон боссу, лечение союзников, полученный от босса урон + метка времени
   * последнего вклада (окно давности отсекает «бил час назад» и залипшие
   * записи ботов).
   */
  readonly contrib = new Map<string, BossContrib>();

  /** Записать вклад в бой с боссом. */
  bump(owner: string, field: "dmg" | "heal" | "taken", amount: number, now: number): void {
    if (!owner || amount <= 0) return;
    let c = this.contrib.get(owner);
    if (!c) {
      c = { dmg: 0, heal: 0, taken: 0, last: 0 };
      this.contrib.set(owner, c);
    }
    c[field] += amount;
    c.last = now;
  }

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
  private shootCd: number = BOSS.shootCooldown;
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

  /** Множитель урона усиленного («элитного») моба из лагеря. 1 — обычный. */
  readonly dmgMul: number;
  /** Броня против дальнего боя (0..1): доля урона стрел/магии, которую съедает панцирь. */
  readonly rangedArmor: number;
  /** Модель из пака для этого моба (ключ MODELS на клиенте). Пусто — стандарт. */
  readonly model: string;
  /** Переопределение имени/уровня в плашке (усиленные мобы). Пусто/0 — по kind. */
  readonly eliteName: string;
  readonly eliteLevel: number;
  /** true — моб парит и не прыгает (пчела). */
  readonly flying: boolean;
  /** Фаза покачивания в полёте (жужжание). */
  private flyBob = Math.random() * 6.28;

  constructor(
    readonly kind: MobKind,
    hx: number,
    hz: number,
    /** Усиленный моб лагеря — множители и вид поверх базового моба этого kind. */
    opts: {
      model?: string;
      name?: string;
      level?: number;
      hp?: number;
      dmgMul?: number;
      xp?: number;
      scaleMul?: number;
      flying?: boolean;
      rangedArmor?: number;
    } = {},
  ) {
    this.model = opts.model ?? "";
    this.eliteName = opts.name ?? "";
    this.eliteLevel = opts.level ?? 0;
    this.flying = opts.flying ?? false;
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
    this.hp = opts.hp ?? cfg.hp;
    this.maxHp = this.hp;
    this.ranged = cfg.ranged;
    this.xp = opts.xp ?? cfg.xp;
    this.dmgMul = opts.dmgMul ?? 1;
    this.rangedArmor = Math.max(0, Math.min(0.95, opts.rangedArmor ?? 0));
    const base = kind === "boss" ? BOSS.scale : kind === "shard" ? SHARD.scale : 1;
    this.scale = base * (opts.scaleMul ?? 1);
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
  /** Секунд, пока моб пригвождён к земле (град стрел) — не может двигаться. */
  private rootedT = 0;
  get rooted(): boolean {
    return this.rootedT > 0;
  }

  /** Пригвоздить к земле на `sec` секунд: моб стоит, но бить не перестаёт. */
  root(sec: number): void {
    if (this.dead || this.kind === "boss") return; // босса не пришпилить
    this.rootedT = Math.max(this.rootedT, sec);
  }

  /** Секунд оглушения — моб не двигается И не атакует (оглушающий удар воина). */
  private stunnedT = 0;
  get stunned(): boolean {
    return this.stunnedT > 0;
  }
  /** Оглушить на `sec` секунд. Босс — иммунен (стан-локать нельзя). */
  stun(sec: number): void {
    if (this.dead || this.kind === "boss") return;
    this.stunnedT = Math.max(this.stunnedT, sec);
  }

  /** Горение от Пламенного меча: DoT `dps` на `sec` секунд, опыт — тому, кто поджёг. */
  burningT = 0;
  burnDps = 0;
  burnBy = "";
  ignite(dps: number, sec: number, by: string): void {
    if (this.dead || this.kind === "boss" || this.kind === "shard") return;
    this.burningT = Math.max(this.burningT, sec);
    this.burnDps = Math.max(this.burnDps, dps);
    this.burnBy = by;
  }

  /** Отбросить моба: сильный импульс от источника (рассекающий удар и т.п.). */
  shove(dx: number, dz: number, power: number): void {
    if (this.dead || this.kind === "boss") return; // босса с места не сдвинуть
    this.vx += dx * power;
    this.vz += dz * power;
    this.vy += power * 0.35;
    this.grounded = false;
  }

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
    // Обычный удар НЕ толкает моба — ни воин, ни кто-либо. Отбрасывание есть
    // только у замах-скиллов через shove(). Направление удара запоминаем для
    // вздрагивания на клиенте.
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
    if (this.stunnedT > 0) this.stunnedT = Math.max(0, this.stunnedT - dt);
    // Плевун: отход выдыхается, потом пауза, в которую его можно догнать.
    if (this.restT > 0) {
      this.restT -= dt;
      if (this.restT <= 0) this.retreatSide = Math.random() < 0.5 ? 1 : -1;
    } else if (this.retreatT > 0) {
      // Копится только пока он реально пятится (см. ниже), само по себе тает.
      this.retreatT -= dt * 0.35;
      if (this.retreatT < 0) this.retreatT = 0;
    }

    if (this.dead) {
      this.deadT += dt;
      this.y -= dt * 0.6;
      this.respawnIn -= dt;
      if (this.respawnIn <= 0) this.respawn();
      return;
    }

    // ближайший игрок. Босс не гонится за теми, кто ушёл далеко от его угла
    // (иначе рейд-боты, погибнув и возродившись на спавне, утаскивали его
    // через всю карту).
    // Пока агрит — тянется за игроком далеко (chaseLeash), может выйти из угла.
    // Вне боя круг маленький: не уходит на поляну сам.
    const bossLeash =
      this.kind === "boss"
        ? this.aggroed
          ? BOSS.chaseLeash
          : BOSS.aggroRange + BOSS.wanderRadius
        : Infinity;
    let np: SimPlayer | null = null;
    let best = Infinity;
    for (const p of players) {
      if ((p.x - this.homeX) ** 2 + (p.z - this.homeZ) ** 2 > bossLeash * bossLeash) continue;
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

    // Босс, пока стоит на месте у себя в углу и не замахивается, смотрит в
    // сторону поляны (оттуда приходят герои). Активный бой (движение/замах)
    // это сам отключает; далёкий аггро одиночного бота картину не ломает.
    const bossFacingMeadow =
      this.faceRest &&
      this.grounded &&
      this.slamWindupT <= 0 &&
      this.lungeWindupT <= 0 &&
      this.lungeT <= 0 &&
      this.shootQueue === 0 &&
      Math.hypot(this.vx, this.vz) < 0.25 &&
      (this.x - this.homeX) ** 2 + (this.z - this.homeZ) ** 2 < (BOSS.wanderRadius + 4) ** 2;

    const rage = this.enraged ? BOSS.rageSpeedMult : 1;
    const rageRate = this.enraged ? BOSS.rageRateMult : 1;
    const rageDmg = this.enraged ? BOSS.rageDamageMult : 1;
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
          this.attackSeq = (this.attackSeq + 1) & 0xffff;
          this.slamCd = BOSS.slamCooldown / rageRate;
          this.vy = MOB.hopUp * 0.6;
          this.grounded = false;
          for (const p of players) {
            if (Math.hypot(p.x - this.x, p.z - this.z) > BOSS.slamRadius) continue;
            hits.push({
              target: p.sessionId,
              dmg: BOSS.slamDamage * rageDmg,
              fromX: this.x,
              fromZ: this.z,
              byMob: this.id,
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
          this.lungeCd = BOSS.lungeCooldown / rageRate;
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
              dmg: BOSS.lungeDamage * rageDmg,
              fromX: this.x,
              fromZ: this.z,
              byMob: this.id,
              projectile: false,
            });
            this.attackSeq = (this.attackSeq + 1) & 0xffff;
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
        this.shootCd = BOSS.shootCooldown / rageRate;
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

    if (this.rootedT > 0 || this.stunnedT > 0) {
      // Пригвождён (град стрел) или оглушён (удар воина): с места не двигается.
      this.rootedT = Math.max(0, this.rootedT - dt);
      this.vx = 0;
      this.vz = 0;
      // Оглушённый летун застывает в воздухе; пригвождённый — падает как все.
      if (this.stunnedT > 0 && this.flying) this.vy = 0;
      else this.vy -= MOB.gravity * dt;
    } else if (this.flying) {
      // Пчела: парит на высоте, не прыгает — плавно рулит к цели / точке блуждания.
      let tx = 0;
      let tz = 0;
      if (chasing && dist > MOB.attackRange * 0.7) {
        tx = dx;
        tz = dz;
      } else if (!chasing) {
        let wdx = this.wanderX - this.x;
        let wdz = this.wanderZ - this.z;
        if (Math.hypot(wdx, wdz) < 1.2) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.sqrt(Math.random()) * MOB.wanderRadius;
          this.wanderX = this.homeX + Math.cos(a) * r;
          this.wanderZ = this.homeZ + Math.sin(a) * r;
          wdx = this.wanderX - this.x;
          wdz = this.wanderZ - this.z;
        }
        const wl = Math.hypot(wdx, wdz) || 1;
        tx = wdx / wl;
        tz = wdz / wl;
      }
      const spd = chasing ? hopSpeed : MOB.idleHopSpeed * 1.2;
      const [sx, sz] = tx !== 0 || tz !== 0 ? steerAroundTrees(this.x, this.z, tx, tz) : [0, 0];
      const acc = Math.min(1, dt * 4);
      this.vx += (sx * spd - this.vx) * acc;
      this.vz += (sz * spd - this.vz) * acc;
      this.x += this.vx * dt;
      this.z += this.vz * dt;
      this.flyBob += dt * 9;
      this.y = terrainHeight(this.x, this.z) + 1.35 + Math.sin(this.flyBob) * 0.12;
      this.vy = 0;
      this.grounded = true; // клиент: без прыжков/приземлений
      if (!bossFacingMeadow && Math.hypot(this.vx, this.vz) > 0.15) this.yaw = Math.atan2(this.vx, this.vz);
    } else if (
      this.grounded &&
      this.slamWindupT <= 0 &&
      this.lungeWindupT <= 0 &&
      this.lungeT <= 0
    ) {
      this.hopCd -= dt;
      if (this.hopCd <= 0 && chasing) {
        this.hopCd = hopInterval;
        let hx = 0;
        let hz = 0;
        let retreating = false;
        if (this.ranged) {
          if (dist < SPITTER.keepDistance && this.restT <= 0) {
            // Отход по диагонали, а не строго назад: так он кружит, а не
            // убегает по прямой от преследователя.
            hx = -dx * 0.75 - dz * this.retreatSide * 0.66;
            hz = -dz * 0.75 + dx * this.retreatSide * 0.66;
            retreating = true;
            this.retreatT += hopInterval;
            if (this.retreatT >= SPITTER.retreatBurst) {
              this.retreatT = 0;
              this.restT = SPITTER.retreatRest;
            }
          } else if (dist < SPITTER.keepDistance) {
            // Выдохся — только вбок, дистанцию больше не набирает.
            hx = -dz * this.retreatSide;
            hz = dx * this.retreatSide;
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
          const spd = retreating ? hopSpeed * SPITTER.retreatSpeed : hopSpeed;
          this.vx = hx * spd;
          this.vz = hz * spd;
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
        if (!this.faceRest) this.yaw = Math.atan2(hx, hz);
      }
    } else {
      this.vy -= MOB.gravity * dt;
    }

    // Летающий уже проинтегрировал x/z и выставил y выше — не трогаем.
    // Но пригвождённый летун падает как обычный моб, поэтому и он сюда идёт.
    if (!this.flying || this.rootedT > 0) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.z += this.vz * dt;
    }

    // Босс не покидает свой угол: жёсткий поводок к дому (в бою всё равно
    // может гоняться в пределах арены, но не убегать через всю карту).
    if (this.kind === "boss") {
      const hdx = this.x - this.homeX;
      const hdz = this.z - this.homeZ;
      const hd = Math.hypot(hdx, hdz);
      // Жёсткая стена — всегда chaseLeash. Домой вне боя босс возвращается сам
      // (idle-скачки нацелены в точку у дома), без телепорта-рывка к углу.
      const maxHd = BOSS.chaseLeash;
      if (hd > maxHd) {
        this.x = this.homeX + (hdx / hd) * maxHd;
        this.z = this.homeZ + (hdz / hd) * maxHd;
        this.vx *= 0.3;
        this.vz *= 0.3;
      }
    }

    if (!this.flying || this.rootedT > 0) {
      const gy = terrainHeight(this.x, this.z);
      if (this.y <= gy) {
        this.y = gy;
        this.vy = 0;
        this.vx *= 0.25;
        this.vz *= 0.25;
        this.grounded = true;
      }
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
    const bodyR =
      this.kind === "boss" ? MOB.bodyRadius * this.scale * BOSS.bodyMult : MOB.bodyRadius * this.scale;
    for (const p of players) {
      const gx = this.x - p.x;
      const gz = this.z - p.z;
      const gd = Math.hypot(gx, gz);
      const clr = PLAYER.radius + bodyR;
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

    if (chasing && !bossFacingMeadow) this.yaw = Math.atan2(dx, dz);
    if (bossFacingMeadow) {
      let dyaw = this.restYaw - this.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      this.yaw += dyaw * Math.min(1, dt * 1.5);
    }

    if (chasing && np && !isBoss && this.stunnedT <= 0) {
      if (this.ranged) {
        if (dist < SPITTER.fireRange && this.attackCd <= 0) {
          this.attackCd = SPITTER.fireCooldown;
          this.attackSeq = (this.attackSeq + 1) & 0xffff;
          spit(this, np);
        }
      } else if (dist < MOB.attackRange && this.attackCd <= 0) {
        this.attackCd = MOB.attackCooldown;
        this.attackSeq = (this.attackSeq + 1) & 0xffff;
        hits.push({
          target: np.sessionId,
          dmg: MOB.attackDamage * this.dmgMul,
          fromX: this.x,
          fromZ: this.z,
          projectile: false,
          byMob: this.id,
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
    this.contrib.clear();
    this.hp = this.maxHp;
    this.dead = false;
    this.aggroed = false;
    this.outOfRange = 0;
    this.vx = this.vy = this.vz = 0;
    this.grounded = false;
    if (this.faceRest) this.yaw = this.restYaw;
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
    /** id моба, который выстрелил (для переключения цели бота). */
    public owner = "",
    /** Множитель урона плевка усиленного моба. */
    public dmgMul = 1,
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
          dmg: SPITTER.ballDamage * this.dmgMul,
          fromX: this.x - (this.vx / vh) * 4,
          fromZ: this.z - (this.vz / vh) * 4,
          projectile: true,
          byMob: this.owner || undefined,
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
    public readonly hitRadius: number,
    public readonly dmg: number,
    public readonly owner: string,
    public readonly maxLife: number,
    /** 0 — огнешар, 1 — стрела (меньше гравитации, свой вид на клиенте). */
    public readonly kind: number = 0,
    /** АОЕ в точке попадания: радиус (м) и урон в эпицентре. 0 — без сплэша. */
    public readonly splashR: number = 0,
    public readonly splashDmg: number = 0,
    /** Крит: при попадании комната покажет красный «X» в точке. */
    public readonly crit: boolean = false,
  ) {}
}

/** Авторитетная симуляция зоны: мобы, куклы, плевки, снаряды игроков. */
export class ZoneSim {
  /** Админ-панель пульта: false — мобы замирают на месте (не тикают вовсе). */
  mobsEnabled = true;
  readonly mobs = new Map<string, Mob>();
  readonly dummies = new Map<string, Dummy>();
  readonly balls = new Map<string, Ball>();
  readonly bolts = new Map<string, Bolt>();
  readonly drops = new Map<string, Drop>();
  private boss!: Mob;
  /** sim-время в секундах (для окна давности вклада в бой с боссом). */
  private elapsed = 0;
  /** Слизни, доспавненные под наплыв игроков (`!play`). Убираются, когда толпа расходится. */
  private readonly extraSlimes = new Map<string, Mob>();
  /** Мобы активного динамического события (этап 14): не возрождаются, при
   *  смерти сразу удаляются, считаются для HUD-строки. */
  readonly eventMobs = new Set<string>();
  /** Кто нанёс урон мобам события — участники (для баффа за победу). */
  readonly eventDamagers = new Set<string>();

  constructor() {
    for (let i = 0; i < MOB.count; i++) {
      const a = (i / MOB.count) * Math.PI * 2 + 0.4;
      const r = 22 + Math.random() * 12;
      const [x, z] = awayFromHub(Math.cos(a) * r, Math.sin(a) * r - 4);
      const m = new Mob("slime", x, z);
      this.mobs.set(m.id, m);
    }
    const [rMin, rMax] = SPITTER.spawnRadius;
    for (let i = 0; i < SPITTER.count; i++) {
      const a = (i / SPITTER.count) * Math.PI * 2 + 1.1;
      const r = rMin + Math.random() * (rMax - rMin);
      const [x, z] = awayFromHub(Math.cos(a) * r, Math.sin(a) * r - 4);
      const m = new Mob("spitter", x, z);
      this.mobs.set(m.id, m);
    }
    // Лагеря усиленных мобов по свободным местам карты.
    for (const camp of MOB_CAMPS) {
      const def = ELITE_MOBS[camp.type];
      for (let i = 0; i < camp.count; i++) {
        const a = (i / camp.count) * Math.PI * 2 + camp.x;
        const r = camp.spread * (0.35 + Math.random() * 0.65);
        const [x, z] = awayFromHub(camp.x + Math.cos(a) * r, camp.z + Math.sin(a) * r);
        const m = new Mob(def.kind, x, z, {
          model: def.model,
          name: def.name,
          level: def.level,
          hp: def.hp,
          dmgMul: def.dmgMul,
          scaleMul: def.scaleMul,
          xp: def.xp,
          flying: def.flying,
          rangedArmor: def.rangedArmor,
        });
        this.mobs.set(m.id, m);
      }
    }

    // Босс — в дальнем углу, лицом к поляне (центр мира).
    this.boss = new Mob("boss", BOSS.home[0], BOSS.home[1]);
    this.boss.restYaw = Math.atan2(-BOSS.home[0], -BOSS.home[1]);
    this.boss.yaw = this.boss.restYaw;
    this.boss.faceRest = true;
    this.mobs.set(this.boss.id, this.boss);
    // Чучела — на тренировочной площадке лагеря (HUB).
    for (const t of HUB.training.dummies) {
      const d = new Dummy(t.x, terrainHeight(t.x, t.z), t.z);
      this.dummies.set(d.id, d);
    }
  }

  /**
   * Держать `n` дополнительных слизней на поляне (ZoneRoom зовёт с числом,
   * пропорциональным толпе `!play`-ботов). Меньше — лишних убираем (мёртвых в
   * первую очередь), больше — доспавниваем у случайных точек поляны.
   */
  setExtraSlimes(n: number): void {
    n = Math.max(0, Math.min(40, Math.floor(n)));
    while (this.extraSlimes.size > n) {
      // сперва мёртвые/деспавненные, иначе любой
      let victim: string | undefined;
      for (const [id, m] of this.extraSlimes) {
        if (m.dead) { victim = id; break; }
        victim ??= id;
      }
      if (!victim) break;
      this.extraSlimes.delete(victim);
      this.mobs.delete(victim);
    }
    while (this.extraSlimes.size < n) {
      const a = Math.random() * Math.PI * 2;
      const r = 18 + Math.random() * 16;
      const [x, z] = awayFromHub(Math.cos(a) * r, Math.sin(a) * r - 4);
      const m = new Mob("slime", x, z);
      this.mobs.set(m.id, m);
      this.extraSlimes.set(m.id, m);
    }
  }

  /** Заспавнить моба события в точке (x,z) с разбросом; агрит сразу. Вернёт id. */
  spawnEventMob(
    kind: MobKind,
    x: number,
    z: number,
    opts: ConstructorParameters<typeof Mob>[3] = {},
  ): string {
    const m = new Mob(kind, x, z, opts);
    m.forceAggro();
    this.mobs.set(m.id, m);
    this.eventMobs.add(m.id);
    return m.id;
  }

  /** Сколько живых мобов события осталось. */
  eventMobsLeft(): number {
    let n = 0;
    for (const id of this.eventMobs) {
      const m = this.mobs.get(id);
      if (m && !m.dead) n++;
    }
    return n;
  }

  /** Снять всех мобов события (событие утихло/зачищено). */
  clearEventMobs(): void {
    for (const id of this.eventMobs) this.mobs.delete(id);
    this.eventMobs.clear();
  }

  /** Россыпь зелий в точке (награда за событие). */
  /** Награда за событие — зелья РАЗБРОСАНЫ по площадке (spread — радиус, м). */
  dropPotions(x: number, z: number, count: number, spread = 6): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = spread * (0.35 + Math.random() * 0.65);
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      const d = new Drop("potion", 1, px, terrainHeight(px, pz) + BAG.dropHeight, pz);
      this.drops.set(d.id, d);
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
        mob.id,
        mob.dmgMul,
      );
      this.balls.set(b.id, b);
    };

    this.elapsed += dt;
    if (this.mobsEnabled) for (const m of this.mobs.values()) m.tick(dt, players, hits, spit);
    this.tickBurning(dt);
    this.separateMobs();
    for (const d of this.dummies.values()) d.tick(dt);
    for (const [id, b] of this.balls) if (b.tick(dt, players, hits)) this.balls.delete(id);
    for (const [id, bo] of this.bolts) if (this.tickBolt(bo, dt)) this.bolts.delete(id);
    for (const [id, d] of this.drops) if (d.tick(dt)) this.drops.delete(id);
    // Полученный от босса урон — тоже вклад в бой (танк/приманка).
    const boss = this.boss;
    if (boss && !boss.dead) {
      for (const h of hits) {
        if (h.byMob === boss.id) boss.bump(h.target, "taken", h.dmg, this.elapsed);
      }
    }
    return hits;
  }

  /**
   * Мобы не влезают друг в друга: раздвигаем пересекающиеся тела после хода.
   * Босс «тяжёлый» — мелочь расступается перед ним, сам он не сдвигается.
   * Только позиция (не скорость): скорость крутит логика прыжков, а тут нужен
   * лишь запрет на наложение — иначе стая пчёл слипается в один комок.
   */
  private separateMobs(): void {
    const list: Mob[] = [];
    for (const m of this.mobs.values()) if (!m.dead) list.push(m);
    const bodyR = (m: Mob): number =>
      MOB.bodyRadius * m.scale * (m.kind === "boss" ? BOSS.bodyMult : 1);
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const ar = bodyR(a);
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const clr = ar + bodyR(b);
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        if (dx > clr || dx < -clr || dz > clr || dz < -clr) continue;
        const d2 = dx * dx + dz * dz;
        if (d2 >= clr * clr) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-4) {
          // Ровно друг в друге — расталкиваем по детерминированной оси.
          const ang = (i * 2.399963 + j) % (Math.PI * 2);
          dx = Math.cos(ang);
          dz = Math.sin(ang);
          d = 1e-4;
        } else {
          dx /= d;
          dz /= d;
        }
        const over = clr - d;
        const aBoss = a.kind === "boss";
        const bBoss = b.kind === "boss";
        // Доля коррекции: тяжёлый (босс) стоит, лёгкий уходит на всю глубину.
        const wa = aBoss === bBoss ? 0.5 : aBoss ? 0 : 1;
        const wb = 1 - wa;
        if (wa > 0) {
          a.x -= dx * over * wa;
          a.z -= dz * over * wa;
        }
        if (wb > 0) {
          b.x += dx * over * wb;
          b.z += dz * over * wb;
        }
      }
    }
  }

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
    hitRadius: number,
    dmg: number,
    owner: string,
    life: number,
    kind = 0,
    splashR = 0,
    splashDmg = 0,
    crit = false,
  ): void {
    if (this.bolts.size >= 24) {
      const first = this.bolts.keys().next().value as string | undefined;
      if (first) this.bolts.delete(first);
    }
    const dl = Math.hypot(dx, dy, dz) || 1;
    const b = new Bolt(
      x, y, z,
      (dx / dl) * speed, (dy / dl) * speed, (dz / dl) * speed,
      radius, hitRadius, dmg, owner, life, kind, splashR, splashDmg, crit,
    );
    this.bolts.set(b.id, b);
  }

  /** true — снаряд отработал, удалить. */
  private tickBolt(b: Bolt, dt: number): boolean {
    const px = b.x;
    const py = b.y;
    const pz = b.z;
    b.vy -= SPITTER.ballGravity * (b.kind === 1 ? 0.5 : 0.35) * dt; // стрела чуть проседает
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    b.life += dt;
    if (b.life > b.maxLife) return true;
    if (b.y <= terrainHeight(b.x, b.z)) {
      // Огнешар в землю — всё равно рвётся: можно бить по ногам толпы.
      this.splashDamage(b.x, b.y, b.z, b.splashR, b.splashDmg, "", b.owner, true);
      return true;
    }

    for (const m of this.mobs.values()) {
      if (m.dead) continue;
      const r = b.hitRadius + MOB.bodyRadius * m.scale;
      const d = segDist(px, py, pz, b.x, b.y, b.z, m.x, m.y, m.z, m.x, m.y + MOB.bodyRadius * m.scale, m.z);
      if (d < r) {
        const vh = Math.hypot(b.vx, b.vz) || 1;
        if (b.crit) this.critHits.push({ x: m.x, y: m.y, z: m.z, owner: b.owner });
        this.hitMob(m.id, b.dmg, b.vx / vh, b.vz / vh, b.owner, true);
        // Соседям — доля урона, спадающая к краю (прямая цель уже получила своё).
        this.splashDamage(b.x, b.y, b.z, b.splashR, b.splashDmg, m.id, b.owner, true);
        return true;
      }
    }
    for (const d of this.dummies.values()) {
      if (d.dead) continue;
      const dist = segDist(px, py, pz, b.x, b.y, b.z, d.x, d.y, d.z, d.x, d.y + 0.9, d.z);
      if (dist < b.hitRadius + 0.5) {
        this.hitDummy(d.id, b.dmg);
        return true;
      }
    }
    return false;
  }

  /**
   * Опыт за добитых мобов, поделённый между всеми, кто нанёс урон (босс —
   * гибридно, обычные мобы — пропорционально урону). Комната разошлёт.
   */
  readonly bossXpShare: { owner: string; xp: number }[] = [];
  readonly mobXpShare: { owner: string; xp: number }[] = [];
  /** Криты снарядов за тик: где показать красный «X». Комната разошлёт и очистит. */
  readonly critHits: { x: number; y: number; z: number; owner: string }[] = [];
  /** Добивания за тик: кто и кого добил (для счётчика kills и кил-фида). */
  readonly mobKills: { owner: string; kind: MobKind; name: string }[] = [];

  /** Урон по мобу. Возвращает kind добитого моба (null — не убит). */
  /** Тик горения (Пламенный меч): DoT по всем тлеющим мобам, опыт — поджёгшему. */
  private tickBurning(dt: number): void {
    for (const m of this.mobs.values()) {
      if (m.dead || m.burningT <= 0) continue;
      m.burningT = Math.max(0, m.burningT - dt);
      const tick = m.burnDps * dt;
      if (tick > 0) this.hitMob(m.id, tick, 0, 0, m.burnBy);
      if (m.burningT <= 0) {
        m.burnDps = 0;
        m.burnBy = "";
      }
    }
  }

  hitMob(
    id: string,
    dmg: number,
    dx: number,
    dz: number,
    attacker = "",
    /** true — попадание ДАЛЬНЕГО боя (стрела/огнешар/град): учитываем rangedArmor. */
    rangedHit = false,
  ): MobKind | null {
    const m = this.mobs.get(id);
    if (!m) return null;
    if (rangedHit && m.rangedArmor > 0) dmg *= 1 - m.rangedArmor;
    // Вклад считаем по ФАКТИЧЕСКИ снятому HP: удар мог не пройти (hurtCd),
    // а овеpкилл сверх остатка не должен раздувать долю.
    const hpBefore = m.hp;
    const killed = m.applyHit(dmg, dx, dz);
    const dealt = Math.max(0, hpBefore - m.hp);
    if (attacker && dealt > 0) {
      m.bump(attacker, "dmg", dealt, this.elapsed);
      if (this.eventMobs.has(id)) this.eventDamagers.add(attacker);
    }

    if (m.kind === "boss" && m.pendingSplit) {
      m.pendingSplit = false;
      this.spawnShards(m);
    }

    if (!killed) return null;
    const kind = m.kind;

    if (kind === "shard" || this.eventMobs.has(m.id)) {
      this.eventMobs.delete(m.id);
      this.mobs.delete(m.id); // осколки и мобы события не возрождаются
      if (kind !== "shard") this.splitMobXp(m);
      if (attacker && kind !== "shard") {
        this.mobKills.push({ owner: attacker, kind, name: m.eliteName });
      }
      return kind;
    } else {
      const rolled = this.spawnLoot(m);
      if (kind === "boss") {
        this.bossLoot.length = 0;
        this.bossLoot.push(...rolled);
      }
    }
    if (kind === "boss") {
      // Босс пал — осколки осыпаются.
      for (const [sid, s] of this.mobs) if (s.kind === "shard") this.mobs.delete(sid);
      this.splitBossXp(m);
    } else {
      this.splitMobXp(m);
    }
    if (attacker) {
      this.mobKills.push({ owner: attacker, kind, name: m.eliteName });
    }
    return kind;
  }

  /** Отбросить моба по id (рассекающий удар бота и т.п.). */
  shoveMob(id: string, dx: number, dz: number, power: number): void {
    this.mobs.get(id)?.shove(dx, dz, power);
  }

  /** Пригвоздить моба к земле по id (град стрел). */
  rootMob(id: string, sec: number): void {
    this.mobs.get(id)?.root(sec);
  }

  /** Оглушить моба по id (оглушающий удар воина). */
  stunMob(id: string, sec: number): void {
    this.mobs.get(id)?.stun(sec);
  }

  /**
   * Небольшой АОЕ вокруг точки (`x`,`y`,`z`): всем живым мобам в радиусе, кроме
   * `skipId` (прямая цель — свой урон уже получила), доля урона, спадающая от
   * эпицентра к краю. Урон идёт от `owner` — значит и опыт делится как обычно.
   */
  splashDamage(
    x: number,
    y: number,
    z: number,
    radius: number,
    dmg: number,
    skipId: string,
    owner: string,
    /** true — АОЕ от огнешара (дальний бой): броня мобов учитывается. */
    rangedHit = false,
  ): void {
    if (radius <= 0 || dmg <= 0) return;
    // Копия списка: hitMob может удалить моба (осколки) прямо в цикле.
    for (const m of [...this.mobs.values()]) {
      if (m.dead || m.id === skipId) continue;
      const dx = m.x - x;
      const dz = m.z - z;
      const body = MOB.bodyRadius * m.scale;
      const dy = m.y + body * 0.5 - y;
      const d = Math.hypot(dx, dz, dy) - body; // от края туши, не от центра
      if (d >= radius) continue;
      const k = 1 - Math.max(0, d) / radius; // спад к краю
      const hit = dmg * k;
      if (hit <= 0.01) continue;
      const hl = Math.hypot(dx, dz) || 1;
      this.hitMob(m.id, hit, dx / hl, dz / hl, owner, rangedHit);
    }
  }

  /**
   * Обычный моб: опыт делится между добившими урон пропорционально урону
   * (недавнему). Уровневый потолок накладывает уже комната.
   */
  private splitMobXp(m: Mob): void {
    const RECENCY = 20; // с
    let total = 0;
    const parts: [string, number][] = [];
    for (const [owner, c] of m.contrib) {
      if (this.elapsed - c.last > RECENCY || c.dmg <= 0) continue;
      parts.push([owner, c.dmg]);
      total += c.dmg;
    }
    m.contrib.clear();
    if (total <= 0) return;
    for (const [owner, d] of parts) {
      this.mobXpShare.push({ owner, xp: (m.xp * d) / total });
    }
  }

  /**
   * Гибридный делёж опыта с босса: половина пула — ПОРОВНУ между всеми
   * участниками боя, половина — ЗА ВКЛАД (урон + лечение союзников +
   * ½ полученного урона, сглажено √). Ни один не получает больше `cap` —
   * срезанное перераспределяется остальным. Уровневый потолок (не больше
   * ~уровня за раз) накладывает уже комната по `PlayerState.level`.
   */
  private splitBossXp(m: Mob): void {
    const RECENCY = 90; // с — вклад «протух», если давно ничего не делал
    const CAP_FRAC = 0.4; // не больше 40% пула в одни руки
    const EQUAL_FRAC = 0.5; // доля пула, что делится поровну

    const elig: { owner: string; score: number }[] = [];
    for (const [owner, c] of m.contrib) {
      if (this.elapsed - c.last > RECENCY) continue;
      // Допуск: заметный урон ЛИБО хоть как-то держал бой (танк/хилер).
      const meaningful = c.dmg >= m.maxHp * 0.03 || c.taken > 0 || c.heal > 0;
      if (!meaningful) continue;
      const raw = c.dmg + c.heal + c.taken * 0.5;
      elig.push({ owner, score: Math.sqrt(Math.max(0, raw)) });
    }
    if (elig.length === 0) {
      m.contrib.clear();
      return;
    }

    const pool = m.xp;
    const cap = pool * CAP_FRAC;
    const equalEach = (pool * EQUAL_FRAC) / elig.length;
    const perfPool = pool * (1 - EQUAL_FRAC);
    let scoreSum = 0;
    for (const e of elig) scoreSum += e.score;
    if (scoreSum <= 0) scoreSum = 1;

    const award = new Map<string, number>();
    for (const e of elig) {
      award.set(e.owner, Math.min(cap, equalEach + perfPool * (e.score / scoreSum)));
    }
    // Перераспределить срезанное потолком (один проход — достаточно).
    let given = 0;
    for (const v of award.values()) given += v;
    let leftover = pool - given;
    if (leftover > 0.01) {
      const room = elig.filter((e) => (award.get(e.owner) ?? 0) < cap - 0.01);
      let rSum = 0;
      for (const e of room) rSum += e.score;
      if (rSum > 0) {
        for (const e of room) {
          const cur = award.get(e.owner) ?? 0;
          award.set(e.owner, Math.min(cap, cur + leftover * (e.score / rSum)));
        }
      }
    }

    for (const [owner, xp] of award) {
      if (xp > 0) this.bossXpShare.push({ owner, xp });
    }
    m.contrib.clear();
  }

  /** Комната зовёт при удачном лечении союзника в бою с боссом. */
  bossHeal(owner: string, amount: number): void {
    if (this.boss && !this.boss.dead && this.boss.aggro) {
      this.boss.bump(owner, "heal", amount, this.elapsed);
    }
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
  /** Что выпало с последнего убитого босса — комната читает и объявляет. */
  readonly bossLoot: { id: ItemId; count: number }[] = [];

  private spawnLoot(m: Mob): { id: ItemId; count: number }[] {
    const rolled = rollLoot(m.kind, Math.random);
    for (const { id, count } of rolled) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * BAG.dropSpread;
      const x = m.x + Math.cos(a) * r;
      const z = m.z + Math.sin(a) * r;
      const d = new Drop(id, count, x, terrainHeight(x, z) + BAG.dropHeight, z);
      this.drops.set(d.id, d);
    }
    return rolled;
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
