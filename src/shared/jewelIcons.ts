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
import { parseGem, type GemKey, type RingTier } from "./jewels";
import { RING_ROLL } from "./ringAffixes";

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

/**
 * Картинка кольца — ring_<тир>_<гнёзд>.webp из «Таблица фэнтезийных колец редкости» (tools/icons/cut_rings.py, 2026-10-23).
 * Гнёзд — сколько у этого кольца (длина gems); без gems (добыча, лента) — меньшее число тира.
 */
export function ringArt(tier: RingTier, gems: readonly (GemKey | null)[] = []): RingArt {
  const [lo, hi] = RING_ROLL.sockets[tier];
  const n = Math.max(lo, Math.min(hi, gems.length || lo));
  return { src: `${BASE}ring_${tier}_${n}.webp`, sockets: Array.from({ length: n }, (_, i) => gems[i] ?? null) };
}

/**
 * Ожерелья (заготовка, 2026-10-23; в игру ещё не добавлены): картинки public/icons/jewels/necklace_<тир>_<гнёзд>.webp,
 * нарезаны из «Сетка фантазийных ожерелий разных редкостей.png» (tools/icons/cut_necklaces.py + glow_necklaces.py).
 * Тир heroic — мифический синий; свечение растёт от обычного (нет) к мифическому (сильнее всех). Гнёзд 0–3.
 */
export type NecklaceTier = "base" | "gold" | "legendary" | "ruby" | "heroic";
export function necklaceSrc(tier: NecklaceTier, sockets: number): string {
  return `${BASE}necklace_${tier}_${Math.max(0, Math.min(3, Math.round(sockets)))}.webp`;
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

/**
 * Гнёзда на картинке кольца по тиру и числу гнёзд: центр и размер камня (доли картинки) — замерены по картинкам
 * таблицы колец (2026-10-23). У фиолетового и рубинового гнёзда — цветные камни картинки; вставленный камень ложится сверху.
 */
const RING_SOCKETS: Record<string, readonly { cx: number; cy: number; s: number }[]> = {
  "gold:1": [{ cx: 0.71, cy: 0.6, s: 0.26 }],
  "legendary:1": [{ cx: 0.625, cy: 0.6, s: 0.27 }],
  "legendary:2": [{ cx: 0.55, cy: 0.64, s: 0.23 }, { cx: 0.79, cy: 0.54, s: 0.23 }],
  "ruby:2": [{ cx: 0.48, cy: 0.69, s: 0.22 }, { cx: 0.715, cy: 0.64, s: 0.22 }],
};

/** Место i-го гнезда кольца тира tier с n гнёздами (левый верх и размер — доли картинки). */
export function socketSpot(tier: RingTier, n: number, i: number): { x: number; y: number; s: number } {
  const c = RING_SOCKETS[`${tier}:${n}`]?.[i];
  return c ? { x: c.cx - c.s / 2, y: c.cy - c.s / 2, s: c.s } : { x: 0.4, y: 0.45, s: 0.2 };
}

/** HTML-значок кольца с камнями гнёзд сверху. */
export function ringHtml(tier: RingTier, gems: readonly (GemKey | null)[] = []): string {
  const a = ringArt(tier, gems);
  let h = `<span style="position:relative;display:block;width:100%;height:100%"><img src="${a.src}" alt="" draggable="false" style="${LAYER}">`;
  a.sockets.forEach((k, i) => {
    const p = socketSpot(tier, a.sockets.length, i);
    // Квадрат по соотношению сторон (aspect-ratio), а не по процентам высоты: иначе гнездо — овал, если контейнер не квадратный.
    const box = `position:absolute;left:${p.x * 100}%;top:${p.y * 100}%;width:${p.s * 100}%;aspect-ratio:1;pointer-events:none`;
    const g = gemArt(k ?? "");
    h += g
      ? `<span style="${box}"><img src="${g.src}" alt="" draggable="false" style="${LAYER}"></span>`
      : `<span style="${box}"><span style="position:absolute;inset:16%;border-radius:50%;background:#0d0b12;border:2px solid #7a7488;box-sizing:border-box;box-shadow:inset 0 0 4px #000"></span></span>`;
  });
  return h + "</span>";
}

/**
 * Гнёзда на картинке ожерелья по их числу (центры отверстий замерены по картинкам, 2026-10-23); s — размер камня.
 * Одинаковы у всех тиров (картинки одной сетки).
 */
const NECK_SOCKETS: readonly (readonly { cx: number; cy: number }[])[] = [
  [],
  [{ cx: 0.5, cy: 0.59 }],
  [{ cx: 0.416, cy: 0.572 }, { cx: 0.587, cy: 0.572 }],
  [{ cx: 0.389, cy: 0.545 }, { cx: 0.502, cy: 0.545 }, { cx: 0.613, cy: 0.545 }],
];
const NECK_GEM = 0.13;

/** Место i-го гнезда ожерелья с n гнёздами (доли картинки: левый верх и размер — как socketSpot у кольца). */
export function neckSocketSpot(n: number, i: number): { x: number; y: number; s: number } {
  const c = NECK_SOCKETS[Math.max(0, Math.min(3, n))][i] ?? { cx: 0.5, cy: 0.56 };
  return { x: c.cx - NECK_GEM / 2, y: c.cy - NECK_GEM / 2, s: NECK_GEM };
}

/** HTML-значок ожерелья с камнями в гнёздах (пустое гнездо видно на самой картинке). */
export function neckHtml(tier: NecklaceTier, gems: readonly (GemKey | null)[] = []): string {
  let h = `<span style="position:relative;display:block;width:100%;height:100%"><img src="${necklaceSrc(tier, gems.length)}" alt="" draggable="false" style="${LAYER}">`;
  gems.forEach((k, i) => {
    const g = gemArt(k ?? "");
    if (!g) return;
    const p = neckSocketSpot(gems.length, i);
    h += `<span style="position:absolute;left:${p.x * 100}%;top:${p.y * 100}%;width:${p.s * 100}%;aspect-ratio:1;pointer-events:none"><img src="${g.src}" alt="" draggable="false" style="${LAYER}"></span>`;
  });
  return h + "</span>";
}

/** Пустой слот ожерелья (контур цепочки). */
export const NECK_SLOT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M18 26 Q50 78 82 26" fill="none" stroke="#4a4a5c" stroke-width="6" stroke-dasharray="6 6"/><path d="M50 58 L42 66 L50 80 L58 66 Z" fill="none" stroke="#4a4a5c" stroke-width="5"/></svg>`;

/** Пустой слот кольца (контур). */
export const RING_SLOT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><ellipse cx="50" cy="56" rx="30" ry="22" fill="none" stroke="#4a4a5c" stroke-width="7" stroke-dasharray="6 6"/></svg>`;
