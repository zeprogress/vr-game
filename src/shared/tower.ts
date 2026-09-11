/**
 * Охотничья башня — общие для клиента и сервера константы забега. Веса/окно
 * очереди самого СОБЫТИЯ (когда башня вообще доступна) — в `constants.ts`
 * (`EVENT.tower`). Здесь — то, что относится к ОДНОЙ попытке внутри TowerRoom.
 */
/**
 * Куда прятать тело героя в основном мире на время забега (фаза C даст
 * настоящую отдельную сцену — пока герой просто "телепортирован" далеко за
 * пределы обжитой карты, чтобы не маячить и не участвовать в бою снаружи).
 */
export const TOWER_HIDE = { x: 3000, z: 3000 } as const;

export const TOWER = {
  /** Сколько этажей всего; последний — супербосс. */
  floors: 20,
  /** Лимит времени на весь забег, с. */
  timeLimitSec: 10 * 60,
  /** Множитель мини-босса (моб этажа, но крупнее/крепче) — та же модель. */
  bossScaleMul: 3,
  bossHpMul: 6,
  bossDmgMul: 1.8,
  /** Супербосс (этаж 20) — поверх обычного мини-босса. */
  superBossScaleMul: 4,
  superBossHpMul: 14,
  superBossDmgMul: 2.6,

  // --- Числовая модель боя (фаза B, v1 — без пространства/визуала, тот
  // придёт вместе с рендером в фазе C; здесь только прогрессия сложности). ---
  hero: {
    maxHp: 150,
    dmg: 16,
    atkIntervalSec: 0.5,
    /** Доля maxHp, которой лечится герой при переходе на следующий этаж. */
    floorHealFrac: 0.25,
  },
} as const;

/** Мобов в обычной волне этажа (без мини-босса), потолок — чтобы не разрасталось. */
export function floorMobCount(floor: number): number {
  return Math.min(10, 3 + floor);
}

export function floorMobHp(floor: number): number {
  return 20 * (1 + 0.18 * (floor - 1));
}

export function floorMobDmg(floor: number): number {
  return 4 * (1 + 0.12 * (floor - 1));
}

/** Мобы бьют чуть чаще на верхних этажах, но не чаще раза в 0.6с. */
export function floorMobAtkIntervalSec(floor: number): number {
  return Math.max(0.6, 1.3 - 0.02 * floor);
}
