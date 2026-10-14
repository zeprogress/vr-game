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
import { parseGem, RING_LOOK, type GemKey, type RingTier } from "./jewels";

const BASE = "/icons/jewels/";

/** Камень: картинка и наложение над ней (svg, viewBox 0 0 100 100; "" — нет). Свечения под картинкой нет (убрано 2026-10-12). */
export interface GemArt {
  src: string;
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
  // Свечение под камнем убрано (2026-10-12, по просьбе): уровень видно по размеру, искрам и короне.
  let over = "";
  if (g.lv >= 10) over += `<path d="M38 12 L41 3 L45.5 9 L50 1 L54.5 9 L59 3 L62 12 Z" fill="#ffd166" stroke="#7a4a08" stroke-width="1.2"/>`;
  if (g.lv >= 4) over += sparkle(82, 18, 8) + (g.lv >= 5 ? sparkle(18, 82, 6) : "") + (g.lv >= 8 ? sparkle(84, 78, 5) : "");
  return { src, over: svg(over), scale: gemScale(g.lv) };
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
  return `<span style="position:relative;display:block;width:100%;height:100%"><img src="${a.src}" alt="" draggable="false" style="${img}">${sv(a.over)}</span>`;
}

/** Где на значке кольца рисовать камень гнезда i из n (доли размера: x, y, размер). */
/**
 * Гнёзда на картинке кольца (доли картинки: левый верх и размер). Своё у каждого вида — отверстия нарисованы
 * на картинке каталога колец («Каталог фантазийных колец по уровням»), камень должен лечь в отверстие.
 */
const RING_SOCKETS: Record<RingTier, readonly { x: number; y: number; s: number }[]> = {
  base: [],
  // Вдвое крупнее прежних; центры — по измеренным отверстиям картинок (тёмные области гнёзд).
  gold: [{ x: 0.452, y: 0.414, s: 0.44 }],
  legendary: [
    { x: 0.356, y: 0.481, s: 0.4 },
    { x: 0.616, y: 0.356, s: 0.4 },
  ],
};

/** Место i-го гнезда кольца вида tier. */
export function socketSpot(tier: RingTier, i: number): { x: number; y: number; s: number } {
  return RING_SOCKETS[tier][i] ?? { x: 0, y: 0, s: 0.2 };
}

/** HTML-значок кольца с камнями гнёзд сверху. */
export function ringHtml(tier: RingTier, gems: readonly (GemKey | null)[] = []): string {
  const a = ringArt(tier, gems);
  let h = `<span style="position:relative;display:block;width:100%;height:100%"><img src="${a.src}" alt="" draggable="false" style="${LAYER}">`;
  a.sockets.forEach((k, i) => {
    const p = socketSpot(tier, i);
    // Квадрат по соотношению сторон (aspect-ratio), а не по процентам высоты: иначе гнездо — овал, если контейнер не квадратный.
    const box = `position:absolute;left:${p.x * 100}%;top:${p.y * 100}%;width:${p.s * 100}%;aspect-ratio:1;pointer-events:none`;
    const g = gemArt(k ?? "");
    h += g
      ? `<span style="${box}"><img src="${g.src}" alt="" draggable="false" style="${LAYER}"></span>`
      : `<span style="${box}"><span style="position:absolute;inset:16%;border-radius:50%;background:#0d0b12;border:2px solid #7a7488;box-sizing:border-box;box-shadow:inset 0 0 4px #000"></span></span>`;
  });
  return h + "</span>";
}

/** Пустой слот кольца (контур). */
export const RING_SLOT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><ellipse cx="50" cy="56" rx="30" ry="22" fill="none" stroke="#4a4a5c" stroke-width="7" stroke-dasharray="6 6"/></svg>`;
