// colyseus 0.15 — CJS-пакет без ESM-exports, поэтому default-импорт (как в index.ts/ZoneRoom.ts).
import colyseus from "colyseus";
import { Schema, type } from "@colyseus/schema";

import {
  TOWER,
  floorMobAtkIntervalSec,
  floorMobCount,
  floorMobDmg,
  floorMobHp,
  floorMonster,
  type FloorArchetype,
} from "#shared/tower";
import { noGuard, resolveBlock, weaponDamage, type GuardState } from "#shared/combat";
import { armorFrac, dodgeChance, maxHpFor, meleeSpeedFor, moveSpeedFor } from "#shared/progression";
import { magicResistFrac } from "#shared/magic";
import { WEAPONS, weaponAffix, weaponKey, type WeaponClass, type WeaponTier } from "#shared/items";
import { AFFIX, BOT } from "#shared/constants";

/** Дальний/летающий архетип держит дистанцию и «стреляет», не сходясь в упор — как плевуны в основной игре. */
const SHOOT_RANGE = 8;

const { Room } = colyseus;

export type TowerPhase = "running" | "dead" | "timeout" | "cleared";

export interface TowerRunResult {
  floorReached: number;
  towerShards: number;
  phase: Exclude<TowerPhase, "running">;
}

/**
 * Состояние одной попытки. Пространство ЖИВОЕ — герой и мобы реально бегают
 * по арене (как на поляне), а не просто размениваются уроном по таймеру;
 * координаты — локальные (центр арены = (0,0), см. TOWER.arena.radius),
 * абсолютные мировые прибавляет уже ZoneRoom (TOWER_HIDE + локальные x/z).
 */
export class TowerState extends Schema {
  @type("string") heroNick = "";
  @type("uint8") floor = 1;
  @type("string") phase: TowerPhase = "running";
  @type("float32") timeLeftSec = 0;
  @type("float32") heroHp = 0;
  @type("float32") heroMaxHp = 0;
  @type("uint8") mobsLeft = 0;
  @type("uint8") mobsTotal = 0;
  @type("uint8") bossActive = 0;
  @type("float32") bossHp = 0;
  @type("float32") bossMaxHp = 0;
}

export interface TowerRoomOptions {
  /** id героя в основной ZoneRoom (session id или "bot:<ник>") — только для колбэка результата. */
  heroId: string;
  heroNick: string;
  seed: number;
  /** Настоящие характеристики героя — урон/HP/скорость в башне считаются от них, как в основном мире. */
  level: number;
  str: number;
  agi: number;
  int: number;
  /** Реально надетое оружие/щит героя — как в основном мире (сумка/руки не переносится, только это). */
  leftCls: string;
  leftTier: string;
  rightCls: string;
  rightTier: string;
  onResult?: (r: TowerRunResult) => void;
  /** Вызывается при входе на каждый следующий этаж (кроме первого) — для чата/лога. */
  onFloor?: (floor: number) => void;
  /** Каждый тик — сводка для визуала (зеркало в PlayerState.tower* у ZoneRoom). */
  onSnapshot?: (s: TowerSnapshot) => void;
}

export interface TowerMobSnapshot {
  x: number;
  z: number;
  /** Куда смотрит (рад, та же конвенция yaw, что и в основном мире). */
  yaw: number;
  hpFrac: number;
  boss: boolean;
  /** true ровно на тот тик, когда моб ударил — клиент играет замах/анимацию раз. */
  atkPulse: boolean;
  /** Дальний/летающий архетип — клиент рисует «выстрел» до героя на atkPulse. */
  ranged: boolean;
  /** Горит (Пламенный меч) — клиент рисует языки пламени. */
  burning: boolean;
}

export interface TowerSnapshot {
  floor: number;
  mobsLeft: number;
  mobsTotal: number;
  bossActive: boolean;
  bossHpFrac: number;
  heroHp: number;
  heroMaxHp: number;
  heroX: number;
  heroZ: number;
  heroYaw: number;
  /** true ровно на тот тик, когда герой НАЧАЛ замах — рассылка "swing" в основной мир. */
  heroAtkPulse: boolean;
  /** true ровно на тот тик, когда клинок ДОШЁЛ до цели — звук удара мечом. */
  heroSwordHit: boolean;
  /** Звук/FX по герою за этот тик — попал/заблокировал/увернулся (см. ZoneRoom.hurtPlayer). */
  heroHitFx: { k: "hurt" | "blockShield" | "blockSword" | "dodge"; x: number; z: number }[];
  mobs: TowerMobSnapshot[];
}

interface LiveMob {
  x: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  atkCd: number;
  atkPulse: boolean;
  /** Горение от Пламенного меча (см. AFFIX.fire) — секунд осталось / урон в секунду. */
  burnT: number;
  burnDps: number;
  /** Своя фаза для стрейфа дальних мобов (см. ZoneRoom.tickBot strPhase) — группа не дёргается в такт. */
  phase: number;
}

interface LiveBoss extends LiveMob {
  dmg: number;
  atkInterval: number;
}

const ARENA_R = TOWER.arena.radius - 1.5; // небольшой запас от самой стены

function clampToArena(p: { x: number; z: number }): void {
  const d = Math.hypot(p.x, p.z);
  if (d > ARENA_R) {
    const k = ARENA_R / d;
    p.x *= k;
    p.z *= k;
  }
}

function moveToward(
  p: { x: number; z: number },
  tx: number,
  tz: number,
  speed: number,
  dt: number,
): number {
  const dx = tx - p.x;
  const dz = tz - p.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-4) return d;
  const step = Math.min(d, speed * dt);
  p.x += (dx / d) * step;
  p.z += (dz / d) * step;
  return d;
}

/**
 * Приватное подземелье на одну попытку («Hunter Tower»). Настоящая отдельная
 * комната Colyseus — не расшаренный мир ZoneRoom: создаётся на очередного
 * героя из очереди (`matchMaker.createRoom`, см. TowerRunManager) и сносится
 * сама, когда забег кончился (смерть/таймаут/зачистка всех 20 этажей).
 */
export class TowerRoom extends Room<TowerState> {
  override maxClients = 1;
  private onResult: TowerRoomOptions["onResult"];
  private onFloor: TowerRoomOptions["onFloor"];
  private onSnapshot: TowerRoomOptions["onSnapshot"];
  private finished = false;

  private readonly hero = { x: 0, z: 0 };
  private heroYaw = 0;
  private heroAtkCd = 0;
  private heroAtkPulse = false;
  /** Windup удара — клинок реально достигает цели через BOT.attackImpact/атк, не мгновенно
   *  (см. ZoneRoom.resolveBotHit) — раньше урон применялся в тот же тик, что и "swing". */
  private heroSwingIn = 0;
  private heroSwingTarget: LiveMob | null = null;
  private heroSwordHit = false;
  private heroHitFx: TowerSnapshot["heroHitFx"] = [];
  /** Темп ближнего боя от реальных характеристик (см. meleeSpeedFor) — не константа. */
  private heroMeleeSpeed = 1;
  private mobs: LiveMob[] = [];
  private mobAtkInterval = 1;
  private boss: LiveBoss | null = null;
  private towerShards = 0;
  private archetype: FloorArchetype = "melee";
  private mobRange: number = TOWER.mob.atkRange;
  private elapsedSec = 0;
  /** Настоящие характеристики героя (level/str/agi) — не выдумка TOWER.hero.*. */
  private heroDmg: number = TOWER.hero.dmg;
  private heroMoveSpeed: number = TOWER.hero.moveSpeed;
  private heroStr = 0;
  private heroAgi = 0;
  private heroInt = 0;
  /** Щит в руке — блокирует по направлению взгляда героя (он всегда смотрит на цель). */
  private heroGuard: GuardState | null = null;
  private heroAegis = false;
  /** Один предмет в руках (лук/посох) — вдвое подвижнее, как и в основном мире. */
  private heroOneHanded = true;
  /** Пламенный меч — удар героя поджигает цель (см. AFFIX.fire, tickBurning). */
  private heroFireAffix = false;

  override onCreate(options: TowerRoomOptions): void {
    // Комнату почти наверняка никто не джойнит (герой — чаще бот без своего
    // клиента) — Colyseus иначе снёс бы её как «пустую». Сносим сами в finish().
    this.autoDispose = false;
    this.onResult = options.onResult;
    this.onFloor = options.onFloor;
    this.onSnapshot = options.onSnapshot;

    // Урон/HP/скорость — от РЕАЛЬНЫХ характеристик героя (level/str/agi), как
    // и в основном мире (weaponDamage/maxHpFor/moveSpeedFor), не константы.
    this.heroStr = options.str;
    this.heroAgi = options.agi;
    this.heroInt = options.int;
    // Оружие/щит — то, что реально надето (banки нельзя, а меч/щит — можно и нужно).
    const rightW =
      options.rightCls && options.rightTier
        ? WEAPONS[weaponKey(options.rightCls as WeaponClass, options.rightTier as WeaponTier)]
        : undefined;
    const weaponKind = options.rightCls === "sword" ? "sword" : "fist";
    const weaponMult = weaponKind === "sword" ? (rightW?.mult ?? 1) : 1;
    this.heroDmg = weaponDamage(weaponKind, options.level, options.str, weaponMult, options.agi);
    const holdsShield = options.leftCls === "shield" || options.rightCls === "shield";
    this.heroGuard = holdsShield ? noGuard() : null; // направление считаем каждый тик от heroYaw
    this.heroAegis =
      (options.leftCls === "shield" && options.leftTier === "legendary") ||
      (options.rightCls === "shield" && options.rightTier === "legendary");
    // Одна рука занята луком/посохом (обе руки на нём) — вдвое подвижнее второй свободной руки.
    this.heroOneHanded = options.leftCls === "";
    this.heroFireAffix =
      weaponAffix(options.rightCls as WeaponClass, options.rightTier as WeaponTier) === "fire";
    this.heroMoveSpeed = moveSpeedFor(options.level, options.agi);
    this.heroMeleeSpeed = meleeSpeedFor(options.level, options.agi);
    const heroMaxHp = maxHpFor(options.level, options.str);

    const state = new TowerState();
    state.heroNick = options.heroNick;
    state.timeLeftSec = TOWER.timeLimitSec;
    state.heroMaxHp = heroMaxHp;
    state.heroHp = heroMaxHp;
    this.setState(state);

    this.spawnFloor(1);
    this.setSimulationInterval((dt) => this.step(dt / 1000), 100);
  }

  private step(dt: number): void {
    if (this.state.phase !== "running") return;
    this.elapsedSec += dt;
    this.state.timeLeftSec = Math.max(0, this.state.timeLeftSec - dt);
    if (this.state.timeLeftSec <= 0) {
      this.finish("timeout");
      return;
    }

    this.heroAtkPulse = false;
    this.heroSwordHit = false;
    this.heroHitFx = [];
    for (const m of this.mobs) m.atkPulse = false;
    if (this.boss) this.boss.atkPulse = false;

    // Клинок реально долетает до цели с задержкой (как у ботов в основном
    // мире, см. ZoneRoom.resolveBotHit) — "swing" (замах) шлётся в момент
    // старта атаки, а урон/звук удара — здесь, когда окно долетело.
    if (this.heroSwingIn > 0) {
      this.heroSwingIn -= dt;
      if (this.heroSwingIn <= 0) this.resolveHeroSwing();
      if ((this.state.phase as TowerPhase) !== "running") return;
    }

    // --- герой: бежит к ближайшей живой цели (и всегда смотрит на неё) ---
    const target = this.nearestTarget();
    if (target) {
      this.heroYaw = Math.atan2(target.x - this.hero.x, target.z - this.hero.z);
      const d = Math.hypot(target.x - this.hero.x, target.z - this.hero.z);
      if (d > TOWER.hero.atkRange) {
        moveToward(this.hero, target.x, target.z, this.heroMoveSpeed, dt);
      } else {
        this.heroAtkCd -= dt;
        if (this.heroAtkCd <= 0 && this.heroSwingIn <= 0) {
          this.heroAtkCd = BOT.attackCooldown / this.heroMeleeSpeed;
          this.heroSwingIn = BOT.attackImpact / this.heroMeleeSpeed;
          this.heroSwingTarget = target;
          this.heroAtkPulse = true;
        }
      }
    }

    this.tickBurning(dt);
    if ((this.state.phase as TowerPhase) !== "running") return;

    // --- мобы: бегут к герою (ranged/flyer — держат дистанцию, стрейфятся и «стреляют»), смотрят на него ---
    const ranged = this.archetype !== "melee";
    for (const m of this.mobs) {
      m.yaw = Math.atan2(this.hero.x - m.x, this.hero.z - m.z);
      const d = Math.hypot(this.hero.x - m.x, this.hero.z - m.z);
      if (d > this.mobRange) {
        moveToward(m, this.hero.x, this.hero.z, TOWER.mob.moveSpeed, dt);
      } else {
        if (ranged) this.rangedShuffle(m, d, dt);
        m.atkCd -= dt;
        if (m.atkCd <= 0) {
          m.atkCd += this.mobAtkInterval;
          m.atkPulse = true;
          this.hurtHero(floorMobDmg(this.state.floor), m.x, m.z, ranged);
          if (this.state.phase !== "running") return;
        }
      }
    }
    this.separateMobs();

    if (this.boss) {
      const b = this.boss;
      b.yaw = Math.atan2(this.hero.x - b.x, this.hero.z - b.z);
      const d = Math.hypot(this.hero.x - b.x, this.hero.z - b.z);
      if (d > this.mobRange * 1.3) {
        moveToward(b, this.hero.x, this.hero.z, TOWER.mob.moveSpeed, dt);
      } else {
        if (ranged) this.rangedShuffle(b, d, dt);
        b.atkCd -= dt;
        if (b.atkCd <= 0) {
          b.atkCd += b.atkInterval;
          b.atkPulse = true;
          this.hurtHero(b.dmg, b.x, b.z, ranged);
          if (this.state.phase !== "running") return;
        }
      }
    }

    this.emitSnapshot();
  }

  /** Мобы чуть расталкиваются друг от друга — иначе слипаются в одну точку у героя. */
  /**
   * Дальний/летающий моб в радиусе атаки не стоит столбом — отходит, если герой
   * подобрался ближе половины дистанции, и плавно ходит боком (перпендикуляр к
   * линии на цель), пока не подошёл — та же формула, что и у ботов-лучников/магов
   * в основном мире (см. ZoneRoom.tickBot, strPhase/strafeX/strafeZ).
   */
  private rangedShuffle(m: { x: number; z: number; phase: number }, d: number, dt: number): void {
    const dx = (this.hero.x - m.x) / (d || 1);
    const dz = (this.hero.z - m.z) / (d || 1);
    const speed = TOWER.mob.moveSpeed * 0.6;
    const keep = this.mobRange * 0.55;
    if (d < keep) {
      m.x -= dx * speed * dt;
      m.z -= dz * speed * dt;
    } else {
      const s = Math.sin((this.elapsedSec * 0.5 + m.phase * 10) * Math.PI * 2);
      m.x += -dz * speed * 0.7 * s * dt;
      m.z += dx * speed * 0.7 * s * dt;
    }
    clampToArena(m);
  }

  private separateMobs(): void {
    for (let i = 0; i < this.mobs.length; i++) {
      for (let j = i + 1; j < this.mobs.length; j++) {
        const a = this.mobs[i];
        const b = this.mobs[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz) || 1e-4;
        const minD = 1.1;
        if (d >= minD) continue;
        const push = (minD - d) / 2;
        const nx = dx / d;
        const nz = dz / d;
        a.x -= nx * push;
        a.z -= nz * push;
        b.x += nx * push;
        b.z += nz * push;
      }
    }
    for (const m of this.mobs) clampToArena(m);
  }

  private nearestTarget(): LiveMob | null {
    let best: LiveMob | null = null;
    let bestD = Infinity;
    for (const m of this.mobs) {
      const d = (m.x - this.hero.x) ** 2 + (m.z - this.hero.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    if (best) return best;
    return this.boss;
  }

  /** Клинок дошёл до цели (см. heroSwingIn) — цель могла уже умереть (сгорела) или уйти. */
  private resolveHeroSwing(): void {
    const target = this.heroSwingTarget;
    this.heroSwingTarget = null;
    if (!target || target.hp <= 0) return;
    if (target !== this.boss && this.mobs.indexOf(target) < 0) return;
    this.heroAttack(target);
    this.heroSwordHit = true;
  }

  private heroAttack(target: LiveMob): void {
    // Пламенный меч — так же, как в основном мире (ZoneRoom.hitMob + tickBurning):
    // удар поджигает цель на AFFIX.fire.burnSec, тикает отдельно в tickBurning().
    if (this.heroFireAffix) {
      target.burnT = Math.max(target.burnT, AFFIX.fire.burnSec);
      target.burnDps = Math.max(target.burnDps, this.heroDmg * AFFIX.fire.burnDpsFrac);
    }
    this.applyDamage(target, this.heroDmg);
  }

  /** Общий путь урона по мобу/боссу — от удара героя и от тика горения. */
  private applyDamage(target: LiveMob, dmg: number): void {
    target.hp -= dmg;
    if (target.hp > 0) return;
    if (target === this.boss) {
      this.towerShards++;
      this.advanceFloor();
      return;
    }
    const idx = this.mobs.indexOf(target);
    if (idx >= 0) this.mobs.splice(idx, 1);
    this.state.mobsLeft = this.mobs.length;
    if (this.mobs.length === 0 && !this.boss) this.spawnBoss();
  }

  /** DoT горения (Пламенный меч) — как ZoneSim.tickBurning, но на мобов/босса этажа. */
  private tickBurning(dt: number): void {
    for (const m of [...this.mobs]) {
      if (m.burnT <= 0) continue;
      m.burnT = Math.max(0, m.burnT - dt);
      const tick = m.burnDps * dt;
      if (tick > 0) this.applyDamage(m, tick);
      if (m.burnT <= 0) m.burnDps = 0;
      if ((this.state.phase as TowerPhase) !== "running") return;
    }
    const b = this.boss;
    if (b && b.burnT > 0) {
      b.burnT = Math.max(0, b.burnT - dt);
      const tick = b.burnDps * dt;
      if (tick > 0) this.applyDamage(b, tick);
      if (b.burnT <= 0) b.burnDps = 0;
    }
  }

  /**
   * Урон по герою — с учётом щита/уворота/брони, как и в основном мире
   * (`ZoneRoom.hurtPlayer`): герой всегда смотрит на цель, так что щит
   * направлен по `heroYaw`, а не в случайную сторону.
   */
  private hurtHero(dmg: number, fromX: number, fromZ: number, projectile: boolean): void {
    let ax = fromX - this.hero.x;
    let az = fromZ - this.hero.z;
    const L = Math.hypot(ax, az);
    if (L > 1e-6) {
      ax /= L;
      az /= L;
    } else {
      ax = 0;
      az = 1;
    }
    const guard: GuardState | undefined = this.heroGuard
      ? { sx: Math.sin(this.heroYaw), sz: Math.cos(this.heroYaw), wx: 0, wz: 0 }
      : undefined;
    const dodged = Math.random() < dodgeChance(this.heroAgi, this.heroOneHanded);
    const block = dodged
      ? { mult: 0 as const, by: 3 as const }
      : resolveBlock(guard, ax, az, projectile, this.heroAegis);
    let real = dmg * block.mult * (1 - armorFrac(this.heroStr));
    if (projectile) real *= 1 - magicResistFrac(this.heroInt);
    this.state.heroHp = Math.max(0, this.state.heroHp - real);
    // Звук/FX — та же рассылка, что и в основном мире (см. ZoneRoom.hurtPlayer):
    // "MISS" при увороте рисуется над ИСТОЧНИКОМ удара, звук блока/удара — над героем.
    const k = block.by === 1 ? "blockShield" : block.by === 2 ? "blockSword" : block.by === 3 ? "dodge" : "hurt";
    this.heroHitFx.push({ k, x: block.by === 3 ? fromX : this.hero.x, z: block.by === 3 ? fromZ : this.hero.z });
    if (this.state.heroHp <= 0) this.finish("dead");
  }

  private spawnFloor(floor: number): void {
    this.state.floor = floor;
    this.hero.x = 0;
    this.hero.z = 0;
    this.archetype = floorMonster(floor).archetype;
    this.mobRange = this.archetype === "melee" ? TOWER.mob.atkRange : SHOOT_RANGE;
    const n = floorMobCount(floor);
    const hp = floorMobHp(floor);
    this.mobAtkInterval = floorMobAtkIntervalSec(floor);
    this.mobs = Array.from({ length: n }, (_v, i) => {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
      const r = ARENA_R * (0.55 + Math.random() * 0.3);
      return {
        x: Math.cos(a) * r,
        z: Math.sin(a) * r,
        yaw: 0,
        hp,
        maxHp: hp,
        atkCd: this.mobAtkInterval * Math.random(),
        atkPulse: false,
        burnT: 0,
        burnDps: 0,
        phase: Math.random(),
      };
    });
    this.boss = null;
    this.state.mobsLeft = n;
    this.state.mobsTotal = n;
    this.state.bossActive = 0;
    this.state.bossHp = 0;
    this.state.bossMaxHp = 0;
    this.emitSnapshot();
  }

  /** Мини-босс — тот же моб этажа, но втрое крупнее и куда крепче (см. TOWER). */
  private spawnBoss(): void {
    const floor = this.state.floor;
    const hp = floorMobHp(floor) * TOWER.bossHpMul;
    const dmg = floorMobDmg(floor) * TOWER.bossDmgMul;
    const a = Math.random() * Math.PI * 2;
    const r = ARENA_R * 0.6;
    this.boss = {
      x: Math.cos(a) * r, z: Math.sin(a) * r, yaw: 0,
      hp, maxHp: hp, dmg,
      atkCd: this.mobAtkInterval * 0.5,
      atkInterval: floorMobAtkIntervalSec(floor) * 0.8,
      atkPulse: false,
      burnT: 0,
      burnDps: 0,
      phase: Math.random(),
    };
    this.state.bossActive = 1;
    this.state.bossHp = hp;
    this.state.bossMaxHp = hp;
  }

  private advanceFloor(): void {
    if (this.state.floor >= TOWER.floors) {
      this.finish("cleared");
      return;
    }
    // Каждый этаж — с полным здоровьем (площадка расчищена, короткая передышка).
    this.state.heroHp = this.state.heroMaxHp;
    this.spawnFloor(this.state.floor + 1);
    this.onFloor?.(this.state.floor);
  }

  private emitSnapshot(): void {
    if (this.boss) this.state.bossHp = Math.max(0, this.boss.hp);
    this.onSnapshot?.({
      floor: this.state.floor,
      mobsLeft: this.mobs.length,
      mobsTotal: this.state.mobsTotal,
      bossActive: this.boss !== null,
      bossHpFrac: this.boss ? this.boss.hp / this.boss.maxHp : 0,
      heroHp: this.state.heroHp,
      heroMaxHp: this.state.heroMaxHp,
      heroX: this.hero.x,
      heroZ: this.hero.z,
      heroYaw: this.heroYaw,
      heroAtkPulse: this.heroAtkPulse,
      heroSwordHit: this.heroSwordHit,
      heroHitFx: this.heroHitFx,
      mobs: [
        ...this.mobs.map((m) => ({
          x: m.x, z: m.z, yaw: m.yaw, hpFrac: m.hp / m.maxHp, boss: false, atkPulse: m.atkPulse,
          ranged: this.archetype !== "melee", burning: m.burnT > 0,
        })),
        ...(this.boss
          ? [{
              x: this.boss.x, z: this.boss.z, yaw: this.boss.yaw,
              hpFrac: this.boss.hp / this.boss.maxHp, boss: true, atkPulse: this.boss.atkPulse,
              ranged: this.archetype !== "melee", burning: this.boss.burnT > 0,
            }]
          : []),
      ],
    });
  }

  private finish(phase: Exclude<TowerPhase, "running">): void {
    if (this.finished) return;
    this.finished = true;
    this.state.phase = phase;
    this.onResult?.({ floorReached: this.state.floor, towerShards: this.towerShards, phase });
    // Небольшая пауза — зрители у спектатора успевают увидеть исход, прежде
    // чем комната (и её состояние) исчезнет.
    this.clock.setTimeout(() => void this.disconnect(), 3000);
  }
}
