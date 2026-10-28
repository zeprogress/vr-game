import bpy, sys, re
from mathutils import Vector
OUT = "/Users/zep/VR GAME/public/models/chars"
bpy.ops.wm.open_mainfile(filepath="/Users/zep/ASSETS/3D/human/Human50k_game_anim.blend")
arm = bpy.data.objects["HumanRig"]
body = [o for o in bpy.data.objects if o.type == 'MESH'][0]
for a in bpy.data.actions: a.use_fake_user = True
BONES = {
 "Hips": "Hips", "Spine": "Abdomen", "Spine1": "Torso", "Spine2": "Chest", "Neck": "Neck", "Head": "Head",
 "LeftShoulder": "Shoulder.L", "LeftArm": "UpperArm.L", "LeftForeArm": "LowerArm.L", "LeftHand": "Fist.L",
 "RightShoulder": "Shoulder.R", "RightArm": "UpperArm.R", "RightForeArm": "LowerArm.R", "RightHand": "Fist.R",
 "LeftUpLeg": "UpperLeg.L", "LeftLeg": "LowerLeg.L", "LeftFoot": "Foot.L", "LeftToe": "Toe.L",
 "RightUpLeg": "UpperLeg.R", "RightLeg": "LowerLeg.R", "RightFoot": "Foot.R", "RightToe": "Toe.R",
}
# 1) fcurves: пути поз по старым именам -> новые
def fcs(a):
    if hasattr(a, "fcurves") and len(a.fcurves): return list(a.fcurves)
    out = []
    for L in a.layers:
        for s in L.strips:
            for cb in s.channelbags: out += list(cb.fcurves)
    return out
def fix_path(p):
    m = re.match(r'pose\.bones\["([^"]+)"\](.*)', p)
    if not m: return p
    return f'pose.bones["{BONES.get(m.group(1), m.group(1))}"]{m.group(2)}'
for a in bpy.data.actions:
    for fc in fcs(a):
        fc.data_path = fix_path(fc.data_path)
# 2) сами кости
for b in arm.data.bones:
    if b.name in BONES: b.name = BONES[b.name]
# 3) Bone (корень) и Body (корпус) — как в скелете героя; Hips — ребёнок Body
bpy.ops.object.select_all(action='DESELECT'); arm.select_set(True); bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = arm.data.edit_bones
hips = eb["Hips"]
hh = hips.head.copy()
bone = eb.new("Bone"); bone.head = (0, 0, 0); bone.tail = (0, 0, 0.05)
bod = eb.new("Body"); bod.head = hh.copy(); bod.tail = hh + Vector((0, 0, 0.05)); bod.parent = bone
hips.parent = bod
# PoleTarget.L/R — цели IK ног (как в скелете героя), от стоп вперёд
for side in ("L", "R"):
    ft = eb[f"Foot.{side}"]
    pt = eb.new(f"PoleTarget.{side}")
    pt.head = ft.head + Vector((0, 0.25, 0.0))
    pt.tail = pt.head + Vector((0, 0.04, 0.0))
    pt.parent = bone
bpy.ops.object.mode_set(mode='OBJECT')
# Сдвиг таза — на Body, как в скелете героя (игра держит высоту корпуса через Body: bodySplit.dampRunBounce),
# у Hips сдвига нет. Горизонтальный дрейф (Mixamo бежит/идёт вперёд) убираем: иначе на каждом повторе клипа
# герой прыгает назад. Death не трогаем — падение назад доигрывается и застывает.
KEEP_DRIFT = {"Death"}
Rh = arm.data.bones["Hips"].matrix_local.to_3x3()
Rb = arm.data.bones["Body"].matrix_local.to_3x3()
stats = {}
for a in bpy.data.actions:
    arm.animation_data_create()
    arm.animation_data.action = a
    f0, f1 = int(a.frame_range[0]), int(a.frame_range[1])
    curves = {fc.array_index: fc for fc in fcs(a) if fc.data_path == 'pose.bones["Hips"].location'}
    pb_h = arm.pose.bones["Hips"]
    pb_b = arm.pose.bones["Body"]
    if curves:
        frames = list(range(f0, f1 + 1))
        W = [Rh @ Vector([curves[i].evaluate(f) if i in curves else 0.0 for i in range(3)]) for f in frames]
        if a.name not in KEEP_DRIFT:
            d0, d1 = W[0].copy(), W[-1].copy()
            n = max(1, len(frames) - 1)
            for k, w in enumerate(W):
                t = k / n
                w.x -= d0.x + (d1.x - d0.x) * t
                w.y -= d0.y + (d1.y - d0.y) * t
        zs = [w.z for w in W]
        stats[a.name] = {"drift_xy": round((Vector((W[-1].x, W[-1].y)) - Vector((W[0].x, W[0].y))).length, 3),
                         "z_min": round(min(zs), 3), "z_max": round(max(zs), 3), "z_mean": round(sum(zs) / len(zs), 3)}
        for fc in list(curves.values()):
            for L in a.layers:
                for s in L.strips:
                    for cb in s.channelbags:
                        if fc in list(cb.fcurves):
                            cb.fcurves.remove(fc)
        pb_h.location = (0, 0, 0)
        for f, w in zip(frames, W):
            pb_b.location = Rb.transposed() @ w
            pb_b.keyframe_insert("location", frame=f)
    else:
        for fr in (f0, f1):
            pb_b.location = (0, 0, 0)
            pb_b.keyframe_insert("location", frame=fr)
    for fr in (f0, f1):
        for nm in ("Body", "PoleTarget.L", "PoleTarget.R"):
            pb = arm.pose.bones[nm]
            if nm != "Body":
                pb.location = (0, 0, 0)
                pb.keyframe_insert("location", frame=fr)
            pb.rotation_mode = 'QUATERNION'
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.keyframe_insert("rotation_quaternion", frame=fr)
            pb.scale = (1, 1, 1)
            pb.keyframe_insert("scale", frame=fr)
    a.use_fake_user = True
print("HIPS", stats)

# Темп клипов. Окна действий в игре (удар, урон, подбор, кувырок…) рассчитаны на длительности клипов рыцаря —
# тянем клипы к ним. Шаг и бег — по скорости стопы на земле: игра ведёт темп ног от HERO_STRIDE (м/с при масштабе
# 0.52), у Человека масштаб 0.52 × 5.54, значит стопа в клипе должна ехать HERO_STRIDE / 2.88 м/с модели.
scn = bpy.context.scene
FPS = scn.render.fps / scn.render.fps_base
KNIGHT_SEC = {"SwordSlash": 1.04, "RecieveHit": 0.62, "PickUp": 1.25, "Roll": 0.92, "Jump": 1.04, "Death": 2.29,
              "Victory": 1.88, "OutwardSlash": 1.04}
GAME_SCALE = 0.52 * 5.54
# Бег — чаще шаг, чем по чистому расчёту стопы (просьба 28.10: «немного ускорить перебирание ног при беге»).
RUN_CADENCE = 1.25
STRIDE = {"Walk": 1.14 / GAME_SCALE, "Run": 2.27 / GAME_SCALE * RUN_CADENCE}

def foot_speed(a):
    arm.animation_data.action = a
    f0, f1 = int(a.frame_range[0]), int(a.frame_range[1])
    sp = []
    for side in ("L", "R"):
        pts = []
        for f in range(f0, f1 + 1):
            scn.frame_set(f)
            pts.append(arm.pose.bones[f"Foot.{side}"].head.copy())
        zmin = min(p.z for p in pts)
        for i in range(1, len(pts)):
            if pts[i].z < zmin + 0.012 and pts[i - 1].z < zmin + 0.012:
                d = pts[i] - pts[i - 1]
                sp.append(Vector((d.x, d.y)).length * FPS)
    sp.sort()
    return sp[len(sp) // 2] if sp else 0.0

def retime(a, k):
    f0 = a.frame_range[0]
    for fc in fcs(a):
        for kp in fc.keyframe_points:
            kp.co.x = f0 + (kp.co.x - f0) * k
            kp.handle_left.x = f0 + (kp.handle_left.x - f0) * k
            kp.handle_right.x = f0 + (kp.handle_right.x - f0) * k
        fc.update()
    a.frame_range = (f0, f0 + (a.frame_range[1] - f0) * k)

tempo = {}
for a in bpy.data.actions:
    dur = (a.frame_range[1] - a.frame_range[0]) / FPS
    if a.name in KNIGHT_SEC:
        k = KNIGHT_SEC[a.name] / dur
    elif a.name in STRIDE:
        v = foot_speed(a)
        k = v / STRIDE[a.name] if v > 1e-4 else 1.0
        tempo[a.name + "_foot"] = round(v, 3)
    else:
        continue
    a.use_frame_range = True
    retime(a, k)
    tempo[a.name] = f"{dur:.2f}→{(a.frame_range[1] - a.frame_range[0]) / FPS:.2f} c"
arm.animation_data.action = None
print("TEMPO", tempo)
# 4) имена клипов под игру
RENAME = {"Standing Idle": "Idle", "walk": "Walk", "Running": "Run", "Sword Slash": "SwordSlash", "RecieveHit": "RecieveHit",
          "PickUp": "PickUp", "Jumping": "Jump", "Roll": "Roll", "Dying": "Death", "Defeat (1)": "Defeat2",
          "Defeat": "Defeat", "Victory": "Victory", "Stable Sword Outward Slash ANIMATION": "OutwardSlash", "Fist": "Fist"}
for a in bpy.data.actions:
    if a.name in RENAME: a.name = RENAME[a.name]
print("ACTIONS", sorted(a.name for a in bpy.data.actions))
print("BONES", sorted(b.name for b in arm.data.bones)[:60])
# 5) текстуры 1024
for im in bpy.data.images:
    w, h = im.size
    if max(w, h) > 1024:
        f = 1024 / max(w, h); im.scale(int(w * f), int(h * f))
# 6) экспорт
arm.parent = None
body.parent = None
for o in (arm, body):
    o.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(filepath=f"{OUT}/Human_Male.glb", export_format='GLB', use_selection=True, export_animations=True, export_skins=True)


def strip_specular(path):
    """Убрать KHR_materials_specular: экспортёр пишет specularColorFactor 2 (из Specular Tint), а Babylon и Unity
    читают его как удвоенное отражение — модель «светилась». Без расширения — обычный PBR metallic/roughness."""
    import json
    import struct
    b = open(path, "rb").read()
    jlen = struct.unpack("<I", b[12:16])[0]
    js = json.loads(b[20:20 + jlen])
    for m in js.get("materials", []):
        ext = m.get("extensions", {})
        ext.pop("KHR_materials_specular", None)
        if not ext:
            m.pop("extensions", None)
    for key in ("extensionsUsed", "extensionsRequired"):
        if key in js:
            js[key] = [e for e in js[key] if e != "KHR_materials_specular"]
            if not js[key]:
                js.pop(key)
    jb = json.dumps(js, separators=(",", ":")).encode()
    jb += b" " * ((4 - len(jb) % 4) % 4)
    rest = b[20 + jlen:]
    total = 12 + 8 + len(jb) + len(rest)
    out = b[:8] + struct.pack("<I", total) + struct.pack("<I", len(jb)) + b"JSON" + jb + rest
    open(path, "wb").write(out)


strip_specular(f"{OUT}/Human_Male.glb")
print("EXPORTED")
