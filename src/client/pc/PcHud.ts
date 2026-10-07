import { glyph, skillIcon, weaponIcon } from "#shared/icons";
import { iconHtml } from "../ui/icons";
import { mmss, type BuffEntry } from "../ui/buffList";
import { WORLD } from "#shared/constants";
import { ELITE_MOBS, MOB_CAMPS } from "#shared/mobs";
import { HUB_CENTER } from "#shared/hub";
import { TOWER_PROP_POS } from "#shared/tower";
import { LAKE } from "#shared/constants";

/**
 * Экран ПК «как в WoW» (третье лицо): рамка героя слева сверху, мини-карта
 * справа сверху, панель действий с полосой опыта снизу по центру, журнал
 * (события игры + чат Twitch) слева снизу, кнопки меню справа снизу,
 * большая карта по M. Только DOM, поверх канваса; клики мимо элементов
 * проходят в игру (pointer-events: none на обёртке).
 */

export type LogKind = "chat" | "loot" | "xp" | "event" | "system" | "kill" | "damage";

const KIND_LABEL: Record<LogKind, string> = {
  chat: "Чат Twitch",
  loot: "Находки оружия",
  xp: "Опыт и уровни",
  event: "События мира",
  kill: "Убийства",
  damage: "Урон (нанесённый и полученный)",
  system: "Системные сообщения",
};

interface ChatCfg {
  on: boolean;
  kinds: Record<LogKind, boolean>;
  /** Вкладка панели: «chat» — чат Twitch, «log» — журнал игры (всё, кроме чата). */
  view?: "chat" | "log";
}

/** Цвет ника в чате — по нику (у каждого свой, стабильный). */
function nickColor(nick: string): string {
  let h = 0;
  for (let i = 0; i < nick.length; i++) h = (h * 31 + nick.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 75% 70%)`;
}

const CFG_KEY = "zep.pcChat";
const LOG_MAX = 80;

export type WeaponIcon = "sword" | "bow" | "staff" | "fist" | "dagger" | "spear" | "hammer";

export interface MapDot {
  x: number;
  z: number;
}
export interface MapData {
  px: number;
  pz: number;
  /** Куда повёрнут герой. */
  yaw: number;
  /** Куда смотрит камера (конус обзора). */
  camYaw: number;
  players: (MapDot & { bot: boolean; nick: string })[];
  mobs: (MapDot & { elite: boolean; boss: boolean })[];
  event: MapDot | null;
  targetId: string | null;
}

export interface PcHudHooks {
  /** Телефон: только рамка героя (с баффами) и мини-карта; кнопки и управление — свои, экранные. */
  touch?: boolean;
  onCharacter: () => void;
  onBag: () => void;
  onMenu: () => void;
  /** Клик по ячейке панели действий: "1" атака, "2" умение, "3" зелье, "E" подобрать. */
  onSlot: (key: string) => void;
  /** Клик по значку свободных очков — вкладка атрибутов. */
  onAttrs: () => void;
  /** Сообщение в чат из игры (уходит в Twitch, команды работают). */
  onChatSend?: (text: string) => void;
}


export class PcHud {
  private readonly root: HTMLDivElement;
  // рамка героя
  private readonly nameEl: HTMLDivElement;
  private readonly portraitEl: HTMLDivElement;
  private readonly unspentEl: HTMLDivElement;
  private readonly buffsEl: HTMLDivElement;
  private readonly hpFill: HTMLDivElement;
  private readonly hpText: HTMLDivElement;
  private readonly manaWrap: HTMLDivElement;
  private readonly manaFill: HTMLDivElement;
  // панель действий
  private readonly xpFill: HTMLDivElement;
  private readonly xpText: HTMLDivElement;
  private readonly slotAtk: HTMLDivElement;
  /** Две ячейки умений (2 и 3) — «Классы 2.0»: у класса два выбранных умения. */
  private readonly slotSkills: HTMLDivElement[] = [];
  private readonly skillCds: HTMLDivElement[] = [];
  private readonly slotPotion: HTMLDivElement;
  private readonly potionCnt: HTMLSpanElement;
  // журнал
  private readonly chatEl: HTMLDivElement;
  private readonly logEl: HTMLDivElement;
  private readonly cfgEl: HTMLDivElement;
  private tabChat!: HTMLButtonElement;
  private chatInput!: HTMLInputElement;
  private tabLog!: HTMLButtonElement;
  private readonly chatBtn: HTMLButtonElement;
  private cfg: ChatCfg;
  // карты
  private readonly mini: HTMLCanvasElement;
  private readonly miniCtx: CanvasRenderingContext2D;
  private readonly miniLabel: HTMLDivElement;
  private readonly bigWrap: HTMLDivElement;
  private readonly big: HTMLCanvasElement;
  private readonly bigCtx: CanvasRenderingContext2D;
  private miniRange = 70;
  private mapT = 0;

  private lastSig: Record<string, string> = {};

  constructor(private readonly hooks: PcHudHooks) {
    injectHudStyle();
    this.cfg = loadCfg();
    this.root = div(hooks.touch ? "pc-hud touch" : "pc-hud");

    // --- рамка героя ---
    const unit = div("pc-unit pc-frame");
    this.portraitEl = div("pc-portrait");
    this.portraitEl.innerHTML = iconHtml("w.fist");
    // Свободные очки атрибутов — зелёный значок с числом на портрете.
    this.unspentEl = div("pc-unspent");
    this.unspentEl.style.display = "none";
    this.unspentEl.addEventListener("click", (e) => {
      e.stopPropagation();
      this.hooks.onAttrs();
    });
    const portraitWrap = div("pc-portrait-wrap");
    portraitWrap.append(this.portraitEl, this.unspentEl);
    const col = div("pc-unit-col");
    this.nameEl = div("pc-unit-name");
    const hp = div("pc-bar pc-hp");
    this.hpFill = div("pc-bar-fill");
    this.hpText = div("pc-bar-text");
    hp.append(this.hpFill, this.hpText);
    this.manaWrap = div("pc-bar pc-mana");
    this.manaFill = div("pc-bar-fill");
    this.manaWrap.append(this.manaFill);
    this.manaWrap.style.display = "none";
    // Опыт — тонкая серая полоска с процентом под здоровьем (не выделяется).
    const xp = div("pc-xp");
    this.xpFill = div("pc-xp-fill");
    this.xpText = div("pc-xp-text");
    xp.append(this.xpFill, this.xpText);
    // Баффы — значки с таймером под полосками (событие, костёр в лагере).
    this.buffsEl = div("pc-buffs");
    col.append(this.nameEl, hp, this.manaWrap, xp, this.buffsEl);
    unit.append(portraitWrap, col);
    // Клик по своей рамке — окно снаряжения.
    unit.title = "Снаряжение (C)";
    unit.addEventListener("click", () => this.hooks.onCharacter());

    // --- мини-карта ---
    const mm = div("pc-minimap");
    this.mini = document.createElement("canvas");
    this.mini.width = this.mini.height = 320;
    this.miniCtx = this.mini.getContext("2d")!;
    const zoomIn = btn("pc-mm-zoom pc-mm-in", "+", "Приблизить карту");
    const zoomOut = btn("pc-mm-zoom pc-mm-out", "−", "Отдалить карту");
    zoomIn.onclick = () => (this.miniRange = Math.max(30, this.miniRange - 20));
    zoomOut.onclick = () => (this.miniRange = Math.min(170, this.miniRange + 20));
    this.miniLabel = div("pc-mm-label");
    this.mini.onclick = () => this.toggleMap();
    this.mini.title = "Карта (M)";
    mm.append(this.mini, zoomIn, zoomOut, this.miniLabel);

    // --- панель действий ---
    const bar = div("pc-actionbar");
    const slots = div("pc-slots");
    this.slotAtk = slot("1", "", "Автоатака по цели (1)", iconHtml("w.fist"));
    for (const k of ["2", "3"]) {
      const sl = slot(k, "", `Умение (${k})`, iconHtml("ui.noSkill"));
      const cd = div("pc-cd");
      sl.append(cd);
      this.slotSkills.push(sl);
      this.skillCds.push(cd);
    }
    this.slotPotion = slot("4", "", "Зелье лечения (4)", iconHtml("i.potion"));
    this.potionCnt = document.createElement("span");
    this.potionCnt.className = "pc-slot-n";
    this.slotPotion.append(this.potionCnt);
    slots.append(
      this.slotAtk,
      ...this.slotSkills,
      this.slotPotion,
      slot("E", "", "Подобрать / рыбачить (E)", iconHtml("ui.grab")),
      slot("6", "", ""),
      slot("7", "", ""),
      slot("8", "", ""),
    );
    bar.append(slots);
    // Ячейки панели — кнопки: клик делает то же, что клавиша.
    for (const s of Array.from(slots.children) as HTMLElement[]) {
      const key = s.querySelector(".pc-slot-k")?.textContent ?? "";
      if (!s.classList.contains("empty")) {
        s.style.cursor = "pointer";
        s.addEventListener("click", () => this.hooks.onSlot(key));
      }
    }

    // --- кнопки меню ---
    const micro = div("pc-micro");
    const mb = (icon: string, title: string, fn: () => void): HTMLButtonElement => {
      const b = btn("pc-micro-btn", icon, title);
      b.onclick = fn;
      micro.append(b);
      return b;
    };
    const bag = mb("", "Снаряжение и сумка (C / B)", () => this.hooks.onBag());
    bag.innerHTML = iconHtml("ui.sack");
    mb(glyph("ui.map"), "Карта (M)", () => this.toggleMap());
    this.chatBtn = mb(glyph("ui.chat"), "Журнал и чат (L)", () => this.setChatOn(!this.cfg.on));
    mb(glyph("ui.fullscreen"), "На весь экран (F11 / Ctrl+Enter)", () => toggleFullscreen());
    mb(glyph("ui.menu"), "Меню (Esc)", () => this.hooks.onMenu());

    // --- журнал ---
    this.chatEl = div("pc-chat pc-frame");
    const head = div("pc-chat-head");
    // Вкладки: чат Twitch отдельно от журнала игры.
    const title = div("pc-chat-title");
    const tab = (view: "chat" | "log", label: string): HTMLButtonElement => {
      const t = btn("pc-chat-tab", label, view === "chat" ? "Чат Twitch" : "Журнал игры");
      t.onclick = () => this.setView(view);
      return t;
    };
    this.tabChat = tab("chat", "Чат");
    this.tabLog = tab("log", "Журнал");
    title.append(this.tabChat, this.tabLog);
    const gear = btn("pc-chat-gear", "⚙", "Что показывать в журнале");
    const close = btn("pc-chat-gear", "✕", "Скрыть журнал (L)");
    // Телефон: ✕ сворачивает панель обратно в полоску, а не прячет.
    close.onclick = (e) => {
      e.stopPropagation();
      if (this.hooks.touch) this.setChatOpen(false);
      else this.setChatOn(false);
    };
    head.append(title, gear, close);
    this.logEl = div("pc-chat-log");
    this.cfgEl = div("pc-chat-cfg");
    this.cfgEl.style.display = "none";
    gear.onclick = () => {
      this.cfgEl.style.display = this.cfgEl.style.display === "none" ? "" : "none";
    };
    this.renderCfg();
    // Поле ввода (вкладка «Чат»): Enter — отправить. Клавиши игры не срабатывают, пока печатаешь.
    this.chatInput = document.createElement("input");
    this.chatInput.className = "pc-chat-input";
    this.chatInput.placeholder = "Написать в чат… (команды тоже: !raid, !event…)";
    this.chatInput.maxLength = 200;
    const stop = (e: Event): void => e.stopPropagation();
    this.chatInput.addEventListener("keyup", stop);
    this.chatInput.addEventListener("keypress", stop);
    this.chatInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        const t = this.chatInput.value.trim();
        if (t) this.hooks.onChatSend?.(t);
        this.chatInput.value = "";
        this.chatInput.blur();
      } else if (e.key === "Escape") this.chatInput.blur();
    });
    this.chatEl.append(head, this.logEl, this.cfgEl, this.chatInput);
    this.setView(this.cfg.view ?? "chat");
    if (hooks.touch) {
      // Телефон: свёрнутая прозрачная полоска сверху; тап — развернуть (вкладки, поле ввода).
      this.cfg.on = true;
      this.chatEl.classList.remove("open");
      this.chatEl.addEventListener("click", () => {
        if (!this.chatEl.classList.contains("open")) this.setChatOpen(true);
      });
    }

    // --- большая карта ---
    this.bigWrap = div("pc-bigmap");
    const bigBox = div("pc-bigmap-box pc-frame");
    const bigHead = div("pc-bigmap-head");
    bigHead.append(div("", "Карта мира"));
    const bigClose = btn("pc-chat-gear", "✕", "Закрыть (M)");
    bigClose.onclick = () => this.toggleMap(false);
    bigHead.append(bigClose);
    this.big = document.createElement("canvas");
    this.big.width = this.big.height = 1040;
    this.bigCtx = this.big.getContext("2d")!;
    bigBox.append(bigHead, this.big);
    this.bigWrap.append(bigBox);
    this.bigWrap.style.display = "none";
    this.bigWrap.onclick = (e) => {
      if (e.target === this.bigWrap) this.toggleMap(false);
    };

    this.root.append(unit, mm, bar, micro, this.chatEl, this.bigWrap);
    document.body.appendChild(this.root);
    this.applyChatOn();

    window.addEventListener("keydown", this.onKey);
  }

  private onKey = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (e.repeat) return;
    if (e.code === "KeyM") this.toggleMap();
    else if (e.code === "KeyL") this.setChatOn(!this.cfg.on);
    else if (e.code === "KeyB") this.hooks.onBag();
    else if (e.code === "KeyC") this.hooks.onCharacter();
    else if (e.code === "Enter" && (e.ctrlKey || e.metaKey)) toggleFullscreen();
    else if (e.code === "Enter" && !this.hooks.touch) {
      // Enter — написать в чат.
      e.preventDefault();
      this.focusChat();
    }
  };

  // ---- рамка героя ----

  setIdentity(nick: string, level: number, weapon: WeaponIcon): void {
    const sig = `${nick}|${level}|${weapon}`;
    if (this.lastSig.id === sig) return;
    this.lastSig.id = sig;
    this.nameEl.textContent = `${nick} · ${level} ур.`;
    // Значок оружия — из общего реестра (shared/icons.ts).
    this.portraitEl.innerHTML = iconHtml(weaponIcon(weapon));
    this.slotAtk.querySelector<HTMLElement>(".pc-slot-ico")!.innerHTML = iconHtml(weaponIcon(weapon));
  }

  /** Баффы: секунд осталось у баффа события (×2 опыт/урон) и «Тепла костра» (+10% урона). */
  /** Баффы героя — значками с таймером (тот же список, что у спектатора и в VR). */
  setBuffs(list: BuffEntry[]): void {
    const sig = list.map((b) => `${b.icon}${b.secs}`).join("|");
    if (this.lastSig.buffs === sig) return;
    this.lastSig.buffs = sig;
    this.buffsEl.innerHTML = "";
    for (const b of list) {
      const c = div("pc-buff", `${b.icon} ${mmss(b.secs)}`);
      c.title = `${b.name}: ${b.desc}`;
      c.style.borderColor = b.color;
      c.style.color = b.color;
      this.buffsEl.append(c);
    }
  }

  /** Свободные очки атрибутов: 0 — значок спрятан. */
  setUnspent(n: number): void {
    const s = String(n);
    if (this.lastSig.unspent === s) return;
    this.lastSig.unspent = s;
    this.unspentEl.style.display = n > 0 ? "" : "none";
    this.unspentEl.textContent = `+${n}`;
    this.unspentEl.title = `Свободных очков атрибутов: ${n} — вложить (клик)`;
  }

  setHp(hp: number, max: number): void {
    const f = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
    const sig = `${Math.ceil(hp)}|${Math.round(max)}`;
    if (this.lastSig.hp === sig) return;
    this.lastSig.hp = sig;
    this.hpFill.style.width = `${(f * 100).toFixed(1)}%`;
    this.hpText.textContent = `${Math.ceil(hp)} / ${Math.round(max)}`;
  }

  setMana(frac: number, show: boolean): void {
    this.manaWrap.style.display = show ? "" : "none";
    if (show) this.manaFill.style.width = `${(Math.max(0, Math.min(1, frac)) * 100).toFixed(1)}%`;
  }

  // ---- панель действий ----

  setXp(level: number, frac: number, maxed: boolean): void {
    const pct = maxed ? 100 : Math.floor(Math.max(0, Math.min(1, frac)) * 1000) / 10;
    const sig = `${level}|${pct}`;
    if (this.lastSig.xp === sig) return;
    this.lastSig.xp = sig;
    this.xpFill.style.width = `${pct}%`;
    this.xpText.textContent = maxed ? "опыт · максимум" : `опыт ${pct.toFixed(1)}%`;
  }

  setAutoAttack(on: boolean): void {
    this.slotAtk.classList.toggle("on", on);
  }

  /**
   * Ячейка умения `slot` (0 — клавиша 2, 1 — клавиша 3). kind — умение (свои
   * иконки у старых трёх, у новых — значок), null — пусто; cdFrac 0..1 — сколько ещё ждать.
   */
  setSkill(slot: number, kind: string | null, icon: string, name: string | null, cdFrac: number, cdLeft: number): void {
    const el = this.slotSkills[slot];
    const cdEl = this.skillCds[slot];
    if (!el || !cdEl) return;
    const key = String(slot + 2);
    const ico = `${kind ?? ""}|${icon}`;
    if (this.lastSig[`skillKind${slot}`] !== ico) {
      this.lastSig[`skillKind${slot}`] = ico;
      void icon;
      el.querySelector(".pc-slot-ico")!.innerHTML = iconHtml(skillIcon(kind));
    }
    const sig = `${name}|${Math.ceil(cdLeft)}|${cdFrac > 0 ? 1 : 0}`;
    if (this.lastSig[`skill${slot}`] !== sig) {
      this.lastSig[`skill${slot}`] = sig;
      el.classList.toggle("off", !name);
      el.title = name ? `${name} (${key})` : "Умение не выбрано — окно снаряжения (C), вкладка «Умения»";
      cdEl.textContent = cdLeft > 0.05 ? String(Math.ceil(cdLeft)) : "";
    }
    cdEl.style.background =
      cdFrac > 0 ? `conic-gradient(rgba(0,0,0,.7) ${cdFrac * 360}deg, transparent 0)` : "none";
  }

  setPotions(n: number): void {
    const s = String(n);
    if (this.lastSig.pot === s) return;
    this.lastSig.pot = s;
    this.potionCnt.textContent = n > 0 ? s : "";
    this.slotPotion.classList.toggle("off", n <= 0);
  }

  // ---- журнал ----

  log(kind: LogKind, text: string, who?: string, color?: string): void {
    const row = document.createElement("div");
    row.className = `pc-log pc-log-${kind}`;
    row.dataset.kind = kind;
    if (who) {
      const b = document.createElement("b");
      b.textContent = kind === "chat" ? `${who}: ` : `${who} `;
      if (kind === "chat") b.style.color = nickColor(who);
      row.append(b);
    }
    const span = document.createElement("span");
    span.textContent = text;
    if (color) span.style.color = color;
    row.append(span);
    if (!this.rowVisible(kind)) row.style.display = "none";
    const atBottom = this.logEl.scrollTop + this.logEl.clientHeight >= this.logEl.scrollHeight - 8;
    this.logEl.append(row);
    while (this.logEl.childElementCount > LOG_MAX) this.logEl.firstElementChild?.remove();
    if (atBottom) this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  /** Строка видна на текущей вкладке: «Чат» — только чат, «Журнал» — остальное по галочкам. */
  private rowVisible(kind: LogKind): boolean {
    return (this.cfg.view ?? "chat") === "chat" ? kind === "chat" : kind !== "chat" && this.cfg.kinds[kind];
  }

  private setView(view: "chat" | "log"): void {
    this.cfg.view = view;
    saveCfg(this.cfg);
    this.tabChat.classList.toggle("on", view === "chat");
    this.chatInput.style.display = view === "chat" ? "" : "none";
    this.tabLog.classList.toggle("on", view === "log");
    for (const r of this.logEl.querySelectorAll<HTMLElement>("[data-kind]")) {
      r.style.display = this.rowVisible(r.dataset.kind as LogKind) ? "" : "none";
    }
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  /** Телефон: развернуть/свернуть панель чата и журнала. */
  private setChatOpen(open: boolean): void {
    this.chatEl.classList.toggle("open", open);
    if (!open) this.chatInput.blur();
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  /** Enter в игре (ПК): открыть чат и поставить курсор в поле ввода. */
  focusChat(): void {
    if (!this.cfg.on) this.setChatOn(true);
    if ((this.cfg.view ?? "chat") !== "chat") this.setView("chat");
    this.chatInput.focus();
  }

  get chatOn(): boolean {
    return this.cfg.on;
  }

  setChatOn(on: boolean): void {
    this.cfg.on = on;
    saveCfg(this.cfg);
    this.applyChatOn();
  }

  private applyChatOn(): void {
    this.chatEl.style.display = this.cfg.on ? "" : "none";
    this.chatBtn.classList.toggle("on", this.cfg.on);
    if (this.cfg.on) this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  private renderCfg(): void {
    this.cfgEl.innerHTML = "";
    for (const k of Object.keys(KIND_LABEL) as LogKind[]) {
      const lab = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = this.cfg.kinds[k];
      cb.onchange = () => {
        this.cfg.kinds[k] = cb.checked;
        saveCfg(this.cfg);
        for (const r of this.logEl.querySelectorAll<HTMLElement>(`[data-kind="${k}"]`)) {
          r.style.display = this.rowVisible(k) ? "" : "none";
        }
      };
      lab.append(cb, document.createTextNode(KIND_LABEL[k]));
      this.cfgEl.append(lab);
    }
  }

  // ---- карты ----

  toggleMap(force?: boolean): void {
    const on = force ?? this.bigWrap.style.display === "none";
    this.bigWrap.style.display = on ? "" : "none";
    this.mapT = 1; // перерисовать сразу
  }

  /** Esc: закрыть большую карту. true — была открыта. */
  closeMap(): boolean {
    if (!this.mapOpen) return false;
    this.toggleMap(false);
    return true;
  }

  get mapOpen(): boolean {
    return this.bigWrap.style.display !== "none";
  }

  /** Раз в ~0.1 с: мини-карта и (если открыта) большая. */
  updateMaps(dt: number, d: MapData, clock: string): void {
    this.mapT += dt;
    if (this.mapT < 0.1) return;
    this.mapT = 0;
    this.drawMini(d);
    if (this.mapOpen) this.drawBig(d);
    const lbl = `${Math.round(d.px)}, ${Math.round(d.pz)} · ${clock}`;
    if (this.lastSig.mm !== lbl) {
      this.lastSig.mm = lbl;
      this.miniLabel.textContent = lbl;
    }
  }

  private drawMini(d: MapData): void {
    const c = this.miniCtx;
    const W = this.mini.width;
    const R = W / 2;
    const k = R / this.miniRange; // px на метр
    c.clearRect(0, 0, W, W);
    c.save();
    c.beginPath();
    // Телефон — квадратная карта в углу экрана, ПК — круглая.
    if (this.hooks.touch) c.rect(2, 2, W - 4, W - 4);
    else c.arc(R, R, R - 2, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = "#2f4228";
    c.fillRect(0, 0, W, W);
    const toX = (x: number): number => R + (x - d.px) * k;
    const toY = (z: number): number => R - (z - d.pz) * k;
    this.drawStatic(c, toX, toY, k, false);
    // конус обзора камеры
    c.fillStyle = "rgba(255,255,255,0.08)";
    c.beginPath();
    c.moveTo(R, R);
    c.arc(R, R, R, d.camYaw - Math.PI / 2 - 0.55, d.camYaw - Math.PI / 2 + 0.55);
    c.closePath();
    c.fill();
    this.drawDynamic(c, d, toX, toY, 1);
    c.restore();
    // север
    c.fillStyle = "#eadfc4";
    c.font = "bold 22px system-ui";
    c.textAlign = "center";
    c.fillText("С", R, 26);
    arrow(c, R, R, d.yaw, 13);
  }

  private drawBig(d: MapData): void {
    const c = this.bigCtx;
    const W = this.big.width;
    const half = WORLD.size / 2;
    const k = W / (half * 2);
    c.clearRect(0, 0, W, W);
    c.fillStyle = "#2f4228";
    c.fillRect(0, 0, W, W);
    const toX = (x: number): number => (x + half) * k;
    const toY = (z: number): number => (half - z) * k;
    // граница хода
    c.strokeStyle = "rgba(234,223,196,0.35)";
    c.lineWidth = 2;
    const e = WORLD.playHalf;
    c.strokeRect(toX(-e), toY(e), e * 2 * k, e * 2 * k);
    this.drawStatic(c, toX, toY, k, true);
    this.drawDynamic(c, d, toX, toY, 1.6);
    arrow(c, toX(d.px), toY(d.pz), d.yaw, 16);
  }

  /** Озеро, лагерь, башня, лагеря мобов (на большой карте — с подписями). */
  private drawStatic(
    c: CanvasRenderingContext2D,
    toX: (x: number) => number,
    toY: (z: number) => number,
    k: number,
    labels: boolean,
  ): void {
    c.fillStyle = "#3d6f8f";
    c.beginPath();
    c.ellipse(toX(LAKE.x), toY(LAKE.z), LAKE.rx * k, LAKE.rz * k, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "rgba(201,162,74,0.35)";
    c.beginPath();
    c.arc(toX(HUB_CENTER.x), toY(HUB_CENTER.z), 30 * k, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#8c7a5a";
    c.fillRect(toX(TOWER_PROP_POS.x) - 5, toY(TOWER_PROP_POS.z) - 5, 10, 10);
    // Смешанная стоянка (несколько видов в одной точке) — одна подпись: «Метатель копий, Скалолом · 40».
    const spots = new Map<string, { x: number; z: number; names: string[]; level: number }>();
    for (const camp of MOB_CAMPS) {
      const def = ELITE_MOBS[camp.type];
      c.strokeStyle = "rgba(224,80,64,0.55)";
      c.lineWidth = 2;
      c.beginPath();
      c.arc(toX(camp.x), toY(camp.z), Math.max(5, camp.spread * k * 0.8), 0, Math.PI * 2);
      c.stroke();
      const key = `${camp.x},${camp.z}`;
      const s = spots.get(key) ?? { x: camp.x, z: camp.z, names: [], level: 0 };
      if (!s.names.includes(def.name)) s.names.push(def.name);
      s.level = Math.max(s.level, def.level);
      spots.set(key, s);
    }
    if (labels) for (const s of spots.values()) label(c, `${s.names.join(", ")} · ${s.level}`, toX(s.x), toY(s.z) - 6, "#ffc9bf");
    if (labels) {
      label(c, "Лагерь", toX(HUB_CENTER.x), toY(HUB_CENTER.z) - 4, "#f3e2b0");
      label(c, "Озеро", toX(LAKE.x), toY(LAKE.z), "#cfe8ff");
      label(c, "Башня", toX(TOWER_PROP_POS.x), toY(TOWER_PROP_POS.z) - 10, "#eadfc4");
    }
  }

  private drawDynamic(
    c: CanvasRenderingContext2D,
    d: MapData,
    toX: (x: number) => number,
    toY: (z: number) => number,
    s: number,
  ): void {
    for (const m of d.mobs) {
      c.fillStyle = m.boss ? "#ff3b30" : m.elite ? "#e86a4a" : "#c9564a";
      const r = (m.boss ? 7 : m.elite ? 4 : 3) * s;
      c.beginPath();
      c.arc(toX(m.x), toY(m.z), r, 0, Math.PI * 2);
      c.fill();
    }
    if (d.event) {
      c.strokeStyle = "#ffd84a";
      c.lineWidth = 3 * s;
      c.beginPath();
      c.arc(toX(d.event.x), toY(d.event.z), 9 * s, 0, Math.PI * 2);
      c.stroke();
    }
    for (const p of d.players) {
      c.fillStyle = p.bot ? "#5aa9ff" : "#6fe07a";
      c.beginPath();
      c.arc(toX(p.x), toY(p.z), 4 * s, 0, Math.PI * 2);
      c.fill();
    }
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKey);
    this.root.remove();
  }
}

export function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  else void document.documentElement.requestFullscreen?.().catch(() => {});
}

function arrow(c: CanvasRenderingContext2D, x: number, y: number, yaw: number, size: number): void {
  c.save();
  c.translate(x, y);
  c.rotate(yaw);
  c.fillStyle = "#ffd84a";
  c.strokeStyle = "#000";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(0, -size);
  c.lineTo(size * 0.7, size * 0.8);
  c.lineTo(0, size * 0.4);
  c.lineTo(-size * 0.7, size * 0.8);
  c.closePath();
  c.fill();
  c.stroke();
  c.restore();
}

function label(c: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
  c.font = "600 20px system-ui";
  c.textAlign = "center";
  c.lineWidth = 4;
  c.strokeStyle = "rgba(0,0,0,0.75)";
  c.strokeText(text, x, y);
  c.fillStyle = color;
  c.fillText(text, x, y);
}

function loadCfg(): ChatCfg {
  const def: ChatCfg = {
    on: true,
    kinds: { chat: true, loot: true, xp: true, event: true, kill: false, system: true, damage: true },
  };
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<ChatCfg>;
      if (typeof v.on === "boolean") def.on = v.on;
      if (v.kinds) for (const k of Object.keys(def.kinds) as LogKind[]) if (typeof v.kinds[k] === "boolean") def.kinds[k] = v.kinds[k];
      if (v.view === "chat" || v.view === "log") def.view = v.view;
    }
  } catch {
    /* приватный режим — дефолты */
  }
  return def;
}

function saveCfg(c: ChatCfg): void {
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(c));
  } catch {
    /* приватный режим */
  }
}

function div(cls: string, text = ""): HTMLDivElement {
  const d = document.createElement("div");
  if (cls) d.className = cls;
  if (text) d.textContent = text;
  return d;
}

function btn(cls: string, text: string, title: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = cls;
  b.textContent = text;
  b.title = title;
  b.type = "button";
  return b;
}

function slot(key: string, icon: string, title: string, svg = ""): HTMLDivElement {
  const s = div("pc-slot");
  if (!icon && !svg) s.classList.add("empty");
  s.title = title;
  const k = document.createElement("span");
  k.className = "pc-slot-k";
  k.textContent = key;
  const i = document.createElement("span");
  i.className = "pc-slot-ico";
  if (svg) i.innerHTML = svg;
  else i.textContent = icon;
  s.append(k, i);
  return s;
}

let hudStyled = false;
function injectHudStyle(): void {
  if (hudStyled) return;
  hudStyled = true;
  const s = document.createElement("style");
  s.textContent = `
.pc-hud { position:fixed; inset:0; pointer-events:none; z-index:28; color:var(--pc-text,#eadfc4);
  font:600 13px/1.3 system-ui,sans-serif; text-shadow:0 1px 2px #000; user-select:none; -webkit-user-select:none; }
.pc-hud button { pointer-events:auto; font:inherit; color:inherit; cursor:pointer; }
.pc-frame { background:var(--pc-bg,rgba(14,13,19,.84)); border:none; border-radius:8px; }
.pc-unit { position:absolute; left:14px; top:14px; width:250px; display:flex; gap:10px; align-items:center; padding:7px 10px;
  pointer-events:auto; cursor:pointer; }
.pc-unit:hover { background:rgba(26,24,33,.9); }
.pc-portrait { width:46px; height:46px; flex:none; border-radius:50%; border:2px solid var(--pc-edge-hi,#6e7482);
  background:#2b2733; display:flex; align-items:center; justify-content:center; font-size:22px; }
.pc-unit-col { flex:1; min-width:0; }
.pc-portrait-wrap { position:relative; flex:none; }
.pc-buffs { display:flex; gap:4px; margin-top:4px; }
.pc-buffs:empty { display:none; }
.pc-buff { font:600 10.5px/16px system-ui; padding:0 6px; border-radius:8px; background:rgba(40,38,48,.9); color:#eadfc4; }
.pc-buff.camp { color:#ffc27a; } .pc-buff.ev { color:#9fd0ff; }
.pc-unspent { position:absolute; right:-6px; top:-6px; min-width:20px; height:20px; padding:0 4px; box-sizing:border-box;
  border-radius:10px; background:#2f9e4f; color:#fff; font:700 11px/20px system-ui; text-align:center;
  box-shadow:0 0 0 2px rgba(14,13,19,.9), 0 0 10px rgba(80,220,120,.8); cursor:pointer; pointer-events:auto;
  animation:pcUnspent 1.6s ease-in-out infinite; }
@keyframes pcUnspent { 0%,100% { box-shadow:0 0 0 2px rgba(14,13,19,.9), 0 0 5px rgba(80,220,120,.5); }
  50% { box-shadow:0 0 0 2px rgba(14,13,19,.9), 0 0 14px rgba(80,220,120,1); } }
.pc-unit-name { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:#f3e2b0; }
.pc-hp .pc-bar-fill { background:linear-gradient(#4fd06a,#2a9a44); }
.pc-mana { height:8px; margin-top:3px; }
.pc-mana .pc-bar-fill { background:linear-gradient(#5b9cff,#2e62c8); }
.pc-minimap { position:absolute; right:14px; top:14px; width:160px; height:160px; pointer-events:auto; }
.pc-minimap canvas { width:160px; height:160px; cursor:pointer; display:block; }
.pc-mm-zoom { position:absolute; width:22px; height:22px; border-radius:50%; border:1px solid var(--pc-edge,#3a3e48);
  background:#1d1a22; font-size:15px; line-height:18px; padding:0; }
.pc-mm-in { right:-4px; top:112px; } .pc-mm-out { right:-4px; top:138px; }
.pc-mm-label { position:absolute; left:0; right:0; top:166px; text-align:center; font-size:11px; color:#cfc6ae; }
.pc-actionbar { position:absolute; left:50%; bottom:12px; transform:translateX(-50%); display:flex; flex-direction:column;
  align-items:center; gap:5px; pointer-events:auto; }
.pc-xp { position:relative; height:9px; margin-top:4px; background:#1b1a20; border:1px solid #000; border-radius:3px; overflow:hidden; }
.pc-xp-fill { height:100%; width:0; background:#6b6f7a; }
.pc-xp-text { position:absolute; inset:0; text-align:center; font:600 8.5px/9px system-ui; color:#d9dbe0; text-shadow:0 1px 1px #000; }
.pc-slots { display:flex; gap:5px; }
.pc-slot { position:relative; width:48px; height:48px; border-radius:6px; background:rgba(14,13,19,.88);
  border:1px solid var(--pc-edge,#3a3e48); display:flex; align-items:center; justify-content:center; font-size:24px; overflow:hidden; }
.pc-slot.empty { opacity:.45; }
.pc-slot.off .pc-slot-ico { opacity:.3; }
.pc-slot:hover:not(.empty) { border-color:var(--pc-edge-hi,#6e7482); background:rgba(40,38,48,.95); }
.pc-slot.on { border-color:#ff5a4a; box-shadow:0 0 8px rgba(255,90,74,.7) inset; }
.pc-slot-k { position:absolute; left:3px; top:1px; font-size:11px; color:#d8d0bb; }
.pc-slot-n { position:absolute; right:3px; bottom:1px; font-size:12px; color:#fff; }
.pc-cd { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:17px; color:#fff; }
.pc-micro { position:absolute; right:14px; bottom:14px; display:flex; gap:5px; }
.pc-hud.touch .pc-actionbar, .pc-hud.touch .pc-micro { display:none !important; }
/* Телефон: чат и журнал — прозрачная полоска сверху посередине; тап — развернуть. */
.pc-hud.touch .pc-chat { left:50%; top:4px; bottom:auto; transform:translateX(-50%); width:min(38vw,400px); height:56px;
  background:rgba(10,9,14,.28); box-shadow:none; border:none; }
/* Свёрнута — фон совсем прозрачный, видны только сообщения (с тенью для читаемости). */
.pc-hud.touch .pc-chat:not(.open) { background:transparent !important; backdrop-filter:none; }
.pc-hud.touch .pc-chat:not(.open) .pc-chat-log { text-shadow:0 1px 2px #000, 0 0 3px #000; }
.pc-hud.touch .pc-chat:not(.open) .pc-chat-head, .pc-hud.touch .pc-chat:not(.open) .pc-chat-input { display:none !important; }
.pc-hud.touch .pc-chat:not(.open) .pc-chat-log { overflow:hidden; font-size:11.5px; padding:2px 6px; }
.pc-hud.touch .pc-chat.open { top:48px; width:min(80vw,560px); height:min(62vh,420px); background:rgba(10,9,14,.88); z-index:60; }
.pc-hud.touch .pc-chat.open .pc-chat-input { font-size:17px; padding:12px 12px; min-height:46px; border-radius:8px; }
/* Телефон: настройки журнала — вниз внутрь панели (вверх уезжали за экран); вкладки и шрифт крупнее. */
.pc-hud.touch .pc-chat-cfg { top:50px; bottom:auto; left:6px; margin:0; z-index:5; font-size:15px; gap:9px; }
.pc-hud.touch .pc-chat-cfg input { width:20px; height:20px; }
.pc-hud.touch .pc-chat-tab { font-size:16px; padding:6px 16px; border-radius:7px; }
.pc-hud.touch .pc-chat-gear { font-size:24px; min-width:42px; min-height:38px; padding:2px 10px; }
.pc-hud.touch .pc-chat.open .pc-chat-log { font-size:15.5px; line-height:1.4; }
.pc-hud.touch .pc-chat:not(.open) .pc-chat-log { font-size:13.5px; }
.pc-hud.touch .pc-unit { left:6px; top:6px; transform:scale(.82); transform-origin:0 0; background:none; box-shadow:none; }
.pc-hud.touch .pc-minimap { right:4px; top:4px; transform:scale(.5); transform-origin:100% 0; }
.pc-hud.touch .pc-minimap canvas { border-radius:6px; }
.pc-hud.touch .pc-mm-label, .pc-hud.touch .pc-mm-zoom { display:none; }
.pc-micro-btn { width:38px; height:38px; border-radius:7px; background:rgba(14,13,19,.88); border:1px solid #3a3e48; font-size:18px; padding:0;
  display:flex; align-items:center; justify-content:center; }
.pc-micro-btn:hover { border-color:var(--pc-edge-hi,#6e7482); background:rgba(40,38,48,.95); }
.pc-micro-btn.on { border-color:var(--pc-edge-hi,#6e7482); }
.pc-chat { position:absolute; left:14px; bottom:14px; width:380px; height:210px; display:flex; flex-direction:column;
  pointer-events:auto; background:rgba(14,13,19,.62); }
.pc-chat-head { display:flex; align-items:center; gap:4px; padding:3px 6px; border-bottom:1px solid rgba(110,116,130,.35); }
.pc-chat-title { flex:1; display:flex; gap:4px; }
.pc-chat-input { margin:4px 6px 6px; padding:5px 8px; border-radius:6px; border:1px solid rgba(110,116,130,.5); background:rgba(10,9,14,.85); color:#e8e6f0; font:13px system-ui; pointer-events:auto; }
.pc-chat-tab { background:none; border:1px solid transparent; border-radius:5px; color:#a9a498; font:600 12px system-ui; padding:1px 8px; cursor:pointer; }
.pc-chat-tab.on { color:#f3e2b0; border-color:rgba(110,116,130,.5); background:rgba(40,38,48,.6); }
.pc-chat-gear { background:none; border:none; font-size:13px; padding:0 4px; opacity:.8; }
.pc-chat-log { flex:1; overflow-y:auto; padding:4px 8px; font:500 12.5px/1.35 system-ui; text-shadow:0 1px 1px #000; }
.pc-chat-log b { font-weight:700; }
.pc-log-chat b { color:#b59bff; } .pc-log-loot { color:#f5c542; } .pc-log-xp { color:#c9a0ff; }
.pc-log-event { color:#ffb070; } .pc-log-damage { color:#e8e2d2; } .pc-log-kill { color:#ff9a95; } .pc-log-system { color:#cfd6e0; }
.pc-chat-cfg { position:absolute; left:0; bottom:100%; margin-bottom:6px; background:rgba(14,13,19,.95);
  border:none; border-radius:8px; padding:8px 10px; display:flex; flex-direction:column; gap:5px; }
.pc-chat-cfg label { display:flex; gap:7px; align-items:center; cursor:pointer; }
.pc-bigmap { position:absolute; inset:0; background:rgba(0,0,0,.45); display:flex; align-items:center; justify-content:center; pointer-events:auto; }
.pc-bigmap-box { padding:8px; }
.pc-bigmap-head { display:flex; justify-content:space-between; align-items:center; padding:0 4px 6px; color:#f3e2b0; }
.pc-bigmap canvas { width:min(78vh,78vw); height:min(78vh,78vw); display:block; border-radius:6px; }
`;
  document.head.appendChild(s);
}
