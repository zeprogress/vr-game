import { WORLD } from "#shared/constants";
import { canClimb, reachAlong } from "#shared/terrain";

/**
 * Навигация по рельефу для ботов: сетка с шагом CELL метров, переход в
 * соседнюю клетку (8 направлений) разрешён, если на всём шаге подъём не круче
 * MAX_CLIMB (shared/terrain canClimb) — те же правила, что у движения.
 * Проходимость клетки считается лениво и кешируется (рельеф неизменен).
 * Поиск — A* с ограничением на число раскрытий; если цель недостижима,
 * путь ведёт к ближайшей достижимой клетке.
 */
const CELL = 2;
/** Запас коридора: проход между клетками проверяем ещё и в стольких метрах по бокам. */
const LANE = 0.5;
const HALF = WORLD.playHalf - 1;
const N = Math.floor((2 * HALF) / CELL) + 1;
const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
] as const;
/** Бит 0x100 — клетка уже посчитана; биты 0..7 — можно ли уйти в направлении DIRS[k]. */
const mask = new Uint16Array(N * N);

const cx = (x: number): number => Math.max(0, Math.min(N - 1, Math.round((x + HALF) / CELL)));
const wx = (i: number): number => -HALF + i * CELL;

function edges(c: number): number {
  let m = mask[c];
  if (m & 0x100) return m & 0xff;
  const i = c % N;
  const j = (c / N) | 0;
  const x = wx(i);
  const z = wx(j);
  m = 0x100;
  for (let k = 0; k < 8; k++) {
    const [di, dj] = DIRS[k];
    const ni = i + di;
    const nj = j + dj;
    if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
    const dx = di * CELL;
    const dz = dj * CELL;
    // Щупаем подъём по всему шагу (каждые полметра — как reachAlong) — и по двум
    // параллельным линиям в ±LANE м: бот идёт не точно по линии центров (инерция,
    // толкотня), и «коридор» шириной в сантиметры у края горы он не проходил —
    // упирался и топтался (лаборатория, опыт nav).
    const len = Math.hypot(dx, dz);
    const ox = (-dz / len) * LANE;
    const oz = (dx / len) * LANE;
    let ok = true;
    for (let s = 0; s < 4 && ok; s++) {
      const px = x + (dx * s) / 4;
      const pz = z + (dz * s) / 4;
      ok = canClimb(px, pz, dx, dz) && canClimb(px + ox, pz + oz, dx, dz) && canClimb(px - ox, pz - oz, dx, dz);
    }
    if (ok) m |= 1 << k;
  }
  mask[c] = m;
  return m & 0xff;
}

/** Двоичная куча по f. */
class Heap {
  private readonly a: number[] = [];
  private readonly f: number[] = [];
  get size(): number {
    return this.a.length;
  }
  push(v: number, fv: number): void {
    const a = this.a;
    const f = this.f;
    a.push(v);
    f.push(fv);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (f[p] <= f[i]) break;
      [a[p], a[i]] = [a[i], a[p]];
      [f[p], f[i]] = [f[i], f[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.a;
    const f = this.f;
    const top = a[0];
    const lv = a.pop()!;
    const lf = f.pop()!;
    if (a.length) {
      a[0] = lv;
      f[0] = lf;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && f[l] < f[m]) m = l;
        if (r < a.length && f[r] < f[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        [f[m], f[i]] = [f[i], f[m]];
        i = m;
      }
    }
    return top;
  }
}

const gScore = new Float32Array(N * N);
const came = new Int32Array(N * N);
const stamp = new Uint32Array(N * N);
let curStamp = 0;

/**
 * Путь (точки мира) из (x0,z0) к (x1,z1) в обход крутых склонов. Пустой — идти
 * напрямую. null — сдвинуться некуда. Первая точка — первая клетка после старта.
 */
export function findPath(x0: number, z0: number, x1: number, z1: number, maxExpand = 12000): [number, number][] | null {
  const start = cx(z0) * N + cx(x0);
  const goal = cx(z1) * N + cx(x1);
  if (start === goal) return [];
  curStamp++;
  const gi = goal % N;
  const gj = (goal / N) | 0;
  const h = (c: number): number => {
    const di = Math.abs((c % N) - gi);
    const dj = Math.abs(((c / N) | 0) - gj);
    return (Math.max(di, dj) + 0.41421 * Math.min(di, dj)) * CELL;
  };
  const open = new Heap();
  stamp[start] = curStamp;
  gScore[start] = 0;
  came[start] = -1;
  open.push(start, h(start));
  let best = start;
  let bestH = h(start);
  let expanded = 0;
  while (open.size && expanded < maxExpand) {
    const c = open.pop();
    if (c === goal) {
      best = c;
      break;
    }
    expanded++;
    const hc = h(c);
    if (hc < bestH) {
      bestH = hc;
      best = c;
    }
    const m = edges(c);
    const i = c % N;
    const j = (c / N) | 0;
    for (let k = 0; k < 8; k++) {
      if (!(m & (1 << k))) continue;
      const n = (j + DIRS[k][1]) * N + (i + DIRS[k][0]);
      const g = gScore[c] + (k < 4 ? CELL : CELL * 1.41421);
      if (stamp[n] === curStamp && g >= gScore[n]) continue;
      stamp[n] = curStamp;
      gScore[n] = g;
      came[n] = c;
      open.push(n, g + h(n));
    }
  }
  if (best === start) return null;
  const path: [number, number][] = [];
  for (let c = best; c !== start && c !== -1; c = came[c]) path.push([wx(c % N), wx((c / N) | 0)]);
  path.reverse();
  // Последняя точка — сама цель, если её клетка достигнута (а не центр клетки).
  if (best === goal) path[path.length - 1] = [x1, z1];
  return path;
}

/** Центр клетки сетки, в которой стоит точка (x,z). */
export function navCellCenter(x: number, z: number): [number, number] {
  return [wx(cx(x)), wx(cx(z))];
}

/** Видно ли по прямой (пройти без крутых подъёмов) из (x0,z0) в (x1,z1). */
export function straightOk(x0: number, z0: number, x1: number, z1: number): boolean {
  const [rx, rz] = reachAlong(x0, z0, x1, z1);
  return Math.hypot(rx - x1, rz - z1) < 0.3;
}

/**
 * Прогреть сетку в фоне (кусками по `chunk` клеток, между тиками), чтобы первый
 * поиск пути не считал проходимость тысяч клеток посреди тика сервера.
 */
export function warmNav(chunk = 1500): void {
  let c = 0;
  const step = (): void => {
    const end = Math.min(N * N, c + chunk);
    for (; c < end; c++) edges(c);
    if (c < N * N) setTimeout(step, 5);
  };
  setTimeout(step, 2000);
}
