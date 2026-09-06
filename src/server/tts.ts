import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { TTS_DEFAULT_VOICE } from "#shared/tts";

/**
 * Озвучка сообщений чата на стриме через Fish Audio.
 *
 * Ключ живёт только на сервере (`FISH_API_KEY` в deploy/stream.env, не в git).
 * Готовый mp3 кладём в `dist/tts/` — nginx отдаёт его как статику
 * (`try_files $uri`), спектатор просто фетчит `/tts/<id>.mp3`. Никакого
 * отдельного HTTP-роута и правок nginx не нужно.
 *
 * Ничего не делает, пока `FISH_API_KEY` не задан или пока пульт не включил
 * озвучку и не подключён спектатор — сеть/файлы трогаются только тогда.
 */
const FISH_TTS_URL = "https://api.fish.audio/v1/tts";
const FISH_MODEL = "s2.1-pro-free";
/** Куда пишем mp3 (nginx-корень статики). */
const OUT_DIR = resolve(process.cwd(), "dist/tts");
/** Сколько держать файл на диске, мс. */
const TTL_MS = 120_000;
/** Не длиннее — обрезаем (одна фраза = один запрос). */
const MAX_CHARS = 240;

export function ttsAvailable(): boolean {
  return !!process.env.FISH_API_KEY;
}

/** Причесать текст сообщения перед озвучкой. Пусто — озвучивать нечего. */
export function cleanChatText(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CHARS);
}

let cleanupAt = 0;
function sweep(): void {
  const now = Date.now();
  if (now - cleanupAt < 20_000) return;
  cleanupAt = now;
  try {
    for (const f of readdirSync(OUT_DIR)) {
      const p = resolve(OUT_DIR, f);
      if (now - statSync(p).mtimeMs > TTL_MS) rmSync(p, { force: true });
    }
  } catch {
    /* каталога ещё нет / гонка с autopull — не критично */
  }
}

async function fishTts(text: string, referenceId: string): Promise<Buffer | null> {
  const body = JSON.stringify({
    text,
    format: "mp3",
    chunk_length: 300,
    latency: "normal",
    reference_id: referenceId,
    prosody: { normalize_loudness: true },
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15_000);
    try {
      const r = await fetch(FISH_TTS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.FISH_API_KEY}`,
          model: FISH_MODEL,
          "Content-Type": "application/json",
        },
        body,
        signal: ac.signal,
      });
      clearTimeout(timer);
      if (!r.ok) {
        console.warn(`[tts] Fish HTTP ${r.status}`);
        if (r.status === 401 || r.status === 402) return null; // ключ/баланс — не долбим
        continue;
      }
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      clearTimeout(timer);
      console.warn(`[tts] попытка ${attempt + 1}: ${(e as Error).message}`);
    }
  }
  return null;
}

/**
 * Озвучить сообщение чата. Возвращает путь `/tts/<id>.mp3` (для спектатора)
 * или null, если не вышло. Кэшируем по (текст+голос) — повторы бесплатны.
 */
export async function synthChat(rawText: string, referenceId?: string): Promise<string | null> {
  if (!ttsAvailable()) return null;
  const text = cleanChatText(rawText);
  if (!text) return null;
  const ref = referenceId || TTS_DEFAULT_VOICE;

  const id = createHash("sha1").update(`${ref}|${text}`).digest("hex").slice(0, 16);
  const file = resolve(OUT_DIR, `${id}.mp3`);
  const urlPath = `/tts/${id}.mp3`;

  sweep();
  try {
    // Уже озвучено недавно — переиспользуем, продлевая жизнь файла.
    if (Date.now() - statSync(file).mtimeMs < TTL_MS) {
      const now = new Date();
      utimesSync(file, now, now);
      return urlPath;
    }
  } catch {
    /* нет файла — синтезируем */
  }

  const mp3 = await fishTts(text, ref);
  if (!mp3 || mp3.length < 200) return null;
  try {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(file, mp3);
  } catch (e) {
    console.warn(`[tts] запись файла: ${(e as Error).message}`);
    return null;
  }
  return urlPath;
}
