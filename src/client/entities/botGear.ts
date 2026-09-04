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

export const BOT_GEAR: { sword: GearTune; shield: GearTune; bow: GearTune; staff: GearTune } = {
  // Подобрано вживую панелью ?gear=1. Разворот щита задан углом: расчёт по
  // положению правой руки (auto) давал верную ось, но не тот наклон ремня.
  sword: { pos: [0.01, 0.105, -0.08], rot: [-0.012, -2.047, -1.052], scale: 1.7, auto: false },
  shield: { pos: [-0.1, 0.16, 0.135], rot: [-0.497, 0.633, 1.383], scale: 1.7, auto: false },
  // Ещё не подобраны — только заготовка (по образцу меча, до правки на глаз).
  // `auto` тут ничего не значит (он только для щита), но поле есть у всех.
  bow: { pos: [0, 0.1, -0.05], rot: [0, -1.57, -1.3], scale: 1.7, auto: false },
  staff: { pos: [0, 0.1, -0.05], rot: [0, 0, 0], scale: 1.7, auto: false },
};

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
