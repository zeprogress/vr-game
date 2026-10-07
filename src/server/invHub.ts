import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

/**
 * Связка веб-инвентаря (`/inv?ник`, InventoryRoom) с игровой комнатой и чатом.
 *
 * Авторизация: у каждого браузера своя сессия (sid в localStorage страницы).
 * Неавторизованной сессии страница показывает 4-значный код; когда ИМЕННО
 * этот ник пишет код в чат Twitch (ZoneRoom.onChat → tryChatCode), сессия
 * получает право менять инвентарь этого ника — навсегда (до SESSION_TTL без
 * заходов). Чужой человек код ввести не может: чат проверяет автора.
 *
 * Действия (надеть/на лом) выполняет ZoneRoom — она знает живого героя;
 * InventoryRoom только зовёт `act()` и перерисовывает страницу.
 */

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), ".data/invSessions.json");
const CODE_TTL_MS = 10 * 60_000;
const SESSION_TTL_MS = 60 * 24 * 3600_000;

import type { PcInvData } from "#shared/net/messages";
import type { JewelAct } from "#shared/jewels";

export type InvActKind = "equip" | "unequip" | "scrap" | "enchant" | "stat" | "respec" | "scroll" | "title" | "skills" | "fav" | "scrapAll" | "gift" | JewelAct;

export interface InvActResult {
  ok: boolean;
  text: string;
  /** Для заточки: чем кончилась попытка (страница играет анимацию). */
  enchant?: { id: string; idx: number; up: boolean; gain: number; cost: number; label: string };
}

export interface InvZone {
  /** Записать живого героя (если он в мире) в store — перед чтением страницей. */
  sync(norm: string): void;
  /** Выполнить действие; вернуть текст для страницы (ok=false — отказ). */
  act(norm: string, act: InvActKind, id: string, idx: number, fuel?: string): InvActResult;
  /** Данные окна снаряжения живого героя (в мире); нет в мире — null. */
  pcInv?(norm: string): PcInvData | null;
}

interface Session {
  norms: string[];
  at: number;
}

const sessions = new Map<string, Session>();
/** norm → (sid → {code, exp}). */
const pending = new Map<string, Map<string, { code: string; exp: number }>>();
const listeners = new Set<(norm: string) => void>();
let zone: InvZone | null = null;

try {
  if (existsSync(FILE)) {
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, Session>;
    const now = Date.now();
    for (const [sid, s] of Object.entries(raw)) {
      if (s && Array.isArray(s.norms) && now - s.at < SESSION_TTL_MS) sessions.set(sid, s);
    }
  }
} catch (e) {
  console.warn("[inv] invSessions.json не прочитан:", (e as Error).message);
}

function save(): void {
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    const tmp = `${FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(sessions)));
    renameSync(tmp, FILE);
  } catch (e) {
    console.warn("[inv] invSessions.json не записан:", (e as Error).message);
  }
}

export const invHub = {
  setZone(z: InvZone | null): void {
    zone = z;
  },

  pcInv(norm: string): PcInvData | null {
    return zone?.pcInv?.(norm) ?? null;
  },

  /** sid от клиента, если он похож на наш, иначе новый. */
  sid(raw: unknown): string {
    return typeof raw === "string" && /^[0-9a-f-]{36}$/.test(raw) ? raw : randomUUID();
  },

  isAuthed(sid: string, norm: string): boolean {
    const s = sessions.get(sid);
    if (!s || !s.norms.includes(norm)) return false;
    if (Date.now() - s.at > 3600_000) {
      s.at = Date.now(); // продлеваем не чаще раза в час — без лишней записи на диск
      save();
    }
    return true;
  },

  /** Код для этой сессии (тот же, пока не истёк). */
  code(sid: string, norm: string): string {
    const now = Date.now();
    let m = pending.get(norm);
    if (!m) pending.set(norm, (m = new Map()));
    for (const [k, v] of m) if (v.exp < now) m.delete(k);
    const cur = m.get(sid);
    if (cur) return cur.code;
    const used = new Set([...m.values()].map((v) => v.code));
    let code: string;
    do code = String(1000 + Math.floor(Math.random() * 9000));
    while (used.has(code));
    m.set(sid, { code, exp: now + CODE_TTL_MS });
    return code;
  },

  /** Сообщение чата от `norm` — если это код одной из его сессий, авторизуем. */
  tryChatCode(norm: string, text: string): boolean {
    const t = text.trim();
    if (!/^\d{4}$/.test(t)) return false;
    const m = pending.get(norm);
    if (!m) return false;
    const now = Date.now();
    let hit = false;
    for (const [sid, v] of m) {
      if (v.code !== t || v.exp < now) continue;
      m.delete(sid);
      const s = sessions.get(sid) ?? { norms: [], at: now };
      if (!s.norms.includes(norm)) s.norms.push(norm);
      s.at = now;
      sessions.set(sid, s);
      hit = true;
    }
    if (!hit) return false;
    save();
    this.notify(norm);
    return true;
  },

  sync(norm: string): void {
    zone?.sync(norm);
  },

  act(norm: string, act: InvActKind, id: string, idx = 0, fuel?: string): InvActResult {
    if (!zone) return { ok: false, text: "Сервер ещё не готов — попробуй через минуту." };
    const r = zone.act(norm, act, id, idx, fuel);
    this.notify(norm);
    return r;
  },

  /** Инвентарь ника поменялся — открытые страницы перерисуются. */
  notify(norm: string): void {
    for (const l of listeners) l(norm);
  },

  listen(fn: (norm: string) => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
