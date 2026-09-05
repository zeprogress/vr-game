import { PLAYER_HP, BOT } from "#shared/constants";
import { STAT_LABELS, type Progression, type StatName } from "../player/Progression";
import { ITEMS, type Inventory } from "../player/Inventory";
import { BOT_SKIN_LABELS } from "../world/models";

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
  private skin = 0;
  private onSkin: ((skin: number) => void) | null = null;
  private leaveBot = false;
  private onLeaveBot: ((on: boolean) => void) | null = null;
  private onExit: (() => void) | null = null;
  /** Тач-режим: своя кнопка меню + крестик в панели, без возни с захватом мыши. */
  private touch = false;
  private menuBtn: HTMLDivElement | null = null;

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
      if (document.pointerLockElement) {
        // Вернулись в игру (кликнули по канвасу) — панель больше не нужна.
        this.hidePanel();
      } else if (!this.panelOpen) {
        // Мышь отпустило (в т.ч. по Esc). Esc, которым это снято, сам браузер
        // до нашего keydown-обработчика не доводит — только по этому событию
        // и узнаём, что мышь освободилась, и открываем панель следом за ней,
        // без второго нажатия.
        this.openPanelFromEsc();
      }
    });
  }

  /** Кнопка «Выйти в меню» внизу панели — на экран ввода ника. */
  bindExit(fn: () => void): void {
    this.onExit = fn;
    this.renderPanel();
  }

  /**
   * Смартфон: кнопка меню в правом верхнем углу открывает ту же панель
   * персонажа, что и клавиша C на ПК. Крестик и тап мимо панели — закрыть.
   */
  enableTouchMenu(): void {
    if (this.menuBtn) return;
    this.touch = true;
    const btn = el("div", MENU_BTN_CSS);
    btn.textContent = "☰";
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.togglePanel();
    });
    document.body.appendChild(btn);
    this.menuBtn = btn;
  }

  private get panelOpen(): boolean {
    return this.backdrop.style.display === "flex";
  }

  private openPanel(): void {
    this.backdrop.style.display = "flex";
    if (!this.touch && document.pointerLockElement) document.exitPointerLock();
    this.renderPanel();
  }

  /**
   * То же самое, но без exitPointerLock() — для Esc: браузер САМ снимает
   * захват мыши на Esc (это нельзя ни отменить, ни опередить), и наш
   * повторный вызов поверх уже идущего снятия иногда заметно тормозил
   * появление панели.
   */
  private openPanelFromEsc(): void {
    this.backdrop.style.display = "flex";
    this.renderPanel();
  }

  /** Спрятать без возврата захвата мыши (вызывается из pointerlockchange). */
  private hidePanel(): void {
    this.backdrop.style.display = "none";
  }

  private closePanel(): void {
    if (!this.panelOpen) return;
    this.hidePanel();
    if (!this.touch) this.requestRelock(0);
  }

  /**
   * После Esc браузер какое-то время (у Chrome — больше секунды) молча
   * отклоняет requestPointerLock(), защищаясь от «поймал курсор — не
   * отпущу»: один отложенный на тик вызов этого не переживает, мышь так и
   * оставалась свободной, пока не кликнешь по экрану сам. Пробуем сразу и
   * ещё несколько раз нарастающими паузами — как только получится,
   * document.pointerLockElement станет истинным, дальше пробовать незачем.
   */
  private requestRelock(attempt: number): void {
    if (document.pointerLockElement || this.panelOpen) return;
    this.relock?.();
    const delays = [60, 250, 600, 1200, 1800];
    if (attempt >= delays.length) return;
    setTimeout(() => this.requestRelock(attempt + 1), delays[attempt]);
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

  /**
   * Подключить смену модельки — в панели появится «Внешность» со стрелками.
   * Видна только в плоском режиме (в VR панель C и так не открыть с клавиатуры).
   */
  bindSkin(current: number, onChange: (skin: number) => void): void {
    this.skin = current;
    this.onSkin = onChange;
    this.renderPanel();
  }

  /** Сервер подтвердил новую модельку (или прислал её при входе/переподключении). */
  setSkin(skin: number): void {
    if (skin === this.skin) return;
    this.skin = skin;
    this.renderPanel();
  }

  /**
   * Подключить переключатель «оставить бота после выхода» — по умолчанию
   * выключен: персонаж просто исчезает с сервера, ботом не продолжает.
   */
  bindLeaveBot(current: boolean, onChange: (on: boolean) => void): void {
    this.leaveBot = current;
    this.onLeaveBot = onChange;
    this.renderPanel();
  }

  /** Сервер прислал сохранённое значение при входе/переподключении. */
  setLeaveBot(on: boolean): void {
    if (on === this.leaveBot) return;
    this.leaveBot = on;
    this.renderPanel();
  }

  /** Подключить прогрессию — включает панель персонажа на клавишу C. */
  bindProgression(prog: Progression): void {
    this.prog = prog;
    prog.onChange(() => this.renderPanel());
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      if (e.code === "KeyC") this.togglePanel();
      else if (e.code === "Escape") {
        // Открываем без exitPointerLock() (см. openPanelFromEsc) — Esc и так
        // снимает захват мыши сам, наш вызов поверх только мешал.
        if (this.panelOpen) this.closePanel();
        else this.openPanelFromEsc();
      }
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
  /** Раздел «Внешность»: стрелками листаем 8 моделей, применяется сразу. */
  private renderSkin(): void {
    if (!this.onSkin) return;

    const head = el("div", "margin-top:12px;padding-top:8px;border-top:1px solid #3a4056;font-weight:bold;");
    head.textContent = "Внешность";
    this.panel.appendChild(head);

    const row = el("div", "display:flex;align-items:center;gap:8px;margin-top:6px;");
    const arrow = (dir: -1 | 1): HTMLButtonElement => {
      const btn = document.createElement("button");
      btn.textContent = dir < 0 ? "‹" : "›";
      btn.style.cssText =
        "width:30px;height:28px;cursor:pointer;background:#2a2e40;color:#fff;" +
        "border:1px solid #5a6480;border-radius:5px;font-weight:bold;font-size:16px;";
      btn.addEventListener("click", () => {
        // 1..BOT.skins по кругу.
        const n = ((this.skin - 1 + dir + BOT.skins) % BOT.skins) + 1;
        this.skin = n;
        this.onSkin?.(n);
        this.renderPanel();
      });
      return btn;
    };
    const label = el("span", "flex:1;text-align:center;");
    label.textContent = BOT_SKIN_LABELS[this.skin - 1] ?? "…";
    row.append(arrow(-1), label, arrow(1));
    this.panel.appendChild(row);
  }

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

    if (this.touch) {
      const x = el("div", CLOSE_X_CSS);
      x.textContent = "✕";
      x.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.closePanel();
      });
      this.panel.appendChild(x);
    }

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

    this.renderSkin();
    this.renderBag();

    const keys = el("div", "margin-top:14px;padding-top:10px;border-top:1px solid #3a4056;font-size:12px;opacity:0.6;line-height:1.7;");
    keys.textContent = this.touch
      ? "Левый джойстик — движение · правая половина экрана — осмотр\n" +
        "⚔ — удар · ✋ — взять предмет\n" +
        "☰ / тап мимо панели — открыть-закрыть это меню"
      : "WASD — движение · мышь — осмотреться\n" +
        "ЛКМ — удар · E — взять (держать = замах, отпустить = бросок) · Q — снять щит\n" +
        "C / Esc — открыть-закрыть эту панель";
    keys.style.whiteSpace = "pre-line";
    this.panel.appendChild(keys);

    if (this.onLeaveBot) {
      const row = el("div", "display:flex;align-items:center;gap:8px;margin-top:14px;");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = this.leaveBot;
      box.id = "hudLeaveBot";
      box.addEventListener("change", () => {
        this.leaveBot = box.checked;
        this.onLeaveBot?.(box.checked);
      });
      const label = document.createElement("label");
      label.htmlFor = "hudLeaveBot";
      label.style.cssText = "font-size:13px;cursor:pointer;";
      label.textContent = "Оставить бота после выхода";
      row.append(box, label);
      this.panel.appendChild(row);
    }

    if (this.onExit) {
      const exit = document.createElement("button");
      exit.textContent = "Выйти в меню";
      exit.style.cssText =
        "width:100%;margin-top:12px;padding:10px;cursor:pointer;background:#3a2020;" +
        "color:#ffd8d8;border:1px solid #8a3a3a;border-radius:6px;font:600 14px system-ui;";
      exit.addEventListener("click", () => this.onExit?.());
      this.panel.appendChild(exit);
    }
  }
}

function el(tag: string, css: string): HTMLDivElement {
  const d = document.createElement(tag) as HTMLDivElement;
  d.style.cssText = css;
  return d;
}

/** Короткое описание — за что отвечает характеристика. */
function statHint(p: Progression, s: StatName): string {
  // База растёт от уровня; атрибут — небольшой множитель поверх.
  if (s === "str") return `× HP ${Math.round(p.maxHp)} · физ. урон ×${p.swordDamage.toFixed(2)}`;
  if (s === "agi") return `× бег ${p.moveSpeed.toFixed(2)} м/с`;
  return `× мана ${Math.round(p.maxMana)} · огнешар ${p.fireboltMax.toFixed(1)} · хил ${Math.round(p.healMax)}`;
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
  "position:relative;width:min(440px,92vw);max-height:88vh;overflow-y:auto;padding:22px 26px;" +
  "background:rgba(18,20,28,0.97);color:#e8ecf8;border:1px solid #5a6480;border-radius:12px;" +
  "box-shadow:0 20px 60px rgba(0,0,0,0.5);font:15px/1.5 system-ui,sans-serif;";

/** Кнопка меню (смартфон) — правый верхний угол, поверх HUD и панели. */
const MENU_BTN_CSS =
  "position:fixed;top:12px;right:12px;z-index:39;width:44px;height:44px;border-radius:10px;" +
  "display:flex;align-items:center;justify-content:center;font:20px/1 system-ui,sans-serif;" +
  "background:rgba(20,24,34,0.72);color:#e8ecf8;border:1px solid rgba(255,255,255,0.28);" +
  "-webkit-user-select:none;user-select:none;touch-action:none;";

/** Крестик закрытия в углу панели персонажа (смартфон). */
const CLOSE_X_CSS =
  "position:absolute;top:8px;right:10px;width:34px;height:34px;border-radius:8px;" +
  "display:flex;align-items:center;justify-content:center;font:18px/1 system-ui,sans-serif;" +
  "color:#cdd5e6;background:rgba(255,255,255,0.06);border:1px solid #4a5474;cursor:pointer;";
