import { WORLD } from "./constants";
import { HUB_CENTER } from "./hub";
import type { ELITE_MOBS } from "./mobs";

/**
 * Подземелье «Глубинный храм» — открытая зона того же мира (ZoneRoom), как и катакомбы:
 * участок далеко за западным краем карты и глубоко под землёй. Вход — портал в лагере.
 *
 * Пол — 2.5D: набор проходимых фигур (круглые залы и полосы: тоннели, пандусы, лестницы, мосты),
 * у каждой своя высота (у полосы — линейно от начала к концу). Всё вне фигур — пропасть/скала:
 * стоять нельзя (dunProject возвращает на ближайшую проходимую фигуру, на которую можно шагнуть).
 * Фигуры не перекрываются в плане на разных высотах (кроме стыков на одной высоте) — так одна
 * функция высоты dunHeight(x, z) обслуживает игрока, мобов, стрелы и ботов (через terrainHeight).
 *
 * Координаты в описании — локальные (u — восток = +x, v — север = +z, h — над DUN_Y0), мировые —
 * сдвиг на DUN_X/DUN_Z/DUN_Y0.
 */

/** Центр подземелья в мире: за западным краем карты (катакомбы — за северным). */
export const DUN_X = -(WORLD.size / 2) - 260;
export const DUN_Z = 0;
/** Нулевая высота подземелья: своды (до +120) — глубоко под землёй, далеко ниже поверхности (было −200). */
export const DUN_Y0 = -500;
/** Половина стороны участка, м. */
export const DUN_HALF = 200;
/** Дно пропасти (локально) — туда «смотрит» высота вне проходимых фигур. */
export const DUN_VOID_H = -40;

export interface DunZone {
  id: string;
  name: string;
  /** Чем зона отличается от остальных (для арта, титров, расстановки мобов). */
  theme: string;
  /** Центр зоны (локально) — для титров, камеры зрителя, ориентиров. */
  u: number;
  v: number;
  /** Высота сводов над полом зоны, м (для клиента). */
  ceil: number;
  /** Цвет зоны в greybox и на карте. */
  color: readonly [number, number, number];
  /**
   * Облик: cave — пещера (пол и стены — скала); hall — древние руины в пещере (пол — плиты, стены —
   * скала); temple — постройка (пол — плиты, стены — гранитная кладка, свой потолок).
   */
  style: DunStyle;
  /**
   * Насколько зал закрыт стенами: closed — стены до свода; partial — низкие скалы с разрывами-«окнами»
   * (у построек — стена до пояса); open — стен нет, по краю парапет/глыбы, вид на всю пещеру.
   */
  enclose: DunEnclose;
}

export type DunStyle = "cave" | "hall" | "temple";
export type DunEnclose = "closed" | "partial" | "open";

export const DUN_ZONES: readonly DunZone[] = [
  { id: "A", name: "Врата экспедиции", theme: "вход от портала, брошенный лагерь экспедиции", u: 4, v: -182, ceil: 10, color: [0.56, 0.5, 0.42], style: "hall", enclose: "closed" },
  { id: "B", name: "Зал руин", theme: "разбитая колоннада, первые враги", u: 0, v: -134, ceil: 24, color: [0.62, 0.54, 0.4], style: "hall", enclose: "partial" },
  { id: "C", name: "Мост Предков", theme: "мост через Великий разлом, большая площадка на опоре посередине", u: 0, v: -80, ceil: 70, color: [0.52, 0.52, 0.56], style: "hall", enclose: "open" },
  { id: "T", name: "Обвальная галерея", theme: "огромная пещера с уклоном вниз на запад, завалы, засады", u: -110, v: -156, ceil: 20, color: [0.5, 0.45, 0.4], style: "cave", enclose: "partial" },
  { id: "U", name: "Кристальный грот", theme: "гигантский кристалл, элита", u: -160, v: -96, ceil: 26, color: [0.3, 0.42, 0.72], style: "cave", enclose: "closed" },
  { id: "D", name: "Кристальная пещера", theme: "синие кристаллы, холодный свет", u: -86, v: -80, ceil: 22, color: [0.36, 0.44, 0.66], style: "cave", enclose: "partial" },
  { id: "E", name: "Подземное озеро", theme: "озеро глубоко внизу, мост над ним, площадка на столбе напротив водопада", u: -170, v: 0, ceil: 80, color: [0.38, 0.48, 0.6], style: "cave", enclose: "open" },
  { id: "S", name: "Затопленные ступени", theme: "широкий склон-лестница древнего города, внизу — обрыв над озером", u: -80, v: 4, ceil: 40, color: [0.42, 0.5, 0.58], style: "hall", enclose: "open" },
  { id: "W", name: "Паучье гнездо", theme: "паутина, коконы, низкие своды", u: -146, v: 80, ceil: 14, color: [0.42, 0.46, 0.4], style: "cave", enclose: "closed" },
  { id: "F", name: "Зал Кольца", theme: "кольцевой зал вокруг светящегося провала, развилка", u: 0, v: -10, ceil: 45, color: [0.56, 0.56, 0.55], style: "hall", enclose: "open" },
  { id: "Q", name: "Каменный лес", theme: "лес сталагмитов и сталактитов-колонн", u: 82, v: -6, ceil: 40, color: [0.5, 0.47, 0.44], style: "cave", enclose: "partial" },
  { id: "I", name: "Тайник отступника", theme: "за верёвочным мостом: элита и сундук", u: 164, v: 4, ceil: 16, color: [0.6, 0.52, 0.38], style: "cave", enclose: "open" },
  { id: "K", name: "Шахтные выработки", theme: "три забоя на разных уровнях, леса, тележки, рельсы", u: 144, v: -146, ceil: 18, color: [0.55, 0.45, 0.33], style: "cave", enclose: "partial" },
  { id: "N", name: "Тайный колодец", theme: "широкие уступы по стенам вокруг провала", u: 171, v: -75, ceil: 50, color: [0.42, 0.42, 0.48], style: "cave", enclose: "closed" },
  { id: "O", name: "Сокровищница колодца", theme: "дно колодца: элита и сундук", u: 171, v: -75, ceil: 12, color: [0.6, 0.5, 0.3], style: "cave", enclose: "closed" },
  { id: "G", name: "Преддверие храма", theme: "парадная лестница, статуи-стражи, жаровни", u: 0, v: 60, ceil: 40, color: [0.68, 0.58, 0.4], style: "hall", enclose: "open" },
  { id: "P", name: "Казармы стражи", theme: "два зала на разной высоте, стойки с оружием, лагерь мобов", u: 92, v: 70, ceil: 12, color: [0.5, 0.44, 0.38], style: "temple", enclose: "closed" },
  { id: "Y", name: "Кузня", theme: "горны, наковальни, раскалённый металл", u: 174, v: 72, ceil: 16, color: [0.6, 0.42, 0.32], style: "temple", enclose: "partial" },
  { id: "V", name: "Неф храма", theme: "открытая колоннада над бездной, вид на пещеру с обеих сторон", u: 0, v: 100, ceil: 26, color: [0.62, 0.55, 0.42], style: "temple", enclose: "open" },
  { id: "R", name: "Склеп", theme: "низкие залы, саркофаги, кости", u: -60, v: 102, ceil: 10, color: [0.45, 0.42, 0.4], style: "temple", enclose: "closed" },
  { id: "X", name: "Зал обрядов", theme: "ритуальные круги, алтари, элита", u: -136, v: 162, ceil: 30, color: [0.5, 0.4, 0.52], style: "temple", enclose: "partial" },
  { id: "H", name: "Святилище", theme: "босс-арена: огромный зал, алтарь у дальней стены, колонны по краю", u: 0, v: 162, ceil: 55, color: [0.72, 0.6, 0.42], style: "temple", enclose: "closed" },
  { id: "J", name: "Выход", theme: "площадка с порталом домой", u: 90, v: 176, ceil: 12, color: [0.56, 0.5, 0.42], style: "hall", enclose: "closed" },
  { id: "Z", name: "Сокровищница храма", theme: "награда после босса, золото, реликвии", u: 156, v: 164, ceil: 20, color: [0.7, 0.6, 0.35], style: "temple", enclose: "closed" },
];

/** Вид полосы — для клиента (как строить) и навигации. */
export type DunStripKind = "tunnel" | "ramp" | "stairs" | "bridge" | "rope" | "floor" | "ledge" | "causeway";

/** Наклон пола комнаты: высота h в точке (u0, v0), уклон gu, gv м на м. */
export type DunTilt = readonly [u0: number, v0: number, gu: number, gv: number];

export type DunShape =
  | {
      t: "disc";
      zone: string;
      u: number;
      v: number;
      r: number;
      h: number;
      /** Кольцо: радиус провала в центре. */
      ri?: number;
      /** Возвышение внутри другой комнаты (помост) — перекрытие с полом комнаты разрешено. */
      ledge?: boolean;
    }
  | { t: "poly"; zone: string; pts: readonly (readonly [number, number])[]; h: number; tilt?: DunTilt; ledge?: boolean }
  | {
      t: "strip";
      zone: string;
      kind: DunStripKind;
      /** Ось: от (au, av) до (bu, bv), полная ширина w. */
      au: number;
      av: number;
      bu: number;
      bv: number;
      w: number;
      ha: number;
      hb: number;
      /**
       * Участок уклона вдоль оси, м от начала: до sa — высота ha, после sb — hb. У связок всё
       * считается само: sa/sb — края комнат на концах, ha/hb — высота их пола там (внутри комнат
       * полоса вровень с полом). У «fixed» — уклон на всю длину, высоты заданы.
       */
      sa: number;
      sb: number;
      /** Связка между комнатами: на концах внутри комнат полосы нет (там пол комнаты). */
      room?: boolean;
      /** Наклон поперёк полосы у начала и у конца (м на м) — как у пола наклонной комнаты на стыке. */
      ga?: number;
      gb?: number;
      ledge?: boolean;
    };

type Room = Extract<DunShape, { t: "disc" | "poly" }>;
type Strip = Extract<DunShape, { t: "strip" }>;

const disc = (zone: string, u: number, v: number, r: number, h: number, o: { ri?: number; ledge?: boolean } = {}): Room => ({ t: "disc", zone, u, v, r, h, ...o });
const poly = (zone: string, h: number, pts: [number, number][], o: { tilt?: DunTilt; ledge?: boolean } = {}): Room => ({ t: "poly", zone, pts, h, ...o });
/** Связка между двумя комнатами: начало и конец — внутри комнат, высоты и уклон — сами. */
const link = (zone: string, kind: DunStripKind, a: [number, number], b: [number, number], w: number): Strip => ({
  t: "strip", zone, kind, au: a[0], av: a[1], bu: b[0], bv: b[1], w, ha: NaN, hb: NaN, sa: NaN, sb: NaN,
});

/** Озеро внизу провала (вода — непроходимо, спуститься нельзя): смотрят с моста и с обрыва ступеней. */
export const DUN_LAKE: { pts: readonly (readonly [number, number])[]; h: number } = {
  // Весь провал между гротом U, паучьим гнездом W, обрывом ступеней S и западной стеной с водопадом.
  pts: [[-200, -72], [-142, -74], [-128, -56], [-123, -10], [-124, 30], [-132, 50], [-200, 52]],
  h: 2,
};

/** Уклон галереи и ступеней (м на м по u). */
const T_TILT: DunTilt = [-38, -140, 0.18, 0];
const S_TILT: DunTilt = [-120, 0, 16 / 86, 0];

/**
 * Проходимые фигуры (высоты — м над DUN_Y0: вход 58, вода 8, дно бездны −40). Залы крупные и стоят
 * плотно, между ними — короткие проходы и лестницы; мосты: Мост Предков (C), мост над озером мимо
 * водопада (E) и верёвочный к тайнику. В святилище H — единственный вход, из нефа V.
 * Главный путь: A → B → мост C → кольцо F → лестница → G → неф V → святилище H → выход J.
 * Запад: B → галерея T → грот U → кристаллы D → ступени S → F; U → мост над озером E → паучье гнездо W ← S.
 * Восток: B → шахты K → колодец N/O; F → каменный лес Q → верёвочный мост → тайник I.
 * Север: G → казармы P → кузня Y; G → склеп R → зал обрядов X. После босса: H → выход J → сокровищница Z.
 */
const ROOMS_AND_LINKS: DunShape[] = [
  // A — вход и лагерь экспедиции; лестница вниз в зал руин.
  poly("A", 58, [[-12, -200], [12, -200], [16, -186], [26, -180], [26, -166], [-8, -162], [-16, -176]]),
  link("A", "stairs", [6, -165], [6, -151], 10),
  // B — зал руин (помост со статуей убран: зал ровный).
  poly("B", 54, [[-32, -150], [-12, -156], [16, -154], [34, -142], [36, -122], [16, -112], [-14, -112], [-36, -124]]),
  // C — Мост Предков: два пролёта и большая площадка на опоре над Великим разломом.
  link("C", "bridge", [0, -116], [0, -92], 6),
  disc("C", 0, -80, 16, 47),
  link("C", "bridge", [0, -68], [0, -40], 6),
  // F — кольцевой зал вокруг провала.
  disc("F", 0, -10, 34, 40, { ri: 11 }),
  // G — парадная лестница и площадь; V — неф; H — святилище; J — выход; Z — сокровищница.
  link("G", "stairs", [0, 20], [0, 50], 16),
  poly("G", 56, [[-34, 46], [34, 46], [40, 76], [-40, 76]]),
  poly("V", 56, [[-10, 74], [10, 74], [10, 126], [-10, 126]]),
  poly("H", 56, [[-12, 124], [12, 124], [50, 132], [66, 156], [60, 184], [32, 198], [-32, 198], [-60, 184], [-66, 156], [-50, 132]]),
  link("J", "tunnel", [60, 170], [82, 175], 10),
  disc("J", 90, 176, 12, 60),
  link("Z", "tunnel", [98, 178], [120, 178], 10),
  poly("Z", 58, [[114, 150], [150, 130], [190, 140], [194, 184], [160, 198], [118, 196]]),
  // P — казармы (два зала), Y — кузня (тупик с мобами).
  link("P", "tunnel", [36, 62], [50, 62], 8),
  poly("P", 56, [[46, 50], [84, 50], [84, 88], [46, 88]]),
  link("P", "stairs", [80, 70], [100, 70], 8),
  poly("P", 52, [[96, 42], [140, 42], [140, 98], [96, 98]]),
  link("Y", "tunnel", [136, 72], [156, 72], 8),
  poly("Y", 48, [[152, 36], [196, 36], [196, 108], [152, 108]]),
  // R — склеп (два низких зала, вход с площади G, не из нефа), X — зал обрядов (тупик; в святилище хода нет).
  link("R", "stairs", [-30, 70], [-34, 92], 8),
  poly("R", 48, [[-24, 88], [-58, 84], [-62, 118], [-26, 122]]),
  poly("R", 48, [[-56, 92], [-96, 86], [-102, 116], [-60, 114]]),
  link("X", "tunnel", [-82, 112], [-92, 140], 8),
  poly("X", 50, [[-88, 134], [-96, 176], [-130, 196], [-176, 186], [-182, 146], [-140, 128]]),
  // K — шахты: три забоя на разных уровнях.
  link("K", "tunnel", [32, -136], [46, -136], 8),
  poly("K", 52, [[42, -152], [80, -164], [98, -140], [88, -118], [46, -120]]),
  link("K", "tunnel", [94, -142], [116, -142], 8),
  poly("K", 46, [[108, -162], [152, -172], [176, -148], [160, -122], [118, -120]]),
  link("K", "ramp", [124, -121], [124, -105], 8),
  poly("K", 39, [[94, -104], [130, -108], [142, -84], [120, -62], [92, -72]]),
  // N — колодец: широкие уступы по стенам вокруг провала, O — дно.
  link("N", "ramp", [156, -126], [152.5, -100], 8),
  disc("N", 152, -98, 5.5, 44),
  link("N", "ledge", [152, -98], [190, -98], 10),
  disc("N", 190, -98, 5.5, 37),
  link("N", "ledge", [190, -98], [190, -52], 10),
  disc("N", 190, -52, 5.5, 30),
  link("N", "ledge", [190, -52], [152, -52], 10),
  disc("N", 152, -52, 5.5, 23),
  link("N", "ledge", [152, -52], [152, -75], 10),
  disc("N", 152, -75, 5.5, 19.5),
  link("N", "ledge", [152, -75], [166, -75], 8),
  poly("O", 18, [[161, -88], [181, -88], [181, -62], [161, -62]]),
  // Q — каменный лес; верёвочный мост к тайнику I.
  link("Q", "tunnel", [30, -10], [46, -10], 10),
  poly("Q", 40, [[40, -30], [44, 22], [80, 36], [118, 26], [126, -14], [100, -42], [60, -46]]),
  link("I", "rope", [120, 2], [150, 4], 4),
  disc("I", 164, 4, 18, 40),
  // T — обвальная галерея (уклон вниз на запад), U — грот, D — кристаллы.
  link("T", "tunnel", [-30, -140], [-46, -142], 10),
  poly("T", 52, [[-38, -150], [-46, -172], [-92, -190], [-150, -186], [-182, -156], [-170, -128], [-120, -122], [-62, -128], [-40, -134]], { tilt: T_TILT }),
  link("U", "tunnel", [-160, -129], [-160, -112], 10),
  disc("U", -160, -96, 20, 26),
  link("D", "tunnel", [-142, -90], [-116, -86], 10),
  poly("D", 26, [[-52, -104], [-48, -66], [-68, -48], [-102, -48], [-122, -66], [-118, -96], [-92, -112], [-66, -114]]),
  // E — мост над озером мимо водопада: от грота к паучьему гнезду, посередине — площадка на скальном
  // столбе напротив водопада. К воде не спуститься.
  link("E", "bridge", [-172, -82], [-178, -6], 6),
  disc("E", -178, 0, 10, 26),
  link("E", "bridge", [-178, 6], [-180, 60], 6),
  // D → ступени S (вход на склон снизу).
  link("S", "ramp", [-86, -50], [-86, -30], 10),
  // S — затопленные ступени: широкий склон от обрыва над озером к залу Кольца (широкий проход сверху);
  // W — паучье гнездо.
  link("S", "tunnel", [-30, -10], [-44, -10], 12),
  poly("S", 24, [[-36, -28], [-34, 8], [-50, 34], [-80, 44], [-112, 40], [-121, 20], [-121, 0], [-104, -30], [-70, -38]], { tilt: S_TILT }),
  link("W", "ramp", [-104, 37], [-104, 60], 10),
  poly("W", 26, [[-96, 56], [-104, 96], [-146, 108], [-190, 96], [-192, 58], [-150, 54]]),
];

/** Точка внутри многоугольника (u, v). */
export function dunInPoly(pts: readonly (readonly [number, number])[], u: number, v: number): boolean {
  return inPoly(pts, u, v);
}

function inPoly(pts: readonly (readonly [number, number])[], u: number, v: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ui, vi] = pts[i];
    const [uj, vj] = pts[j];
    if (vi > v !== vj > v && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) inside = !inside;
  }
  return inside;
}

/** Расстояние от точки до отрезка и ближайшая точка на нём. */
function segNearest(u: number, v: number, au: number, av: number, bu: number, bv: number): [number, number, number] {
  const dx = bu - au;
  const dz = bv - av;
  const L2 = dx * dx + dz * dz;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((u - au) * dx + (v - av) * dz) / L2)) : 0;
  const pu = au + dx * t;
  const pv = av + dz * t;
  return [Math.hypot(u - pu, v - pv), pu, pv];
}

/** Комната (диск/кольцо/многоугольник) накрывает точку с отступом pad от края. */
function roomHas(s: Room, u: number, v: number, pad: number): boolean {
  if (s.t === "disc") {
    const d2 = (u - s.u) * (u - s.u) + (v - s.v) * (v - s.v);
    const r = s.r - pad;
    if (d2 > r * r) return false;
    return !s.ri || d2 >= (s.ri + pad) * (s.ri + pad);
  }
  if (!inPoly(s.pts, u, v)) return false;
  if (pad <= 0) return true;
  for (let i = 0, j = s.pts.length - 1; i < s.pts.length; j = i++) {
    if (segNearest(u, v, s.pts[j][0], s.pts[j][1], s.pts[i][0], s.pts[i][1])[0] < pad) return false;
  }
  return true;
}

const ccw = new WeakMap<object, boolean>();
/** Обход вершин многоугольника против часовой стрелки (в осях u, v)? */
function polyCcw(s: Extract<DunShape, { t: "poly" }>): boolean {
  let r = ccw.get(s);
  if (r === undefined) {
    let a = 0;
    for (let i = 0, j = s.pts.length - 1; i < s.pts.length; j = i++) a += s.pts[j][0] * s.pts[i][1] - s.pts[i][0] * s.pts[j][1];
    r = a > 0;
    ccw.set(s, r);
  }
  return r;
}

/** Высота пола комнаты в точке (у наклонной — по плоскости). */
function roomH(s: Room, u: number, v: number): number {
  if (s.t === "poly" && s.tilt) return s.h + (u - s.tilt[0]) * s.tilt[2] + (v - s.tilt[1]) * s.tilt[3];
  return s.h;
}

// Связки: начало и конец — в комнатах; уклон — между их краями, высоты — пол комнат на краях.
for (const s of ROOMS_AND_LINKS) {
  if (s.t !== "strip" || !Number.isNaN(s.sa)) continue;
  const L = Math.hypot(s.bu - s.au, s.bv - s.av);
  const at = (d: number): [number, number] => [s.au + ((s.bu - s.au) * d) / L, s.av + ((s.bv - s.av) * d) / L];
  const roomAt = (d: number): Room | undefined => {
    const [u, v] = at(d);
    return ROOMS_AND_LINKS.find((r): r is Room => r.t !== "strip" && !r.ledge && roomHas(r, u, v, 0));
  };
  const ra = roomAt(0);
  const rb = roomAt(L);
  if (!ra || !rb) {
    // Ошибка планировки: видна в проверке (scratchpad dun_map) и в логах; полоса остаётся ровной.
    console.warn(`dungeon: связка ${s.zone} (${s.au},${s.av})→(${s.bu},${s.bv}) не начинается/не кончается в комнате`);
    s.sa = 0;
    s.sb = L;
    s.ha = s.hb = ra ? roomH(ra, s.au, s.av) : rb ? roomH(rb, s.bu, s.bv) : 0;
    continue;
  }
  let sa = 0;
  while (sa < L && roomHas(ra, ...at(sa), 0)) sa += 0.1;
  let sb = L;
  while (sb > sa && roomHas(rb, ...at(sb), 0)) sb -= 0.1;
  s.sa = sa;
  s.sb = Math.max(sa, sb);
  s.room = true;
  // Поперечный наклон на концах — как у пола комнаты (у наклонной комнаты он не ноль).
  const cu = (s.bv - s.av) / L;
  const cv = -(s.bu - s.au) / L;
  const across = (r: Room): number => (r.t === "poly" && r.tilt ? r.tilt[2] * cu + r.tilt[3] * cv : 0);
  s.ga = across(ra);
  s.gb = across(rb);
  s.ha = roomH(ra, ...at(Math.max(0, sa - 0.1)));
  s.hb = roomH(rb, ...at(Math.min(L, s.sb + 0.1)));
}

export const DUN_SHAPES: readonly DunShape[] = ROOMS_AND_LINKS;

/** Рамки фигур (u0, v0, u1, v1) — быстрый отсев в dunFloorLocal. */
const BOX: Float64Array = new Float64Array(ROOMS_AND_LINKS.length * 4);
ROOMS_AND_LINKS.forEach((s, i) => {
  let u0: number, v0: number, u1: number, v1: number;
  if (s.t === "disc") [u0, v0, u1, v1] = [s.u - s.r, s.v - s.r, s.u + s.r, s.v + s.r];
  else if (s.t === "poly") {
    u0 = Math.min(...s.pts.map((p) => p[0]));
    v0 = Math.min(...s.pts.map((p) => p[1]));
    u1 = Math.max(...s.pts.map((p) => p[0]));
    v1 = Math.max(...s.pts.map((p) => p[1]));
  } else {
    const hw = s.w / 2;
    [u0, v0, u1, v1] = [Math.min(s.au, s.bu) - hw, Math.min(s.av, s.bv) - hw, Math.max(s.au, s.bu) + hw, Math.max(s.av, s.bv) + hw];
  }
  BOX.set([u0, v0, u1, v1], i * 4);
});

/**
 * Пустоты — бездна, озеро, провалы: над ними края залов остаются открытыми (без скальных стен), чтобы
 * было видно разлом, озеро, колодец. Многоугольники в локальных координатах.
 */
export const DUN_VOIDS: readonly (readonly (readonly [number, number])[])[] = [
  DUN_LAKE.pts,
  // Великий разлом под Мостом Предков (между залом руин и залом Кольца).
  [[-40, -112], [40, -112], [40, -46], [-40, -46]],
  // Расселина под верёвочным мостом к тайнику.
  [[120, -20], [148, -20], [148, 24], [120, 24]],
  // Провал колодца внутри уступов.
  [[156, -94], [186, -94], [186, -56], [156, -56]],
];

/** Водопады у стены: сверху (u, v, top) вниз до bottom, ширина w; yaw — куда смотрит пелена от стены (рад, +z → (sin, cos)). */
export const DUN_FALLS: readonly { u: number; v: number; top: number; bottom: number; w: number; yaw: number }[] = [
  { u: -199, v: 0, top: 80, bottom: DUN_LAKE.h, w: 12, yaw: Math.PI / 2 },
  { u: 39, v: -84, top: 70, bottom: DUN_VOID_H, w: 7, yaw: -Math.PI / 2 },
  { u: 171, v: -58.5, top: 50, bottom: 18, w: 4, yaw: Math.PI },
];

/**
 * Ворота святилища — прямо перед залом босса, в конце нефа (единственный вход в H). Проём шириной w
 * по оси u с центром (u, v), высота h. Пока — только вид; позже закрываются на время боя с боссом.
 */
export const DUN_BOSS_GATE = { u: 0, v: 124, w: 20, h: 16 } as const;

/** Портал в подземелье у лагеря (мир): за западной оградой, отдельно от портала катакомб. Радиус входа r. */
export const DUN_PORTAL = { x: HUB_CENTER.x - 42, z: HUB_CENTER.z - 3, r: 2.2 } as const;
/** Куда выходит герой из подземелья: перед порталом, со стороны лагеря. */
export const DUN_PORTAL_EXIT = { x: DUN_PORTAL.x + 4.5, z: DUN_PORTAL.z } as const;

/** Точки зоны: появление игроков, лут, порталы. */
export const DUN_SPOTS = {
  /** Вход из лагеря. */
  entry: { u: 0, v: -192 },
  /** Порталы обратно в лагерь: у входа и на площадке выхода за святилищем. */
  portals: [
    { u: 0, v: -197 },
    { u: 94, v: 180 },
  ],
  /** Сундуки: тайник, колодец, грот, склеп, святилище, сокровищница храма, паучье гнездо. */
  chests: [
    { u: 170, v: 10 },
    { u: 171, v: -75 },
    { u: -168, v: -100 },
    { u: -90, v: 100 },
    { u: 0, v: 190 },
    { u: 170, v: 170 },
    { u: -170, v: 90 },
  ],
  /** Безопасные места (мобы не заходят): площадка у портала. */
  safe: [{ u: 0, v: -190, r: 10 }],
} as const;

/**
 * Лагеря мобов подземелья — в начальных залах (u, v зоны). Отдельно от MOB_CAMPS: боты и задания
 * лагеря мира не выбирают, а этот — внутри подземелья. Спавн — ZoneSim (как у лагерей мира).
 */
export const DUN_MOB_CAMPS: readonly { u: number; v: number; type: keyof typeof ELITE_MOBS; count: number; spread: number; noChamp?: boolean; ring?: number; dmgMul?: number; atkMul?: number; shareScrap?: boolean; /** Дом бота (u, v), если не центр зала: ближайшая комната к телепорту. */ home?: { u: number; v: number } }[] = [
  // Зал руин (B): три плотные группы — запад, восток и дальняя стена; в центре зала — свободно,
  // боты приходят к центру (см. ZoneRoom CAMP_SPOTS) и достают жнецов со всех сторон.
  // Не у края провала (провал — у северной стены, v≈−116), от портала ~74 м.
  { u: -18, v: -138, type: "skeletonReaver", count: 6, spread: 1.5 },
  { u: 20, v: -138, type: "skeletonReaver", count: 6, spread: 1.5 },
  { u: 0, v: -146, type: "skeletonReaver", count: 6, spread: 1.5 },
  // Пауки 60 ур.: Зал Кольца (F) — по кольцу вокруг светящегося провала (провал r≈11, кольцо до r≈34;
  // центр не берём — упадут), и площадка моста (C) на опоре посередине.
  { u: 0, v: 10, type: "spider", count: 18, spread: 6 },
  { u: -20, v: -10, type: "spider", count: 18, spread: 6 },
  { u: 0, v: -80, type: "spider", count: 12, spread: 8 },
  // Ледяной гигант 70 ур.: только в подземелье, по одному — ровно на точке (центр зала): Шахтные выработки (K), Каменный лес (Q),
  // Преддверие храма (G), Кристальная пещера (D). Стоянка = центр зоны (DUN_ZONES): от него бот берёт дом стоянки (ZoneRoom CAMP_SPOTS). Тест: tests/shared/giantCamps.test.ts.
  // Шахтные выработки (K): гигант — в первой комнате от входа из руин (K1), дом бота — там же, ближе к телепорту.
  { u: 71, v: -139, type: "iceGiant", count: 2, spread: 10, ring: 0.5, noChamp: true, dmgMul: 3, atkMul: 1.5, shareScrap: true, home: { u: 71, v: -139 } }, // было: центр забоя (144, -146)
  // Прежнее место гиганта — центр забоя K3 (144, −146), было далеко от входа.
  { u: 82, v: -6, type: "iceGiant", count: 2, spread: 10, ring: 0.5, noChamp: true, dmgMul: 3, atkMul: 1.5, shareScrap: true },
  { u: 0, v: 60, type: "iceGiant", count: 2, spread: 10, ring: 0.5, noChamp: true, dmgMul: 3, atkMul: 1.5, shareScrap: true },
  // Лавовый монстр 75 ур. — Затопленные ступени (S) и Обвальная галерея (T): по две группы из четырёх мобов,
  // Стражи и Маги вперемешку. Урон ×3 — как у гиганта (dmgMul камеры).
  { u: -80, v: 4, type: "lavaGuard", count: 4, spread: 3, ring: 0.5, noChamp: true, dmgMul: 3 },
  { u: -100, v: 24, type: "lavaMage", count: 4, spread: 3, ring: 0.5, noChamp: true, dmgMul: 3 },
  { u: -110, v: -156, type: "lavaMage", count: 4, spread: 3, ring: 0.5, noChamp: true, dmgMul: 3 },
  { u: -90, v: -170, type: "lavaGuard", count: 4, spread: 3, ring: 0.5, noChamp: true, dmgMul: 3 },
];

// ---------------------------------------------------------------------------
// Геометрия фигур (локально).

/** Высота фигуры в точке (u, v) с отступом pad от края; null — точка вне фигуры. */
function shapeHeight(s: DunShape, u: number, v: number, pad = 0): number | null {
  if (s.t !== "strip") return roomHas(s, u, v, pad) ? roomH(s, u, v) : null;
  const dx = s.bu - s.au;
  const dz = s.bv - s.av;
  const L = Math.hypot(dx, dz);
  const ru = u - s.au;
  const rv = v - s.av;
  const along = (ru * dx + rv * dz) / L;
  const across = (ru * dz - rv * dx) / L;
  if (along < 0 || along > L || Math.abs(across) > s.w / 2 - pad) return null;
  // Внутри комнат на концах связки — только пол комнаты (у наклонной он разный по ширине полосы).
  if (s.room && (along < s.sa - 0.5 || along > s.sb + 0.5)) return null;
  const t = along <= s.sa ? 0 : along >= s.sb ? 1 : (along - s.sa) / (s.sb - s.sa);
  return s.ha + (s.hb - s.ha) * t + across * ((s.ga ?? 0) * (1 - t) + (s.gb ?? 0) * t);
}

/** Ближайшая точка фигуры (с отступом pad) к (u, v). */
function shapeNearest(s: DunShape, u: number, v: number, pad: number): [number, number] {
  if (s.t === "disc") {
    const r = Math.max(0.1, s.r - pad);
    const dx = u - s.u;
    const dz = v - s.v;
    const d = Math.hypot(dx, dz) || 1e-6;
    if (s.ri && d < s.ri + pad) return [s.u + (dx / d) * (s.ri + pad), s.v + (dz / d) * (s.ri + pad)];
    if (d <= r) return [u, v];
    return [s.u + (dx / d) * r, s.v + (dz / d) * r];
  }
  if (s.t === "poly") {
    if (roomHas(s, u, v, pad)) return [u, v];
    // На ближайшую сторону и внутрь по её нормали (к центру — нельзя: у вогнутого зала уводит наружу).
    // Если у вогнутого угла и так не попали внутрь — ещё раз от полученной точки.
    let qu = u;
    let qv = v;
    for (let iter = 0; iter < 4; iter++) {
      let best: [number, number, number] = [Infinity, qu, qv];
      let nu = 0;
      let nv = 0;
      for (let i = 0, j = s.pts.length - 1; i < s.pts.length; j = i++) {
        const [au, av] = s.pts[j];
        const [bu, bv] = s.pts[i];
        const r = segNearest(qu, qv, au, av, bu, bv);
        if (r[0] < best[0]) {
          best = r;
          const L = Math.hypot(bu - au, bv - av) || 1;
          // Нормаль внутрь: у многоугольника против часовой — слева от стороны.
          const k = polyCcw(s) ? 1 : -1;
          nu = (-(bv - av) / L) * k;
          nv = ((bu - au) / L) * k;
        }
      }
      qu = best[1] + nu * (pad + 0.05);
      qv = best[2] + nv * (pad + 0.05);
      if (roomHas(s, qu, qv, pad * 0.5)) return [qu, qv];
    }
    // Острый угол: ищем ближайшую точку внутри по кругу вокруг найденной (всегда находится — угол не 0°).
    for (let r = pad + 0.1; r <= pad * 4 + 1; r += 0.25)
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const tu = qu + Math.cos(a) * r;
        const tv = qv + Math.sin(a) * r;
        if (roomHas(s, tu, tv, pad * 0.5)) return [tu, tv];
      }
    return [qu, qv];
  }
  const dx = s.bu - s.au;
  const dz = s.bv - s.av;
  const L = Math.hypot(dx, dz);
  const ex = dx / L;
  const ez = dz / L;
  const ru = u - s.au;
  const rv = v - s.av;
  const hw = Math.max(0.1, s.w / 2 - pad);
  // У связки полоса есть только между краями комнат (±0.5 м) — ближайшая точка тоже там.
  const lo = s.room ? Math.max(0, s.sa - 0.45) : 0;
  const hi = s.room ? Math.min(L, s.sb + 0.45) : L;
  const along = Math.max(lo, Math.min(hi, ru * ex + rv * ez));
  const across = Math.max(-hw, Math.min(hw, ru * ez - rv * ex));
  return [s.au + ex * along + ez * across, s.av + ez * along - ex * across];
}

/** Высота пола комнаты по её плоскости (и на границе; для клиента — вершины многоугольника). */
export function dunRoomHeight(s: DunShape, u: number, v: number): number {
  return s.t === "strip" ? s.ha : roomH(s, u, v);
}

/** Высота фигуры (для проверок и клиента). */
export function dunShapeHeight(s: DunShape, u: number, v: number): number | null {
  return shapeHeight(s, u, v);
}

function floorRaw(u: number, v: number): number | null {
  let best: number | null = null;
  for (let i = 0; i < DUN_SHAPES.length; i++) {
    const b = i * 4;
    if (u < BOX[b] || v < BOX[b + 1] || u > BOX[b + 2] || v > BOX[b + 3]) continue;
    const h = shapeHeight(DUN_SHAPES[i], u, v);
    if (h !== null && (best === null || h > best)) best = h;
  }
  return best;
}

const PAD_DIRS = Array.from({ length: 8 }, (_, k) => [Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)] as const);

/**
 * Высота пола (локально) — максимум по фигурам, накрывающим точку; null — пропасть/скала.
 * pad > 0: ещё и вокруг на pad во все стороны должен быть пол той же высоты (стыки фигур — не край).
 */
export function dunFloorLocal(u: number, v: number, pad = 0): number | null {
  const h = floorRaw(u, v);
  if (h === null || pad <= 0) return h;
  for (const [du, dv] of PAD_DIRS) {
    const q = floorRaw(u + du * pad, v + dv * pad);
    if (q === null || Math.abs(q - h) > 0.6) return null;
  }
  return h;
}

// ---------------------------------------------------------------------------
// Мировые координаты.

/** Точка в участке подземелья. */
export function inDunRegion(x: number, z: number): boolean {
  // С запасом за крайние залы: шаг за стену — всё ещё подземелье (ограда вернёт), а не край карты наверху.
  return Math.abs(x - DUN_X) < DUN_HALF + 20 && Math.abs(z - DUN_Z) < DUN_HALF + 20;
}

/**
 * Ближайшая точка у края участка подземелья, но уже снаружи: стена для того, кто стоит на поверхности
 * (пол подземелья глубоко внизу — падать туда нельзя).
 */
export function dunPushOut(x: number, z: number): [number, number] {
  const R = DUN_HALF + 20; // как в inDunRegion
  const e = 0.05;
  const opts: [number, number, number][] = [
    [DUN_X + R + e, z, Math.abs(DUN_X + R - x)],
    [DUN_X - R - e, z, Math.abs(x - (DUN_X - R))],
    [x, DUN_Z + R + e, Math.abs(DUN_Z + R - z)],
    [x, DUN_Z - R - e, Math.abs(z - (DUN_Z - R))],
  ];
  let best = opts[0];
  for (const o of opts) if (o[2] < best[2]) best = o;
  return [best[0], best[1]];
}

/** Мировая высота пола; вне проходимого — дно пропасти. */
export function dunHeight(x: number, z: number): number {
  const h = dunFloorLocal(x - DUN_X, z - DUN_Z);
  return DUN_Y0 + (h ?? DUN_VOID_H);
}

/** Мир ↔ локальные. */
export function dunWorld(u: number, v: number): { x: number; z: number } {
  return { x: DUN_X + u, z: DUN_Z + v };
}

/**
 * Точка в объёме комнат подземелья: над полом фигуры (не в стене и не в пустоте) и ниже свода зоны.
 * Вне участка подземелья — нет: камера туда не уходит (иначе чёрный экран за пределом карты).
 */
export function dunInRooms(x: number, y: number, z: number): boolean {
  if (!inDunRegion(x, z)) return false;
  const h = dunFloorLocal(x - DUN_X, z - DUN_Z, 0);
  if (h === null) return false;
  const floorW = DUN_Y0 + h;
  return y >= floorW + 0.2 && y <= floorW + dunZoneAt(x, z).ceil - 0.3;
}

/**
 * Длина луча от точки (tx,ty,tz) по единичному направлению (dx,dy,dz), пока камера в комнатах: стены,
 * свод и пустота её не пускают. Не больше len. Вне подземелья, или если сама точка не в комнатах
 * (цель в стене) — len: не ломаем камеру из-за неудачной точки.
 */
export function dunRayClear(tx: number, ty: number, tz: number, dx: number, dy: number, dz: number, len: number): number {
  if (!inDunRegion(tx, tz) || !dunInRooms(tx, ty, tz)) return len;
  const STEP = 0.2;
  for (let s = STEP; s < len + STEP / 2; s += STEP) {
    const k = Math.min(s, len);
    if (dunInRooms(tx + dx * k, ty + dy * k, tz + dz * k)) continue;
    // Край — между шагами: уточняем делением пополам. Без этого длина луча прыгала шагами по 0.2 м,
    // и камера у стены/свода дёргалась при каждом движении цели — казалось, что рывками идут все.
    let lo = Math.max(0, k - STEP);
    let hi = k;
    for (let i = 0; i < 6; i++) {
      const m = (lo + hi) / 2;
      if (dunInRooms(tx + dx * m, ty + dy * m, tz + dz * m)) lo = m;
      else hi = m;
    }
    return Math.max(0, lo - 0.1); // тот же средний запас от стены, что был при шаге 0.2
  }
  return len;
}

/** Ближе камера к цели в подземелье не встаёт: вплотную голова героя заслоняет кадр, а на нуле вид вырождается (чёрный экран). */
export const DUN_CAM_MIN = 1.0;

/**
 * Позиция камеры: цель (tx,ty,tz), от неё — направление (ux,uy,uz) к камере на длину dist. В подземелье стены и
 * свод укорачивают луч, но не ближе DUN_CAM_MIN. Сзади мало места — камера уходит туда, где его больше: напротив
 * или вбок. Вне участка подземелья — ровно цель + направление · dist (как было).
 */
export function dunCamPos(tx: number, ty: number, tz: number, ux: number, uy: number, uz: number, dist: number, minDist = DUN_CAM_MIN): [number, number, number] {
  const ul = Math.hypot(ux, uy, uz) || 1;
  const x = ux / ul;
  const y = uy / ul;
  const z = uz / ul;
  const at = (dx: number, dy: number, dz: number, d: number): [number, number, number] => [tx + dx * d, ty + dy * d, tz + dz * d];
  if (!inDunRegion(tx, tz)) return at(x, y, z, dist);
  const d0 = Math.max(dist, minDist);
  const back = dunRayClear(tx, ty, tz, x, y, z, d0);
  if (back >= d0) return at(x, y, z, d0);
  if (back >= minDist) return at(x, y, z, Math.max(minDist, back - 0.15));
  const hl = Math.hypot(x, z) || 1;
  const px = -z / hl;
  const pz = x / hl;
  let best: [number, number, number] = [-x, -y, -z];
  let bestLen = dunRayClear(tx, ty, tz, best[0], best[1], best[2], d0);
  for (const c of [[px, 0, pz], [-px, 0, -pz]] as const) {
    const len = dunRayClear(tx, ty, tz, c[0], c[1], c[2], d0);
    if (len > bestLen) {
      best = [c[0], c[1], c[2]];
      bestLen = len;
    }
  }
  if (bestLen >= minDist) return at(best[0], best[1], best[2], Math.max(minDist, Math.min(d0, bestLen - 0.15)));
  return at(x, y, z, minDist);
}

/**
 * Ближайшая точка, где можно стоять (мир). Внутри проходимого — та же точка. Снаружи — на ближайшую
 * фигуру на той же высоте, что и fromY (±ступень): нельзя ни «перескочить» щель на верхний уступ, ни
 * спрыгнуть с моста или уступа на нижний ярус — края работают как невидимая ограда.
 */
export function dunProject(x: number, z: number, pad = 0.4, fromY?: number): [number, number] {
  const u = x - DUN_X;
  const v = z - DUN_Z;
  if (dunFloorLocal(u, v, pad) !== null) return [x, z];
  const pick = (filter: boolean): [number, number] | null => {
    let best: [number, number] | null = null;
    let bd = Infinity;
    for (const s of DUN_SHAPES) {
      const [pu, pv] = shapeNearest(s, u, v, pad);
      const d = (pu - u) * (pu - u) + (pv - v) * (pv - v);
      if (d >= bd) continue;
      const own = shapeHeight(s, pu, pv, Math.max(0, pad * 0.5 - 0.01));
      if (own === null) continue; // ближайшая точка фигуры — не её пол (стык, угол): не годится
      if (filter && fromY !== undefined) {
        const h = DUN_Y0 + own;
        // Ни вверх через щель, ни вниз с моста/уступа (ограда). Ниже ног допускаем на высоту прыжка
        // с запасом: в прыжке ноги над полом, и ограда должна держать и тогда.
        if (h - fromY > 1.2 || fromY - h > 2.5) continue;
      }
      bd = d;
      best = [pu, pv];
    }
    return best;
  };
  // Подходящей по высоте фигуры нет (падение, телепорт) — всё равно на ближайший пол, не в пропасть.
  const [bu, bv] = pick(true) ?? pick(false) ?? [u, v];
  return [DUN_X + bu, DUN_Z + bv];
}

/** Мировая точка входа (появление из портала), с разбросом по i. */
export function dunEntry(i = 0): { x: number; z: number } {
  const k = i % 6;
  return dunWorld(DUN_SPOTS.entry.u + ((k % 3) - 1) * 1.6, DUN_SPOTS.entry.v + Math.floor(k / 3) * 1.6);
}

/** Зона, к которой относится точка (по накрывающей фигуре; вне — ближайший центр зоны). */
export function dunZoneAt(x: number, z: number): DunZone {
  const u = x - DUN_X;
  const v = z - DUN_Z;
  let id: string | null = null;
  let hBest = -Infinity;
  for (const s of DUN_SHAPES) {
    const h = shapeHeight(s, u, v);
    if (h !== null && h > hBest) {
      hBest = h;
      id = s.zone;
    }
  }
  if (id) return DUN_ZONES.find((zn) => zn.id === id)!;
  let best = DUN_ZONES[0];
  let bd = Infinity;
  for (const zn of DUN_ZONES) {
    const d = (zn.u - u) ** 2 + (zn.v - v) ** 2;
    if (d < bd) {
      bd = d;
      best = zn;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Навигация ботов и мобов: граф строится сам — узлы на концах связок и в центрах комнат,
// рёбра — связки и прямые внутри комнат; путь — Дейкстра.

/** Прямая (локально) целиком по проходимому, без подъёма круче ступени на шаге 0.5 м. */
export function dunSegmentClear(u0: number, v0: number, u1: number, v1: number, pad = 0.3, step = 0.5): boolean {
  const L = Math.hypot(u1 - u0, v1 - v0);
  const n = Math.max(1, Math.ceil(L / step));
  let prev = dunFloorLocal(u0, v0, pad);
  if (prev === null) return false;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const h = dunFloorLocal(u0 + (u1 - u0) * t, v0 + (v1 - v0) * t, pad);
    if (h === null || Math.abs(h - prev) > step) return false;
    prev = h;
  }
  return true;
}

export interface DunNavNode {
  u: number;
  v: number;
}
const nodes: DunNavNode[] = [];
const edges: [number, number][] = [];
const navAdj: number[][] = [];
let navBuilt = false;
/** Граф строится при первом запросе пути (сервер), не при загрузке модуля (клиент его не ждёт). */
function buildNav(): void {
  if (navBuilt) return;
  navBuilt = true;
  const add = (u: number, v: number): number => {
    const k = nodes.findIndex((n) => Math.hypot(n.u - u, n.v - v) < 1);
    if (k >= 0) return k;
    nodes.push({ u, v });
    return nodes.length - 1;
  };
  // Узлы комнат: центр (у кольца — восемь точек на середине ширины), у многоугольника ещё вершины чуть внутрь.
  for (const r of DUN_SHAPES) {
    if (r.t === "strip") continue;
    if (r.t === "disc" && r.ri) {
      const mid = (r.r + r.ri) / 2;
      for (let k = 0; k < 8; k++) add(r.u + Math.cos((k * Math.PI) / 4) * mid, r.v + Math.sin((k * Math.PI) / 4) * mid);
    } else if (r.t === "disc") add(r.u, r.v);
    else {
      const cu = r.pts.reduce((a, p) => a + p[0], 0) / r.pts.length;
      const cv = r.pts.reduce((a, p) => a + p[1], 0) / r.pts.length;
      add(cu, cv);
      for (const [pu, pv] of r.pts) {
        const k = Math.hypot(cu - pu, cv - pv) || 1;
        const iu = pu + ((cu - pu) / k) * 3;
        const iv = pv + ((cv - pv) / k) * 3;
        if (roomHas(r, iu, iv, 1)) add(iu, iv);
      }
    }
  }
  // Связки: узлы на концах (чуть внутрь) и через каждые 15 м вдоль оси.
  for (const s of DUN_SHAPES) {
    if (s.t !== "strip") continue;
    const L = Math.hypot(s.bu - s.au, s.bv - s.av);
    const n = Math.max(1, Math.ceil((L - 1.2) / 15));
    for (let k = 0; k <= n; k++) {
      const d = 0.6 + ((L - 1.2) * k) / n;
      add(s.au + ((s.bu - s.au) * d) / L, s.av + ((s.bv - s.av) * d) / L);
    }
  }
  // Рёбра: все пары ближе NAV_LINK м с проходимой прямой между ними.
  // Рёбра: все пары ближе NAV_NEAR м с проходимой прямой; в одной большой комнате — до NAV_FAR м.
  const NAV_NEAR = 40;
  const NAV_FAR = 70;
  const roomOf = nodes.map((n) => DUN_SHAPES.findIndex((r) => r.t !== "strip" && roomHas(r, n.u, n.v, 0)));
  for (let a = 0; a < nodes.length; a++)
    for (let b = a + 1; b < nodes.length; b++) {
      const A = nodes[a];
      const B = nodes[b];
      const d = Math.hypot(A.u - B.u, A.v - B.v);
      if (d > NAV_FAR || (d > NAV_NEAR && (roomOf[a] < 0 || roomOf[a] !== roomOf[b]))) continue;
      if (dunSegmentClear(A.u, A.v, B.u, B.v)) edges.push([a, b]);
    }
  for (let i = 0; i < nodes.length; i++) navAdj.push([]);
  for (const [a, b] of edges) {
    navAdj[a].push(b);
    navAdj[b].push(a);
  }
}
/** Граф маршрутов (для проверок и карты). */
export function dunNavGraph(): { nodes: readonly DunNavNode[]; edges: readonly (readonly [number, number])[] } {
  buildNav();
  return { nodes, edges };
}

/** Ближайший узел графа, до которого из точки идёт прямая по проходимому (−1 — нет). */
function nearestNode(u: number, v: number): number {
  const order = nodes.map((n, i) => [(n.u - u) ** 2 + (n.v - v) ** 2, i] as const).sort((p, q) => p[0] - q[0]);
  for (const [, i] of order.slice(0, 12)) if (dunSegmentClear(u, v, nodes[i].u, nodes[i].v)) return i;
  return -1;
}

/**
 * Путь (мир) из (x0,z0) в (x1,z1): список точек-ориентиров, последняя — цель. Прямо, если можно;
 * иначе через узлы графа. Недостижимо — пустой список.
 */
export function dunPath(x0: number, z0: number, x1: number, z1: number): { x: number; z: number }[] {
  const u0 = x0 - DUN_X;
  const v0 = z0 - DUN_Z;
  const u1 = x1 - DUN_X;
  const v1 = z1 - DUN_Z;
  if (dunSegmentClear(u0, v0, u1, v1)) return [{ x: x1, z: z1 }];
  buildNav();
  const t = nearestNode(u1, v1);
  if (t < 0) return [];
  const n = nodes.length;
  // Дерево кратчайших путей от узла цели (граф неориентированный): prev[i] — следующий узел к цели.
  const dist = new Array<number>(n).fill(Infinity);
  const prev = new Array<number>(n).fill(-1);
  const done = new Array<boolean>(n).fill(false);
  dist[t] = 0;
  for (;;) {
    let c = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (c < 0 || dist[i] < dist[c])) c = i;
    if (c < 0) break;
    done[c] = true;
    for (const j of navAdj[c]) {
      const d = dist[c] + Math.hypot(nodes[j].u - nodes[c].u, nodes[j].v - nodes[c].v);
      if (d < dist[j]) {
        dist[j] = d;
        prev[j] = c;
      }
    }
  }
  // Старт — не ближайший узел (он может оказаться позади: бот разворачивался у угла), а видимый узел
  // с наименьшей полной длиной «до узла + по графу до цели». Так маршрут не меняется от точки к точке.
  const cand = nodes
    .map((nd, i) => [(nd.u - u0) ** 2 + (nd.v - v0) ** 2, i] as const)
    .sort((a, b) => a[0] - b[0])
    .slice(0, 40);
  let s = -1;
  let best = Infinity;
  for (const [, i] of cand) {
    if (dist[i] === Infinity || !dunSegmentClear(u0, v0, nodes[i].u, nodes[i].v)) continue;
    const L = Math.hypot(nodes[i].u - u0, nodes[i].v - v0) + dist[i];
    if (L < best) {
      best = L;
      s = i;
    }
  }
  if (s < 0) return [];
  const chain: number[] = [];
  for (let c = s; c >= 0; c = prev[c]) chain.push(c);
  const out = chain.map((i) => dunWorld(nodes[i].u, nodes[i].v));
  out.push({ x: x1, z: z1 });
  return out;
}
