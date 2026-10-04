"""
Заготовка новой локации: .blend с коллекциями пайплайна (см. docs/pipelines/locations.md).
  Ground     — земля (сетка size×size, шаг 1 м, лёгкий шум рельефа — правь скульптом/модификаторами)
  Colliders  — сюда коробки стен (COL_…) и цилиндры (COL_CYL_…), в GLB не попадут
  NoScatter  — зоны, куда scatter не ставит детали (тропы, площадки)
  Kit_Rocks  — пример кит-коллекции с двумя камнями (исходники для scatter; сама коллекция скрыта)
  Props      — уникальные объекты локации
Аргументы: <out.blend> [--size 80] [--relief 1.5]
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
import zep_lib as z  # noqa: E402

a = z.args()
out = a[0]
size = float(z.opt(a, "--size", "80"))
relief = float(z.opt(a, "--relief", "1.5"))
z.clear_scene()
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"


def coll(name, hide=False):
    c = bpy.data.collections.new(name)
    scene.collection.children.link(c)
    if hide:
        scene.view_layers[0].layer_collection.children[name].exclude = False
        c.hide_render = True
        c.hide_viewport = True
    return c


def move(o, c):
    for uc in o.users_collection:
        uc.objects.unlink(o)
    c.objects.link(o)


ground_c = coll("Ground")
coll("Colliders")
coll("NoScatter")
kit_c = coll("Kit_Rocks", hide=True)
coll("Props")

n = int(size)
bpy.ops.mesh.primitive_grid_add(x_subdivisions=n, y_subdivisions=n, size=size)
g = bpy.context.object
g.name = "Ground"
for v in g.data.vertices:
    x, y = v.co.x, v.co.y
    v.co.z = relief * (math.sin(x * 0.11) * math.cos(y * 0.09) + 0.5 * math.sin(x * 0.27 + 1.3) * math.sin(y * 0.21))
gm = bpy.data.materials.new("Grass")
gm.use_nodes = True
gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.18, 0.32, 0.12, 1)
g.data.materials.append(gm)
move(g, ground_c)

rm = bpy.data.materials.new("Stone")
rm.use_nodes = True
rm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.36, 0.35, 0.33, 1)
rng = random.Random(3)
for i, sub in enumerate((1, 2)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=0.5)
    r = bpy.context.object
    r.name = f"Rock_{i}"
    for v in r.data.vertices:
        v.co *= 0.8 + rng.random() * 0.4
    r.scale = (1.2, 1.0, 0.7)
    bpy.ops.object.transform_apply(scale=True)
    r.data.materials.append(rm)
    r.location = (0, 0, -100)  # исходники — вне сцены
    move(r, kit_c)

bpy.ops.wm.save_as_mainfile(filepath=out)
z.emit({"blend": out, "collections": [c.name for c in bpy.data.collections], "groundSize": size})
