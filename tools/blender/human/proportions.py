"""
Пропорции героя «Человек»: длиннее руки, короче корпус. Кости растягиваются вдоль себя (масштаб по Y кости),
сетка деформируется весами, потом поза запекается как поза покоя (сетка и кости), веса остаются прежними.
Кисти, пальцы, голова, ноги — без изменений.

Запуск: Blender -b -P tools/blender/human/proportions.py -- arms=1.35 torso=0.88
Перезаписывает Human50k_rig_lowZEP_fingers.blend; дальше — build_human.py → moves.py → to_game.py.
"""
import bpy
import sys

RIG = "/Users/zep/ASSETS/3D/human/Human50k_rig_lowZEP_fingers.blend"
args = dict(a.split("=", 1) for a in sys.argv[sys.argv.index("--") + 1:]) if "--" in sys.argv else {}
ARMS = float(args.get("arms", 1.35))
TORSO = float(args.get("torso", 0.88))

bpy.ops.wm.open_mainfile(filepath=RIG)
arm = bpy.data.objects["HumanRig"]
body = bpy.data.objects["node_0"]
bones = arm.data.bones

SCALE = {"Spine": TORSO, "Spine1": TORSO, "Spine2": TORSO}
for s in ("Left", "Right"):
    SCALE[f"{s}Arm"] = ARMS
    SCALE[f"{s}ForeArm"] = ARMS

before = {n: (bones[n].tail_local - bones[n].head_local).length for n in SCALE}
height0 = max((body.matrix_world @ v.co).z for v in body.data.vertices)

# масштаб не переходит детям: у каждой кости свой (иначе кисть и голова растянулись бы вместе с предплечьем и шеей)
saved = {b.name: b.inherit_scale for b in bones}
for b in bones:
    if b.parent and b.parent.name in SCALE:
        b.inherit_scale = 'NONE'
for pb in arm.pose.bones:
    pb.rotation_mode = 'QUATERNION'
    pb.rotation_quaternion = (1, 0, 0, 0)
    pb.location = (0, 0, 0)
    pb.scale = (1, SCALE.get(pb.name, 1.0), 1)
arm.animation_data_clear()
bpy.context.view_layer.update()

# сетка — в новую позу
bpy.context.view_layer.objects.active = body
for o in bpy.context.selected_objects:
    o.select_set(False)
body.select_set(True)
mod = next(m for m in body.modifiers if m.type == 'ARMATURE')
name = mod.name
bpy.ops.object.modifier_apply(modifier=name)

# кости — поза как поза покоя
body.select_set(False)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
bpy.ops.pose.armature_apply(selected=False)
bpy.ops.object.mode_set(mode='OBJECT')
for b in bones:
    b.inherit_scale = saved[b.name]
for pb in arm.pose.bones:
    pb.scale = (1, 1, 1)

# снова на скелет
m = body.modifiers.new("Armature", 'ARMATURE')
m.object = arm
bpy.context.view_layer.update()
after = {n: (bones[n].tail_local - bones[n].head_local).length for n in SCALE}
height1 = max((body.matrix_world @ v.co).z for v in body.data.vertices)
print("LEN", {n: f"{before[n]:.3f}→{after[n]:.3f}" for n in SCALE})
print("HEIGHT", round(height0, 3), "→", round(height1, 3))
bpy.ops.wm.save_as_mainfile(filepath=RIG)
print("SAVED")
