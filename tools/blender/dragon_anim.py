"""
Анимации дракона на риге из art/models/DragonBest.json (корень Root → таз → тело, ноги, хвост, крылья).
Базовые клипы (покой, ходьба, бег, удар укусом/выпадом, получение урона, смерть) — процедурные из
zep_gen/anim.py (роли четвероногого: ноги с IK к земле, хвост, шея, челюсть). Свои клипы: взмах хвостом
с поворотом всего тела к цели, удар крыльями, огненный выдох, подготовка к магическому удару.

Позы: поворот в пространстве арматуры (Quaternion), время — кадры по 30 fps. Корень Root — движение и
поворот всего тела; у клипов с поворотом тела разворот задаётся на Root.

Запуск: Blender -b --factory-startup -P tools/blender/dragon_anim.py -- <rig.glb> <out.glb>
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
from mathutils import Quaternion, Vector  # noqa: E402
import zep_lib as z  # noqa: E402
from zep_gen import anim  # noqa: E402

a = z.args()
src, out = a[0], a[1]
z.load(src)
arm = z.armatures()[0]
scene = bpy.context.scene
scene.render.fps = anim.FPS
FPS = anim.FPS

ROLES = {
    "kind": "quad", "pelvis": "Pelvis", "top": "Chest", "spine": ["Spine1", "Chest"],
    "neck": "Neck1", "head": "Head", "jaw": ["Jaw"],
    "tail": [f"Tail{k}" for k in range(1, 9)],
    # фазы: шаг — по очереди; рысь — диагонали (задняя левая + передняя правая, и наоборот)
    "legs": [
        {"bones": ["HindLeg1.L", "HindLeg2.L", "HindFoot.L"], "phase": 0.0, "trot": 0.0},
        {"bones": ["HindLeg1.R", "HindLeg2.R", "HindFoot.R"], "phase": 0.5, "trot": 0.5},
        {"bones": ["FrontLeg1.L", "FrontLeg2.L", "FrontFoot.L"], "phase": 0.25, "trot": 0.5},
        {"bones": ["FrontLeg1.R", "FrontLeg2.R", "FrontFoot.R"], "phase": 0.75, "trot": 0.0},
    ],
    "arms": [],
    "legLen": 0.5,
}
# без подпрыгиваний: таз и корень не покачиваются по вертикали, ноги в шаге поднимаются едва заметно
rig = anim.Rig(arm, ROLES, {"anim": {
    "attack": "bite",
    "walk": {"bob": 0.0, "crouch": 0.0, "lift": 0.01},
    "run": {"bob": 0.0, "crouch": 0.0, "lift": 0.02},
}, "depth": 0.3})


def rx(deg):
    return Quaternion((1, 0, 0), math.radians(deg))


def ry(deg):
    return Quaternion((0, 1, 0), math.radians(deg))


def rz(deg):
    return Quaternion((0, 0, 1), math.radians(deg))


def ease(keys, t):
    """Значение по ключам [(секунда, значение)] с плавным переходом; до первого и после последнего — константа."""
    if t <= keys[0][0]:
        return keys[0][1]
    for (t0, v0), (t1, v1) in zip(keys, keys[1:]):
        if t0 <= t <= t1:
            u = (t - t0) / (t1 - t0) if t1 > t0 else 1.0
            s = u * u * (3 - 2 * u)
            return v0 + (v1 - v0) * s
    return keys[-1][1]


def wings(pose, flap_deg):
    """Крылья: flap_deg > 0 — оба вниз (ось Y), зеркально для правого."""
    pose["WingArm1.L"] = ry(flap_deg)
    pose["WingArm1.R"] = ry(-flap_deg)
    pose["WingArm2.L"] = ry(flap_deg * 0.7)
    pose["WingArm2.R"] = ry(-flap_deg * 0.7)


def with_wings(fn, amp, cycles):
    """Обёртка базового клипа: маховое движение крыльев поверх ног и тела (cycles — целое, для зацикливания)."""
    def f(rig_, t):
        pose, root, sc = fn(rig_, t)
        pose = dict(pose)
        wings(pose, amp * math.sin(2 * math.pi * cycles * t))
        return pose, root, sc
    return f


# ---- свои клипы (t — доля длительности, s — секунды) ----

def clip_tail_turn(t, dur=2.0):
    s = t * dur
    pose = {}
    pose["Root"] = rz(ease([(0, 0), (0.5, -65), (1.0, -65), (1.6, 0), (2.0, 0)], s))
    pose["Pelvis"] = rz(ease([(0, 0), (0.5, 8), (1.0, 8), (1.6, 0), (2.0, 0)], s))
    for k in range(1, 9):
        d = 0.05 * k  # волна бежит от основания к кончику
        pose[f"Tail{k}"] = rz(ease([(0, 0), (0.5, 22), (0.9, -55), (1.2, -30), (1.6, 0), (2.0, 0)], s - d))
    pose["Chest"] = rz(ease([(0, 0), (0.5, -6), (0.9, 10), (1.6, 0), (2.0, 0)], s))
    return pose, None, None


def clip_wings_strike(t, dur=1.8):
    """Левое крыло: замах поднятым над спиной, затем горизонтальный взмах вперёд и наружу костяшкой верхней
    кости (WingArm1); корпус разворачивается к противнику сильнее, чем крыло. Крыло всё время снаружи тела."""
    s = t * dur
    pose = {}
    # корень: сильный разворот к противнику (положительный поворот — морда в сторону левого крыла)
    pose["Root"] = rz(ease([(0, 0), (0.5, 15), (0.9, 55), (1.4, 40), (1.8, 0)], s))
    lift = ease([(0, 0), (0.5, 35), (0.85, 10), (1.2, 6), (1.8, 0)], s)
    sweep = ease([(0, 0), (0.5, 0), (0.85, -105), (1.2, -100), (1.8, 0)], s)
    pose["WingArm1.L"] = rx(lift) @ rz(sweep)
    pose["WingArm2.L"] = rx(lift * 0.6) @ rz(ease([(0, 0), (0.5, 0), (0.85, -60), (1.2, -55), (1.8, 0)], s - 0.03))
    # правое крыло остаётся сложенным вниз
    pose["WingArm1.R"] = ry(-15)
    pose["WingArm2.R"] = ry(-10)
    return pose, None, None


def clip_claw(t, dur=1.4):
    """Удар лапой: передняя левая лапа резко поднимается вверх, затем бьёт когтями сверху вниз.
    Туловище не поворачивается и не подпрыгивает: лапы стоят на земле, кроме бьющей."""
    s = t * dur
    pose = {}
    # резкий подъём: плечо уводит лапу назад-вверх, затем удар сверху вниз до земли
    pose["FrontLeg1.L"] = rx(ease([(0, 0), (0.3, 25), (0.55, -35), (0.8, -20), (1.2, 0), (1.4, 0)], s))
    pose["FrontLeg2.L"] = rx(ease([(0, 0), (0.3, -15), (0.55, 20), (0.8, 8), (1.2, 0), (1.4, 0)], s))
    pose["FrontFoot.L"] = rx(ease([(0, 0), (0.3, 10), (0.55, 35), (0.8, 10), (1.2, 0), (1.4, 0)], s))
    pose["Root"] = rz(ease([(0, 0), (0.35, -6), (0.7, -18), (1.2, -8), (1.4, 0)], s))
    pose["Chest"] = rz(ease([(0, 0), (0.35, -4), (0.7, 10), (1.4, 0)], s))
    return pose, None, None


def clip_breath(t, dur=2.0):
    s = t * dur
    pose = {}
    # выброс: нос поднят, шея немного выдвинута вперёд (голова не опускается)
    pose["Neck1"] = rx(ease([(0, 0), (0.6, -28), (1.0, 6), (1.4, 5), (1.8, 0), (2.0, 0)], s))
    pose["Neck2"] = rx(ease([(0, 0), (0.6, -22), (1.0, 12), (1.4, 10), (1.8, 0), (2.0, 0)], s))
    pose["Head"] = rx(ease([(0, 0), (0.6, -16), (1.0, -60), (1.4, -56), (1.8, 0), (2.0, 0)], s))
    pose["Jaw"] = rx(ease([(0, 0), (0.9, 0), (1.1, 34), (1.6, 34), (1.9, 0), (2.0, 0)], s))
    return pose, None, None


def clip_hit_react(t, dur=0.6):
    """Получение урона: голова и шея откидываются назад и возвращаются; лапы не отрываются от земли."""
    s = t * dur
    a = ease([(0, 0), (0.12, 1), (0.6, 0)], s)
    pose = {}
    pose["Neck1"] = rx(-14 * a)
    pose["Neck2"] = rx(-12 * a)
    pose["Head"] = rx(-16 * a)
    pose["Jaw"] = rx(6 * a)
    return pose, None, None


def clip_magic_charge(t, dur=2.0):
    """Крылья расправляются, как у птицы или бабочки: широко наружу и чуть вверх, пальцы расходятся веером;
    шея откинута, корпус приподнимается."""
    s = t * dur
    pose = {}
    out = ease([(0, 0), (0.8, 66), (1.6, 68), (2.0, 66)], s)
    up = ease([(0, 0), (0.8, 24), (1.6, 28), (2.0, 26)], s)
    for side, sg in (("L", -1), ("R", 1)):
        pose[f"WingArm1.{side}"] = rx(up) @ rz(sg * out)
        pose[f"WingArm2.{side}"] = rx(up * 1.2) @ rz(sg * out * 0.15)
        for i in range(1, 5):
            pose[f"WingFinger{i}.{side}"] = rz(sg * (i - 2.5) * -10)
    lift = up
    neck = ease([(0, 0), (0.8, -24), (1.6, -20), (2.0, -16)], s)
    pose["Neck1"] = rx(neck)
    pose["Neck2"] = rx(neck * 0.8)
    pose["Head"] = rx(neck * 0.5)
    pose["Jaw"] = rx(ease([(0, 0), (0.8, 8), (1.6, 12), (2.0, 8)], s))
    return pose, None, None


def clip_death_collapse(t, dur=2.6):
    """Смерть: подкашиваются передние и задние ноги, тело валится вперёд на грудь, шея и голова падают последними,
    крылья обвисают, хвост безвольно тянется."""
    s = t * dur
    pose = {}
    buckle = ease([(0, 0), (0.3, 0), (0.9, 1.0), (2.6, 1.0)], s)
    for side, out in (("L", -1), ("R", 1)):
        # ноги разводятся в стороны и ложатся на пол (поворот вокруг оси тела Y: бедро наружу, голень плоско)
        pose[f"FrontLeg1.{side}"] = ry(out * 60 * buckle)
        pose[f"FrontLeg2.{side}"] = rx(40 * buckle)
        pose[f"FrontFoot.{side}"] = rx(-20 * buckle)
        pose[f"HindLeg1.{side}"] = ry(out * 70 * buckle)
        pose[f"HindLeg2.{side}"] = rx(40 * buckle)
        pose[f"HindFoot.{side}"] = rx(-20 * buckle)
    pose["Root"] = rx(ease([(0, 0), (0.5, 0), (1.3, 4), (2.6, 6)], s))
    root = Vector((0, 0, ease([(0, 0), (0.3, 0), (1.5, -0.25), (2.6, -0.30)], s)))
    pose["Chest"] = rx(ease([(0, 0), (0.3, 6), (1.2, 14), (2.6, 16)], s))
    pose["Neck1"] = rx(ease([(0, 0), (0.4, -6), (1.2, 16), (2.6, 22)], s))
    pose["Neck2"] = rx(ease([(0, 0), (0.4, -6), (1.2, 12), (2.6, 18)], s))
    pose["Head"] = rx(ease([(0, 0), (0.4, -12), (1.6, 18), (2.6, 26)], s))
    pose["Jaw"] = rx(ease([(0, 0), (1.0, 0), (2.0, 10), (2.6, 12)], s))
    # крылья опадают на пол: по замеру под 70° кончики касаются земли, не проваливаясь в неё
    wings(pose, ease([(0, 0), (0.6, 10), (1.6, 60), (2.6, 70)], s))
    # хвост остаётся в позе покоя: лежит по полу, а не уходит в него (наклон сегментов проваливал его вниз)
    return pose, root, None


# ---- клипы: (имя, кадров, петля, функция(rig, t)); базовые — из генератора с обёртками ----
CLIPS = [
    ("Idle", 90, True, with_wings(anim.clip_idle, 6.0, 1)),
    ("Walk", 48, True, with_wings(anim.clip_walk, 4.0, 1)),
    ("Run", 30, True, with_wings(anim.clip_run, 12.0, 2)),
    ("AttackBite", 36, False, None),  # генератор: quad, style "bite"
    ("AttackClaw", 42, False, lambda rig_, t: clip_claw(t)),
    ("AttackTail", 60, False, lambda rig_, t: clip_tail_turn(t)),
    ("AttackWings", 54, False, lambda rig_, t: clip_wings_strike(t)),
    ("AttackBreath", 60, False, lambda rig_, t: clip_breath(t)),
    ("MagicCharge", 60, False, lambda rig_, t: clip_magic_charge(t)),
    ("HitReact", 18, False, lambda rig_, t: clip_hit_react(t)),
    ("Death", 78, False, lambda rig_, t: clip_death_collapse(t)),
]


def gen_attack(style):
    def f(rig_, t):
        rig_.info["anim"]["attack"] = style
        return anim.clip_attack(rig_, t)
    return f


CLIP_FN = {n: fn for n, _, _, fn in CLIPS}
CLIP_FN["AttackBite"] = gen_attack("bite")

q_rest = rig.q_rest
pbs = arm.pose.bones
for pb in pbs:
    pb.rotation_mode = "QUATERNION"


# привязка к земле по опорным частям, а не по всему мешу (голова и хвост в наклонах уходят ниже лап и
# «всплывают» позу): "legs" — низ лап на нуле в обе стороны, "torso" — низ туловища (для смерти)
SNAP = {"Idle": "legs", "Walk": "legs", "Run": "legs",
        "AttackBite": "legs", "AttackClaw": "hind", "AttackTail": "legs", "AttackWings": "legs",
        "AttackBreath": "legs", "MagicCharge": "legs", "HitReact": "legs", "Death": "torso"}
mesh_obj = next(o for o in bpy.data.objects if o.type == "MESH")
root_bone = next(b for b in rig.names if rig.parent[b] is None)
TORSO_BONES = {"Pelvis", "Spine1", "Chest"}


def _dominant_idx(pred):
    out = []
    for v in mesh_obj.data.vertices:
        if v.groups:
            best = max(v.groups, key=lambda g: g.weight)
            if pred(mesh_obj.vertex_groups[best.group].name):
                out.append(v.index)
    return out


torso_idx = _dominant_idx(lambda n: n in TORSO_BONES)
legs_idx = _dominant_idx(lambda n: n.startswith(("HindLeg", "FrontLeg", "HindFoot", "FrontFoot")))
hind_idx = _dominant_idx(lambda n: n.startswith(("HindLeg", "HindFoot")))
print("SNAP_VERTS torso", len(torso_idx), "legs", len(legs_idx), "hind", len(hind_idx))


def mesh_min_z(which="legs"):
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = mesh_obj.evaluated_get(dg)
    me = ev.to_mesh()
    mw = ev.matrix_world
    idx = {"torso": torso_idx, "hind": hind_idx}.get(which, legs_idx)
    zmin = min((mw @ me.vertices[i].co).z for i in idx)
    ev.to_mesh_clear()
    return zmin


def bake(name, frames, loop, fn):
    old = bpy.data.actions.get(name)
    if old:
        bpy.data.actions.remove(old)
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = act
    mode = SNAP.get(name)
    n = frames if loop else frames - 1
    for f in range(frames + (1 if loop else 0)):
        t = (f % frames) / frames if loop else f / max(1, n)
        pose, root, _sc = fn(rig, t)
        root = root or Vector((0, 0, 0))
        if name != "Death":  # лапы всегда на земле: корень не поднимается и не опускается по вертикали
            root = Vector((root.x, root.y, 0.0))
        for b in rig.names:
            R = pose.get(b, Quaternion())
            pbs[b].rotation_quaternion = q_rest[b].inverted() @ R @ q_rest[b]
        pbs[root_bone].location = q_rest[root_bone].inverted() @ root
        if mode:
            zmin = mesh_min_z(which=mode)
            if mode in ("legs", "torso") or zmin < 0:
                root = root + Vector((0, 0, -zmin))
                pbs[root_bone].location = q_rest[root_bone].inverted() @ root
        for b in rig.names:
            pbs[b].keyframe_insert("rotation_quaternion", frame=f + 1, group=b)
        pbs[root_bone].keyframe_insert("location", frame=f + 1, group=root_bone)
    return act


made = []
for name, frames, loop, _fn in CLIPS:
    fn = CLIP_FN[name]
    bake(name, frames, loop, fn)
    made.append(name)
    print("CLIP", name, round(frames / FPS, 2), "с")

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
z.emit({"out": out, "clips": made, "fileKB": round(os.path.getsize(out) / 1024)})
