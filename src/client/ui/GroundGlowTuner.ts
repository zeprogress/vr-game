/**
 * Панель живой настройки пятна светлячков на земле: `?groundglow=1`.
 *
 * Цвет/яркость/радиус/высоту подбирали вслепую циклом правка → деплой →
 * зайти в игру ночью — слишком долго на каждую мелочь. Панель двигает
 * GROUND_GLOW_TUNE прямо во время игры, Fireflies сама подписана на
 * изменения и перекрашивает/пересчитывает пятна сразу (см. groundGlowTune.ts).
 *
 * Подобранное лежит в localStorage (переживает F5) и показывается готовым
 * куском кода — его достаточно вписать в Fireflies.ts (FIREFLY.groundGlow*
 * / groundGlowTune.ts), чтобы уехало в прод.
 */
import {
  GROUND_GLOW_TUNE,
  loadGroundGlowTune,
  saveGroundGlowTune,
  notifyGroundGlowTuneChanged,
} from "../world/groundGlowTune";

const CSS = `
#ggTuner{position:fixed;top:8px;right:8px;z-index:9999;width:260px;max-height:92vh;
overflow:auto;background:rgba(16,18,24,.92);color:#e7e9ee;font:12px/1.35 ui-monospace,monospace;
padding:10px;border-radius:8px;border:1px solid #3a4050;user-select:none}
#ggTuner h4{margin:0 0 6px;font-size:12px;letter-spacing:.04em;color:#9fd3ff}
#ggTuner .r{display:flex;align-items:center;gap:6px;margin:3px 0}
#ggTuner .r label{width:54px;color:#9aa3b2}
#ggTuner input[type=range]{flex:1;min-width:0}
#ggTuner .v{width:52px;text-align:right;color:#ffd48a}
#ggTuner .sec{margin-top:8px;padding-top:6px;border-top:1px solid #2c3140}
#ggTuner button{background:#2b3242;color:#e7e9ee;border:1px solid #454d60;border-radius:5px;
padding:4px 8px;font:11px ui-monospace,monospace;cursor:pointer;margin-right:5px}
#ggTuner button:hover{background:#39425a}
#ggTuner textarea{width:100%;height:70px;margin-top:6px;background:#0f1219;color:#b8e6a0;
border:1px solid #2c3140;border-radius:5px;font:10px/1.3 ui-monospace,monospace;resize:vertical}
#ggTuner .hint{color:#7f8798;margin-top:6px}
#ggTuner .swatch{width:20px;height:20px;border-radius:4px;border:1px solid #454d60;flex:none}
`;

export function mountGroundGlowTuner(): () => void {
  loadGroundGlowTune();
  notifyGroundGlowTuneChanged();

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const box = document.createElement("div");
  box.id = "ggTuner";
  document.body.appendChild(box);

  // Колесо и клики не должны улетать в игру: панель поверх канваса.
  for (const ev of ["wheel", "pointerdown", "keydown"] as const) {
    box.addEventListener(ev, (e) => e.stopPropagation());
  }

  const fmt = (n: number): string => (Math.abs(n) < 0.0005 ? "0" : n.toFixed(3));
  const dump = (): string => {
    const [r, g, b] = GROUND_GLOW_TUNE.color;
    return (
      `groundGlowColor: [${fmt(r)}, ${fmt(g)}, ${fmt(b)}],\n` +
      `groundGlowAlpha: ${fmt(GROUND_GLOW_TUNE.alpha)},\n` +
      `groundGlowRadius: ${fmt(GROUND_GLOW_TUNE.radius)},\n` +
      `groundGlowHeight: ${fmt(GROUND_GLOW_TUNE.height)},`
    );
  };

  const swatch = document.createElement("div");
  swatch.className = "swatch";

  const out = document.createElement("textarea");
  out.readOnly = true;

  const apply = (): void => {
    saveGroundGlowTune();
    notifyGroundGlowTuneChanged();
    const [r, g, b] = GROUND_GLOW_TUNE.color;
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
    input.step = "any"; // иначе значение снапится к сетке и подобранное сползает
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
  title.textContent = "ПЯТНО СВЕТЛЯЧКОВ (?groundglow=1)";
  box.appendChild(title);

  const swatchRow = document.createElement("div");
  swatchRow.className = "r";
  const swatchLabel = document.createElement("label");
  swatchLabel.textContent = "цвет";
  swatchRow.append(swatchLabel, swatch);
  box.appendChild(swatchRow);

  slider(
    "R",
    0,
    1,
    () => GROUND_GLOW_TUNE.color[0],
    (v) => (GROUND_GLOW_TUNE.color[0] = v),
  );
  slider(
    "G",
    0,
    1,
    () => GROUND_GLOW_TUNE.color[1],
    (v) => (GROUND_GLOW_TUNE.color[1] = v),
  );
  slider(
    "B",
    0,
    1,
    () => GROUND_GLOW_TUNE.color[2],
    (v) => (GROUND_GLOW_TUNE.color[2] = v),
  );

  const sec = document.createElement("h4");
  sec.className = "sec";
  sec.textContent = "яркость / размер";
  box.appendChild(sec);

  slider(
    "альфа",
    0,
    1,
    () => GROUND_GLOW_TUNE.alpha,
    (v) => (GROUND_GLOW_TUNE.alpha = v),
  );
  slider(
    "радиус",
    0.5,
    15,
    () => GROUND_GLOW_TUNE.radius,
    (v) => (GROUND_GLOW_TUNE.radius = v),
  );
  slider(
    "высота",
    -1,
    3,
    () => GROUND_GLOW_TUNE.height,
    (v) => (GROUND_GLOW_TUNE.height = v),
  );

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
    localStorage.removeItem("zep.groundglow");
    location.reload();
  });
  btns.append(copy, reset);
  box.appendChild(btns);
  box.appendChild(out);

  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent =
    "Применяется сразу (нужна ночь, чтобы увидеть — время можно перевести с пульта). " +
    "Переживает F5. Готовое — в Fireflies.ts (FIREFLY.groundGlowRadius) и groundGlowTune.ts.";
  box.appendChild(hint);

  apply();

  return () => {
    box.remove();
    style.remove();
  };
}
