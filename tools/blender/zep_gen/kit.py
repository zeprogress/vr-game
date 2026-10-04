"""
Генераторы деталей локаций «с нуля» (низкополи, плоские цвета, затенение в цветах вершин):
rock, cliff, pine, tree, bush, grass, flowers, mushroom, stump, log, column, wall, rubble, crystal.
Каждый генератор: (rng, параметры) → KMesh (verts, faces, цвет на грань или вершину). Один материал на
деталь (цвет — в вершинах) → повторы выгружаются как GPU-инстансы: вид детали = одна отрисовка.
"""
import math

import numpy as np

from . import parts, sdf


def hex_lin(h):
    h = h.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return np.array(out)


class KMesh:
    """Меш детали: V (n,3), F — списки индексов, fcol (m,3) — цвет грани (линейный) или vcol (n,3)."""

    def __init__(self, V, F, fcol=None, vcol=None, smooth=False):
        self.V = np.asarray(V, float)
        self.F = [list(f) for f in F]
        self.fcol = None if fcol is None else np.asarray(fcol, float)
        self.vcol = None if vcol is None else np.asarray(vcol, float)
        self.smooth = smooth

    def corner_colors(self):
        out = []
        for fi, f in enumerate(self.F):
            for v in f:
                out.append(self.vcol[v] if self.vcol is not None else self.fcol[fi])
        return np.array(out)

    def normals(self):
        N = []
        for f in self.F:
            a, b, c = self.V[f[0]], self.V[f[1]], self.V[f[2]]
            n = np.cross(b - a, c - a)
            N.append(n / max(1e-9, np.linalg.norm(n)))
        return np.array(N)

    def centers(self):
        return np.array([self.V[f].mean(0) for f in self.F])


def merge(meshes):
    """Слить детали в одну (цвета приводятся к цвету на грань)."""
    V, F, C = [], [], []
    off = 0
    for m in meshes:
        V.append(m.V)
        F += [[i + off for i in f] for f in m.F]
        if m.fcol is not None:
            C.append(m.fcol)
        else:
            C.append(np.array([m.vcol[f].mean(0) for f in m.F]))
        off += len(m.V)
    return KMesh(np.concatenate(V), F, fcol=np.concatenate(C))


def ao_height(Z, h, lo=0.55):
    """Затенение к земле: низ темнее (контакт с землёй), верх — полный цвет."""
    t = np.clip(Z / max(1e-6, h), 0, 1)
    return lo + (1 - lo) * (t * t * (3 - 2 * t))


def jitter(rng, n, amt):
    return 1 + (rng.random(n) * 2 - 1) * amt


# ---------------- камни ----------------

def rock(rng, size=1.0, flat=0.7, base="#7f7b74", moss="#5f7f3a", moss_up=0.62, pts=16):
    """Гранёный камень: выпуклая оболочка случайных точек на сплюснутом эллипсоиде. Мох сверху."""
    rx = size * 0.5 * (0.85 + 0.3 * rng.random())
    ry = size * 0.5 * (0.75 + 0.3 * rng.random())
    rz = size * 0.5 * flat * (0.8 + 0.4 * rng.random())
    u = rng.normal(size=(pts, 3))
    u /= np.linalg.norm(u, axis=1, keepdims=True)
    P = u * np.array([rx, ry, rz]) * (0.78 + 0.22 * rng.random((pts, 1)))
    V, F = parts.hull(P)
    V[:, 2] -= V[:, 2].min() + rz * 0.25  # чуть утоплен в землю
    m = KMesh(V, F)
    N = m.normals()
    C = m.centers()
    b = hex_lin(base)
    col = np.outer(jitter(rng, len(F), 0.12), b)
    if moss:
        mz = N[:, 2] > moss_up
        col[mz] = hex_lin(moss) * jitter(rng, int(mz.sum()), 0.1)[:, None]
    col *= ao_height(C[:, 2] + rz * 0.25, rz * 2, 0.6)[:, None]
    m.fcol = col
    return m


def cliff(rng, size=6.0, base="#857f76", moss="#5c7a3a"):
    """Скальный блок: стопка гранёных камней разного размера (вертикальные пласты)."""
    out = []
    layers = 3 + int(rng.random() * 2)
    z = 0.0
    for i in range(layers):
        s = size * (1 - i * 0.18) * (0.8 + 0.3 * rng.random())
        r = rock(rng, s, flat=0.55, base=base, moss=moss if i == layers - 1 else None, pts=18)
        r.V[:, 2] += z
        r.V[:, :2] += rng.normal(size=2) * size * 0.08
        z += s * 0.28
        out.append(r)
    return merge(out)


def rubble(rng, size=1.5, base="#8a857c"):
    out = []
    for i in range(5 + int(rng.random() * 4)):
        r = rock(rng, size * (0.2 + 0.25 * rng.random()), flat=0.6, base=base, moss=None, pts=10)
        ang, d = rng.random() * 6.28, rng.random() * size * 0.5
        r.V[:, 0] += math.cos(ang) * d
        r.V[:, 1] += math.sin(ang) * d
        out.append(r)
    return merge(out)


# ---------------- растения ----------------

def _cone(c, r, h, seg, rng, droop=0.0, jit=0.12):
    V = [np.array([c[0], c[1], c[2] + h])]
    for j in range(seg):
        a = 2 * math.pi * (j + rng.random() * 0.3) / seg
        rr = r * (1 + (rng.random() * 2 - 1) * jit)
        V.append(np.array([c[0] + math.cos(a) * rr, c[1] + math.sin(a) * rr, c[2] - droop * rng.random()]))
    F = [[0, 1 + j, 1 + (j + 1) % seg] for j in range(seg)]
    F.append([1 + (seg - 1 - j) for j in range(seg)])
    return np.array(V), F


def pine(rng, height=8.0, trunk="#5b3d26", leaf="#2f5e34", leaf2="#4f8a45", tiers=4):
    """Ель: ствол + ярусы-конусы (низ яруса темнее, к макушке светлее)."""
    h = height
    tv, tf = parts.tube([[0, 0, -0.2], [0, 0, h * 0.35]], [h * 0.035, h * 0.025], seg=6)
    out = [KMesh(tv, tf, fcol=np.outer(np.ones(len(tf)), hex_lin(trunk)) * 0.8)]
    tiers = int(tiers + rng.integers(0, 2))
    for i in range(tiers):
        t = i / tiers
        z0 = h * (0.18 + 0.68 * t)
        R = h * 0.3 * (1 - t * 0.78) * (0.9 + 0.2 * rng.random())
        hh = h * (0.34 - 0.08 * t)
        V, F = _cone([rng.normal() * 0.03 * h, rng.normal() * 0.03 * h, z0], R, hh, 8, rng, droop=hh * 0.18)
        m = KMesh(V, F)
        C = m.centers()
        k = np.clip((C[:, 2] - z0 + hh * 0.2) / (hh * 1.2), 0, 1)
        col = hex_lin(leaf)[None, :] * (1 - k[:, None]) + hex_lin(leaf2)[None, :] * k[:, None]
        col *= (0.7 + 0.3 * t + 0.1 * rng.random(len(F)))[:, None] * ao_height(C[:, 2], h, 0.75)[:, None]
        m.fcol = col
        out.append(m)
    return merge(out)


def _blob(rng, centers, radii, h, tris, noise=(0.08, 2.2)):
    """Облако (крона/куст) из шаров с шумом → сетка (surface nets) → прорежено до tris."""
    from . import build
    shapes = [sdf.Shape("sphere", "add", min(radii) * 0.6, None, None, [noise[0] * max(radii), noise[1] / max(radii), int(rng.integers(1, 999))], c=c, r=r)
              for c, r in zip(centers, radii)]
    V, Q = sdf.mesh(shapes, h, project=1)
    V, F = build.decimate(V, Q, tris, symmetric=False)
    return V, F


def tree(rng, height=7.0, trunk="#6a4a30", leaf="#4f8a3c", leaf2="#8cbf55", blobs=5, tris=260):
    """Лиственное: изогнутый ствол с ветвями + крона из «облаков» (низ кроны темнее, верх светлее)."""
    h = height
    lean = rng.normal(size=2) * 0.05 * h
    top = np.array([lean[0], lean[1], h * 0.62])
    mid = np.array([lean[0] * 0.3 + rng.normal() * 0.03 * h, lean[1] * 0.3, h * 0.3])
    tv, tf = parts.tube([[0, 0, -0.2], mid, top], [h * 0.05, h * 0.035, h * 0.022], seg=6)
    out = [KMesh(tv, tf, fcol=np.outer(np.ones(len(tf)), hex_lin(trunk)) * 0.75)]
    for b in range(2):
        a = rng.random() * 6.28
        p0 = mid + (top - mid) * (0.4 + 0.3 * b)
        p1 = p0 + np.array([math.cos(a) * h * 0.22, math.sin(a) * h * 0.22, h * 0.15])
        bv, bf = parts.tube([p0, p1], [h * 0.018, h * 0.008], seg=5)
        out.append(KMesh(bv, bf, fcol=np.outer(np.ones(len(bf)), hex_lin(trunk)) * 0.7))
    cz = h * 0.72
    R = h * 0.26
    centers, radii = [top + [0, 0, R * 0.5]], [R]
    for i in range(blobs - 1):
        a = 2 * math.pi * i / (blobs - 1) + rng.random() * 0.6
        centers.append(np.array([lean[0] + math.cos(a) * R * 0.75, lean[1] + math.sin(a) * R * 0.75, cz + rng.normal() * R * 0.2]))
        radii.append(R * (0.6 + 0.25 * rng.random()))
    V, F = _blob(rng, centers, radii, R / 5, tris)
    m = KMesh(V, F)
    C = m.centers()
    k = np.clip((C[:, 2] - (cz - R)) / (R * 2.2), 0, 1)
    col = hex_lin(leaf)[None, :] * (1 - k[:, None]) + hex_lin(leaf2)[None, :] * k[:, None]
    m.fcol = col * (0.85 + 0.2 * rng.random(len(F)))[:, None]
    out.append(m)
    return merge(out)


def bush(rng, size=1.2, leaf="#3f7a36", leaf2="#78b04e", berries=None, tris=120):
    R = size * 0.5
    centers = [np.array([0, 0, R * 0.55])]
    radii = [R * 0.8]
    for i in range(3):
        a = 2 * math.pi * i / 3 + rng.random()
        centers.append(np.array([math.cos(a) * R * 0.55, math.sin(a) * R * 0.55, R * (0.35 + 0.2 * rng.random())]))
        radii.append(R * (0.5 + 0.2 * rng.random()))
    V, F = _blob(rng, centers, radii, R / 4, tris)
    V[:, 2] -= R * 0.1
    m = KMesh(V, F)
    C = m.centers()
    k = np.clip(C[:, 2] / (R * 1.4), 0, 1)
    col = hex_lin(leaf)[None, :] * (1 - k[:, None]) + hex_lin(leaf2)[None, :] * k[:, None]
    col *= ao_height(C[:, 2], R * 1.2, 0.6)[:, None]
    if berries:
        pick = rng.random(len(F)) < 0.06
        col[pick] = hex_lin(berries)
    m.fcol = col
    return m


def grass(rng, size=0.5, base="#3e6b2a", tip="#9bc95a", blades=7):
    """Пучок травы: тонкие листья-треугольники веером (материал двусторонний)."""
    V, F, VC = [], [], []
    for i in range(blades):
        a = rng.random() * 6.28
        tilt = 0.15 + 0.35 * rng.random()
        hh = size * (0.6 + 0.4 * rng.random())
        w = size * (0.06 + 0.04 * rng.random())
        r0 = size * 0.12 * rng.random()
        bx, by = math.cos(a) * r0, math.sin(a) * r0
        px, py = -math.sin(a) * w, math.cos(a) * w
        tx, ty = bx + math.cos(a) * hh * tilt, by + math.sin(a) * hh * tilt
        n = len(V)
        V += [[bx - px, by - py, -0.02], [bx + px, by + py, -0.02], [tx, ty, hh]]
        F.append([n, n + 1, n + 2])
        VC += [hex_lin(base) * 0.8, hex_lin(base) * 0.8, hex_lin(tip) * (0.9 + 0.2 * rng.random())]
    return KMesh(V, F, vcol=VC)


def flowers(rng, size=0.45, colors=("#f2d14b", "#e86a8a", "#f4f1e6", "#8a7cf0")):
    g = grass(rng, size * 0.8, blades=5)
    out = [KMesh(g.V, g.F, fcol=np.array([g.vcol[f].mean(0) for f in g.F]))]
    col = hex_lin(colors[int(rng.integers(0, len(colors)))])
    for i in range(3 + int(rng.integers(0, 3))):
        a, d = rng.random() * 6.28, size * 0.25 * rng.random()
        c = np.array([math.cos(a) * d, math.sin(a) * d, size * (0.55 + 0.4 * rng.random())])
        sv, sf = parts.tube([c - [0, 0, size * 0.6], c], [0.008, 0.008], seg=3, cap=False)
        out.append(KMesh(sv, sf, fcol=np.outer(np.ones(len(sf)), hex_lin("#4f7a2e"))))
        hv, hf = parts.uv_sphere(5, 3)
        hv = hv * [size * 0.07, size * 0.07, size * 0.04] + c
        out.append(KMesh(hv, hf, fcol=np.outer(np.ones(len(hf)), col) * (0.9 + 0.2 * rng.random())))
    return merge(out)


def mushroom(rng, size=0.4, cap="#c8432f", stem="#efe6d2", dots="#f6f0e2"):
    out = []
    for i in range(1 + int(rng.integers(0, 3))):
        s = size * (0.6 + 0.5 * rng.random()) * (1 if i == 0 else 0.6)
        a, d = rng.random() * 6.28, size * 0.35 * i
        x, y = math.cos(a) * d, math.sin(a) * d
        sv, sf = parts.tube([[x, y, -0.02], [x, y, s * 0.7]], [s * 0.12, s * 0.09], seg=6)
        out.append(KMesh(sv, sf, fcol=np.outer(np.ones(len(sf)), hex_lin(stem))))
        cv, cf = parts.uv_sphere(8, 6)
        keep = cv[:, 2] >= -0.05
        cv = cv * [s * 0.4, s * 0.4, s * 0.28] + [x, y, s * 0.68]
        m = KMesh(cv, cf)
        C = m.centers()
        col = np.outer(np.ones(len(cf)), hex_lin(cap))
        col[C[:, 2] < s * 0.66] = hex_lin(stem) * 0.85
        col[(rng.random(len(cf)) < 0.12) & (C[:, 2] > s * 0.8)] = hex_lin(dots)
        m.fcol = col
        out.append(m)
    return merge(out)


def stump(rng, size=0.8, bark="#5e4129", wood="#c49a63"):
    r = size * 0.35
    h = size * (0.35 + 0.25 * rng.random())
    V, F = parts.tube([[0, 0, -0.1], [0, 0, h]], [r * 1.15, r], seg=8)
    m = KMesh(V, F)
    C = m.centers()
    col = np.outer(np.ones(len(F)), hex_lin(bark)) * (0.85 + 0.2 * rng.random(len(F)))[:, None]
    col[C[:, 2] > h - 1e-3] = hex_lin(wood)
    m.fcol = col
    out = [m]
    for i in range(4):
        a = 2 * math.pi * i / 4 + rng.random() * 0.5
        rv, rf = parts.tube([[math.cos(a) * r * 0.7, math.sin(a) * r * 0.7, h * 0.4],
                             [math.cos(a) * r * 1.7, math.sin(a) * r * 1.7, -0.05]], [r * 0.3, 0.0], seg=5)
        out.append(KMesh(rv, rf, fcol=np.outer(np.ones(len(rf)), hex_lin(bark)) * 0.8))
    return merge(out)


def log(rng, size=2.5, bark="#5e4129", wood="#c49a63", moss="#5f7f3a"):
    r = size * 0.1 * (0.8 + 0.4 * rng.random())
    V, F = parts.tube([[-size / 2, 0, r * 0.8], [size / 2, 0, r * 0.85]], [r, r * 0.9], seg=8)
    m = KMesh(V, F)
    N = m.normals()
    col = np.outer(np.ones(len(F)), hex_lin(bark)) * (0.8 + 0.25 * rng.random(len(F)))[:, None]
    col[np.abs(N[:, 0]) > 0.9] = hex_lin(wood)
    col[(N[:, 2] > 0.7) & (rng.random(len(F)) < 0.6)] = hex_lin(moss)
    m.fcol = col
    return m


# ---------------- постройки ----------------

def column(rng, height=3.5, broken=None, stone="#b9b2a2", moss="#6b8a45"):
    r = height * 0.09
    broken = rng.random() < 0.5 if broken is None else broken
    top = height * (0.45 + 0.4 * rng.random()) if broken else height
    out = []
    bv, bf = parts.box([r * 1.7, r * 1.7, height * 0.04], bevel=r * 0.15)
    bv[:, 2] += height * 0.04
    out.append(KMesh(bv, bf, fcol=np.outer(np.ones(len(bf)), hex_lin(stone)) * 0.85))
    V, F = parts.tube([[0, 0, height * 0.07], [0, 0, top]], [r, r * 0.92], seg=10)
    if broken:  # рваный верх
        ring = np.where(np.abs(V[:, 2] - top) < 1e-6)[0]
        V[ring, 2] -= rng.random(len(ring)) * r * 1.4
    m = KMesh(V, F)
    C = m.centers()
    N = m.normals()
    col = np.outer(np.ones(len(F)), hex_lin(stone)) * (0.88 + 0.16 * rng.random(len(F)))[:, None]
    col *= ao_height(C[:, 2], height * 0.5, 0.7)[:, None]
    col[(N[:, 2] > 0.5) & (C[:, 2] > top - r * 2)] = hex_lin(moss)
    m.fcol = col
    out.append(m)
    if not broken:
        cv, cf = parts.box([r * 1.5, r * 1.5, height * 0.035], bevel=r * 0.1)
        cv[:, 2] += height - height * 0.03
        out.append(KMesh(cv, cf, fcol=np.outer(np.ones(len(cf)), hex_lin(stone))))
    return merge(out)


def wall(rng, length=4.0, height=2.4, brick=(0.55, 0.32, 0.4), broken=0.6, stone="#a39c8c", moss="#62823f"):
    """Руина стены из каменных блоков: рваный верх (профиль высоты по шуму), мох на верхних блоках."""
    bw, bh, bd = brick
    cols = max(2, int(round(length / bw)))
    rows = max(2, int(round(height / bh)))
    prof = [rows * (1 - broken * (0.5 + 0.5 * math.sin(c * 0.9 + rng.random() * 6) * rng.random())) for c in range(cols)]
    out = []
    for r in range(rows):
        off = (r % 2) * bw * 0.5
        for c in range(cols):
            if r >= prof[c] or (r > 1 and rng.random() < 0.04):
                continue
            x = -length / 2 + (c + 0.5) * bw + off - bw * 0.25
            if abs(x) > length / 2:
                continue
            V, F = parts.box([bw * 0.47 * (0.92 + 0.1 * rng.random()), bd * 0.5 * (0.9 + 0.15 * rng.random()), bh * 0.46], bevel=bh * 0.08)
            yaw = rng.normal() * 0.03
            cy, sy = math.cos(yaw), math.sin(yaw)
            V = V @ np.array([[cy, -sy, 0], [sy, cy, 0], [0, 0, 1]]).T
            V += [x, rng.normal() * bd * 0.05, (r + 0.5) * bh]
            top = r + 1 >= prof[c] - 0.5
            col = hex_lin(moss if (top and rng.random() < 0.55) else stone) * (0.8 + 0.25 * rng.random())
            col = col * (0.65 + 0.35 * min(1.0, (r + 0.5) / 3))
            out.append(KMesh(V, F, fcol=np.outer(np.ones(len(F)), col)))
    return merge(out)


def crystal(rng, size=1.2, base="#7fd8ff", tip="#e6fbff"):
    out = []
    for i in range(3 + int(rng.integers(0, 4))):
        h = size * (0.5 + 0.7 * rng.random()) * (1 if i == 0 else 0.7)
        r = h * 0.16
        d = np.array([rng.normal() * 0.35, rng.normal() * 0.35, 1.0])
        d /= np.linalg.norm(d)
        a = np.array([rng.normal() * size * 0.15, rng.normal() * size * 0.15, -0.05])
        V, F = parts.tube([a, a + d * h * 0.75, a + d * h], [r, r, 0.0], seg=6)
        m = KMesh(V, F)
        C = m.centers()
        k = np.clip((C - a) @ d / h, 0, 1)
        m.fcol = hex_lin(base)[None, :] * (1 - k[:, None]) + hex_lin(tip)[None, :] * k[:, None]
        out.append(m)
    return merge(out)


GENERATORS = {
    "rock": rock, "cliff": cliff, "rubble": rubble, "pine": pine, "tree": tree, "bush": bush, "grass": grass,
    "flowers": flowers, "mushroom": mushroom, "stump": stump, "log": log, "column": column, "wall": wall,
    "crystal": crystal,
}
# двусторонний материал (тонкие листья) и светящийся (кристаллы)
DOUBLE_SIDED = {"grass", "flowers"}
GLOW = {"crystal"}
# коллайдер по умолчанию: (тип, доля размера)
COLLIDER = {"rock": ("cyl", 0.45), "cliff": ("cyl", 0.5), "pine": ("trunk", 0.05), "tree": ("trunk", 0.06),
            "column": ("cyl", 0.12), "wall": ("box", 1.0), "stump": ("cyl", 0.3), "crystal": ("cyl", 0.3)}
