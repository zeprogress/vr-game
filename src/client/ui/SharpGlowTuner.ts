/**
 * Панель живой настройки свечения оружия по точкам атаки: `?sharpglow=1`.
 *
 * Сила и радиус растут с прибавкой (sharpGlowMul в shared/items.ts). Панель двигает
 * sharpGlowTune, и оружие в руках перекрашивается сразу. «Точек» подменяет прибавку для
 * проверки: видно свечение на 0–50 точках без заточки. Подобранное лежит в localStorage
 * и показывается готовым куском для SHARP_GLOW_DEFAULT (sharpGlowTune.ts).
 */
import { SHARP_GLOW_REF_PCT, sharpGlowMul, sharpPctOfPoints } from "#shared/items";
import {
  SHARP_GLOW_DEFAULT,
  bumpSharpGlow,
  loadSharpGlowTune,
  saveSharpGlowTune,
  sharpGlowTune,
} from "../items/sharpGlowTune";

const CSS = `
#sgTuner{position:fixed;top:8px;right:8px;z-index:9999;width:270px;max-height:92vh;
overflow:auto;background:rgba(16,18,24,.92);color:#e7e9ee;font:12px/1.35 ui-monospace,monospace;
padding:10px;border-radius:8px;border:1px solid #3a4050;user-select:none}
#sgTuner h4{margin:0 0 6px;font-size:12px;letter-spacing:.04em;color:#9fd3ff}
#sgTuner .r{display:flex;align-items:center;gap:6px;margin:3px 0}
#sgTuner .r label{width:58px;color:#9aa3b2}
#sgTuner input[type=range]{flex:1;min-width:0}
#sgTuner .v{width:58px;text-align:right;color:#ffd48a}
#sgTuner .sec{margin-top:8px;padding-top:6px;border-top:1px solid #2c3140}
#sgTuner button{background:#2b3242;color:#e7e9ee;border:1px solid #454d60;border-radius:5px;
padding:4px 8px;font:11px ui-monospace,monospace;cursor:pointer;margin-right:5px}
#sgTuner button:hover{background:#39425a}
#sgTuner textarea{width:100%;height:118px;margin-top:6px;background:#0f1219;color:#b8e6a0;
border:1px solid #2c3140;border-radius:5px;font:10px/1.3 ui-monospace,monospace;resize:vertical}
#sgTuner .hint{color:#7f8798;margin-top:6px}
`;

/** Точки для таблицы: прибавка, сила и радиус относительно «как сейчас» (+10). */
const TABLE_POINTS = [1, 3, 5, 10, 15, 20, 30, 40, 50];

interface SliderRow {
  input: HTMLInputElement;
  value: HTMLSpanElement;
}

export function mountSharpGlowTuner(): () => void {
  loadSharpGlowTune();
  bumpSharpGlow();

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const box = document.createElement("div");
  box.id = "sgTuner";
  document.body.appendChild(box);
  // Колесо и клики не уходят в игру: панель поверх канваса.
  for (const ev of ["wheel", "pointerdown", "keydown"] as const) {
    box.addEventListener(ev, (e) => e.stopPropagation());
  }

  const title = document.createElement("h4");
  title.textContent = "СВЕЧЕНИЕ ТОЧЕК АТАКИ (?sharpglow=1)";
  box.appendChild(title);

  // Точки для проверки на оружии в руках: 0 — выкл., смотрим настоящие точки.
  let testPoints = 0;

  const slider = (label: string, min: number, max: number, step: number, value: number, onInput: (v: number) => void): SliderRow => {
    const r = document.createElement("div");
    r.className = "r";
    const l = document.createElement("label");
    l.textContent = label;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    const v = document.createElement("span");
    v.className = "v";
    input.addEventListener("input", () => onInput(Number(input.value)));
    r.append(l, input, v);
    box.appendChild(r);
    return { input, value: v };
  };
  const shownNum = (n: number): string => n.toFixed(2);
  const shownPts = (n: number): string => (n > 0 ? String(n) : "выкл");

  const strength = slider("Сила", 0, 2, 0.05, sharpGlowTune.strength, (v) => {
    sharpGlowTune.strength = v;
    changed();
  });
  const radius = slider("Радиус", 0, 2, 0.05, sharpGlowTune.radius, (v) => {
    sharpGlowTune.radius = v;
    changed();
  });
  const points = slider("Точек", 0, 50, 1, testPoints, (n) => {
    testPoints = n;
    sharpGlowTune.testPct = n > 0 ? sharpPctOfPoints(n) : null;
    changed();
  });

  const sec = document.createElement("div");
  sec.className = "sec";
  box.appendChild(sec);

  const readout = document.createElement("div");
  readout.className = "hint";
  readout.style.color = "#c9d3e6";
  sec.appendChild(readout);

  const out = document.createElement("textarea");
  out.readOnly = true;

  const table = (): string => {
    const lines = TABLE_POINTS.map((n) => {
      const pct = sharpPctOfPoints(n);
      return `точек ${String(n).padStart(2)}: +${pct.toFixed(1)}% · сила ×${sharpGlowMul(pct, sharpGlowTune.strength).toFixed(2)} · радиус ×${sharpGlowMul(pct, sharpGlowTune.radius).toFixed(2)}`;
    });
    const cap = 80;
    lines.push(`предел:    +${cap}% · сила ×${sharpGlowMul(cap, sharpGlowTune.strength).toFixed(2)} · радиус ×${sharpGlowMul(cap, sharpGlowTune.radius).toFixed(2)}`);
    return lines.join("\n");
  };

  const codeLine = (): string =>
    `export const SHARP_GLOW_DEFAULT = { strength: ${sharpGlowTune.strength.toFixed(2)}, radius: ${sharpGlowTune.radius.toFixed(2)} } as const;`;

  // Перерисовать подписи и таблицу, сохранить и пересчитать свечение в руках.
  const changed = (): void => {
    strength.value.textContent = shownNum(sharpGlowTune.strength);
    radius.value.textContent = shownNum(sharpGlowTune.radius);
    points.value.textContent = shownPts(testPoints);
    readout.textContent = testPoints > 0
      ? `тест: ${testPoints} точ. → прибавка +${sharpPctOfPoints(testPoints).toFixed(1)}% (на +10 = +${SHARP_GLOW_REF_PCT.toFixed(1)}%)`
      : "тест выкл: свечение по настоящим точкам оружия";
    out.value = table();
    saveSharpGlowTune();
    bumpSharpGlow();
  };

  const buttons = document.createElement("div");
  buttons.style.marginTop = "6px";
  const reset = document.createElement("button");
  reset.textContent = "Сброс";
  reset.addEventListener("click", () => {
    sharpGlowTune.strength = SHARP_GLOW_DEFAULT.strength;
    sharpGlowTune.radius = SHARP_GLOW_DEFAULT.radius;
    testPoints = 0;
    sharpGlowTune.testPct = null;
    strength.input.value = String(SHARP_GLOW_DEFAULT.strength);
    radius.input.value = String(SHARP_GLOW_DEFAULT.radius);
    points.input.value = "0";
    changed();
  });
  const copy = document.createElement("button");
  copy.textContent = "Копировать код";
  copy.addEventListener("click", () => {
    const code = codeLine();
    out.value = `${code}\n\n${table()}`;
    out.select();
    void navigator.clipboard?.writeText(code).catch(() => undefined);
  });
  buttons.append(reset, copy);
  sec.appendChild(buttons);
  sec.appendChild(out);

  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = "«Точек» — только для проверки: в игре у всех прибавка настоящая.";
  sec.appendChild(hint);

  changed();

  return () => {
    sharpGlowTune.testPct = null;
    bumpSharpGlow();
    box.remove();
    style.remove();
  };
}
