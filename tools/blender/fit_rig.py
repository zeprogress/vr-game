"""
Внешняя модель → игровой риг и клипы (rig "fit"): импорт GLB/FBX/OBJ, масштаб по росту, упрощение,
текстуры до заданного размера, скелет biped генератора (имена костей и роли клипов те же), веса —
тепловая карта Blender (4 кости на вершину), клипы — процедурные (zep_gen/anim.py), экспорт GLB.

Запуск: Blender -b --factory-startup -P tools/blender/fit_rig.py -- <spec.json> <out.glb> [--blend out.blend]
Спецификация: art/models/<Имя>.json (rig "fit"): source, height, tris, texture, legLen, depth,
joints (метры, после масштаба; +X — левая сторона модели, .L; лицо — −Y), clips.
"""
import json
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
import zep_lib as z  # noqa: E402
from zep_gen import anim, build, spider  # noqa: E402

a = z.args()
spec_path, out = a[0], a[1]
blend_out = z.opt(a, "--blend")
with open(spec_path, encoding="utf-8") as f:
    sp = json.load(f)
name = sp["name"]

# ---- импорт и объединение в один меш ----
z.clear_scene()
src = sp["source"]
ext = os.path.splitext(src)[1].lower()
z.IMPORTERS[ext](src)
parts = [o for o in bpy.context.scene.objects if o.type == "MESH"]
bpy.ops.object.select_all(action="DESELECT")
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
if len(parts) > 1:
    bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
ob.name = name
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# ---- масштаб: по росту ("height") или по длине вдоль Y ("length", для зверей с хвостом) ----
zs = [v.co.z for v in ob.data.vertices]
if sp.get("length"):
    ys = [v.co.y for v in ob.data.vertices]
    s = float(sp["length"]) / (max(ys) - min(ys))
else:
    s = float(sp["height"]) / (max(zs) - min(zs))
ob.scale = (s, s, s)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
zmin = min(v.co.z for v in ob.data.vertices)
ob.location.z -= zmin
bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

# ---- чистка топологии и упрощение до бюджета ----
bpy.context.view_layer.objects.active = ob
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.remove_doubles(threshold=1e-6)
bpy.ops.object.mode_set(mode="OBJECT")
tris_src = sum(len(p.vertices) - 2 for p in ob.data.polygons)
budget = int(sp.get("tris", 6000))
if tris_src > budget:
    dec = ob.modifiers.new("Decimate", "DECIMATE")
    dec.decimate_type = "COLLAPSE"
    dec.ratio = budget / tris_src
    dec.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=dec.name)
bpy.ops.object.shade_smooth()

# ---- текстуры: до texture px (PBR-карты: цвет, нормали, металл/шероховатость) ----
tex = int(sp.get("texture", 1024))
for img in bpy.data.images:
    if img.size[0] > tex or img.size[1] > tex:
        img.scale(tex, tex)

# ---- цвет базовой текстуры: камень — насыщенность ниже (тёплая охра давала оранжевый);
#      зелёный мох (зелень: G сильнее R и B) — своя насыщенность, выше, чем у камня ----
sat = float(sp.get("saturation", 1.0))
moss_k = float((sp.get("moss") or {}).get("chroma", sat))
if sat != 1.0 or moss_k != sat:
    import numpy as np
    base_imgs = {link.from_node.image for m in ob.data.materials if m and m.node_tree
                 for link in m.node_tree.links if link.to_socket.name == "Base Color" and link.from_node.image}
    for img in base_imgs:
        px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4)
        rgb = px[:, :3]
        lum = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
        new_rgb = lum[:, None] + (rgb - lum[:, None]) * sat
        green = (rgb[:, 1] - np.maximum(rgb[:, 0], rgb[:, 2])) > 0.02
        new_rgb[green] = lum[green, None] + (rgb[green] - lum[green, None]) * moss_k
        px[:, :3] = np.clip(new_rgb, 0.0, 1.0)
        img.pixels.foreach_set(px.ravel())
        img.update()

# ---- скелет: из спецификации ("bones") или кости генератора biped ----
joints = {k: list(v) for k, v in sp["joints"].items()}
if sp.get("jointsInSource"):
    # Суставы заданы в единицах исходного файла (до масштаба): переводим туда же, куда и меш.
    joints = {k: [v[0] * s, v[1] * s, v[2] * s - zmin] for k, v in joints.items()}
if sp.get("bones"):
    # Кости из спецификации: {"name", "head", "tail", "parent"} — суставы по именам из "joints".
    # "mirror": true — каждая кость с ".L" получает зеркальную ".R" (суставы — с X наизнанку, если не заданы).
    BONES = [(b["name"], b["head"], b["tail"], b.get("parent")) for b in sp["bones"]]
    if sp.get("mirror"):
        for k in list(joints):
            if k.endswith(".L") and k[:-2] + ".R" not in joints:
                joints[k[:-2] + ".R"] = [-joints[k][0], joints[k][1], joints[k][2]]
        BONES += [(n.replace(".L", ".R"), h.replace(".L", ".R"), t.replace(".L", ".R"),
                   (p.replace(".L", ".R") if p else None)) for n, h, t, p in BONES if ".L" in n]
else:
    BONES = [
        ("Hips", "hips", "spine", None),
        ("Spine", "spine", "chest", "Hips"),
        ("Chest", "chest", "neck", "Spine"),
        ("Neck", "neck", "head", "Chest"),
        ("Head", "head", "headTop", "Neck"),
    ]
    for side in ("L", "R"):
        BONES += [
            ("Shoulder." + side, "clav." + side, "shoulder." + side, "Chest"),
            ("UpperArm." + side, "shoulder." + side, "elbow." + side, "Shoulder." + side),
            ("LowerArm." + side, "elbow." + side, "wrist." + side, "UpperArm." + side),
            ("Hand." + side, "wrist." + side, "hand." + side, "LowerArm." + side),
            ("UpperLeg." + side, "hip." + side, "knee." + side, "Hips"),
            ("LowerLeg." + side, "knee." + side, "ankle." + side, "UpperLeg." + side),
            ("Foot." + side, "ankle." + side, "toe." + side, "LowerLeg." + side),
        ]
skel = SimpleNamespace(bones=[{"name": n, "head": h, "tail": t, "parent": p} for n, h, t, p in BONES])
missing = sorted({j for _, h, t, _ in BONES for j in (h, t)} - set(joints))
if missing:
    raise SystemExit(f"нет суставов в спецификации: {missing}")

coll = bpy.data.collections.new(name)
bpy.context.scene.collection.children.link(coll)
for c in list(ob.users_collection):
    c.objects.unlink(ob)
coll.objects.link(ob)
arm = build.make_armature(name, skel, joints, coll)

# ---- веса: тепловая карта; если не посчиталась — по объёму (envelope) ----
bpy.ops.object.select_all(action="DESELECT")
ob.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
try:
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    weights = "heat"
except RuntimeError as e:
    bpy.ops.object.parent_set(type="ARMATURE_ENVELOPE")
    weights = f"envelope ({str(e)[:60]})"
bpy.context.view_layer.objects.active = ob
# ---- жёсткие части (меч и т. п.): вершины внутри капсулы «a→b, радиус r» — целиком на одной кости
#      (иначе тепловые веса тянут клинок за предплечье и он гнётся). "rigid": [{"bone", "capsule": {"a", "b", "r"}}]
# ---- тепловая карта иногда не сходится для части костей: Blender пишет warning и оставляет пустые группы
#      (тогда экспорт GLB без скина). Веса — по расстоянию до костей: 4 ближайших, гаусс σ = 4 см.
#      Вершины, оставшиеся без веса (при сошедшейся карте), — к ближайшей кости с весом 1.
import math  # noqa: E402
bones_w = [(b.name, arm.matrix_world @ b.head_local, arm.matrix_world @ b.tail_local) for b in arm.data.bones]


def _seg_dist(p, A, B):
    AB = B - A
    t = max(0.0, min(1.0, (p - A).dot(AB) / max(1e-12, AB.dot(AB))))
    return (p - (A + AB * t)).length


weighted_n = sum(1 for v in ob.data.vertices if any(g.weight > 0 for g in v.groups))
if weighted_n < 0.9 * len(ob.data.vertices):
    weights = "расстояние до костей (heat не сошёлся)"
    for v in ob.data.vertices:
        near = sorted((_seg_dist(v.co, A, B), n) for n, A, B in bones_w)[:4]
        raw = [(math.exp(-(d / 0.04) ** 2), n) for d, n in near]
        s = sum(w for w, _ in raw) or 1.0
        for w, n in raw:
            (ob.vertex_groups.get(n) or ob.vertex_groups.new(name=n)).add([v.index], w / s, "REPLACE")
else:
    for v in ob.data.vertices:
        if not any(g.weight > 0 for g in v.groups):
            n = min(bones_w, key=lambda b: _seg_dist(v.co, b[1], b[2]))[0]
            (ob.vertex_groups.get(n) or ob.vertex_groups.new(name=n)).add([v.index], 1.0, "REPLACE")
from mathutils import Vector  # noqa: E402
# ---- маска весов ("weightMask"): у вершин внутри тела (ближе r0 к оси axis) вес указанных костей переходит
#      к "fallback" (брюшко), у края (r1) — плавно. Иначе бедро задней ноги тянет поверхность тела, и тело
#      жмётся при движении ноги. Вес переносим, а не множим: нормировка вернула бы долю ноги обратно.
mask_n = 0
wm = sp.get("weightMask")
if wm:
    unknown = sorted(set(wm["bones"]) - {b.name for b in arm.data.bones})
    if unknown:
        raise SystemExit(f"weightMask: нет костей: {unknown}")
    wa = Vector(joints[wm["axis"][0]])
    wab = Vector(joints[wm["axis"][1]]) - wa
    r0, r1 = float(wm["r0"]), float(wm["r1"])
    masked = set(wm["bones"])
    fb_vg = ob.vertex_groups.get(wm.get("fallback", "Body")) or ob.vertex_groups.new(name=wm.get("fallback", "Body"))
    for v in ob.data.vertices:
        t = max(0.0, min(1.0, (v.co - wa).dot(wab) / max(1e-12, wab.dot(wab))))
        d = (v.co - (wa + wab * t)).length
        k = min(1.0, max(0.0, (d - r0) / max(1e-9, r1 - r0)))
        if k >= 1.0:
            continue
        lost = 0.0
        for ge in list(v.groups):
            g = ob.vertex_groups[ge.group]
            if g.name in masked and ge.weight > 0.0:
                lost += ge.weight * (1.0 - k)
                g.add([v.index], ge.weight * k, "REPLACE")
        if lost > 0.0:
            kept = next((ge.weight for ge in v.groups if ge.group == fb_vg.index), 0.0)
            fb_vg.add([v.index], kept + lost, "REPLACE")
            mask_n += 1
    print(f"WEIGHTMASK moved={mask_n} r0={r0} r1={r1}")
rigid_n = 0
for rg in sp.get("rigid", []):
    cap = rg["capsule"]
    A, B = Vector(joints[cap["a"]]), Vector(joints[cap["b"]])
    R = float(cap["r"])
    AB = B - A
    vg = ob.vertex_groups.get(rg["bone"]) or ob.vertex_groups.new(name=rg["bone"])
    for v in ob.data.vertices:
        t = max(0.0, min(1.0, (v.co - A).dot(AB) / AB.dot(AB)))
        if (v.co - (A + AB * t)).length <= R:
            for ge in list(v.groups):
                ob.vertex_groups[ge.group].remove([v.index])
            vg.add([v.index], 1.0, "REPLACE")
            rigid_n += 1
bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
bpy.ops.object.vertex_group_clean(group_select_mode="ALL", limit=0.01)
bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL")

# ---- клипы: роли biped (как у генератора); "clips": [] — риг без анимаций (кости под будущие клипы) ----
clips = []
if sp.get("clips") != []:
    leg_len = float(sp.get("legLen", 0.83))
    roles = spider.roles(leg_len) if sp.get("rigKind") == "spider" else {
        "kind": "biped", "pelvis": "Hips", "spine": ["Spine", "Chest"], "neck": "Neck", "head": "Head",
        "legs": [{"bones": ["UpperLeg.L", "LowerLeg.L", "Foot.L"], "phase": 0.0},
                 {"bones": ["UpperLeg.R", "LowerLeg.R", "Foot.R"], "phase": 0.5}],
        "arms": [{"bones": ["Shoulder.L", "UpperArm.L", "LowerArm.L", "Hand.L"], "side": 1, "phase": 0.5},
                 {"bones": ["Shoulder.R", "UpperArm.R", "LowerArm.R", "Hand.R"], "side": -1, "phase": 0.0}],
        "legLen": leg_len,
    }
    rig = anim.Rig(arm, roles, {"anim": sp.get("anim", {}), "depth": float(sp.get("depth", 0.32))})
    clips = anim.bake(rig, sp.get("clips"), clips=spider.CLIPS if sp.get("rigKind") == "spider" else None)

# ---- выгрузка ----
build.export(coll, out, texcoords=True, jpeg=True)
if blend_out:
    os.makedirs(os.path.dirname(blend_out) or ".", exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=blend_out, copy=True)

tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
z.emit({
    "name": name, "tris": tris, "trisSource": tris_src, "bones": len(skel.bones), "weights": weights, "rigid": rigid_n,
    "weightMask": mask_n,
    "clips": [c.get("name", c) if isinstance(c, dict) else c for c in (clips or [])],
    "height": round(max(v.co.z for v in ob.data.vertices), 3), "out": out,
    "fileKB": round(os.path.getsize(out) / 1024),
})
