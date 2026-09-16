import type { Color3 } from "@babylonjs/core/Maths/math.color";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

/**
 * Живая подстройка освещения полевых мобов (слизни/плевуны/элитные лагеря —
 * НЕ башня, у той свой `?towerlight=1`). Мобы на поляне читают те же
 * ambient/sun-источники, что трава и герои (см. Zone.ts) — тут крутим не
 * сами источники (задело бы всё вокруг), а множители на материале моба.
 */
export interface MobLightTune {
  /** Множитель диффузного цвета — сколько моб ловит прямого/окружающего света. */
  diffuseMul: number;
  /** Множитель эмиссии — собственное "подсвечивание" модели, не зависит от источников. */
  emissiveMul: number;
  /** Множитель блика. */
  specularMul: number;
  /** Сколько источников света считает материал (небо+солнце+факелы ботов+светлячок). */
  maxLights: number;
}

export const MOB_LIGHT_TUNE: MobLightTune = {
  diffuseMul: 1,
  emissiveMul: 1,
  specularMul: 1,
  maxLights: 5,
};

const KEY = "zep.moblight";

function load(): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const v = JSON.parse(raw) as Partial<MobLightTune>;
    Object.assign(MOB_LIGHT_TUNE, v);
  } catch {
    /* приватный режим/битые данные — держим дефолт */
  }
}

export function saveMobLightTune(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(MOB_LIGHT_TUNE));
  } catch {
    /* приватный режим — не критично, просто не переживёт перезагрузку */
  }
}

load();

// ---- живой реестр материалов — правка слайдера сразу бьёт по мобам на поляне ----

interface Tracked {
  mat: StandardMaterial;
  baseDiffuse: Color3;
  baseEmissive: Color3;
  baseSpecular: Color3;
}

const tracked: Tracked[] = [];

function applyOne(t: Tracked): void {
  t.mat.diffuseColor = t.baseDiffuse.scale(MOB_LIGHT_TUNE.diffuseMul);
  t.mat.emissiveColor = t.baseEmissive.scale(MOB_LIGHT_TUNE.emissiveMul);
  t.mat.specularColor = t.baseSpecular.scale(MOB_LIGHT_TUNE.specularMul);
  t.mat.maxSimultaneousLights = Math.round(MOB_LIGHT_TUNE.maxLights);
}

/**
 * Завести материал моба под живую подстройку — звать СРАЗУ после того, как
 * на нём выставлены "базовые" diffuse/emissive/specular (эта функция тут же
 * применит текущий MOB_LIGHT_TUNE поверх них).
 */
export function trackMobMaterial(mat: StandardMaterial): void {
  const t: Tracked = {
    mat,
    baseDiffuse: mat.diffuseColor.clone(),
    baseEmissive: mat.emissiveColor.clone(),
    baseSpecular: mat.specularColor.clone(),
  };
  tracked.push(t);
  applyOne(t);
}

/**
 * Перечитать MOB_LIGHT_TUNE на всех отслеженных мобовых материалах — зовёт
 * тюнер после каждого слайдера. Материалы дохлых мобов тут не чистим (это
 * чисто дебажный инструмент на время открытой панели — не хот-путь и не
 * держит геометрию, просто несколько Color3 в памяти).
 */
export function applyMobLightTune(): void {
  for (const t of tracked) applyOne(t);
}
