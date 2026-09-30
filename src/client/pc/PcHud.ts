import { ELITE_MOBS, MOB_CAMPS, WORLD } from "#shared/constants";
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
}

const CFG_KEY = "zep.pcChat";
const LOG_MAX = 80;

export type WeaponIcon = "sword" | "bow" | "staff" | "fist";

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
  onCharacter: () => void;
  onBag: () => void;
  onMenu: () => void;
  /** Клик по ячейке панели действий: "1" атака, "2" умение, "3" зелье, "E" подобрать. */
  onSlot: (key: string) => void;
  /** Клик по значку свободных очков — вкладка атрибутов. */
  onAttrs: () => void;
}

const ICON: Record<WeaponIcon, string> = { sword: "⚔", bow: "🏹", staff: "🔥", fist: "✊" };

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
  private readonly slotSkill: HTMLDivElement;
  private readonly skillCd: HTMLDivElement;
  private readonly slotPotion: HTMLDivElement;
  private readonly potionCnt: HTMLSpanElement;
  // журнал
  private readonly chatEl: HTMLDivElement;
  private readonly logEl: HTMLDivElement;
  private readonly cfgEl: HTMLDivElement;
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
    this.root = div("pc-hud");

    // --- рамка героя ---
    const unit = div("pc-unit pc-frame");
    this.portraitEl = div("pc-portrait", "⚔");
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
    this.slotAtk = slot("1", "⚔", "Автоатака по цели (1)");
    this.slotSkill = slot("2", "✦", "Умение (2)");
    this.skillCd = div("pc-cd");
    this.slotSkill.append(this.skillCd);
    this.slotPotion = slot("3", "🧪", "Зелье лечения (3)");
    this.potionCnt = document.createElement("span");
    this.potionCnt.className = "pc-slot-n";
    this.slotPotion.append(this.potionCnt);
    slots.append(
      this.slotAtk,
      this.slotSkill,
      this.slotPotion,
      slot("E", "", "Подобрать / рыбачить (E)", GRAB_SVG),
      slot("5", "", ""),
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
    bag.innerHTML = SACK_SVG;
    mb("🗺", "Карта (M)", () => this.toggleMap());
    this.chatBtn = mb("💬", "Журнал и чат (L)", () => this.setChatOn(!this.cfg.on));
    mb("⛶", "На весь экран (F11 / Ctrl+Enter)", () => toggleFullscreen());
    mb("⚙", "Меню (Esc)", () => this.hooks.onMenu());

    // --- журнал ---
    this.chatEl = div("pc-chat pc-frame");
    const head = div("pc-chat-head");
    const title = div("pc-chat-title", "Журнал");
    const gear = btn("pc-chat-gear", "⚙", "Что показывать");
    const close = btn("pc-chat-gear", "✕", "Скрыть журнал (L)");
    close.onclick = () => this.setChatOn(false);
    head.append(title, gear, close);
    this.logEl = div("pc-chat-log");
    this.cfgEl = div("pc-chat-cfg");
    this.cfgEl.style.display = "none";
    gear.onclick = () => {
      this.cfgEl.style.display = this.cfgEl.style.display === "none" ? "" : "none";
    };
    this.renderCfg();
    this.chatEl.append(head, this.logEl, this.cfgEl);

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
  };

  // ---- рамка героя ----

  setIdentity(nick: string, level: number, weapon: WeaponIcon): void {
    const sig = `${nick}|${level}|${weapon}`;
    if (this.lastSig.id === sig) return;
    this.lastSig.id = sig;
    this.nameEl.textContent = `${nick} · ${level} ур.`;
    this.portraitEl.textContent = ICON[weapon];
    this.slotAtk.querySelector(".pc-slot-ico")!.textContent = ICON[weapon];
  }

  /** Баффы: секунд осталось у баффа события (×2 опыт/урон) и «Тепла костра» (+10% урона). */
  setBuffs(eventSecs: number, campSecs: number, xpSecs = 0, windSecs = 0): void {
    const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    const sig = `${eventSecs}|${campSecs}|${xpSecs}|${windSecs}`;
    if (this.lastSig.buffs === sig) return;
    this.lastSig.buffs = sig;
    this.buffsEl.innerHTML = "";
    const chip = (ico: string, text: string, title: string, cls: string): void => {
      const c = div(`pc-buff ${cls}`, `${ico} ${text}`);
      c.title = title;
      this.buffsEl.append(c);
    };
    if (eventSecs > 0) chip("✨", mmss(eventSecs), "Благословение события: ×2 опыт и урон", "ev");
    if (campSecs > 0) chip("🔥", mmss(campSecs), "Тепло костра: входящий урон −20%", "camp");
    if (xpSecs > 0) chip("📜", mmss(xpSecs), "Свиток мудрости: ×2 опыта", "ev");
    if (windSecs > 0) chip("🪶", mmss(windSecs), "Свиток ветра: +20% скорости бега", "camp");
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

  /** kind — какое умение (null — у оружия умения нет); cdFrac 0..1 — сколько ещё ждать. */
  setSkill(kind: SkillIcon | null, name: string | null, cdFrac: number, cdLeft: number): void {
    const sig = `${name}|${Math.ceil(cdLeft)}|${cdFrac > 0 ? 1 : 0}`;
    if (this.lastSig.skillKind !== (kind ?? "")) {
      this.lastSig.skillKind = kind ?? "";
      this.slotSkill.querySelector(".pc-slot-ico")!.innerHTML = kind ? SKILL_SVG[kind] : "✦";
    }
    if (this.lastSig.skill !== sig) {
      this.lastSig.skill = sig;
      this.slotSkill.classList.toggle("off", !name);
      this.slotSkill.title = name ? `${name} (2)` : "У этого оружия нет умения";
      this.skillCd.textContent = cdLeft > 0.05 ? String(Math.ceil(cdLeft)) : "";
    }
    this.skillCd.style.background =
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
      row.append(b);
    }
    const span = document.createElement("span");
    span.textContent = text;
    if (color) span.style.color = color;
    row.append(span);
    if (!this.cfg.kinds[kind]) row.style.display = "none";
    const atBottom = this.logEl.scrollTop + this.logEl.clientHeight >= this.logEl.scrollHeight - 8;
    this.logEl.append(row);
    while (this.logEl.childElementCount > LOG_MAX) this.logEl.firstElementChild?.remove();
    if (atBottom) this.logEl.scrollTop = this.logEl.scrollHeight;
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
          r.style.display = cb.checked ? "" : "none";
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
    c.arc(R, R, R - 2, 0, Math.PI * 2);
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
    const seen = new Set<string>();
    for (const camp of MOB_CAMPS) {
      const def = ELITE_MOBS[camp.type];
      c.strokeStyle = "rgba(224,80,64,0.55)";
      c.lineWidth = 2;
      c.beginPath();
      c.arc(toX(camp.x), toY(camp.z), Math.max(5, camp.spread * k * 0.8), 0, Math.PI * 2);
      c.stroke();
      if (labels && !seen.has(`${camp.type}${camp.x}`)) {
        seen.add(`${camp.type}${camp.x}`);
        label(c, `${def.name} · ${def.level}`, toX(camp.x), toY(camp.z) - 6, "#ffc9bf");
      }
    }
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

export type SkillIcon = "stunBash" | "arrowRain" | "massHeal";

/** Свои иконки умений (кнопка 2). */
const SKILL_SVG: Record<SkillIcon, string> = {
  // Меч, вонзённый в землю, и ударная волна — «Оглушающий удар».
  stunBash:
    `<svg viewBox="0 0 32 32" width="34" height="34" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M16 3v15" stroke="#e9ecf2" stroke-width="3"/><path d="M11 8h10" stroke="#c9a05a" stroke-width="2.6"/>` +
    `<path d="M16 18l-2.2 3h4.4z" fill="#e9ecf2" stroke="#e9ecf2" stroke-width="1.2"/>` +
    `<path d="M6 23c3 3 17 3 20 0" stroke="#ff7a4a" stroke-width="2.2"/><path d="M2.5 26.5c5 4.5 22 4.5 27 0" stroke="#ff4a3a" stroke-width="1.8" opacity=".8"/>` +
    `<path d="M9 17l-3-2M23 17l3-2M8 21l-4 0M24 21l4 0" stroke="#ffd166" stroke-width="1.6"/>` +
    `</svg>`,
  // Три стрелы падают сверху — «Град стрел».
  arrowRain:
    `<svg viewBox="0 0 32 32" width="34" height="34" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    `<g stroke="#dfe9f5" stroke-width="2"><path d="M8 3v17"/><path d="M16 1v21"/><path d="M24 4v16"/></g>` +
    `<g fill="#9fd0ff" stroke="#9fd0ff" stroke-width="1"><path d="M8 24l-2.6-4.5h5.2z"/><path d="M16 26l-2.6-4.5h5.2z"/><path d="M24 24l-2.6-4.5h5.2z"/></g>` +
    `<g stroke="#b88a54" stroke-width="1.6"><path d="M6 3l2 2 2-2M14 1l2 2 2-2M22 4l2 2 2-2"/></g>` +
    `<path d="M4 29h24" stroke="#6f8a5a" stroke-width="2"/>` +
    `</svg>`,
  // Зелёный крест в сияющем кольце — «Массовое лечение».
  massHeal:
    `<svg viewBox="0 0 32 32" width="34" height="34" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    `<circle cx="16" cy="16" r="12.5" stroke="#5fe08a" stroke-width="1.8" opacity=".75"/>` +
    `<path d="M16 8v16M8 16h16" stroke="#7dff9e" stroke-width="5"/><path d="M16 8v16M8 16h16" stroke="#eafff0" stroke-width="1.6"/>` +
    `<path d="M5 6l1.5 1.5M26 5l-1.5 1.5M27 26l-1.5-1.5M5 26l1.5-1.5" stroke="#bfffd0" stroke-width="1.6"/>` +
    `</svg>`,
};

/** Мешок (кнопка снаряжения и сумки). */
const SACK_SVG =
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
  `<path d="M9 3.5h6l-1.6 3.2h-2.8z" fill="#c9b28a" stroke="#e8dcc0" stroke-width="1.2"/>` +
  `<path d="M10.2 6.9c-4.2 1.4-6.7 5.3-6.2 9.3.4 3.1 3 4.8 8 4.8s7.6-1.7 8-4.8c.5-4-2-7.9-6.2-9.3z" fill="#a8855a" stroke="#e8dcc0" stroke-width="1.3"/>` +
  `<path d="M9.6 7.2c1.6.6 3.2.6 4.8 0" stroke="#5a4028" stroke-width="1.6"/>` +
  `<path d="M8 13.5c1.3 1 2.6 1.4 4 1.4" stroke="#e8dcc0" stroke-width="1" opacity=".6"/>` +
  `</svg>`;

/** Белая рука, которая что-то поднимает (иконка E). */
const GRAB_SVG =
  `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">` +
  `<path d="M8 11v-3.5a1.5 1.5 0 0 1 3 0v2.5"/><path d="M11 9.5v-3a1.5 1.5 0 0 1 3 0v3.5"/>` +
  `<path d="M14 7.5a1.5 1.5 0 0 1 3 0v2.5"/><path d="M17 11.5a1.5 1.5 0 0 1 3 0v4.5a6 6 0 0 1-6 6h-2h.2a6 6 0 0 1-5-2.7l-.2-.3c-.3-.5-1.4-2.4-3.3-5.7a1.5 1.5 0 0 1 .5-2a1.9 1.9 0 0 1 2.3.3l1.5 1.5"/>` +
  `</svg>`;

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
.pc-micro-btn { width:38px; height:38px; border-radius:7px; background:rgba(14,13,19,.88); border:1px solid #3a3e48; font-size:18px; padding:0;
  display:flex; align-items:center; justify-content:center; }
.pc-micro-btn:hover { border-color:var(--pc-edge-hi,#6e7482); background:rgba(40,38,48,.95); }
.pc-micro-btn.on { border-color:var(--pc-edge-hi,#6e7482); }
.pc-chat { position:absolute; left:14px; bottom:14px; width:380px; height:210px; display:flex; flex-direction:column;
  pointer-events:auto; background:rgba(14,13,19,.62); }
.pc-chat-head { display:flex; align-items:center; gap:4px; padding:3px 6px; border-bottom:1px solid rgba(110,116,130,.35); }
.pc-chat-title { flex:1; color:#f3e2b0; font-size:12px; }
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
