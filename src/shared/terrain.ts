import { HUB, HUB_CENTER } from "./hub";
import { LAKE, MOUNTAIN, WORLD } from "./constants";
import sculptData from "./data/terrainSculpt.json";
import { reliefAt } from "./relief";
import { CAT_FLOOR_Y, CAT_Z0 as CAT_REGION_Z, inCatRegion } from "./catacombs";

/**
 * Рельеф озера/горы, слепленный вручную в редакторе (Terrain Sculptor,
 * artifact) и присланный как JSON — заменяет аналитический купол/канаву/
 * обрыв ниже ИМЕННО в этой прямоугольной области. Внутри неё пользователь
 * сам решил, где что стоит; наружу — обычный аналитический рельеф, с плавным
 * переходом по краю прямоугольника, чтобы не было шва.
 */
const SCULPT = sculptData as {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  cols: number;
  rows: number;
  heights: number[];
};

/**
 * Сдвиг всего слепленного участка (гора+озеро+водопад) в мировых координатах
 * — по просьбе «отодвинуть всю гору с водопадом и озером от лагеря», а не
 * только сам лагерь. Данные в JSON не трогаем, просто читаем их со сдвигом.
 */
const SCULPT_OFFSET = { dx: -35, dz: -25 };

/** Границы прямоугольника лепки (уже со сдвигом) — нужны Lake.ts, чтобы покрыть его целиком гранёным камнем. */
export const SCULPT_BOUNDS = {
  x0: SCULPT.x0 + SCULPT_OFFSET.dx,
  x1: SCULPT.x1 + SCULPT_OFFSET.dx,
  z0: SCULPT.z0 + SCULPT_OFFSET.dz,
  z1: SCULPT.z1 + SCULPT_OFFSET.dz,
};

/** Билинейная выборка слепленного рельефа; клампится к краю прямоугольника. */
function sampleSculpt(xIn: number, zIn: number): number {
  const x = xIn - SCULPT_OFFSET.dx;
  const z = zIn - SCULPT_OFFSET.dz;
  const { x0, x1, z0, z1, cols, rows, heights } = SCULPT;
  let fc = ((x - x0) / (x1 - x0)) * (cols - 1);
  let fr = ((z - z0) / (z1 - z0)) * (rows - 1);
  fc = fc < 0 ? 0 : fc > cols - 1.001 ? cols - 1.001 : fc;
  fr = fr < 0 ? 0 : fr > rows - 1.001 ? rows - 1.001 : fr;
  const c0 = Math.floor(fc);
  const r0 = Math.floor(fr);
  const c1 = Math.min(cols - 1, c0 + 1);
  const r1 = Math.min(rows - 1, r0 + 1);
  const tc = fc - c0;
  const tr = fr - r0;
  const h00 = heights[r0 * cols + c0];
  const h10 = heights[r0 * cols + c1];
  const h01 = heights[r1 * cols + c0];
  const h11 = heights[r1 * cols + c1];
  const h0 = h00 + (h10 - h00) * tc;
  const h1 = h01 + (h11 - h01) * tc;
  return h0 + (h1 - h0) * tr;
}

/** 0 за пределами прямоугольника лепки, 1 внутри с запасом FADE от края. */
function sculptWeight(x: number, z: number): number {
  const { x0, x1, z0, z1 } = SCULPT_BOUNDS;
  const FADE = 16;
  const wx = Math.min(x - x0, x1 - x) / FADE;
  const wz = Math.min(z - z0, z1 - z) / FADE;
  return clamp01(Math.min(wx, wz));
}

/** 0 у центра лагеря (своя флэттенинг-логика ниже), 1 за пределами его влияния. */
function hubExclude(x: number, z: number): number {
  const hd = Math.hypot(x - HUB_CENTER.x, z - HUB_CENTER.z);
  const R = HUB.campRadius + 10;
  const FADE = 20;
  return clamp01((hd - R) / FADE);
}

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

/** Сырой рельеф-шум (без площадок). 2026-10-02: волны выше + крупные пологие увалы. */
function noise(x: number, z: number): number {
  return (
    2.1 * Math.sin(x * 0.075) * Math.cos(z * 0.068) +
    1.0 * Math.sin(x * 0.16 + 1.3) * Math.sin(z * 0.12) +
    0.5 * Math.cos((x + z) * 0.05) +
    2.4 * Math.sin(x * 0.031 + 0.4) * Math.cos(z * 0.027 - 1.1)
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
  // Катакомбы (за краем карты, глубоко под землёй) — ровный каменный пол.
  if (z > CAT_REGION_Z && inCatRegion(x, z)) return CAT_FLOOR_Y;
  return terrainHeightNatural(x, z);
}

/** Природный рельеф без катакомб — по нему строится меш земли (и фартук за краем карты). */
export function terrainHeightNatural(x: number, z: number): number {
  return heightCache ? cachedHeight(x, z) : terrainHeightExact(x, z);
}

/**
 * Кеш высот для сервера: сетка HC_STEP м на всю карту (+запас), высота —
 * билинейно; за краем сетки — точная формула. Точная формула (шум + рельеф +
 * озеро + гора + слепок) стоила ~⅓ CPU сервера: её звали тысячи раз за тик
 * (каждый шаг моба/бота, canClimb — дважды). Рельеф неизменен — сетку
 * считаем один раз при старте (~1.5 с, ~9 МБ). Клиент кеш НЕ включает — меш
 * строится по точной формуле.
 */
const HC_STEP = 0.25;
const HC_HALF = WORLD.size / 2 + 8;
const HC_N = Math.ceil((HC_HALF * 2) / HC_STEP) + 2;
let heightCache: Float32Array | null = null;

/** Включить кеш высот (сервер, один раз при старте). */
export function enableTerrainHeightCache(): void {
  if (heightCache) return;
  const g = new Float32Array(HC_N * HC_N);
  for (let j = 0; j < HC_N; j++) {
    const z = j * HC_STEP - HC_HALF;
    for (let i = 0; i < HC_N; i++) g[j * HC_N + i] = terrainHeightExact(i * HC_STEP - HC_HALF, z);
  }
  heightCache = g;
}

function cachedHeight(x: number, z: number): number {
  const fx = (x + HC_HALF) / HC_STEP;
  const fz = (z + HC_HALF) / HC_STEP;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  if (ix < 0 || iz < 0 || ix >= HC_N - 1 || iz >= HC_N - 1) return terrainHeightExact(x, z);
  const u = fx - ix;
  const v = fz - iz;
  const g = heightCache!;
  const k = iz * HC_N + ix;
  const h00 = g[k];
  const h10 = g[k + 1];
  const h01 = g[k + HC_N];
  const h11 = g[k + HC_N + 1];
  return (h00 + (h10 - h00) * u) * (1 - v) + (h01 + (h11 - h01) * u) * v;
}

/** Точная высота по формуле (без кеша). */
export function terrainHeightExact(x: number, z: number): number {
  let h = noise(x, z);
  // Ближе к центру мира — площе (радиус ~16 м), у поляны ровная площадка.
  const d = Math.sqrt(x * x + z * z);
  h *= clamp01((d - 8) / 14);
  // Холмы, столовые горы, ямы и гряды (shared/relief.ts) — вне лагеря, центра и озера с горой.
  h += reliefAt(x, z);

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

  // Слепленный вручную рельеф — берёт верх над всем аналитическим блоком
  // выше (гора/канава/обрыв/чаша) внутри своего прямоугольника, кроме зоны
  // вокруг HUB (та в этом прямоугольнике тоже оказалась, но её трогать
  // нельзя — общий лагерь у спавна, не эта локация).
  const w = sculptWeight(x, z) * hubExclude(x, z);
  if (w > 0) {
    const hs = sampleSculpt(x, z);
    h = h + (hs - h) * w;
  }

  return h;
}

/**
 * Предельная крутизна подъёма (тангенс угла; 1 = 45°). Круче — не забраться
 * НИКОМУ: героям, ботам, мобам, боссам (летуны не в счёт). Спускаться можно
 * всегда — поэтому ямы пологие (см. relief.ts), чтобы из них можно было выйти.
 */
export const MAX_CLIMB = 1;
/** Длина «щупа» вперёд по ходу, м — крутизна меряется на ней, а не на шаге кадра. */
const CLIMB_PROBE = 0.5;

/** Можно ли идти из (x,z) в направлении (dx,dz): подъём впереди не круче MAX_CLIMB. */
export function canClimb(x: number, z: number, dx: number, dz: number): boolean {
  const l = Math.hypot(dx, dz);
  if (l < 1e-6) return true;
  const px = x + (dx / l) * CLIMB_PROBE;
  const pz = z + (dz / l) * CLIMB_PROBE;
  return terrainHeight(px, pz) - terrainHeight(x, z) <= MAX_CLIMB * CLIMB_PROBE;
}

/**
 * Шаг (dx,dz) из (x,z) с учётом крутизны: целиком, иначе вдоль одной оси
 * (скольжение вдоль склона), иначе стоим. Возвращает разрешённый шаг.
 */
export function climbStep(x: number, z: number, dx: number, dz: number): [number, number] {
  if (canClimb(x, z, dx, dz)) return [dx, dz];
  const okX = dx !== 0 && canClimb(x, z, dx, 0);
  const okZ = dz !== 0 && canClimb(x, z, 0, dz);
  return [okX ? dx : 0, okZ ? dz : 0];
}

/**
 * Перенос по прямой (рывок, прыжок, телепорт): докуда можно дойти из
 * (x0,z0) к (x1,z1), не забираясь на крутое, — шагами по полметра.
 */
export function reachAlong(x0: number, z0: number, x1: number, z1: number): [number, number] {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const L = Math.hypot(dx, dz);
  if (L < 1e-6) return [x1, z1];
  const n = Math.ceil(L / CLIMB_PROBE);
  let x = x0;
  let z = z0;
  for (let i = 0; i < n; i++) {
    if (!canClimb(x, z, dx, dz)) return [x, z];
    const k = Math.min(CLIMB_PROBE, L - i * CLIMB_PROBE);
    x += (dx / L) * k;
    z += (dz / L) * k;
  }
  return [x1, z1];
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
