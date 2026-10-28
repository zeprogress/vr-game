/**
 * Облики героя (панель «Внешность»): skin 1..BOT.skins → модель, skin 0 — обычный рыцарь.
 * Один список для игры (client/world/models.ts: BOT_SKIN_MODELS — ключи MODELS) и для
 * картинки героя в окне снаряжения на странице !inv (без Babylon).
 */
export const SKIN_MODELS = [
  "charKnight",
  "charKnightGold",
  "charWizard",
  "charNinja",
  "charGoblin",
  "charPirate",
  "charViking",
  "charZombie",
  "charSoldier",
  "charCowboy",
  "charHuman",
] as const;

/** Те же облики человеческим именем — для панели выбора модели (C, вкладка «Внешность»). */
export const SKIN_LABELS: readonly string[] = ["Рыцарь", "Золотой рыцарь", "Маг", "Ниндзя", "Гоблин", "Пират", "Викинг", "Зомби", "Солдат", "Ковбой", "Человек"];

export type SkinModel = (typeof SKIN_MODELS)[number];

export function skinModel(skin: number): SkinModel {
  return skin >= 1 ? SKIN_MODELS[(skin - 1) % SKIN_MODELS.length] : "charKnight";
}

/** Картинка героя в полный рост (public/inv/hero/, рендер модели в Blender, ~25 КБ) — страница !inv. */
export function skinPicture(skin: number): string {
  return `/inv/hero/${skinModel(skin)}.webp`;
}
