import type { ZoneQuality } from "../world/Zone";

/** Пресеты качества под слабое железо. `?q=potato|low|med|high`. */
export type Quality = "potato" | "low" | "med" | "high";

/** localStorage: качество, выбранное игроком на экране входа. */
export const QUALITY_KEY = "qualityPref";

/** Подписи пресетов для переключателя на экране входа (от слабого к сильному). */
export const QUALITY_LABELS: readonly { q: Quality; label: string }[] = [
  { q: "potato", label: "Минимум" },
  { q: "low", label: "Низкое" },
  { q: "med", label: "Среднее" },
  { q: "high", label: "Высокое" },
];

export interface Preset extends ZoneQuality {
  /** engine.setHardwareScalingLevel — >1 рендерит в меньшем разрешении. */
  scaling: number;
  /** 0 — без ограничения кадров. */
  fpsCap: number;
  /** true — облегчённые мобы (без плашек, полосок HP, ран). */
  leanMobs: boolean;
}

export const PRESETS: Record<Quality, Preset> = {
  // Совсем слабый GPU (Mali-G31): без травы, светлячков, облаков; 2 света;
  // мобы облегчённые.
  potato: {
    scaling: 2.2,
    grass: 0,
    fireflies: 0,
    minLights: true,
    simpleSky: true,
    leanMobs: true,
    botTorches: false,
    fpsCap: 30,
  },
  low: {
    scaling: 1.5,
    grass: 0,
    fireflies: 0,
    minLights: true,
    simpleSky: true,
    leanMobs: true,
    botTorches: false,
    fpsCap: 30,
  },
  // med не роняет картинку (трава/светлячки почти как на high), но ночную
  // подсветку ботов режем до одного факела — вдвое дешевле по свету.
  med: { scaling: 1.15, grass: 0.5, fireflies: 0.7, leanMobs: false, botTorches: 1, fpsCap: 30 },
  high: { scaling: 1.0, grass: 1, fireflies: 1, leanMobs: false, fpsCap: 0 },
};

/** Валидировать строку из `?q=` или localStorage. */
export function asQuality(v: string | null): Quality | null {
  return v === "potato" || v === "low" || v === "med" || v === "high" ? v : null;
}

/**
 * На телефоне выше «Среднего» не пускаем — тянет только на слабых.
 * `restrict` = устройство с тач-вводом, но без иммерсивного WebXR (т.е. не шлем).
 */
export function clampQuality(q: Quality, restrict: boolean): Quality {
  return restrict && q === "high" ? "med" : q;
}
