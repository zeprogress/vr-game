/**
 * Аналитическая высота рельефа. Общая для клиента (строит меш) и сервера
 * (симуляция мобов) — мобы должны стоять ровно на той земле, что видит игрок.
 */
export function terrainHeight(x: number, z: number): number {
  const h =
    1.4 * Math.sin(x * 0.075) * Math.cos(z * 0.068) +
    0.7 * Math.sin(x * 0.16 + 1.3) * Math.sin(z * 0.12) +
    0.35 * Math.cos((x + z) * 0.05);
  // Ближе к центру — площе (радиус ~16 м), у спавна ровная площадка.
  const d = Math.sqrt(x * x + z * z);
  const flat = clamp01((d - 8) / 14);
  return h * flat;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
