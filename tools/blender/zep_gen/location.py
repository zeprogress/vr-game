"""
Локация с нуля по спецификации (JSON): рельеф (шум + холмы/плато/площадки/тропы/озеро/горы по краю) →
раскраска земли в вершинах (трава, тропы, скалы на склонах, песок у воды, тень под деталями) →
кит деталей (kit.py, варианты) → точки интереса (ручные + группы: кольцо, линия) → слои рассыпки по
правилам (плотность, кластеры, уклон, высота, запретные зоны, расстояния) → коллайдеры → .blend
в формате пайплайна (Ground, Water, Colliders, Kit_*, Scatter_*, Props) → `location` выгружает GLB.
Координаты — Blender (X вправо, Y вперёд от игрока на карте сверху, Z вверх); в игре (−X, Z, −Y).
"""
import json
import math
import os
import time

import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector

from . import kit, sdf


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def noise2(X, Y, scale, seed, octaves=3):
    n = sdf.Noise(seed)
    P = np.stack([X.ravel() / scale, Y.ravel() / scale, np.full(X.size, seed * 0.37)], -1)
    return n.fbm(P, octaves).reshape(X.shape)


def seg_dist(X, Y, pts):
    """Расстояние от точек сетки до ломаной."""
    d = np.full(X.shape, 1e9)
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        abx, aby = bx - ax, by - ay
        l2 = max(1e-9, abx * abx + aby * aby)
        t = np.clip(((X - ax) * abx + (Y - ay) * aby) / l2, 0, 1)
        d = np.minimum(d, np.hypot(X - (ax + abx * t), Y - (ay + aby * t)))
    return d


def blur(H, r):
    """Размытие высот (коробочное, 3 прохода ≈ гаусс) — для троп и площадок."""
    r = max(1, int(r))
    out = H.copy()
    for _ in range(3):
        p = np.pad(out, r, mode="edge")
        c = np.cumsum(np.cumsum(p, 0), 1)
        c = np.pad(c, ((1, 0), (1, 0)))
        k = 2 * r + 1
        out = (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)
    return out


class Terrain:
    def __init__(self, sp, seed):
        size = sp.get("size", 100)
        self.W, self.D = (size, size) if not isinstance(size, list) else size
        self.res = float(sp.get("res", 1.0))
        self.xs = np.arange(-self.W / 2, self.W / 2 + 1e-6, self.res)
        self.ys = np.arange(-self.D / 2, self.D / 2 + 1e-6, self.res)
        X, Y = np.meshgrid(self.xs, self.ys)  # (ny, nx)
        self.X, self.Y = X, Y
        t = sp.get("terrain", {})
        H = np.full(X.shape, float(t.get("base", 0.0)))
        for i, layer in enumerate(t.get("noise", [{"amp": 1.5, "scale": 30}, {"amp": 0.35, "scale": 7}])):
            H += noise2(X, Y, layer["scale"], seed + 11 * i, layer.get("octaves", 3)) * layer["amp"]
        self.masks = {"path": np.zeros(X.shape), "flat": np.zeros(X.shape), "lake": np.zeros(X.shape),
                      "border": np.zeros(X.shape), "plateau": np.zeros(X.shape)}
        self.paths = []
        self.water = None
        for f in t.get("features", []):
            kind = f["type"]
            if kind in ("hill", "plateau", "flat", "lake", "crater"):
                cx, cy = f["at"]
                wob = noise2(X, Y, max(4.0, f.get("r", 10) * 0.6), seed + 97, 2) * f.get("r", 10) * f.get("wobble", 0.15)
                d = np.hypot(X - cx, Y - cy) + wob
            if kind == "hill":
                H += f["h"] * smoothstep(f["r"], 0, d) ** f.get("sharp", 1.0)
            elif kind == "plateau":
                m = smoothstep(f["r"] + f.get("edge", 3), f["r"], d)
                H = H * (1 - m) + (f["h"] + noise2(X, Y, 6, seed + 5, 2) * 0.25) * m
                self.masks["plateau"] = np.maximum(self.masks["plateau"], m)
            elif kind == "flat":
                m = smoothstep(f["r"] + f.get("blend", 6), f["r"], d)
                target = f.get("h")
                if target is None:
                    target = float(H[np.argmin(np.abs(self.ys - cy)), np.argmin(np.abs(self.xs - cx))])
                H = H * (1 - m) + target * m
                self.masks["flat"] = np.maximum(self.masks["flat"], m)
            elif kind == "crater":
                H -= f["h"] * smoothstep(f["r"], 0, d) - f["h"] * 0.4 * smoothstep(f["r"] * 1.4, f["r"], d) * smoothstep(f["r"] * 0.8, f["r"], d)
            elif kind == "lake":
                m = smoothstep(f["r"], f["r"] * 0.35, d)
                H = H * (1 - m) + (-f.get("depth", 2.0)) * m
                self.masks["lake"] = np.maximum(self.masks["lake"], smoothstep(f["r"] * 1.25, f["r"] * 0.8, d))
                self.water = float(f.get("level", -0.4))
            elif kind == "path":
                pts = f["points"]
                d = seg_dist(X, Y, pts) + noise2(X, Y, 8, seed + 3, 2) * f.get("w", 3) * 0.25
                w = f.get("w", 3.0)
                m = smoothstep(w / 2 + f.get("blend", 2.0), w / 2, d)
                Hb = blur(H, max(2, w / self.res))
                H = H * (1 - m) + (Hb - f.get("depth", 0.15)) * m
                self.masks["path"] = np.maximum(self.masks["path"], m)
                self.paths.append((pts, w))
            elif kind == "border":
                e = np.minimum.reduce([X + self.W / 2, self.W / 2 - X, Y + self.D / 2, self.D / 2 - Y])
                m = smoothstep(f.get("w", 12), 0, e + noise2(X, Y, 10, seed + 7, 2) * f.get("w", 12) * 0.35)
                rid = 1 - np.abs(noise2(X, Y, f.get("ridgeScale", 18), seed + 9, 3))  # хребты, а не «подушки»
                H += f.get("h", 12) * m * (0.45 + 0.35 * noise2(X, Y, 14, seed + 8, 2) + 0.35 * rid * rid)
                self.masks["border"] = np.maximum(self.masks["border"], m)
        self.H = H
        gy, gx = np.gradient(H, self.res)
        self.gx, self.gy = gx, gy
        self.slope = np.degrees(np.arctan(np.hypot(gx, gy)))

    def sample(self, A, x, y):
        """Значение поля A (ny, nx) в точках (билинейно)."""
        fx = np.clip((np.asarray(x) - self.xs[0]) / self.res, 0, len(self.xs) - 1.001)
        fy = np.clip((np.asarray(y) - self.ys[0]) / self.res, 0, len(self.ys) - 1.001)
        ix, iy = fx.astype(int), fy.astype(int)
        tx, ty = fx - ix, fy - iy
        a = A[iy, ix] * (1 - tx) + A[iy, ix + 1] * tx
        b = A[iy + 1, ix] * (1 - tx) + A[iy + 1, ix + 1] * tx
        return a * (1 - ty) + b * ty


# ---------------- Blender ----------------

def vc_material(name, double=False, glow=0.0, alpha=None, color=None):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = 0.9
    if color is None:
        ca = nt.nodes.new("ShaderNodeVertexColor")
        ca.layer_name = "Col"
        nt.links.new(ca.outputs["Color"], bsdf.inputs["Base Color"])
        if glow:
            nt.links.new(ca.outputs["Color"], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = glow
    else:
        bsdf.inputs["Base Color"].default_value = (*color, 1)
        m.diffuse_color = (*color, alpha or 1)
    if alpha is not None:
        bsdf.inputs["Alpha"].default_value = alpha
        if hasattr(m, "surface_render_method"):
            m.surface_render_method = "BLENDED"
    m.use_backface_culling = not double
    return m


def mesh_data(name, km, mat):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in km.V], [], [tuple(f) for f in km.F])
    me.update()
    cc = km.corner_colors()
    ca = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    rgba = np.concatenate([cc, np.ones((len(cc), 1))], 1).astype(np.float32)
    ca.data.foreach_set("color", rgba.ravel())
    me.polygons.foreach_set("use_smooth", np.full(len(me.polygons), km.smooth))
    me.materials.append(mat)
    return me


def coll(scene, name, exclude=False):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        scene.collection.children.link(c)
    if exclude:
        def find(lc):
            if lc.collection == c:
                return lc
            for ch in lc.children:
                r = find(ch)
                if r:
                    return r
        lc = find(bpy.context.view_layer.layer_collection)
        if lc:
            lc.exclude = True
    return c


def _rng_range(rng, v):
    if isinstance(v, list) and len(v) == 2 and all(isinstance(x, (int, float)) for x in v):
        return float(v[0] + (v[1] - v[0]) * rng.random())
    return v


def build_kits(sp, rng, scene, mats):
    """Варианты каждого кита: меши (общие для всех копий) + их «размер» для коллайдеров/занятости."""
    kits = {}
    kc = coll(scene, "Kit", exclude=True)
    for name, d in (sp.get("kits") or {}).items():
        gen = d["gen"]
        fn = kit.GENERATORS[gen]
        params = {k: v for k, v in d.items() if k not in ("gen", "variants", "collider", "sink")}
        vars_ = []
        for i in range(int(d.get("variants", 3))):
            vr = np.random.default_rng(int(rng.integers(1, 1 << 30)))
            p = {k: _rng_range(vr, v) for k, v in params.items()}
            km = fn(vr, **p)
            mat = mats["glow"] if gen in kit.GLOW else (mats["two"] if gen in kit.DOUBLE_SIDED else mats["kit"])
            me = mesh_data(f"{name}_{i}", km, mat)
            src = bpy.data.objects.new(f"{name}_{i}", me)
            kc.objects.link(src)
            ext = km.V.max(0) - km.V.min(0)
            vars_.append({"mesh": me, "r": float(max(ext[0], ext[1]) / 2), "h": float(ext[2]), "tris": sum(len(f) - 2 for f in km.F)})
        kits[name] = {"gen": gen, "vars": vars_, "collider": d.get("collider", kit.COLLIDER.get(gen)), "sink": d.get("sink", 0.0)}
    return kits


class Placer:
    def __init__(self, terr, scene, kits):
        self.t, self.scene, self.kits = terr, scene, kits
        self.occ = []  # (x, y, r) — занятые места (деревья, камни, постройки)
        self.items = []  # (kit, var, x, y, z, yaw, s, collection)
        self.cell = 4.0
        self.grid = {}

    def _near(self, x, y, r):
        cx, cy = int(x // self.cell), int(y // self.cell)
        span = int(r // self.cell) + 2
        for i in range(cx - span, cx + span + 1):
            for j in range(cy - span, cy + span + 1):
                for (ox, oy, orr) in self.grid.get((i, j), ()):
                    if (ox - x) ** 2 + (oy - y) ** 2 < (orr + r) ** 2:
                        return True
        return False

    def occupy(self, x, y, r):
        self.grid.setdefault((int(x // self.cell), int(y // self.cell)), []).append((x, y, r))

    def add(self, kname, vi, x, y, yaw, s, cname, block=True, align=0.0):
        k = self.kits[kname]
        v = k["vars"][vi]
        z = float(self.t.sample(self.t.H, x, y)) - k["sink"] * v["h"] * s
        self.items.append((kname, vi, x, y, z, yaw, s, cname, align))
        if block:
            self.occupy(x, y, v["r"] * s * 0.8)


def place_pois(sp, P, rng):
    for it in sp.get("place", []):
        kname = it["kit"]
        nv = len(P.kits[kname]["vars"])
        grp = it.get("group")
        if grp == "ring":
            cx, cy = it["at"]
            n = int(it.get("count", 8))
            for i in range(n):
                if rng.random() < it.get("skip", 0.0):
                    continue
                a = 2 * math.pi * i / n + it.get("phase", 0)
                x, y = cx + math.cos(a) * it["r"], cy + math.sin(a) * it["r"]
                P.add(kname, int(rng.integers(0, nv)), x, y, a + math.pi / 2 if it.get("face") else rng.random() * 6.28,
                      _rng_range(rng, it.get("scale", 1.0)), "Props")
        elif grp == "line":
            (ax, ay), (bx, by) = it["from"], it["to"]
            L = math.hypot(bx - ax, by - ay)
            step = float(it.get("step", 4.0))
            n = max(1, int(L // step))
            yaw = math.atan2(by - ay, bx - ax)
            for i in range(n):
                if rng.random() < it.get("skip", 0.0):
                    continue
                t = (i + 0.5) / n
                P.add(kname, int(rng.integers(0, nv)), ax + (bx - ax) * t, ay + (by - ay) * t, yaw + rng.normal() * 0.03,
                      _rng_range(rng, it.get("scale", 1.0)), "Props")
        elif grp == "cluster":
            cx, cy = it["at"]
            for i in range(int(it.get("count", 5))):
                a, d = rng.random() * 6.28, it.get("r", 3) * math.sqrt(rng.random())
                P.add(kname, int(rng.integers(0, nv)), cx + math.cos(a) * d, cy + math.sin(a) * d, rng.random() * 6.28,
                      _rng_range(rng, it.get("scale", [0.8, 1.2])), "Props")
        else:
            x, y = it["at"]
            P.add(kname, int(it.get("variant", rng.integers(0, nv))), x, y, math.radians(it.get("rot", rng.random() * 360)),
                  _rng_range(rng, it.get("scale", 1.0)), "Props")
        if it.get("clear"):  # вокруг точки интереса не сыпать мелочь
            cx, cy = it.get("at", it.get("from"))
            P.occupy(cx, cy, float(it["clear"]))


def scatter(sp, P, rng, seed):
    t = P.t
    counts = {}
    for li, L in enumerate(sp.get("scatter", [])):
        kname = L["kit"]
        nv = len(P.kits[kname]["vars"])
        cell = float(L.get("minDist", 2.0))
        xs = np.arange(-t.W / 2 + cell / 2, t.W / 2, cell)
        ys = np.arange(-t.D / 2 + cell / 2, t.D / 2, cell)
        X, Y = np.meshgrid(xs, ys)
        X = X.ravel() + (rng.random(X.size) - 0.5) * cell * 0.9
        Y = Y.ravel() + (rng.random(Y.size) - 0.5) * cell * 0.9
        keep = np.ones(X.size, bool)
        margin = L.get("margin", 2.0)
        keep &= (np.abs(X) < t.W / 2 - margin) & (np.abs(Y) < t.D / 2 - margin)
        z = t.sample(t.H, X, Y)
        sl = t.sample(t.slope, X, Y)
        s0, s1 = L.get("slope", [0, 35])
        keep &= (sl >= s0) & (sl <= s1)
        h0, h1 = L.get("height", [-1e9, 1e9])
        keep &= (z >= h0) & (z <= h1)
        if t.water is not None and not L.get("underwater"):
            keep &= z > t.water + L.get("shore", 0.15)
        for zone in L.get("avoid", ["path", "flat", "lake"]):
            name, _, thr = zone.partition(":")
            keep &= t.sample(t.masks[name], X, Y) < (float(thr) if thr else 0.3)
        for zone in L.get("only", []):
            name, _, thr = zone.partition(":")
            keep &= t.sample(t.masks[name], X, Y) >= (float(thr) if thr else 0.5)
        if L.get("cluster"):
            cs, cover = L["cluster"]
            nz = noise2(X.reshape(1, -1), Y.reshape(1, -1), cs, seed + 31 * li, 2).ravel()
            keep &= nz > (1 - 2 * cover) * 0.5
        dens = float(L.get("density", 1.0))  # доля ячеек, где деталь есть
        keep &= rng.random(X.size) < dens
        n = 0
        block = L.get("block", P.kits[kname]["gen"] not in ("grass", "flowers", "mushroom"))
        sc = L.get("scale", [0.8, 1.25])
        for x, y in zip(X[keep], Y[keep]):
            vi = int(rng.integers(0, nv))
            s = _rng_range(rng, sc)
            r = P.kits[kname]["vars"][vi]["r"] * s * 0.8
            if L.get("respect", True) and P._near(x, y, r * (1.0 if block else 0.3)):
                continue
            P.add(kname, vi, float(x), float(y), rng.random() * 6.28, s, "Scatter_" + kname, block=block,
                  align=float(L.get("align", 0.0)))
            n += 1
        counts[kname] = counts.get(kname, 0) + n
    return counts


def terrain_colors(sp, t, items, kits, seed):
    pal = {"grass": "#5d8f3a", "grass2": "#7fae4a", "dirt": "#8b6b47", "rock": "#7f7a72", "sand": "#c9b98b",
           "mud": "#4f4636", "flat": None}
    pal.update(sp.get("palette", {}))
    lin = {k: kit.hex_lin(v) for k, v in pal.items() if v}
    X, Y, H = t.X, t.Y, t.H
    n = noise2(X, Y, 12, seed + 41, 3)
    g = smoothstep(-0.25, 0.35, n)[..., None]
    C = lin["grass"] * (1 - g) + lin["grass2"] * g
    C *= (0.92 + 0.12 * noise2(X, Y, 3, seed + 43, 2))[..., None]
    cliff_deg = float(sp.get("rockSlope", 32))
    r = smoothstep(cliff_deg - 6, cliff_deg + 4, t.slope)[..., None]
    p = np.maximum(t.masks["path"], t.masks["flat"] * (1.0 if sp.get("flatGround", "dirt") == "dirt" else 0.0))[..., None]
    C = C * (1 - p) + lin["dirt"] * (0.9 + 0.15 * n[..., None]) * p
    # скалы: пласты породы (полосы по высоте с шумом) — дешёвая «геология» вместо однотонного серого
    strata = 0.82 + 0.18 * np.sin(H * float(sp.get("strata", 2.4)) + n * 3.0)[..., None]
    C = C * (1 - r) + lin["rock"] * (0.85 + 0.2 * n[..., None]) * strata * r
    if t.water is not None:
        s = (smoothstep(t.water + 0.9, t.water + 0.2, H) * t.masks["lake"])[..., None]
        C = C * (1 - s) + lin["sand"] * s
        w = smoothstep(t.water, t.water - 0.8, H)[..., None]
        C = C * (1 - w) + lin["mud"] * w
    # тень-контакт под деталями (дешёвый «запечённый» AO)
    shade = np.ones(H.shape)
    for (kname, vi, x, y, z, yaw, s, cname, align) in items:
        v = kits[kname]["vars"][vi]
        rr = v["r"] * s * (1.4 if kits[kname]["gen"] in ("tree", "pine") else 1.15)
        if rr < 0.4:
            continue
        i0, i1 = np.searchsorted(t.ys, [y - rr, y + rr])
        j0, j1 = np.searchsorted(t.xs, [x - rr, x + rr])
        if i1 <= i0 or j1 <= j0:
            continue
        d = np.hypot(X[i0:i1, j0:j1] - x, Y[i0:i1, j0:j1] - y) / rr
        k = 0.45 if kits[kname]["gen"] in ("tree", "pine") else 0.35
        shade[i0:i1, j0:j1] *= 1 - k * smoothstep(1.0, 0.25, d)
    return C * shade[..., None]


def build_location(sp, out_blend=None, live=False):
    t0 = time.time()
    seed = int(sp.get("seed", 1))
    rng = np.random.default_rng(seed)
    name = sp["name"]
    if live:
        scene = bpy.data.scenes.get(name) or bpy.data.scenes.new(name)
        for o in list(scene.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        bpy.context.window.scene = scene
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        scene = bpy.context.scene
    terr = Terrain(sp, seed)
    mats = {"kit": vc_material("KitVC"), "two": vc_material("KitVC2S", double=True), "glow": vc_material("KitGlow", glow=1.5),
            "ground": vc_material("TerrainVC")}
    kits = build_kits(sp, rng, scene, mats)
    P = Placer(terr, scene, kits)
    place_pois(sp, P, rng)
    counts = scatter(sp, P, rng, seed)

    # земля
    ny, nx = terr.H.shape
    V = np.stack([terr.X.ravel(), terr.Y.ravel(), terr.H.ravel()], -1)
    idx = np.arange(nx * ny).reshape(ny, nx)
    F = np.stack([idx[:-1, :-1], idx[:-1, 1:], idx[1:, 1:], idx[1:, :-1]], -1).reshape(-1, 4)
    col = terrain_colors(sp, terr, P.items, kits, seed).reshape(-1, 3)
    gk = kit.KMesh(V, F.tolist(), vcol=col, smooth=True)
    gme = mesh_data("Ground", gk, mats["ground"])
    g = bpy.data.objects.new("Ground", gme)
    coll(scene, "Ground").objects.link(g)
    # вода
    if terr.water is not None:
        wm = vc_material("Water", alpha=0.72, color=kit.hex_lin(sp.get("palette", {}).get("water", "#3d7f9e")))
        lake = terr.masks["lake"] > 0.05
        xs, ys = terr.X[lake], terr.Y[lake]
        x0, x1, y0, y1 = xs.min() - 2, xs.max() + 2, ys.min() - 2, ys.max() + 2
        wme = bpy.data.meshes.new("Water")
        wme.from_pydata([(x0, y0, terr.water), (x1, y0, terr.water), (x1, y1, terr.water), (x0, y1, terr.water)], [], [(0, 1, 2, 3)])
        wme.materials.append(wm)
        wc = wme.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
        wc.data.foreach_set("color", np.tile([*kit.hex_lin(sp.get("palette", {}).get("water", "#3d7f9e")), 1.0], 4).astype(np.float32))
        wo = bpy.data.objects.new("Water", wme)
        coll(scene, "Water").objects.link(wo)
    # детали
    colls = {}
    cyl = bpy.data.meshes.get("_col_cyl")
    if cyl is None:
        cyl = bpy.data.meshes.new("_col_cyl")
        ring = [(math.cos(2 * math.pi * i / 12) * 0.5, math.sin(2 * math.pi * i / 12) * 0.5) for i in range(12)]
        vv = [(x, y, 0) for x, y in ring] + [(x, y, 1) for x, y in ring]
        ff = [(i, (i + 1) % 12, 12 + (i + 1) % 12, 12 + i) for i in range(12)] + [tuple(range(11, -1, -1)), tuple(range(12, 24))]
        cyl.from_pydata(vv, [], ff)
    box = bpy.data.meshes.get("_col_box")
    if box is None:
        box = bpy.data.meshes.new("_col_box")
        vv = [(x, y, z) for x in (-0.5, 0.5) for y in (-0.5, 0.5) for z in (0, 1)]
        box.from_pydata(vv, [], [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)])
    cc = coll(scene, "Colliders")
    ncol = 0
    for (kname, vi, x, y, z, yaw, s, cname, align) in P.items:
        k = kits[kname]
        v = k["vars"][vi]
        c = colls.get(cname) or coll(scene, cname)
        colls[cname] = c
        o = bpy.data.objects.new(f"{kname}", v["mesh"])
        o.location = (x, y, z)
        rot = Euler((0, 0, yaw))
        if align:
            nx_, ny_ = float(terr.sample(-terr.gx, x, y)), float(terr.sample(-terr.gy, x, y))
            n = Vector((nx_ * align, ny_ * align, 1)).normalized()
            q = Vector((0, 0, 1)).rotation_difference(n) @ rot.to_quaternion()
            o.rotation_mode = "QUATERNION"
            o.rotation_quaternion = q
        else:
            o.rotation_euler = rot
        o.scale = (s, s, s)
        c.objects.link(o)
        kc = k["collider"]
        if kc:
            typ, frac = kc
            if typ in ("cyl", "trunk"):
                r = max(0.15, (v["r"] if typ == "cyl" else v["h"]) * frac * s)
                co = bpy.data.objects.new(f"COL_CYL_{kname}", cyl)
                co.location = (x, y, z)
                co.scale = (r * 2, r * 2, max(1.0, v["h"] * s))
            else:
                co = bpy.data.objects.new(f"COL_{kname}", box)
                co.location = (x, y, z)
                co.rotation_euler = rot
                bb = np.array([list(vv.co) for vv in v["mesh"].vertices])
                ext = bb.max(0) - bb.min(0)
                co.scale = (ext[0] * s, max(0.3, ext[1] * s), ext[2] * s)
            cc.objects.link(co)
            ncol += 1
    cc.hide_render = True
    lc = next((x for x in bpy.context.view_layer.layer_collection.children if x.collection == cc), None)
    if lc:
        lc.hide_viewport = True  # коллайдеры — служебные: в окне не мешают (export_location их и так прячет)
    # свет и мир для превью (в игру не идут)
    res = {
        "name": name, "size": [terr.W, terr.D], "grid": [nx, ny], "groundTris": int(len(F) * 2),
        "heightRange": [round(float(terr.H.min()), 2), round(float(terr.H.max()), 2)],
        "kits": {k: len(v["vars"]) for k, v in kits.items()},
        "kitTris": {k: [x["tris"] for x in v["vars"]] for k, v in kits.items()},
        "placed": counts | {"poi": sum(1 for it in P.items if it[7] == "Props")},
        "colliders": ncol, "water": terr.water, "sec": round(time.time() - t0, 1),
    }
    if out_blend:
        os.makedirs(os.path.dirname(out_blend) or ".", exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=out_blend, copy=live)
        res["blend"] = out_blend
    return res


def build_file(path, out_blend=None, live=False):
    with open(path, encoding="utf-8") as fh:
        return build_location(json.load(fh), out_blend, live)
