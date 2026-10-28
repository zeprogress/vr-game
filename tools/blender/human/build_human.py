"""
Анимации для героя «Человек» с нуля: риг пользователя Human50k_rig_lowZEP.blend + клипы Mixamo.
Перенос — по мировым поворотам: поворот кости цели = (мировая дельта кости источника от её покоя) × покой цели.
Родитель берётся уже позированным (тот же кадр), поэтому цепочки не накапливают ошибку.
"""
import bpy, sys, glob, os, math
from mathutils import Quaternion, Vector, Matrix

ARGS = sys.argv[sys.argv.index("--") + 1:]
OUT_BLEND = ARGS[0]
OUT_GLB = ARGS[1]
RIG = "/Users/zep/ASSETS/3D/human/Human50k_rig_lowZEP_fingers.blend"
CLIPS = {  # файл → имя клипа в игре
    "Standing Idle": "Idle", "walk": "Walk", "Running": "Run", "Sword Slash": "SwordSlash",
    "RecieveHit": "RecieveHit", "PickUp": "PickUp", "Jumping": "Jump", "Roll": "Roll",
    "Dying": "Death", "Defeat": "Defeat", "Victory": "Victory",
    "Stable Sword Outward Slash ANIMATION": "OutwardSlash",
}

bpy.ops.wm.open_mainfile(filepath=RIG)
tgt = bpy.data.objects["HumanRig"]
body = [o for o in bpy.data.objects if o.type == 'MESH'][0]
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
tgt_names = {b.name for b in tgt.data.bones}

def map_name(n):
    n = n.replace("mixamorig:", "")
    if n.endswith("_End") or n.endswith("_end"):
        return None
    n = n.replace("ToeBase", "Toe")
    for side in ("Left", "Right"):
        for fing in ("Thumb", "Index", "Middle", "Ring", "Pinky"):
            pre = f"{side}Hand{fing}"
            if n.startswith(pre) and n[len(pre):].isdigit():
                return None  # пальцы рига стоят не как у Mixamo — ставим свою позу кисти (ниже)
    return n if n in tgt_names else None

order = []
def walk(b):
    order.append(b.name)
    for c in b.children:
        walk(c)
for b in tgt.data.bones:
    if b.parent is None:
        walk(b)

TW = tgt.matrix_world.to_quaternion()
Rt_rest = {b.name: TW @ b.matrix_local.to_quaternion() for b in tgt.data.bones}
Lt = {}
for b in tgt.data.bones:
    Lt[b.name] = (b.parent.matrix_local.to_quaternion().inverted() @ b.matrix_local.to_quaternion()) if b.parent else b.matrix_local.to_quaternion()

def fwd(arm, hips, toe):
    h = arm.matrix_world @ arm.data.bones[hips].head_local
    t = arm.matrix_world @ arm.data.bones[toe].tail_local
    v = Vector((t.x - h.x, t.y - h.y, 0))
    return v.normalized()

tgt_fwd = fwd(tgt, "Hips", "LeftToe")
tgt_hips_rest = tgt.matrix_world @ tgt.data.bones["Hips"].head_local
report = {}

def retarget(path, clip):
    before_obj = set(bpy.data.objects)
    before_act = set(bpy.data.actions)
    bpy.ops.import_scene.fbx(filepath=path)
    new_objs = [o for o in bpy.data.objects if o not in before_obj]
    src = [o for o in new_objs if o.type == 'ARMATURE'][0]
    sact = src.animation_data.action
    f0, f1 = int(sact.frame_range[0]), int(sact.frame_range[1])
    MAP = {}
    for b in src.data.bones:
        m = map_name(b.name)
        if m:
            MAP[m] = b.name  # цель → источник
    sh = "mixamorig:Hips"
    # Поворот «мир источника → мир цели» вокруг вертикали (куда смотрит персонаж).
    sf = fwd(src, sh, "mixamorig:LeftToeBase")
    ang = math.atan2(sf.x * tgt_fwd.y - sf.y * tgt_fwd.x, sf.x * tgt_fwd.x + sf.y * tgt_fwd.y)
    G = Quaternion(Vector((0, 0, 1)), ang)
    SW = src.matrix_world
    SWq = SW.to_quaternion()
    Rs_rest = {s: SWq @ src.data.bones[s].matrix_local.to_quaternion() for s in MAP.values()}
    src_hips_rest = SW @ src.data.bones[sh].head_local
    K = (tgt_hips_rest.z) / max(1e-6, src_hips_rest.z)
    act = bpy.data.actions.new(clip)
    act.use_fake_user = True
    tgt.animation_data_create()
    tgt.animation_data.action = act
    tpb = tgt.pose.bones
    spb = src.pose.bones
    err_max = 0.0
    prevq = {}  # знак кватерниона — непрерывно от кадра к кадру: иначе между ключами кость крутится почти на оборот
    for f in range(f0, f1 + 1):
        bpy.context.scene.frame_set(f)
        posed = {}
        for tn in order:
            b = tgt.data.bones[tn]
            par = b.parent.name if b.parent else None
            Pp = posed.get(par) if par else None
            if Pp is None and par:
                Pp = Rt_rest[par]
            sn = MAP.get(tn)
            if sn:
                Ws = SWq @ spb[sn].matrix.to_quaternion()
                D = G @ (Ws @ Rs_rest[sn].inverted()) @ G.inverted()
                Wt = D @ Rt_rest[tn]
                # Покой у рига и у Mixamo разный (руки у рига ниже T-позы): доворачиваем кость, чтобы она
                # смотрела ровно туда же, куда кость источника; поворот вокруг своей оси (скрутка) — от дельты.
                ds = G @ ((SW @ spb[sn].tail) - (SW @ spb[sn].head))
                if ds.length > 1e-6:
                    dnow = Wt @ Vector((0, 1, 0))
                    Wt = dnow.rotation_difference(ds.normalized()) @ Wt
            else:
                # без источника: держим позу относительно родителя как в покое
                Wt = (Pp if Pp is not None else Quaternion()) @ Lt[tn]
            posed[tn] = Wt
            Pq = Pp if Pp is not None else TW
            Q = Lt[tn].inverted() @ Pq.inverted() @ Wt if par else (TW @ Lt[tn]).inverted() @ Wt
            p = tpb[tn]
            p.rotation_mode = 'QUATERNION'
            if tn in prevq and prevq[tn].dot(Q) < 0:
                Q = -Q
            prevq[tn] = Q.copy()
            p.rotation_quaternion = Q
            if sn:
                p.keyframe_insert("rotation_quaternion", frame=f)
            if tn == "Hips":
                hs = SW @ spb[sh].head
                dw = G @ (hs - src_hips_rest) * K
                p.location = Rt_rest["Hips"].inverted() @ dw
                p.keyframe_insert("location", frame=f)
        # проверка: направление кости цели против источника (после G) — должно совпадать по дельте
        if f in (f0 + (f1 - f0) // 3, f0 + 2 * (f1 - f0) // 3):
            bpy.context.view_layer.update()
            for tn in ("LeftArm", "LeftForeArm", "RightArm", "LeftUpLeg", "LeftLeg", "RightLeg", "Spine1", "Head"):
                sn = MAP.get(tn)
                if not sn:
                    continue
                ds = (SW @ spb[sn].tail - SW @ spb[sn].head)
                ds_rest = (SW @ src.data.bones[sn].tail_local - SW @ src.data.bones[sn].head_local)
                dt = (tgt.matrix_world @ tpb[tn].tail - tgt.matrix_world @ tpb[tn].head)
                dt_rest = (tgt.matrix_world @ tgt.data.bones[tn].tail_local - tgt.matrix_world @ tgt.data.bones[tn].head_local)
                dsg = G @ ds
                if dsg.length and dt.length:
                    err_max = max(err_max, math.degrees(dsg.angle(dt)))
    tgt.animation_data.action = None
    for o in new_objs:
        bpy.data.objects.remove(o, do_unlink=True)
    for a in list(bpy.data.actions):
        if a not in before_act and a is not act:
            bpy.data.actions.remove(a)
    report[clip] = {"frames": (f0, f1), "mapped": len(MAP), "yaw_fix_deg": round(math.degrees(ang), 1), "swing_err_max_deg": round(err_max, 1)}

for fname, clip in CLIPS.items():
    path = f"/Users/zep/ASSETS/ANIMATION/{fname}.fbx"
    if not os.path.exists(path):
        report[clip] = "нет файла"
        continue
    retarget(path, clip)

# Кисть: каждый палец сгибается к ладони (ось — поперёк пальца и нормали ладони; знак — кончик вниз).
# RELAX — спокойная кисть во всех клипах, FIST — кулак. Клип Fist: кадр 1 = RELAX, кадр 12 = кулак.
PALM = Vector((0, 0, -1))
# пальцы сетки сросшиеся и низкополигональные: кулак «мягкий» (сильнее — сетка мнётся)
FLEX = {"Thumb": (0.4, 0.5, 0.4), "Index": (1.25, 1.1, 0.7), "Middle": (1.25, 1.1, 0.7), "Ring": (1.25, 1.1, 0.7), "Pinky": (1.25, 1.1, 0.7)}
RELAX = {"Thumb": 0.3, "Index": 0.22, "Middle": 0.28, "Ring": 0.34, "Pinky": 0.4}
hand_rot = {}  # кость → (локальная ось, угол кулака, доля покоя)
for side in ("Left", "Right"):
    for fing, angs in FLEX.items():
        names = [f"{side}_{fing}{i}" for i in (1, 2, 3) if f"{side}_{fing}{i}" in tgt_names]
        if not names:
            continue
        b0 = tgt.data.bones[names[0]]
        seg0 = b0.tail_local - b0.head_local
        if fing == "Thumb":
            # большой палец — к середине ладони под средним пальцем
            mid = tgt.data.bones[f"{side}_Middle1"]
            goal = (mid.head_local + mid.tail_local) / 2 + Vector((0, 0, -0.02))
            axis = seg0.cross(goal - b0.head_local).normalized()
            sign = 1.0
        else:
            axis = seg0.cross(PALM).normalized()
            sign = 1.0 if (Quaternion(axis, 1.0) @ seg0).z < seg0.z else -1.0
        for i, nm in enumerate(names):
            la = tgt.data.bones[nm].matrix_local.to_3x3().transposed() @ axis
            hand_rot[nm] = (la, sign * angs[i], RELAX[fing])

def key_hand(frame, t):
    """t = None — спокойная кисть, иначе доля кулака 0..1."""
    for nm, (la, ang, rel) in hand_rot.items():
        p = tgt.pose.bones[nm]
        p.rotation_mode = 'QUATERNION'
        p.rotation_quaternion = Quaternion(la, ang * (rel if t is None else rel + (1 - rel) * t))
        p.keyframe_insert("rotation_quaternion", frame=frame)

for act in list(bpy.data.actions):
    tgt.animation_data.action = act
    f0, f1 = (int(x) for x in act.frame_range)
    key_hand(f0, None); key_hand(f1, None)
fist = bpy.data.actions.new("Fist")
fist.use_fake_user = True
tgt.animation_data.action = fist
key_hand(1, 0.0); key_hand(12, 1.0)
tgt.animation_data.action = None
for p in tgt.pose.bones:
    p.rotation_quaternion = (1, 0, 0, 0); p.location = (0, 0, 0)

# Проверка стоп в Idle: самая низкая вершина меша по кадрам
tgt.animation_data.action = bpy.data.actions["Idle"]
lows = []
for f in (1, 40, 80, 120, 160):
    bpy.context.scene.frame_set(f)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    me = ev.to_mesh()
    lows.append(round(min((ev.matrix_world @ v.co).z for v in me.vertices), 3))
    ev.to_mesh_clear()
report["idle_mesh_min_z"] = lows
tgt.animation_data.action = None
bpy.context.scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
print("REPORT", report)
