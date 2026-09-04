/**
 * Панель живой настройки хвата оружия у ботов: `?gear=1`.
 *
 * Зачем: посадку меча и щита в кость кулака не подобрать вслепую — модель из
 * пака приходит со своим разворотом от загрузчика glTF, и каждая проверка
 * «на глаз» стоила цикла сборка → деплой → зайти в игру. Панель двигает
 * значения в BOT_GEAR прямо во время игры и тут же пересаживает оружие на
 * всех ботах. Ничего не перезагружается, сервер не трогается.
 *
 * Подобранное лежит в localStorage (переживает F5) и показывается готовым
 * куском кода — его достаточно вписать в botGear.ts, чтобы уехало в прод.
 */
import {
  BOT_GEAR,
  loadGearTune,
  saveGearTune,
  notifyGearTuneChanged,
  type GearTune,
} from "../entities/botGear";

type Row = { part: "sword" | "shield"; field: "pos" | "rot"; axis: 0 | 1 | 2 };

const CSS = `
#gearTuner{position:fixed;top:8px;left:8px;z-index:9999;width:280px;max-height:92vh;
overflow:auto;background:rgba(16,18,24,.92);color:#e7e9ee;font:12px/1.35 ui-monospace,monospace;
padding:10px;border-radius:8px;border:1px solid #3a4050;user-select:none}
#gearTuner h4{margin:0 0 6px;font-size:12px;letter-spacing:.04em;color:#9fd3ff}
#gearTuner .r{display:flex;align-items:center;gap:6px;margin:3px 0}
#gearTuner .r label{width:34px;color:#9aa3b2}
#gearTuner input[type=range]{flex:1;min-width:0}
#gearTuner .v{width:52px;text-align:right;color:#ffd48a}
#gearTuner .sec{margin-top:8px;padding-top:6px;border-top:1px solid #2c3140}
#gearTuner button{background:#2b3242;color:#e7e9ee;border:1px solid #454d60;border-radius:5px;
padding:4px 8px;font:11px ui-monospace,monospace;cursor:pointer;margin-right:5px}
#gearTuner button:hover{background:#39425a}
#gearTuner textarea{width:100%;height:76px;margin-top:6px;background:#0f1219;color:#b8e6a0;
border:1px solid #2c3140;border-radius:5px;font:10px/1.3 ui-monospace,monospace;resize:vertical}
#gearTuner .hint{color:#7f8798;margin-top:6px}
`;

export function mountGearTuner(): () => void {
  loadGearTune();
  notifyGearTuneChanged();

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const box = document.createElement("div");
  box.id = "gearTuner";
  document.body.appendChild(box);

  // Колесо и клики не должны улетать в игру: панель поверх канваса.
  for (const ev of ["wheel", "pointerdown", "keydown"] as const) {
    box.addEventListener(ev, (e) => e.stopPropagation());
  }

  const out = document.createElement("textarea");
  out.readOnly = true;
  const rows: { row: Row; slider: HTMLInputElement; view: HTMLSpanElement }[] = [];
  let autoBox: HTMLInputElement | null = null;

  const fmt = (n: number): string => (Math.abs(n) < 0.0005 ? "0" : n.toFixed(3));
  const dump = (): string => {
    const one = (k: "sword" | "shield", g: GearTune): string =>
      `  ${k}: { pos: [${g.pos.map(fmt).join(", ")}], rot: [${g.rot
        .map(fmt)
        .join(", ")}], scale: ${fmt(g.scale)}, auto: ${g.auto} },`;
    return `export const BOT_GEAR = {\n${one("sword", BOT_GEAR.sword)}\n${one(
      "shield",
      BOT_GEAR.shield,
    )}\n};`;
  };

  const sync = (): void => {
    for (const r of rows) {
      const v = BOT_GEAR[r.row.part][r.row.field][r.row.axis];
      r.slider.value = String(v);
      r.view.textContent = fmt(v);
    }
    if (autoBox) autoBox.checked = BOT_GEAR.shield.auto;
    out.value = dump();
  };

  const apply = (): void => {
    saveGearTune();
    notifyGearTuneChanged();
    out.value = dump();
  };

  const slider = (
    part: "sword" | "shield",
    field: "pos" | "rot",
    axis: 0 | 1 | 2,
    min: number,
    max: number,
  ): void => {
    const line = document.createElement("div");
    line.className = "r";
    const label = document.createElement("label");
    label.textContent = `${field}${"xyz"[axis]}`;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = "0.005";
    const view = document.createElement("span");
    view.className = "v";
    input.addEventListener("input", () => {
      const v = Number(input.value);
      BOT_GEAR[part][field][axis] = v;
      view.textContent = fmt(v);
      // Тронули угол щита — значит хотим задать его вручную, а не считать.
      if (part === "shield" && field === "rot" && BOT_GEAR.shield.auto) {
        BOT_GEAR.shield.auto = false;
        if (autoBox) autoBox.checked = false;
      }
      apply();
    });
    line.append(label, input, view);
    box.appendChild(line);
    rows.push({ row: { part, field, axis }, slider: input, view });
  };

  const scaleRow = (part: "sword" | "shield"): void => {
    const line = document.createElement("div");
    line.className = "r";
    const label = document.createElement("label");
    label.textContent = "scale";
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0.2";
    input.max = "4";
    input.step = "0.01";
    input.value = String(BOT_GEAR[part].scale);
    const view = document.createElement("span");
    view.className = "v";
    view.textContent = fmt(BOT_GEAR[part].scale);
    input.addEventListener("input", () => {
      BOT_GEAR[part].scale = Number(input.value);
      view.textContent = fmt(BOT_GEAR[part].scale);
      apply();
    });
    line.append(label, input, view);
    box.appendChild(line);
  };

  const section = (title: string, part: "sword" | "shield"): void => {
    const h = document.createElement("h4");
    h.className = "sec";
    h.textContent = title;
    box.appendChild(h);
    if (part === "shield") {
      const line = document.createElement("div");
      line.className = "r";
      autoBox = document.createElement("input");
      autoBox.type = "checkbox";
      autoBox.checked = BOT_GEAR.shield.auto;
      autoBox.addEventListener("change", () => {
        BOT_GEAR.shield.auto = autoBox!.checked;
        apply();
      });
      const lb = document.createElement("span");
      lb.textContent = "разворот считать автоматически";
      lb.style.color = "#9aa3b2";
      line.append(autoBox, lb);
      box.appendChild(line);
    }
    for (const a of [0, 1, 2] as const) slider(part, "pos", a, -0.6, 0.6);
    for (const a of [0, 1, 2] as const) slider(part, "rot", a, -Math.PI, Math.PI);
    scaleRow(part);
  };

  const title = document.createElement("h4");
  title.textContent = "ХВАТ ОРУЖИЯ БОТА (?gear=1)";
  box.appendChild(title);

  section("МЕЧ · правая рука", "sword");
  section("ЩИТ · левая рука", "shield");

  const btns = document.createElement("div");
  btns.className = "sec";
  const copy = document.createElement("button");
  copy.textContent = "копировать код";
  copy.addEventListener("click", () => {
    void navigator.clipboard?.writeText(dump());
    copy.textContent = "скопировано";
    setTimeout(() => (copy.textContent = "копировать код"), 1200);
  });
  const reset = document.createElement("button");
  reset.textContent = "сброс";
  reset.addEventListener("click", () => {
    localStorage.removeItem("zep.botgear");
    location.reload();
  });
  const hide = document.createElement("button");
  hide.textContent = "свернуть";
  hide.addEventListener("click", () => {
    const on = box.classList.toggle("min");
    for (const c of Array.from(box.children)) {
      if (c !== title && c !== hide.parentElement) (c as HTMLElement).style.display = on ? "none" : "";
    }
    hide.textContent = on ? "развернуть" : "свернуть";
  });
  btns.append(copy, reset, hide);
  box.appendChild(btns);
  box.appendChild(out);

  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = "Значения применяются сразу и переживают F5. Готовое — в src/client/entities/botGear.ts";
  box.appendChild(hint);

  sync();

  return () => {
    box.remove();
    style.remove();
  };
}
