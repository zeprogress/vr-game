"""
Раскадровка клипов героя «Человек» с муляжом оружия (палка от центра рукояти по направлению клинка).
Запуск: Blender -b -P tools/blender/human/frames.py -- out=<папка> clips=AtkSword1,StanceSword [n=6] [view=34|side|front]
Кладёт <папка>/<клип>_<вид>_<i>.png; склейка в ряд — tools/blender/human/sheet.py (системный python, PIL).
"""
import bpy
import os
import sys
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
bpy.ops.wm.open_mainfile(filepath="/Users/zep/ASSETS/3D/human/Human50k_game_anim.blend")
import poser  # noqa: E402

args = dict(a.split("=", 1) for a in sys.argv[sys.argv.index("--") + 1:])
OUT = args["out"]
N = int(args.get("n", 6))
VIEW = args.get("view", "34")
WEAPON = {"Sword": ("R", "sword", 0.42), "Dagger": ("R", "sword", 0.18), "Spear": ("R", "sword", 0.9),
          "Hammer": ("R", "sword", 0.6), "Bow": ("L", "bow", 0.5), "Staff": ("R", "staff", 0.8)}

scn = bpy.context.scene
scn.render.engine = 'BLENDER_WORKBENCH'
scn.render.resolution_x = 320
scn.render.resolution_y = 420
scn.display.shading.color_type = 'OBJECT'
arm = poser.arm
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
scn.collection.objects.link(cam)
scn.camera = cam
cam.data.lens = 35
tgt = Vector((0, 0, 0.6))
pos = {"34": Vector((-1.5, -2.2, 1.1)), "side": Vector((-2.6, 0, 0.9)), "front": Vector((0, -2.6, 0.9)),
       "top": Vector((0, -0.6, 3.0))}[VIEW]
cam.location = pos
cam.rotation_euler = (tgt - pos).to_track_quat('-Z', 'Y').to_euler()

blades = {}
for side in ("R", "L"):
    bpy.ops.mesh.primitive_cylinder_add(radius=0.008, depth=1.0)
    o = bpy.context.object
    o.color = (1, 0.3, 0.1, 1) if side == "R" else (0.2, 0.5, 1, 1)
    blades[side] = o

os.makedirs(OUT, exist_ok=True)
for name in args["clips"].split(","):
    act = bpy.data.actions[name]
    arm.animation_data_create()
    arm.animation_data.action = act
    f0, f1 = act.frame_range
    kind = next((v for k, v in WEAPON.items() if k in name), ("R", "sword", 0.42))
    for i in range(N):
        f = f0 + (f1 - f0) * i / max(1, N - 1)
        scn.frame_set(int(f), subframe=f - int(f))
        for side, o in blades.items():
            show = side == kind[0] or ("Dagger" in name) or ("Spear" in name and False)
            o.hide_render = not show
            if not show:
                continue
            hb = arm.pose.bones["RightHand" if side == "R" else "LeftHand"].matrix
            g = hb @ poser.GRIP[side]["C"]
            d = (hb.to_3x3() @ poser.blade_local(side, kind[1])).normalized()
            L = kind[2]
            o.location = g + d * (L * 0.5 - 0.06 * (L > 0.3))
            o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
            o.scale = (1, 1, L)
        scn.render.filepath = os.path.join(OUT, f"{name}_{VIEW}_{i}.png")
        bpy.ops.render.render(write_still=True)
    print("FRAMES", name)
