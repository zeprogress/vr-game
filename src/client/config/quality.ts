import type { ZoneQuality } from "../world/Zone";

/**
 * Пресеты рендера. У ИГРОКА выбора нет — всегда «high». Пресеты нужны
 * спектатору стрима (`?spectator=…&q=potato|low|med|high`): рендерящая машина
 * бывает слабой (Mali-G31), ей нужен облегчённый режим и кэп кадров.
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
  // med не роняет картинку (трава/светлячки почти как на high), но ночную
  // подсветку ботов режем до одного факела — вдвое дешевле по свету.
  med: { scaling: 1.15, grass: 0.5, fireflies: 0.7, leanMobs: false, botTorches: 1, fpsCap: 30 },
  high: { scaling: 1.0, grass: 1, fireflies: 1, leanMobs: false, fpsCap: 0 },
};
