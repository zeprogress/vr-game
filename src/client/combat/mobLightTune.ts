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
  emissiveMul: 0.5,
  specularMul: 0.75,
  maxLights: 3,
};

/**
 * Свет на материале отдельных моделей мобов (recolorMonster): emissive — подсветка текстурой
 * (не зависит от солнца), diffuse — насколько ярко модель ловит свет, tex — яркость самой
 * текстуры. Без записи — 0.3 / 1 / 1: под яркие палитры пака (медиана текстур ~0.9).
 * Модели art/models с реалистичными текстурами темнее (камень Скалолома — медиана 0.32), а
 * StandardMaterial обрезает свет до 1 ДО умножения на текстуру — модель не бывает ярче своей
 * текстуры, diffuse/emissive тут не помогут; поднимает только tex (Texture.level).
 * Живая подстройка — панель ?moblight=1 (раздел «модель»).
 */
export interface ModelLight {
  emissive: number;
  diffuse: number;
  tex: number;
}
export const MODEL_LIGHT: Record<string, ModelLight> = {
  monBee: { emissive: 0.08, diffuse: 1.6, tex: 1 },
  monOrc: { emissive: 0.2, diffuse: 1.15, tex: 1 },
  monStoneTroll: { emissive: 0, diffuse: 1, tex: 2 },
  // Рейд-босс «Лунный аватар»: светится сам — лунный свет, а не освещённый камень.
  monMoonAvatar: { emissive: 0.75, diffuse: 1.1, tex: 1.6 },
  monBogBrute: { emissive: 0.3, diffuse: 1.2, tex: 1.8 },
  monDragonBest: { emissive: 0, diffuse: 1, tex: 1.2 },
};
export const MODEL_LIGHT_DEFAULT: ModelLight = { emissive: 0.3, diffuse: 1, tex: 1 };

const KEY = "zep.moblight";
const MODEL_KEY = "zep.moblight.models";

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
try {
  const raw = localStorage.getItem(MODEL_KEY);
  if (raw) for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, Partial<ModelLight>>)) MODEL_LIGHT[k] = { ...MODEL_LIGHT_DEFAULT, ...MODEL_LIGHT[k], ...v };
} catch {
  /* приватный режим/битые данные — держим дефолт */
}

// ---- живой реестр материалов — правка слайдера сразу бьёт по мобам на поляне ----

interface Tracked {
  mat: StandardMaterial;
  baseDiffuse: Color3;
  baseEmissive: Color3;
  baseSpecular: Color3;
  /** Модель и «единичный» цвет (тон/белый под текстурой) — для живой подстройки MODEL_LIGHT. */
  model?: string;
  unit?: Color3;
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
export function trackMobMaterial(mat: StandardMaterial, model?: string, unit?: Color3): void {
  const t: Tracked = {
    mat,
    baseDiffuse: mat.diffuseColor.clone(),
    baseEmissive: mat.emissiveColor.clone(),
    baseSpecular: mat.specularColor.clone(),
    model,
    unit: unit?.clone(),
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

/** Свет модели поменяли в панели — пересчитать её материалы (только с подсветкой текстурой). */
export function setModelLight(model: string, v: ModelLight): void {
  MODEL_LIGHT[model] = { ...v };
  for (const t of tracked) {
    if (t.model !== model || !t.unit) continue;
    t.baseDiffuse = t.unit.scale(v.diffuse);
    t.baseEmissive = t.unit.scale(v.emissive);
    if (t.mat.diffuseTexture) t.mat.diffuseTexture.level = v.tex;
    applyOne(t);
  }
  try {
    localStorage.setItem(MODEL_KEY, JSON.stringify(MODEL_LIGHT));
  } catch {
    /* не критично */
  }
}

/** Свет модели (запись MODEL_LIGHT или дефолт пака). */
export function modelLight(model?: string): ModelLight {
  return (model && MODEL_LIGHT[model]) || MODEL_LIGHT_DEFAULT;
}

/** Модели, у которых уже есть материалы на сцене (для выбора в панели). */
export function trackedModels(): string[] {
  return [...new Set(tracked.map((t) => t.model).filter((m): m is string => !!m))];
}

