import { HUB, HUB_CENTER } from "./hub";
import { LAKE, MOUNTAIN } from "./constants";

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
 * бугры сантиметров на 20. У костра и на тропе к воротам земля вытоптана
 * ровно (см. `troddenAt`), туда бугры не доходят.
 *
 * Частоты специально НЕВЫСОКИЕ (волна 20+ м): у пола лагеря (hubGround,
 * HubBlockout.ts) своя частая сетка и он следует этой функции точно, а вот
 * основная земля под ним — редкая сетка шагом 2.5 м (Terrain.ts) и линейно
 * интерполирует между вершинами. Короткие волны (было 6-9 м — 2-3 отсчёта
 * на период) она отслеживала с заметной ошибкой, и в впадинах бугра земля
 * протыкала пол лагеря снизу. На длинной волне сетка попадает в неё
 * достаточно точно, и ошибка интерполяции меньше зазора пола (0.04 м).
 */
function hubBump(x: number, z: number): number {
  return (
    0.62 * Math.sin(x * 0.13 + 0.7) * Math.cos(z * 0.11) +
    0.28 * Math.sin((x - z) * 0.19 + 2.1) +
    0.18 * Math.cos(x * 0.24) * Math.sin(z * 0.21 + 1.4)
  );
}

/**
 * Насколько земля лагеря «вытоптана» в этой точке (0..1): 1 — плотно
 * утоптано (площадь у костра), 0 — обычная бугристая земля.
 * Используют и террейн (гасит бугры), и клиент (красит землю).
 */
export function troddenAt(x: number, z: number): number {
  const dFire = Math.hypot(x - HUB.campfire.pos.x, z - HUB.campfire.pos.z);
  return clamp01((12 - dFire) / 4); // круг у костра
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
  const HUB_RELIEF_KEEP = 0.35; // доля природного рельефа, остающаяся в лагере — не пирог
  if (hd < HUB.campRadius + HUB_FADE) {
    const t = clamp01((hd - HUB.campRadius) / HUB_FADE);
    const pad = HUB_PAD_Y + hubBump(x, z) * 0.22 * (1 - troddenAt(x, z));
    const blend = HUB_RELIEF_KEEP + (1 - HUB_RELIEF_KEEP) * t;
    h = pad + (h - pad) * blend;
  }

  // Гора за озером (см. LAKE/MOUNTAIN в constants.ts) — плавный конус, растёт
  // от обычного рельефа к пику по мере приближения к центру горы. Не стена:
  // склон сходит на нет за MOUNTAIN.radius, как у HUB-площадки.
  const mx = x - MOUNTAIN.x;
  const mz = z - MOUNTAIN.z;
  const md = Math.sqrt(mx * mx + mz * mz);
  if (md < MOUNTAIN.radius) {
    const t = 1 - md / MOUNTAIN.radius; // 0 у подножия, 1 в центре пика
    // Плавный купол (не конус «домиком»): quadratic ease — подножие мягче.
    h += MOUNTAIN.peakHeight * t * t;
  }

  // Чаша озера — понижаем рельеф под водой, чтобы гладь (LAKE.waterY) не
  // протыкала землю по краям (вода просто лежит поверх готового рельефа,
  // без честной выемки/heightmap — по решению из плана, тут только мягкое
  // притягивание высоты ко дну внутри радиуса).
  const lx = x - LAKE.x;
  const lz = z - LAKE.z;
  const ld = Math.sqrt(lx * lx + lz * lz);
  const LAKE_FADE = 8;
  if (ld < LAKE.radius + LAKE_FADE) {
    const floorY = LAKE.waterY - 2.2; // дно чуть ниже глади
    const t = clamp01((ld - LAKE.radius) / LAKE_FADE); // 0 в центре, 1 на кромке
    h = floorY + (h - floorY) * t;
  }

  return h;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
