"""
Жёсткие детали (отдельные меши, привязаны к одной кости целиком): глаза, зубы, рога, когти, броня,
оружие, украшения. Генерация на numpy → (verts, faces), без bmesh — работает в любой версии Blender.
Формы: sphere (r | [rx,ry,rz]), tube/horn (путь с радиусами, изгиб), box (h, фаска), cyl, cone, ring.
"""
import math

import numpy as np

from . import sdf


def uv_sphere(seg=12, rings=8):
    V = [[0, 0, -1]]
    for i in range(1, rings):
        th = math.pi * i / rings
        z, rr = -math.cos(th), math.sin(th)
        for j in range(seg):
            ph = 2 * math.pi * j / seg
            V.append([rr * math.cos(ph), rr * math.sin(ph), z])
    V.append([0, 0, 1])
    F = []
    for j in range(seg):
        F.append([0, 1 + (j + 1) % seg, 1 + j])
    for i in range(rings - 2):
        a, b = 1 + i * seg, 1 + (i + 1) * seg
        for j in range(seg):
            jn = (j + 1) % seg
            F.append([a + j, a + jn, b + jn, b + j])
    top = len(V) - 1
    last = 1 + (rings - 2) * seg
    for j in range(seg):
        F.append([last + j, last + (j + 1) % seg, top])
    return np.array(V, float), F


def _frame(t):
    """Ортонормальный базис с осью t."""
    t = t / max(1e-9, np.linalg.norm(t))
    up = np.array([0, 0, 1.0]) if abs(t[2]) < 0.9 else np.array([1.0, 0, 0])
    u = np.cross(up, t)
    u /= np.linalg.norm(u)
    v = np.cross(t, u)
    return u, v


def tube(path, radii, seg=8, cap=True):
    """Труба по ломаной path с радиусами radii (0 на конце — острие). Кадры — перенос без скручивания."""
    P = [np.asarray(p, float) for p in path]
    n = len(P)
    V, F = [], []
    u_prev = None
    rings = []
    for i in range(n):
        t = (P[min(i + 1, n - 1)] - P[max(i - 1, 0)])
        t = t / max(1e-9, np.linalg.norm(t))
        if u_prev is None:
            u, v = _frame(t)
        else:
            u = u_prev - t * np.dot(u_prev, t)
            u /= max(1e-9, np.linalg.norm(u))
            v = np.cross(t, u)
        u_prev = u
        r = radii[i]
        if r <= 1e-6:
            rings.append([len(V)])
            V.append(P[i])
            continue
        ring = []
        for j in range(seg):
            a = 2 * math.pi * j / seg
            ring.append(len(V))
            V.append(P[i] + (u * math.cos(a) + v * math.sin(a)) * r)
        rings.append(ring)
    for i in range(n - 1):
        A, B = rings[i], rings[i + 1]
        if len(A) == 1 and len(B) == 1:
            continue
        if len(B) == 1:
            for j in range(seg):
                F.append([A[j], A[(j + 1) % seg], B[0]])
        elif len(A) == 1:
            for j in range(seg):
                F.append([A[0], B[(j + 1) % seg], B[j]])
        else:
            for j in range(seg):
                jn = (j + 1) % seg
                F.append([A[j], A[jn], B[jn], B[j]])
    if cap:
        if len(rings[0]) > 1:
            F.append(list(reversed(rings[0])))
        if len(rings[-1]) > 1:
            F.append(list(rings[-1]))
    return np.array(V, float), F


def box(h, bevel=0.0):
    """Коробка с полуразмерами h; bevel — срез углов (октаэдральная фаска, 26 граней)."""
    hx, hy, hz = h
    if bevel <= 0:
        V = np.array([[x, y, z] for x in (-hx, hx) for y in (-hy, hy) for z in (-hz, hz)], float)
        F = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]
        return V, F
    # фаска: скруглённая коробка как выпуклая оболочка 8 «углов»-сфер (низкополи)
    b = min(bevel, hx * 0.9, hy * 0.9, hz * 0.9)
    pts = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                c = np.array([sx * (hx - b), sy * (hy - b), sz * (hz - b)])
                for d in ([sx, 0, 0], [0, sy, 0], [0, 0, sz]):
                    pts.append(c + np.array(d, float) * b)
    return hull(np.array(pts))


def hull(P):
    """Выпуклая оболочка (для камней-кристаллов и фасок). Простая инкрементальная, P до пары сотен точек."""
    P = np.asarray(P, float)
    n = len(P)
    # начальный тетраэдр
    i0 = 0
    i1 = int(np.argmax(np.linalg.norm(P - P[i0], axis=1)))
    d = P[i1] - P[i0]
    cr = np.linalg.norm(np.cross(P - P[i0], d), axis=1)
    i2 = int(np.argmax(cr))
    nrm = np.cross(P[i1] - P[i0], P[i2] - P[i0])
    i3 = int(np.argmax(np.abs((P - P[i0]) @ nrm)))
    faces = [[i0, i1, i2], [i0, i2, i3], [i0, i3, i1], [i1, i3, i2]]
    cen = P[[i0, i1, i2, i3]].mean(0)

    def outward(f):
        a, b, c = P[f[0]], P[f[1]], P[f[2]]
        nn = np.cross(b - a, c - a)
        return f if np.dot(nn, a - cen) >= 0 else [f[0], f[2], f[1]]

    faces = [outward(f) for f in faces]
    for i in range(n):
        if i in (i0, i1, i2, i3):
            continue
        p = P[i]
        vis = []
        for fi, f in enumerate(faces):
            a, b, c = P[f[0]], P[f[1]], P[f[2]]
            if np.dot(np.cross(b - a, c - a), p - a) > 1e-9:
                vis.append(fi)
        if not vis:
            continue
        edges = {}
        for fi in vis:
            f = faces[fi]
            for e in ((f[0], f[1]), (f[1], f[2]), (f[2], f[0])):
                if (e[1], e[0]) in edges:
                    del edges[(e[1], e[0])]
                else:
                    edges[e] = True
        faces = [f for fi, f in enumerate(faces) if fi not in set(vis)]
        for (a, b) in edges:
            faces.append([a, b, i])
    used = sorted({v for f in faces for v in f})
    remap = {v: k for k, v in enumerate(used)}
    return P[used], [[remap[v] for v in f] for f in faces]


def place(V, c, R=None, scale=None):
    V = np.asarray(V, float)
    if scale is not None:
        V = V * np.asarray(scale, float)
    if R is not None:
        V = V @ R.T
    return V + np.asarray(c, float)


def build(skel, it):
    """Описание детали → (verts, faces, bone, mat, smooth)."""
    kind = it["shape"]
    R = sdf.rot_matrix(it.get("rot")) if it.get("rot") else None
    smooth = bool(it.get("smooth", kind in ("sphere", "tube", "horn", "cyl", "cone", "ring")))
    seg = int(it.get("seg", 10))
    bone = it.get("bone")

    def at_point(key="at", off="off"):
        return skel.pt(it[key]) + np.array(it.get(off, [0, 0, 0]), float)

    def owner(ref, p):
        if isinstance(ref, str):
            return skel.owner(ref)
        if isinstance(ref, list) and len(ref) == 2 and isinstance(ref[0], str):
            return skel.owner(ref[0])
        return skel.nearest_bone(p)

    if kind == "sphere":
        c = at_point()
        r = it["r"]
        sc = [r, r, r] if not isinstance(r, list) else r
        V, F = uv_sphere(seg, max(4, seg * 2 // 3))
        V = place(V, c, R, sc)
        bone = bone or owner(it["at"], c)
    elif kind in ("horn", "tube", "cone"):
        if "path" in it:
            pts = [skel.pt(p) for p in it["path"]]
            ref0 = it["path"][0]
        else:
            a = at_point()
            if "to" in it:
                b = skel.pt(it["to"]) + np.array(it.get("off2", [0, 0, 0]), float)
            else:
                d = np.array(it.get("dir", [0, 0, 1]), float)
                b = a + d / max(1e-9, np.linalg.norm(d)) * float(it.get("len", 0.2))
            bend = np.array(it.get("bend", [0, 0, 0]), float)
            n = int(it.get("steps", 5 if kind == "horn" else 2))
            pts = []
            for i in range(n + 1):
                t = i / n
                pts.append(a + (b - a) * t + bend * 4 * t * (1 - t))  # квадратичный изгиб
            ref0 = it["at"]
        rr = it.get("r", 0.05)
        if isinstance(rr, list):
            r0, r1 = rr[0], rr[1]
        else:
            r0, r1 = rr, (0.0 if kind in ("horn", "cone") else rr)
        n = len(pts)
        radii = [r0 + (r1 - r0) * (i / (n - 1)) for i in range(n)]
        V, F = tube(pts, radii, seg=int(it.get("seg", 8)))
        bone = bone or owner(ref0, pts[0])
    elif kind == "box":
        c = at_point()
        V, F = box(it["h"], float(it.get("bevel", 0.0)))
        V = place(V, c, R)
        bone = bone or owner(it["at"], c)
    elif kind == "cyl":
        a = at_point()
        if "to" in it:
            b = skel.pt(it["to"]) + np.array(it.get("off2", [0, 0, 0]), float)
        else:
            d = np.array(it.get("dir", [0, 0, 1]), float)
            b = a + d / max(1e-9, np.linalg.norm(d)) * float(it.get("len", 0.2))
        r = float(it.get("r", 0.05))
        V, F = tube([a, b], [r, r], seg=seg)
        bone = bone or owner(it["at"], a)
    elif kind == "ring":
        c = at_point()
        Rr, r = float(it["R"]), float(it["r"])
        pts = [[Rr * math.cos(2 * math.pi * i / seg), Rr * math.sin(2 * math.pi * i / seg), 0] for i in range(seg + 1)]
        V, F = tube(pts, [r] * (seg + 1), seg=6, cap=False)
        V = place(V, c, R)
        bone = bone or owner(it["at"], c)
    else:
        raise ValueError("деталь: " + kind)
    return V, F, bone, it.get("mat", "skin"), smooth
