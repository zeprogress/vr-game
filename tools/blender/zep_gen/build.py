"""
Сборка модели по спецификации (JSON): скелет → формы (SDF) → сетка → Decimate → материалы → жёсткие
детали → веса костей → масштаб → клипы → GLB. Работает и без интерфейса (CLI), и в живом Blender
через MCP (модель собирается в коллекции с именем модели, прошлая версия заменяется).
"""
import json
import math
import os
import time

import bpy
import numpy as np
from mathutils import Matrix, Vector

from . import anim, paint, parts, sdf, spec as S

BUDGET = {"mob": 5000, "boss": 10000, "hero": 5000, "prop": 2000}
# Вес кости допускается, если она не дальше стольких шагов по дереву от главной кости вершины:
# живот ↔ плечо (3) — можно, кисть ↔ бедро (7) — нельзя (иначе рука «прилипнет» к ноге).
WEIGHT_HOPS = 3


# ---------- материалы ----------

def _lin(c):
    c = c / 255.0 if c > 1 else c
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h):
    h = h.lstrip("#")
    return [_lin(int(h[i:i + 2], 16)) for i in (0, 2, 4)]


def material(name, d):
    """d: "#rrggbb" | {"c": "#..", "rough": 0.8, "metal": 0, "emit": 0}."""
    if isinstance(d, str):
        d = {"c": d}
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    rgb = hex_rgb(d["c"])
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*rgb, 1)
        bsdf.inputs["Roughness"].default_value = float(d.get("rough", 0.85))
        bsdf.inputs["Metallic"].default_value = float(d.get("metal", 0.0))
        if d.get("emit"):
            bsdf.inputs["Emission Color"].default_value = (*rgb, 1)
            bsdf.inputs["Emission Strength"].default_value = float(d["emit"])
    return m


def _srgb(c):
    return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def atlas(me, name, colors, cell=16):
    """Все материалы → один материал с палитрой-текстурой (клетка cell×cell на цвет, UV — в центр клетки).
    Одна отрисовка на моба вместо одной на материал; игра (recolorMonster) работает с атласом как с паком."""
    n = len(colors)
    cols = min(8, n)
    rows = (n + cols - 1) // cols
    W, H = 8 * cell, 1 << max(4, (rows * cell - 1).bit_length())
    img = bpy.data.images.get(name + "_atlas")
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name + "_atlas", width=W, height=H, alpha=False)
    px = np.ones((H, W, 4), np.float32)
    for i, rgb in enumerate(colors):
        r, c = divmod(i, cols)
        px[r * cell:(r + 1) * cell, c * cell:(c + 1) * cell, :3] = [_srgb(x) for x in rgb]
    img.pixels.foreach_set(px.ravel())
    img.pack()
    uv = me.uv_layers.new(name="UVMap")
    mi = np.zeros(len(me.polygons), np.int32)
    me.polygons.foreach_get("material_index", mi)
    loop_mi = np.repeat(mi, [len(p.vertices) for p in me.polygons])
    r, c = np.divmod(loop_mi, cols)
    uvs = np.stack([(c + 0.5) * cell / W, (r + 0.5) * cell / H], -1).astype(np.float32)
    uv.data.foreach_set("uv", uvs.ravel())
    m = bpy.data.materials.new(name + "_Atlas")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(nd for nd in nt.nodes if nd.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = 0.85
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Closest"  # без размытия на стыках клеток
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    me.materials.clear()
    me.materials.append(m)
    me.polygons.foreach_set("material_index", np.zeros(len(me.polygons), np.int32))
    me.update()


# ---------- сетка ----------

def _mesh_from(name, V, F):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in V], [], [tuple(f) for f in F])
    me.update()
    return me


def decimate(V, F, target_tris, symmetric=True, keep=None):
    """Decimate (collapse) через временный объект; keep — вершины, которые беречь (границы цветов)."""
    me = _mesh_from("_dec", V, F)
    ob = bpy.data.objects.new("_dec", me)
    bpy.context.scene.collection.objects.link(ob)
    tris = sum(len(f) - 2 for f in F)
    md = ob.modifiers.new("dec", "DECIMATE")
    md.ratio = min(1.0, target_tris / max(1, tris))
    md.use_collapse_triangulate = True
    if symmetric:
        md.use_symmetry = True
        md.symmetry_axis = "X"
    if keep is not None and keep.any():
        vg = ob.vertex_groups.new(name="dec")
        idx = np.nonzero(~keep)[0].tolist()
        if idx:
            vg.add(idx, 1.0, "REPLACE")
        md.vertex_group = "dec"
        md.vertex_group_factor = 4.0
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    m2 = bpy.data.meshes.new_from_object(ev)
    nv = len(m2.vertices)
    V2 = np.zeros(nv * 3)
    m2.vertices.foreach_get("co", V2)
    V2 = V2.reshape(-1, 3)
    F2 = [list(p.vertices) for p in m2.polygons]
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    bpy.data.meshes.remove(m2)
    return V2, F2


def face_mats(shapes, V, F, mats):
    """Материал грани: ближайшая форма (add/sub) по центру грани; «краска» (paint) поверх."""
    C = np.array([V[f].mean(0) for f in F])
    D = sdf.shape_dists(shapes, C)
    solid = np.array([s.op in ("add", "sub") for s in shapes])
    Ds = np.where(solid[:, None], np.abs(D), sdf.BIG)
    win = np.argmin(Ds, axis=0)
    out = np.array([mats.index(shapes[i].mat) for i in win])
    for i, s in enumerate(shapes):
        if s.op == "paint":
            out[D[i] < 0] = mats.index(s.mat)
    return out


# ---------- веса ----------

def body_weights(skel, shapes, V, blend):
    """Вес кости = насколько поверхность «принадлежит» её формам: exp(−(d_кости − d_мин)/blend),
    только для костей не дальше WEIGHT_HOPS шагов по дереву от главной (рука не цепляет бедро), до 4 костей."""
    names = [b["name"] for b in skel.bones]
    dist = skel.graph_dist()
    Db = np.full((len(names), len(V)), sdf.BIG)
    for i, s in enumerate(shapes):
        if s.op != "add" or not s.bone:
            continue
        bi = names.index(s.bone)
        lo, hi = s.bounds()
        pad = 0.5 * float(np.max(hi - lo))
        m = np.all((V >= lo - pad) & (V <= hi + pad), axis=1)
        if m.any():
            d = np.full(len(V), sdf.BIG)
            d[m] = s.dist(V[m])
            Db[bi] = np.minimum(Db[bi], d)
    main = np.argmin(Db, axis=0)
    dmin = Db[main, np.arange(len(V))]
    W = np.exp(-np.maximum(0, Db - dmin) / blend)
    for bi, n in enumerate(names):
        far = np.array([dist[names[m]].get(n, 99) > WEIGHT_HOPS for m in main])
        W[bi, far] = 0
    W[Db >= sdf.BIG * 0.5] = 0
    out = []
    for vi in range(len(V)):
        w = W[:, vi]
        top = np.argsort(-w)[:4]
        top = [t for t in top if w[t] > 0.02]
        s = sum(w[t] for t in top) or 1.0
        out.append([(names[t], float(w[t] / s)) for t in top] or [(names[main[vi]], 1.0)])
    return out


# ---------- арматура ----------

def make_armature(name, skel, joints, coll):
    arm_data = bpy.data.armatures.new(name + "_Rig")
    arm = bpy.data.objects.new(name + "_Rig", arm_data)
    coll.objects.link(arm)
    prev_active = bpy.context.view_layer.objects.active
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    ebs = arm_data.edit_bones
    for b in skel.bones:
        eb = ebs.new(b["name"])
        eb.head = Vector(joints[b["head"]])
        eb.tail = Vector(joints[b["tail"]])
        if (eb.tail - eb.head).length < 1e-3:
            eb.tail = eb.head + Vector((0, 0, 0.02))
    for b in skel.bones:
        if b["parent"]:
            ebs[b["name"]].parent = ebs[b["parent"]]
            ebs[b["name"]].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.objects.active = prev_active
    return arm


# ---------- главная ----------

def build(sp, out_glb=None, out_blend=None, live=False):
    t0 = time.time()
    name = sp["name"]
    kind = sp.get("type", "mob")
    warnings = []

    if not live:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    # коллекция модели (в живом Blender — заменяем прошлую версию)
    old = bpy.data.collections.get(name)
    if old:
        for o in list(old.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.collections.remove(old)
    coll = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(coll)

    base_arm = None
    if sp.get("rig") == "char":
        base_arm = load_base(sp, coll)
    skel, tshapes = S.build_skeleton(sp, base_arm)
    items = tshapes + S.expand_mirror(sp.get("add"))
    default_mat = sp.get("mat", "skin")
    for it in items:
        it.setdefault("mat", default_mat)
    shapes = S.make_shapes(skel, items, default_mat)
    surf = sp.get("surface") or {}
    if surf.get("noise") or surf.get("cracks"):  # бугры и трещины по плитам — поверх всего тела
        shapes.append(sdf.Surface(surf.get("noise"), surf.get("cracks")))
    mats = list(dict.fromkeys(list((sp.get("mats") or {}).keys()) + [s.mat for s in shapes if s.mat]))

    # сетка из форм
    lo, hi = sdf.bounds_of(shapes, 0)
    size = float(np.max(hi - lo))
    h = float(sp.get("res", size / 110))
    # сетка — по гладкой форме; рельеф (бугры, трещины) уходит в карту нормалей и текстуру
    V, Q = sdf.mesh([sh for sh in shapes if sh.op != "surface"], h)
    raw_tris = len(Q) * 2
    budget = int(sp.get("tris", BUDGET.get(kind, 5000)))
    part_items = S.expand_mirror(sp.get("parts"))
    built_parts = [parts.build(skel, it) for it in part_items]
    part_tris = sum(sum(len(f) - 2 for f in p[1]) for p in built_parts)
    body_budget = max(500, budget - part_tris)
    # границы цветов: вершины на стыке разных материалов — беречь при прореживании
    fm0 = face_mats(shapes, V, Q, mats)
    keep = np.zeros(len(V), bool)
    vm = {}
    for fi, f in enumerate(Q):
        for v in f:
            if v in vm and vm[v] != fm0[fi]:
                keep[v] = True
            vm.setdefault(v, fm0[fi])
    symmetric = sp.get("symmetric", True)
    V, F = decimate(V, Q, body_budget, symmetric, keep)
    fm = face_mats(shapes, V, F, mats)

    # веса тела
    blend = float(sp.get("skinBlend", 0.035 * size))
    rig_on = sp.get("rig", "biped") != "none"
    W = body_weights(skel, shapes, V, blend) if rig_on else None

    # общий меш: тело + детали
    allV = [V]
    allF = [F]
    allM = [fm]
    smooth = [np.ones(len(F), bool)]
    allW = list(W) if W else []
    off = len(V)
    for (pv, pf, bone, mat, sm) in built_parts:
        if mat not in mats:
            mats.append(mat)
        allV.append(pv)
        allF.append([[i + off for i in f] for f in pf])
        allM.append(np.full(len(pf), mats.index(mat)))
        smooth.append(np.full(len(pf), sm))
        if rig_on:
            allW += [[(bone, 1.0)]] * len(pv)
        off += len(pv)
    n_body_faces = len(F)
    V = np.concatenate(allV)
    F = [f for ff in allF for f in ff]
    M = np.concatenate(allM)
    SM = np.concatenate(smooth)

    # земля и масштаб: ступни на 0, рост — как в спецификации
    minz = float(V[:, 2].min())
    hgt = float(V[:, 2].max()) - minz
    f = float(sp["height"]) / hgt if sp.get("height") else 1.0
    if base_arm is not None:  # герой: размеры и земля — как у скелета пака (в клипах есть смещения)
        minz, f = 0.0, 1.0
    V = (V - [0, 0, minz]) * f
    joints = {k: list((np.array(v, float) - [0, 0, minz]) * f) for k, v in skel.joints.items()}

    me = _mesh_from(name, V, F)
    for mn in mats:
        me.materials.append(material(mn, (sp.get("mats") or {}).get(mn, "#b0b0b0")))
    me.polygons.foreach_set("material_index", M.astype(np.int32))
    me.polygons.foreach_set("use_smooth", SM)
    me.update()
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    # Мобы и боссы — ОДИН материал (одна отрисовка): по умолчанию процедурная «ручная» текстура
    # (paint.py: материал по формам, затенение складок, пятнистость, волокна), "texture": 0 —
    # плоская палитра-атлас. Герои — с материалами, как модели героев пака.
    mdefs = sp.get("mats") or {}
    tex_size = int(sp.get("texture", 512 if kind in ("mob", "boss") else 0))
    use_atlas = bool(sp.get("atlas", kind in ("mob", "boss"))) or tex_size > 0
    if tex_size > 0:
        paint.unwrap(ob)
        part_face = np.arange(len(me.polygons)) >= n_body_faces
        nstr = float(sp.get("normal", 1.0))
        px, cover, npx = paint.paint(me, shapes, mats, mdefs, part_face, lambda P: P / f + np.array([0, 0, minz]),
                                     size=tex_size, H=float(V[:, 2].max()), size_auth=size, normal=nstr)
        paint.apply(me, name, px, npx if nstr > 0 else None)
        warnings += [] if cover > 0.35 else [f"развёртка занимает {cover:.0%} текстуры — мелко"]
    elif use_atlas:
        atlas(me, name, [hex_rgb((mdefs.get(mn, "#b0b0b0") if isinstance(mdefs.get(mn, "#b0b0b0"), str) else mdefs[mn]["c"])) for mn in mats])

    clips = []
    arm = None
    if rig_on:
        arm = base_arm or make_armature(name, skel, joints, coll)
        for b in skel.bones:
            ob.vertex_groups.new(name=b["name"])
        groups = {}
        for vi, ws in enumerate(allW):
            for bn, w in ws:
                groups.setdefault((bn, round(w, 3)), []).append(vi)
        for (bn, w), idx in groups.items():
            ob.vertex_groups[bn].add(idx, w, "REPLACE")
        ob.parent = arm
        md = ob.modifiers.new("Armature", "ARMATURE")
        md.object = arm
    if rig_on and base_arm is not None:
        clips = [{"name": a.name, "sec": round((a.frame_range[1] - a.frame_range[0]) / 24, 2)} for a in bpy.data.actions if a.users]
    elif rig_on:
        roles = dict(skel.roles)
        roles["legLen"] = roles.get("legLen", 1.0) * f
        depth = sp.get("depth")
        if depth is None:
            tors = [s for s in shapes if s.bone in (roles.get("spine", []) + [roles.get("pelvis")]) and s.kind == "ellipsoid"]
            depth = max([s.p["r"][1] for s in tors] or [0.15])
        info = {"anim": sp.get("anim", {}), "depth": float(depth) * f}
        rig = anim.Rig(arm, roles, info)
        clips = anim.bake(rig, sp.get("clips"))
    if rig_on and len(skel.bones) > 64:
        warnings.append(f"костей {len(skel.bones)} > 64")
    # проверка: формы несоседних костей слиплись (кожа порвётся при движении)
    if rig_on:
        dist = skel.graph_dist()
        adds = [s for s in shapes if s.op == "add" and s.bone]
        stuck = set()
        for i, a in enumerate(adds):
            ca = (np.add(*a.bounds()) / 2)[None, :]
            for b in adds[i + 1:]:
                if dist[a.bone].get(b.bone, 99) <= WEIGHT_HOPS:
                    continue
                cb = (np.add(*b.bounds()) / 2)[None, :]
                # перемычка: на линии центров есть точка, где обе формы ближе четверти радиуса сглаживания
                P = ca + (cb - ca) * np.linspace(0, 1, 48)[:, None]
                if np.min(np.maximum(a.dist(P), b.dist(P))) < 0.25 * max(a.k, b.k):
                    stuck.add(tuple(sorted((a.bone, b.bone))))
        for a, b in sorted(stuck):
            warnings.append(f"слиплись {a} и {b} — разведи формы (иначе кожа тянется)")

    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    if tris > budget * 1.05:
        warnings.append(f"треугольников {tris} > бюджета {budget}")
    mat_cap = {"boss": 12, "prop": 4}.get(kind, 10)
    if not use_atlas and len(mats) > mat_cap:
        warnings.append(f"материалов {len(mats)} > {mat_cap} — каждый материал = отрисовка")
    res = {
        "name": name, "tris": tris, "rawTris": raw_tris, "verts": len(me.vertices), "bones": len(skel.bones),
        "materials": mats, "height": round(float(V[:, 2].max()), 3), "clips": [f"{c['name']} {c['sec']}с" for c in clips],
        "sec": round(time.time() - t0, 1), "warnings": warnings,
    }
    if out_blend:
        os.makedirs(os.path.dirname(out_blend) or ".", exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=out_blend, copy=True)
        res["blend"] = out_blend
    if out_glb:
        export(coll, out_glb, texcoords=use_atlas, jpeg=tex_size > 0)
        res["glb"] = out_glb
        res["fileKB"] = round(os.path.getsize(out_glb) / 1024)
    return res


def repo_path(p):
    if os.path.isabs(p):
        return p
    return os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "..", p))


def load_base(sp, coll):
    """Герой: скелет и все клипы из модели пака (sp["base"]); её меши выбрасываем — тело лепим своё."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=repo_path(sp["base"]))
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == "ARMATURE")
    keep = [o for o in new if o.type != "MESH"]
    for o in new:
        if o.type == "MESH":
            me = o.data
            bpy.data.objects.remove(o, do_unlink=True)
            if me.users == 0:
                bpy.data.meshes.remove(me)
    for o in keep:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        coll.objects.link(o)
    for m in list(bpy.data.materials):
        if m.users == 0:
            bpy.data.materials.remove(m)
    return arm


def export(coll, path, texcoords=False, jpeg=False):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    bpy.context.view_layer.update()
    for o in bpy.context.view_layer.objects:
        if o is not None:
            o.select_set(False)
    for o in coll.objects:
        o.select_set(True)
    kw = dict(
        filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
        export_animations=True, export_skins=True, export_texcoords=texcoords, export_normals=True,
        export_animation_mode="ACTIONS", export_force_sampling=True, export_optimize_animation_size=True,
    )
    if jpeg:  # шумная «ручная» текстура в PNG весит в 4–5 раз больше
        kw.update(export_image_format="JPEG", export_jpeg_quality=88, export_tangents=True)
    bpy.ops.export_scene.gltf(**kw)


def build_file(spec_path, out_glb=None, out_blend=None, live=False):
    with open(spec_path, encoding="utf-8") as fh:
        sp = json.load(fh)
    return build(sp, out_glb, out_blend, live)
