/**
 * Значки колец и камней — картинки из концепта пользователя (2026-10-07,
 * public/icons/jewels/*.webp: камни 1–3 ур. по атрибутам, три кольца). Один источник для
 * ПК/телефона, страницы !inv, итога катакомб и VR-холстов.
 *
 *  - Камень 1–3 ур. — своя картинка; 4+ — картинка 3 ур. и наложение поверх (svg без внешних
 *    ссылок): 4–5 — искры, 6–9 — золотое сияние, 10+ — лучи и корона.
 *  - Кольцо — картинка тира; камни в гнёздах — маленькими значками сверху
 *    (пустое гнездо — тёмный кружок).
 */
import { GEM_LOOK, parseGem, RING_LOOK, type GemKey, type RingTier } from "./jewels";

const BASE = "/icons/jewels/";

/** Камень: картинка и наложения под/над ней (svg, viewBox 0 0 100 100; "" — нет). */
export interface GemArt {
  src: string;
  under: string;
  over: string;
  /** Размер камня в ячейке (доля): 1 ур. — поменьше, к 10 — во всю ячейку. */
  scale: number;
}

/** Размер камня по уровню (доля ячейки): ранние уровни — крупные шаги, к 10 — во всю ячейку. */
const SCALE = [0.52, 0.64, 0.75, 0.83, 0.9, 0.93, 0.95, 0.97, 0.99, 1];
export function gemScale(lv: number): number {
  return SCALE[Math.min(SCALE.length, Math.max(1, lv)) - 1];
}

function sparkle(x: number, y: number, r: number): string {
  return `<path d="M${x} ${y - r} L${x + r * 0.25} ${y - r * 0.25} L${x + r} ${y} L${x + r * 0.25} ${y + r * 0.25} L${x} ${y + r} L${x - r * 0.25} ${y + r * 0.25} L${x - r} ${y} L${x - r * 0.25} ${y - r * 0.25} Z" fill="#fff"/>`;
}
const svg = (inner: string): string => (inner ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${inner}</svg>` : "");

export function gemArt(k: GemKey): GemArt | null {
  const g = parseGem(k);
  if (!g) return null;
  const src = `${BASE}${g.attr}${Math.min(3, g.lv)}.webp`;
  const c = GEM_LOOK[g.attr];
  let under = "";
  let over = "";
  // Сияние цвета камня — ярче и шире с каждым уровнем (заметная разница уровень к уровню).
  const glow = Math.min(0.95, 0.12 + g.lv * 0.09);
  under += `<defs><radialGradient id="gg"><stop offset="0" stop-color="${c.c}" stop-opacity="${glow.toFixed(2)}"/><stop offset=".6" stop-color="${c.c}" stop-opacity="${(glow * 0.45).toFixed(2)}"/><stop offset="1" stop-color="${c.c}" stop-opacity="0"/></radialGradient></defs><circle cx="50" cy="50" r="${Math.min(50, 26 + g.lv * 3)}" fill="url(#gg)"/>`;
  // Без ободков (2026-10-07: убраны по просьбе) — уровень видно по размеру, сиянию, искрам и короне.
  if (g.lv >= 6) {
    under += `<defs><radialGradient id="ga"><stop offset=".55" stop-color="#ffd166" stop-opacity="0"/><stop offset=".75" stop-color="#ffd166" stop-opacity=".45"/><stop offset="1" stop-color="#ffd166" stop-opacity="0"/></radialGradient></defs><circle cx="50" cy="50" r="50" fill="url(#ga)"/>`;
    if (g.lv >= 10) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + 0.13;
        const r1 = i % 2 ? 46 : 50;
        const p = (r: number, d: number): string => `${(50 + Math.sin(a + d) * r).toFixed(1)},${(50 - Math.cos(a + d) * r).toFixed(1)}`;
        under += `<polygon points="${p(30, -0.07)} ${p(r1, 0)} ${p(30, 0.07)}" fill="${c.l}" opacity=".85"/>`;
      }
      over += `<path d="M38 12 L41 3 L45.5 9 L50 1 L54.5 9 L59 3 L62 12 Z" fill="#ffd166" stroke="#7a4a08" stroke-width="1.2"/>`;
    }
  }
  if (g.lv >= 4) over += sparkle(82, 18, 8) + (g.lv >= 5 ? sparkle(18, 82, 6) : "") + (g.lv >= 8 ? sparkle(84, 78, 5) : "");
  return { src, under: svg(under), over: svg(over), scale: gemScale(g.lv) };
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
