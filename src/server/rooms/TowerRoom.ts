// colyseus 0.15 — CJS-пакет без ESM-exports, поэтому default-импорт (как в index.ts/ZoneRoom.ts).
import colyseus from "colyseus";
import { Schema, type } from "@colyseus/schema";

import { TOWER } from "#shared/tower";

const { Room } = colyseus;

export type TowerPhase = "running" | "dead" | "timeout" | "cleared";

export interface TowerRunResult {
  floorReached: number;
  towerShards: number;
  phase: Exclude<TowerPhase, "running">;
}

/**
 * Состояние одной попытки — скелет фазы A (этажи/мобы появятся в фазе B).
 * Комната ни с кем не делится: `maxClients=1`, живёт ровно один забег героя.
 */
export class TowerState extends Schema {
  @type("string") heroNick = "";
  @type("uint8") floor = 1;
  @type("string") phase: TowerPhase = "running";
  @type("float32") timeLeftSec = 0;
}

export interface TowerRoomOptions {
  /** id героя в основной ZoneRoom (session id или "bot:<ник>") — только для колбэка результата. */
  heroId: string;
  heroNick: string;
  seed: number;
  onResult?: (r: TowerRunResult) => void;
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
  private finished = false;

  override onCreate(options: TowerRoomOptions): void {
    // Комнату почти наверняка никто не джойнит (герой — чаще бот без своего
    // клиента) — Colyseus иначе снёс бы её как «пустую». Сносим сами в finish().
    this.autoDispose = false;
    this.onResult = options.onResult;

    const state = new TowerState();
    state.heroNick = options.heroNick;
    state.timeLeftSec = TOWER.timeLimitSec;
    this.setState(state);

    // Скелет фазы A: пока нет этажей/мобов — только тикающий таймер и ручной
    // триггер смерти для проверки жизненного цикла (снимается в фазе B).
    this.onMessage("debugDie", () => this.finish("dead"));

    this.setSimulationInterval((dt) => this.step(dt / 1000), 1000);
  }

  private step(dt: number): void {
    if (this.state.phase !== "running") return;
    this.state.timeLeftSec = Math.max(0, this.state.timeLeftSec - dt);
    if (this.state.timeLeftSec <= 0) this.finish("timeout");
  }

  private finish(phase: Exclude<TowerPhase, "running">): void {
    if (this.finished) return;
    this.finished = true;
    this.state.phase = phase;
    this.onResult?.({ floorReached: this.state.floor, towerShards: 0, phase });
    // Небольшая пауза — зрители у спектатора успевают увидеть исход, прежде
    // чем комната (и её состояние) исчезнет.
    this.clock.setTimeout(() => void this.disconnect(), 3000);
  }
}
