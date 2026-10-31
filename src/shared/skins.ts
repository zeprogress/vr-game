/**
 * Облики героя (панель «Внешность»): skin 1..BOT.skins → модель, skin 0 — обычный рыцарь.
 * Один список для игры (client/world/models.ts: BOT_SKIN_MODELS — ключи MODELS) и для
 * картинки героя в окне снаряжения на странице !inv (без Babylon).
 */
export const SKIN_MODELS = ["charHuman", "charElf"] as const;

/** Те же облики человеческим именем — для панели выбора модели (C, вкладка «Внешность»). */
export const SKIN_LABELS: readonly string[] = ["Человек", "Эльф"];

export type SkinModel = (typeof SKIN_MODELS)[number];

/**
 * Облик по номеру скина (1 — Человек, 2 — Эльф). Числа вне диапазона заворачиваются по кругу,
 * 0 и меньше — Человек, как раньше.
 */
export function skinModel(skin: number): SkinModel {
  const n = Math.floor(skin);
  if (!Number.isFinite(n) || n < 1) return "charHuman";
  return SKIN_MODELS[(n - 1) % SKIN_MODELS.length];
}

/** Картинка героя в полный рост (public/inv/hero/, рендер модели в Blender, ~25 КБ) — страница !inv. */
export function skinPicture(skin: number): string {
  return `/inv/hero/${skinModel(skin)}.webp`;
}
