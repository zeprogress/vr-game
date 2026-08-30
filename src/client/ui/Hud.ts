import { PLAYER_HP } from "#shared/constants";
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
  private readonly lowVignette: HTMLDivElement;
  private readonly toastEl: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly deathEl: HTMLDivElement;
  private prog: Progression | null = null;
  private toastTimer: number | null = null;

  constructor() {
    this.bar = el("div", HP_BAR_CSS);
    this.fill = el("div", HP_FILL_CSS);
    this.label = el("div", HP_LABEL_CSS);
    this.bar.append(this.fill, this.label);

    this.vignette = el("div", VIGNETTE_CSS);
    this.lowVignette = el("div", LOW_VIGNETTE_CSS);
    this.toastEl = el("div", TOAST_CSS);
    this.panel = el("div", PANEL_CSS);
    this.deathEl = el("div", DEATH_CSS);

    document.body.append(
      this.bar,
      this.lowVignette,
      this.vignette,
      this.toastEl,
      this.panel,
      this.deathEl,
    );
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
    const peak = Math.min(0.9, 0.4 + dmg / 40);
    this.vignette.style.transition = "none";
    this.vignette.style.opacity = String(peak);
    void this.vignette.offsetHeight;
    this.vignette.style.transition = "opacity 0.5s ease-out";
    this.vignette.style.opacity = "0";
  }

  /** Постоянная виньетка нехватки здоровья. alpha уже с пульсацией (0..1). */
  setLowHealth(alpha: number): void {
    this.lowVignette.style.opacity = String(Math.max(0, Math.min(1, alpha)));
  }

  /** Экран смерти: затемнение и отсчёт до возрождения. */
  setDead(dead: boolean, secondsLeft = 0): void {
    this.deathEl.style.opacity = dead ? "1" : "0";
    if (dead) {
      const t = Math.max(0, Math.ceil(secondsLeft));
      this.deathEl.textContent = t > 0 ? `Вы погибли\nВозрождение через ${t}…` : "Вы погибли";
    }
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
  "position:fixed;left:16px;top:18px;width:390px;height:11px;z-index:35;" +
  "background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.4);border-radius:4px;overflow:visible;" +
  "transition:opacity 0.6s ease-out;";

const HP_FILL_CSS =
  "position:absolute;inset:0;width:100%;background:#4caf50;border-radius:3px;" +
  "transition:width 0.2s linear, background 0.3s;";

const HP_LABEL_CSS =
  "position:absolute;left:100%;top:50%;transform:translateY(-50%);margin-left:10px;white-space:nowrap;" +
  "font:bold 12px system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.9);";

const VIGNETTE_CSS =
  "position:fixed;inset:0;z-index:34;pointer-events:none;opacity:0;" +
  "box-shadow:inset 0 0 210px 80px rgba(255,0,0,0.95);background:rgba(150,0,0,0.12);";

const LOW_VIGNETTE_CSS =
  "position:fixed;inset:0;z-index:33;pointer-events:none;opacity:0;transition:opacity 0.12s linear;" +
  "box-shadow:inset 0 0 170px 70px rgba(220,0,0,0.85);";

const TOAST_CSS =
  "position:fixed;left:50%;top:22%;transform:translateX(-50%);z-index:36;" +
  "padding:10px 18px;background:rgba(20,22,30,0.85);color:#ffd166;border-radius:8px;" +
  "font:bold 16px system-ui,sans-serif;opacity:0;transition:opacity 0.4s;pointer-events:none;";

const DEATH_CSS =
  "position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;" +
  "background:radial-gradient(ellipse at center,rgba(60,0,0,0.55),rgba(0,0,0,0.9));" +
  "color:#ffdede;font:bold 28px system-ui,sans-serif;text-align:center;white-space:pre-line;" +
  "opacity:0;transition:opacity 0.5s;pointer-events:none;";

const PANEL_CSS =
  "position:fixed;left:16px;top:52px;z-index:36;padding:12px 14px;width:210px;" +
  "background:rgba(18,20,28,0.92);color:#e8ecf8;border:1px solid #5a6480;border-radius:8px;" +
  "font:13px/1.4 system-ui,sans-serif;";
