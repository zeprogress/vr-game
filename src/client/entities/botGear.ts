/**
 * Живая настройка хвата оружия у ботов.
 *
 * Меч и щит садятся в кость кулака, и подобрать посадку «по числам» вслепую
 * не выходит: модель из пака приходит со своим разворотом от загрузчика glTF.
 * Поэтому значения живут здесь, в изменяемом объекте, а панель `?gear=1`
 * (см. ui/GearTuner) двигает их прямо в игре — без пересборки и без деплоя.
 *
 * Дефолты здесь — то, что уедет в прод. Панель показывает готовый кусок кода,
 * чтобы подобранное можно было вписать сюда же.
 */
export type GearTune = {
  pos: [number, number, number];
  rot: [number, number, number];
  scale: number;
  /**
   * Только щит: разворот не задан углом, а считается при посадке по положению
   * правой руки (RemoteAvatar.shieldRotFor). Как только крутим слайдер `rot`,
   * панель снимает флаг и углы начинают действовать напрямую.
   */
  auto: boolean;
};

export const BOT_GEAR: Record<"sword" | "shield" | "bow" | "staff" | "dagger" | "spear" | "hammer", GearTune> = {
  // Подобрано вживую панелью ?gear=1. Разворот щита задан углом: расчёт по
  // положению правой руки (auto) давал верную ось, но не тот наклон ремня.
  sword: { pos: [0.01, 0.105, -0.08], rot: [-0.012, -2.047, -1.052], scale: 1.7, auto: false },
  shield: { pos: [-0.1, 0.16, 0.135], rot: [1.719, 0.633, 1.383], scale: 1.7, auto: false },
  // `auto` тут ничего не значит (он только для щита), но поле есть у всех.
  bow: { pos: [-0.063, 0.251, 0.165], rot: [1.354, -1.688, -1.365], scale: 1.7, auto: false },
  staff: { pos: [0, 0.1, -0.05], rot: [1.426, -0.333, -0.1], scale: 1.7, auto: false },
  // «Классы 2.0»: хват как у меча (клинок/древко поперёк кулака), клипы классов
  // (world/classPoses) доворачивают кулак под нужное направление оружия.
  dagger: { pos: [0.01, 0.105, -0.08], rot: [-0.012, -2.047, -1.052], scale: 1.7, auto: false },
  spear: { pos: [0.01, 0.105, -0.08], rot: [-0.012, -2.047, -1.052], scale: 1.7, auto: false },
  hammer: { pos: [0.01, 0.105, -0.08], rot: [-0.012, -2.047, -1.052], scale: 1.7, auto: false },
};

export type GearKind = keyof typeof BOT_GEAR;
export type Seat3 = { pos: [number, number, number]; rot: [number, number, number]; scale: number };

/**
 * Посадки под скелет конкретной модели — у кого кулак устроен не как у Quaternius. У Человека (charHuman) кисть
 * в T-позе ладонью вниз: рукоять идёт вдоль локальной X кисти (у рыцаря — вдоль Z), и у левой руки ось зеркальна,
 * поэтому посадка — своя для каждой руки. Числа — перенос посадок BOT_GEAR в оси кулака Человека (та же ориентация
 * относительно большого пальца и костяшек), центр рукояти — по согнутым пальцам клипа Fist
 * (tools/blender/human/grip.py). Масштаб — BOT_GEAR × 0.36 (рост модели 1.15 / рыцаря 3.2).
 */
// <model-seats> — блок переписывает лаборатория (кнопка «Сохранить в код», POST /__model-seats)
export const MODEL_SEATS: Record<string, Partial<Record<GearKind, { R: Seat3; L: Seat3 }>>> = {
  charHuman: {
    sword: {
      R: { pos: [0.019, 0.026, -0.001], rot: [0.1334, 2.4534, -1.0166], scale: 0.558 },
      L: { pos: [-0.0089, 0.0545, -0.0234], rot: [0.019, -0.277, -0.991], scale: 0.612 },
    },
    dagger: {
      R: { pos: [-0.005, 0.0505, -0.0212], rot: [0.027, 2.427, -0.976], scale: 0.612 },
      L: { pos: [0.011, 0.038, -0.016], rot: [0.019, -0.277, -0.991], scale: 0.612 },
    },
    spear: {
      R: { pos: [-0.091, 0.147, -0.128], rot: [0.027, 2.427, -0.976], scale: 0.654 },
      L: { pos: [-0.0089, 0.0545, -0.0234], rot: [0.019, -0.277, -0.991], scale: 0.612 },
    },
    hammer: {
      R: { pos: [0.048, 0.01, 0.013], rot: [0.027, 2.5784, -0.976], scale: 0.566 },
      L: { pos: [-0.0089, 0.0545, -0.0234], rot: [0.019, -0.277, -0.991], scale: 0.612 },
    },
    shield: {
      R: { pos: [-0.0511, 0.0768, -0.0775], rot: [1.477, 2.527, -1.193], scale: 0.612 },
      L: { pos: [0, 0.054, 0.011], rot: [0.7734, 0.2634, 0.3284], scale: 0.6 },
    },
    bow: {
      R: { pos: [-0.062, 0.1104, -0.0665], rot: [1.348, -3.115, -0.973], scale: 0.612 },
      L: { pos: [0.037, 0.06, -0.0143], rot: [1.5284, 0.0234, 1.7534], scale: 0.55 },
    },
    staff: {
      R: { pos: [0.2, -0.002, 0.082], rot: [1.344, -2.02, 0.024], scale: 0.612 },
      L: { pos: [0.0025, 0.0534, -0.022], rot: [1.36, 1.542, 0.007], scale: 0.612 },
    },
  },
};
// </model-seats>

/** Метка на кости кулака (ставит loadRig): чья это модель и во сколько раз её скелет меньше рыцаря. */
type FistMeta = { gearModel?: string; gearFit?: number };

/**
 * Посадка оружия `kind` в кулаке `fist` (рука `side`): своя у модели (MODEL_SEATS), иначе BOT_GEAR (её двигает
 * панель `?gear=1`), сдвиг и масштаб — по размеру скелета. Одна точка для своего героя, ботов, лаборатории и поз классов.
 */
export function seatFor(kind: GearKind, fist: { metadata?: unknown } | null | undefined, side: "R" | "L", base: GearTune = BOT_GEAR[kind]): GearTune {
  const md = (fist?.metadata ?? {}) as FistMeta;
  const own = md.gearModel ? MODEL_SEATS[md.gearModel]?.[kind]?.[side] : undefined;
  if (own) return { ...own, auto: false };
  const k = md.gearFit ?? 1;
  return k === 1 ? base : { ...base, pos: [base.pos[0] * k, base.pos[1] * k, base.pos[2] * k], scale: base.scale * k };
}

/** Своя посадка модели этого кулака для оружия kind (изменяемая — её двигают ползунки лаборатории), или null. */
export function modelSeat(fist: { metadata?: unknown } | null | undefined, kind: GearKind, side: "R" | "L"): Seat3 | null {
  const md = (fist?.metadata ?? {}) as FistMeta;
  return (md.gearModel && MODEL_SEATS[md.gearModel]?.[kind]?.[side]) || null;
}

/**
 * Заморозка бота на время настройки: он стоит на месте, анимация встаёт на
 * выбранном кадре. Только клиент — сервер продолжает водить бота, поэтому
 * после снятия заморозки тот окажется там, куда успел дойти.
 */
export const GEAR_FREEZE: { on: boolean; clip: string; frame: number } = {
  on: false,
  clip: "idle",
  frame: 0,
};

const KEY = "zep.botgear";

/** Подхватываем подобранное после перезагрузки — иначе настройка теряется. */
export function loadGearTune(): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const v = JSON.parse(raw) as Partial<typeof BOT_GEAR>;
    for (const k of ["sword", "shield", "bow", "staff"] as const) {
      const s = v[k];
      if (!s) continue;
      const d = BOT_GEAR[k];
      if (Array.isArray(s.pos) && s.pos.length === 3) d.pos = [...s.pos] as GearTune["pos"];
      if (Array.isArray(s.rot) && s.rot.length === 3) d.rot = [...s.rot] as GearTune["rot"];
      if (Number.isFinite(s.scale)) d.scale = s.scale as number;
      if (typeof s.auto === "boolean") d.auto = s.auto;
    }
  } catch {
    /* приватный режим/битый JSON — просто берём дефолты */
  }
}

export function saveGearTune(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(BOT_GEAR));
  } catch {
    /* не критично */
  }
}

/** Аватары подписываются, чтобы пересадить оружие сразу после правки. */
const listeners = new Set<() => void>();

export function onGearTuneChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifyGearTuneChanged(): void {
  for (const fn of listeners) fn();
}
