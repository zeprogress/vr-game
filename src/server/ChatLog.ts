import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), ".data/chatlog.jsonl");

/** Сколько дней хранить сообщения — старше просто выпиливаются при чистке. */
const RETAIN_DAYS = 3;
/** Не чаще, чем раз в столько сообщений, перечитываем и переписываем файл целиком. */
const PRUNE_EVERY = 200;

export interface ChatLogEntry {
  /** мс, Date.now() на момент сообщения. */
  t: number;
  nick: string;
  text: string;
}

/**
 * Лог сообщений чата Twitch (все, не только команды) — на диск построчно
 * (JSON Lines), чтобы не перечитывать/переписывать весь файл на каждое
 * сообщение (это была бы лишняя нагрузка на слабом VPS при активном чате).
 * Хранится только последние RETAIN_DAYS дней — чистка (перезапись файла)
 * идёт раз в PRUNE_EVERY сообщений, а не на каждое.
 *
 * Никакого "саммери" сервер сам не делает — просто копит сырые сообщения.
 * Пересказ по расписанию делает отдельный процесс, читающий этот файл
 * (см. deploy/README.md — раздел про /api/chatlog).
 */
export class ChatLog {
  private sinceLastPrune = 0;

  constructor() {
    try {
      mkdirSync(dirname(FILE), { recursive: true });
    } catch (e) {
      console.warn("[chatlog] не удалось создать каталог:", (e as Error).message);
    }
  }

  /** Записать одно сообщение — дешёвый append, без чтения файла. */
  append(nick: string, text: string): void {
    const entry: ChatLogEntry = { t: Date.now(), nick, text };
    try {
      appendFileSync(FILE, JSON.stringify(entry) + "\n");
    } catch (e) {
      console.warn("[chatlog] не записано:", (e as Error).message);
      return;
    }
    if (++this.sinceLastPrune >= PRUNE_EVERY) {
      this.sinceLastPrune = 0;
      this.prune();
    }
  }

  /** Перечитать файл и оставить только записи не старше RETAIN_DAYS. */
  private prune(): void {
    try {
      if (!existsSync(FILE)) return;
      const cutoff = Date.now() - RETAIN_DAYS * 24 * 60 * 60 * 1000;
      const lines = readFileSync(FILE, "utf8").split("\n");
      const kept: string[] = [];
      for (const line of lines) {
        if (!line) continue;
        try {
          const e = JSON.parse(line) as ChatLogEntry;
          if (typeof e.t === "number" && e.t >= cutoff) kept.push(line);
        } catch {
          // битую строку просто выкидываем
        }
      }
      const tmp = `${FILE}.tmp`;
      writeFileSync(tmp, kept.length ? kept.join("\n") + "\n" : "");
      renameSync(tmp, FILE);
      console.log(`[chatlog] чистка: осталось ${kept.length} сообщений (старше ${RETAIN_DAYS} дн. убрано)`);
    } catch (e) {
      console.warn("[chatlog] чистка не удалась:", (e as Error).message);
    }
  }

  /** Все сообщения не старше RETAIN_DAYS — для /api/chatlog. */
  readRecent(): ChatLogEntry[] {
    try {
      if (!existsSync(FILE)) return [];
      const cutoff = Date.now() - RETAIN_DAYS * 24 * 60 * 60 * 1000;
      const out: ChatLogEntry[] = [];
      for (const line of readFileSync(FILE, "utf8").split("\n")) {
        if (!line) continue;
        try {
          const e = JSON.parse(line) as ChatLogEntry;
          if (typeof e.t === "number" && e.t >= cutoff) out.push(e);
        } catch {
          // пропускаем битую строку
        }
      }
      return out;
    } catch (e) {
      console.warn("[chatlog] не прочитан:", (e as Error).message);
      return [];
    }
  }
}
