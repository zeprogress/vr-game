import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { LOADOUT } from "../config/loadout";
import { FOG_TUNE } from "./fogTune";

/** Как выглядит мир в конкретный час. */
export interface DayState {
  /** Направление лучей (куда светит), единичное. */
  sunDir: Vector3;
  /** Куда поставить диск солнца — противоположно лучам. */
  sunPos: Vector3;
  sunColor: Color3;
  sunIntensity: number;
  ambientColor: Color3;
  ambientIntensity: number;
  /** Цвета градиента неба, 0..255. */
  zenith: [number, number, number];
  horizon: [number, number, number];
  fog: Color3;
  /** Цвет самого диска и гало. */
  disc: Color3;
  /** Цвет облаков: днём белые, на заре и закате малиновые. */
  cloud: Color3;
  /** 1 — день, 0 — ночь. По нему живут трава и светлячки. */
  daylight: number;
}

interface Palette {
  sun: [number, number, number];
  sunI: number;
  amb: [number, number, number];
  ambI: number;
  zenith: [number, number, number];
  horizon: [number, number, number];
  fog: [number, number, number];
  disc: [number, number, number];
  cloud: [number, number, number];
}

const DAY: Palette = {
  // Свет солнца — жёлтый (не диск: диск остаётся почти белым, см. disc ниже).
  sun: [1, 0.82, 0.48],
  // Солнце сильное, заливка неба слабая: освещённое солнцем — ярко, всё
  // остальное заметно темнее. Теней (ShadowGenerator) в сцене нет, весь
  // объём держится на этом отношении ~8:1. Цвет заливки чуть холодный —
  // это свет неба, он в реальности синеватый, отсюда прохладная тень.
  sunI: 1.85,
  amb: [0.82, 0.87, 0.98],
  // Днём заливки нет: весь объём даёт солнце. Экономит источник света в
  // шейдерах (Zone гасит HemisphericLight, когда её яркость ≈ 0). Ручка
  // `light.fill` умеет вернуть дневную заливку, если понадобится.
  ambI: 0,
  zenith: [82, 132, 205],
  horizon: [206, 226, 240],
  fog: [0.78, 0.85, 0.92],
  disc: [1, 0.98, 0.9],
  cloud: [0.94, 0.96, 0.99], // днём почти белые
};

/** Золотой (он же малиновый) час: низкое тёплое солнце. */
const DUSK: Palette = {
  sun: [1, 0.6, 0.32],
  sunI: 1.05,
  amb: [0.82, 0.62, 0.66],
  ambI: 0.45,
  zenith: [70, 62, 132],
  horizon: [247, 140, 96],
  fog: [0.88, 0.62, 0.55],
  disc: [1, 0.72, 0.4],
  cloud: [0.93, 0.36, 0.33], // малиновые на заре и закате, без синевы
};

const NIGHT: Palette = {
  sun: [0.5, 0.6, 0.9],
  sunI: 0.2,
  amb: [0.38, 0.45, 0.66],
  ambI: 0.17,
  zenith: [2, 3, 9], // ночное небо густое, почти чёрное
  horizon: [8, 11, 24],
  fog: [0.07, 0.09, 0.16], // НЕ используется — ночной туман берётся из FOG_TUNE (?fog=1)
  disc: [0.85, 0.9, 1],
  cloud: [0.16, 0.18, 0.28],
};

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function mix3(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
  wa: number,
  wb: number,
  wc: number,
): [number, number, number] {
  return [
    a[0] * wa + b[0] * wb + c[0] * wc,
    a[1] * wa + b[1] * wb + c[1] * wc,
    a[2] * wa + b[2] * wb + c[2] * wc,
  ];
}

/**
 * Освещение и краски неба на заданный час (0..24).
 *
 * Солнце ходит по дуге: 6 — восход на востоке, 12 — зенит, 18 — закат на
 * западе, 0 — полночь. Между днём, закатом и ночью краски смешиваются
 * плавно, чтобы не было щелчка при переходе.
 */
export function dayState(hour: number): DayState {
  const h = ((hour % 24) + 24) % 24;
  const a = ((h - 6) / 12) * Math.PI;

  // Диск солнца: восток -> зенит -> запад, с лёгким наклоном по Z,
  // чтобы тени не ложились строго вдоль осей мира.
  const sunPos = new Vector3(Math.cos(a), Math.sin(a), -0.35).normalize();
  const sunDir = sunPos.scale(-1);

  const elev = sunPos.y;
  const day = clamp01((elev - 0.12) / 0.33);
  const night = clamp01((-elev - 0.04) / 0.22);
  const dusk = clamp01(1 - day - night);
  const total = day + night + dusk || 1;
  const wd = day / total;
  const wn = night / total;
  const wk = dusk / total;

  // Ручки освещения из настроек (глобальные). При значениях по умолчанию
  // (sun/fill/night/coolShade/warm = 1) палитра выше не меняется.
  const L = LOADOUT.light;
  // warm=0 → белый, 1 → DAY.sun как есть, >1 → ещё желтее (экстраполяция).
  const warm = Math.max(0, Math.min(2, L.warm));
  const cool = clamp01(L.coolShade);
  const daySun: [number, number, number] = [
    Math.max(0, 1 + (DAY.sun[0] - 1) * warm),
    Math.max(0, 1 + (DAY.sun[1] - 1) * warm),
    Math.max(0, 1 + (DAY.sun[2] - 1) * warm),
  ];
  const dayAmb: [number, number, number] = [
    1 + (DAY.amb[0] - 1) * cool,
    1 + (DAY.amb[1] - 1) * cool,
    1 + (DAY.amb[2] - 1) * cool,
  ];

  const sun = mix3(daySun, NIGHT.sun, DUSK.sun, wd, wn, wk);
  const amb = mix3(dayAmb, NIGHT.amb, DUSK.amb, wd, wn, wk);
  // Ночной цвет тумана — из FOG_TUNE (панель ?fog=1), а не из NIGHT.fog:
  // при EXP2 туман ПОДСВЕЧИВАЕТ далёкую темень до своего цвета, и синеватый
  // NIGHT.fog читался дымкой вместо черноты.
  const fog = mix3(DAY.fog, FOG_TUNE.nightColor, DUSK.fog, wd, wn, wk);
  const disc = mix3(DAY.disc, NIGHT.disc, DUSK.disc, wd, wn, wk);
  const cloud = mix3(DAY.cloud, NIGHT.cloud, DUSK.cloud, wd, wn, wk);
  const zenith = mix3(DAY.zenith, NIGHT.zenith, DUSK.zenith, wd, wn, wk);
  const horizon = mix3(DAY.horizon, NIGHT.horizon, DUSK.horizon, wd, wn, wk);

  return {
    sunDir,
    sunPos,
    sunColor: new Color3(sun[0], sun[1], sun[2]),
    sunIntensity: (DAY.sunI * wd + NIGHT.sunI * L.night * wn + DUSK.sunI * wk) * L.sun,
    ambientColor: new Color3(amb[0], amb[1], amb[2]),
    // Днём DAY.ambI = 0; чтобы ручка `fill` всё же могла вернуть дневную
    // заливку, при fill > 1 добавляем её напрямую (на долю дня).
    ambientIntensity:
      (DAY.ambI * wd + NIGHT.ambI * L.night * wn + DUSK.ambI * wk) * L.fill +
      Math.max(0, L.fill - 1) * 0.28 * wd,
    zenith: [Math.round(zenith[0]), Math.round(zenith[1]), Math.round(zenith[2])],
    horizon: [Math.round(horizon[0]), Math.round(horizon[1]), Math.round(horizon[2])],
    fog: new Color3(fog[0], fog[1], fog[2]),
    disc: new Color3(disc[0], disc[1], disc[2]),
    cloud: new Color3(cloud[0], cloud[1], cloud[2]),
    daylight: clamp01((elev + 0.06) / 0.18),
  };
}
