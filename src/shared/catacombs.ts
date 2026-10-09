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
 * Геометрия — граф круглых залов с развилками: вход → один из двух → один из
 * трёх → трон (CAT_HALLS — узлы, CAT_LINKS — коридоры). Каждый заход путь
 * выбирается случайно при зачистке зала (маршрут catRoute), но всегда
 * сходится к трону. Проходы закрыты решётками: открыт только путь по
 * маршруту от шага `lo` до шага `hi` (catLo/catHi в RoomState). Стоять можно
 * только внутри открытых залов и коридоров между ними — см. catProject.
 */

export interface CatHall {
  /** Центр зала. */
  x: number;
  z: number;
  /** Радиус пола (стены — по нему). */
  r: number;
  /** Имя для титров. */
  name: string;
  /** Шаг маршрута (0 — вход, последний — трон). */
  step: number;
}

/** Начало участка катакомб по Z: всё, что дальше (и в пределах |x| < CAT_HALF_X), — подземелье. */
export const CAT_Z0 = WORLD.size / 2 + 60;
const CAT_HALF_X = 100;

/** Залы-узлы графа. */
export const CAT_HALLS: readonly CatHall[] = [
  { x: 0, z: CAT_Z0 + 30, r: 22, name: "Преддверие", step: 0 },
  { x: -32, z: CAT_Z0 + 98, r: 25, name: "Галерея мёртвых", step: 1 },
  { x: 32, z: CAT_Z0 + 98, r: 25, name: "Затопленный склеп", step: 1 },
  { x: -60, z: CAT_Z0 + 168, r: 24, name: "Нижний ярус", step: 2 },
  { x: 0, z: CAT_Z0 + 168, r: 24, name: "Костница", step: 2 },
  { x: 60, z: CAT_Z0 + 168, r: 24, name: "Чертог теней", step: 2 },
  { x: 0, z: CAT_Z0 + 246, r: 30, name: "Трон Бездны", step: 3 },
];
/** Число шагов маршрута (= стадий забега). */
export const CAT_STEPS = 4;
/** Коридоры: [зал шага k, зал шага k+1] — без пересечений, любой путь сходится к трону. */
export const CAT_LINKS: readonly (readonly [number, number])[] = [
  [0, 1], [0, 2],
  [1, 3], [1, 4], [2, 4], [2, 5],
  [3, 6], [4, 6], [5, 6],
];

/** Полуширина коридора между залами, м. */
export const CAT_CORRIDOR_HALF = 4.5;
/** Высота пола подземелья (ровный): глубоко под землёй — меш поверхности и фартук за краем карты сюда не достают. */
export const CAT_FLOOR_Y = -80;
/** Высота сводов (для клиента: стены и потолок). */
export const CAT_CEIL = 16;

export interface CatCorridor {
  a: number;
  b: number;
  /** Ось коридора: из зала a (заходит в него на 2 м) в зал b. */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Единичное направление a → b и длина. */
  dx: number;
  dz: number;
  len: number;
}

const corridors: CatCorridor[] = CAT_LINKS.map(([a, b]) => {
  const A = CAT_HALLS[a];
  const B = CAT_HALLS[b];
  const L = Math.hypot(B.x - A.x, B.z - A.z);
  const dx = (B.x - A.x) / L;
  const dz = (B.z - A.z) / L;
  const s0 = A.r - 2;
  const s1 = L - B.r + 2;
  return { a, b, ax: A.x + dx * s0, az: A.z + dz * s0, bx: A.x + dx * s1, bz: A.z + dz * s1, dx, dz, len: s1 - s0 };
});

/** Коридор i (по CAT_LINKS). */
export function catCorridor(i: number): CatCorridor {
  return corridors[i];
}
/** Индекс коридора между залами a и b (−1 — не соединены). */
export function catLinkIndex(a: number, b: number): number {
  return CAT_LINKS.findIndex(([x, y]) => (x === a && y === b) || (x === b && y === a));
}
/** Куда можно пойти из зала (залы следующего шага). */
export function catNext(hall: number): number[] {
  return CAT_LINKS.filter(([a]) => a === hall).map(([, b]) => b);
}
/** Направления проёмов зала (углы a: x = sin a, z = cos a) — к соседям по графу. */
export function catDoors(hall: number): number[] {
  const h = CAT_HALLS[hall];
  const out: number[] = [];
  for (const [a, b] of CAT_LINKS) {
    const o = a === hall ? b : b === hall ? a : -1;
    if (o < 0) continue;
    out.push(Math.atan2(CAT_HALLS[o].x - h.x, CAT_HALLS[o].z - h.z));
  }
  return out;
}
/** Точка стены зала под углом a — в проёме (с запасом margin, м)? */
export function catNearDoor(hall: number, a: number, margin: number): boolean {
  const r = CAT_HALLS[hall].r;
  for (const d of catDoors(hall)) {
    const da = a - d;
    if (Math.cos(da) > 0 && Math.abs(Math.sin(da) * r) < CAT_CORRIDOR_HALF + margin) return true;
  }
  return false;
}
/** Маршрут из строки состояния ("0,2,4"); пустая — только вход. */
export function catParseRoute(s: string): number[] {
  const r = s ? s.split(",").map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < CAT_HALLS.length) : [];
  return r.length ? r : [0];
}
/** Открытые залы: шаги lo..hi маршрута. */
export function catOpen(route: readonly number[], lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let i = Math.max(0, lo); i <= hi && i < route.length; i++) out.push(route[i]);
  return out.length ? out : [route[0] ?? 0];
}
/** Все залы (до прихода маршрута с сервера). */
export const CAT_ALL_HALLS: readonly number[] = CAT_HALLS.map((_, i) => i);

/** Точка в районе катакомб (за краем карты). */
export function inCatRegion(x: number, z: number): boolean {
  return z > CAT_Z0 && Math.abs(x) < CAT_HALF_X;
}

/**
 * Ближайшая точка, где можно стоять: внутри открытых залов `halls` и коридоров
 * между ними (с отступом `pad` от стен). Стоишь внутри — вернётся та же точка;
 * упёрся — скользишь вдоль стены (проекция на ближайшую фигуру).
 */
export function catProject(x: number, z: number, halls: readonly number[], pad = 0.5): [number, number] {
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
  for (const i of halls) {
    const h = CAT_HALLS[i];
    if (!h) continue;
    const r = h.r - pad;
    const dx = x - h.x;
    const dz = z - h.z;
    const d = Math.hypot(dx, dz);
    if (d <= r) return [x, z];
    take(h.x + (dx / (d || 1)) * r, h.z + (dz / (d || 1)) * r);
  }
  const w = CAT_CORRIDOR_HALF - pad;
  for (const c of corridors) {
    if (!halls.includes(c.a) || !halls.includes(c.b)) continue;
    // В осях коридора: s — вдоль, t — поперёк.
    const rx = x - c.ax;
    const rz = z - c.az;
    const s = Math.max(0, Math.min(c.len, rx * c.dx + rz * c.dz));
    const t = Math.max(-w, Math.min(w, rx * c.dz - rz * c.dx));
    if (take(c.ax + c.dx * s + c.dz * t, c.az + c.dz * s - c.dx * t)) return [x, z];
  }
  return [bx, bz];
}

/** Точка входа в зал (у проёма со стороны прихода) — сюда телепорт и возрождение. Разброс на `i`. */
export function catEntry(hall: number, i = 0, from = -1): { x: number; z: number } {
  const h = CAT_HALLS[Math.max(0, Math.min(hall, CAT_HALLS.length - 1))];
  const src = from >= 0 ? CAT_HALLS[from] : null;
  // Ось «внутрь зала» — от проёма прихода к центру (без источника — с юга).
  let ux = 0;
  let uz = 1;
  if (src) {
    const L = Math.hypot(h.x - src.x, h.z - src.z) || 1;
    ux = (h.x - src.x) / L;
    uz = (h.z - src.z) / L;
  }
  const a = i * 2.39996;
  const r = Math.min(3, 0.6 * Math.sqrt(i));
  const lat = Math.cos(a) * r;
  const fwd = -h.r + 4 + Math.sin(a) * r * 0.6;
  return { x: h.x + ux * fwd + uz * lat, z: h.z + uz * fwd - ux * lat };
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
  /** Сезон рекордов катакомб (топ у спектатора): +1 — сбросить топ (2026-10-06: сброс после переделки катакомб). */
  season: 2,
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
  /** Как часто открывать сбор самому (в ротации), с — случайно в диапазоне. 2026-10-06: 25–40 мин → 15–25 мин. */
  autoMin: 15 * 60,
  autoMax: 25 * 60,
  /** Откат: от начала забега новый сбор (и командой) не раньше, с. */
  cooldownSec: 15 * 60,
  /** Погибший в катакомбах воскресает через столько секунд (если кто-то из отряда жив; пали все — поражение). */
  reviveSec: 30,
  /**
   * Жизни отряда: общий запас воскрешений на забег — livesPerHero на героя. Кончились — павшие
   * встают только при переходе в следующий зал. Без этого отряд без лекаря и танка проходил
   * «числом смертей» (8–9 смертей за победу против ~2 у сбалансированного).
   */
  livesPerHero: 1,
  /** 1 — в новом зале павшие встают бесплатно (без жизни отряда); 0 — лежат до конца забега. */
  hallRevive: 0,
  /** Портал в лагере: встал в круг во время сбора — записан. */
  portalR: 3.2,
  /**
   * Сила мобов по уровню пати. Калибровка вида: (levelRef / ур. моба) в пределах levelMin..levelMax
   * (HP ^1.4, урон ^1.2); рост с отрядом: × (средний ур. / levelRef)^levelPow — HP и урон героя
   * растут ~ как уровень², иначе на 30 ур. катакомбы были почти непроходимы, а на 45 — прогулкой.
   */
  levelRef: 36,
  levelPow: 2.2,
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
  dmgScale: 0.69, // 2026-10-06: 0.35 → 0.46 по реальным отрядам с прода (лаборатория --players) → 0.52 → 0.6 (просьбы усилить) → 0.69 (+15%, 2026-10-09)
  /** Здоровье всех мобов катакомб × (общая настройка; подобрано по настоящим героям с прода). */
  hpScale: 1.7, // 2026-10-06: 1 → 1.3 по реальным отрядам с прода → 1.45 → 1.7 (просьбы усилить)
  /** Урон опасностей зала и приёмов стражей (доля HP) — по той же причине. */
  hazardScale: 0.48, // 2026-10-06: 0.42 → 0.48 (просьба усилить)
  /**
   * Урон мобов и опасностей растёт с размером отряда: × (n / sizeRef)^sizeDmgPow (n ≤ sizeMaxN).
   * Большой отряд делит удары босса на всех и лечится лучше — без этого шестеро проходили всегда,
   * а трое (танк, лекарь, стрелок) почти никогда. Подобрано лабораторией: сбалансированные ~75%.
   */
  sizeRef: 4,
  sizeDmgPow: 1.3,
  sizeMaxN: 8, // 6 → 8: отряды 7–12 проходили легко; без потолка 10–12 героев гибли с одного удара
  /** Финальная награда: жетоны ◈ каждому, бафф (мин). */
  finalTokens: 3,
  /** Сундук стадии (вместо золотого оружия): жетоны ◈ каждому. */
  stageTokens: 1,
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
      // 2026-10-06: больше мобов и видов — 4 волны по 3 вида из 8 (было 3 волны по 2 вида из 6).
      hall: 0, waves: [], waveCount: 4, waveBase: 4, wavePerHero: 1.8, champions: 1,
      pool: ["boneWraith", "spikyBlob", "orcGunner", "ruinMage", "frog", "bee", "cactoro"],
      bosses: CAT_GUARDS[0],
    },
    {
      hall: 1, waves: [], waveCount: 3, waveBase: 5, wavePerHero: 2, champions: 1,
      pool: ["boneWraith", "ruinMage", "orcGunner", "spikyBlob", "cactoro", "mushColossus", "skySquid", "frostDemon"],
      bosses: CAT_GUARDS[1],
      chest: "gold",
    },
    {
      hall: 2, waves: [], waveCount: 3, waveBase: 4, wavePerHero: 1.7, champions: 2,
      pool: ["spearThrower", "spikeTail", "rockBreaker", "frostDemon", "infernoDemon", "boneWraith", "boneChief", "skySquid"],
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
