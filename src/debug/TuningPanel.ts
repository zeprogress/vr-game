import type { CombatSystem, EquipTune, TuneSlot } from "../combat/CombatSystem";

type Mode = "auto" | TuneSlot;

const LABELS: Record<Mode, string> = {
  auto: "авто (что в руке)",
  swordFlat: "меч · плоский",
  swordVR: "меч · VR",
  bowFlat: "лук · плоский",
  bowVR: "лук · VR",
};

interface Row {
  input: HTMLInputElement;
  num: HTMLElement;
  read: () => number;
}

/**
 * Панель тюнинга положения оружия в руке — правит живые значения
 * `combat.tunes[...]` без перезагрузки. Кнопка «⚙ оружие» внизу слева
 * либо клавиша `~` (Backquote).
 */
export class TuningPanel {
  private readonly root: HTMLDivElement;
  private readonly out: HTMLTextAreaElement;
  private mode: Mode = "auto";
  private rows: Row[] = [];

  constructor(private readonly combat: CombatSystem) {
    const btn = document.createElement("button");
    btn.textContent = "⚙ оружие";
    btn.style.cssText = BTN_CSS;
    document.body.appendChild(btn);

    this.root = document.createElement("div");
    this.root.style.cssText = PANEL_CSS;
    document.body.appendChild(this.root);

    const toggle = (): void => {
      const show = this.root.style.display === "none";
      this.root.style.display = show ? "block" : "none";
      if (show) this.refresh();
    };
    btn.addEventListener("click", toggle);
    window.addEventListener("keydown", (e) => {
      if (e.code === "Backquote") toggle();
    });

    this.root.appendChild(this.modeRow());
    this.rows.push(this.slider("поз X", -1.5, 1.5, () => this.t().pos.x, (v) => (this.t().pos.x = v)));
    this.rows.push(this.slider("поз Y", -1.5, 1.5, () => this.t().pos.y, (v) => (this.t().pos.y = v)));
    this.rows.push(this.slider("поз Z", -1.5, 1.5, () => this.t().pos.z, (v) => (this.t().pos.z = v)));
    this.rows.push(this.slider("пов X", -Math.PI, Math.PI, () => this.t().rot.x, (v) => (this.t().rot.x = v)));
    this.rows.push(this.slider("пов Y", -Math.PI, Math.PI, () => this.t().rot.y, (v) => (this.t().rot.y = v)));
    this.rows.push(this.slider("пов Z", -Math.PI, Math.PI, () => this.t().rot.z, (v) => (this.t().rot.z = v)));
    this.rows.push(this.slider("масштаб", 0.1, 2, () => this.t().scale, (v) => (this.t().scale = v)));

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:6px;margin-top:8px;";
    const copyBtn = document.createElement("button");
    copyBtn.textContent = "Скопировать";
    copyBtn.style.cssText = "flex:1;padding:6px;cursor:pointer;";
    copyBtn.addEventListener("click", () => this.copy());
    const resetBtn = document.createElement("button");
    resetBtn.textContent = "Сброс";
    resetBtn.style.cssText = "padding:6px 10px;cursor:pointer;";
    resetBtn.addEventListener("click", () => {
      try {
        localStorage.removeItem("swordTune");
      } catch {
        /* ignore */
      }
      location.reload();
    });
    btnRow.append(copyBtn, resetBtn);
    this.root.appendChild(btnRow);

    this.out = document.createElement("textarea");
    this.out.readOnly = true;
    this.out.style.cssText =
      "width:100%;height:64px;margin-top:6px;font:11px monospace;background:#111;color:#9f9;border:1px solid #444;";
    this.root.appendChild(this.out);

    const hint = document.createElement("div");
    hint.innerHTML =
      "Возьми оружие (E). Esc — освободить мышь для ползунков.<br />" +
      "В VR: зажми X на левом контроллере и крути стики.";
    hint.style.cssText = "margin-top:6px;opacity:0.6;";
    this.root.appendChild(hint);
  }

  private targetSlot(): TuneSlot {
    return this.mode === "auto" ? this.combat.slot() : this.mode;
  }
  private t(): EquipTune {
    return this.combat.tunes[this.targetSlot()];
  }

  private modeRow(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.cssText = "margin-bottom:8px;";
    wrap.appendChild(document.createTextNode("набор: "));
    const sel = document.createElement("select");
    for (const m of Object.keys(LABELS) as Mode[]) {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = LABELS[m];
      sel.appendChild(opt);
    }
    sel.value = this.mode;
    sel.addEventListener("change", () => {
      this.mode = sel.value as Mode;
      this.refresh();
    });
    wrap.appendChild(sel);
    return wrap;
  }

  private slider(
    label: string,
    min: number,
    max: number,
    read: () => number,
    write: (v: number) => void,
  ): Row {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;align-items:center;gap:6px;margin:3px 0;";

    const name = document.createElement("span");
    name.textContent = label;
    name.style.cssText = "width:56px;flex:0 0 auto;";

    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = "0.01";
    input.style.cssText = "flex:1;";

    const num = document.createElement("span");
    num.style.cssText = "width:44px;flex:0 0 auto;text-align:right;";

    input.addEventListener("input", () => {
      const v = parseFloat(input.value);
      write(v);
      num.textContent = v.toFixed(2);
      this.combat.saveTuning();
    });

    wrap.append(name, input, num);
    this.root.appendChild(wrap);
    return { input, num, read };
  }

  private refresh(): void {
    for (const r of this.rows) {
      const v = r.read();
      r.input.value = String(v);
      r.num.textContent = v.toFixed(2);
    }
  }

  private copy(): void {
    const t = this.t();
    const f = (n: number): string => n.toFixed(3).replace(/\.?0+$/, "");
    const text =
      `// CombatSystem.ts -> tunes.${this.targetSlot()}:\n` +
      `tune(${f(t.pos.x)}, ${f(t.pos.y)}, ${f(t.pos.z)}, ${f(t.rot.x)}, ${f(t.rot.y)}, ${f(t.rot.z)}, ${f(t.scale)}),`;
    this.out.value = text;
    navigator.clipboard?.writeText(text).catch(() => {});
    console.log(text);
  }
}

const BTN_CSS =
  "position:fixed;left:12px;bottom:12px;z-index:40;padding:6px 10px;" +
  "font:13px system-ui,sans-serif;background:#222;color:#fff;border:1px solid #555;border-radius:6px;cursor:pointer;";

const PANEL_CSS =
  "position:fixed;left:12px;bottom:52px;z-index:40;width:290px;padding:10px 12px;" +
  "background:rgba(18,18,22,0.94);color:#eee;font:12px/1.5 system-ui,sans-serif;" +
  "border:1px solid #555;border-radius:8px;display:none;";
