/**
 * Облики героя (панель «Внешность»): skin 1..BOT.skins → модель, skin 0 — обычный рыцарь.
 * Один список для игры (client/world/models.ts: BOT_SKIN_MODELS — ключи MODELS) и для
 * картинки героя в окне снаряжения на странице !inv (без Babylon).
 */
export const SKIN_MODELS = ["charHuman"] as const;

/** Те же облики человеческим именем — для панели выбора модели (C, вкладка «Внешность»). */
export const SKIN_LABELS: readonly string[] = ["Человек"];

export type SkinModel = (typeof SKIN_MODELS)[number];

/** Единственный облик — «Человек» для всех игроков и ботов (остальные скины убраны). */
export function skinModel(_skin: number): SkinModel {
  return "charHuman";
}

/** Картинка героя в полный рост (public/inv/hero/, рендер модели в Blender, ~25 КБ) — страница !inv. */
export function skinPicture(skin: number): string {
  return `/inv/hero/${skinModel(skin)}.webp`;
}
