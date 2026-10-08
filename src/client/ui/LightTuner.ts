/**
 * Панель живой настройки освещения: `?light=1`.
 *
 * Время суток (ручной час или авто), солнце по фазам, небо и туман, факелы/светлячки/заклинания/катакомбы.
 * Всё по умолчанию 1 (кроме часа — авто). Значения сохраняются в браузере; кнопка «Скопировать»
 * даёт строку для вставки в код. Панель ничего не меняет на сервере.
 */
import { LIGHT_TUNE, attachLightTune, loadLightTune, notifyLightTune, saveLightTune, type LightTune } from "../world/lightTune";
import { TIME_OVERRIDE } from "../world/Zone";
import type { Scene } from "@babylonjs/core/scene";

const CSS = `
#lightTuner{position:fixed;top:8px;right:8px;z-index:9999;width:270px;max-height:calc(100vh - 16px);overflow:auto;
background:rgba(16,18,24,.92);color:#e7e9ee;font:12px/1.35 ui-monospace,monospace;
padding:10px;border-radius:8px;border:1px solid #3a4050;user-select:none}
#lightTuner h4{margin:8px 0 4px;font-size:12px;letter-spacing:.04em;color:#ffd48a}
#lightTuner h4:first-child{margin-top:0}
#lightTuner .r{display:flex;align-items:center;gap:6px;margin:3px 0}
#lightTuner .r label{width:86px;color:#9aa3b2}
#lightTuner input[type=range]{flex:1;min-width:0}
#lightTuner .v{width:44px;text-align:right;color:#ffd48a}
#lightTuner button{background:#2b3242;color:#e7e9ee;border:1px solid #454d60;border-radius:5px;
padding:4px 7px;font:11px ui-monospace,monospace;cursor:pointer;margin:4px 4px 0 0}
#lightTuner button:hover{background:#39425a}
#lightTuner textarea{width:100%;height:58px;margin-top:6px;background:#0f1219;color:#b8e6a0;
border:1px solid #2c3140;border-radius:5px;font:10px/1.3 ui-monospace,monospace;resize:vertical}
#lightTuner .hint{color:#7f8798;margin-top:6px}
`;

type Slider = { key: keyof LightTune; label: string };
const GROUPS: { title: string; items: Slider[] }[] = [
  {
    title: "Солнце",
    items: [
      { key: "sunMul", label: "солнце всё" },
      { key: "sunDayMul", label: "солнце день" },
      { key: "sunDuskMul", label: "солнце закат" },
      { key: "sunNightMul", label: "солнце ночь" },
    ],
  },
  {
    title: "Небо и туман",
    items: [
      { key: "skyMul", label: "небо" },
      { key: "fogMul", label: "туман" },
    ],
  },
  {
    title: "Факелы и магия",
    items: [
      { key: "torchMul", label: "факелы ботов" },
      { key: "fireflyMul", label: "светлячки" },
      { key: "spellMul", label: "заклинания" },
      { key: "cataMul", label: "катакомбы" },
    ],
  },
];

const PRESETS: [string, number][] = [
  ["рассвет", 6],
  ["день", 12],
  ["закат", 19],
  ["ночь", 23],
  ["полночь", 0],
];

const fmt = (v: number): string => v.toFixed(2);

export function mountLightTuner(): () => void {
  loadLightTune();

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const box = document.createElement("div");
  box.id = "lightTuner";
  document.body.appendChild(box);

  const out = document.createElement("textarea");
  out.readOnly = true;
  const text = (): string => {
    const parts = (Object.keys(LIGHT_TUNE) as (keyof LightTune)[]).map((k) => `${k}: ${fmt(LIGHT_TUNE[k])}`);
    const h = TIME_OVERRIDE.hour;
    parts.push(`hour: ${h === null ? "авто" : h.toFixed(1)}`);
    return parts.join(", ");
  };
  const refreshOut = (): void => {
    out.value = text();
  };

  // ---- время суток
  const timeH = document.createElement("h4");
  timeH.textContent = "Время суток";
  box.appendChild(timeH);

  const auto = document.createElement("label");
  auto.style.display = "block";
  const autoBox = document.createElement("input");
  autoBox.type = "checkbox";
  autoBox.checked = TIME_OVERRIDE.hour === null;
  auto.append(autoBox, " авто (часы мира)");
  box.appendChild(auto);

  const hourRow = document.createElement("div");
  hourRow.className = "r";
  const hourLab = document.createElement("label");
  hourLab.textContent = "час";
  const hourInp = document.createElement("input");
  hourInp.type = "range";
  hourInp.min = "0";
  hourInp.max = "23.9";
  hourInp.step = "0.1";
  hourInp.value = String(TIME_OVERRIDE.hour ?? 12);
  const hourVal = document.createElement("span");
  hourVal.className = "v";
  hourVal.textContent = (TIME_OVERRIDE.hour ?? 12).toFixed(1);
  hourRow.append(hourLab, hourInp, hourVal);
  box.appendChild(hourRow);

  const presets = document.createElement("div");
  for (const [name, h] of PRESETS) {
    const b = document.createElement("button");
    b.textContent = name;
    b.onclick = () => {
      autoBox.checked = false;
      hourInp.value = String(h);
      TIME_OVERRIDE.hour = h;
      hourVal.textContent = h.toFixed(1);
      notifyLightTune();
      refreshOut();
    };
    presets.appendChild(b);
  }
  box.appendChild(presets);

  const applyHour = (): void => {
    TIME_OVERRIDE.hour = autoBox.checked ? null : Number(hourInp.value);
    hourVal.textContent = Number(hourInp.value).toFixed(1);
    notifyLightTune();
    refreshOut();
  };
  autoBox.onchange = applyHour;
  hourInp.oninput = () => {
    autoBox.checked = false;
    applyHour();
  };

  // ---- множители
  const sliders: { key: keyof LightTune; inp: HTMLInputElement; val: HTMLSpanElement }[] = [];
  for (const g of GROUPS) {
    const h = document.createElement("h4");
    h.textContent = g.title;
    box.appendChild(h);
    for (const s of g.items) {
      const row = document.createElement("div");
      row.className = "r";
      const lab = document.createElement("label");
      lab.textContent = s.label;
      const inp = document.createElement("input");
      inp.type = "range";
      inp.min = "0";
      inp.max = "3";
      inp.step = "0.05";
      inp.value = String(LIGHT_TUNE[s.key]);
      const val = document.createElement("span");
      val.className = "v";
      val.textContent = fmt(LIGHT_TUNE[s.key]);
      inp.oninput = () => {
        LIGHT_TUNE[s.key] = Number(inp.value);
        val.textContent = fmt(LIGHT_TUNE[s.key]);
        saveLightTune();
        notifyLightTune();
        refreshOut();
      };
      row.append(lab, inp, val);
      box.appendChild(row);
      sliders.push({ key: s.key, inp, val });
    }
  }

  // ---- кнопки и вывод
  const reset = document.createElement("button");
  reset.textContent = "Сбросить всё";
  reset.onclick = () => {
    for (const s of sliders) {
      LIGHT_TUNE[s.key] = 1;
      s.inp.value = "1";
      s.val.textContent = "1.00";
    }
    autoBox.checked = true;
    applyHour();
    saveLightTune();
    notifyLightTune();
    refreshOut();
  };
  const copy = document.createElement("button");
  copy.textContent = "Скопировать";
  copy.onclick = () => {
    out.select();
    void navigator.clipboard?.writeText(out.value).catch(() => document.execCommand("copy"));
  };
  box.append(reset, copy, out);

  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = "Сохраняется в браузере. В обычной игре — всё 1.00 и часы мира.";
  box.appendChild(hint);
  refreshOut();

  // Сцена появится позже, чем панель: подключаем, как только игра её создала.
  let detach: (() => void) | null = null;
  const poll = window.setInterval(() => {
    const sc = (window as unknown as { game?: { scene?: Scene } }).game?.scene;
    if (!sc) return;
    window.clearInterval(poll);
    detach = attachLightTune(sc);
    notifyLightTune();
  }, 300);

  return () => {
    window.clearInterval(poll);
    detach?.();
    box.remove();
    style.remove();
  };
}
