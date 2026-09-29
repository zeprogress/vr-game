/**
 * Цвет уровня моба относительно уровня героя — как в WoW:
 * красный (+5 и выше) · оранжевый (+3..+4) · жёлтый (±2) · зелёный (ниже) ·
 * серый (на 10+ ниже — «не стоит времени»).
 */
export function difficultyRgb(mobLevel: number, heroLevel: number): [number, number, number] {
  const d = mobLevel - heroLevel;
  if (d >= 5) return [1, 0.22, 0.2];
  if (d >= 3) return [1, 0.55, 0.15];
  if (d >= -2) return [1, 0.86, 0.22];
  if (d > -10) return [0.35, 0.9, 0.35];
  return [0.62, 0.62, 0.62];
}

export function difficultyCss(mobLevel: number, heroLevel: number): string {
  const [r, g, b] = difficultyRgb(mobLevel, heroLevel);
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
}
