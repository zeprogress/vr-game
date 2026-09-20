/**
 * Личные настройки игрока (меню на левой руке, вкладка «Настройки»). Хранятся у
 * него в браузере/шлеме (localStorage) — у каждого свои, админам отдельного
 * права на общие значения больше нет.
 *  • vignette — виньетка (тоннель) при движении стиком: по умолчанию ВКЛ;
 *  • teleport — перемещение телепортом вместо стика: по умолчанию ВЫКЛ;
 *  • music / sfx — громкость музыки и эффектов, 0..1;
 *  • mic — микрофон включён (по умолчанию ВЫКЛ); spatial — голоса «по месту» (по умолчанию ВЫКЛ).
 */
export interface VrSettings {
  vignette: boolean;
  teleport: boolean;
  music: number;
  sfx: number;
  mic: boolean;
  spatial: boolean;
  /** Слышать озвучку чата Twitch (когда её включил стример). */
  tts: boolean;
}

const KEY = "zepVrSettings";
/** Версия умолчаний: при повышении микрофон и «по месту» один раз сбрасываются в новые умолчания. */
const VER_KEY = "zepVrSettingsVer";
const VER = 2;

const DEFAULTS: VrSettings = { vignette: true, teleport: false, music: 1, sfx: 1, mic: false, spatial: false, tts: true };

function load(): VrSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<VrSettings>;
      if (localStorage.getItem(VER_KEY) !== String(VER)) {
        v.mic = DEFAULTS.mic;
        v.spatial = DEFAULTS.spatial;
        localStorage.setItem(VER_KEY, String(VER));
      }
      return {
        vignette: typeof v.vignette === "boolean" ? v.vignette : DEFAULTS.vignette,
        teleport: typeof v.teleport === "boolean" ? v.teleport : DEFAULTS.teleport,
        music: clamp01(v.music, DEFAULTS.music),
        sfx: clamp01(v.sfx, DEFAULTS.sfx),
        mic: typeof v.mic === "boolean" ? v.mic : DEFAULTS.mic,
        spatial: typeof v.spatial === "boolean" ? v.spatial : DEFAULTS.spatial,
        tts: typeof v.tts === "boolean" ? v.tts : DEFAULTS.tts,
      };
    }
    localStorage.setItem(VER_KEY, String(VER));
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
