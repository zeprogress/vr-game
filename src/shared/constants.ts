/**
 * Единственный источник правды про игровые числа.
 * И клиент, и (позже) сервер импортируют отсюда.
 * На этапе 4 этот файл переедет в отдельный пакет `shared/`.
 */
export const PLAYER = {
  eyeHeight: 1.7, // м, высота глаз над землёй
  radius: 0.4, // м, радиус капсулы коллизий
  runSpeed: 5, // м/с
  gravity: 20, // м/с² (резче реального ради «игрового» ощущения)
  jumpSpeed: 7, // м/с стартовая скорость прыжка
  pitchClamp: 1.4, // рад (~80°), ограничение взгляда вверх/вниз
  strideLength: 1.9, // м пути между шагами (звук)
} as const;

export const LOOK = {
  mouseSensitivity: 0.002, // рад на пиксель мыши
  touchSensitivity: 0.005, // рад на пиксель пальца
} as const;

export const WORLD = {
  size: 180, // м, сторона зоны
  subdivisions: 72, // плотность сетки террейна
  treeCount: 26,
  grassCount: 2000,
  grassRadius: 22, // м вокруг спавна
} as const;

export const COMBAT = {
  equipReach: 2.6, // м, на каком расстоянии можно взять меч
  swordTipLocal: [0, 1.02, 0] as const, // локальная точка кончика клинка
  swingDuration: 0.26, // с, длительность взмаха (плоский режим)
  hitCooldown: 0.4, // с, минимум между попаданиями по одной кукле
  vrSwingSpeed: 2.6, // м/с скорости кончика, чтобы удар засчитался в VR
  vrSwooshSpeed: 8, // м/с СРЕДНЕЙ скорости кончика в окне
  vrSwooshSweep: 1.1, // рад, угол, который заметает клинок за окно (~63°)
  swooshWindow: 0.13, // с, окно усреднения
  swooshCooldown: 0.55, // с между звуками взмаха
  dummyHp: 3,
  dummyRespawn: 4, // с
  dummyHitRadius: 0.5, // м, «толщина» тела куклы (проверка отрезок-отрезок)
  hitMargin: 0.2, // м запаса, чтобы удары засчитывались уверенно
} as const;

export const BOW = {
  equipReach: 2.6, // м, взять лук
  drawTimeFlat: 0.9, // с до полного натяга (удержание ЛКМ)
  grabDistVR: 0.32, // м, на каком расстоянии от тетивы можно взяться
  maxDrawVR: 0.62, // м, полный натяг (разлёт рук)
  restDrawVR: 0.08, // м, «мёртвая зона» у тетивы
  fireThreshold: 0.08, // мин. натяг для выстрела (0..1)
  minSpeed: 8, // м/с при чуть натянутой тетиве
  maxSpeed: 60, // м/с при полном натяге
  powerCurve: 1.7, // >1 — слабый натяг стреляет заметно слабее
  drawPullFlat: 0.42, // м, на сколько уходит назад тетива при полном натяге
} as const;

export const ARROW = {
  gravity: 16, // м/с²
  maxLife: 5, // с полёта
  stuckLife: 8, // с торчит после попадания
  hitRadius: 0.12, // м добавка к «толщине» цели
  maxAlive: 16, // потолок числа стрел
} as const;

export const MOB = {
  count: 5,
  hp: 4,
  aggroRange: 16, // м, дистанция агра
  attackRange: 1.5, // м, на этой дистанции бьёт
  attackDamage: 8,
  attackCooldown: 1.3, // с
  hopInterval: 0.55, // с между прыжками
  hopSpeed: 3.6, // м/с горизонтальная скорость прыжка
  hopUp: 4.2, // м/с вертикальная
  gravity: 18,
  bodyRadius: 0.55,
  hitRadius: 0.62,
  respawn: 7, // с
  wanderRadius: 10, // м вокруг точки спавна
} as const;

export const PLAYER_HP = {
  max: 100,
  regen: 3, // ед/с восстановление
  regenDelay: 4, // с без урона до начала реген
} as const;

export const MELEE = {
  damage: 0.5, // урон кулаком (вдвое меньше меча)
  reach: 0.6, // м от кулака до цели (VR)
  flatReach: 1.7, // м перед камерой (плоский удар)
  vrSpeed: 2.4, // м/с скорости кулака, чтобы удар засчитался
  cooldown: 0.35, // с между ударами одной рукой
} as const;

export const HUD = {
  showTime: 3, // с бар здоровья полностью виден после урона
  fadeTime: 1, // с плавного исчезновения
} as const;

export const THROW = {
  gravity: 16, // м/с²
  damage: 3, // урон при попадании брошенным оружием
  maxLife: 5, // с полёта до принудительной посадки
  hitRadius: 0.28, // м добавка к «толщине» цели
  velScaleVR: 1.35, // множитель к скорости руки в VR
  flatWindup: 0.55, // с до полного замаха (удержание E в плоском режиме)
  flatMinSpeed: 9, // м/с при коротком нажатии
  flatMaxSpeed: 24, // м/с при полном замахе
} as const;

