import { BOT_SKIN_LABELS } from "../world/models";

/**
 * Меню ПК (Esc / ⚙): звук, голос, интерфейс, персонаж, клавиши, выход.
 * Тот же тёмный стиль без цветной окантовки, что у окна снаряжения.
 */
export interface PcMenuHooks {
  getVolume: () => number;
  setVolume: (v: number) => void;
  getMusic: () => number;
  setMusic: (v: number) => void;
  getSfx: () => number;
  setSfx: (v: number) => void;
  getMic: () => boolean;
  setMic: (on: boolean) => void;
  getSpatial: () => boolean;
  setSpatial: (on: boolean) => void;
  getChat: () => boolean;
  setChat: (on: boolean) => void;
  getDmg: () => boolean;
  setDmg: (on: boolean) => void;
  getSkin: () => number;
  setSkin: (skin: number) => void;
  getLeaveBot: () => boolean;
  setLeaveBot: (on: boolean) => void;
  getPvp: () => boolean;
  setPvp: (on: boolean) => void;
  fullscreen: () => void;
  exit: () => void;
}

const KEYS: [string, string][] = [
  ["ПКМ + мышь", "камера и поворот героя"],
  ["ЛКМ + мышь", "облёт камеры"],
  ["Свайп двумя пальцами", "камера (трекпад)"],
  ["Колесо / щипок", "приблизить / отдалить"],
  ["W A S D", "бег"],
  ["Пробел", "прыжок"],
  ["Клик / Tab", "выбрать цель"],
  ["Двойной клик / ПКМ по мобу, 1", "атаковать"],
  ["Двойной клик по предмету", "добежать и подобрать"],
  ["2", "умение"],
  ["3 / X / F", "зелье"],
  ["E", "подобрать / рыбачить"],
  ["C / B", "снаряжение"],
  ["M", "карта"],
  ["L", "журнал"],
  ["V", "микрофон"],
  ["P", "PvP"],
  ["Ctrl+Enter", "на весь экран"],
];

export class PcMenu {
  private readonly root: HTMLDivElement;
  private readonly box: HTMLDivElement;

  constructor(private readonly hooks: PcMenuHooks) {
    injectMenuStyle();
    this.root = document.createElement("div");
    this.root.className = "pcmenu-root";
    this.box = document.createElement("div");
    this.box.className = "pcmenu-box";
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

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    this.render();
    this.root.style.display = "";
  }

  close(): boolean {
    if (!this.isOpen) return false;
    this.root.style.display = "none";
    return true;
  }

  private render(): void {
    const h = this.hooks;
    const b = this.box;
    b.innerHTML = "";
    const head = el("div", "pcmenu-head");
    head.append(el("div", "pcmenu-title", "Меню"));
    const x = el("button", "pcmenu-x", "✕");
    x.onclick = () => this.close();
    head.append(x);
    b.append(head);

    const cols = el("div", "pcmenu-cols");
    const left = el("div", "pcmenu-col");
    const right = el("div", "pcmenu-col");

    left.append(el("div", "pcmenu-sec", "Звук"));
    left.append(slider("Общая громкость", h.getVolume(), h.setVolume));
    left.append(slider("Музыка", h.getMusic(), h.setMusic));
    left.append(slider("Эффекты", h.getSfx(), h.setSfx));

    left.append(el("div", "pcmenu-sec", "Голосовой чат"));
    left.append(check("Микрофон включён (V)", h.getMic(), h.setMic));
    left.append(check("Голоса «по месту» (дальние тише)", h.getSpatial(), h.setSpatial));

    left.append(el("div", "pcmenu-sec", "Интерфейс"));
    left.append(check("Журнал и чат Twitch (L)", h.getChat(), h.setChat));
    left.append(check("Цифры урона над мобами", h.getDmg(), h.setDmg));
    const fs = el("button", "pcmenu-btn", "⛶ На весь экран / обратно");
    fs.onclick = () => h.fullscreen();
    left.append(fs);

    left.append(el("div", "pcmenu-sec", "Персонаж"));
    const skinRow = el("div", "pcmenu-row");
    skinRow.append(el("span", "", "Внешность"));
    const sel = document.createElement("select");
    sel.className = "pcmenu-select";
    BOT_SKIN_LABELS.forEach((label, i) => {
      const o = document.createElement("option");
      o.value = String(i + 1);
      o.textContent = label;
      sel.append(o);
    });
    sel.value = String(Math.max(1, h.getSkin()));
    sel.onchange = () => h.setSkin(Number(sel.value));
    skinRow.append(sel);
    left.append(skinRow);
    left.append(check("Оставить героя ботом после выхода", h.getLeaveBot(), h.setLeaveBot));
    left.append(check("PvP — можно бить других игроков (P)", h.getPvp(), h.setPvp));

    right.append(el("div", "pcmenu-sec", "Управление"));
    const keys = el("div", "pcmenu-keys");
    for (const [k, v] of KEYS) {
      const r = el("div", "pcmenu-krow");
      r.append(el("span", "pcmenu-k", k), el("span", "", v));
      keys.append(r);
    }
    right.append(keys);

    cols.append(left, right);
    b.append(cols);

    const foot = el("div", "pcmenu-foot");
    const cont = el("button", "pcmenu-btn main", "Продолжить");
    cont.onclick = () => this.close();
    const exit = el("button", "pcmenu-btn danger", "Выйти из игры");
    exit.onclick = () => {
      this.close();
      h.exit();
    };
    foot.append(cont, exit);
    b.append(foot);
  }

  dispose(): void {
    this.root.remove();
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function slider(label: string, value: number, set: (v: number) => void): HTMLDivElement {
  const row = el("div", "pcmenu-slider");
  const head = el("div", "pcmenu-row");
  const val = el("span", "pcmenu-val", `${Math.round(value * 100)}%`);
  head.append(el("span", "", label), val);
  const inp = document.createElement("input");
  inp.type = "range";
  inp.min = "0";
  inp.max = "100";
  inp.step = "1";
  inp.value = String(Math.round(value * 100));
  inp.oninput = () => {
    val.textContent = `${inp.value}%`;
    set(Number(inp.value) / 100);
  };
  row.append(head, inp);
  return row;
}

function check(label: string, value: boolean, set: (on: boolean) => void): HTMLLabelElement {
  const lab = el("label", "pcmenu-check");
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = value;
  cb.onchange = () => set(cb.checked);
  lab.append(cb, document.createTextNode(label));
  return lab;
}

let styled = false;
function injectMenuStyle(): void {
  if (styled) return;
  styled = true;
  const s = document.createElement("style");
  s.textContent = `
.pcmenu-root { position:fixed; inset:0; z-index:45; background:rgba(0,0,0,.45); display:flex; align-items:center;
  justify-content:center; font:500 13.5px/1.35 system-ui,sans-serif; color:#e6e0d0; }
.pcmenu-box { width:min(760px,95vw); max-height:92vh; overflow:auto; background:rgba(16,15,21,.97); border:none;
  border-radius:10px; padding:12px 16px 14px; box-shadow:0 10px 40px rgba(0,0,0,.55); }
.pcmenu-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; }
.pcmenu-title { font:700 17px system-ui; color:#f1ead6; }
.pcmenu-x { background:none; border:none; color:#a9a498; font-size:16px; cursor:pointer; }
.pcmenu-cols { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:20px; }
.pcmenu-sec { margin:12px 0 6px; font:700 11px/1 system-ui; letter-spacing:.08em; text-transform:uppercase; color:#8f8a7e; }
.pcmenu-row { display:flex; justify-content:space-between; align-items:center; gap:10px; }
.pcmenu-val { color:#a9a498; }
.pcmenu-slider { margin:4px 0 8px; }
.pcmenu-slider input { width:100%; accent-color:#7fa0d8; }
.pcmenu-check { display:flex; align-items:center; gap:8px; padding:4px 0; cursor:pointer; }
.pcmenu-check input { width:16px; height:16px; accent-color:#7fa0d8; }
.pcmenu-select { background:#1b1a21; color:#e6e0d0; border:1px solid #3a3e48; border-radius:6px; padding:5px 8px; font:inherit; }
.pcmenu-btn { padding:8px 12px; border-radius:7px; border:1px solid #3a3e48; background:#23222b; color:#e6e0d0;
  cursor:pointer; font:600 13px system-ui; margin-top:4px; }
.pcmenu-btn:hover { border-color:#6e7482; }
.pcmenu-btn.main { background:#243049; border-color:#3f5580; }
.pcmenu-btn.danger { background:#2c1c1c; border-color:#6a3a3a; color:#ffc9c0; }
.pcmenu-keys { display:flex; flex-direction:column; gap:2px; font-size:12.5px; }
.pcmenu-krow { display:flex; justify-content:space-between; gap:10px; padding:2px 0; border-bottom:1px solid #22242b; }
.pcmenu-k { color:#f1ead6; }
.pcmenu-foot { display:flex; justify-content:flex-end; gap:8px; margin-top:14px; }
`;
  document.head.appendChild(s);
}
