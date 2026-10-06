import { WORLD } from "./constants";

/**
 * Рейд-босс «Лунный аватар» (тест, 2026-10-07): на плато горы с водопадом — восточнее
 * русла (слева, если смотреть с озера на водопад). Плато за южным краем карты (playHalf),
 * поэтому движение разрешено ещё на нём и на пандусе к нему (см. inPlayArea / clampToPlay).
 * Арена — круг в центре плато, босс в её центре. Механики фаз — по дизайну рейда (этапами).
 */
export const RAID = {
  /** Ключ ELITE_MOBS рейд-босса. */
  boss: "moonAvatar",
  /** Центр арены (и место босса), м. */
  x: -84,
  z: -219,
  /** Радиус арены, м (плато ровное на 50 м примерно ±40 м от центра). */
  r: 30,
  /** Через сколько секунд после гибели босс возвращается. */
  respawnSec: 300,
} as const;

/**
 * Фазы боя по доле HP босса (дизайн рейда). Числа — для подстройки:
 * - orbits — сколько колец-орбит вокруг босса (у каждого один разрыв);
 * - arenaSpd — вращение арены, °/с: стоящего героя арена несёт по кругу и сносит к краю (drift);
 * - orbitRel — скорость каждой орбиты ОТНОСИТЕЛЬНО арены, °/с (знак — направление): столько
 *   приходится идти, чтобы оставаться в её разрыве;
 * - gap — ширина разрыва, °; edge — край арены (доля RAID.r): за ним пустота, упал — погиб;
 * - drift — снос к краю у самого края, м/с (к центру спадает до нуля);
 * - jerky — арена вращается рывками; vertical — индекс орбиты, стоящей «на ребре» (вид).
 */
export interface RaidPhase {
  from: number;
  orbits: number;
  arenaSpd: number;
  orbitRel: readonly number[];
  gap: number;
  edge: number;
  drift: number;
  jerky?: boolean;
  vertical?: number;
}
export const RAID_PHASES: readonly RaidPhase[] = [
  { from: 1.0, orbits: 1, arenaSpd: 5, orbitRel: [-6], gap: 90, edge: 1.0, drift: 0.35 },
  { from: 0.75, orbits: 2, arenaSpd: 15, orbitRel: [-10, 12], gap: 45, edge: 0.85, drift: 0.7 },
  { from: 0.5, orbits: 3, arenaSpd: 30, orbitRel: [-14, 16, -20], gap: 30, edge: 0.7, drift: 1.1, jerky: true, vertical: 2 },
  { from: 0.25, orbits: 1, arenaSpd: 45, orbitRel: [24], gap: 20, edge: 0.55, drift: 1.5 },
];

/** Номер фазы (0..3) по доле HP босса. */
export function raidPhaseOf(hpFrac: number): number {
  let ph = 0;
  for (let i = 0; i < RAID_PHASES.length; i++) if (hpFrac <= RAID_PHASES[i].from + 1e-9) ph = i;
  return ph;
}

/** Радиусы орбит (от центра арены), м; высота колец над полом. */
export const RAID_ORBITS = { r: [9, 13.5, 18] as readonly number[], y: 3.2 } as const;

/** Способности босса (дизайн рейда). */
export const RAID_FIGHT = {
  /** «Лунная слеза»: раз в every с осколок падает на случайного героя арены — круг r, удар через delay. */
  tear: { every: 8, r: 4, delay: 1.6, dmg: 0.35 },
  /** «Прилив»: раз в every с волна света — гибнет всякий на арене, кто не в разрыве; предупреждение warn с. */
  tide: { every: 20, warn: 4 },
  /** Энрейдж: через столько секунд боя прилив бьёт всех без разбора. */
  enrageSec: 15 * 60,
  /** Никого на арене столько секунд — бой сброшен (босс снова целый, фаза 1). */
  resetSec: 15,
  /** Рывки арены (фаза с jerky): период, с, и доля периода, когда она крутится. */
  jerkPeriod: 1.6,
  jerkOn: 0.35,
} as const;

/** Угол точки вокруг центра арены, рад (как yaw: atan2(dx, dz)). */
export function raidAngle(x: number, z: number): number {
  return Math.atan2(x - RAID.x, z - RAID.z);
}

/**
 * Сдвиг героя ареной за dt: поворот вокруг центра на w·dt (рад) и снос к краю (drift м/с у края,
 * к центру спадает). null — точка не на арене (за краем edge). Общая формула: сервер несёт ботов,
 * клиент — своего героя (поля состояния raidW/raidDrift/raidEdge).
 */
export function raidCarry(x: number, z: number, w: number, drift: number, edge: number, dt: number): [number, number] | null {
  const rx = x - RAID.x;
  const rz = z - RAID.z;
  const d = Math.hypot(rx, rz);
  if (d < 1e-3 || d > edge + 0.3 || edge <= 0) return null;
  const a = w * dt;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const push = drift * (d / edge) * dt;
  return [rx * ca + rz * sa - rx + (rx / d) * push, rz * ca - rx * sa - rz + (rz / d) * push];
}

/** Разница углов в −π..π. */
export function angDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Стоит ли точка в разрыве хоть одной из n орбит (углы центров разрывов `gaps`, полуширина halfGap, рад). */
export function inRaidGap(x: number, z: number, gaps: readonly number[], n: number, halfGap: number): boolean {
  const a = raidAngle(x, z);
  for (let i = 0; i < n; i++) if (Math.abs(angDiff(a, gaps[i])) <= halfGap) return true;
  return false;
}

/** Ровное плато горы (прямоугольник): здесь можно ходить, хотя это за краем карты. */
export const RAID_PLATEAU = { x0: -126, x1: -42, z0: -256, z1: -180 } as const;

/**
 * Пандус на плато: прямой подъём с низины северо-восточнее горы (a, высота hA) к северо-
 * восточному углу плато (b, hB). Полоса half м в каждую сторону — ровно по пандусу, дальше
 * shoulder м — плавный переход в природный рельеф (насыпь внизу, выемка в скале вверху).
 * Уклон ~0.69 — меньше MAX_CLIMB (1): проходим и героям, и ботам (sim/nav).
 */
export const RAID_RAMP = { ax: 8, az: -152, bx: -55, bz: -188, hA: 0, hB: 50, half: 3.5, shoulder: 5 } as const;

const RAMP_DX = RAID_RAMP.bx - RAID_RAMP.ax;
const RAMP_DZ = RAID_RAMP.bz - RAID_RAMP.az;
const RAMP_LEN = Math.hypot(RAMP_DX, RAMP_DZ);
const RUX = RAMP_DX / RAMP_LEN;
const RUZ = RAMP_DZ / RAMP_LEN;

/** Точка в осях пандуса: s — вдоль (0 у подножия, 1 наверху), t — поперёк, м. */
function rampLocal(x: number, z: number): { s: number; t: number } {
  const rx = x - RAID_RAMP.ax;
  const rz = z - RAID_RAMP.az;
  return { s: (rx * RUX + rz * RUZ) / RAMP_LEN, t: rx * RUZ - rz * RUX };
}

/**
 * Высота с пандусом: природная высота `h` в полосе пандуса заменяется его ровным подъёмом,
 * по краям (shoulder) — плавно. Вне полосы — `h` как есть. Зовёт shared/terrain.
 */
export function rampHeight(x: number, z: number, h: number): number {
  const { s, t } = rampLocal(x, z);
  const fadeS = 3 / RAMP_LEN; // за концами — 3 м перехода
  if (s < -fadeS || s > 1 + fadeS) return h;
  const at = Math.abs(t);
  const { half, shoulder, hA, hB } = RAID_RAMP;
  if (at >= half + shoulder) return h;
  const sc = Math.max(0, Math.min(1, s));
  const rh = hA + (hB - hA) * sc;
  let w = at <= half ? 1 : 1 - (at - half) / shoulder;
  if (s < 0) w *= 1 + s / fadeS;
  else if (s > 1) w *= 1 - (s - 1) / fadeS;
  w = w * w * (3 - 2 * w); // smoothstep
  return h + (rh - h) * w;
}

const HALF = WORLD.playHalf;

/** Можно ли здесь стоять: квадрат карты, плато рейда или пандус к нему. */
export function inPlayArea(x: number, z: number): boolean {
  if (Math.abs(x) <= HALF && Math.abs(z) <= HALF) return true;
  const P = RAID_PLATEAU;
  if (x >= P.x0 && x <= P.x1 && z >= P.z0 && z <= P.z1) return true;
  const { s, t } = rampLocal(x, z);
  return s >= 0 && s <= 1 && Math.abs(t) <= RAID_RAMP.half;
}

/**
 * Не выпускать точку из разрешённой зоны (inPlayArea): ближайшая точка квадрата карты,
 * плато или полосы пандуса. Единый ограничитель для клиента (движение, телепорт),
 * сервера (боты, сейв) и навигации ботов.
 */
export function clampToPlay(p: { x: number; z: number }): void {
  if (inPlayArea(p.x, p.z)) return;
  const cands: [number, number][] = [];
  cands.push([Math.max(-HALF, Math.min(HALF, p.x)), Math.max(-HALF, Math.min(HALF, p.z))]);
  const P = RAID_PLATEAU;
  cands.push([Math.max(P.x0, Math.min(P.x1, p.x)), Math.max(P.z0, Math.min(P.z1, p.z))]);
  const { s, t } = rampLocal(p.x, p.z);
  const sc = Math.max(0, Math.min(1, s)) * RAMP_LEN;
  const tc = Math.max(-RAID_RAMP.half, Math.min(RAID_RAMP.half, t));
  cands.push([RAID_RAMP.ax + RUX * sc + RUZ * tc, RAID_RAMP.az + RUZ * sc - RUX * tc]);
  let best = cands[0];
  let bd = Infinity;
  for (const c of cands) {
    const d = (c[0] - p.x) ** 2 + (c[1] - p.z) ** 2;
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  p.x = best[0];
  p.z = best[1];
}

/** На плато рейд-босса. */
function onPlateau(x: number, z: number): boolean {
  const P = RAID_PLATEAU;
  return x >= P.x0 && x <= P.x1 && z >= P.z0 && z <= P.z1;
}

/**
 * Промежуточная точка пути: цель на плато, а идущий внизу (не на пандусе и не на плато) —
 * сперва к подножию пандуса. Иначе A* ботов (sim/nav) не укладывается в лимит раскрытий:
 * заливает всю низину под обрывом раньше, чем находит обход. null — идти прямо к цели.
 */
export function raidWaypoint(fx: number, fz: number, tx: number, tz: number): [number, number] | null {
  if (!onPlateau(tx, tz) || onPlateau(fx, fz)) return null;
  const { s, t } = rampLocal(fx, fz);
  if (s >= -0.02 && s <= 1 && Math.abs(t) <= RAID_RAMP.half + 1) return null;
  if (Math.hypot(fx - RAID_RAMP.ax, fz - RAID_RAMP.az) < 4) return null;
  return [RAID_RAMP.ax, RAID_RAMP.az];
}

/** Рамка всей разрешённой зоны (для сеток: навигация ботов, кеш высот). */
export const PLAY_BOUNDS = {
  x0: -HALF,
  x1: HALF,
  z0: Math.min(-HALF, RAID_PLATEAU.z0),
  z1: HALF,
} as const;
