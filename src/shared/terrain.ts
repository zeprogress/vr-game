import { HUB, HUB_CENTER } from "./hub";

/** Сырой рельеф-шум (без площадок). */
function noise(x: number, z: number): number {
  return (
    1.4 * Math.sin(x * 0.075) * Math.cos(z * 0.068) +
    0.7 * Math.sin(x * 0.16 + 1.3) * Math.sin(z * 0.12) +
    0.35 * Math.cos((x + z) * 0.05)
  );
}

/** Высота ровной площадки под лагерем — берём рельеф в его центре. */
const HUB_PAD_Y = noise(HUB_CENTER.x, HUB_CENTER.z);

/**
 * Аналитическая высота рельефа. Общая для клиента (строит меш) и сервера
 * (симуляция мобов) — мобы должны стоять ровно на той земле, что видит игрок.
 */
export function terrainHeight(x: number, z: number): number {
  let h = noise(x, z);
  // Ближе к центру мира — площе (радиус ~16 м), у поляны ровная площадка.
  const d = Math.sqrt(x * x + z * z);
  h *= clamp01((d - 8) / 14);

  // Ровная площадка под HUB: внутри plazaRadius — строго HUB_PAD_Y, дальше
  // плавно возвращаемся к рельефу к границе campRadius.
  const hx = x - HUB_CENTER.x;
  const hz = z - HUB_CENTER.z;
  const hd = Math.sqrt(hx * hx + hz * hz);
  if (hd < HUB.campRadius + 6) {
    const t = clamp01((hd - HUB.plazaRadius) / (HUB.campRadius + 6 - HUB.plazaRadius));
    h = HUB_PAD_Y + (h - HUB_PAD_Y) * t;
  }
  return h;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
