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
 * Мелкие неровности земли лагеря: не бильярдный стол, но и не рельеф —
 * бугры сантиметров на 20, короткая волна. У костра и на тропе к воротам
 * земля вытоптана ровно (см. `troddenAt`), туда бугры не доходят.
 */
function hubBump(x: number, z: number): number {
  return (
    0.62 * Math.sin(x * 0.42 + 0.7) * Math.cos(z * 0.37) +
    0.28 * Math.sin((x - z) * 0.71 + 2.1) +
    0.18 * Math.cos(x * 1.05) * Math.sin(z * 0.93 + 1.4)
  );
}

/** Расстояние от точки до отрезка (для «вытоптанной» тропы к воротам). */
function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax;
  const vz = bz - az;
  const len2 = vx * vx + vz * vz || 1;
  const t = clamp01(((px - ax) * vx + (pz - az) * vz) / len2);
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

/**
 * Насколько земля лагеря «вытоптана» в этой точке (0..1): 1 — плотно
 * утоптано (площадь у костра и тропа к воротам), 0 — обычная бугристая земля.
 * Используют и террейн (гасит бугры), и клиент (красит землю).
 */
export function troddenAt(x: number, z: number): number {
  const dFire = Math.hypot(x - HUB.campfire.pos.x, z - HUB.campfire.pos.z);
  const plaza = clamp01((12 - dFire) / 4); // круг у костра
  const dPath = distToSegment(
    x,
    z,
    HUB_CENTER.x,
    HUB_CENTER.z,
    HUB.gate.pos.x + HUB.gate.dir.x * 6,
    HUB.gate.pos.z + HUB.gate.dir.z * 6,
  );
  const path = clamp01((4.5 - dPath) / 3); // тропа к воротам
  return Math.max(plaza, path);
}

/**
 * Аналитическая высота рельефа. Общая для клиента (строит меш) и сервера
 * (симуляция мобов) — мобы должны стоять ровно на той земле, что видит игрок.
 */
export function terrainHeight(x: number, z: number): number {
  let h = noise(x, z);
  // Ближе к центру мира — площе (радиус ~16 м), у поляны ровная площадка.
  const d = Math.sqrt(x * x + z * z);
  h *= clamp01((d - 8) / 14);

  // Площадка под ВЕСЬ HUB: рельеф гасим до уровня лагеря, но не в идеальную
  // плоскость — оставляем мелкие бугры (hubBump). У костра и на тропе к
  // воротам земля вытоптана: там бугры сходят на нет.
  const hx = x - HUB_CENTER.x;
  const hz = z - HUB_CENTER.z;
  const hd = Math.sqrt(hx * hx + hz * hz);
  const HUB_FADE = 10;
  if (hd < HUB.campRadius + HUB_FADE) {
    const t = clamp01((hd - HUB.campRadius) / HUB_FADE);
    const pad = HUB_PAD_Y + hubBump(x, z) * 0.22 * (1 - troddenAt(x, z));
    h = pad + (h - pad) * t;
  }
  return h;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
