import { WORLD } from "./constants";
import { HUB_CENTER } from "./hub";

/**
 * Катакомбы — событие для пати (от CATACOMBS.minParty героев): сбор в чате
 * и через портал в лагере, затем телепорт в цепочку подземных залов. Это НЕ
 * отдельная комната (как башня), а участок того же мира за краем карты
 * (сам ZoneRoom, те же мобы/удары/умения/лут) — всё, что меняется в игре,
 * работает и здесь.
 *
 * Геометрия — цепочка круглых залов вдоль оси +Z (x = 0), соединённых
 * прямыми коридорами. Проходы закрыты решётками: открыт только путь от
 * зала `lo` до зала `hi` (состояние catLo/catHi в RoomState). Стоять можно
 * только внутри открытых залов и коридоров — см. catProject.
 */

export interface CatHall {
  /** Центр зала. */
  x: number;
  z: number;
  /** Радиус пола (стены — по нему). */
  r: number;
  /** Имя для титров. */
  name: string;
}

/** Начало участка катакомб по Z: всё, что дальше (и в пределах |x| < CAT_HALF_X), — подземелье. */
export const CAT_Z0 = WORLD.size / 2 + 60;
const CAT_HALF_X = 40;

/** Залы по порядку прохождения. */
export const CAT_HALLS: readonly CatHall[] = [
  { x: 0, z: CAT_Z0 + 30, r: 22, name: "Преддверие" },
  { x: 0, z: CAT_Z0 + 92, r: 26, name: "Костница" },
  { x: 0, z: CAT_Z0 + 158, r: 26, name: "Огненный склеп" },
  { x: 0, z: CAT_Z0 + 228, r: 30, name: "Трон Бездны" },
];

/** Полуширина коридора между залами, м. */
export const CAT_CORRIDOR_HALF = 4.5;
/** Высота пола подземелья (ровный): глубоко под землёй — меш поверхности и фартук за краем карты сюда не достают. */
export const CAT_FLOOR_Y = -80;
/** Высота сводов (для клиента: стены и потолок). */
export const CAT_CEIL = 12;

/** Коридор i — между залами i и i+1 (прямоугольник вдоль Z, заходит в залы на 2 м). */
export function catCorridor(i: number): { z0: number; z1: number } {
  const a = CAT_HALLS[i];
  const b = CAT_HALLS[i + 1];
  return { z0: a.z + a.r - 2, z1: b.z - b.r + 2 };
}

/** Точка в районе катакомб (за краем карты). */
export function inCatRegion(x: number, z: number): boolean {
  return z > CAT_Z0 && Math.abs(x) < CAT_HALF_X;
}

/**
 * Ближайшая точка, где можно стоять: внутри открытых залов lo..hi и коридоров
 * между ними (с отступом `pad` от стен). Стоишь внутри — вернётся та же точка;
 * упёрся — скользишь вдоль стены (проекция на ближайшую фигуру).
 */
export function catProject(x: number, z: number, lo: number, hi: number, pad = 0.5): [number, number] {
  let bx = x;
  let bz = z;
  let bd = Infinity;
  const take = (px: number, pz: number): boolean => {
    const d = (px - x) * (px - x) + (pz - z) * (pz - z);
    if (d < bd) {
      bd = d;
      bx = px;
      bz = pz;
    }
    return d < 1e-9;
  };
  const a = Math.max(0, Math.min(lo, CAT_HALLS.length - 1));
  const b = Math.max(a, Math.min(hi, CAT_HALLS.length - 1));
  for (let i = a; i <= b; i++) {
    const h = CAT_HALLS[i];
    const r = h.r - pad;
    const dx = x - h.x;
    const dz = z - h.z;
    const d = Math.hypot(dx, dz);
    if (d <= r) return [x, z];
    take(h.x + (dx / (d || 1)) * r, h.z + (dz / (d || 1)) * r);
    if (i < b) {
      const c = catCorridor(i);
      const w = CAT_CORRIDOR_HALF - pad;
      const cx = Math.max(-w, Math.min(w, x));
      const cz = Math.max(c.z0, Math.min(c.z1, z));
      if (take(cx, cz)) return [x, z];
    }
  }
  return [bx, bz];
}

/** Точка входа в зал (у южной стены) — сюда телепорт и возрождение. Разброс по кругу на `i`. */
export function catEntry(hall: number, i = 0): { x: number; z: number } {
  const h = CAT_HALLS[Math.max(0, Math.min(hall, CAT_HALLS.length - 1))];
  const a = i * 2.39996;
  const r = Math.min(3, 0.6 * Math.sqrt(i));
  return { x: h.x + Math.cos(a) * r, z: h.z - h.r + 4 + Math.sin(a) * r * 0.6 };
}

/** Ворота, из которых лезут волны: по кругу зала (север — чаще, юг — засада со спины). */
export function catGates(hall: number): { x: number; z: number; back: boolean }[] {
  const h = CAT_HALLS[hall];
  const out: { x: number; z: number; back: boolean }[] = [];
  for (const a of [-1.2, -0.6, 0, 0.6, 1.2, Math.PI - 0.9, Math.PI + 0.9, -1.9, 1.9]) {
    out.push({ x: h.x + Math.sin(a) * (h.r - 3), z: h.z + Math.cos(a) * (h.r - 3), back: Math.cos(a) < -0.3 });
  }
  return out;
}

/** Где встаёт мини-босс (саркофаг) / супер-босс (алтарь) — север от центра зала. */
export function catBossSpot(hall: number): { x: number; z: number } {
  const h = CAT_HALLS[hall];
  return { x: h.x, z: h.z + h.r * (hall === CAT_HALLS.length - 1 ? 0.25 : 0.45) };
}

// ---------------------------------------------------------------- сценарий

export interface CatWave {
  /** "slime"/"spitter" — базовые, иначе ключ ELITE_MOBS. */
  type: string;
  count: number;
  /** +столько за каждого героя пати сверх первого. */
  perHero: number;
}

export interface CatBoss {
  /** Ключ ELITE_MOBS — модель и механики. */
  key: string;
  /** Имя в титрах и над моделью. */
  name: string;
  /** Подзаголовок титров. */
  title: string;
  /** Множители к HP и урону (сверх подгонки под уровень и размер пати), размер модели. */
  hpMul: number;
  dmgMul: number;
  scale: number;
  /** Свита — встаёт вместе с боссом. */
  retinue: CatWave[];
  /** Финальный: атаки дыханием/волной/дождём (как у охоты), призыв миньонов. */
  final?: boolean;
}

export interface CatStage {
  hall: number;
  /** Волны по очереди (следующая — когда зачищена предыдущая) — запасной состав, если пулы не заданы. */
  waves: CatWave[][];
  /** Случайные волны: сколько и из какого пула (каждый заход — свой состав). */
  waveCount?: number;
  pool?: string[];
  /** Сколько мобов в волне на первого героя и на каждого следующего. */
  waveBase?: number;
  wavePerHero?: number;
  /** Босс после волн. */
  boss?: CatBoss;
  /** Случайный страж из этих (каждый заход — свой). */
  bosses?: CatBoss[];
  /** Сундук за стадию: "gold" — по золотому оружию каждому, "final" — суперприз. */
  chest?: "gold" | "final";
}

export const CATACOMBS = {
  /** Сколько длится сбор, с. */
  gatherSec: 5 * 60,
  /** Меньше — не идём. */
  minParty: 2,
  /** Потолок пати. */
  maxParty: 12,
  /** Жёсткий предел самого забега, с (после — провал и возврат в лагерь). */
  runSec: 10 * 60,
  /** Пауза перед первой волной (пролёт камеры, титры), с. */
  introSec: 8,
  /** Пауза между волнами, с. */
  waveGap: 3,
  /** Перед боссом — титры и «трясётся земля», с. */
  bossIntroSec: 4,
  /** Проход в следующий зал открыт столько, потом отставших переносит вперёд, с. */
  moveSec: 12,
  /** После победы — титры и сбор наград, потом все в лагерь, с. */
  outroSec: 15,
  /** Как часто открывать сбор самому (в ротации), с — случайно в диапазоне. */
  autoMin: 25 * 60,
  autoMax: 40 * 60,
  /** Откат: после конца забега новый сбор (и командой) не раньше, с. */
  cooldownSec: 15 * 60,
  /** Портал в лагере: встал в круг во время сбора — записан. */
  portalR: 2.2,
  /** Сила мобов по уровню пати: множитель = (средний ур. / ур. моба) в этих пределах. */
  levelMin: 0.35,
  levelMax: 1.6,
  /** Боссы толще с каждым героем: hp × (1 + bossPerHero × (n − 1)). */
  bossPerHero: 0.7,
  /** Угроза растёт от зала к залу: HP и урон мобов × (1 + threat × номер стадии). */
  threatHp: 0.12,
  threatDmg: 0.15,
  /** Финальная награда: жетоны ◈ каждому, бафф (мин). */
  finalTokens: 3,
  buffMinutes: 30,
  stages: [
    {
      hall: 0, waves: [], waveCount: 3, waveBase: 3, wavePerHero: 1.4,
      pool: ["boneWraith", "spikyBlob", "orcGunner", "ruinMage", "frog", "bee"],
    },
    {
      hall: 1, waves: [], waveCount: 2, waveBase: 4, wavePerHero: 1.6,
      pool: ["boneWraith", "ruinMage", "orcGunner", "spikyBlob", "cactoro", "mushColossus"],
      bosses: [
        {
          key: "boneChief", name: "Мор'Каз, Костяной вождь", title: "страж Костницы",
          hpMul: 4.2, dmgMul: 1.6, scale: 1.6, retinue: [{ type: "boneWraith", count: 3, perHero: 1 }],
        },
        {
          key: "mushColossus", name: "Гнилень, Грибной колосс", title: "страж Костницы — ядовитые споры",
          hpMul: 2.6, dmgMul: 1.5, scale: 1.4, retinue: [{ type: "spikyBlob", count: 4, perHero: 1 }],
        },
        {
          key: "skySquid", name: "Ктаар, Спрут бездны", title: "страж Костницы — хватает щупальцами",
          hpMul: 2.7, dmgMul: 1.5, scale: 1.5, retinue: [{ type: "boneWraith", count: 2, perHero: 1 }],
        },
      ],
      chest: "gold",
    },
    {
      hall: 2, waves: [], waveCount: 2, waveBase: 3, wavePerHero: 1.3,
      pool: ["spearThrower", "spikeTail", "rockBreaker", "frostDemon", "boneWraith"],
      bosses: [
        {
          key: "infernoDemon", name: "Аргал, Адский страж", title: "хранитель Огненного склепа — огненный таран",
          hpMul: 2.6, dmgMul: 1.6, scale: 1.7,
          retinue: [{ type: "spikyBlob", count: 3, perHero: 1 }, { type: "spearThrower", count: 1, perHero: 0.3 }],
        },
        {
          key: "frostDemon", name: "Изгаар, Ледяной страж", title: "хранитель Огненного склепа — лёд и щит отражения",
          hpMul: 2.6, dmgMul: 1.5, scale: 1.7,
          retinue: [{ type: "boneWraith", count: 2, perHero: 1 }, { type: "spikeTail", count: 1, perHero: 0.3 }],
        },
        {
          key: "rockBreaker", name: "Громолом", title: "хранитель Огненного склепа — прыжки и ярость стаи",
          hpMul: 2.2, dmgMul: 1.4, scale: 1.8, retinue: [{ type: "rockBreaker", count: 1, perHero: 0.5 }],
        },
      ],
      chest: "gold",
    },
    {
      hall: 3,
      waves: [],
      boss: {
        key: "worldElite", name: "Владыка Бездны", title: "древний дракон катакомб",
        hpMul: 0.9, dmgMul: 1.4, scale: 1.25,
        retinue: [{ type: "boneWraith", count: 2, perHero: 1 }],
        final: true,
      },
      chest: "final",
    },
  ] as CatStage[],
} as const;

/** Портал катакомб в лагере (во время сбора — светящийся круг; встал в него — записан). */
export const CAT_PORTAL = { x: HUB_CENTER.x - 12, z: HUB_CENTER.z + 15 } as const;

/** Проклятие зала — случайное на каждый зал (кроме трона): меняет мобов и правила, объявляется титром. */
export interface CatCurse {
  name: string;
  desc: string;
  hpMul: number;
  dmgMul: number;
  /** Опасности (обвалы/пламя) чаще во столько раз. */
  hazardRate: number;
  /** Зелья с сундука/зала ×. */
  lootMul: number;
}
export const CAT_CURSES: readonly CatCurse[] = [
  { name: "Ярость мертвецов", desc: "мертвецы бьют сильнее", hpMul: 1, dmgMul: 1.25, hazardRate: 1, lootMul: 1 },
  { name: "Каменный град", desc: "своды осыпаются вдвое чаще", hpMul: 0.9, dmgMul: 1, hazardRate: 2, lootMul: 1 },
  { name: "Живучесть тлена", desc: "мертвецы крепче", hpMul: 1.3, dmgMul: 0.95, hazardRate: 1, lootMul: 1.5 },
  { name: "Щедрая гробница", desc: "больше добычи — но и мертвецов злее", hpMul: 1.1, dmgMul: 1.1, hazardRate: 1, lootMul: 2.5 },
  { name: "Тишина склепа", desc: "без проклятия — пока", hpMul: 1, dmgMul: 1, hazardRate: 0.8, lootMul: 1 },
];

/** Опасности зала: телеграф-круги под героями, через delay — удар по площади (доля макс. HP). */
export type CatHazardKind = "rockfall" | "flames" | "souls";
export const CAT_HAZARD = {
  kinds: ["rockfall", "flames", "souls"] as CatHazardKind[],
  names: { rockfall: "обвалы", flames: "столбы пламени", souls: "гейзеры душ" } as Record<CatHazardKind, string>,
  /** Пауза между залпами, с (случайно в пределах). */
  gapMin: 8,
  gapMax: 13,
  delay: 1.7,
  radius: 2.8,
  /** Урон — доля макс. HP героя (чтобы было больно, но не смертельно сразу). */
  dmgFrac: 0.22,
  /** Сколько кругов за залп: на каждого второго героя + разброс. */
  perHero: 0.6,
} as const;

/** Подсказка зрителям: команды чата для катакомб (панель у зрителя, !info) — один текст на всё. */
export const CAT_HELP: readonly [string, string][] = [
  ["!катакомбы", "встать в отряд (на сборе)"],
  ["!цель", "босс · свита · стрелки · слабых · сильных"],
  ["!встать", "вперёд · назад · фланг"],
  ["!режим", "осторожно · агрессивно"],
  ["!тактика", "что сейчас приказано"],
];

/** Фазы забега (RoomState.catPhase). */
export const CAT_PHASE = { none: 0, gather: 1, run: 2, outro: 3 } as const;
