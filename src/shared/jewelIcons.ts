/**
 * Значки колец и камней (утверждены 2026-10-07; предпросмотр — art/icons-preview/rings-gems.html).
 * Один источник для ПК/телефона, страницы !inv и VR-холстов: функции отдают готовый <svg>.
 * Камень: огранка по атрибуту, вид растёт ступенями по уровню. Кольцо: тир и камни в гнёздах.
 */
import { GEM_LOOK, parseGem, RING_LOOK, type GemAttr, type GemKey, type RingTier } from "./jewels";

const SHAPE: Record<GemAttr, number[][]> = {
  str: [[50,10],[78,22],[90,50],[78,78],[50,90],[22,78],[10,50],[22,22]],        // восьмигранник
  agi: [[50,8],[76,38],[70,72],[50,92],[30,72],[24,38]],                            // капля-лист
  int: [[50,10],[90,82],[10,82]],                                                     // треугольник
  wis: Array.from({length:12},(_,i)=>{const a=i/12*Math.PI*2;return[50+40*Math.sin(a),50-40*Math.cos(a)]}), // круглый бриллиант
  luc: [[50,6],[62,38],[94,50],[62,62],[50,94],[38,62],[6,50],[38,38]],             // звезда
  con: [[22,14],[78,14],[90,30],[90,70],[78,86],[22,86],[10,70],[10,30]],           // квадрат-«изумруд»
};
let uid = 0;
// Ступени вида по уровню: 1 — сырой самородок, 2 — простая огранка, 3 — блестящая огранка,
// 4–5 — сияние и искры, 6–9 — золотая оправа-лапки, 10+ — лучи и корона света.
function stage(lv: number): number { return lv >= 10 ? 6 : lv >= 6 ? 5 : lv >= 4 ? 4 : lv; }
function gem(k: GemAttr, lv = 1, scale = 1, cx = 50, cy = 50): string {
  const G = GEM_LOOK[k], id = "g" + (uid++), st = stage(lv);
  const T = (x: number, y: number): number[] => [cx + (x - 50) * scale, cy + (y - 50) * scale];
  const S = (n: number): number => n * scale;
  let out = `<defs>
    <radialGradient id="h${id}"><stop offset="0" stop-color="${G.c}" stop-opacity="1"/><stop offset=".55" stop-color="${G.c}" stop-opacity=".35"/><stop offset="1" stop-color="${G.c}" stop-opacity="0"/></radialGradient>
    <linearGradient id="b${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${G.l}"/><stop offset=".4" stop-color="${G.c}"/><stop offset="1" stop-color="${G.d}"/></linearGradient>
    <linearGradient id="m${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${G.c}"/><stop offset="1" stop-color="${G.d}"/></linearGradient></defs>`;
  if (st === 1) {
    // Сырой самородок: неровный, матовый, с прожилками.
    const raw = [[30,30],[52,20],[72,30],[78,52],[66,74],[42,80],[24,64],[22,44]].map(([x, y]) => T(x,y).join(",")).join(" ");
    out += `<polygon points="${raw}" fill="url(#m${id})" stroke="${G.d}" stroke-width="${S(3)}" stroke-linejoin="round"/>`;
    out += `<path d="M${T(36,34)} L${T(50,50)} L${T(44,70)} M${T(50,50)} L${T(68,44)}" stroke="${G.d}" stroke-width="${S(2)}" fill="none" opacity=".6"/>`;
    out += `<path d="M${T(36,30)} L${T(50,25)}" stroke="${G.l}" stroke-width="${S(3)}" stroke-linecap="round" opacity=".5"/>`;
    return out;
  }
  // Сияние и лучи — под камнем.
  if (st >= 6) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, r0 = 30, r1 = i % 2 ? 44 : 50;
      out += `<path d="M${T(50 + Math.sin(a - 0.08) * r0, 50 - Math.cos(a - 0.08) * r0)} L${T(50 + Math.sin(a) * r1, 50 - Math.cos(a) * r1)} L${T(50 + Math.sin(a + 0.08) * r0, 50 - Math.cos(a + 0.08) * r0)} Z" fill="${G.l}" opacity=".85"/>`;
    }
  }
  if (st >= 4) out += `<circle cx="${cx}" cy="${cy}" r="${S(st >= 6 ? 44 : 40)}" fill="url(#h${id})" opacity="${st >= 5 ? 0.85 : 0.6}"/>`;
  // Огранённый камень: силуэт по характеристике.
  const sc = st >= 5 ? 0.8 : st >= 4 ? 0.86 : 0.92;
  const P = SHAPE[k].map(([x, y]) => T(50 + (x - 50) * sc, 50 + (y - 50) * sc));
  const C = T(50, 46);
  out += `<polygon points="${P.map((p) => p.join(",")).join(" ")}" fill="url(#b${id})" stroke="${G.d}" stroke-width="${S(2.5)}" stroke-linejoin="round"/>`;
  // Грани: свет слева-сверху, тень справа-снизу.
  P.forEach((p, i) => {
    const q = P[(i + 1) % P.length];
    const mx = (p[0] + q[0]) / 2 - C[0], my = (p[1] + q[1]) / 2 - C[1];
    const lit = (-mx - my) / (Math.hypot(mx, my) || 1); // −1..1
    const col = lit > 0 ? G.l : G.d;
    out += `<polygon points="${C} ${p} ${q}" fill="${col}" opacity="${(Math.abs(lit) * (st >= 3 ? 0.55 : 0.35)).toFixed(2)}"/>`;
  });
  // Площадка (table) — с 3-й ступени светлая и крупная.
  if (st >= 3) {
    const t = P.map(([x, y]) => [C[0] + (x - C[0]) * 0.42, C[1] + (y - C[1]) * 0.42].join(",")).join(" ");
    out += `<polygon points="${t}" fill="${G.l}" opacity=".55" stroke="#fff" stroke-width="${S(1)}" stroke-opacity=".5"/>`;
  }
  // Блик.
  if (k !== "luc" && k !== "int" && k !== "agi") out += `<path d="M${T(34, 34)} q${S(6)} ${S(-8)} ${S(16)} ${S(-9)}" stroke="#fff" stroke-width="${S(st >= 3 ? 4 : 3)}" fill="none" opacity="${st >= 3 ? 0.85 : 0.5}" stroke-linecap="round"/>`;
  // Золотые лапки оправы (6–9) и корона (10+).
  if (st >= 5) {
    for (const a of [0.8, 2.35, 3.95, 5.5]) {
      const [x, y] = T(50 + Math.sin(a) * 34, 50 - Math.cos(a) * 34);
      out += `<circle cx="${x}" cy="${y}" r="${S(4.5)}" fill="#ffd166" stroke="#8a5a00" stroke-width="${S(1.5)}"/>`;
    }
  }
  if (st >= 6) out += `<path d="M${T(36,16)} L${T(40,6)} L${T(45,13)} L${T(50,3)} L${T(55,13)} L${T(60,6)} L${T(64,16)} Z" fill="#ffd166" stroke="#8a5a00" stroke-width="${S(1.5)}"/>`;
  // Искры (4+).
  if (st >= 4) {
    const sp = (x: number, y: number, r: number): string => `<path d="M${T(x, y - r)} L${T(x + r * 0.28, y - r * 0.28)} L${T(x + r, y)} L${T(x + r * 0.28, y + r * 0.28)} L${T(x, y + r)} L${T(x - r * 0.28, y + r * 0.28)} L${T(x - r, y)} L${T(x - r * 0.28, y - r * 0.28)} Z" fill="#fff"/>`;
    out += sp(74, 24, 9);
    if (st >= 5) out += sp(24, 72, 6);
  }
  return out;
}
function grad(id: string, [l, m, d]: readonly [string, string, string]): string {
  return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${l}"/><stop offset=".5" stop-color="${m}"/><stop offset="1" stop-color="${d}"/></linearGradient></defs>`;
}
function socket(x: number, y: number, r: number, band: readonly [string, string, string], gk: GemKey | null | undefined): string {
  const [l, , d] = band;
  let s = `<circle cx="${x}" cy="${y}" r="${r}" fill="#15141c" stroke="${d}" stroke-width="3"/><circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${l}" stroke-width="1.2" opacity=".7"/>`;
  const g = parseGem(gk);
  if (g) s += gem(g.attr, g.lv, r / 34, x, y);
  return s;
}
function ring(t: RingTier, gems: readonly (GemKey | null)[] = []): string {
  const R = RING_LOOK[t], id = "r" + (uid++), [l, , d] = R.band;
  let s = grad(id, R.band);
  if (t === "base") {
    // Гладкое кольцо без оправы: толстый обод в перспективе с бликом.
    s += `<ellipse cx="50" cy="54" rx="34" ry="26" fill="none" stroke="${d}" stroke-width="15"/>`;
    s += `<ellipse cx="50" cy="54" rx="34" ry="26" fill="none" stroke="url(#${id})" stroke-width="11"/>`;
    s += `<path d="M24 42 q26 -16 52 0" stroke="#fff" stroke-width="3" fill="none" opacity=".8" stroke-linecap="round"/>`;
    s += `<path d="M30 74 q20 9 40 0" stroke="${d}" stroke-width="2" fill="none" opacity=".6"/>`;
    return s;
  }
  // Обод и оправа — одно целое: обод переходит в «плечи», плечи сходятся в оправу.
  const band = (cy: number, rx: number, ry: number): string =>
    `<ellipse cx="50" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${d}" stroke-width="11"/>` +
    `<ellipse cx="50" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="url(#${id})" stroke-width="7"/>`;
  if (t === "gold") {
    s += band(72, 27, 17);
    // плечи: от боков обода вверх к оправе
    s += `<path d="M22 70 Q20 50 34 42 L40 54 Q30 58 29 70 Z M78 70 Q80 50 66 42 L60 54 Q70 58 71 70 Z" fill="url(#${id})" stroke="${d}" stroke-width="2"/>`;
    s += `<path d="M26 42 Q50 2 74 42 Q68 62 50 62 Q32 62 26 42 Z" fill="url(#${id})" stroke="${d}" stroke-width="2.5"/>`;
    s += `<path d="M31 38 Q50 10 69 38" stroke="${l}" stroke-width="1.6" fill="none" opacity=".8"/>`;
    s += socket(50, 36, 20, R.band, gems[0]);
    return s;
  }
  // Уникальное: обод → плечи → общая оправа-«двойная капля» с перемычкой, два гнезда.
  s += band(74, 26, 16);
  s += `<path d="M24 72 Q20 56 22 46 L34 56 Q30 62 31 72 Z M76 72 Q80 56 78 46 L66 56 Q70 62 69 72 Z" fill="url(#${id})" stroke="${d}" stroke-width="2"/>`;
  s += `<path d="M11 40 Q30 4 50 24 Q70 4 89 40 Q84 60 70 60 Q58 60 50 52 Q42 60 30 60 Q16 60 11 40 Z" fill="url(#${id})" stroke="${d}" stroke-width="2.5"/>`;
  s += `<path d="M16 36 Q30 12 46 26 M54 26 Q70 12 84 36" stroke="${l}" stroke-width="1.6" fill="none" opacity=".8"/>`;
  s += socket(30, 38, 16, R.band, gems[0]);
  s += socket(70, 38, 16, R.band, gems[1]);
  return s;
}

const wrap = (inner: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${inner}</svg>`;

/** Значок камня (уровень — ступень вида; число уровня рисует место, где значок стоит). */
export function gemSvg(k: GemKey): string {
  const g = parseGem(k);
  return wrap(g ? gem(g.attr, g.lv) : "");
}

/** Значок кольца с камнями в гнёздах. */
export function ringSvg(tier: RingTier, gems: readonly (GemKey | null)[] = []): string {
  return wrap(ring(tier, gems));
}

/** Пустой слот кольца (контур). */
export const RING_SLOT_SVG = wrap(
  `<ellipse cx="50" cy="56" rx="30" ry="22" fill="none" stroke="#4a4a5c" stroke-width="7" stroke-dasharray="6 6"/>`,
);
