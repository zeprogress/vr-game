/**
 * Живая настройка освещения (`?light=1`, панель LightTuner). Всё по умолчанию 1 — игра как раньше.
 *
 * Панель меняет множители, сохраняет их в localStorage и даёт строку для вставки в код.
 * Работает только когда панель открыта: attachLightTune вешается на сцену лишь тогда.
 *  - солнце, факелы ботов, светлячки, заклинания, факелы катакомб — множитель яркости каждого источника
 *    (по имени источника), каждый кадр поверх того, что задала игра;
 *  - солнце по фазам суток и небо/туман — через tunedDayState (день/закат/ночь).
 */
import type { Scene } from "@babylonjs/core/scene";
import type { Light } from "@babylonjs/core/Lights/light";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { dayPhase, dayState, type DayState } from "./DayTime";

export interface LightTune {
  /** Солнце (всех фаз). */
  sunMul: number;
  /** Солнце: только день / закат / ночь — перемножаются с sunMul. */
  sunDayMul: number;
  sunDuskMul: number;
  sunNightMul: number;
  /** Небо: яркость градиента зенита и горизонта. */
  skyMul: number;
  /** Туман: яркость цвета тумана. */
  fogMul: number;
  /** Факелы ботов и зрителей (botTorch*). */
  torchMul: number;
  /** Светлячки-лампы (fireflyLamp*). */
  fireflyMul: number;
  /** Заклинания: кристалл и огонь (spellCrystal, spellFire). */
  spellMul: number;
  /** Факелы, фонари и свечи катакомб (catTorch*). */
  cataMul: number;
}

export const LIGHT_TUNE: LightTune = {
  sunMul: 1,
  sunDayMul: 1,
  sunDuskMul: 1,
  sunNightMul: 1,
  skyMul: 1,
  fogMul: 1,
  torchMul: 1,
  fireflyMul: 1,
  spellMul: 1,
  cataMul: 1,
};

const KEY = "zep.light";
let onChange: (() => void) | null = null;

/** Зона регистрирует пересчёт дня — чтобы ползунки сразу были видны. */
export function setLightTuneHook(fn: (() => void) | null): void {
  onChange = fn;
}

export function notifyLightTune(): void {
  onChange?.();
}

/** Подтянуть сохранённые множители (только панель). */
export function loadLightTune(): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const o = JSON.parse(raw) as Partial<LightTune>;
    for (const k of Object.keys(LIGHT_TUNE) as (keyof LightTune)[]) {
      const v = o[k];
      if (typeof v === "number" && Number.isFinite(v)) LIGHT_TUNE[k] = v;
    }
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

/** День на данный час с поправками панели (солнце по фазе, небо, туман). */
export function tunedDayState(hour: number): DayState {
  const d = dayState(hour);
  const phase = dayPhase(hour);
  const phaseMul = phase === "day" ? LIGHT_TUNE.sunDayMul : phase === "dusk" ? LIGHT_TUNE.sunDuskMul : LIGHT_TUNE.sunNightMul;
  const clamp = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
  const sky = LIGHT_TUNE.skyMul;
  return {
    ...d,
    sunIntensity: d.sunIntensity * phaseMul,
    zenith: [clamp(d.zenith[0] * sky), clamp(d.zenith[1] * sky), clamp(d.zenith[2] * sky)],
    horizon: [clamp(d.horizon[0] * sky), clamp(d.horizon[1] * sky), clamp(d.horizon[2] * sky)],
    fog: new Color3(d.fog.r * LIGHT_TUNE.fogMul, d.fog.g * LIGHT_TUNE.fogMul, d.fog.b * LIGHT_TUNE.fogMul),
  };
}

/** Множитель по имени источника (см. описание файла). */
function groupMul(name: string): number {
  if (name === "sun") return LIGHT_TUNE.sunMul;
  if (name.startsWith("botTorch")) return LIGHT_TUNE.torchMul;
  if (name.startsWith("fireflyLamp")) return LIGHT_TUNE.fireflyMul;
  if (name.startsWith("spell")) return LIGHT_TUNE.spellMul;
  if (name.startsWith("catTorch")) return LIGHT_TUNE.cataMul;
  return 1;
}

/**
 * Вешает множители на яркость источников сцены. Игра каждый кадр сама задаёт яркость (или
 * только иногда) — поэтому запоминаем «базу», которую задала игра, и умножаем её.
 * Возвращает снятие.
 */
export function attachLightTune(scene: Scene): () => void {
  const state = new Map<Light, { base: number; last: number }>();
  const obs = scene.onBeforeRenderObservable.add(() => {
    for (const l of scene.lights) {
      const st = state.get(l) ?? { base: l.intensity, last: l.intensity };
      // Игра сменила яркость за кадр — это новая база; иначе база прежняя (мы сами её меняли).
      if (l.intensity !== st.last) st.base = l.intensity;
      const next = st.base * groupMul(l.name);
      l.intensity = next;
      st.last = next;
      state.set(l, st);
    }
  });
  return () => {
    scene.onBeforeRenderObservable.remove(obs);
    for (const [l, st] of state) l.intensity = st.base;
    state.clear();
  };
}
