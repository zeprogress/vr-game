import { HUB, HUB_CENTER } from "./hub";
import { LAKE, MOUNTAIN } from "./constants";

/** Средний радиус эллипса озера — им же меряем «метры» отмели/подъёма берега. */
export const LAKE_R_AVG = (LAKE.rx + LAKE.rz) / 2;

/**
 * «Радиус» точки (x,z) относительно эллипса озера (LAKE.rx/rz), в метрах:
 * 1 на границе эллипса — заменяет старое `Math.hypot(lx,lz)` для круга.
 * Общая для рельефа (terrain.ts) и видимой геометрии (Lake.ts) — иначе дно
 * и вода/берег разойдутся (см. LAKE в constants.ts).
 */
export function lakeEllipseDist(x: number, z: number): number {
  const lx = x - LAKE.x;
  const lz = z - LAKE.z;
  const en = Math.hypot(lx / LAKE.rx, lz / LAKE.rz); // 1.0 = на границе эллипса
  return en * LAKE_R_AVG;
}

/**
 * Настоящее расстояние (в метрах) от центра озера до кромки эллипса ИМЕННО
 * в направлении единичного вектора (nx,nz) — нужно тем, кто ставит объект
 * «у берега в такую-то сторону» (водопад/причал в Lake.ts): усреднённый
 * `LAKE_R_AVG` годится для формулы дна (она не привязана к направлению), а
 * для точной посадки объекта на реальную кромку эллипса нужен именно он.
 */
export function lakeShoreDistIn(nx: number, nz: number): number {
  const k = Math.hypot(nx / LAKE.rx, nz / LAKE.rz);
  return k > 1e-6 ? 1 / k : LAKE_R_AVG;
}

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
    // Плоская площадка на самом верху (не острый пик) — выше PLATEAU_T рост
    // высоты сохраняется на одном уровне (clamp), а не продолжает расти.
    // 0.35 — площадка ещё шире (было 0.5/0.7, всё ещё мало читалась как
    // плоское место по просьбе «сверху должно быть больше плоского»).
    const PLATEAU_T = 0.35;
    const tEff = t < PLATEAU_T ? t : PLATEAU_T;
    h += MOUNTAIN.peakHeight * tEff * tEff;

    // Русло реки — неглубокая канава вдоль линии озеро→гора (та же прямая,
    // что Lake.ts использует под водопад/реку), прорезанная поперёк склона.
    // Глубже и полнее на самом верху (на площадке), сходит на нет у подножия
    // — так река на плоской вершине течёт в настоящей выемке, а не по ровному
    // месту, и не режет траншею там, где горы ещё почти нет.
    const dxm = MOUNTAIN.x - LAKE.x;
    const dzm = MOUNTAIN.z - LAKE.z;
    const dlm = Math.hypot(dxm, dzm) || 1;
    const nx = dxm / dlm;
    const nz = dzm / dlm;
    const perpX = -nz;
    const perpZ = nx;
    const lateral = mx * perpX + mz * perpZ; // смещение от осевой линии реки
    // Половина ширины разрыва в хребте (по плану — просвет 28м, половина 14).
    const GROOVE_W = 14;
    const GROOVE_DEPTH = 3;
    const across = Math.max(0, 1 - Math.abs(lateral) / GROOVE_W);
    const groovePlateau = Math.min(1, t / PLATEAU_T);
    h -= GROOVE_DEPTH * across * across * groovePlateau;

    // Каньон-исток — там, где река «берёт начало» (глубже в плато, дальше от
    // водопада): русло сужается и резко углубляется, чтобы читалось как
    // настоящий каньон, а не просто ровная канава. Сильнее всего у самого
    // дальнего края площадки (canyonT->1), у водопада (canyonT->0) не влияет
    // — там резкий обрыв делает CLIFF_RISE ниже, это разные места одной реки.
    const CANYON_W = 10;
    const CANYON_DEPTH = 7;
    const canyonAcross = Math.max(0, 1 - Math.abs(lateral) / CANYON_W);
    const canyonT = clamp01((t - PLATEAU_T * 0.55) / (PLATEAU_T * 0.45));
    h -= CANYON_DEPTH * canyonAcross * canyonAcross * canyonT;
  }

  // Каньон-ущелье у водопада (см. референс-фото — отвесные стены по бокам
  // разрыва, а не ровный склон): ВНЕ узкого разрыва (GAP_HALF) земля резко
  // встаёт стеной на CLIFF_RISE м (та же техника, что раньше — heightmap не
  // даёт козырёк, но резкий подъём на коротком участке читается как отвес).
  // Внутри самого разрыва эту добавку не даём — там ниже (настоящий канал
  // реки/водопада, наравне с обычным склоном горы), поэтому стены выглядят
  // ощутимо выше прохода между ними.
  {
    const dxm = MOUNTAIN.x - LAKE.x;
    const dzm = MOUNTAIN.z - LAKE.z;
    const dlm = Math.hypot(dxm, dzm) || 1;
    const nx = dxm / dlm;
    const nz = dzm / dlm;
    const perpX = -nz;
    const perpZ = nx;
    const lx = x - LAKE.x;
    const lz = z - LAKE.z;
    const alongLake = lx * nx + lz * nz; // расстояние вдоль линии от центра озера
    const lateralLake = lx * perpX + lz * perpZ;
    const shoreOuter = LAKE_R_AVG + LAKE.shoreFade;
    const RISE_FADE = 10;
    const CLIFF_START = shoreOuter + RISE_FADE + 1; // сразу за настоящим берегом
    const CLIFF_W = 5;
    // Перепад — по плану 42м, стены каньона даже чуть выше плато для вида "сверху вниз".
    const CLIFF_RISE = 46;
    // Разрыв (проход воды) — половина ширины 14 (просвет 28м по плану).
    const GAP_HALF = 14;
    // Стены каньона — ПЛОСКИЕ сверху (не острый гребень): полная высота от
    // GAP_HALF до WALL_FLAT, дальше — короткий скат до WALL_HALF наружу.
    const WALL_FLAT = GAP_HALF + 18;
    const WALL_HALF = WALL_FLAT + 10;
    const absLat = Math.abs(lateralLake);
    if (absLat > GAP_HALF && absLat < WALL_HALF && alongLake > CLIFF_START) {
      const cliffT = clamp01((alongLake - CLIFF_START) / CLIFF_W);
      const innerRamp = clamp01((absLat - GAP_HALF) / 3); // короткий скат у самого разрыва
      const outerFall = absLat <= WALL_FLAT ? 1 : Math.max(0, 1 - (absLat - WALL_FLAT) / (WALL_HALF - WALL_FLAT));
      h += CLIFF_RISE * cliffT * innerRamp * outerFall;
    }
  }

  // Чаша озера — понижаем рельеф под водой, чтобы гладь (LAKE.waterY) не
  // протыкала землю по краям (вода лежит поверх готового рельефа, без
  // честной выемки/heightmap — по решению из плана). Диск воды в Lake.ts
  // ровно радиуса shoreOuter — ПОД ВСЕМ этим кругом дно строго ровное
  // (floorY), без градиента: вода и дно совпадают везде, нет ни провала
  // («висит в воздухе»), ни протыкания земли сквозь гладь. Настоящий берег
  // (подъём к обычному рельефу) начинается СРАЗУ ЗА кромкой воды, не раньше.
  const ld = lakeEllipseDist(x, z);
  const shoreOuter = LAKE_R_AVG + LAKE.shoreFade; // = радиус диска воды в Lake.ts
  const RISE_FADE = 10;
  const floorY = LAKE.waterY - 2.4; // дно чуть ниже глади
  if (ld < shoreOuter) {
    h = floorY;
  } else if (ld < shoreOuter + RISE_FADE) {
    const t = clamp01((ld - shoreOuter) / RISE_FADE); // 0 у кромки воды, 1 — обычный берег
    h = floorY + (h - floorY) * t;
  }

  return h;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
