/** Кратчайшее расстояние между отрезками [p1,p2] и [q1,q2] в 3D (без Babylon). */
export function segDist(
  p1x: number, p1y: number, p1z: number,
  p2x: number, p2y: number, p2z: number,
  q1x: number, q1y: number, q1z: number,
  q2x: number, q2y: number, q2z: number,
): number {
  const d1x = p2x - p1x, d1y = p2y - p1y, d1z = p2z - p1z;
  const d2x = q2x - q1x, d2y = q2y - q1y, d2z = q2z - q1z;
  const rx = p1x - q1x, ry = p1y - q1y, rz = p1z - q1z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s: number;
  let t: number;
  const c01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  if (a <= 1e-8 && e <= 1e-8) {
    return Math.hypot(rx, ry, rz);
  }
  if (a <= 1e-8) {
    s = 0;
    t = c01(f / e);
  } else {
    const cc = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-8) {
      t = 0;
      s = c01(-cc / a);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom > 1e-8 ? c01((b * f - cc * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = c01(-cc / a);
      } else if (t > 1) {
        t = 1;
        s = c01((b - cc) / a);
      }
    }
  }
  const cx1 = p1x + d1x * s, cy1 = p1y + d1y * s, cz1 = p1z + d1z * s;
  const cx2 = q1x + d2x * t, cy2 = q1y + d2y * t, cz2 = q1z + d2z * t;
  return Math.hypot(cx1 - cx2, cy1 - cy2, cz1 - cz2);
}
