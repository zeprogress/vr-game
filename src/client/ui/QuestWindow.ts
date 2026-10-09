import { glyph } from "#shared/icons";
import type { QuestActMsg, QuestData, QuestSlotView, ShopData } from "#shared/net/messages";

/**
 * Задания дня: окно доски в лагере, трекер справа (каждое задание — своя
 * карточка, клик — компас к цели) и сам компас. DOM — общий для ПК и
 * телефона (в VR пока нет).
 */
export interface QuestHooks {
  request: () => void;
  act: (m: QuestActMsg) => void;
}

const fmtTime = (s: number): string => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
};

const rewardText = (r: QuestSlotView["reward"]): string =>
  [r.xpPct > 0 ? "опыт" : "", `${r.tokens} ◈`, `лом ×${r.scrap}`].filter(Boolean).join(" · ");

export class QuestWindow {
  private readonly root: HTMLDivElement;
  private readonly box: HTMLDivElement;
  private data: QuestData | null = null;

  constructor(private readonly hooks: QuestHooks) {
    injectStyle();
    this.root = document.createElement("div");
    this.root.className = "qw-root";
    this.box = document.createElement("div");
    this.box.className = "qw-box";
    this.root.append(this.box);
    this.root.style.display = "none";
    this.root.addEventListener("pointerdown", (e) => {
      if (e.target === this.root) this.close();
    });
    document.body.appendChild(this.root);
  }

  get isOpen(): boolean {
    return this.root.style.display !== "none";
  }

  open(): void {
    this.root.style.display = "flex";
    this.hooks.request();
    this.render();
  }

  close(): boolean {
    if (!this.isOpen) return false;
    this.root.style.display = "none";
    return true;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  setData(d: QuestData): void {
    this.data = d;
    if (d.msg) toast(d.msg);
    if (this.isOpen) this.render();
  }

  private render(): void {
    const b = this.box;
    b.innerHTML = "";
    const d = this.data;
    const head = el("div", "qw-head");
    head.append(el("div", "qw-title", "Доска заданий"));
    const right = el("div", "qw-hr");
    if (d) right.append(el("span", "qw-tokens", `◈ ${d.tokens}`));
    const x = el("button", "qw-x", "✕");
    x.onclick = () => this.close();
    right.append(x);
    head.append(right);
    b.append(head);
    if (!d) {
      b.append(el("div", "qw-sub", "Загрузка…"));
      return;
    }
    b.append(
      el("div", "qw-sub", `Новые задания через ${fmtTime(d.nextSecs)}${d.near ? "" : " · сдавать и брать — у доски у выхода из лагеря"}`),
    );
    if (!d.dailyTaken) {
      b.append(el("div", "qw-sec", "Задания дня"));
      d.slots.slice(0, 3).forEach((s) => b.append(this.card(s, d, null, true)));
      const take = el("button", "qw-btn main qw-wide", "Взять задания дня");
      take.disabled = !d.near;
      take.onclick = () => this.hooks.act({ act: "takeDaily", idx: 0 });
      b.append(take);
    } else {
      b.append(el("div", "qw-sec", "Мои задания"));
      d.slots.forEach((s, i) =>
        b.append(this.card(s, d, s.done && !s.claimed ? { label: "Сдать", main: true, act: { act: "claim", idx: i } } : null)),
      );
    }
    b.append(el("div", "qw-sec", d.picksLeft > 0 ? `Дополнительные — можно взять ещё ${d.picksLeft}` : "Дополнительные — на сегодня взято"));
    if (!d.offers.length) b.append(el("div", "qw-sub", "Больше заданий нет — приходи завтра"));
    d.offers.forEach((s, i) =>
      b.append(this.card(s, d, d.picksLeft > 0 ? { label: "Взять", main: false, act: { act: "take", idx: i } } : null, true)),
    );
  }

  private card(
    s: QuestSlotView,
    d: QuestData,
    btn: { label: string; main: boolean; act: QuestActMsg } | null,
    offer = false,
  ): HTMLDivElement {
    const card = el("div", `qw-card${s.hard ? " hard" : ""}${s.claimed ? " claimed" : ""}`);
    const top = el("div", "qw-row");
    const name = el("div", "qw-name", s.title);
    if (s.hard) name.prepend(el("span", "qw-tag", "Усложнённое"));
    top.append(name);
    if (!offer) top.append(el("div", "qw-count", s.claimed ? "сдано" : s.done ? "✓ готово" : `${s.got}/${s.need}`));
    card.append(top);
    if (!offer && !s.claimed) {
      const bar = el("div", "qw-bar");
      const fill = el("div", "qw-fill");
      fill.style.width = `${Math.round((s.got / Math.max(1, s.need)) * 100)}%`;
      bar.append(fill);
      card.append(bar);
    }
    const foot = el("div", "qw-row");
    foot.append(el("div", "qw-reward", rewardText(s.reward)));
    if (btn) {
      const bt = el("button", `qw-btn${btn.main ? " main" : ""}`, btn.label);
      bt.disabled = !d.near;
      bt.onclick = () => this.hooks.act(btn.act);
      foot.append(bt);
    }
    card.append(foot);
    return card;
  }

  dispose(): void {
    this.root.remove();
  }
}

/**
 * Трекер справа: каждое несданное задание — отдельная карточка. Клик по
 * карточке включает компас к цели (повторный — выключает).
 */
/** Строка трекера: дневное задание, глава сюжета или контракт недели. */
export interface TrackItem {
  key: string;
  src: "daily" | "story" | "weekly";
  kind: QuestSlotView["kind"];
  target: string;
  title: string;
  progress: string;
  done: boolean;
  hard: boolean;
}

export function trackItems(d: QuestData): TrackItem[] {
  const out: TrackItem[] = [];
  if (d.story?.taken) {
    const st = d.story;
    out.push({
      key: `story:${st.chapter}`,
      src: "story",
      kind: st.kind,
      target: st.target,
      title: `Сюжет ${st.chapter}/${st.total}: ${st.title}`,
      progress: st.done ? "✓ сдать Охотнику" : `${st.got}/${st.need}`,
      done: st.done,
      hard: false,
    });
  }
  for (const [i, s] of d.slots.entries()) {
    if (s.claimed || (i < 3 && !d.dailyTaken)) continue;
    out.push({
      key: `${s.kind}:${s.target}:${s.hard ? "h" : "e"}`,
      src: "daily",
      kind: s.kind,
      target: s.target,
      title: s.title,
      progress: s.done ? "✓ сдать у доски" : `${s.got}/${s.need}`,
      done: s.done,
      hard: s.hard,
    });
  }
  const w = d.weekly;
  if (w.taken && !w.claimed) {
    out.push({
      key: "weekly",
      src: "weekly",
      kind: "hunt",
      target: "",
      title: "Контракт недели",
      progress: w.done ? "✓ сдать Охотнику" : w.parts.map((p) => `${p.got}/${p.need}`).join(" · "),
      done: w.done,
      hard: true,
    });
  }
  return out;
}

/**
 * Трекер справа: каждое задание — отдельная карточка. Клик по карточке
 * включает компас к цели (повторный — выключает).
 */
export class QuestTracker {
  private readonly root: HTMLDivElement;
  private sig = "";
  private data: QuestData | null = null;
  /** Выбранное для компаса задание (ключ) — null: компас выключен. */
  selected: string | null = null;

  constructor(
    pc: boolean,
    private readonly onOpen: () => void,
    private readonly onSelect: (s: TrackItem | null) => void,
  ) {
    injectStyle();
    this.root = document.createElement("div");
    this.root.className = `qt-root ${pc ? "pc" : "phone"}`;
    this.root.style.display = "none";
    document.body.appendChild(this.root);
  }

  setData(d: QuestData): void {
    this.data = d;
    // Выбранное сдали/исчезло — компас выключаем; стало готово — компас к сдаче.
    const sel = trackItems(d).find((s) => s.key === this.selected);
    if (this.selected && !sel) {
      this.selected = null;
      this.onSelect(null);
    } else if (sel) this.onSelect(sel);
    this.render();
  }

  private render(): void {
    const d = this.data;
    if (!d) return;
    const items = trackItems(d);
    const sig = items.map((s) => `${s.key}${s.progress}`).join("|") + `|${this.selected}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.root.innerHTML = "";
    if (!items.length) {
      this.root.style.display = "none";
      return;
    }
    this.root.style.display = "";
    const head = el("div", "qt-head", "Задания ›");
    head.onclick = () => this.onOpen();
    this.root.append(head);
    for (const s of items) {
      const c = el(
        "div",
        `qt-card${s.done ? " done" : ""}${s.hard ? " hard" : ""}${s.src === "story" ? " story" : ""}${this.selected === s.key ? " sel" : ""}`,
      );
      c.append(el("div", "qt-name", s.title));
      c.append(el("div", "qt-n", s.progress));
      c.onclick = () => {
        this.selected = this.selected === s.key ? null : s.key;
        this.onSelect(this.selected ? s : null);
        this.sig = "";
        this.render();
      };
      this.root.append(c);
    }
  }

  setVisible(on: boolean): void {
    this.root.classList.toggle("hidden", !on);
  }

  dispose(): void {
    this.root.remove();
  }
}

/** Окно Охотника: глава сюжета новичка и недельный контракт. */
export class HunterWindow {
  private readonly root: HTMLDivElement;
  private readonly box: HTMLDivElement;
  private data: QuestData | null = null;

  constructor(private readonly hooks: QuestHooks) {
    injectStyle();
    this.root = document.createElement("div");
    this.root.className = "qw-root";
    this.box = document.createElement("div");
    this.box.className = "qw-box";
    this.root.append(this.box);
    this.root.style.display = "none";
    this.root.addEventListener("pointerdown", (e) => {
      if (e.target === this.root) this.close();
    });
    document.body.appendChild(this.root);
  }

  get isOpen(): boolean {
    return this.root.style.display !== "none";
  }

  open(): void {
    this.root.style.display = "flex";
    this.hooks.request();
    this.render();
  }

  close(): boolean {
    if (!this.isOpen) return false;
    this.root.style.display = "none";
    return true;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  setData(d: QuestData): void {
    this.data = d;
    if (this.isOpen) this.render();
  }

  private render(): void {
    const b = this.box;
    b.innerHTML = "";
    const d = this.data;
    const head = el("div", "qw-head");
    head.append(el("div", "qw-title", "Охотник"));
    const x = el("button", "qw-x", "✕");
    x.onclick = () => this.close();
    head.append(x);
    b.append(head);
    if (!d) return;
    if (!d.nearHunter) b.append(el("div", "qw-sub", "Сдавать — у Охотника у выхода из лагеря."));

    b.append(el("div", "qw-sec", "История лагеря"));
    const st = d.story;
    if (!st) {
      b.append(el("div", "qw-sub", "Вся история пройдена — ты защитник лагеря."));
    } else {
      const card = el("div", "qw-card story");
      const top = el("div", "qw-row");
      top.append(el("div", "qw-name", `Глава ${st.chapter}/${st.total}: ${st.title}`));
      top.append(el("div", "qw-count", st.done ? "✓ готово" : `${st.got}/${st.need}`));
      card.append(top, el("div", "qw-lore", `«${st.text}»`));
      const bar = el("div", "qw-bar");
      const fill = el("div", "qw-fill");
      fill.style.width = `${Math.round((st.got / Math.max(1, st.need)) * 100)}%`;
      bar.append(fill);
      card.append(bar);
      const foot = el("div", "qw-row");
      const r = st.reward;
      foot.append(
        el(
          "div",
          "qw-reward",
          [r.xpPct ? "опыт" : "", `${r.tokens} ◈`, `зелья ×${r.potions}`, r.final ? "титул и уникальное оружие 80+" : ""]
            .filter(Boolean)
            .join(" · "),
        ),
      );
      if (!st.taken) {
        const bt = el("button", "qw-btn main", "Взять");
        bt.disabled = !d.nearHunter;
        bt.onclick = () => this.hooks.act({ act: "storyTake", idx: 0 });
        foot.append(bt);
      } else if (st.done) {
        const bt = el("button", "qw-btn main", "Сдать");
        bt.disabled = !d.nearHunter;
        bt.onclick = () => this.hooks.act({ act: "storyClaim", idx: 0 });
        foot.append(bt);
      }
      card.append(foot);
      b.append(card);
    }

    const w = d.weekly;
    b.append(el("div", "qw-sec", `Контракт недели · обновится через ${fmtTime(w.secsLeft)}`));
    const card = el("div", `qw-card hard${w.claimed ? " claimed" : ""}`);
    for (const p of w.parts) {
      const row = el("div", "qw-row");
      row.append(el("div", "qw-reward", p.label), el("div", "qw-count", `${p.got}/${p.need}`));
      const bar = el("div", "qw-bar");
      const fill = el("div", "qw-fill");
      fill.style.width = `${Math.round((p.got / Math.max(1, p.need)) * 100)}%`;
      bar.append(fill);
      card.append(row, bar);
    }
    const foot = el("div", "qw-row");
    foot.append(
      el(
        "div",
        "qw-reward",
        w.claimed
          ? "Сдан — новый контракт в понедельник"
          : [w.reward.xpPct ? "опыт" : "", `${w.reward.tokens} ◈`, "уникальное оружие 80+"].filter(Boolean).join(" · "),
      ),
    );
    if (!w.taken) {
      const bt = el("button", "qw-btn main", "Взять контракт");
      bt.disabled = !d.nearHunter;
      bt.onclick = () => this.hooks.act({ act: "weeklyTake", idx: 0 });
      foot.append(bt);
    } else if (w.done && !w.claimed) {
      const bt = el("button", "qw-btn main", "Сдать");
      bt.disabled = !d.nearHunter;
      bt.onclick = () => this.hooks.act({ act: "weeklyClaim", idx: 0 });
      foot.append(bt);
    }
    card.append(foot);
    b.append(card);
  }
}

/** Лавка трактирщика: товары за жетоны ◈. */
export class ShopWindow {
  private readonly root: HTMLDivElement;
  private readonly box: HTMLDivElement;
  private data: ShopData | null = null;

  constructor(private readonly hooks: { request: () => void; buy: (id: string) => void }) {
    injectStyle();
    this.root = document.createElement("div");
    this.root.className = "qw-root";
    this.box = document.createElement("div");
    this.box.className = "qw-box";
    this.root.append(this.box);
    this.root.style.display = "none";
    this.root.addEventListener("pointerdown", (e) => {
      if (e.target === this.root) this.close();
    });
    document.body.appendChild(this.root);
  }

  get isOpen(): boolean {
    return this.root.style.display !== "none";
  }

  open(): void {
    this.root.style.display = "flex";
    this.hooks.request();
    this.render();
  }

  close(): boolean {
    if (!this.isOpen) return false;
    this.root.style.display = "none";
    return true;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  setData(d: ShopData): void {
    this.data = d;
    if (d.msg) toast(d.msg);
    if (this.isOpen) this.render();
  }

  private render(): void {
    const b = this.box;
    b.innerHTML = "";
    const d = this.data;
    const head = el("div", "qw-head");
    head.append(el("div", "qw-title", "Трактир «Тёплый угол»"));
    const right = el("div", "qw-hr");
    if (d) right.append(el("span", "qw-tokens", `◈ ${d.tokens}`));
    const x = el("button", "qw-x", "✕");
    x.onclick = () => this.close();
    right.append(x);
    head.append(right);
    b.append(head);
    b.append(el("div", "qw-sub", "Жетоны ◈ дают за задания дня (доска у выхода из лагеря)."));
    if (!d) return;
    for (const it of d.items) {
      const card = el("div", "qw-card");
      const row = el("div", "qw-row");
      const txt = el("div", "");
      txt.append(el("div", "qw-name", it.name), el("div", "qw-reward", it.desc));
      const bt = el("button", "qw-btn main", it.fishCost ? `${it.fishCost} ${glyph("i.fish")} → 1 ${glyph("i.token")}` : `${it.price} ${glyph("i.token")}`);
      bt.disabled = !d.near || (it.fishCost ? (d.fish ?? 0) < it.fishCost : d.tokens < it.price);
      bt.onclick = () => this.hooks.buy(it.id);
      row.append(txt, bt);
      card.append(row);
      b.append(card);
    }
    // Обмен рубинового на другой класс: по карточке на оружие, кнопка — класс.
    for (const sw of d.swaps ?? []) {
      const card = el("div", "qw-card");
      card.append(el("div", "qw-name", sw.name), el("div", "qw-reward", "Обмен на класс: та же оценка и роллы, старое уходит"));
      const row = el("div", "qw-row");
      for (const t of sw.targets) {
        const bt = el("button", "qw-btn", t.label);
        bt.disabled = !d.near;
        bt.onclick = () => this.hooks.buy(`swap:${sw.wid}:${t.cls}`);
        row.append(bt);
      }
      card.append(row);
      b.append(card);
    }
    if (!d.near) b.append(el("div", "qw-sub", "Покупать — у трактирщика в лагере."));
  }
}

/** Компас вверху экрана: стрелка к точке задания + название и расстояние. */
export class QuestCompass {
  private readonly root: HTMLDivElement;
  private readonly arrow: HTMLDivElement;
  private readonly label: HTMLDivElement;
  private target: { x: number; z: number; name: string } | null = null;

  constructor() {
    injectStyle();
    this.root = document.createElement("div");
    this.root.className = "qc-root";
    this.arrow = document.createElement("div");
    this.arrow.className = "qc-arrow";
    this.arrow.textContent = "➤";
    this.label = document.createElement("div");
    this.label.className = "qc-label";
    this.root.append(this.arrow, this.label);
    this.root.style.display = "none";
    document.body.appendChild(this.root);
  }

  set(t: { x: number; z: number; name: string } | null): void {
    this.target = t;
    this.root.style.display = t ? "" : "none";
  }

  /** yaw — куда смотрит камера (рад, 0 — на +Z). */
  update(px: number, pz: number, yaw: number): void {
    const t = this.target;
    if (!t) return;
    const dx = t.x - px;
    const dz = t.z - pz;
    const dist = Math.hypot(dx, dz);
    const rel = Math.atan2(dx, dz) - yaw;
    // ➤ смотрит вправо — поворачиваем на −90°, чтобы 0 был «вперёд/вверх».
    this.arrow.style.transform = `rotate(${(rel * 180) / Math.PI - 90}deg)`;
    this.label.textContent = dist < 6 ? `${t.name} — здесь` : `${t.name} · ${Math.round(dist)} м`;
  }

  dispose(): void {
    this.root.remove();
  }
}

let toastEl: HTMLDivElement | null = null;
let toastT = 0;
function toast(text: string): void {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "qw-toast";
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = text;
  toastEl.style.display = "";
  window.clearTimeout(toastT);
  toastT = window.setTimeout(() => {
    if (toastEl) toastEl.style.display = "none";
  }, 2800);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

let styled = false;
function injectStyle(): void {
  if (styled) return;
  styled = true;
  const s = document.createElement("style");
  s.textContent = `
.qw-root { position:fixed; inset:0; z-index:46; background:rgba(0,0,0,.45); display:flex; align-items:center;
  justify-content:center; font:500 13.5px/1.35 system-ui,sans-serif; color:#e6e0d0; }
.qw-box { width:min(540px,94vw); max-height:90vh; overflow:auto; background:rgba(16,15,21,.97);
  border-radius:10px; padding:12px 14px 14px; box-shadow:0 10px 40px rgba(0,0,0,.55); scrollbar-width:thin; scrollbar-color:#4a4d58 transparent; }
.qw-head { display:flex; justify-content:space-between; align-items:center; }
.qw-title { font:700 17px system-ui; color:#f1ead6; }
.qw-hr { display:flex; gap:12px; align-items:center; }
.qw-tokens { color:#e8c26a; font-weight:700; }
.qw-x { background:none; border:none; color:#a9a498; font-size:16px; cursor:pointer; }
.qw-sub { color:#8f8a7e; font-size:12px; margin:4px 0 6px; }
.qw-sec { margin:10px 0 6px; font:700 11px/1 system-ui; letter-spacing:.08em; text-transform:uppercase; color:#8f8a7e; }
.qw-card { background:#1d1c25; border-radius:8px; padding:8px 11px; margin-bottom:7px; }
.qw-card.hard { background:#261e2e; box-shadow:inset 0 0 0 1px #6d4a96; }
.qw-card.claimed { opacity:.45; }
.qw-card.story { background:#1e2430; box-shadow:inset 0 0 0 1px #3f5580; }
.qw-lore { font-size:12.5px; color:#c9c2b0; font-style:italic; margin:4px 0 2px; }
.qw-row { display:flex; justify-content:space-between; gap:10px; align-items:center; }
.qw-name { font-weight:600; color:#f1ead6; }
.qw-tag { font:700 10px system-ui; color:#dcc2ff; background:#3a2a4c; border-radius:4px; padding:1px 5px; margin-right:6px; vertical-align:1px; }
.qw-count { color:#8fd18f; white-space:nowrap; font-variant-numeric:tabular-nums; }
.qw-bar { height:5px; background:#2c2b35; border-radius:3px; margin:6px 0 4px; overflow:hidden; }
.qw-fill { height:100%; background:#6fbf6f; border-radius:3px; }
.qw-card.hard .qw-fill { background:#b57bff; }
.qw-reward { font-size:12px; color:#a9a498; }
.qw-btn { padding:5px 12px; border-radius:7px; border:1px solid #3a3e48; background:#23222b; color:#e6e0d0;
  cursor:pointer; font:600 12.5px system-ui; white-space:nowrap; }
.qw-btn:hover:not(:disabled) { border-color:#6e7482; }
.qw-btn:disabled { opacity:.45; cursor:default; }
.qw-btn.main { background:#243a26; border-color:#3f7a45; }
.qw-btn.qw-wide { width:100%; padding:9px; margin:2px 0 6px; font-size:13.5px; }
.qw-toast { position:fixed; left:50%; top:18%; transform:translateX(-50%); z-index:60; background:rgba(16,15,21,.94);
  color:#f1ead6; padding:8px 14px; border-radius:8px; font:600 14px system-ui; pointer-events:none; }
@media (pointer: coarse) {
  .qc-root { top:4px; padding:2px 10px 2px 4px; font-size:11.5px; }
  .qc-arrow { width:20px; height:20px; font-size:16px; }
  .qw-box { width:86vw; max-height:84vh; height:84vh; border-radius:12px; padding:8px 12px; box-sizing:border-box;
    display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:5px 8px; align-content:start; font-size:12px; }
  .qw-head, .qw-sub, .qw-sec, .qw-wide { grid-column:1 / -1; }
  .qw-title { font-size:15px; }
  .qw-sub { margin:0; font-size:11px; }
  .qw-sec { margin:3px 0 0; font-size:10px; }
  .qw-card { margin:0; padding:5px 8px; }
  .qw-name { font-size:12px; }
  .qw-count, .qw-reward { font-size:11px; }
  .qw-bar { height:3px; margin:3px 0; }
  .qw-lore { font-size:11px; margin:2px 0; }
  .qw-btn { padding:4px 9px; font-size:11.5px; }
  .qw-btn.qw-wide { padding:6px; margin:0; }
}
.qt-root { position:fixed; z-index:28; display:flex; flex-direction:column; gap:4px; color:#e6e0d0;
  font:500 12px/1.3 system-ui,sans-serif; width:210px; text-shadow:0 1px 2px #000; }
.qt-root.hidden { display:none !important; }
.qt-root.pc { right:14px; top:236px; }
.qt-root.phone { right:4px; top:90px; width:200px; font-size:11px; line-height:1.15; gap:1px; }
.qt-root.phone .qt-head { padding:0 2px; font-size:9.5px; line-height:1.1; margin:0; }
.qt-root.phone .qt-card { display:flex; gap:6px; align-items:baseline; padding:1px 6px; border-radius:4px; border-left-width:2px; }
.qt-root.phone .qt-name, .qt-root.phone .qt-n { line-height:1.15; }
.qt-root.phone .qt-name { flex:1; min-width:0; }
.qt-root.phone .qt-n { font-size:10.5px; white-space:nowrap; }
.qt-head { align-self:flex-end; font:700 10.5px system-ui; letter-spacing:.08em; text-transform:uppercase; color:#e8c26a;
  cursor:pointer; padding:2px 4px; }
.qt-card { background:rgba(14,13,19,.72); border-radius:7px; padding:5px 8px 6px; cursor:pointer; border-left:3px solid #6fbf6f; }
.qt-card.hard { border-left-color:#b57bff; }
.qt-card.story { border-left-color:#7fa0d8; }
.qt-card.done { border-left-color:#e8c26a; }
.qt-card.sel { background:rgba(40,52,78,.85); box-shadow:0 0 0 1px #7fa0d8; }
.qt-card:hover { background:rgba(26,24,33,.85); }
.qt-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.qt-n { color:#8fd18f; font-variant-numeric:tabular-nums; font-size:11px; }
.qt-card.done .qt-n { color:#e8c26a; }
.qc-root { position:fixed; left:50%; top:86px; transform:translateX(-50%); z-index:29; display:flex; align-items:center;
  gap:8px; background:rgba(14,13,19,.72); border-radius:18px; padding:4px 12px 4px 6px; pointer-events:none;
  color:#f1ead6; font:600 12.5px system-ui; text-shadow:0 1px 2px #000; }
.qc-arrow { width:26px; height:26px; display:flex; align-items:center; justify-content:center; font-size:20px; color:#e8c26a;
  transition:transform .08s linear; }
.qc-label { white-space:nowrap; }
`;
  document.head.appendChild(s);
}
