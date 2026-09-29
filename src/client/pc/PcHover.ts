/**
 * Курсор и подсказка при наведении (ПК, «как в WoW»): над мобом/врагом —
 * меч, над предметом на земле — рука, над остальным — обычная стрелка;
 * рядом с курсором — карточка с именем, уровнем, здоровьем / редкостью.
 */

export type HoverCursor = "default" | "attack" | "loot" | "aim";

export interface HoverInfo {
  title: string;
  titleColor: string;
  lines: { text: string; color?: string }[];
  cursor: HoverCursor;
}

const svgCursor = (svg: string, hx: number, hy: number, fallback: string): string =>
  `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") ${hx} ${hy}, ${fallback}`;

/** Меч остриём в левый верхний угол — «атаковать». */
const SWORD = svgCursor(
  `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">` +
    `<path d="M2 2 L6 2 L19 15 L15 19 L2 6 Z" fill="#e8e8ee" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/>` +
    `<path d="M13 21 L21 13 M16 18 L22 24 M18 16 L24 22 M21 21 L25 25" stroke="#111" stroke-width="3.2" stroke-linecap="round"/>` +
    `<path d="M13 21 L21 13 M16 18 L22 24 M18 16 L24 22" stroke="#b08a4a" stroke-width="1.8" stroke-linecap="round"/>` +
    `</svg>`,
  2,
  2,
  "crosshair",
);

/** Белая рука — «подобрать». */
const HAND = svgCursor(
  `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round">` +
    `<path d="M8 11V5.5a1.5 1.5 0 0 1 3 0V10V4.5a1.5 1.5 0 0 1 3 0V10V5.5a1.5 1.5 0 0 1 3 0V11V8.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.6-2.8L3.7 15a1.6 1.6 0 0 1 2.4-2.1L8 14.5Z"/>` +
    `</svg>`,
  12,
  3,
  "pointer",
);

const CURSOR: Record<HoverCursor, string> = { default: "", attack: SWORD, loot: HAND, aim: "crosshair" };

export class PcHover {
  private readonly tip: HTMLDivElement;
  private cursor: HoverCursor = "default";
  private sig = "";

  constructor(
    private readonly canvas: HTMLCanvasElement,
    /** Babylon на каждое движение мыши ставит холсту scene.defaultCursor — задаём курсор через неё. */
    private readonly setSceneCursor: (css: string) => void,
  ) {
    const s = document.createElement("style");
    s.textContent = `
.pc-hover { position:fixed; z-index:38; pointer-events:none; display:none; max-width:260px; background:rgba(12,11,16,.94);
  border:none; border-radius:7px; padding:7px 10px; font:500 12.5px/1.4 system-ui,sans-serif; color:#d8d2c2;
  box-shadow:0 4px 16px rgba(0,0,0,.45); }
.pc-hover b { display:block; font-size:14px; margin-bottom:2px; }`;
    document.head.appendChild(s);
    this.tip = document.createElement("div");
    this.tip.className = "pc-hover";
    document.body.appendChild(this.tip);
  }

  /** info=null — прятать подсказку; (x,y) — курсор в px экрана. */
  set(info: HoverInfo | null, x: number, y: number, cursor: HoverCursor = info?.cursor ?? "default"): void {
    if (cursor !== this.cursor) {
      this.cursor = cursor;
      this.setSceneCursor(CURSOR[cursor]);
      this.canvas.style.cursor = CURSOR[cursor];
    }
    if (!info) {
      if (this.tip.style.display !== "none") this.tip.style.display = "none";
      this.sig = "";
      return;
    }
    const sig = info.title + "|" + info.lines.map((l) => l.text).join("|");
    if (sig !== this.sig) {
      this.sig = sig;
      this.tip.innerHTML = "";
      const t = document.createElement("b");
      t.textContent = info.title;
      t.style.color = info.titleColor;
      this.tip.append(t);
      for (const l of info.lines) {
        const d = document.createElement("div");
        d.textContent = l.text;
        if (l.color) d.style.color = l.color;
        this.tip.append(d);
      }
    }
    this.tip.style.display = "block";
    const w = this.tip.offsetWidth;
    const h = this.tip.offsetHeight;
    const left = x + 20 + w > window.innerWidth ? x - w - 12 : x + 20;
    const top = y + 22 + h > window.innerHeight ? y - h - 10 : y + 22;
    this.tip.style.left = `${Math.max(4, left)}px`;
    this.tip.style.top = `${Math.max(4, top)}px`;
  }

  dispose(): void {
    this.tip.remove();
  }
}
