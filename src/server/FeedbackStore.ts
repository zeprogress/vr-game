import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isFeedbackKind, isFeedbackMark, type FeedbackKind, type FeedbackMark, type FeedbackView } from "#shared/feedback";

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), ".data/feedback.json");

/** Запись в файле: вид и кто пометил — остальное как FeedbackView. */
export interface FeedbackItem extends FeedbackView {
  kind: FeedbackKind;
  markBy?: string;
}

function isItem(x: unknown): x is FeedbackItem {
  const o = x as Partial<FeedbackItem> | null;
  return !!o && typeof o.id === "string" && isFeedbackKind(o.kind) && typeof o.nick === "string" && typeof o.text === "string" && typeof o.at === "number";
}

function view(it: FeedbackItem): FeedbackView {
  return { id: it.id, nick: it.nick, text: it.text, at: it.at, mark: it.mark };
}

/**
 * Ошибки и предложения игроков (страница «Помощь в разработке»). Один файл .data/feedback.json,
 * как players.json: запись во временный файл и переименование. Новые записи — сверху.
 */
export class FeedbackStore {
  private items: FeedbackItem[] = [];

  constructor(private readonly file = FILE) {
    try {
      if (!existsSync(file)) return;
      const raw = JSON.parse(readFileSync(file, "utf8")) as { items?: unknown };
      if (Array.isArray(raw?.items)) {
        this.items = raw.items.filter(isItem).map((it) => ({ ...it, mark: isFeedbackMark(it.mark) ? it.mark : null }));
      }
    } catch (e) {
      console.warn("[feedback] feedback.json не прочитан:", (e as Error).message);
    }
  }

  /** Все записи вида, свежие сверху. */
  list(kind: FeedbackKind): FeedbackView[] {
    return this.items.filter((it) => it.kind === kind).map(view);
  }

  add(kind: FeedbackKind, nick: string, text: string): FeedbackView {
    const it: FeedbackItem = { id: randomUUID().slice(0, 8), kind, nick, text, at: Date.now(), mark: null };
    this.items.unshift(it);
    this.save();
    return view(it);
  }

  /** Пометка админа (null — снять, серая). Возвращает запись целиком (с видом) или null, если такой нет. */
  setMark(id: string, mark: FeedbackMark | null, by: string): FeedbackItem | null {
    const it = this.items.find((x) => x.id === id);
    if (!it) return null;
    it.mark = mark;
    it.markBy = mark ? by : undefined;
    this.save();
    return it;
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ items: this.items, savedAt: Date.now() }, null, 2));
      renameSync(tmp, this.file);
    } catch (e) {
      console.warn("[feedback] feedback.json не записан:", (e as Error).message);
    }
  }
}
