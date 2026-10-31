"""Портрет эльфа с живым освещением заката: тёплое солнце сверху-справа-позади."""
import bpy, sys, math
from mathutils import Vector

OUT = sys.argv[sys.argv.index("--")+1]
SRC = sys.argv[sys.argv.index("--")+2]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
if arms:
    a = arms[0]
    a.data.pose_position = 'POSE'
    if a.animation_data is None: a.animation_data_create()
    act = bpy.data.actions.get('Idle')
    if act:
        a.animation_data.action = act
        if hasattr(a.animation_data, 'action_slot') and act.slots:
            a.animation_data.action_slot = act.slots[0]
bpy.context.scene.frame_set(30)
for _ in range(3):
    bpy.context.view_layer.update()
    bpy.context.evaluated_depsgraph_get().update()

lo = Vector((1e9,)*3); hi = Vector((-1e9,)*3)
for m in meshes:
    for v in m.bound_box:
        w = m.matrix_world @ Vector(v)
        lo = Vector((min(lo[i], w[i]) for i in range(3)))
        hi = Vector((max(hi[i], w[i]) for i in range(3)))
center = (lo+hi)/2
h = hi.z - lo.z
print(f"[sun] рост {h:.3f}", flush=True)

# Камера: спереди (-Y), ортографическая
cam_d = bpy.data.cameras.new("cam"); cam_d.type='ORTHO'; cam_d.ortho_scale = h*1.06
cam = bpy.data.objects.new("cam", cam_d); bpy.context.scene.collection.objects.link(cam)
cam.location = (center.x, center.y - 4, center.z)
cam.rotation_euler = (math.radians(90), 0, 0)
bpy.context.scene.camera = cam

# ЗАКАТНОЕ СОЛНЦЕ: сверху-справа-ПОЗАДИ героя (+Y — за спиной при виде спереди)
# Цвет — DUSK.sun из DayTime.ts: [1, 0.6, 0.32]
sun_col = (1.0, 0.6, 0.32)
sd = bpy.data.lights.new("sunset", 'SUN')
sd.energy = 12.0
sd.color = (1.0, 0.55, 0.26)
sd.angle = math.radians(2.0)
sun = bpy.data.objects.new("sunset", sd)
bpy.context.scene.collection.objects.link(sun)
# направление: из точки (+X, +Y, +Z) в центр → свет падает сзади-справа-сверху
lpos = Vector((center.x + 2.9, center.y + 1.9, center.z + h*0.42))
d = (Vector(center) - lpos).normalized()
sun.location = lpos
sun.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

# Тёплый контровой подсвет: слабый заполняющий свет спереди-слева, холодный, как небо заката
fill_d = bpy.data.lights.new("fill", 'AREA'); fill_d.energy = 90; fill_d.size = 5.0
fill_d.color = (0.60, 0.66, 5.0 and 1.0)
fill = bpy.data.objects.new("fill", fill_d)
fill.location = (center.x - 2.2, center.y - 2.4, center.z + h*0.35)
bpy.context.scene.collection.objects.link(fill)
fd = (Vector(center) - Vector(fill.location)).normalized()
fill.rotation_euler = fd.to_track_quat('-Z','Y').to_euler()

# Rim-подсвет сзади для контура (тёплый)
rim_d = bpy.data.lights.new("rim", 'AREA'); rim_d.energy = 1200; rim_d.size = 1.6
rim_d.color = (1.0, 0.52, 0.22)
rim = bpy.data.objects.new("rim", rim_d)
rim.location = (center.x + 1.2, center.y + 2.6, center.z + h*0.50)
bpy.context.scene.collection.objects.link(rim)
rd = (Vector(center) - Vector(rim.location)).normalized()
rim.rotation_euler = rd.to_track_quat('-Z','Y').to_euler()

# Мир: небо заката (DUSK.zenith / horizon)
world = bpy.data.worlds.new("w"); bpy.context.scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (0.28, 0.24, 0.42, 1)   # сумеречная синева
bg.inputs[1].default_value = 0.9

sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = 64
sc.cycles.device = 'CPU'
sc.render.film_transparent = True
sc.render.resolution_x = 408
sc.render.resolution_y = 900
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGBA'
sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print(f"[sun] готово: {OUT}", flush=True)
