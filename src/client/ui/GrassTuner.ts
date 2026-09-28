/**
 * Панель живой настройки травы: `?grasstune=1` (игра или спектатор).
 *
 * Ближняя трава — ручки LOADOUT.glow (те же, что в админ-панели «Солнце/
 * свечение»), дальняя (упрощённые картинки) — GRASS_FAR_TUNE. Всё
 * применяется на лету и запоминается в этом браузере; внизу — готовые числа,
 * их присылаешь Claude, он вписывает их в код как значения по умолчанию.
 */
import { LOADOUT } from "../config/loadout";
import { GRASS_FAR_TUNE, saveGrassFarTune } from "../world/GrassField";
import { TIME_OVERRIDE } from "../world/Zone";
import { daylightAt } from "../world/DayTime";

const NEAR_KEY = "grassNearTune2";
const NEAR_KEYS = ["grassSunDay", "grassGlowDay", "grassSunNight", "grassGlowNight"] as const;
type NearKey = (typeof NEAR_KEYS)[number];

const CSS = `
#grassTuner{position:fixed;top:8px;right:8px;z-index:9999;width:270px;max-height:calc(100% - 16px);overflow:auto;
background:rgba(16,18,24,.93);color:#e7e9ee;font:12px/1.35 ui-monospace,monospace;
padding:10px;border-radius:8px;border:1px solid #3a4050;user-select:none}
#grassTuner h4{margin:8px 0 4px;font-size:11px;letter-spacing:.04em;color:#9fd3ff}
#grassTuner h4:first-child{margin-top:0}
#grassTuner .r{display:flex;align-items:center;gap:6px;margin:3px 0}
#grassTuner .r label{width:96px;color:#9aa3b2}
#grassTuner input[type=range]{flex:1;min-width:0}
#grassTuner .v{width:40px;text-align:right;color:#ffd48a}
#grassTuner textarea{width:100%;height:92px;margin-top:6px;background:#0f1219;color:#b8e6a0;
border:1px solid #2c3140;border-radius:5px;font:10px/1.3 ui-monospace,monospace;resize:vertical}
#grassTuner button{background:#2b3242;color:#e7e9ee;border:1px solid #454d60;border-radius:5px;
padding:4px 8px;font:11px ui-monospace,monospace;cursor:pointer;margin:6px 5px 0 0}
#grassTuner .hint{color:#7f8798;margin-top:4px}
`;

export function mountGrassTuner(): void {
  const g = LOADOUT.glow as unknown as Record<NearKey, number>;
  try {
    const saved = JSON.parse(localStorage.getItem(NEAR_KEY) ?? "null") as Partial<Record<NearKey, number>> | null;
    if (saved) for (const k of NEAR_KEYS) if (typeof saved[k] === "number") g[k] = saved[k]!;
  } catch {
    /* нет сохранённого */
  }

  // Общая подгонка с сервера приходит ПОСЛЕ входа и перезаписала бы ручки —
  // держим свои значения поверх неё, пока открыта панель.
  const mine = Object.fromEntries(NEAR_KEYS.map((k) => [k, g[k]])) as Record<NearKey, number>;
  setInterval(() => {
    for (const k of NEAR_KEYS) g[k] = mine[k];
  }, 500);

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  const box = document.createElement("div");
  box.id = "grassTuner";
  document.body.appendChild(box);
  for (const ev of ["wheel", "pointerdown", "keydown"] as const) box.addEventListener(ev, (e) => e.stopPropagation());

  const out = document.createElement("textarea");
  out.readOnly = true;
  const dump = (): void => {
    const f = GRASS_FAR_TUNE;
    out.value =
      `ближняя: ${NEAR_KEYS.map((k) => `${k} ${g[k].toFixed(2)}`).join(", ")}\n` +
      `дальняя: lit ${f.lit.toFixed(2)}, sunDay ${f.sunDay.toFixed(2)}, glowDay ${f.glowDay.toFixed(2)}, ` +
      `sunNight ${f.sunNight.toFixed(2)}, glowNight ${f.glowNight.toFixed(2)}, ` +
      `width ${f.width.toFixed(2)}, height ${f.height.toFixed(2)}, lod ${f.lod}, warm ${f.warm.toFixed(2)}`;
  };
  const saveNear = (): void => {
    try {
      localStorage.setItem(NEAR_KEY, JSON.stringify(Object.fromEntries(NEAR_KEYS.map((k) => [k, g[k]]))));
    } catch {
      /* приватный режим */
    }
  };

  const head = (t: string): void => {
    const h = document.createElement("h4");
    h.textContent = t;
    box.appendChild(h);
  };
  const slider = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void): void => {
    const line = document.createElement("div");
    line.className = "r";
    const lb = document.createElement("label");
    lb.textContent = label;
    const input = document.createElement("input");
    Object.assign(input, { type: "range", min: String(min), max: String(max), step: String(step), value: String(get()) });
    const v = document.createElement("span");
    v.className = "v";
    v.textContent = get().toFixed(2);
    input.oninput = () => {
      set(Number(input.value));
      v.textContent = Number(input.value).toFixed(2);
      dump();
    };
    line.append(lb, input, v);
    box.appendChild(line);
  };

  head("ВРЕМЯ СУТОК (только у тебя)");
  const tNote = document.createElement("div");
  tNote.className = "hint";
  const timeInfo = (): void => {
    const h = TIME_OVERRIDE.hour;
    tNote.textContent =
      h === null
        ? "Часы игры. Утром/вечером ручки смешиваются (кроме свечения дальней: ночное — только в темноте) — настраивай день в 12:00, ночь в 0:00."
        : `Держу ${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, "0")} · день ${Math.round(daylightAt(h) * 100)}% / ночь ${Math.round((1 - daylightAt(h)) * 100)}%`;
  };
  const presets = document.createElement("div");
  for (const [label, h] of [["Игра", null], ["День 12:00", 12], ["Вечер 18:00", 18], ["Ночь 0:00", 0]] as const) {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = () => {
      TIME_OVERRIDE.hour = h;
      timeInfo();
    };
    presets.appendChild(b);
  }
  box.appendChild(presets);
  slider("Час", 0, 23.9, 0.1, () => TIME_OVERRIDE.hour ?? 12, (x) => {
    TIME_OVERRIDE.hour = x;
    timeInfo();
  });
  box.appendChild(tNote);
  timeInfo();

  head("БЛИЖНЯЯ ТРАВА (модели)");
  const near = (label: string, k: NearKey): void =>
    slider(label, 0, 3, 0.01, () => g[k], (x) => {
      g[k] = x;
      mine[k] = x;
      saveNear();
    });
  near("Солнце днём", "grassSunDay");
  near("Свечение днём", "grassGlowDay");
  near("Солнце ночью", "grassSunNight");
  near("Свечение ночью", "grassGlowNight");

  head("ДАЛЬНЯЯ ТРАВА (картинки)");
  const f = GRASS_FAR_TUNE as unknown as Record<string, number>;
  const far = (label: string, k: string, min: number, max: number, step: number): void =>
    slider(label, min, max, step, () => f[k], (x) => {
      f[k] = x;
      saveGrassFarTune();
    });
  far("Яркость", "lit", 0.1, 2, 0.01);
  far("Солнце днём", "sunDay", 0, 3, 0.01);
  far("Свечение днём", "glowDay", 0, 3, 0.01);
  far("Солнце ночью", "sunNight", 0, 3, 0.01);
  far("Свечение ночью", "glowNight", 0, 3, 0.01);
  far("Ширина", "width", 0.5, 3, 0.01);
  far("Высота", "height", 0.4, 2, 0.01);
  far("С дистанции, м", "lod", 6, 40, 1);
  far("Желтизна", "warm", 0, 1, 0.01);

  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = "Подобрал — скопируй текст ниже и пришли Claude. Настройки запоминаются в этом браузере.";
  box.appendChild(hint);
  box.appendChild(out);
  const copy = document.createElement("button");
  copy.textContent = "📋 Скопировать";
  copy.onclick = () => void navigator.clipboard?.writeText(out.value);
  const reset = document.createElement("button");
  reset.textContent = "Сброс";
  reset.onclick = () => {
    localStorage.removeItem(NEAR_KEY);
    localStorage.removeItem("grassFarTune3");
    location.reload();
  };
  box.append(copy, reset);
  dump();
}
