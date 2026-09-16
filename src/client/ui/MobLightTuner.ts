/**
 * Панель живой настройки освещения ПОЛЕВЫХ мобов (слизни/плевуны/элитные
 * лагеря на поляне): `?moblight=1`. НЕ трогает башню — у той свой
 * `?towerlight=1` (отдельная приватная сцена).
 *
 * Мобы на поляне читают те же ambient/sun-источники, что трава и герои
 * (Zone.ts) — крутить сами источники задело бы всё вокруг. Поэтому тут
 * множители НА МАТЕРИАЛЕ моба (diffuse/emissive/specular + сколько
 * источников он вообще считает), см. mobLightTune.ts. Правки сразу бьют
 * по уже заспавненным мобам (живой реестр материалов), не только по новым.
 *
 * Подобранное лежит в localStorage (переживает F5) и показывается готовым
 * куском кода для вставки в mobLightTune.ts (в дефолт MOB_LIGHT_TUNE).
 */
import { applyMobLightTune, MOB_LIGHT_TUNE, saveMobLightTune } from "../combat/mobLightTune";

const CSS = `
#mobLightTuner{position:fixed;top:8px;right:8px;z-index:9999;width:250px;
background:rgba(16,18,24,.92);color:#e7e9ee;font:12px/1.35 ui-monospace,monospace;
padding:10px;border-radius:8px;border:1px solid #3a4050;user-select:none}
#mobLightTuner h4{margin:0 0 6px;font-size:12px;letter-spacing:.04em;color:#9fd3ff}
#mobLightTuner .r{display:flex;align-items:center;gap:6px;margin:3px 0}
#mobLightTuner .r label{width:64px;color:#9aa3b2}
#mobLightTuner input[type=range]{flex:1;min-width:0}
#mobLightTuner .v{width:44px;text-align:right;color:#ffd48a}
#mobLightTuner .sec{margin-top:8px;padding-top:6px;border-top:1px solid #2c3140}
#mobLightTuner button{background:#2b3242;color:#e7e9ee;border:1px solid #454d60;border-radius:5px;
padding:4px 8px;font:11px ui-monospace,monospace;cursor:pointer;margin-right:5px}
#mobLightTuner button:hover{background:#39425a}
#mobLightTuner textarea{width:100%;height:56px;margin-top:6px;background:#0f1219;color:#b8e6a0;
border:1px solid #2c3140;border-radius:5px;font:10px/1.3 ui-monospace,monospace;resize:vertical}
#mobLightTuner .hint{color:#7f8798;margin-top:6px}
`;

export function mountMobLightTuner(): () => void {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const box = document.createElement("div");
  box.id = "mobLightTuner";
  document.body.appendChild(box);

  for (const ev of ["wheel", "pointerdown", "keydown"] as const) {
    box.addEventListener(ev, (e) => e.stopPropagation());
  }

  const fmt = (n: number): string => (Math.abs(n) < 0.0005 ? "0" : n.toFixed(2));
  const dump = (): string =>
    `diffuseMul: ${fmt(MOB_LIGHT_TUNE.diffuseMul)},\n` +
    `emissiveMul: ${fmt(MOB_LIGHT_TUNE.emissiveMul)},\n` +
    `specularMul: ${fmt(MOB_LIGHT_TUNE.specularMul)},\n` +
    `maxLights: ${Math.round(MOB_LIGHT_TUNE.maxLights)},`;

  const out = document.createElement("textarea");
  out.readOnly = true;

  const apply = (): void => {
    applyMobLightTune();
    saveMobLightTune();
    out.value = dump();
  };

  const slider = (
    label: string,
    min: number,
    max: number,
    step: string,
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
    input.step = step;
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
  title.textContent = "СВЕТ МОБОВ (?moblight=1)";
  box.appendChild(title);

  const section = (text: string): void => {
    const h = document.createElement("h4");
    h.className = "sec";
    h.textContent = text;
    box.appendChild(h);
  };

  section("яркость");
  slider("diffuse", 0, 3, "any", () => MOB_LIGHT_TUNE.diffuseMul, (v) => (MOB_LIGHT_TUNE.diffuseMul = v));
  slider("emissive", 0, 3, "any", () => MOB_LIGHT_TUNE.emissiveMul, (v) => (MOB_LIGHT_TUNE.emissiveMul = v));
  slider("specular", 0, 3, "any", () => MOB_LIGHT_TUNE.specularMul, (v) => (MOB_LIGHT_TUNE.specularMul = v));

  section("источники света");
  slider("maxLights", 0, 8, "1", () => MOB_LIGHT_TUNE.maxLights, (v) => (MOB_LIGHT_TUNE.maxLights = v));

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
    localStorage.removeItem("zep.moblight");
    location.reload();
  });
  btns.append(copy, reset);
  box.appendChild(btns);
  box.appendChild(out);

  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent =
    "Действует на мобов поляны (не башню). Переживает F5. Готовое — в mobLightTune.ts (MOB_LIGHT_TUNE).";
  box.appendChild(hint);

  apply();

  return () => {
    box.remove();
    style.remove();
  };
}
