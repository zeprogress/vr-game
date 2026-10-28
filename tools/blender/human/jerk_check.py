"""
Рывки рук в клипах героя «Человек»: ускорение кисти и локтя по кадрам (вторая разность положений).
Запуск: Blender -b -P tools/blender/human/jerk_check.py [-- clips=...]
Печатает по клипу: наибольшее ускорение (см/кадр²), медиану и во сколько раз пик выше медианы (рывок — пик ≫ медианы).
"""
import bpy
import sys

bpy.ops.wm.open_mainfile(filepath="/Users/zep/ASSETS/3D/human/Human50k_game_anim.blend")
args = dict(a.split("=", 1) for a in sys.argv[sys.argv.index("--") + 1:]) if "--" in sys.argv else {}
arm = bpy.data.objects["HumanRig"]
scn = bpy.context.scene
names = args["clips"].split(",") if "clips" in args else [a.name for a in bpy.data.actions if a.name.startswith(("Atk", "Sk"))]
BONES = ("RightHand", "LeftHand", "RightForeArm", "LeftForeArm")
for name in names:
    act = bpy.data.actions[name]
    arm.animation_data_create()
    arm.animation_data.action = act
    tr = {b: [] for b in BONES}
    tip = {b: [] for b in ("RightHand", "LeftHand")}
    for f in range(int(act.frame_range[0]), int(act.frame_range[1]) + 1):
        scn.frame_set(f)
        for b in BONES:
            tr[b].append(arm.pose.bones[b].head.copy())
        for b in tip:
            m = arm.pose.bones[b].matrix
            tip[b].append(m @ __import__("mathutils").Vector((0, 0.09, 0)))
    worst = (0, "", 0)
    acc_all = []
    for b, ps in list(tr.items()) + [(k + "Tip", v) for k, v in tip.items()]:
        for i in range(1, len(ps) - 1):
            a = (ps[i + 1] - 2 * ps[i] + ps[i - 1]).length * 100
            acc_all.append(a)
            if a > worst[0]:
                worst = (a, b, i + 1)
    acc_all.sort()
    med = acc_all[len(acc_all) // 2] if acc_all else 0
    print(f"JERK {name}: пик {worst[0]:.2f} ({worst[1]}, кадр {worst[2]}), медиана {med:.2f}, ×{worst[0] / max(med, 1e-3):.0f}")
