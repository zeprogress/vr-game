import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PLAYER, RESPAWN } from "#shared/constants";
import type { HeldWeapons, SaveMsg, StowedWeapon } from "#shared/net/messages";
import { blankProgress, maxHpFor, type Progress } from "#shared/progression";
import { emptyBag, type Slot } from "#shared/items";

/** Позиция + прогресс + здоровье. С этапа 7 всё это считает сервер. */
export interface PlayerRecord extends SaveMsg, Progress {
  token: string;
  nick: string;
  hp: number;
  /** Что игрок честно поднял: ключи вида "sword:gold". */
  owned: string[];
  /** Оружие, убранное за спину при прошлом выходе. */
  stowed: StowedWeapon[];
  /** Что было в руках при прошлом выходе. */
  held: HeldWeapons;
  /** Панельные настройки (положения рук/предметов, HUD, графика, голос). */
  overrides: Record<string, unknown>;
  bag: Slot[];
  /** Внешность бота зрителя (Ф10) — держится за ником между сессиями. */
  skin?: number;
  updatedAt: number;
}

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), ".data/players.json");

function blank(token: string): PlayerRecord {
  const p = blankProgress();
  return {
    token,
    nick: "гость",
    x: RESPAWN.spawnX,
    y: PLAYER.eyeHeight,
    z: RESPAWN.spawnZ,
    yaw: 0,
    ...p,
    hp: maxHpFor(p.str),
    owned: [],
    stowed: [],
    held: { left: null, right: null },
    overrides: {},
    bag: emptyBag(),
    updatedAt: 0,
  };
}

/**
 * Простое хранилище персонажей: всё в памяти + периодический дамп в JSON.
 * С этапа 7 прогресс и HP считает сервер — здесь они просто переживают перезапуск.
 */
export class PlayerStore {
  private readonly records = new Map<string, PlayerRecord>();
  private dirty = false;

  constructor() {
    try {
      if (existsSync(FILE)) {
        const raw = JSON.parse(readFileSync(FILE, "utf8")) as PlayerRecord[];
        for (const r of raw) if (r?.token) this.records.set(r.token, r);
        console.log(`[store] загружено персонажей: ${this.records.size}`);
      }
    } catch (e) {
      console.warn("[store] players.json не прочитан:", (e as Error).message);
    }
  }

  get(token: string): PlayerRecord | undefined {
    return this.records.get(token);
  }

  /** Обновить (или создать) запись. */
  put(token: string, patch: Partial<PlayerRecord>): void {
    const cur = this.records.get(token) ?? blank(token);
    this.records.set(token, { ...cur, ...patch, token, updatedAt: Date.now() });
    this.dirty = true;
  }

  /** Записать на диск, если что-то менялось. Атомарно (tmp + rename). */
  flush(): void {
    if (!this.dirty) return;
    try {
      mkdirSync(dirname(FILE), { recursive: true });
      const tmp = `${FILE}.tmp`;
      writeFileSync(tmp, JSON.stringify([...this.records.values()], null, 2));
      renameSync(tmp, FILE);
      this.dirty = false;
    } catch (e) {
      console.warn("[store] players.json не записан:", (e as Error).message);
    }
  }
}
