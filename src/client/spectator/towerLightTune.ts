/**
 * Живая настройка освещения «Охотничьей башни» — панель `?towerlight=1`
 * (см. ui/TowerLightTuner). Читается TowerArenaFx каждый раз, когда меняет
 * этаж/зовёт refreshLighting() — подписка не нужна, панель просто меняет
 * объект и дёргает refresh.
 *
 * Дефолты здесь — то, что уедет в прод. Копия для вставки — в панели.
 */
export interface TowerLightTune {
  /** Множитель на общий точечный свет комнаты (пол/стены/потолок). 0 — совсем чёрный. */
  nightMul: number;
  /** Собственное свечение пола/стен/потолка (не зависит от light) — 0 убирает совсем. */
  floorEmissive: number;
  wallEmissive: number;
  ceilEmissive: number;
  /** Множитель на "родное" свечение моделей мобов (recolorMonster) — 0 убирает их самосвет. */
  mobEmissiveMul: number;
  /** Прожектор с потолка: угол конуса (град, узкий — жёсткий луч), резкость спада к краю. */
  spotAngleDeg: number;
  spotExponent: number;
  spotIntensity: number;
  /** На сколько метров прожектор подвешен НИЖЕ потолка. */
  spotHeightOffset: number;
}

export const TOWER_LIGHT_TUNE: TowerLightTune = {
  nightMul: 0.178,
  floorEmissive: 0,
  wallEmissive: 0,
  ceilEmissive: 0,
  mobEmissiveMul: 0,
  spotAngleDeg: 22.569,
  spotExponent: 0.5,
  spotIntensity: 10.302,
  spotHeightOffset: 5,
};

const KEY = "zep.towerlight";

export function loadTowerLightTune(): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const v = JSON.parse(raw) as Partial<TowerLightTune>;
    for (const k of Object.keys(TOWER_LIGHT_TUNE) as (keyof TowerLightTune)[]) {
      const n = v[k];
      if (Number.isFinite(n)) TOWER_LIGHT_TUNE[k] = n as number;
    }
  } catch {
    /* приватный режим/битый JSON — берём дефолты */
  }
}

export function saveTowerLightTune(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(TOWER_LIGHT_TUNE));
  } catch {
    /* не критично */
  }
}
