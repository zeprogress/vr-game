// colyseus 0.15 — CJS-пакет без ESM-exports, поэтому default-импорт (как в index.ts/ZoneRoom.ts).
import colyseus from "colyseus";
import { Schema, type } from "@colyseus/schema";

import {
  TOWER,
  floorMobAtkIntervalSec,
  floorMobCount,
  floorMobDmg,
  floorMobHp,
} from "#shared/tower";

const { Room } = colyseus;

export type TowerPhase = "running" | "dead" | "timeout" | "cleared";

export interface TowerRunResult {
  floorReached: number;
  towerShards: number;
  phase: Exclude<TowerPhase, "running">;
}

/**
 * Состояние одной попытки. Числа боя (HP героя/мобов/босса) уже настоящие —
 * пространство и визуал (передвижение, модели, арена) появятся в фазе C, бой
 * пока абстрактный: герой и волна мобов просто размениваются уроном по
 * таймерам, как в тексте-RPG. Так прогрессия/баланс проверяются НЕЗАВИСИМО
 * от рендера.
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
}

interface LiveMob {
  hp: number;
  atkCd: number;
}

interface LiveBoss {
  hp: number;
  maxHp: number;
  dmg: number;
  atkCd: number;
  atkInterval: number;
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
  private finished = false;

  private mobs: LiveMob[] = [];
  private mobDmg = 0;
  private mobAtkInterval = 1;
  private boss: LiveBoss | null = null;
  private heroAtkCd = 0;
  private towerShards = 0;

  override onCreate(options: TowerRoomOptions): void {
    // Комнату почти наверняка никто не джойнит (герой — чаще бот без своего
    // клиента) — Colyseus иначе снёс бы её как «пустую». Сносим сами в finish().
    this.autoDispose = false;
    this.onResult = options.onResult;
    this.onFloor = options.onFloor;

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

    this.heroAtkCd -= dt;
    if (this.heroAtkCd <= 0) {
      this.heroAtkCd += TOWER.hero.atkIntervalSec;
      this.heroAttack();
      if (this.state.phase !== "running") return;
    }

    for (const m of this.mobs) {
      m.atkCd -= dt;
      if (m.atkCd <= 0) {
        m.atkCd += this.mobAtkInterval;
        this.hurtHero(this.mobDmg);
        if (this.state.phase !== "running") return;
      }
    }
    if (this.boss) {
      this.boss.atkCd -= dt;
      if (this.boss.atkCd <= 0) {
        this.boss.atkCd += this.boss.atkInterval;
        this.hurtHero(this.boss.dmg);
        if (this.state.phase !== "running") return;
      }
    }
  }

  /** Герой бьёт первого живого моба волны, а когда волна выбита — мини-босса. */
  private heroAttack(): void {
    if (this.mobs.length > 0) {
      const m = this.mobs[0];
      m.hp -= TOWER.hero.dmg;
      if (m.hp <= 0) {
        this.mobs.shift();
        this.state.mobsLeft = this.mobs.length;
        if (this.mobs.length === 0 && !this.boss) this.spawnBoss();
      }
      return;
    }
    if (this.boss) {
      this.boss.hp -= TOWER.hero.dmg;
      this.state.bossHp = Math.max(0, this.boss.hp);
      if (this.boss.hp <= 0) {
        this.towerShards++;
        this.advanceFloor();
      }
    }
  }

  private hurtHero(dmg: number): void {
    this.state.heroHp = Math.max(0, this.state.heroHp - dmg);
    if (this.state.heroHp <= 0) this.finish("dead");
  }

  private spawnFloor(floor: number): void {
    this.state.floor = floor;
    const n = floorMobCount(floor);
    const hp = floorMobHp(floor);
    this.mobDmg = floorMobDmg(floor);
    this.mobAtkInterval = floorMobAtkIntervalSec(floor);
    // Разброс стартового кулдауна атаки — иначе вся волна бьёт единым залпом.
    this.mobs = Array.from({ length: n }, () => ({
      hp,
      atkCd: this.mobAtkInterval * Math.random(),
    }));
    this.boss = null;
    this.state.mobsLeft = n;
    this.state.mobsTotal = n;
    this.state.bossActive = 0;
    this.state.bossHp = 0;
    this.state.bossMaxHp = 0;
  }

  /** Мини-босс — тот же моб этажа, но втрое крупнее и куда крепче (см. TOWER). */
  private spawnBoss(): void {
    const floor = this.state.floor;
    const hp = floorMobHp(floor) * TOWER.bossHpMul;
    const dmg = floorMobDmg(floor) * TOWER.bossDmgMul;
    this.boss = {
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
    // Небольшая передышка между этажами — не полный откат урона за весь забег.
    this.state.heroHp = Math.min(
      this.state.heroMaxHp,
      this.state.heroHp + this.state.heroMaxHp * TOWER.hero.floorHealFrac,
    );
    this.spawnFloor(this.state.floor + 1);
    this.onFloor?.(this.state.floor);
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
