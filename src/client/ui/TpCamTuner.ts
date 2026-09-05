/**
 * Панель живой настройки камеры от третьего лица: `?tpcam=1`.
 *
 * Меняет объект TP_CAM_TUNE, который ThirdPersonCam/PlayerController читают
 * каждый кадр — подписка не нужна. Подобранное лежит в localStorage
 * (переживает F5) и показывается готовым куском для вставки в tpCamTune.ts.
 */
import { TP_CAM_TUNE, loadTpCamTune, saveTpCamTune } from "../player/tpCamTune";

const CSS = `
#tpCamTuner{position:fixed;top:8px;left:8px;z-index:9999;width:250px;
background:rgba(16,18,24,.92);color:#e7e9ee;font:12px/1.35 ui-monospace,monospace;
padding:10px;border-radius:8px;border:1px solid #3a4050;user-select:none}
#tpCamTuner h4{margin:0 0 6px;font-size:12px;letter-spacing:.04em;color:#9fd3ff}
#tpCamTuner .r{display:flex;align-items:center;gap:6px;margin:3px 0}
#tpCamTuner .r label{width:74px;color:#9aa3b2}
#tpCamTuner input[type=range]{flex:1;min-width:0}
#tpCamTuner .v{width:46px;text-align:right;color:#ffd48a}
#tpCamTuner .sec{margin-top:8px;padding-top:6px;border-top:1px solid #2c3140}
#tpCamTuner button{background:#2b3242;color:#e7e9ee;border:1px solid #454d60;border-radius:5px;
padding:4px 8px;font:11px ui-monospace,monospace;cursor:pointer;margin-right:5px}
#tpCamTuner button:hover{background:#39425a}
#tpCamTuner textarea{width:100%;height:92px;margin-top:6px;background:#0f1219;color:#b8e6a0;
border:1px solid #2c3140;border-radius:5px;font:10px/1.3 ui-monospace,monospace;resize:vertical}
#tpCamTuner .hint{color:#7f8798;margin-top:6px}
`;

export function mountTpCamTuner(): () => void {
  loadTpCamTune();

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const box = document.createElement("div");
  box.id = "tpCamTuner";
  document.body.appendChild(box);

  for (const ev of ["wheel", "pointerdown", "keydown"] as const) {
    box.addEventListener(ev, (e) => e.stopPropagation());
  }

  const fmt = (n: number): string => (Math.abs(n) < 0.0005 ? "0" : n.toFixed(2));
  const dump = (): string =>
    (Object.keys(TP_CAM_TUNE) as (keyof typeof TP_CAM_TUNE)[])
      .map((k) => `  ${k}: ${fmt(TP_CAM_TUNE[k])},`)
      .join("\n");

  const out = document.createElement("textarea");
  out.readOnly = true;
  const apply = (): void => {
    saveTpCamTune();
    out.value = dump();
  };

  const slider = (
    label: string,
    min: number,
    max: number,
    key: keyof typeof TP_CAM_TUNE,
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
    input.value = String(TP_CAM_TUNE[key]);
    const view = document.createElement("span");
    view.className = "v";
    view.textContent = fmt(TP_CAM_TUNE[key]);
    input.addEventListener("input", () => {
      const v = Number(input.value);
      TP_CAM_TUNE[key] = v;
      view.textContent = fmt(v);
      apply();
    });
    line.append(lb, input, view);
    box.appendChild(line);
  };

  const title = document.createElement("h4");
  title.textContent = "КАМЕРА 3-ЛИЦА (?tpcam=1)";
  box.appendChild(title);

  const section = (text: string): void => {
    const h = document.createElement("h4");
    h.className = "sec";
    h.textContent = text;
    box.appendChild(h);
  };

  section("посадка");
  slider("удочка, м", 1.5, 11, "dist");
  slider("высота, м", 0.6, 2.6, "pivotUp");
  slider("зазор пол", 0.05, 1.5, "floorClear");
  slider("зум мин", 1.5, 6, "distMin");
  slider("зум макс", 5, 14, "distMax");

  section("наклон, рад (>0 ниже/вверх, <0 выше/вниз)");
  slider("старт", -1.2, 1.2, "pitchStart");
  slider("мин", -1.4, 0.2, "pitchMin");
  slider("макс", -0.2, 1.5, "pitchMax");

  section("отклик");
  slider("доворот", 0, 24, "turnRate");
  slider("догон кам.", 0, 6, "followRate");
  slider("чувств.", 0, 2.5, "lookSens");

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
    localStorage.removeItem("zep.tpcam");
    location.reload();
  });
  btns.append(copy, reset);
  box.appendChild(btns);
  box.appendChild(out);

  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = "Только смартфон. Переживает F5. Готовое — в tpCamTune.ts.";
  box.appendChild(hint);

  apply();

  return () => {
    box.remove();
    style.remove();
  };
}
