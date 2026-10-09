import { ICONS, type IconKey } from "#shared/icons";
import { themeCss } from "#shared/look";

/**
 * Отрисовка значков из общего реестра (shared/icons.ts) — для HTML и для
 * холстов. Сам значок задаётся ТОЛЬКО в реестре; здесь — как его показать.
 *
 * HTML: значок = 1.2em (как эмодзи того же шрифта) — масштаб берётся из размера шрифта места, куда
 * его вставили (ячейка, кнопка, баннер). Цвет — currentColor места или явный.
 * Холст: drawIcon(ctx, ключ, x, y, размер, цвет) — картинка кешируется,
 * первый раз приходит асинхронно (onReady — перерисовать холст).
 * Картинки оружия и щитов уже нарисованы в цвете грейда — их не перекрашиваем.
 */

let cssDone = false;
/** Общие стили значков и переменные вида (тиры, оценка) — один раз на страницу. */
export function ensureIconCss(): void {
  if (cssDone || typeof document === "undefined") return;
  cssDone = true;
  const s = document.createElement("style");
  s.textContent =
    themeCss() +
    ".gico{display:inline-block;width:1.2em;height:1.2em;vertical-align:-.22em;flex:none;pointer-events:none}" +
    "img.gico{object-fit:contain}" +
    ".gico-e{width:auto;height:auto;line-height:1;vertical-align:baseline}" +
    // Картинки оружия и щитов — на 20% крупнее обычного значка (контур картинки занимает мало места).
    "img.gico-gear{width:1.45em;height:1.45em;vertical-align:-.35em}";
  document.head.appendChild(s);
}

function svgMarkup(k: IconKey, color?: string, size?: number): string {
  const d = ICONS[k] as { svg?: string; box?: string };
  const wh = size ? ` width="${size}" height="${size}"` : "";
  const col = color ? ` color="${color}"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${d.box ?? "0 0 100 100"}"${wh}${col} class="gico">${d.svg}</svg>`;
}

/** Значок строкой HTML (1em, цвет — текущий цвет текста места или `color`). */
export function iconHtml(k: IconKey, color?: string): string {
  ensureIconCss();
  const d = ICONS[k] as { emoji: string; svg?: string; img?: string };
  const style = color ? ` style="color:${color}"` : "";
  if (d.svg) return svgMarkup(k, color);
  if (d.img) {
    const cls = k.startsWith("w.") ? "gico gico-gear" : "gico";
    return `<img class="${cls}" src="/icons/${d.img}" alt="" draggable="false">`;
  }
  return `<span class="gico gico-e"${style}>${d.emoji}</span>`;
}

/** Положить значок в элемент (заменяет содержимое). */
export function setIconEl(el: HTMLElement, k: IconKey, color?: string): void {
  el.innerHTML = iconHtml(k, color);
}

// ---- холсты ----

const imgCache = new Map<string, HTMLImageElement | null>();
const waiting = new Map<string, Array<() => void>>();

function imageFor(k: IconKey, color: string, onReady?: () => void): HTMLImageElement | null {
  const d = ICONS[k] as { svg?: string; img?: string };
  const key = `${k}|${color}`;
  const have = imgCache.get(key);
  if (have) return have;
  if (onReady) {
    const list = waiting.get(key) ?? [];
    list.push(onReady);
    waiting.set(key, list);
  }
  if (have === null) return null; // уже грузится
  imgCache.set(key, null);
  const img = new Image();
  img.onload = () => {
    imgCache.set(key, img);
    for (const f of waiting.get(key) ?? []) f();
    waiting.delete(key);
  };
  img.src = d.svg
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup(k, color, 128))}`
    : `/icons/${d.img}`;
  return null;
}

/**
 * Нарисовать значок на холсте в квадрат (x, y, s). `color` — для одноцветных
 * (эмодзи, векторные значки). Картинка ещё грузится — вызовется `onReady` (перерисуй).
 */
export function drawIcon(
  ctx: CanvasRenderingContext2D,
  k: IconKey,
  x: number,
  y: number,
  s: number,
  color = "#e6e0d0",
  onReady?: () => void,
): void {
  const d = ICONS[k] as { emoji: string; svg?: string; img?: string };
  if (d.svg || d.img) {
    const img = imageFor(k, color, onReady);
    // Картинки оружия и щитов рисуем на 12% крупнее (как значки в HTML), остальные — как есть.
    const e = d.img && k.startsWith("w.") ? s * 0.12 : 0;
    if (img) ctx.drawImage(img, x - e, y - e, s + 2 * e, s + 2 * e);
    return;
  }
  ctx.save();
  ctx.font = `${Math.round(s * 0.82)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(d.emoji, x + s / 2, y + s / 2 + s * 0.04);
  ctx.restore();
}
