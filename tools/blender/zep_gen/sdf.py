"""
Поля расстояний (SDF) на numpy и сетка из них (surface nets) — «лепка» органики без ручной работы:
тело = набор форм (сфера, эллипсоид, капсула-конус, скруглённая коробка, тор, цилиндр), которые
плавно сливаются (smooth union, радиус k) или вырезают (smooth subtract). Чистый numpy — работает
и в Blender, и вне его. Координаты — Blender: X вбок (+ — левая сторона модели), Y назад (перед — −Y), Z вверх.
"""
import math

import numpy as np

BIG = 1e3


def _v(a):
    return np.asarray(a, dtype=np.float64)


def rot_matrix(deg):
    """Матрица поворота из углов Эйлера XYZ в градусах (как в Blender)."""
    if deg is None:
        return None
    rx, ry, rz = (math.radians(d) for d in deg)
    cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
    mx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    my = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    mz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return mz @ my @ mx


# ---------- примитивы: P (N,3) → расстояние (N,) ----------

def sd_sphere(P, c, r):
    return np.linalg.norm(P - c, axis=1) - r


def sd_ellipsoid(P, c, r, R=None):
    q = P - c
    if R is not None:
        q = q @ R  # в локальные оси формы
    r = _v(r)
    k0 = np.linalg.norm(q / r, axis=1)
    k1 = np.linalg.norm(q / (r * r), axis=1)
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


def sd_round_cone(P, a, b, r1, r2):
    """Капсула с разными радиусами на концах (точная формула И. Квилеса)."""
    ba = b - a
    l2 = float(ba @ ba)
    rr = r1 - r2
    a2 = l2 - rr * rr
    if l2 < 1e-12 or a2 <= 1e-12:  # одна сфера целиком внутри другой
        return np.minimum(sd_sphere(P, a, r1), sd_sphere(P, b, r2))
    il2 = 1.0 / l2
    pa = P - a
    y = pa @ ba
    z = y - l2
    x = pa * l2 - y[:, None] * ba
    x2 = (x * x).sum(1)
    y2 = y * y * l2
    z2 = z * z * l2
    k = math.copysign(1.0, rr) * rr * rr * x2
    out = (np.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1
    m2 = np.sign(y) * a2 * y2 < k
    out = np.where(m2, np.sqrt(x2 + y2) * il2 - r1, out)
    m1 = np.sign(z) * a2 * z2 > k
    out = np.where(m1, np.sqrt(x2 + z2) * il2 - r2, out)
    return out


def sd_box(P, c, h, rnd=0.0, R=None):
    q = P - c
    if R is not None:
        q = q @ R
    q = np.abs(q) - (_v(h) - rnd)
    return np.linalg.norm(np.maximum(q, 0), axis=1) + np.minimum(q.max(1), 0) - rnd


def sd_torus(P, c, R0, r, R=None):
    q = P - c
    if R is not None:
        q = q @ R
    qx = np.sqrt(q[:, 0] ** 2 + q[:, 1] ** 2) - R0
    return np.sqrt(qx * qx + q[:, 2] ** 2) - r


def sd_cylinder(P, a, b, r, rnd=0.0):
    ba = b - a
    baba = float(ba @ ba)
    pa = P - a
    paba = pa @ ba
    r = r - rnd
    x = np.linalg.norm(pa * baba - ba * paba[:, None], axis=1) - r * baba
    y = np.abs(paba - baba * 0.5) - baba * 0.5
    x2, y2 = x * x, y * y * baba
    d = np.where(np.maximum(x, y) < 0, -np.minimum(x2, y2),
                 np.where(x > 0, x2, 0) + np.where(y > 0, y2, 0))
    return np.sign(d) * np.sqrt(np.abs(d)) / baba - rnd


# ---------- шум (для «бугристых» форм: камни, кора, кожа) ----------

class Noise:
    def __init__(self, seed=1):
        rng = np.random.default_rng(seed)
        self.perm = rng.permutation(256)
        self.vals = rng.random(256) * 2 - 1

    def _h(self, ix, iy, iz):
        p = self.perm
        return self.vals[p[(p[(p[ix & 255] + iy) & 255] + iz) & 255]]

    def value(self, P):
        f = np.floor(P)
        i = f.astype(np.int64)
        t = P - f
        t = t * t * (3 - 2 * t)
        x, y, zz = i[:, 0], i[:, 1], i[:, 2]
        tx, ty, tz = t[:, 0], t[:, 1], t[:, 2]
        def lerp(a, b, w):
            return a + (b - a) * w
        c00 = lerp(self._h(x, y, zz), self._h(x + 1, y, zz), tx)
        c10 = lerp(self._h(x, y + 1, zz), self._h(x + 1, y + 1, zz), tx)
        c01 = lerp(self._h(x, y, zz + 1), self._h(x + 1, y, zz + 1), tx)
        c11 = lerp(self._h(x, y + 1, zz + 1), self._h(x + 1, y + 1, zz + 1), tx)
        return lerp(lerp(c00, c10, ty), lerp(c01, c11, ty), tz)

    def fbm(self, P, octaves=3):
        s, a, tot = 0.0, 1.0, 0.0
        for o in range(octaves):
            s = s + self.value(P * (2 ** o) + o * 17.3) * a
            tot += a
            a *= 0.5
        return s / tot


# ---------- ячейки (Ворони): каменные плиты, чешуя, панцирь ----------

def _hash3(c, seed, k):
    h = (c[:, 0] * 73856093) ^ (c[:, 1] * 19349663) ^ (c[:, 2] * 83492791) ^ (seed * 2654435761 + k * 97531)
    h = (h ^ (h >> 13)) * 1274126177
    return ((h ^ (h >> 16)) & 0xFFFF) / 65536.0


def voronoi(P, seed=0):
    """Точки P в «клетках» → F1, F2 (расстояния до двух ближайших центров) и id ближайшей клетки.
    F2 − F1 ≈ 0 на границе плит — по ней режем трещины и красим швы."""
    out1 = np.empty(len(P))
    out2 = np.empty(len(P))
    oid = np.empty(len(P), np.int64)
    for i0 in range(0, len(P), 200000):
        Q = P[i0:i0 + 200000]
        base = np.floor(Q).astype(np.int64)
        f1 = np.full(len(Q), 1e9)
        f2 = np.full(len(Q), 1e9)
        cid = np.zeros(len(Q), np.int64)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    c = base + np.array([dx, dy, dz])
                    fp = c + 0.15 + 0.7 * np.stack([_hash3(c, seed, 0), _hash3(c, seed, 1), _hash3(c, seed, 2)], -1)
                    d = np.linalg.norm(Q - fp, axis=1)
                    m1 = d < f1
                    f2 = np.where(m1, f1, np.minimum(f2, d))
                    cid = np.where(m1, (c[:, 0] * 92837111) ^ (c[:, 1] * 689287499) ^ (c[:, 2] * 283923481), cid)
                    f1 = np.where(m1, d, f1)
        out1[i0:i0 + len(Q)], out2[i0:i0 + len(Q)], oid[i0:i0 + len(Q)] = f1, f2, cid
    return out1, out2, oid


class Surface:
    """Рельеф поверхности ПОСЛЕ слияния форм (один на модель): бугры (fbm) и трещины по плитам."""
    op = "surface"
    mat = None
    bone = None
    k = 0.0

    def __init__(self, noise=None, cracks=None):
        self.noise = noise  # [амплитуда, частота, seed]
        self.cracks = cracks  # [глубина, частота (плит на метр), ширина шва 0–1, seed]
        self._n = Noise(int(noise[2]) if noise and len(noise) > 2 else 5) if noise else None

    def disp(self, P):
        d = np.zeros(len(P))
        if self._n is not None:
            d += self._n.fbm(P * self.noise[1]) * self.noise[0]
        if self.cracks:
            depth, freq, width = self.cracks[:3]
            f1, f2, _ = voronoi(P * freq, int(self.cracks[3]) if len(self.cracks) > 3 else 1)
            e = f2 - f1
            t = np.clip(e / width, 0, 1)
            d += depth * (1 - t * t * (3 - 2 * t))
        return d


# ---------- сцена форм ----------

class Shape:
    """Одна форма: kind + параметры, op ('add' | 'sub' | 'paint'), k — радиус сглаживания,
    mat — материал, bone — кость (для весов), noise — (амплитуда, частота, seed)."""

    def __init__(self, kind, op="add", k=0.0, mat=None, bone=None, noise=None, **p):
        self.kind, self.op, self.k, self.mat, self.bone, self.noise, self.p = kind, op, k, mat, bone, noise, p
        self._noise = Noise(noise[2] if noise and len(noise) > 2 else 7) if noise else None

    def bounds(self):
        p = self.p
        if self.kind in ("sphere",):
            c, r = _v(p["c"]), p["r"]
            lo, hi = c - r, c + r
        elif self.kind in ("ellipsoid", "box", "torus"):
            c = _v(p["c"])
            if self.kind == "ellipsoid":
                e = max(p["r"])
            elif self.kind == "box":
                e = float(np.linalg.norm(p["h"]))
            else:
                e = p["R"] + p["r"]
            lo, hi = c - e, c + e
        else:  # cone / cyl
            a, b = _v(p["a"]), _v(p["b"])
            r = max(p.get("r1", p.get("r", 0)), p.get("r2", p.get("r", 0)))
            lo, hi = np.minimum(a, b) - r, np.maximum(a, b) + r
        m = self.k + (self.noise[0] if self.noise else 0) + 1e-3
        return lo - m, hi + m

    def dist(self, P):
        p, k = self.p, self.kind
        if k == "sphere":
            d = sd_sphere(P, _v(p["c"]), p["r"])
        elif k == "ellipsoid":
            d = sd_ellipsoid(P, _v(p["c"]), p["r"], p.get("R"))
        elif k == "cone":
            d = sd_round_cone(P, _v(p["a"]), _v(p["b"]), p["r1"], p["r2"])
        elif k == "box":
            d = sd_box(P, _v(p["c"]), p["h"], p.get("rnd", 0.0), p.get("R"))
        elif k == "torus":
            d = sd_torus(P, _v(p["c"]), p["R"], p["r"], p.get("R3"))
        elif k == "cyl":
            d = sd_cylinder(P, _v(p["a"]), _v(p["b"]), p["r"], p.get("rnd", 0.0))
        else:
            raise ValueError("неизвестная форма: " + k)
        if self._noise is not None:
            amp, freq = self.noise[0], self.noise[1]
            d = d + self._noise.fbm(P * freq) * amp
        return d


def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * k * 0.25


def smax(a, b, k):
    return -smin(-a, -b, k)


def field(shapes, P):
    """Итоговое поле в точках P (формы применяются по порядку)."""
    d = np.full(len(P), BIG)
    surf = []
    for s in shapes:
        if s.op == "surface":
            surf.append(s)
            continue
        if s.op == "paint":
            continue
        lo, hi = s.bounds()
        m = np.all((P >= lo) & (P <= hi), axis=1)
        if not m.any():
            continue
        ds = np.full(len(P), BIG)
        ds[m] = s.dist(P[m])
        if s.op == "add":
            d = smin(d, ds, s.k)
        else:
            d = smax(d, -ds, s.k)
    for s in surf:
        near = d < 0.25  # рельеф нужен только у поверхности
        if near.any():
            d[near] += s.disp(P[near])
    return d


def shape_dists(shapes, P):
    """Расстояния до каждой формы (для материалов и весов): (len(shapes), N)."""
    out = np.full((len(shapes), len(P)), BIG)
    for i, s in enumerate(shapes):
        if s.op == "surface":
            continue
        lo, hi = s.bounds()
        pad = 0.25 * max(1e-3, float(np.max(hi - lo)))
        m = np.all((P >= lo - pad) & (P <= hi + pad), axis=1)
        if m.any():
            out[i, m] = s.dist(P[m])
    return out


# ---------- surface nets: поле на сетке → четырёхугольники ----------

def bounds_of(shapes, pad):
    lo = np.full(3, 1e9)
    hi = np.full(3, -1e9)
    for s in shapes:
        if s.op != "add":
            continue
        a, b = s.bounds()
        lo, hi = np.minimum(lo, a), np.maximum(hi, b)
    return lo - pad, hi + pad


def mesh(shapes, h, project=2):
    """Сетка поверхности (verts (V,3), quads (F,4)) с шагом h; вершины дотягиваются до поверхности."""
    lo, hi = bounds_of(shapes, 2 * h)
    n = np.ceil((hi - lo) / h).astype(int) + 1
    xs = [lo[i] + np.arange(n[i]) * h for i in range(3)]
    G = np.stack(np.meshgrid(*xs, indexing="ij"), -1).reshape(-1, 3)
    F = field(shapes, G).reshape(n)
    S = F < 0
    cs = tuple(n - 1)
    # вершина ячейки = среднее точек пересечения на её 12 рёбрах
    acc = np.zeros(cs + (3,))
    cnt = np.zeros(cs)
    for axis in range(3):
        for o1 in (0, 1):
            for o2 in (0, 1):
                off = [0, 0, 0]
                ax2 = [a for a in range(3) if a != axis]
                off[ax2[0]], off[ax2[1]] = o1, o2
                sl_a = tuple(slice(off[i], off[i] + cs[i]) for i in range(3))
                off_b = list(off)
                off_b[axis] += 1
                sl_b = tuple(slice(off_b[i], off_b[i] + cs[i]) for i in range(3))
                fa, fb = F[sl_a], F[sl_b]
                m = (fa < 0) != (fb < 0)
                t = np.where(m, fa / np.where(m, fa - fb, 1), 0)
                base = np.stack(np.meshgrid(*[np.arange(cs[i]) + off[i] for i in range(3)], indexing="ij"), -1).astype(float)
                base[..., axis] += t
                acc += np.where(m[..., None], base, 0)
                cnt += m
    active = cnt > 0
    idx = np.full(cs, -1, dtype=np.int64)
    idx[active] = np.arange(int(active.sum()))
    V = lo + (acc[active] / cnt[active][:, None]) * h

    quads = []
    # рёбра вдоль X: ячейки в плоскости (Y, Z)
    e = S[:-1, 1:-1, 1:-1] != S[1:, 1:-1, 1:-1]
    inside = S[:-1, 1:-1, 1:-1]
    q = np.stack([idx[:, :-1, :-1], idx[:, 1:, :-1], idx[:, 1:, 1:], idx[:, :-1, 1:]], -1)
    quads.append((q[e], inside[e]))
    # вдоль Y: плоскость (Z, X)
    e = S[1:-1, :-1, 1:-1] != S[1:-1, 1:, 1:-1]
    inside = S[1:-1, :-1, 1:-1]
    q = np.stack([idx[:-1, :, :-1], idx[:-1, :, 1:], idx[1:, :, 1:], idx[1:, :, :-1]], -1)
    quads.append((q[e], inside[e]))
    # вдоль Z: плоскость (X, Y)
    e = S[1:-1, 1:-1, :-1] != S[1:-1, 1:-1, 1:]
    inside = S[1:-1, 1:-1, :-1]
    q = np.stack([idx[:-1, :-1, :], idx[1:, :-1, :], idx[1:, 1:, :], idx[:-1, 1:, :]], -1)
    quads.append((q[e], inside[e]))
    Q = []
    for qq, ins in quads:
        Q.append(np.where(ins[:, None], qq, qq[:, ::-1]))
    Q = np.concatenate(Q)
    Q = Q[(Q >= 0).all(1)]

    # дотянуть вершины до поверхности (Ньютон по численному градиенту), шаг не больше h/2
    eps = h * 0.25
    for _ in range(project):
        f0 = field(shapes, V)
        g = np.zeros_like(V)
        for i in range(3):
            dv = np.zeros(3)
            dv[i] = eps
            g[:, i] = (field(shapes, V + dv) - field(shapes, V - dv)) / (2 * eps)
        gl2 = np.maximum((g * g).sum(1), 1e-9)
        step = -(f0 / gl2)[:, None] * g
        sl = np.linalg.norm(step, axis=1)
        step *= np.minimum(1.0, (h * 0.5) / np.maximum(sl, 1e-12))[:, None]
        V = V + step
    return V, Q
