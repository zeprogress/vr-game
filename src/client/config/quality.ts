import type { ZoneQuality } from "../world/Zone";

/**
 * Пресеты рендера. Игрок выбирает low/med/high в меню (2026-10-08; по умолчанию телефон — med,
 * ПК и шлем — high), спектатор — `?spectator=…&q=potato|low|med|high`.
 */
export type Quality = "potato" | "low" | "med" | "high";

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
  // med (телефон по умолчанию): без травы, светлячков вдвое меньше, ночью один факел ботов.
  med: { scaling: 1.15, grass: 0, fireflies: 0.5, leanMobs: false, botTorches: 1, fpsCap: 30 },
  high: { scaling: 1.0, grass: 1, fireflies: 1, leanMobs: false, fpsCap: 0 },
};

const QUALITY_KEY = "zep.quality";
export const QUALITY_LABEL: Record<Exclude<Quality, "potato">, string> = { low: "Низкое", med: "Среднее", high: "Высокое" };

/** Качество игрока: выбор из меню (на устройстве), иначе телефон — med, ПК и шлем — high. */
export function playerQuality(touch: boolean): Quality {
  try {
    const v = localStorage.getItem(QUALITY_KEY);
    if (v === "low" || v === "med" || v === "high") return v;
  } catch {
    /* приватный режим */
  }
  return touch && !/OculusBrowser|Quest|Pico/i.test(navigator.userAgent) ? "med" : "high";
}

export function savePlayerQuality(q: Quality): void {
  try {
    localStorage.setItem(QUALITY_KEY, q);
  } catch {
    /* приватный режим — до перезагрузки */
  }
}
