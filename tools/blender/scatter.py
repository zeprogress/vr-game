"""
Расстановка деталей по земле (камни, трава, кости, свечи…) — связанными копиями кит-деталей, по правилам.
Сохраняет сцену; дальше export_location.py соберёт копии в инстансы (одна отрисовка на деталь).

Аргументы: <сцена.blend> --kit <коллекция-исходники> [опции]
  --ground Ground        коллекция земли (по ней raycast)
  --into Scatter_<kit>   куда класть копии (коллекция создаётся/очищается)
  --count 300            сколько поставить (или --density 2 на 100 м²)
  --min-dist 1.5         не ближе друг к другу, м
  --slope 30             не круче, градусов
  --zmin/--zmax          по высоте
  --avoid NoScatter      коллекция зон, куда не ставить (по габариту в плане)
  --scale 0.8-1.3        разброс масштаба; --align — наклон по нормали земли
  --seed 1
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
import mathutils  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402
import zep_lib as z  # noqa: E402

a = z.args()
src = a[0]
kit_name = z.opt(a, "--kit")
ground_name = z.opt(a, "--ground", "Ground")
into_name = z.opt(a, "--into", f"Scatter_{kit_name}")
count = z.opt(a, "--count")
density = z.opt(a, "--density")
min_dist = float(z.opt(a, "--min-dist", "1.5"))
slope = math.radians(float(z.opt(a, "--slope", "30")))
zmin = float(z.opt(a, "--zmin", "-1e9"))
zmax = float(z.opt(a, "--zmax", "1e9"))
avoid_name = z.opt(a, "--avoid", "NoScatter")
s0, s1 = (float(x) for x in z.opt(a, "--scale", "0.8-1.3").split("-"))
align = "--align" in a
rnd = random.Random(int(z.opt(a, "--seed", "1")))
z.load(src)
scene = bpy.context.scene

kit = bpy.data.collections.get(kit_name)
ground = bpy.data.collections.get(ground_name)
if not kit or not ground:
    raise SystemExit(f"нет коллекции {kit_name if not kit else ground_name}")
pieces = [o for o in kit.objects if o.type == "MESH"]
weights = [float(o.get("zep_weight", 1.0)) for o in pieces]

dg = bpy.context.evaluated_depsgraph_get()
verts, polys = [], []
for o in ground.all_objects:
    if o.type != "MESH":
        continue
    ev = o.evaluated_get(dg)
    me = ev.to_mesh()
    base = len(verts)
    verts += [ev.matrix_world @ v.co for v in me.vertices]
    polys += [[base + i for i in p.vertices] for p in me.polygons]
    ev.to_mesh_clear()
bvh = BVHTree.FromPolygons(verts, polys)
xs = [v[0] for v in verts]
ys = [v[1] for v in verts]
x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
top = max(v[2] for v in verts) + 50
area = (x1 - x0) * (y1 - y0)
target = int(count) if count else int(area / 100 * float(density or 1))

avoid = []
ac = bpy.data.collections.get(avoid_name)
if ac:
    for o in ac.all_objects:
        cs = [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
        avoid.append((min(c[0] for c in cs), max(c[0] for c in cs), min(c[1] for c in cs), max(c[1] for c in cs)))

into = bpy.data.collections.get(into_name)
if into:
    for o in list(into.objects):
        bpy.data.objects.remove(o)
else:
    into = bpy.data.collections.new(into_name)
    scene.collection.children.link(into)

cell = min_dist / math.sqrt(2)
grid = {}
placed = 0
tries = 0
while placed < target and tries < target * 40:
    tries += 1
    x = rnd.uniform(x0, x1)
    y = rnd.uniform(y0, y1)
    if any(ax0 <= x <= ax1 and ay0 <= y <= ay1 for ax0, ax1, ay0, ay1 in avoid):
        continue
    hit = bvh.ray_cast(mathutils.Vector((x, y, top)), mathutils.Vector((0, 0, -1)))
    if hit[0] is None:
        continue
    loc, nrm = hit[0], hit[1]
    if nrm.z < math.cos(slope) or not (zmin <= loc.z <= zmax):
        continue
    gx, gy = int(x / cell), int(y / cell)
    near = False
    for i in range(gx - 2, gx + 3):
        for j in range(gy - 2, gy + 3):
            p = grid.get((i, j))
            if p and (p[0] - x) ** 2 + (p[1] - y) ** 2 < min_dist * min_dist:
                near = True
    if near:
        continue
    grid[(gx, gy)] = (x, y)
    srcp = rnd.choices(pieces, weights=weights)[0]
    o = srcp.copy()  # связанная копия: общий меш — потом инстанс
    o.location = loc
    rot = mathutils.Euler((0, 0, rnd.uniform(0, math.tau)))
    q = rot.to_quaternion()
    if align:
        q = nrm.to_track_quat("Z", "Y") @ q
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = q
    o.scale = [rnd.uniform(s0, s1)] * 3
    into.objects.link(o)
    placed += 1

bpy.ops.wm.save_mainfile(filepath=src)
z.emit({"placed": placed, "target": target, "kit": [p.name for p in pieces], "into": into_name, "areaM2": round(area)})
