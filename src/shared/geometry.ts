import { Vector3 } from "@babylonjs/core/Maths/math.vector";

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Кратчайшее расстояние между двумя отрезками в пространстве. */
export function segmentDistance(p1: Vector3, p2: Vector3, q1: Vector3, q2: Vector3): number {
  const d1 = p2.subtract(p1);
  const d2 = q2.subtract(q1);
  const r = p1.subtract(q1);
  const a = Vector3.Dot(d1, d1);
  const e = Vector3.Dot(d2, d2);
  const f = Vector3.Dot(d2, r);
  let s: number;
  let t: number;
  if (a <= 1e-8 && e <= 1e-8) return r.length();
  if (a <= 1e-8) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = Vector3.Dot(d1, r);
    if (e <= 1e-8) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = Vector3.Dot(d1, d2);
      const denom = a * e - b * b;
      s = denom > 1e-8 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  const cp1 = p1.add(d1.scale(s));
  const cp2 = q1.add(d2.scale(t));
  return Vector3.Distance(cp1, cp2);
}

/** Ближайшая точка на отрезке [a,b] к точке p. */
export function closestPointOnSegment(p: Vector3, a: Vector3, b: Vector3): Vector3 {
  const ab = b.subtract(a);
  const len2 = Vector3.Dot(ab, ab);
  if (len2 < 1e-8) return a.clone();
  const t = clamp01(Vector3.Dot(p.subtract(a), ab) / len2);
  return a.add(ab.scale(t));
}
