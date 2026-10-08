/**
 * Значки колец и камней — с листа концепта (2026-10-08, ASSETS/CONCEPTS: 6 атрибутов × 10 уровней
 * и два кольца). public/icons/jewels/<атрибут><ур>.webp (str/agi/int/wis/luc/con, 1–10) и
 * ring_gold / ring_legendary. Один источник для ПК/телефона, страницы !inv, итога катакомб и VR.
 *
 *  - Камень — картинка своего уровня целиком (свечение, искры, корона уже нарисованы).
 *  - Кольцо — картинка тира; камни в гнёздах — маленькими значками сверху
 *    (пустое гнездо — тёмный кружок). Обычное кольцо — ring_base (на листе концепта его нет).
 */
import { parseGem, RING_LOOK, type GemKey, type RingTier } from "./jewels";

const BASE = "/icons/jewels/";

/** Камень: картинка уровня 1..10 с листа концепта (public/icons/jewels/<атрибут><ур>.webp). Свечение, искры и корона — уже на картинке. */
export interface GemArt {
  src: string;
  /** Совместимость: наложений нет (всё нарисовано на картинке). */
  under: string;
  over: string;
  /** Доля ячейки под камень: картинка уже в полном размере уровня. */
  scale: number;
}

export function gemArt(k: GemKey): GemArt | null {
  const g = parseGem(k);
  if (!g) return null;
  return { src: `${BASE}${g.attr}${Math.min(10, Math.max(1, g.lv))}.webp`, under: "", over: "", scale: 1 };
}

/** Кольцо: картинка тира и камни в гнёздах (null — пустое гнездо). */
export interface RingArt {
  src: string;
  sockets: (GemKey | null)[];
}

export function ringArt(tier: RingTier, gems: readonly (GemKey | null)[] = []): RingArt {
  const n = RING_LOOK[tier].sockets;
  return { src: `${BASE}ring_${tier}.webp`, sockets: Array.from({ length: n }, (_, i) => gems[i] ?? null) };
}

const LAYER = "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none";

/** HTML-значок камня — заполняет родителя (ячейку). */
export function gemHtml(k: GemKey): string {
  const a = gemArt(k);
  if (!a) return "";
  const sv = (s: string): string => (s ? s.replace("<svg ", `<svg style="${LAYER}" `) : "");
  const pad = (((1 - a.scale) / 2) * 100).toFixed(1);
  const img = `position:absolute;left:${pad}%;top:${pad}%;width:${(a.scale * 100).toFixed(1)}%;height:${(a.scale * 100).toFixed(1)}%;object-fit:contain;pointer-events:none`;
  return `<span style="position:relative;display:block;width:100%;height:100%">${sv(a.under)}<img src="${a.src}" alt="" draggable="false" style="${img}">${sv(a.over)}</span>`;
}

/** Где на значке кольца рисовать камень гнезда i из n (доли размера: x, y, размер). */
export function socketSpot(i: number, n: number): { x: number; y: number; s: number } {
  const s = 0.52;
  // Сверху (2026-10-08): одно гнездо — по центру, два — в верхних углах.
  return n === 1 ? { x: (1 - s) / 2, y: -0.04, s } : { x: i === 0 ? -0.02 : 1.02 - s, y: -0.04, s };
}

/** HTML-значок кольца с камнями гнёзд сверху. */
export function ringHtml(tier: RingTier, gems: readonly (GemKey | null)[] = []): string {
  const a = ringArt(tier, gems);
  let h = `<span style="position:relative;display:block;width:100%;height:100%"><img src="${a.src}" alt="" draggable="false" style="${LAYER}">`;
  a.sockets.forEach((k, i) => {
    const p = socketSpot(i, a.sockets.length);
    const box = `position:absolute;left:${p.x * 100}%;top:${p.y * 100}%;width:${p.s * 100}%;height:${p.s * 100}%;pointer-events:none`;
    const g = gemArt(k ?? "");
    h += g
      ? `<span style="${box}"><img src="${g.src}" alt="" draggable="false" style="${LAYER}"></span>`
      : `<span style="${box}"><span style="position:absolute;inset:16%;border-radius:50%;background:#0d0b12;border:2px solid #7a7488;box-sizing:border-box;box-shadow:inset 0 0 4px #000"></span></span>`;
  });
  return h + "</span>";
}

/** Пустой слот кольца (контур). */
export const RING_SLOT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><ellipse cx="50" cy="56" rx="30" ry="22" fill="none" stroke="#4a4a5c" stroke-width="7" stroke-dasharray="6 6"/></svg>`;
