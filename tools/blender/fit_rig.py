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
from zep_gen import anim, build  # noqa: E402

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

# ---- масштаб до роста, земля на нуле ----
zs = [v.co.z for v in ob.data.vertices]
s = float(sp["height"]) / (max(zs) - min(zs))
ob.scale = (s, s, s)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
ob.location.z -= min(v.co.z for v in ob.data.vertices)
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

# ---- скелет: кости генератора biped ----
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
joints = {k: list(v) for k, v in sp["joints"].items()}
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
bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
bpy.ops.object.vertex_group_clean(group_select_mode="ALL", limit=0.01)
bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL")

# ---- клипы: роли biped (как у генератора) ----
leg_len = float(sp.get("legLen", 0.83))
roles = {
    "kind": "biped", "pelvis": "Hips", "spine": ["Spine", "Chest"], "neck": "Neck", "head": "Head",
    "legs": [{"bones": ["UpperLeg.L", "LowerLeg.L", "Foot.L"], "phase": 0.0},
             {"bones": ["UpperLeg.R", "LowerLeg.R", "Foot.R"], "phase": 0.5}],
    "arms": [{"bones": ["Shoulder.L", "UpperArm.L", "LowerArm.L", "Hand.L"], "side": 1, "phase": 0.5},
             {"bones": ["Shoulder.R", "UpperArm.R", "LowerArm.R", "Hand.R"], "side": -1, "phase": 0.0}],
    "legLen": leg_len,
}
rig = anim.Rig(arm, roles, {"anim": sp.get("anim", {}), "depth": float(sp.get("depth", 0.32))})
clips = anim.bake(rig, sp.get("clips"))

# ---- выгрузка ----
build.export(coll, out, texcoords=True, jpeg=True)
if blend_out:
    os.makedirs(os.path.dirname(blend_out) or ".", exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=blend_out, copy=True)

tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
z.emit({
    "name": name, "tris": tris, "trisSource": tris_src, "bones": len(skel.bones), "weights": weights,
    "clips": [c.get("name", c) if isinstance(c, dict) else c for c in (clips or [])],
    "height": round(max(v.co.z for v in ob.data.vertices), 3), "out": out,
    "fileKB": round(os.path.getsize(out) / 1024),
})
