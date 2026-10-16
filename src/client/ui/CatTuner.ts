/**
 * Панель живой настройки катакомб: `?cattune=1`.
 *
 * Стены (яркость камня залов), нормали (глубина рельефа) и тень героев/мобов. Панель двигает
 * catTune, и катакомбы подстраиваются сразу (Catacombs.applyTune). Подобранное лежит в localStorage
 * и показывается готовой строкой для CAT_TUNE_DEFAULT (world/catTune.ts) — в прод уходят числа из исходника.
 */
import { CAT_TUNE_DEFAULT, catTune, loadCatTune, notifyCatTuneChanged, saveCatTune } from "../world/catTune";

const CSS = `
#ctTuner{position:fixed;top:8px;right:8px;z-index:9999;width:270px;max-height:92vh;
overflow:auto;background:rgba(16,18,24,.92);color:#e7e9ee;font:12px/1.35 ui-monospace,monospace;
padding:10px;border-radius:8px;border:1px solid #3a4050;user-select:none}
#ctTuner h4{margin:0 0 6px;font-size:12px;letter-spacing:.04em;color:#9fd3ff}
#ctTuner .r{display:flex;align-items:center;gap:6px;margin:3px 0}
#ctTuner .r label{width:58px;color:#9aa3b2}
#ctTuner input[type=range]{flex:1;min-width:0}
#ctTuner .v{width:58px;text-align:right;color:#ffd48a}
#ctTuner .sec{margin-top:8px;padding-top:6px;border-top:1px solid #2c3140}
#ctTuner button{background:#2b3242;color:#e7e9ee;border:1px solid #454d60;border-radius:5px;
padding:4px 8px;font:11px ui-monospace,monospace;cursor:pointer;margin-right:5px}
#ctTuner button:hover{background:#39425a}
#ctTuner textarea{width:100%;height:70px;margin-top:6px;background:#0f1219;color:#b8e6a0;
border:1px solid #2c3140;border-radius:5px;font:10px/1.3 ui-monospace,monospace;resize:vertical}
#ctTuner .hint{color:#7f8798;margin-top:6px}
`;

type Key = keyof typeof catTune;

/** Ползунки: подпись, поле, границы и шаг. */
const ROWS: { key: Key; label: string; min: number; max: number; step: number }[] = [
  { key: "wall", label: "Стены", min: 0.1, max: 1.5, step: 0.01 },
  { key: "bump", label: "Нормали", min: 0, max: 3, step: 0.05 },
  { key: "shadow", label: "Тень", min: 0, max: 1, step: 0.01 },
];

export function mountCatTuner(): () => void {
  loadCatTune();
  notifyCatTuneChanged();

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const box = document.createElement("div");
  box.id = "ctTuner";
  document.body.appendChild(box);
  // Колесо и клики не уходят в игру: панель поверх канваса.
  for (const ev of ["wheel", "pointerdown", "keydown"] as const) {
    box.addEventListener(ev, (e) => e.stopPropagation());
  }

  const title = document.createElement("h4");
  title.textContent = "КАТАКОМБЫ (?cattune=1)";
  box.appendChild(title);

  const vals: Record<Key, HTMLSpanElement> = { wall: document.createElement("span"), bump: document.createElement("span"), shadow: document.createElement("span") };
  const inputs: Partial<Record<Key, HTMLInputElement>> = {};
  for (const row of ROWS) {
    const r = document.createElement("div");
    r.className = "r";
    const l = document.createElement("label");
    l.textContent = row.label;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(row.min);
    input.max = String(row.max);
    input.step = String(row.step);
    input.value = String(catTune[row.key]);
    const v = vals[row.key];
    v.className = "v";
    input.addEventListener("input", () => {
      catTune[row.key] = Number(input.value);
      changed();
    });
    inputs[row.key] = input;
    r.append(l, input, v);
    box.appendChild(r);
  }

  const sec = document.createElement("div");
  sec.className = "sec";
  box.appendChild(sec);

  const readout = document.createElement("div");
  readout.style.color = "#c9d3e6";
  sec.appendChild(readout);

  const out = document.createElement("textarea");
  out.readOnly = true;

  const codeLine = (): string =>
    `export const CAT_TUNE_DEFAULT = { wall: ${catTune.wall.toFixed(2)}, bump: ${catTune.bump.toFixed(2)}, shadow: ${catTune.shadow.toFixed(2)} } as const;`;

  // Перерисовать подписи, сохранить и применить в катакомбах.
  const changed = (): void => {
    for (const row of ROWS) vals[row.key].textContent = catTune[row.key].toFixed(2);
    readout.textContent = `стены ×${catTune.wall.toFixed(2)} · нормали ×${catTune.bump.toFixed(2)} · тень ${catTune.shadow.toFixed(2)}`;
    out.value = codeLine();
    saveCatTune();
    notifyCatTuneChanged();
  };

  const buttons = document.createElement("div");
  buttons.style.marginTop = "6px";
  const reset = document.createElement("button");
  reset.textContent = "Сброс";
  reset.addEventListener("click", () => {
    for (const row of ROWS) {
      catTune[row.key] = CAT_TUNE_DEFAULT[row.key];
      const input = inputs[row.key];
      if (input) input.value = String(CAT_TUNE_DEFAULT[row.key]);
    }
    changed();
  });
  const copy = document.createElement("button");
  copy.textContent = "Копировать код";
  copy.addEventListener("click", () => {
    out.value = codeLine();
    out.select();
    void navigator.clipboard?.writeText(codeLine()).catch(() => undefined);
  });
  buttons.append(reset, copy);
  sec.append(buttons, out);

  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = "Стены — яркость камня залов; нормали — глубина рельефа; тень — пятна под героями и мобами в катакомбах.";
  sec.appendChild(hint);

  changed();

  return () => {
    box.remove();
    style.remove();
  };
}
