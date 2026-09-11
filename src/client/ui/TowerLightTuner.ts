/**
 * Панель живой настройки освещения «Охотничьей башни»: `?towerlight=1`.
 *
 * Требует, чтобы на арене прямо сейчас шёл забег (реальный или через
 * `?towertest=1`, см. Spectator.ts) — панель просто дёргает
 * `TowerArenaFx.refreshLighting()` после каждого изменения ползунка.
 *
 * Подобранное лежит в localStorage (переживает F5) и показывается готовым
 * куском кода для вставки в towerLightTune.ts (дефолты для прода).
 */
import { TOWER_LIGHT_TUNE, loadTowerLightTune, saveTowerLightTune } from "../spectator/towerLightTune";

const CSS = `
#towerLightTuner{position:fixed;top:8px;right:8px;z-index:9999;width:260px;
background:rgba(16,18,24,.92);color:#e7e9ee;font:12px/1.35 ui-monospace,monospace;
padding:10px;border-radius:8px;border:1px solid #3a4050;user-select:none}
#towerLightTuner h4{margin:0 0 6px;font-size:12px;letter-spacing:.04em;color:#9fd3ff}
#towerLightTuner .r{display:flex;align-items:center;gap:6px;margin:3px 0}
#towerLightTuner .r label{width:78px;color:#9aa3b2}
#towerLightTuner input[type=range]{flex:1;min-width:0}
#towerLightTuner .v{width:52px;text-align:right;color:#ffd48a}
#towerLightTuner .sec{margin-top:8px;padding-top:6px;border-top:1px solid #2c3140}
#towerLightTuner button{background:#2b3242;color:#e7e9ee;border:1px solid #454d60;border-radius:5px;
padding:4px 8px;font:11px ui-monospace,monospace;cursor:pointer;margin-right:5px}
#towerLightTuner button:hover{background:#39425a}
#towerLightTuner textarea{width:100%;height:96px;margin-top:6px;background:#0f1219;color:#b8e6a0;
border:1px solid #2c3140;border-radius:5px;font:10px/1.3 ui-monospace,monospace;resize:vertical}
#towerLightTuner .hint{color:#7f8798;margin-top:6px}
`;

/** Читает `TowerArenaFx` спектатора, если тот сейчас смонтирован (см. Spectator.ts). */
function getArenaFx(): { refreshLighting(): void } | null {
  return (window as unknown as { __towerArenaFx?: { refreshLighting(): void } }).__towerArenaFx ?? null;
}

export function mountTowerLightTuner(): () => void {
  loadTowerLightTune();

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const box = document.createElement("div");
  box.id = "towerLightTuner";
  document.body.appendChild(box);

  for (const ev of ["wheel", "pointerdown", "keydown"] as const) {
    box.addEventListener(ev, (e) => e.stopPropagation());
  }

  const fmt = (n: number): string => (Math.abs(n) < 0.0005 ? "0" : n.toFixed(3));
  const dump = (): string => {
    const t = TOWER_LIGHT_TUNE;
    return (
      `nightMul: ${fmt(t.nightMul)},\n` +
      `floorEmissive: ${fmt(t.floorEmissive)},\n` +
      `wallEmissive: ${fmt(t.wallEmissive)},\n` +
      `ceilEmissive: ${fmt(t.ceilEmissive)},\n` +
      `mobEmissiveMul: ${fmt(t.mobEmissiveMul)},\n` +
      `spotAngleDeg: ${fmt(t.spotAngleDeg)},\n` +
      `spotExponent: ${fmt(t.spotExponent)},\n` +
      `spotIntensity: ${fmt(t.spotIntensity)},\n` +
      `spotHeightOffset: ${fmt(t.spotHeightOffset)},`
    );
  };

  const out = document.createElement("textarea");
  out.readOnly = true;

  const apply = (): void => {
    saveTowerLightTune();
    getArenaFx()?.refreshLighting();
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
  title.textContent = "СВЕТ БАШНИ (?towerlight=1)";
  box.appendChild(title);

  const section = (text: string): void => {
    const h = document.createElement("h4");
    h.className = "sec";
    h.textContent = text;
    box.appendChild(h);
  };

  section("тест (?towertest=1)");
  const w = window as unknown as { __towerTestFloor?: number };
  slider(
    "этаж",
    1,
    20,
    () => w.__towerTestFloor ?? 1,
    (v) => (w.__towerTestFloor = Math.round(v)),
  );

  section("темнота комнаты");
  slider("общий свет", 0, 1.5, () => TOWER_LIGHT_TUNE.nightMul, (v) => (TOWER_LIGHT_TUNE.nightMul = v));
  slider("свеч. пола", 0, 0.3, () => TOWER_LIGHT_TUNE.floorEmissive, (v) => (TOWER_LIGHT_TUNE.floorEmissive = v));
  slider("свеч. стен", 0, 0.3, () => TOWER_LIGHT_TUNE.wallEmissive, (v) => (TOWER_LIGHT_TUNE.wallEmissive = v));
  slider("свеч. потолка", 0, 0.3, () => TOWER_LIGHT_TUNE.ceilEmissive, (v) => (TOWER_LIGHT_TUNE.ceilEmissive = v));
  slider("свеч. мобов", 0, 1, () => TOWER_LIGHT_TUNE.mobEmissiveMul, (v) => (TOWER_LIGHT_TUNE.mobEmissiveMul = v));

  section("прожектор");
  slider("угол, град", 2, 90, () => TOWER_LIGHT_TUNE.spotAngleDeg, (v) => (TOWER_LIGHT_TUNE.spotAngleDeg = v));
  slider("резкость края", 0.5, 12, () => TOWER_LIGHT_TUNE.spotExponent, (v) => (TOWER_LIGHT_TUNE.spotExponent = v));
  slider("яркость", 0, 25, () => TOWER_LIGHT_TUNE.spotIntensity, (v) => (TOWER_LIGHT_TUNE.spotIntensity = v));
  slider("ниже потолка, м", 0, 5, () => TOWER_LIGHT_TUNE.spotHeightOffset, (v) => (TOWER_LIGHT_TUNE.spotHeightOffset = v));

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
    localStorage.removeItem("zep.towerlight");
    location.reload();
  });
  btns.append(copy, reset);
  box.appendChild(btns);
  box.appendChild(out);

  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = "Нужен активный забег на арене (см. ?towertest=1). Готовое — в towerLightTune.ts.";
  box.appendChild(hint);

  apply();

  return () => {
    box.remove();
    style.remove();
  };
}
