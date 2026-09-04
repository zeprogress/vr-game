import { PLAYER_HP } from "#shared/constants";
import { STAT_LABELS, type Progression, type StatName } from "../player/Progression";
import { ITEMS, type Inventory } from "../player/Inventory";

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
  private readonly backdrop: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly deathEl: HTMLDivElement;
  /** Вернуть управление в игру после закрытия панели (захват мыши). */
  private relock: (() => void) | null = null;
  private prog: Progression | null = null;
  private inv: Inventory | null = null;
  private toastTimer: number | null = null;

  constructor() {
    this.bar = el("div", HP_BAR_CSS);
    this.fill = el("div", HP_FILL_CSS);
    this.label = el("div", HP_LABEL_CSS);
    this.bar.append(this.fill, this.label);

    this.vignette = el("div", VIGNETTE_CSS);
    this.lowVignette = el("div", LOW_VIGNETTE_CSS);
    this.toastEl = el("div", TOAST_CSS);
    this.backdrop = el("div", BACKDROP_CSS);
    this.panel = el("div", PANEL_CSS);
    this.backdrop.appendChild(this.panel);
    this.backdrop.addEventListener("pointerdown", (e) => {
      // Клик мимо панели — закрыть; клик по самой панели не всплывает сюда.
      if (e.target === this.backdrop) this.closePanel();
    });
    this.deathEl = el("div", DEATH_CSS);

    document.body.append(
      this.bar,
      this.lowVignette,
      this.vignette,
      this.toastEl,
      this.backdrop,
      this.deathEl,
    );
  }

  /** Пока панель персонажа открыта, мышь свободна — этим вернём её в игру. */
  bindPointerLock(relock: () => void): void {
    this.relock = relock;
    document.addEventListener("pointerlockchange", () => {
      // Вернулись в игру (кликнули по канвасу) — панель больше не нужна.
      if (document.pointerLockElement) this.hidePanel();
    });
  }

  private get panelOpen(): boolean {
    return this.backdrop.style.display === "flex";
  }

  private openPanel(): void {
    this.backdrop.style.display = "flex";
    if (document.pointerLockElement) document.exitPointerLock();
    this.renderPanel();
  }

  /** Спрятать без возврата захвата мыши (вызывается из pointerlockchange). */
  private hidePanel(): void {
    this.backdrop.style.display = "none";
  }

  private closePanel(): void {
    if (!this.panelOpen) return;
    this.hidePanel();
    this.relock?.();
  }

  private togglePanel(): void {
    if (this.panelOpen) this.closePanel();
    else this.openPanel();
  }

  /** Подключить сумку — в панели персонажа появится раздел «Сумка». */
  bindInventory(inv: Inventory): void {
    this.inv = inv;
    inv.onChange(() => this.renderPanel());
  }

  /** Подключить прогрессию — включает панель персонажа на клавишу C. */
  bindProgression(prog: Progression): void {
    this.prog = prog;
    prog.onChange(() => this.renderPanel());
    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyC" && !e.repeat) this.togglePanel();
    });
    this.backdrop.style.display = "none";
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

  /** Раздел «Сумка» внизу панели персонажа. */
  private renderBag(): void {
    const inv = this.inv;
    if (!inv) return;

    const head = el("div", "margin-top:12px;padding-top:8px;border-top:1px solid #3a4056;font-weight:bold;");
    head.textContent = "Сумка";
    this.panel.appendChild(head);

    if (inv.isEmpty) {
      const empty = el("div", "margin-top:6px;opacity:0.5;font-size:12px;");
      empty.textContent = "пусто";
      this.panel.appendChild(empty);
      return;
    }

    inv.slots.forEach((slot, i) => {
      if (!slot.item) return;
      const def = ITEMS[slot.item];
      const row = el("div", "display:flex;align-items:center;gap:8px;margin:5px 0;");

      const dot = el(
        "span",
        `width:12px;height:12px;border-radius:3px;flex:none;` +
          `background:rgb(${def.tint.map((c) => Math.round(c * 255)).join(",")});`,
      );
      const name = el("span", "flex:1;");
      name.textContent = def.name;
      const cnt = el("span", "font-weight:bold;");
      cnt.textContent = `×${slot.count}`;
      row.append(dot, name, cnt);

      if (def.heal > 0) {
        const btn = document.createElement("button");
        btn.textContent = "Выпить";
        btn.style.cssText =
          "cursor:pointer;background:#2f4f7a;color:#fff;border:1px solid #4a7;" +
          "border-radius:4px;font-size:11px;padding:2px 6px;";
        btn.addEventListener("click", () => inv.use(i));
        row.appendChild(btn);
      }
      this.panel.appendChild(row);
    });
  }

  private renderPanel(): void {
    const p = this.prog;
    if (!p || !this.panelOpen) return;
    this.panel.replaceChildren();

    const title = el("div", "font:bold 22px system-ui;margin-bottom:10px;");
    title.textContent = `Уровень ${p.level}`;
    this.panel.appendChild(title);

    const xp = el("div", "margin-bottom:10px;opacity:0.85;");
    xp.textContent = p.atMaxLevel ? "Максимальный уровень" : `Опыт ${p.xp} / ${p.xpToNext()}`;
    this.panel.appendChild(xp);

    for (const s of STATS) {
      const row = el("div", "display:flex;align-items:center;gap:8px;margin:5px 0;");
      const name = el("span", "width:120px;");
      name.textContent = STAT_LABELS[s];
      const val = el("span", "width:32px;text-align:right;font-weight:bold;font-size:17px;");
      val.textContent = String(p.stats[s]);
      row.append(name, val);

      if (p.unspent > 0) {
        const btn = document.createElement("button");
        btn.textContent = "+";
        btn.style.cssText =
          "width:30px;height:28px;cursor:pointer;background:#2f7a35;color:#fff;" +
          "border:1px solid #4c4;border-radius:5px;font-weight:bold;font-size:16px;";
        btn.addEventListener("click", () => p.spend(s));
        row.appendChild(btn);
      }
      this.panel.appendChild(row);

      const hint = el("div", "font-size:11px;opacity:0.5;margin:-2px 0 4px 0;");
      hint.textContent = statHint(p, s);
      this.panel.appendChild(hint);
    }

    const free = el("div", `margin-top:10px;${p.unspent > 0 ? "color:#7ee081;" : "opacity:0.6;"}`);
    free.textContent = `Свободных очков: ${p.unspent}`;
    this.panel.appendChild(free);

    this.renderBag();

    const keys = el("div", "margin-top:14px;padding-top:10px;border-top:1px solid #3a4056;font-size:12px;opacity:0.6;line-height:1.7;");
    keys.textContent =
      "WASD — движение · мышь — осмотреться · Space — прыжок\n" +
      "ЛКМ — удар · E — взять (держать = замах, отпустить = бросок) · Q — снять щит\n" +
      "C — закрыть · Esc — выйти";
    keys.style.whiteSpace = "pre-line";
    this.panel.appendChild(keys);
  }
}

function el(tag: string, css: string): HTMLDivElement {
  const d = document.createElement(tag) as HTMLDivElement;
  d.style.cssText = css;
  return d;
}

/** Короткое описание — за что отвечает характеристика. */
function statHint(p: Progression, s: StatName): string {
  if (s === "str") return `HP ${Math.round(p.maxHp)} · урон мечом ${p.swordDamage.toFixed(2)}`;
  if (s === "agi")
    return `бег ${p.moveSpeed.toFixed(2)} м/с · урон стрелы ${p.arrowDamage.toFixed(2)}`;
  return `мана ${Math.round(p.maxMana)} · реген ${p.manaRegen.toFixed(1)}/с · огнешар ${p.fireboltMax.toFixed(1)} · хил ${Math.round(p.healMax)}`;
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

const BACKDROP_CSS =
  "position:fixed;inset:0;z-index:38;display:none;align-items:center;justify-content:center;" +
  "background:rgba(6,8,14,0.55);backdrop-filter:blur(2px);";

const PANEL_CSS =
  "width:min(440px,92vw);max-height:88vh;overflow-y:auto;padding:22px 26px;" +
  "background:rgba(18,20,28,0.97);color:#e8ecf8;border:1px solid #5a6480;border-radius:12px;" +
  "box-shadow:0 20px 60px rgba(0,0,0,0.5);font:15px/1.5 system-ui,sans-serif;";
