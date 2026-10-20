"""
Раскадровка клипов: строки — клипы, столбцы — моменты (секунды клипа). Камера одна для всех кадров
(ортографическая, по росту модели), пол — сетка на нуле: видно, где стопы, куда идёт удар, нет ли
вывернутых суставов. Так проверялись позы Ледяного гиганта (docs/pipelines/creatures.md).

  npm run asset -- frames <модель.glb|.blend> <out.png> --clips "Attack:0,0.48,0.6,0.82;Walk;Death:0,1,1.85,3"
        [--view 34|side|front|back34] [--tile 220] [--scale 1.5]

Клип без моментов — 6 кадров по всей длине. --scale — поле кадра в ростах модели (замах выше головы — больше).
"""
import json
import os
import sys
import tempfile

import bpy
import mathutils
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import zep_lib as z  # noqa: E402

a = z.args()
src, out = a[0], a[1]
spec = z.opt(a, "--clips")
view = z.opt(a, "--view", "34")
tile = int(z.opt(a, "--tile", "220"))
scale = float(z.opt(a, "--scale", "1.5"))
z.load(src)
scene = bpy.context.scene
arm = z.armatures()[0]
meshes = [o for o in bpy.data.objects if o.type == "MESH"]

# Рост и середина модели — по мешам в покое (до выбора клипа).
lo = mathutils.Vector((1e9, 1e9, 1e9))
hi = -lo
for ob in meshes:
    for c in ob.bound_box:
        w = ob.matrix_world @ mathutils.Vector(c)
        lo = mathutils.Vector(map(min, lo, w))
        hi = mathutils.Vector(map(max, hi, w))
h = max(0.1, hi.z - max(0.0, lo.z))

scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "TEXTURE"
scene.display.shading.show_cavity = True
scene.render.resolution_x = tile
scene.render.resolution_y = tile
scene.render.image_settings.file_format = "PNG"
if not scene.world:
    scene.world = bpy.data.worlds.new("w")
scene.world.color = (0.16, 0.16, 0.19)
bpy.ops.mesh.primitive_grid_add(x_subdivisions=12, y_subdivisions=12, size=h * 3, location=(0, 0, 0))

center = mathutils.Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2 - h * 0.1, h * 0.45))
cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = h * scale
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
dirs = {"34": (0.75, -0.75, 0.35), "side": (1, 0, 0.05), "front": (0, -1, 0.1), "back34": (-0.7, 0.7, 0.4)}
d = mathutils.Vector(dirs[view]).normalized()
cam.location = center + d * h * 6
cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
cam_data.clip_end = h * 20

fps = scene.render.fps
rows = []
names = []
for item in spec.split(";"):
    name, _, ts = item.partition(":")
    act = bpy.data.actions.get(name) or next((x for x in bpy.data.actions if x.name.lower().startswith(name.lower())), None)
    if not act:
        raise SystemExit(f"нет клипа {name}: есть {[x.name for x in bpy.data.actions]}")
    arm.animation_data_create()
    arm.animation_data.action = act
    f0, f1 = act.frame_range
    times = [float(t) for t in ts.split(",")] if ts else [i * (f1 - f0) / fps / 5 for i in range(6)]
    row = []
    for tt in times:
        f = f0 + tt * fps
        scene.frame_set(int(f), subframe=f - int(f))
        p = os.path.join(tempfile.gettempdir(), f"zf_{name}_{tt}.png")
        scene.render.filepath = p
        bpy.ops.render.render(write_still=True)
        row.append(p)
    rows.append(row)
    names.append(f"{act.name}: {', '.join(f'{t:g}' for t in times)} с")
cols = max(len(r) for r in rows)
sheet = np.zeros((tile * len(rows), tile * cols, 4), dtype=np.float32)
for i, r in enumerate(rows):
    for j, p in enumerate(r):
        img = bpy.data.images.load(p)
        px = np.array(img.pixels[:], dtype=np.float32).reshape(tile, tile, 4)
        sheet[(len(rows) - 1 - i) * tile:(len(rows) - i) * tile, j * tile:(j + 1) * tile] = px
        bpy.data.images.remove(img)
        os.remove(p)
im = bpy.data.images.new("sheet", tile * cols, tile * len(rows), alpha=True)
im.pixels.foreach_set(sheet.ravel())
im.filepath_raw = out
im.file_format = "PNG"
im.save()
z.emit({"out": out, "rows": names, "height": round(h, 3)})
