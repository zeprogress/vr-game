"""
Атакующие клипы дракона (риг из art/models/DragonBest.json): укус, хвост, удар крыльями, огненный
выдох, удар лапой. Позы — в пространстве арматуры (градусы, вокруг осей X/Y/Z), время — секунды;
переход между ключами — сглаженный (smoothstep). Клипы — действия арматуры, экспорт GLB (ACTIONS).

Запуск: Blender -b --factory-startup -P tools/blender/dragon_clips.py -- <rig.glb> <out.glb>
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
import zep_lib as z  # noqa: E402

FPS = 24
a = z.args()
src, out = a[0], a[1]
z.load(src)
arm = z.armatures()[0]
scene = bpy.context.scene
scene.render.fps = FPS
pbs = arm.pose.bones
for pb in pbs:
    pb.rotation_mode = "QUATERNION"
q_rest = {b.name: b.matrix_local.to_quaternion() for b in arm.data.bones}


def R(axis, deg):
    return Matrix.Rotation(math.radians(deg), 4, axis)


def ease(keys, t):
    """Значение по ключам [(секунда, значение)] с мягким переходом; до первого и после последнего — константа."""
    if t <= keys[0][0]:
        return keys[0][1]
    for (t0, v0), (t1, v1) in zip(keys, keys[1:]):
        if t0 <= t <= t1:
            u = (t - t0) / (t1 - t0) if t1 > t0 else 1.0
            s = u * u * (3 - 2 * u)
            return v0 + (v1 - v0) * s
    return keys[-1][1]


def mirror_pair(name_l, rot_fn):
    """Левая и правая кость: правая — зеркально (rot_fn(side) даёт поворот для стороны)."""
    return {name_l: rot_fn("L"), name_l.replace(".L", ".R"): rot_fn("R")}


# ---- клипы: каждый — (длительность, функция t → (позы, корень)) ----

def clip_bite(t):
    pose = {}
    pose["Neck1"] = R("X", ease([(0, 0), (0.3, -25), (0.55, 45), (0.8, 40), (1.1, 0), (1.4, 0)], t))
    pose["Neck2"] = R("X", ease([(0, 0), (0.3, -20), (0.55, 36), (0.8, 32), (1.1, 0), (1.4, 0)], t))
    pose["Head"] = R("X", ease([(0, 0), (0.3, -15), (0.55, 30), (0.8, 26), (1.1, 0), (1.4, 0)], t))
    pose["Jaw"] = R("X", ease([(0, 0), (0.3, 0), (0.5, 28), (0.8, 32), (0.95, 0), (1.4, 0)], t))
    pose["Chest"] = R("X", ease([(0, 0), (0.3, -4), (0.55, 10), (1.1, 0), (1.4, 0)], t))
    return pose, None


def clip_tail(t):
    pose = {}
    pose["Pelvis"] = R("Z", ease([(0, 0), (0.4, -8), (0.7, 10), (1.6, 0)], t))
    for k in range(1, 9):
        d = 0.06 * k  # волна бежит от основания к кончику
        pose[f"Tail{k}"] = R("Z", ease([(0, 0), (0.4, 25), (0.7, -45), (1.0, -20), (1.3, 0), (1.6, 0)], t - d))
    return pose, None


def clip_wings(t):
    pose = {}
    for side, sgn in (("L", 1), ("R", -1)):
        # ry(+) опускает левое крыло (ось X наружу), для правого знак зеркальный
        arm1 = ease([(0, 0), (0.4, -55), (0.6, 70), (0.8, 60), (1.1, 10), (1.4, 0)], t)
        arm2 = ease([(0, 0), (0.4, -35), (0.6, 45), (0.8, 40), (1.1, 6), (1.4, 0)], t - 0.03)
        pose[f"WingArm1.{side}"] = R("Y", sgn * arm1)
        pose[f"WingArm2.{side}"] = R("Y", sgn * arm2)
    pose["Chest"] = R("X", ease([(0, 0), (0.4, -5), (0.6, 15), (1.1, 5), (1.4, 0)], t))
    root = Vector((0, 0, ease([(0, 0), (0.6, -0.08), (1.0, -0.03), (1.4, 0)], t)))
    return pose, root


def clip_breath(t):
    pose = {}
    pose["Neck1"] = R("X", ease([(0, 0), (0.5, -30), (0.85, 12), (1.25, 8), (1.6, 0), (1.8, 0)], t))
    pose["Neck2"] = R("X", ease([(0, 0), (0.5, -25), (0.85, 15), (1.25, 10), (1.6, 0), (1.8, 0)], t))
    pose["Head"] = R("X", ease([(0, 0), (0.5, -18), (0.85, 22), (1.25, 15), (1.6, 0), (1.8, 0)], t))
    pose["Jaw"] = R("X", ease([(0, 0), (0.7, 0), (0.95, 35), (1.35, 35), (1.6, 0), (1.8, 0)], t))
    pose["Chest"] = R("X", ease([(0, 0), (0.5, -5), (0.85, 5), (1.8, 0)], t))
    return pose, None


def clip_claw(t):
    pose = {}
    # левая лапа — удар, правая чуть позже (перекрёстный замах)
    for side, delay in (("L", 0.0), ("R", 0.12)):
        tt = t - delay
        pose[f"FrontLeg1.{side}"] = R("X", ease([(0, 0), (0.3, 25), (0.55, -35), (0.8, -20), (1.2, 0), (1.4, 0)], tt))
        pose[f"FrontLeg2.{side}"] = R("X", ease([(0, 0), (0.3, -15), (0.55, 20), (0.8, 8), (1.2, 0), (1.4, 0)], tt))
        pose[f"FrontFoot.{side}"] = R("X", ease([(0, 0), (0.3, 10), (0.55, 35), (0.8, 10), (1.2, 0), (1.4, 0)], tt))
    pose["Chest"] = R("Z", ease([(0, 0), (0.3, -10), (0.55, 15), (1.2, 0), (1.4, 0)], t))
    return pose, None


CLIPS = {
    "AttackBite": (1.4, clip_bite),
    "AttackTail": (1.6, clip_tail),
    "AttackWings": (1.4, clip_wings),
    "AttackBreath": (1.8, clip_breath),
    "AttackClaw": (1.4, clip_claw),
}


def bake(name, dur, fn):
    old = bpy.data.actions.get(name)
    if old:
        bpy.data.actions.remove(old)
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = act
    n = int(round(dur * FPS))
    for f in range(n + 1):
        t = f / FPS
        pose, root = fn(t)
        for pb in pbs:
            b = pb.name
            M = pose.get(b, Matrix.Identity(4))
            q = q_rest[b].inverted() @ M.to_quaternion() @ q_rest[b]
            pb.rotation_quaternion = q
            pb.keyframe_insert("rotation_quaternion", frame=f + 1, group=b)
            if pb.parent is None:
                loc = q_rest[b].inverted() @ (root or Vector((0, 0, 0)))
                pb.location = loc
                pb.keyframe_insert("location", frame=f + 1, group=b)
    return act


for name, (dur, fn) in CLIPS.items():
    bake(name, dur, fn)
    print("CLIP", name, round(dur, 2))

arm.animation_data.action = None
for pb in pbs:
    pb.rotation_quaternion = (1, 0, 0, 0)
    pb.location = (0, 0, 0)

os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=out, export_format="GLB", use_selection=False, export_yup=True, export_apply=False,
    export_animations=True, export_skins=True, export_texcoords=True, export_normals=True,
    export_animation_mode="ACTIONS", export_force_sampling=True, export_optimize_animation_size=True,
    export_image_format="JPEG", export_jpeg_quality=88, export_tangents=True,
)
z.emit({"out": out, "clips": list(CLIPS.keys()), "fileKB": round(os.path.getsize(out) / 1024)})
