/**
 * HUB — «Боевой лагерь». Безопасная стартовая зона В ТОЙ ЖЕ `ZoneRoom`, что и
 * поляна с мобами: не отдельная комната, не меню, без загрузочного экрана.
 *
 * Единственный источник правды про числа HUB — и клиент (геометрия, спавн),
 * и сервер (safe-зона, исключение спавна мобов) импортируют отсюда.
 *
 * Blockout v1: геометрия примитивами, координаты подогнаны под существующий
 * мир (поляна у центра (0,0), босс на (74,74)). Лагерь — на юго-западе,
 * подальше от агро-радиуса слизней; ворота смотрят на северо-восток, к поляне.
 */

/** Центр лагеря в мировых координатах (X — восток, Z — север). */
export const HUB_CENTER = { x: -55, z: -55 } as const;

export const HUB = {
  center: HUB_CENTER,

  /** Радиус центральной площади (утоптанная земля вокруг костра), м. */
  plazaRadius: 12,
  /** Радиус всего лагеря — по нему рисуем «чистую землю» и ставим периметр. */
  campRadius: 24,

  /**
   * Safe-зона: сервер не даёт мобам агриться/бить и отключает PvP, пока игрок
   * внутри. Чуть больше лагеря — чтобы у самых ворот уже было безопасно.
   * Проверяется ТОЛЬКО на сервере (клиент не может сам объявить себя в safe).
   */
  safeRadius: 27,

  /**
   * Ни один слизень/плевун не должен спавниться ближе этого к центру лагеря —
   * сервер перекидывает такие точки. Меньше safeRadius снаружи не бывает.
   */
  mobExclusionRadius: 30,

  /** Костёр в центре площади (в мировых координатах = центр лагеря). */
  campfire: {
    pos: { x: HUB_CENTER.x, y: 0, z: HUB_CENTER.z },
    /** Радиус каменного кольца, м. */
    radius: 2,
  },

  /**
   * Главные ворота — на северо-восточном краю лагеря, на линии «центр → поляна».
   * `dir` — единичный вектор наружу (к поляне), по нему кладём дорогу.
   */
  gate: {
    pos: { x: -42, z: -42 },
    dir: { x: Math.SQRT1_2, z: Math.SQRT1_2 },
    width: 6,
    height: 5,
  },

  /**
   * Утоптанная дорога от ворот к поляне. Идёт от `gate.pos` в сторону `gate.dir`
   * примерно до края существующего скопления мобов.
   */
  path: {
    length: 22,
    width: 4,
  },

  /**
   * Точки появления игрока — кольцо вокруг площади. В мировых координатах
   * (уже со смещением на центр лагеря). Сервер и клиент берут отсюда же.
   */
  spawns: [
    { x: HUB_CENTER.x - 5, z: HUB_CENTER.z - 5 },
    { x: HUB_CENTER.x + 4, z: HUB_CENTER.z - 6 },
    { x: HUB_CENTER.x - 7, z: HUB_CENTER.z + 2 },
    { x: HUB_CENTER.x + 6, z: HUB_CENTER.z + 1 },
    { x: HUB_CENTER.x - 4, z: HUB_CENTER.z + 7 },
    { x: HUB_CENTER.x + 4, z: HUB_CENTER.z + 6 },
    { x: HUB_CENTER.x - 8, z: HUB_CENTER.z - 3 },
    { x: HUB_CENTER.x + 8, z: HUB_CENTER.z - 2 },
  ] as const,

  /**
   * Тренировочная площадка: чучела (переиспользуем существующий класс Dummy —
   * без XP/лута/смерти-респавна как у мобов, только флеш по удару). Позиции
   * общие: сервер спавнит Dummy здесь, клиент рисует площадку вокруг них.
   */
  training: {
    dummies: [
      { x: HUB_CENTER.x - 12, z: HUB_CENTER.z + 1 },
      { x: HUB_CENTER.x - 13.5, z: HUB_CENTER.z + 3.5 },
      { x: HUB_CENTER.x - 13.5, z: HUB_CENTER.z - 1.5 },
      { x: HUB_CENTER.x - 16, z: HUB_CENTER.z + 6 },
      { x: HUB_CENTER.x - 16, z: HUB_CENTER.z - 4 },
    ] as const,
  },

  /**
   * Зоны лагеря — смещения от центра. Blockout наполняет их примитивами,
   * геймплей (оружейная, тренировка) подключается следующими срезами.
   */
  zones: {
    /** Оружейная: стойки с существующим sword/bow/shield/staff. */
    weapons: { x: HUB_CENTER.x + 9, z: HUB_CENTER.z + 2 },
    /** Тренировочная площадка: мишени + манекен. */
    training: { x: HUB_CENTER.x - 10, z: HUB_CENTER.z + 1 },
    /** Торговые лавки (пока декор). */
    market: { x: HUB_CENTER.x - 9, z: HUB_CENTER.z - 8 },
    /** Кузница (пока декор). */
    forge: { x: HUB_CENTER.x + 9, z: HUB_CENTER.z - 9 },
    /** Главный шатёр (позади площади, дальше от ворот). */
    mainTent: { x: HUB_CENTER.x - 3, z: HUB_CENTER.z - 12 },
    /** Смотровая башня — ориентир, видна отовсюду. */
    watchTower: { x: HUB_CENTER.x + 13, z: HUB_CENTER.z - 13 },
    /** Инструктор — у входа на тренировочную площадку. */
    instructor: { x: HUB_CENTER.x - 6, z: HUB_CENTER.z + 3 },
  },
} as const;

/** Игрок внутри безопасной зоны лагеря? Проверка — на сервере. */
export function inHubSafeZone(x: number, z: number): boolean {
  const dx = x - HUB_CENTER.x;
  const dz = z - HUB_CENTER.z;
  return dx * dx + dz * dz < HUB.safeRadius * HUB.safeRadius;
}

/** Случайная точка спавна игрока в лагере (с лёгким разбросом). */
export function hubSpawnPoint(rand: () => number = Math.random): { x: number; z: number } {
  const s = HUB.spawns[Math.floor(rand() * HUB.spawns.length)] ?? HUB.spawns[0];
  return { x: s.x + (rand() - 0.5) * 2, z: s.z + (rand() - 0.5) * 2 };
}
