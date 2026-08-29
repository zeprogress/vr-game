import { PLAYER_HP } from "../shared/constants";

/** Простой HUD: полоса здоровья сверху слева + красная вспышка при уроне. */
export class Hud {
  private readonly bar: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly label: HTMLDivElement;
  private readonly vignette: HTMLDivElement;

  constructor() {
    this.bar = el("div", HP_BAR_CSS);
    this.fill = el("div", HP_FILL_CSS);
    this.label = el("div", HP_LABEL_CSS);
    this.bar.append(this.fill, this.label);

    this.vignette = el("div", VIGNETTE_CSS);

    document.body.append(this.bar, this.vignette);
  }

  setHp(hp: number): void {
    const frac = Math.max(0, Math.min(1, hp / PLAYER_HP.max));
    this.fill.style.width = `${frac * 100}%`;
    this.fill.style.background =
      frac > 0.5 ? "#4caf50" : frac > 0.25 ? "#e0a020" : "#d13030";
    this.label.textContent = `${Math.ceil(hp)} / ${PLAYER_HP.max}`;
  }

  flashDamage(dmg: number): void {
    const peak = Math.min(0.6, 0.15 + dmg / 60);
    this.vignette.style.transition = "none";
    this.vignette.style.opacity = String(peak);
    // форс reflow, затем плавно гасим
    void this.vignette.offsetHeight;
    this.vignette.style.transition = "opacity 0.5s ease-out";
    this.vignette.style.opacity = "0";
  }
}

function el(tag: string, css: string): HTMLDivElement {
  const d = document.createElement(tag) as HTMLDivElement;
  d.style.cssText = css;
  return d;
}

const HP_BAR_CSS =
  "position:fixed;left:16px;top:16px;width:260px;height:22px;z-index:35;" +
  "background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.4);border-radius:5px;overflow:hidden;";

const HP_FILL_CSS =
  "position:absolute;inset:0;width:100%;background:#4caf50;transition:width 0.2s linear, background 0.3s;";

const HP_LABEL_CSS =
  "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;" +
  "font:bold 13px system-ui,sans-serif;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.8);";

const VIGNETTE_CSS =
  "position:fixed;inset:0;z-index:34;pointer-events:none;opacity:0;" +
  "box-shadow:inset 0 0 140px 40px rgba(180,0,0,0.9);background:rgba(140,0,0,0.15);";
