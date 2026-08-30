import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { SaveMsg } from "#shared/net/messages";

export interface PlayerRecord extends SaveMsg {
  token: string;
  nick: string;
  updatedAt: number;
}

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), ".data/players.json");

function blank(token: string): PlayerRecord {
  return {
    token,
    nick: "гость",
    x: 0,
    y: 1.7,
    z: -20,
    yaw: 0,
    level: 1,
    xp: 0,
    unspent: 0,
    str: 1,
    agi: 1,
    int: 1,
    hp: 100,
    updatedAt: 0,
  };
}

/**
 * Простое хранилище персонажей: всё в памяти + периодический дамп в JSON.
 * Прогресс считает клиент, сервер только хранит (этап 5).
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
