"""
Процедурная «ручная» текстура модели (стилизованный hand-painted): развёртка → растеризация треугольников
в UV → для каждого текселя 3D-точка и нормаль → цвет:
  • материал — по формам SDF в самой точке (чёткие плавные границы, а не «лесенка» треугольников),
    «краска» (paint) поверх; детали (parts) — своим материалом;
  • затенение складок — AO по полю форм (подмышки, под животом, у рта, основания рогов темнеют);
  • пятнистость и оттенки — шум по материалу (var, freq, shade), пятна (spots), волокна (grain);
  • свет «сверху» и затемнение к ногам — объём без зависимости от освещения игры.
Пустые тексели вокруг островов заливаются соседями (без швов на мипах).
"""
import math

import bpy
import numpy as np

from . import sdf


def _lin(h):
    h = h.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return np.array(out)


def _srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def unwrap(ob):
    """Smart UV Project (острова по углу) — работает и без интерфейса, и в живом Blender."""
    vl = bpy.context.view_layer
    prev = vl.objects.active
    vl.objects.active = ob
    for o in vl.objects:
        o.select_set(o == ob)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    # крупные острова (текстура рисуется по 3D-точкам — растяжение не портит рисунок), плотная упаковка
    bpy.ops.uv.smart_project(angle_limit=math.radians(78), island_margin=0.004, area_weight=0.0)
    bpy.ops.uv.pack_islands(rotate=True, margin=0.004)
    bpy.ops.object.mode_set(mode="OBJECT")
    vl.objects.active = prev


def raster(me, size):
    """Тексель → (треугольник, барицентрики). Треугольники — веером из полигонов."""
    uv = np.zeros(len(me.loops) * 2)
    me.uv_layers.active.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2) * size
    lv = np.zeros(len(me.loops), np.int64)
    me.loops.foreach_get("vertex_index", lv)
    tris_v, tris_uv, tris_poly = [], [], []
    for p in me.polygons:
        ls = list(range(p.loop_start, p.loop_start + p.loop_total))
        for k in range(1, len(ls) - 1):
            tri = (ls[0], ls[k], ls[k + 1])
            tris_v.append(lv[list(tri)])
            tris_uv.append(uv[list(tri)])
            tris_poly.append(p.index)
    tris_v = np.array(tris_v)
    tris_uv = np.array(tris_uv)
    owner = np.full((size, size), -1, np.int64)
    bary = np.zeros((size, size, 3), np.float32)
    for t in range(len(tris_uv)):
        a, b, c = tris_uv[t]
        x0, y0 = np.floor(np.minimum(np.minimum(a, b), c)).astype(int)
        x1, y1 = np.ceil(np.maximum(np.maximum(a, b), c)).astype(int)
        x0, y0 = max(x0, 0), max(y0, 0)
        x1, y1 = min(x1, size - 1), min(y1, size - 1)
        if x1 < x0 or y1 < y0:
            continue
        X, Y = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(den) < 1e-12:
            continue
        w0 = ((b[1] - c[1]) * (X - c[0]) + (c[0] - b[0]) * (Y - c[1])) / den
        w1 = ((c[1] - a[1]) * (X - c[0]) + (a[0] - c[0]) * (Y - c[1])) / den
        w2 = 1 - w0 - w1
        eps = -0.02
        m = (w0 >= eps) & (w1 >= eps) & (w2 >= eps)
        if not m.any():
            continue
        ys, xs = (Y[m] - 0.5).astype(int), (X[m] - 0.5).astype(int)
        owner[ys, xs] = t
        bary[ys, xs] = np.stack([w0[m], w1[m], w2[m]], -1)
    return owner, bary, tris_v, np.array(tris_poly)


def sdf_ao(shapes, P, N, step, strength=1.0):
    """Затенение по полю форм: насколько «тесно» вдоль нормали (классический приём для SDF)."""
    occ = np.zeros(len(P))
    wsum = 0.0
    w = 1.0
    for i in range(1, 6):
        h = step * i / 5
        d = sdf.field(shapes, P + N * h)
        occ += np.clip((h - d) / h, 0, 1) * w
        wsum += w
        w *= 0.7
    return np.clip(1 - strength * occ / wsum, 0, 1)


def paint(me, shapes, mats, mdefs, part_face, to_auth, size=512, H=2.0, size_auth=2.0, seed=3):
    """Возвращает пиксели (size, size, 4) в sRGB для текстуры модели."""
    owner, bary, tris_v, tris_poly = raster(me, size)
    filled = owner >= 0
    ti = owner[filled]
    bw = bary[filled].astype(np.float64)
    V = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get("co", V)
    V = V.reshape(-1, 3)
    NV = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get("normal", NV)
    NV = NV.reshape(-1, 3)
    tv = tris_v[ti]
    P = (V[tv] * bw[:, :, None]).sum(1)
    Nn = (NV[tv] * bw[:, :, None]).sum(1)
    Nn /= np.maximum(np.linalg.norm(Nn, axis=1, keepdims=True), 1e-9)
    poly = tris_poly[ti]
    mi = np.zeros(len(me.polygons), np.int32)
    me.polygons.foreach_get("material_index", mi)
    fmat = mi[poly]
    is_part = part_face[poly]
    Pa = to_auth(P)

    # материал тела — по формам в точке
    body = ~is_part
    mat_idx = fmat.copy()
    if body.any():
        D = sdf.shape_dists(shapes, Pa[body])
        solid = np.array([s.op != "paint" for s in shapes])
        Ds = np.where(solid[:, None], np.abs(D), sdf.BIG)
        win = np.argmin(Ds, axis=0)
        mb = np.array([mats.index(shapes[i].mat) for i in win])
        for i, s in enumerate(shapes):
            if s.op == "paint":
                mb[D[i] < 0] = mats.index(s.mat)
        mat_idx[body] = mb

    noise = sdf.Noise(seed)
    col = np.zeros((len(P), 3))
    ao = sdf_ao([s for s in shapes if s.op != "paint"], Pa, Nn, step=0.07 * size_auth)
    for k, mn in enumerate(mats):
        m = mat_idx == k
        if not m.any():
            continue
        d = mdefs.get(mn, "#b0b0b0")
        d = {"c": d} if isinstance(d, str) else d
        base = _lin(d["c"])
        shade = _lin(d["shade"]) if d.get("shade") else base * np.array([0.62, 0.66, 0.78])  # тени холоднее
        hi = _lin(d["light"]) if d.get("light") else np.minimum(1, base * np.array([1.18, 1.15, 1.02]) + 0.02)  # света теплее
        p = Pa[m]
        freq = float(d.get("freq", 7.0)) / max(1e-6, size_auth / 2)
        q = p * freq
        if d.get("grain"):  # волокна: шум, растянутый вдоль оси
            g = np.array(d["grain"], float)
            g /= np.linalg.norm(g)
            q = q + np.outer(q @ g, g) * -0.85
        n = noise.fbm(q, 4)  # −1..1
        var = float(d.get("var", 0.18))
        t = np.clip(0.5 + n * var * 2.5, 0, 1)[:, None]
        c = shade * (1 - t) + base * t
        c = c * (1 - np.clip(n * var * 2.5 - 0.35, 0, 1)[:, None]) + hi * np.clip(n * var * 2.5 - 0.35, 0, 1)[:, None]
        if d.get("spots"):  # пятна/бородавки: [цвет, доля 0–1, частота]
            sc, frac, sf = d["spots"]
            ns = noise.value(p * float(sf) / max(1e-6, size_auth / 2) + 41.3)
            sm = np.clip((ns - (1 - 2 * frac)) * 6, 0, 1)[:, None]
            c = c * (1 - sm) + _lin(sc) * sm
        if not d.get("emit"):
            a = ao[m][:, None]
            c = c * (0.38 + 0.62 * a ** 1.3)
            z = (P[m][:, 2] / max(1e-6, H))[:, None]
            c = c * (0.72 + 0.28 * np.clip(z * 1.6, 0, 1))  # к ногам темнее
            c = c * (0.9 + 0.16 * np.clip(Nn[m][:, 2:3], 0, 1))  # свет сверху
        col[m] = c
    img = np.zeros((size, size, 3))
    img[filled] = col
    # заливка вокруг островов (иначе на мипах и стыках — тёмные швы)
    have = filled.copy()
    for _ in range(12):
        acc = np.zeros_like(img)
        cnt = np.zeros((size, size))
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
            sh = np.roll(np.roll(img, dy, 0), dx, 1)
            hv = np.roll(np.roll(have, dy, 0), dx, 1)
            acc += sh * hv[..., None]
            cnt += hv
        grow = (~have) & (cnt > 0)
        img[grow] = acc[grow] / cnt[grow][:, None]
        have |= grow
    out = np.ones((size, size, 4), np.float32)
    out[..., :3] = _srgb(img)
    return out, float(filled.mean())


def apply(me, name, pixels):
    """Текстура → один материал (картинка в Base Color); прочие материалы убираются."""
    size = pixels.shape[0]
    img = bpy.data.images.get(name + "_tex")
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name + "_tex", width=size, height=size, alpha=False)
    img.pixels.foreach_set(pixels.ravel())
    img.pack()
    m = bpy.data.materials.new(name + "_Mat")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(nd for nd in nt.nodes if nd.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = 0.9
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    me.materials.clear()
    me.materials.append(m)
    me.polygons.foreach_set("material_index", np.zeros(len(me.polygons), np.int32))
    me.update()
