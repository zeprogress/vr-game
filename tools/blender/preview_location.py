"""
Превью локации одним листом (2×2): карта сверху + три вида с высоты птичьего полёта/героя.
Workbench: цвета вершин, тени от «солнца», кавити — быстро и честно для низкополи.
Аргументы: <сцена.blend> <out.png> [--size 768]
"""
import math
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
import mathutils  # noqa: E402
import numpy as np  # noqa: E402
import zep_lib as z  # noqa: E402

a = z.args()
src, out = a[0], a[1]
size = int(z.opt(a, "--size", "768"))
tile = size // 2
z.load(src)
scene = bpy.context.scene
for name in ("Colliders", "Kit"):
    c = bpy.data.collections.get(name)
    if c:
        for o in c.all_objects:
            o.hide_render = True
scene.render.engine = "BLENDER_WORKBENCH"
sh = scene.display.shading
sh.light = "STUDIO"
sh.color_type = "VERTEX"
sh.show_shadows = True
sh.shadow_intensity = 0.45
sh.show_cavity = True
sh.cavity_type = "WORLD"
scene.display.light_direction = (0.45, 0.35, 0.82)
scene.render.resolution_x = tile
scene.render.resolution_y = tile
scene.render.image_settings.file_format = "PNG"
world = scene.world or bpy.data.worlds.new("w")
scene.world = world
world.color = (0.55, 0.68, 0.82)
g = bpy.data.objects.get("Ground")
co = np.array([v.co[:] for v in g.data.vertices])
lo, hi = co.min(0), co.max(0)
cx, cy = (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2
span = max(hi[0] - lo[0], hi[1] - lo[1])
cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam_data.clip_end = span * 6


def shoot(loc, target, path, ortho=None, lens=28):
    cam_data.type = "ORTHO" if ortho else "PERSP"
    if ortho:
        cam_data.ortho_scale = ortho
    cam_data.lens = lens
    cam.location = loc
    cam.rotation_euler = (mathutils.Vector(target) - mathutils.Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


tmp = tempfile.mkdtemp()
shots = []
p = os.path.join(tmp, "top.png")
shoot((cx, cy, hi[2] + span), (cx, cy + 0.001, 0), p, ortho=span * 1.02)
shots.append(p)
zc = float(np.median(co[:, 2]))
for i, (dx, dy, hgt, dist) in enumerate([(-0.55, -0.55, 0.32, 0.75), (0.6, -0.3, 0.16, 0.6), (0.1, 0.15, 0.025, 0.3)]):
    loc = (cx + dx * span * dist / 0.75, cy + dy * span * dist / 0.75, zc + span * hgt + 2)
    p = os.path.join(tmp, f"v{i}.png")
    shoot(loc, (cx, cy, zc), p, lens=24 if i < 2 else 20)
    shots.append(p)


def load_px(pth):
    img = bpy.data.images.load(pth)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4)
    bpy.data.images.remove(img)
    return px


sheet = np.zeros((size, size, 4), dtype=np.float32)
for i, pth in enumerate(shots):
    r, c = divmod(i, 2)
    y0 = size - (r + 1) * tile
    sheet[y0:y0 + tile, c * tile:(c + 1) * tile] = load_px(pth)
img = bpy.data.images.new("sheet", width=size, height=size)
img.pixels = sheet.ravel().tolist()
img.filepath_raw = out
img.file_format = "PNG"
img.save()
z.emit({"preview": out, "views": ["сверху", "с угла", "сбоку низко", "с тропы"], "size": [size, size]})
