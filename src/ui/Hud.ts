import { PLAYER_HP } from "../shared/constants";
import { STAT_LABELS, type Progression, type StatName } from "../player/Progression";

const STATS: StatName[] = ["str", "agi", "int"];

/**
 * HUD плоского режима: полоса здоровья, красная вспышка при уроне,
 * всплывающие сообщения и панель персонажа (клавиша C).
 */
export class Hud {
  private readonly bar: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly label: HTMLDivElement;
  private readonly vignette: HTMLDivElement;
  private readonly toastEl: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private prog: Progression | null = null;
  private toastTimer: number | null = null;

  constructor() {
    this.bar = el("div", HP_BAR_CSS);
    this.fill = el("div", HP_FILL_CSS);
    this.label = el("div", HP_LABEL_CSS);
    this.bar.append(this.fill, this.label);

    this.vignette = el("div", VIGNETTE_CSS);
    this.toastEl = el("div", TOAST_CSS);
    this.panel = el("div", PANEL_CSS);

    document.body.append(this.bar, this.vignette, this.toastEl, this.panel);
  }

  /** Подключить прогрессию — включает панель персонажа на клавишу C. */
  bindProgression(prog: Progression): void {
    this.prog = prog;
    prog.onChange(() => this.renderPanel());
    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyC") {
        this.panel.style.display = this.panel.style.display === "none" ? "block" : "none";
        this.renderPanel();
      }
    });
    this.panel.style.display = "none";
    this.renderPanel();
  }

  setHp(hp: number, max: number = PLAYER_HP.max): void {
    const frac = Math.max(0, Math.min(1, hp / max));
    this.fill.style.width = `${frac * 100}%`;
    this.fill.style.background =
      frac > 0.5 ? "#4caf50" : frac > 0.25 ? "#e0a020" : "#d13030";
    this.label.textContent = `${Math.ceil(hp)} / ${Math.round(max)}`;
  }

  /** 0..1 — плавное появление/исчезновение полосы. */
  setOpacity(a: number): void {
    this.bar.style.opacity = String(Math.max(0, Math.min(1, a)));
  }

  flashDamage(dmg: number): void {
    const peak = Math.min(0.6, 0.15 + dmg / 60);
    this.vignette.style.transition = "none";
    this.vignette.style.opacity = String(peak);
    void this.vignette.offsetHeight;
    this.vignette.style.transition = "opacity 0.5s ease-out";
    this.vignette.style.opacity = "0";
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.style.opacity = "1";
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.style.opacity = "0";
    }, 2200);
  }

  private renderPanel(): void {
    const p = this.prog;
    if (!p || this.panel.style.display === "none") return;
    this.panel.replaceChildren();

    const title = el("div", "font:bold 16px system-ui;margin-bottom:8px;");
    title.textContent = `Уровень ${p.level}`;
    this.panel.appendChild(title);

    const xp = el("div", "margin-bottom:10px;opacity:0.85;");
    xp.textContent = p.atMaxLevel ? "Максимальный уровень" : `Опыт ${p.xp} / ${p.xpToNext()}`;
    this.panel.appendChild(xp);

    for (const s of STATS) {
      const row = el("div", "display:flex;align-items:center;gap:8px;margin:5px 0;");
      const name = el("span", "width:96px;");
      name.textContent = STAT_LABELS[s];
      const val = el("span", "width:26px;text-align:right;font-weight:bold;");
      val.textContent = String(p.stats[s]);
      row.append(name, val);

      if (p.unspent > 0) {
        const btn = document.createElement("button");
        btn.textContent = "+";
        btn.style.cssText =
          "width:26px;height:24px;cursor:pointer;background:#2f7a35;color:#fff;" +
          "border:1px solid #4c4;border-radius:4px;font-weight:bold;";
        btn.addEventListener("click", () => p.spend(s));
        row.appendChild(btn);
      }
      this.panel.appendChild(row);
    }

    const free = el("div", `margin-top:10px;${p.unspent > 0 ? "color:#7ee081;" : "opacity:0.6;"}`);
    free.textContent = `Свободных очков: ${p.unspent}`;
    this.panel.appendChild(free);

    const hint = el("div", "margin-top:8px;font-size:11px;opacity:0.55;");
    hint.textContent = "C — закрыть";
    this.panel.appendChild(hint);
  }
}

function el(tag: string, css: string): HTMLDivElement {
  const d = document.createElement(tag) as HTMLDivElement;
  d.style.cssText = css;
  return d;
}

const HP_BAR_CSS =
  "position:fixed;left:16px;top:16px;width:260px;height:22px;z-index:35;" +
  "background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.4);border-radius:5px;overflow:hidden;" +
  "transition:opacity 0.6s ease-out;";

const HP_FILL_CSS =
  "position:absolute;inset:0;width:100%;background:#4caf50;transition:width 0.2s linear, background 0.3s;";

const HP_LABEL_CSS =
  "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;" +
  "font:bold 13px system-ui,sans-serif;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.8);";

const VIGNETTE_CSS =
  "position:fixed;inset:0;z-index:34;pointer-events:none;opacity:0;" +
  "box-shadow:inset 0 0 140px 40px rgba(180,0,0,0.9);background:rgba(140,0,0,0.15);";

const TOAST_CSS =
  "position:fixed;left:50%;top:22%;transform:translateX(-50%);z-index:36;" +
  "padding:10px 18px;background:rgba(20,22,30,0.85);color:#ffd166;border-radius:8px;" +
  "font:bold 16px system-ui,sans-serif;opacity:0;transition:opacity 0.4s;pointer-events:none;";

const PANEL_CSS =
  "position:fixed;left:16px;top:52px;z-index:36;padding:12px 14px;width:210px;" +
  "background:rgba(18,20,28,0.92);color:#e8ecf8;border:1px solid #5a6480;border-radius:8px;" +
  "font:13px/1.4 system-ui,sans-serif;";
