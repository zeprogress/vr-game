/**
 * Охотничья башня — общие для клиента и сервера константы забега. Веса/окно
 * очереди самого СОБЫТИЯ (когда башня вообще доступна) — в `constants.ts`
 * (`EVENT.tower`). Здесь — то, что относится к ОДНОЙ попытке внутри TowerRoom.
 */
/**
 * Куда прятать тело героя в основном мире на время забега (фаза C даст
 * настоящую отдельную сцену — пока герой просто "телепортирован"). Высоко
 * над центром поляны, а НЕ далеко в стороне: земля/скайдом/туман построены
 * конечным куском (~WORLD.size), а скайдом сам следует за камерой — далеко
 * в стороне (за пределами этого куска) под героем нет вообще никакой
 * геометрии, и камера спектатора видела просто пустоту ("прозрачная
 * комната"). На большой высоте над обжитой землёй всё рендерится как
 * обычно (небо/туман), а сам герой — крохотная точка высоко в небе, тумана
 * достаточно, чтобы никто снизу его не разглядел.
 */
export const TOWER_HIDE = { x: 0, y: 260, z: 0 } as const;

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

  /** Арена этажа: просторный круглый зал (см. TowerArenaFx — стены+потолок). */
  arena: {
    radius: 26, // м — есть где побегать, не пятачок
    wallHeight: 20,
  },

  // --- Живая пространственная симуляция (фаза "как на поляне"): герой и
  // мобы реально бегают и сближаются, а не просто размениваются уроном по
  // таймеру. ---
  hero: {
    maxHp: 150,
    dmg: 16,
    atkIntervalSec: 0.5,
    atkRange: 1.9,
    moveSpeed: 3.4, // м/с — как у обычного игрока (PLAYER.runSpeed)
  },
  mob: {
    moveSpeed: 2.6,
    atkRange: 1.7,
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

/**
 * Этаж → модель (ключ MODELS на клиенте, см. `src/client/world/models.ts`)
 * + архетип характера — заготовка для фазы будущего апгрейда TowerArenaFx
 * (сейчас там кубы-заглушки). Правило спеки: мини-босс = та же модель,
 * просто крупнее (см. TOWER.bossScaleMul) — одна модель покрывает этаж
 * целиком. Модели скопированы из Quaternius Ultimate Monsters (см. Фазу E).
 */
export type FloorArchetype = "melee" | "ranged" | "flyer";

export interface FloorMonster {
  model: string;
  archetype: FloorArchetype;
}

export const FLOOR_MONSTERS: readonly FloorMonster[] = [
  { model: "monAlien", archetype: "melee" },
  { model: "monCat", archetype: "melee" },
  { model: "monChicken", archetype: "melee" },
  { model: "monDog", archetype: "melee" },
  { model: "monGreenBlob", archetype: "melee" },
  { model: "monMushnub", archetype: "melee" },
  { model: "monPinkBlob", archetype: "ranged" },
  { model: "monYeti", archetype: "melee" },
  { model: "monBirb", archetype: "flyer" },
  { model: "monBlueDemon", archetype: "ranged" },
  { model: "monBunny", archetype: "melee" },
  { model: "monDemon", archetype: "ranged" },
  { model: "monDino", archetype: "melee" },
  { model: "monFish", archetype: "flyer" },
  { model: "monMonkroose", archetype: "melee" },
  { model: "monOrcSkull", archetype: "ranged" },
  { model: "monTribal", archetype: "melee" },
  { model: "monNinja", archetype: "melee" },
  { model: "monAlpaking", archetype: "flyer" },
  { model: "monDragonEvolved", archetype: "ranged" }, // этаж 20 — супербосс
];

/** Модель+архетип для этажа (1-based); за пределами таблицы — последняя запись. */
export function floorMonster(floor: number): FloorMonster {
  const i = Math.min(FLOOR_MONSTERS.length, Math.max(1, floor)) - 1;
  return FLOOR_MONSTERS[i];
}
