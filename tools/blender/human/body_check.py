"""
Проверка клипов героя «Человек» на пересечения: руки с туловищем и головой (poser.penetration) и рука с рукой.
Запуск: Blender -b -P tools/blender/human/body_check.py [-- clips=AtkBow1,...]
Печатает по клипу: худшее проникновение в тело (см) и наименьший зазор между руками (см, < 0 — пересечение).
"""
import bpy
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
bpy.ops.wm.open_mainfile(filepath="/Users/zep/ASSETS/3D/human/Human50k_game_anim.blend")
import poser  # noqa: E402

args = dict(a.split("=", 1) for a in sys.argv[sys.argv.index("--") + 1:]) if "--" in sys.argv else {}
arm = poser.arm
scn = bpy.context.scene


def seg_dist(p1, q1, p2, q2):
    d1, d2, r = q1 - p1, q2 - p2, p1 - p2
    a, e, f = d1.dot(d1), d2.dot(d2), d2.dot(r)
    c, b = d1.dot(r), d1.dot(d2)
    den = a * e - b * b
    s = max(0.0, min(1.0, (b * f - c * e) / den)) if den > 1e-12 else 0.0
    t = (b * s + f) / e if e > 1e-12 else 0.0
    if t < 0:
        t, s = 0.0, max(0.0, min(1.0, -c / a))
    elif t > 1:
        t, s = 1.0, max(0.0, min(1.0, (b - c) / a))
    return ((p1 + d1 * s) - (p2 + d2 * t)).length


names = args["clips"].split(",") if "clips" in args else [a.name for a in bpy.data.actions if a.name.startswith(("Atk", "Sk", "Stance"))]
for name in names:
    act = bpy.data.actions[name]
    arm.animation_data_create()
    arm.animation_data.action = act
    worst_body, worst_gap, at = 0.0, 9.0, 0
    for f in range(int(act.frame_range[0]), int(act.frame_range[1]) + 1):
        scn.frame_set(f)
        pose = poser.Pose()
        for n in poser.ORDER:
            pose.q[n] = arm.pose.bones[n].rotation_quaternion.copy()
        pose.loc = arm.pose.bones["Hips"].location.copy()
        pose.fk()
        hit = poser.penetration(pose)
        if hit and hit[2] > worst_body:
            worst_body = hit[2]
        segs = {}
        for side, s in (("R", "Right"), ("L", "Left")):
            a, fo, h = pose.P[f"{s}Arm"], pose.P[f"{s}ForeArm"], pose.P[f"{s}Hand"]
            tip = h + pose.W[f"{s}Hand"] @ poser.Vector((0, 0.09, 0))
            segs[side] = [(a.lerp(fo, 0.4), fo, 0.035), (fo, h, 0.03), (h, tip, 0.035)]
        for i1, (p1, q1, r1) in enumerate(segs["R"]):
            for i2, (p2, q2, r2) in enumerate(segs["L"]):
                if i1 == 2 and i2 == 2:
                    continue  # кисть о кисть — двуручный хват
                g = seg_dist(p1, q1, p2, q2) - r1 - r2
                if g < worst_gap:
                    worst_gap, at = g, f
    print(f"BODY {name}: тело {worst_body * 100:.1f} см, зазор рук {worst_gap * 100:.1f} см (кадр {at})")
