/**
 * Панель живой настройки ночного тумана: `?fog=1`.
 *
 * Цвет, в который EXP2-туман уводит даль ночью (синеватый по умолчанию
 * читался дымкой, хотели черноту), и множитель плотности. Читается
 * DayTime/Sky каждый кадр — подписка не нужна, панель просто меняет объект.
 *
 * Подобранное лежит в localStorage (переживает F5) и показывается готовым
 * куском кода для вставки в fogTune.ts.
 */
import { FOG_TUNE, loadFogTune, saveFogTune } from "../world/fogTune";

const CSS = `
#fogTuner{position:fixed;top:8px;right:8px;z-index:9999;width:250px;
background:rgba(16,18,24,.92);color:#e7e9ee;font:12px/1.35 ui-monospace,monospace;
padding:10px;border-radius:8px;border:1px solid #3a4050;user-select:none}
#fogTuner h4{margin:0 0 6px;font-size:12px;letter-spacing:.04em;color:#9fd3ff}
#fogTuner .r{display:flex;align-items:center;gap:6px;margin:3px 0}
#fogTuner .r label{width:54px;color:#9aa3b2}
#fogTuner input[type=range]{flex:1;min-width:0}
#fogTuner .v{width:52px;text-align:right;color:#ffd48a}
#fogTuner .sec{margin-top:8px;padding-top:6px;border-top:1px solid #2c3140}
#fogTuner button{background:#2b3242;color:#e7e9ee;border:1px solid #454d60;border-radius:5px;
padding:4px 8px;font:11px ui-monospace,monospace;cursor:pointer;margin-right:5px}
#fogTuner button:hover{background:#39425a}
#fogTuner textarea{width:100%;height:56px;margin-top:6px;background:#0f1219;color:#b8e6a0;
border:1px solid #2c3140;border-radius:5px;font:10px/1.3 ui-monospace,monospace;resize:vertical}
#fogTuner .hint{color:#7f8798;margin-top:6px}
#fogTuner .swatch{width:20px;height:20px;border-radius:4px;border:1px solid #454d60;flex:none}
`;

export function mountFogTuner(): () => void {
  loadFogTune();

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const box = document.createElement("div");
  box.id = "fogTuner";
  document.body.appendChild(box);

  for (const ev of ["wheel", "pointerdown", "keydown"] as const) {
    box.addEventListener(ev, (e) => e.stopPropagation());
  }

  const fmt = (n: number): string => (Math.abs(n) < 0.0005 ? "0" : n.toFixed(3));
  const dump = (): string => {
    const [r, g, b] = FOG_TUNE.nightColor;
    return `nightColor: [${fmt(r)}, ${fmt(g)}, ${fmt(b)}],\ndensity: ${fmt(FOG_TUNE.density)},`;
  };

  const swatch = document.createElement("div");
  swatch.className = "swatch";
  const out = document.createElement("textarea");
  out.readOnly = true;

  const apply = (): void => {
    saveFogTune();
    const [r, g, b] = FOG_TUNE.nightColor;
    swatch.style.background = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
    out.value = dump();
  };

  const slider = (
    label: string,
    min: number,
    max: number,
    get: () => number,
    set: (v: number) => void,
  ): void => {
    const line = document.createElement("div");
    line.className = "r";
    const lb = document.createElement("label");
    lb.textContent = label;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = "any";
    input.value = String(get());
    const view = document.createElement("span");
    view.className = "v";
    view.textContent = fmt(get());
    input.addEventListener("input", () => {
      const v = Number(input.value);
      set(v);
      view.textContent = fmt(v);
      apply();
    });
    line.append(lb, input, view);
    box.appendChild(line);
  };

  const title = document.createElement("h4");
  title.textContent = "НОЧНОЙ ТУМАН (?fog=1)";
  box.appendChild(title);

  const swRow = document.createElement("div");
  swRow.className = "r";
  const swLabel = document.createElement("label");
  swLabel.textContent = "цвет";
  swRow.append(swLabel, swatch);
  box.appendChild(swRow);

  slider("R", 0, 0.5, () => FOG_TUNE.nightColor[0], (v) => (FOG_TUNE.nightColor[0] = v));
  slider("G", 0, 0.5, () => FOG_TUNE.nightColor[1], (v) => (FOG_TUNE.nightColor[1] = v));
  slider("B", 0, 0.5, () => FOG_TUNE.nightColor[2], (v) => (FOG_TUNE.nightColor[2] = v));

  const sec = document.createElement("h4");
  sec.className = "sec";
  sec.textContent = "плотность";
  box.appendChild(sec);
  slider("×", 0, 4, () => FOG_TUNE.density, (v) => (FOG_TUNE.density = v));

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
    localStorage.removeItem("zep.fog");
    location.reload();
  });
  btns.append(copy, reset);
  box.appendChild(btns);
  box.appendChild(out);

  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = "Нужна ночь (время — с пульта). Переживает F5. Готовое — в fogTune.ts.";
  box.appendChild(hint);

  apply();

  return () => {
    box.remove();
    style.remove();
  };
}
