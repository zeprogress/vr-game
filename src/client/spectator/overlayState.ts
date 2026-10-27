import { CAT_PHASE } from "#shared/catacombs";
import type { ZoneState } from "#shared/net/schema";

export type OverlayOnline = { nick: string; speaking: boolean; bot: boolean; plat: number };
export type OverlayTickerKind = "event" | "news";

/**
 * Строка сверху: идёт ивент или катакомбы — крупно. Считается из состояния комнаты, поэтому её одинаково
 * видят и рендерящий спектатор, и отдельная страница оверлея (overlay.html) — без кадра из сцены.
 */
export function tickerOf(st: ZoneState | null | undefined): { ticker: string; tickerKind: OverlayTickerKind } {
  if (st && st.catPhase >= CAT_PHASE.run) {
    // Идут катакомбы — сверху пусто: зрителю и так видно, что это забег (баннеры, таблица урона).
    return { ticker: "", tickerKind: "event" };
  }
  if (st?.catPhase === CAT_PHASE.gather) return { ticker: "Идёт сбор в Катакомбы (!катакомбы)", tickerKind: "event" };
  if (st?.eventKind === 1) return { ticker: "Идёт ивент — нашествие мобов (!event)", tickerKind: "event" };
  if (st?.eventKind === 2) return { ticker: "Идёт ивент — охота на элиту (!event)", tickerKind: "event" };
  if (st?.eventKind === 3) return { ticker: "Идёт ивент — Охотничья башня (!event)", tickerKind: "event" };
  // Иначе — пусто: новостная строка приходит кадром из рендерящего спектатора, если он есть.
  return { ticker: "", tickerKind: "news" };
}

/** Онлайн из состояния комнаты: игроки и боты. `speaking` решает вызывающий (голос есть только у спектатора). */
export function onlineOf(
  st: ZoneState | null | undefined,
  speaking: (id: string, nick: string) => boolean,
): OverlayOnline[] {
  const out: OverlayOnline[] = [];
  st?.players.forEach((p, id) =>
    out.push({ nick: p.nick, speaking: speaking(id, p.nick), bot: id.startsWith("bot:"), plat: p.plat }),
  );
  return out;
}
