/**
 * Панель живой настройки освещения: `?light=1`.
 *
 * Ползунки меняют множители из world/lightTune.ts: солнце (сразу) и ночные факелы (каждый кадр).
 * Подобранное сохраняется в localStorage и показывается готовой строкой для вставки в код.
 */
import { LIGHT_TUNE, loadLightTune, notifyLightTune, saveLightTune } from "../world/lightTune";

const CSS = `
#lightTuner{position:fixed;top:8px;right:8px;z-index:9999;width:250px;
background:rgba(16,18,24,.92);color:#e7e9ee;font:12px/1.35 ui-monospace,monospace;
padding:10px;border-radius:8px;border:1px solid #3a4050;user-select:none}
#lightTuner h4{margin:0 0 6px;font-size:12px;letter-spacing:.04em;color:#ffd48a}
#lightTuner .r{display:flex;align-items:center;gap:6px;margin:3px 0}
#lightTuner .r label{width:72px;color:#9aa3b2}
#lightTuner input[type=range]{flex:1;min-width:0}
#lightTuner .v{width:44px;text-align:right;color:#ffd48a}
#lightTuner button{background:#2b3242;color:#e7e9ee;border:1px solid #454d60;border-radius:5px;
padding:4px 8px;font:11px ui-monospace,monospace;cursor:pointer;margin-top:6px}
#lightTuner button:hover{background:#39425a}
#lightTuner textarea{width:100%;height:44px;margin-top:6px;background:#0f1219;color:#b8e6a0;
border:1px solid #2c3140;border-radius:5px;font:10px/1.3 ui-monospace,monospace;resize:vertical}
#lightTuner .hint{color:#7f8798;margin-top:6px}
`;

const SLIDERS: { key: keyof typeof LIGHT_TUNE; label: string }[] = [
  { key: "sunMul", label: "солнце ×" },
  { key: "torchMul", label: "факелы ×" },
];

export function mountLightTuner(): () => void {
  loadLightTune();

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const box = document.createElement("div");
  box.id = "lightTuner";
  box.innerHTML = `<h4>Освещение</h4>`;
  document.body.appendChild(box);

  const out = document.createElement("textarea");
  out.readOnly = true;
  const text = (): string => `sunMul: ${LIGHT_TUNE.sunMul.toFixed(2)}, torchMul: ${LIGHT_TUNE.torchMul.toFixed(2)}`;

  for (const s of SLIDERS) {
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
    val.textContent = LIGHT_TUNE[s.key].toFixed(2);
    inp.oninput = () => {
      LIGHT_TUNE[s.key] = Number(inp.value);
      val.textContent = LIGHT_TUNE[s.key].toFixed(2);
      saveLightTune();
      notifyLightTune();
      out.value = text();
    };
    row.append(lab, inp, val);
    box.appendChild(row);
  }

  const reset = document.createElement("button");
  reset.textContent = "Сбросить";
  reset.onclick = () => {
    for (const s of SLIDERS) LIGHT_TUNE[s.key] = 1;
    saveLightTune();
    notifyLightTune();
    box.querySelectorAll<HTMLInputElement>("input[type=range]").forEach((i) => (i.value = "1"));
    box.querySelectorAll<HTMLSpanElement>(".v").forEach((v) => (v.textContent = "1.00"));
    out.value = text();
  };
  const copy = document.createElement("button");
  copy.textContent = "Скопировать";
  copy.onclick = () => {
    out.select();
    void navigator.clipboard?.writeText(out.value).catch(() => document.execCommand("copy"));
  };
  box.append(reset, copy, out);
  out.value = text();

  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = "Значения сохраняются в браузере. В обычной игре — 1.00.";
  box.appendChild(hint);

  return () => {
    box.remove();
    style.remove();
  };
}
