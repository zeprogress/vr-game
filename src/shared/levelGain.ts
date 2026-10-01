/** Накопленный рост к уровню: perLevel·L + accel·L·(L-1)/2, L = level-1. */
export function levelGain(level: number, curve: { perLevel: number; accel: number }): number {
  const L = Math.max(0, Math.floor(level) - 1);
  return curve.perLevel * L + (curve.accel * L * (L - 1)) / 2;
}
