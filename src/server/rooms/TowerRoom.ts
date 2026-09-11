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
  onResult?: (r: TowerRunResult) => void;
  /** Вызывается при входе на каждый следующий этаж (кроме первого) — для чата/лога. */
  onFloor?: (floor: number) => void;
  /** Каждый тик — сводка для визуала (зеркало в PlayerState.tower* у ZoneRoom). */
  onSnapshot?: (s: TowerSnapshot) => void;
}

export interface TowerMobSnapshot {
  x: number;
  z: number;
  hpFrac: number;
  boss: boolean;
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
  mobs: TowerMobSnapshot[];
}

interface LiveMob {
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  atkCd: number;
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
  private heroAtkCd = 0;
  private mobs: LiveMob[] = [];
  private mobAtkInterval = 1;
  private boss: LiveBoss | null = null;
  private towerShards = 0;
  private archetype: FloorArchetype = "melee";
  private mobRange: number = TOWER.mob.atkRange;

  override onCreate(options: TowerRoomOptions): void {
    // Комнату почти наверняка никто не джойнит (герой — чаще бот без своего
    // клиента) — Colyseus иначе снёс бы её как «пустую». Сносим сами в finish().
    this.autoDispose = false;
    this.onResult = options.onResult;
    this.onFloor = options.onFloor;
    this.onSnapshot = options.onSnapshot;

    const state = new TowerState();
    state.heroNick = options.heroNick;
    state.timeLeftSec = TOWER.timeLimitSec;
    state.heroMaxHp = TOWER.hero.maxHp;
    state.heroHp = TOWER.hero.maxHp;
    this.setState(state);

    this.spawnFloor(1);
    this.setSimulationInterval((dt) => this.step(dt / 1000), 100);
  }

  private step(dt: number): void {
    if (this.state.phase !== "running") return;
    this.state.timeLeftSec = Math.max(0, this.state.timeLeftSec - dt);
    if (this.state.timeLeftSec <= 0) {
      this.finish("timeout");
      return;
    }

    // --- герой: бежит к ближайшей живой цели, у цели — бьёт по таймеру ---
    const target = this.nearestTarget();
    if (target) {
      const d = Math.hypot(target.x - this.hero.x, target.z - this.hero.z);
      if (d > TOWER.hero.atkRange) {
        moveToward(this.hero, target.x, target.z, TOWER.hero.moveSpeed, dt);
      } else {
        this.heroAtkCd -= dt;
        if (this.heroAtkCd <= 0) {
          this.heroAtkCd += TOWER.hero.atkIntervalSec;
          this.heroAttack(target);
          if ((this.state.phase as TowerPhase) !== "running") return;
        }
      }
    }

    // --- мобы: бегут к герою (ranged/flyer — держат дистанцию и «стреляют») ---
    for (const m of this.mobs) {
      const d = Math.hypot(this.hero.x - m.x, this.hero.z - m.z);
      if (d > this.mobRange) {
        moveToward(m, this.hero.x, this.hero.z, TOWER.mob.moveSpeed, dt);
      } else {
        m.atkCd -= dt;
        if (m.atkCd <= 0) {
          m.atkCd += this.mobAtkInterval;
          this.hurtHero(floorMobDmg(this.state.floor));
          if (this.state.phase !== "running") return;
        }
      }
    }
    this.separateMobs();

    if (this.boss) {
      const b = this.boss;
      const d = Math.hypot(this.hero.x - b.x, this.hero.z - b.z);
      if (d > this.mobRange * 1.3) {
        moveToward(b, this.hero.x, this.hero.z, TOWER.mob.moveSpeed, dt);
      } else {
        b.atkCd -= dt;
        if (b.atkCd <= 0) {
          b.atkCd += b.atkInterval;
          this.hurtHero(b.dmg);
          if (this.state.phase !== "running") return;
        }
      }
    }

    this.emitSnapshot();
  }

  /** Мобы чуть расталкиваются друг от друга — иначе слипаются в одну точку у героя. */
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

  private heroAttack(target: LiveMob): void {
    target.hp -= TOWER.hero.dmg;
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

  private hurtHero(dmg: number): void {
    this.state.heroHp = Math.max(0, this.state.heroHp - dmg);
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
        hp,
        maxHp: hp,
        atkCd: this.mobAtkInterval * Math.random(),
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
      x: Math.cos(a) * r, z: Math.sin(a) * r,
      hp, maxHp: hp, dmg,
      atkCd: this.mobAtkInterval * 0.5,
      atkInterval: floorMobAtkIntervalSec(floor) * 0.8,
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
      mobs: [
        ...this.mobs.map((m) => ({ x: m.x, z: m.z, hpFrac: m.hp / m.maxHp, boss: false })),
        ...(this.boss ? [{ x: this.boss.x, z: this.boss.z, hpFrac: this.boss.hp / this.boss.maxHp, boss: true }] : []),
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
