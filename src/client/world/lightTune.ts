/**
 * Множители освещения для живой настройки (`?light=1`, панель LightTuner).
 *
 * По умолчанию всё 1 — игра ведёт себя как раньше. Панель меняет множители, сохраняет их в
 * localStorage (переживают F5) и даёт готовую строку для вставки в код (это константы по умолчанию).
 * Солнце пересчитывается сразу через хук setLightTuneHook; факелы берут множитель каждый кадр.
 */
export interface LightTune {
  /** Яркость солнца (Zone.applyDay). */
  sunMul: number;
  /** Яркость ночных факелов-светлячков (BotLights). */
  torchMul: number;
}

export const LIGHT_TUNE: LightTune = { sunMul: 1, torchMul: 1 };

const KEY = "zep.light";
let onChange: (() => void) | null = null;

/** Зона регистрирует пересчёт освещения — чтобы ползунок сразу был виден. */
export function setLightTuneHook(fn: (() => void) | null): void {
  onChange = fn;
}

export function notifyLightTune(): void {
  onChange?.();
}

/** Подтянуть сохранённые множители (только в панели — в обычной игре значения по умолчанию). */
export function loadLightTune(): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const o = JSON.parse(raw) as Partial<LightTune>;
    if (typeof o.sunMul === "number" && Number.isFinite(o.sunMul)) LIGHT_TUNE.sunMul = o.sunMul;
    if (typeof o.torchMul === "number" && Number.isFinite(o.torchMul)) LIGHT_TUNE.torchMul = o.torchMul;
  } catch {
    // нет доступа к хранилищу — остаются значения по умолчанию
  }
}

export function saveLightTune(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(LIGHT_TUNE));
  } catch {
    // хранилище недоступно — настройка живёт до перезагрузки
  }
}
