import { WORLD } from "./constants";
import { CAT_GUARDS, CAT_SUPERBOSSES, type CatBoss, type CatWave } from "./mobs";
export type { CatBoss, CatMech, CatWave, CatSeal, CatChampion } from "./mobs";
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
  { x: 0, z: CAT_Z0 + 92, r: 26, name: "Галерея мёртвых" },
  { x: 0, z: CAT_Z0 + 158, r: 26, name: "Нижний ярус" },
  { x: 0, z: CAT_Z0 + 228, r: 30, name: "Трон Бездны" },
];

/** Полуширина коридора между залами, м. */
export const CAT_CORRIDOR_HALF = 4.5;
/** Высота пола подземелья (ровный): глубоко под землёй — меш поверхности и фартук за краем карты сюда не достают. */
export const CAT_FLOOR_Y = -80;
/** Высота сводов (для клиента: стены и потолок). */
export const CAT_CEIL = 16;

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
  /** Случайный страж из этих (каждый заход — свой; пулы — mobs.ts). */
  bosses?: readonly CatBoss[];
  /** Сколько волн зала приходят с чемпионом (мини-боссом из CAT_CHAMPIONS[hall]). */
  champions?: number;
  /** Сундук за стадию: "gold" — по золотому оружию каждому, "final" — суперприз. */
  chest?: "gold" | "final";
}

export const CATACOMBS = {
  /** Сколько длится сбор, с. */
  gatherSec: 5 * 60,
  /** Меньше — не идём. */
  minParty: 3, // 2026-10-04: было 2
  /** Потолок пати. */
  maxParty: 12,
  /** Жёсткий предел самого забега, с (после — провал и возврат в лагерь). */
  runSec: 12 * 60, // 2026-10-05: было 10 — стражи в каждом зале и чемпионы
  /** Пауза перед первой волной (пролёт камеры, титры), с. */
  introSec: 5,
  /** Пауза между волнами, с. */
  waveGap: 1,
  /** Перед боссом — титры и «трясётся земля», с. */
  bossIntroSec: 3,
  /** Проход в следующий зал открыт столько, потом отставших переносит вперёд, с. */
  moveSec: 5,
  /** Через столько секунд после подъёма решётки отставших переносит к воротам, к отряду. */
  pullSec: 2.5,
  /** «Отстал» — дальше стольких метров позади решётки. */
  pullBehind: 8,
  /** После победы — титры и сбор наград, потом все в лагерь, с. */
  outroSec: 10,
  /** Как часто открывать сбор самому (в ротации), с — случайно в диапазоне. */
  autoMin: 25 * 60,
  autoMax: 40 * 60,
  /** Откат: после конца забега новый сбор (и командой) не раньше, с. */
  cooldownSec: 15 * 60,
  /** Погибший в катакомбах воскресает через столько секунд (если кто-то из отряда жив; пали все — поражение). */
  reviveSec: 30,
  /** Портал в лагере: встал в круг во время сбора — записан. */
  portalR: 3.2,
  /** Сила мобов по уровню пати: множитель = (средний ур. / ур. моба) в этих пределах. */
  levelMin: 0.35,
  levelMax: 1.6,
  /** Боссы толще с каждым героем: hp × (1 + bossPerHero × (n − 1)). */
  bossPerHero: 0.55,
  /** Здоровье стражей и чемпионов × (общая настройка сложности катакомб). */
  guardHpMul: 0.75,
  /** Чемпион (мини-босс волны): толще с каждым героем на эту долю, размер модели ×. */
  champPerHero: 0.4,
  champScale: 1.45,
  /** Угроза растёт от зала к залу: HP и урон мобов × (1 + threat × номер стадии). */
  threatHp: 0.1,
  threatDmg: 0.16,
  /**
   * Урон всех мобов катакомб: «пали все — поражение», бесконечных возрождений нет —
   * отряд должен переживать бой, а не брать числом смертей.
   */
  dmgScale: 0.7, // 2026-10-06: урон выше, здоровье стражей ниже — без лекаря/танка тяжело, бои короче
  /** Урон опасностей зала и приёмов стражей (доля HP) — по той же причине. */
  hazardScale: 0.65,
  /** Финальная награда: жетоны ◈ каждому, бафф (мин). */
  finalTokens: 3,
  /** Опыт каждому в отряде за стража / Владыку — доля уровня (сверх опыта за удары). */
  /**
   * Опыт за полный заход — доля уровня героя (на старте захода) по кривой [уровень, доля]:
   * 1 ур. — 1000%, 36 ур. — 10%, 100 ур. — 1%, между точками плавно (по логарифму). Каждый страж —
   * guardShare этой награды, Владыка — finalShare. Мобы катакомб опыта не дают. См. catXpFrac.
   */
  xpCurve: [[1, 10], [36, 0.1], [100, 0.01]] as readonly (readonly [number, number])[],
  guardShare: 0.25,
  finalShare: 0.5,
  buffMinutes: 30,
  stages: [
    {
      hall: 0, waves: [], waveCount: 3, waveBase: 3, wavePerHero: 1.5, champions: 1,
      pool: ["boneWraith", "spikyBlob", "orcGunner", "ruinMage", "frog", "bee"],
      bosses: CAT_GUARDS[0],
    },
    {
      hall: 1, waves: [], waveCount: 2, waveBase: 4, wavePerHero: 1.7, champions: 1,
      pool: ["boneWraith", "ruinMage", "orcGunner", "spikyBlob", "cactoro", "mushColossus"],
      bosses: CAT_GUARDS[1],
      chest: "gold",
    },
    {
      hall: 2, waves: [], waveCount: 2, waveBase: 3, wavePerHero: 1.4, champions: 2,
      pool: ["spearThrower", "spikeTail", "rockBreaker", "frostDemon", "boneWraith"],
      bosses: CAT_GUARDS[2],
      chest: "gold",
    },
    {
      hall: 3,
      waves: [],
      // Супербосс — каждый заход один случайный из трёх (mobs.ts CAT_SUPERBOSSES).
      bosses: CAT_SUPERBOSSES,
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

/** Владыка Бездны: три стадии по доле HP. */
export const CAT_FINAL = {
  /** Стадия 2 (Печать) с этой доли HP: щит, хранители печати, метеоры. */
  sealAt: 0.7,
  /** Стадия 3 (Ярость Бездны) с этой доли HP: огненные кольца, чаще всё. */
  rageAt: 0.4,
  /** Хранителей печати (сколько убить, чтобы снять щит) и их тип. */
  guardians: 3,
  /** Здоровье хранителя печати (вид — CatBoss.seal.key у каждого супербосса). */
  guardianHp: 0.6,
  /** Метеоры на стадии 2 — каждые, с. */
  meteorEvery: 7,
  /** После снятия щита — оглушён, с. */
  stunAfterSeal: 5,
  /** Стадия 3: кольцо пламени от Владыки — каждые, с; радиус. */
  ringEvery: 7,
  ringR: 9,
} as const;

/**
 * Тема зала — на каждый заход раздаётся залам случайно (RoomState.catThemes): цвет света,
 * цвета ниш, оттенок пола и свой декор. Один и тот же зал выглядит по-разному от захода к заходу.
 */
export interface CatTheme {
  key: "crypt" | "ossuary" | "pit" | "moon";
  name: string;
  /** Цвет огня/света (0..1). */
  light: [number, number, number];
  /** Цвета ниш (два чередуются). */
  niches: [[number, number, number], [number, number, number]];
  floor: [number, number, number];
}
export const CAT_THEMES: readonly CatTheme[] = [
  { key: "crypt", name: "Склеп", light: [1, 0.45, 0.12], niches: [[0.35, 0.45, 1], [0.2, 0.85, 1]], floor: [0.95, 0.88, 0.8] },
  { key: "ossuary", name: "Костница", light: [0.9, 0.78, 0.32], niches: [[0.35, 1, 0.45], [0.55, 1, 0.3]], floor: [0.88, 0.9, 0.76] },
  { key: "pit", name: "Огненная яма", light: [1, 0.28, 0.06], niches: [[1, 0.18, 0.22], [1, 0.45, 0.1]], floor: [0.92, 0.7, 0.6] },
  { key: "moon", name: "Лунный склеп", light: [0.55, 0.68, 1], niches: [[0.72, 0.3, 1], [0.35, 0.45, 1]], floor: [0.76, 0.82, 0.96] },
];

/** Аффикс волны (как у элиток в ARPG): меняет мобов волны, объявляется в титре. */
export interface CatAffix {
  key: "swift" | "vampire" | "armored" | "explosive" | "giant";
  name: string;
  speedMul?: number;
  lifesteal?: number;
  physArmor?: number;
  hpMul?: number;
  scaleMul?: number;
  /** При смерти — огненный взрыв (круг-предупреждение, потом удар). */
  explode?: boolean;
}
export const CAT_AFFIXES: readonly CatAffix[] = [
  { key: "swift", name: "быстрые", speedMul: 1.45 },
  { key: "vampire", name: "вампиры", lifesteal: 0.35 },
  { key: "armored", name: "в броне", physArmor: 0.35 },
  { key: "explosive", name: "взрываются при смерти", explode: true },
  { key: "giant", name: "исполины", hpMul: 1.6, scaleMul: 1.35 },
];

/** Святилище в зале (случайно): кто из отряда подошёл — бафф всему отряду. */
export interface CatShrine {
  key: "fury" | "heal" | "ward" | "haste";
  name: string;
  desc: string;
  /** Цвет столба (0..1). */
  color: [number, number, number];
}
export const CAT_SHRINES: readonly CatShrine[] = [
  { key: "fury", name: "Святилище ярости", desc: "отряду +25% урона и +15% темпа на 30 с", color: [1, 0.35, 0.15] },
  { key: "heal", name: "Святилище жизни", desc: "отряд исцелён полностью", color: [0.35, 1, 0.45] },
  { key: "ward", name: "Святилище стойкости", desc: "отряду −20% входящего урона на 45 с", color: [0.35, 0.6, 1] },
  { key: "haste", name: "Святилище ветра", desc: "отряду +30% темпа атак на 25 с", color: [0.85, 0.95, 1] },
];
/** holdSec — сколько стоять в круге, чтобы святилище сработало (видно зрителям, не мгновенно). */
export const CAT_SHRINE = { chance: 0.65, reach: 3.5, holdSec: 2.1, buffSec: 30, wardSec: 45, hasteSec: 25 } as const;

/** Доля уровня героя за полный заход по кривой CATACOMBS.xpCurve (лог-линейно между точками). */
export function catXpFrac(level: number): number {
  const c = CATACOMBS.xpCurve;
  if (level <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    const [l1, f1] = c[i];
    if (level <= l1) {
      const [l0, f0] = c[i - 1];
      return f0 * Math.pow(f1 / f0, (level - l0) / (l1 - l0));
    }
  }
  return c[c.length - 1][1];
}

/** Фазы забега (RoomState.catPhase). */
export const CAT_PHASE = { none: 0, gather: 1, run: 2, outro: 3 } as const;
