/**
 * Личные настройки игрока (меню на левой руке, вкладка «Настройки»). Хранятся у
 * него в браузере/шлеме (localStorage) — у каждого свои, админам отдельного
 * права на общие значения больше нет.
 *  • vignette — виньетка (тоннель) при движении стиком: по умолчанию ВКЛ;
 *  • teleport — перемещение телепортом вместо стика: по умолчанию ВЫКЛ;
 *  • music / sfx — громкость музыки и эффектов, 0..1;
 *  • mic — микрофон включён; spatial — голоса игроков «по месту» (иначе ровно).
 */
export interface VrSettings {
  vignette: boolean;
  teleport: boolean;
  music: number;
  sfx: number;
  mic: boolean;
  spatial: boolean;
}

const KEY = "zepVrSettings";

const DEFAULTS: VrSettings = { vignette: true, teleport: false, music: 1, sfx: 1, mic: true, spatial: true };

function load(): VrSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<VrSettings>;
      return {
        vignette: typeof v.vignette === "boolean" ? v.vignette : DEFAULTS.vignette,
        teleport: typeof v.teleport === "boolean" ? v.teleport : DEFAULTS.teleport,
        music: clamp01(v.music, DEFAULTS.music),
        sfx: clamp01(v.sfx, DEFAULTS.sfx),
        mic: typeof v.mic === "boolean" ? v.mic : DEFAULTS.mic,
        spatial: typeof v.spatial === "boolean" ? v.spatial : DEFAULTS.spatial,
      };
    }
  } catch {
    /* приватный режим и т.п. — работаем с умолчаниями */
  }
  return { ...DEFAULTS };
}

function clamp01(v: unknown, d: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d;
}

export const VR_SETTINGS: VrSettings = load();

const listeners = new Set<() => void>();

/** Подписка на изменения (Game применяет громкость и т.п.). Возвращает отписку. */
export function onVrSettingsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Поменять настройки и сохранить. */
export function setVrSettings(patch: Partial<VrSettings>): void {
  Object.assign(VR_SETTINGS, patch);
  VR_SETTINGS.music = clamp01(VR_SETTINGS.music, 1);
  VR_SETTINGS.sfx = clamp01(VR_SETTINGS.sfx, 1);
  try {
    localStorage.setItem(KEY, JSON.stringify(VR_SETTINGS));
  } catch {
    /* не сохранилось — на этот сеанс всё равно применено */
  }
  for (const l of listeners) l();
}
