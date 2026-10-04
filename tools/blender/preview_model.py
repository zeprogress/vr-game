"""
Превью модели одним листом 512×512 (2×2: спереди, сбоку, сзади, 3/4 сверху) — одна маленькая
картинка вместо серии скриншотов. С --anim <клип> — вторая строка кадров этого клипа (4 кадра).
Workbench: цвета материалов/текстур, без света сцены — быстро и наглядно.
Аргументы: <модель> <out.png> [--anim Run] [--size 512]
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
anim = z.opt(a, "--anim")
size = int(z.opt(a, "--size", "512"))
tile = size // 2
z.load(src)
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "TEXTURE"
scene.display.shading.show_shadows = False
scene.display.shading.show_cavity = True
scene.render.film_transparent = False
scene.render.resolution_x = tile
scene.render.resolution_y = tile
scene.render.image_settings.file_format = "PNG"
world = bpy.data.worlds.new("w") if not scene.world else scene.world
scene.world = world
world.color = (0.16, 0.16, 0.19)

lo, hi = z.world_bbox()
center = mathutils.Vector(((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2))
extent = max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * 1.15

cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = extent
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

# Модели glTF смотрят в −Y Blender: «спереди» — камера на −Y.
VIEWS = [("спереди", (0, -1, 0)), ("сбоку", (1, 0, 0)), ("сзади", (0, 1, 0)), ("3/4", (0.7, -0.7, 0.55))]


def shoot(direction, path):
    d = mathutils.Vector(direction).normalized()
    cam.location = center + d * extent * 3
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


tmp = tempfile.mkdtemp()
tiles = []
for i, (_, d) in enumerate(VIEWS):
    p = os.path.join(tmp, f"v{i}.png")
    shoot(d, p)
    tiles.append(p)

rows = 2
frames = []
if anim:
    act = next((x for x in bpy.data.actions if x.name.lower().startswith(anim.lower())), None)
    arm = next(iter(z.armatures()), None)
    if act and arm:
        arm.animation_data_create()
        arm.animation_data.action = act
        f0, f1 = act.frame_range
        for k in range(4):
            scene.frame_set(int(f0 + (f1 - f0) * k / 4))
            p = os.path.join(tmp, f"a{k}.png")
            shoot(VIEWS[3][1], p)
            frames.append(p)
        rows = 3


def load_px(p):
    img = bpy.data.images.load(p)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4)
    bpy.data.images.remove(img)
    return px


H = tile * rows if not frames else tile * 2 + tile // 2
sheet = np.zeros((H, size, 4), dtype=np.float32)
sheet[..., 3] = 1
# Пиксели Blender — снизу вверх: верхний ряд кладём в верх массива (конец по Y).
for i, p in enumerate(tiles):
    px = load_px(p)
    r, c = divmod(i, 2)
    y0 = H - (r + 1) * tile
    sheet[y0:y0 + tile, c * tile:(c + 1) * tile] = px
if frames:
    small = tile // 2
    for k, p in enumerate(frames):
        px = load_px(p)[::2, ::2]
        sheet[0:small, k * small:(k + 1) * small] = px[:small, :small]
img = bpy.data.images.new("sheet", width=size, height=H)
img.pixels = sheet.ravel().tolist()
img.filepath_raw = out
img.file_format = "PNG"
img.save()
z.emit({"preview": out, "views": [v[0] for v in VIEWS], "anim": anim if frames else None, "size": [size, H]})
