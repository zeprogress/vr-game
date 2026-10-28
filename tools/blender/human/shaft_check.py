import bpy, sys, os
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
bpy.ops.wm.open_mainfile(filepath="/Users/zep/ASSETS/3D/human/Human50k_game_anim.blend")
import poser
arm = poser.arm; scn = bpy.context.scene
res = {}
for a in bpy.data.actions:
    if not any(k in a.name for k in ("Spear", "Hammer", "Flurry", "Sweep", "Crush", "Chain")): continue
    arm.animation_data_create(); arm.animation_data.action = a
    worst = 0
    for f in range(int(a.frame_range[0]), int(a.frame_range[1]) + 1):
        scn.frame_set(f)
        R = arm.pose.bones["RightHand"].matrix; L = arm.pose.bones["LeftHand"].matrix
        gr = R @ poser.GRIP["R"]["C"]; d = (R.to_3x3() @ poser.blade_local("R", "sword")).normalized()
        gl = L @ poser.GRIP["L"]["C"]
        v = gl - gr; off = (v - d * v.dot(d)).length
        worst = max(worst, off)
    res[a.name] = round(worst * 100, 1)
print("SHAFT_CM", res)
