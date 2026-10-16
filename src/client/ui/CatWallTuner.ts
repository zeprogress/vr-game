/**
 * Панель живой настройки затемнения стен катакомб: `?catwall=1`.
 *
 * Двигает catWallTune.mul — стены залов перекрашиваются сразу (Catacombs.paintThemes).
 * Подобранное лежит в localStorage и показывается готовой строкой для CAT_WALL_DEFAULT_MUL
 * (world/catWallTune.ts) — в прод уходит число из исходника.
 */
import { CAT_WALL_DEFAULT_MUL, catWallTune, loadCatWallTune, notifyCatWallTuneChanged, saveCatWallTune } from "../world/catWallTune";

const CSS = `
#cwTuner{position:fixed;top:8px;right:8px;z-index:9999;width:270px;max-height:92vh;
overflow:auto;background:rgba(16,18,24,.92);color:#e7e9ee;font:12px/1.35 ui-monospace,monospace;
padding:10px;border-radius:8px;border:1px solid #3a4050;user-select:none}
#cwTuner h4{margin:0 0 6px;font-size:12px;letter-spacing:.04em;color:#9fd3ff}
#cwTuner .r{display:flex;align-items:center;gap:6px;margin:3px 0}
#cwTuner .r label{width:58px;color:#9aa3b2}
#cwTuner input[type=range]{flex:1;min-width:0}
#cwTuner .v{width:58px;text-align:right;color:#ffd48a}
#cwTuner .sec{margin-top:8px;padding-top:6px;border-top:1px solid #2c3140}
#cwTuner button{background:#2b3242;color:#e7e9ee;border:1px solid #454d60;border-radius:5px;
padding:4px 8px;font:11px ui-monospace,monospace;cursor:pointer;margin-right:5px}
#cwTuner button:hover{background:#39425a}
#cwTuner textarea{width:100%;height:70px;margin-top:6px;background:#0f1219;color:#b8e6a0;
border:1px solid #2c3140;border-radius:5px;font:10px/1.3 ui-monospace,monospace;resize:vertical}
#cwTuner .hint{color:#7f8798;margin-top:6px}
`;

export function mountCatWallTuner(): () => void {
  loadCatWallTune();
  notifyCatWallTuneChanged();

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const box = document.createElement("div");
  box.id = "cwTuner";
  document.body.appendChild(box);
  // Колесо и клики не уходят в игру: панель поверх канваса.
  for (const ev of ["wheel", "pointerdown", "keydown"] as const) {
    box.addEventListener(ev, (e) => e.stopPropagation());
  }

  const title = document.createElement("h4");
  title.textContent = "СТЕНЫ КАТАКОМБ (?catwall=1)";
  box.appendChild(title);

  const r = document.createElement("div");
  r.className = "r";
  const l = document.createElement("label");
  l.textContent = "Яркость";
  const input = document.createElement("input");
  input.type = "range";
  input.min = "0.1";
  input.max = "1";
  input.step = "0.01";
  input.value = String(catWallTune.mul);
  const val = document.createElement("span");
  val.className = "v";
  r.append(l, input, val);
  box.appendChild(r);

  const sec = document.createElement("div");
  sec.className = "sec";
  box.appendChild(sec);

  const readout = document.createElement("div");
  readout.style.color = "#c9d3e6";
  sec.appendChild(readout);

  const out = document.createElement("textarea");
  out.readOnly = true;

  const codeLine = (): string => `export const CAT_WALL_DEFAULT_MUL = ${catWallTune.mul.toFixed(2)};`;

  // Перерисовать подписи, сохранить и перекрасить стены в залах.
  const changed = (): void => {
    val.textContent = catWallTune.mul.toFixed(2);
    readout.textContent = `стены: ×${catWallTune.mul.toFixed(2)} к прежнему цвету (1.00 — как было)`;
    out.value = codeLine();
    saveCatWallTune();
    notifyCatWallTuneChanged();
  };

  input.addEventListener("input", () => {
    catWallTune.mul = Number(input.value);
    changed();
  });

  const buttons = document.createElement("div");
  buttons.style.marginTop = "6px";
  const reset = document.createElement("button");
  reset.textContent = "Сброс";
  reset.addEventListener("click", () => {
    catWallTune.mul = CAT_WALL_DEFAULT_MUL;
    input.value = String(CAT_WALL_DEFAULT_MUL);
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
  hint.textContent = "Двигает только стены залов; пол, кровь и огонь не меняются.";
  sec.appendChild(hint);

  changed();

  return () => {
    box.remove();
    style.remove();
  };
}
