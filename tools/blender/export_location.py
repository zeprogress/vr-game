"""
Выгрузка локации из .blend для ZEP GAME — одним прогоном (см. docs/pipelines/locations.md).

Аргументы: <сцена.blend> <папка> [--name loc] [--step 1.0]
Коллекции сцены (по именам):
  Ground     — земля: из неё карта высот (raycast сверху) → <name>.heights.json в формате terrainSculpt.json
  Colliders  — простые коробки/цилиндры стен и препятствий (имя с CYL — круг) → <name>.colliders.json; в GLB не идут
  всё остальное видимое → <name>.glb; повторяющиеся детали (связанные копии одного меша, экземпляры
  коллекций) собираются под общий узел → EXT_mesh_gpu_instancing: Babylon делает из них thin instances
  (тысяча камней — одна отрисовка на материал).
Координаты: после загрузки GLB в Babylon точка Blender (X, Y, Z) оказывается в игре в (−X, Z, −Y) —
файлы высот и коллайдеров уже в игровых координатах (как их читает сервер).
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
import mathutils  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402
import zep_lib as z  # noqa: E402

a = z.args()
src, out_dir = a[0], a[1]
name = z.opt(a, "--name", os.path.splitext(os.path.basename(src))[0])
step = float(z.opt(a, "--step", "1.0"))
z.load(src)
scene = bpy.context.scene
os.makedirs(out_dir, exist_ok=True)
warnings = []


def coll_objects(cname):
    c = bpy.data.collections.get(cname)
    return list(c.all_objects) if c else []


def to_game(v):
    """Blender (X, Y, Z) → игра (x, y, z) после загрузки GLB в Babylon."""
    return (-v[0], v[2], -v[1])


# ---- коллайдеры ----
colliders = []
for o in coll_objects("Colliders"):
    if o.type != "MESH":
        continue
    mw = o.matrix_world
    corners = [mw @ mathutils.Vector(c) for c in o.bound_box]
    cx = sum(c[0] for c in corners) / 8
    cy = sum(c[1] for c in corners) / 8
    zs = [c[2] for c in corners]
    sx, sy, _ = o.dimensions
    yaw = mw.to_euler()[2]
    gx, _, gz = to_game((cx, cy, 0))
    if "CYL" in o.name.upper():
        colliders.append({"type": "circle", "x": round(gx, 3), "z": round(gz, 3), "r": round(max(sx, sy) / 2, 3), "y0": round(min(zs), 3), "y1": round(max(zs), 3)})
    else:
        # Поворот вокруг вертикали: в игре знак меняется (зеркало осей при импорте glTF).
        colliders.append({"type": "box", "x": round(gx, 3), "z": round(gz, 3), "hx": round(sx / 2, 3), "hz": round(sy / 2, 3),
                          "rot": round(-yaw, 4), "y0": round(min(zs), 3), "y1": round(max(zs), 3)})
    o.hide_set(True)
    o.hide_render = True
# Зоны «не ставить» (scatter) — служебные, в GLB не идут.
for o in coll_objects("NoScatter"):
    o.hide_set(True)
    o.hide_render = True
with open(os.path.join(out_dir, f"{name}.colliders.json"), "w") as f:
    json.dump({"colliders": colliders}, f, ensure_ascii=False)

# ---- карта высот ----
ground = [o for o in coll_objects("Ground") if o.type == "MESH"]
heights_info = None
if ground:
    dg = bpy.context.evaluated_depsgraph_get()
    verts, polys = [], []
    for o in ground:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        base = len(verts)
        verts += [ev.matrix_world @ v.co for v in me.vertices]
        polys += [[base + i for i in p.vertices] for p in me.polygons]
        ev.to_mesh_clear()
    bvh = BVHTree.FromPolygons(verts, polys)
    xs = [v[0] for v in verts]
    ys = [v[1] for v in verts]
    top = max(v[2] for v in verts) + 50
    # Игровой прямоугольник: x = −X, z = −Y.
    x0, x1 = -max(xs), -min(xs)
    z0, z1 = -max(ys), -min(ys)
    cols = max(2, int(math.ceil((x1 - x0) / step)) + 1)
    rows = max(2, int(math.ceil((z1 - z0) / step)) + 1)
    hs = []
    miss = 0
    lowest = min(v[2] for v in verts)
    eps = 1e-3  # лучи ровно по краю земли проходят мимо — чуть внутрь
    for r in range(rows):
        gz = min(max(z0 + (z1 - z0) * r / (rows - 1), z0 + eps), z1 - eps)
        for c in range(cols):
            gx = min(max(x0 + (x1 - x0) * c / (cols - 1), x0 + eps), x1 - eps)
            hit = bvh.ray_cast(mathutils.Vector((-gx, -gz, top)), mathutils.Vector((0, 0, -1)))
            if hit[0] is None:
                miss += 1
                hs.append(round(lowest, 2))
            else:
                hs.append(round(hit[0][2], 2))
    if miss:
        warnings.append(f"карта высот: {miss} точек мимо земли (поставлена нижняя высота)")
    heights_info = {"x0": round(x0, 2), "x1": round(x1, 2), "z0": round(z0, 2), "z1": round(z1, 2), "cols": cols, "rows": rows}
    with open(os.path.join(out_dir, f"{name}.heights.json"), "w") as f:
        json.dump({**heights_info, "heights": hs}, f)
else:
    warnings.append("нет коллекции Ground — карта высот не выгружена")

# ---- инстансы: экземпляры коллекций → реальные связанные копии; повторы — под общий узел ----
bpy.ops.object.select_all(action="DESELECT")
for o in scene.objects:
    if o.instance_type == "COLLECTION" and o.instance_collection:
        o.select_set(True)
if bpy.context.selected_objects:
    bpy.context.view_layer.objects.active = bpy.context.selected_objects[0]
    bpy.ops.object.duplicates_make_real(use_base_parent=False, use_hierarchy=False)
groups = {}
for o in scene.objects:
    if o.type != "MESH" or not o.visible_get() or o.hide_render:
        continue
    if o.data.users < 2 or o.modifiers or len(o.material_slots) > 1:
        continue
    groups.setdefault(o.data.name, []).append(o)
inst_groups = 0
for mesh_name, objs in groups.items():
    if len(objs) < 2:
        continue
    holder = bpy.data.objects.new(f"Inst_{mesh_name}", None)
    scene.collection.objects.link(holder)
    for o in objs:
        mw = o.matrix_world.copy()
        o.parent = holder
        o.matrix_world = mw
    inst_groups += 1

# ---- выгрузка GLB ----
glb = os.path.join(out_dir, f"{name}.glb")
bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", export_gpu_instances=True, export_apply=True, use_visible=True)

# ---- сводка и бюджеты ----
draw_sources = set()
tris = 0
for o in scene.objects:
    if o.type != "MESH" or not o.visible_get() or o.hide_render:
        continue
    t = z.tri_count(o)
    tris += t
    key = o.data.name if (o.parent and o.parent.name.startswith("Inst_")) else o.name
    for s in o.material_slots or [None]:
        draw_sources.add((key, s.material.name if s and s.material else ""))
textures = [f"{i.name} {i.size[0]}x{i.size[1]}" for i in bpy.data.images if i.size[0] > 0]
big = [t for t in textures if max(map(int, t.split()[-1].split("x"))) > 2048]
if len(draw_sources) > 150:
    warnings.append(f"отрисовок ~{len(draw_sources)} > 150 (бюджет Quest) — объединить меши/материалы")
if tris > 400_000:
    warnings.append(f"треугольников {tris} > 400k")
if big:
    warnings.append(f"текстуры больше 2048: {big}")
z.emit({
    "glb": glb,
    "fileKB": round(os.path.getsize(glb) / 1024),
    "drawCallsApprox": len(draw_sources),
    "instancedGroups": inst_groups,
    "tris": tris,
    "textures": textures,
    "heights": heights_info,
    "colliders": len(colliders),
    "warnings": warnings,
})
