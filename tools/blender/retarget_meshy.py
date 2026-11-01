"""
Клипы из Meshy (mixamorig-риг) → клипы игры. Заменяет существующие анимации:
Walking → Walk, Running → Run, Attack → AtkHammer1, Skill_03 → SkWhirlwind.

Как переносим: для каждой кости считаем ПОВОРОТ ОТНОСИТЕЛЬНО РОДИТЕЛЯ (мировые матрицы →
относительные), берём разницу «поза минус rest» у источника и накладываем её на rest игры.
Такая формула не зависит от того, как ориентированы кости в rest у двух ригов.

Запуск:
  Blender -b --factory-startup -P tools/blender/retarget_meshy.py -- <game.glb> <meshy.fbx> <out.glb>
"""
import math
import sys
import bpy
from mathutils import Quaternion, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
GAME, MESHY, OUT = argv[0], argv[1], argv[2]


def log(m):
    print(f"[rt] {m}", flush=True)


# соответствие костей Meshy/Mixamo → кости игры (после снятия префикса mixamorig:)
MAP = {
    "Hips": "Hips", "Spine": "Abdomen", "Spine1": "Torso", "Spine2": "Chest",
    "Neck": "Neck", "Head": "Head",
    "LeftShoulder": "Shoulder.L", "LeftArm": "UpperArm.L", "LeftForeArm": "LowerArm.L", "LeftHand": "Fist.L",
    "RightShoulder": "Shoulder.R", "RightArm": "UpperArm.R", "RightForeArm": "LowerArm.R", "RightHand": "Fist.R",
    "LeftUpLeg": "UpperLeg.L", "LeftLeg": "LowerLeg.L", "LeftFoot": "Foot.L", "LeftToeBase": "Toe.L",
    "RightUpLeg": "UpperLeg.R", "RightLeg": "LowerLeg.R", "RightFoot": "Foot.R", "RightToeBase": "Toe.R",
}
# пальцы: 4 фаланги у Meshy → 3 кости у игры
for side in ("Left", "Right"):
    s = "L" if side == "Left" else "R"
    for finger, game in (("Thumb", "Thumb"), ("Index", "Index"), ("Middle", "Middle"), ("Ring", "Ring"), ("Pinky", "Pinky")):
        for k in (1, 2, 3):
            MAP[f"{side}Hand{finger}{k}"] = f"{side}_{game}{k}"

CLIPS = [
    ("SmartRigArmature|Walking", "Walk"),
    ("SmartRigArmature|Running", "Run"),
    ("SmartRigArmature|Attack", "AtkHammer1"),
    ("SmartRigArmature|Skill_03", "SkWhirlwind"),
]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.fps = 30

bpy.ops.import_scene.gltf(filepath=GAME)
game = next(o for o in bpy.data.objects if o.type == "ARMATURE")
game.name = "GameRig"
game.data.pose_position = "POSE"
log(f"игра: костей {len(game.data.bones)}")

bpy.ops.import_scene.fbx(filepath=MESHY, automatic_bone_orientation=True)
# ВАЖНО: берём именно НОВУЮ арматуру — next() по списку объектов вернул бы игровую.
src = next(o for o in bpy.data.objects if o.type == "ARMATURE" and o is not game)
log(f"meshy: костей {len(src.data.bones)}, клипов {len(bpy.data.actions)}")
for o in list(bpy.data.objects):
    if o.type == "MESH" and o.parent is src:
        bpy.data.objects.remove(o, do_unlink=True)

GW, SW = game.matrix_world, src.matrix_world


def rel_rot(arm, pb):
    """Поворот кости относительно родителя в мировых осях."""
    q_bone = (arm.matrix_world @ pb.matrix).to_quaternion()
    if pb.parent:
        q_par = (arm.matrix_world @ pb.parent.matrix).to_quaternion()
        return q_par.inverted() @ q_bone
    return q_bone


def rel_rest(arm, b):
    q_bone = (arm.matrix_world @ b.matrix_local).to_quaternion()
    if b.parent:
        q_par = (arm.matrix_world @ b.parent.matrix_local).to_quaternion()
        return q_par.inverted() @ q_bone
    return q_bone


pairs = []
for sname, gname in MAP.items():
    sb = src.data.bones.get(sname) or src.data.bones.get("mixamorig:" + sname)
    gb = game.data.bones.get(gname)
    if sb and gb:
        pairs.append((sb.name, gb.name))
log(f"сопоставлено костей: {len(pairs)} из {len(MAP)}")
missing = [g for s, g in MAP.items()
           if not (src.data.bones.get(s) or src.data.bones.get("mixamorig:" + s)) or not game.data.bones.get(g)]
if missing:
    log(f"не нашлись: {missing[:8]}")

# Глобальная поправка осей: FBX-риг Meshy живёт в Y-up, игровой — в Z-up.
# REST-ориентации таза дают поворот между пространствами; на него умножаем все позы.
_gh = next(gb for sbn, gb in pairs if gb == "Hips")
_sh = next(sbn for sbn, gb in pairs if gb == "Hips")
from mathutils import Vector as _V
_Y = _V((0.0, 1.0, 0.0))


def _ydir(arm, bname, rest=True):
    if rest:
        q = (arm.matrix_world @ arm.data.bones[bname].matrix_local).to_quaternion()
    else:
        q = (arm.matrix_world @ arm.pose.bones[bname].matrix).to_quaternion()
    return (q @ _Y).normalized()


# Разница пространств у ригов разная не «на 90° целиком», а по-разному для каждой кости
# (у FBX своя ось кости, у игрового рига — своя). Поэтому поправку берём ПО КОСТИ:
# минимальный поворот, переводящий rest-направление кости источника в rest-направление игры.

def _quat(arm, bname):
    return (arm.matrix_world @ arm.data.bones[bname].matrix_local).to_quaternion()


# Кадр переноса для каждой кости:
#   1) берём rest-ориентацию кости игры (Qt) и доворачиваем её так, чтобы её направление
#      совпало с направлением rest-кости источника — получаем «игровую кость, но в позе
#      Meshy». Это ключ: у Meshy A-pose, у нас T-pose, и клип задаёт лишь отклонение от
#      СВОЕГО rest, поэтому руки иначе остаются в T;
#   2) дальше на этот кадр накладываем отклонение источника от его rest (живая анимация).
_Yv = _V((0.0, 1.0, 0.0))
FRAME = {}
for sbn, gbn in pairs:
    qs0, qt0 = _quat(src, sbn), _quat(game, gbn)
    o = (qt0 @ _Yv).normalized().rotation_difference((qs0 @ _Yv).normalized())
    FRAME[gbn] = o @ qt0
log(f"кадры переноса посчитаны для {len(FRAME)} костей")

R_rest = {gb: rel_rest(game, game.data.bones[gb]) for _, gb in pairs}
R_rest_world = {gb: (GW.to_quaternion() @ game.data.bones[gb].matrix_local.to_quaternion()) for _, gb in pairs}

# убираем старые клипы, которые заменяем
for _, gname in CLIPS:
    old = bpy.data.actions.get(gname)
    if old:
        old.use_fake_user = False
        bpy.data.actions.remove(old)
        log(f"удалён старый клип: {gname}")

src.animation_data_create()
ad_game = game.animation_data or game.animation_data_create()
for gp in game.pose.bones:
    gp.rotation_mode = "QUATERNION"

for src_name, gname in CLIPS:
    act = bpy.data.actions.get(src_name)
    if not act:
        # имя могло отличаться (Blender добавляет суффиксы) — ищем по подстроке
        cand = [a for a in bpy.data.actions if src_name.split("|")[-1] in a.name]
        act = cand[0] if cand else None
    if not act:
        log(f"НЕТ клипа {src_name} — пропускаю")
        continue
    src.animation_data.action = act
    if hasattr(src.animation_data, "action_slot") and act.slots:
        src.animation_data.action_slot = act.slots[0]
    f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])

    new = bpy.data.actions.new(gname)
    new.use_fake_user = True
    ad_game.action = new
    if hasattr(ad_game, "action_slot") and new.slots:
        ad_game.action_slot = new.slots[0]

    # порядок костей: родители раньше детей — чтобы считать мировые повороты за один проход
    order = []
    def walk(b):
        order.append(b.name)
        for c in b.children:
            walk(c)
    for b in game.data.bones:
        if b.parent is None:
            walk(b)

    for f in range(f0, f1 + 1):
        bpy.context.scene.frame_set(f)
        bpy.context.view_layer.update()
        # мировые повороты источника в этой позе
        src_world = {sbn: (SW @ src.pose.bones[sbn].matrix).to_quaternion() for sbn, _ in pairs}
        src_rest = {sbn: (SW @ src.data.bones[sbn].matrix_local).to_quaternion() for sbn, _ in pairs}
        pair_of = {gbn: sbn for sbn, gbn in pairs}
        # считаем желаемые мировые повороты целей сверху вниз
        tgt_world = {}
        for bn in order:
            sbn = pair_of.get(bn)
            if sbn is None:
                continue
            # Копируем МИРОВУЮ ориентацию кости. Меш деформируется на разницу
            # «поза минус rest своей модели», поэтому у нас автоматически получается
            # правильная поза, даже когда rest-позы разные (у Meshy A-pose, у нас T-pose).
            # Поза переносится «как выглядит»: ориентацию источника пересчитываем через
            # разницу rest-поз двух ригов (у Meshy A-pose, у нас T-pose). Иначе руки
            # оставались в T: клип задаёт лишь отклонение от СВОЕГО rest.
            tgt_world[bn] = FRAME[bn] @ (src_rest[sbn].inverted() @ src_world[sbn])
            gb = game.data.bones[bn]
            if gb.parent is None:
                par_w = (GW.to_quaternion() @ gb.matrix_local.to_quaternion())
            else:
                par_w = tgt_world.get(gb.parent.name) or (GW.to_quaternion() @ gb.parent.matrix_local.to_quaternion())
            rel = par_w.inverted() @ tgt_world[bn]
            rest_rel = R_rest[bn]
            game.pose.bones[bn].rotation_quaternion = rest_rel.inverted() @ rel
            game.pose.bones[bn].keyframe_insert("rotation_quaternion", frame=f)
    # сглаживание между кадрами не нужно: ключ на каждый кадр источника
    log(f"{src_name} ({f1 - f0 + 1} кадров) → {gname}")

# чистим источник: клипы Meshy в экспорт попадать не должны
for a in list(bpy.data.actions):
    if "|" in a.name or "SmartRigArmature" in a.name:
        log(f"удаляю клип источника: {a.name}")
        bpy.data.actions.remove(a)
src.animation_data.action = None
bpy.data.objects.remove(src, do_unlink=True)

# экспорт: все клипы игры через NLA-дорожки (иначе не выгружаются)
for ob in (game,):
    ob.hide_set(False)
    ob.hide_viewport = False
game.data.pose_position = "POSE"
ad = game.animation_data or game.animation_data_create()
for t in list(ad.nla_tracks):
    ad.nla_tracks.remove(t)
ad.action = None
for a in bpy.data.actions:
    a.use_fake_user = True
    tr = ad.nla_tracks.new()
    tr.name = a.name
    st = tr.strips.new(a.name, int(a.frame_range[0]), a)
    st.name = a.name
    if a.slots:
        try:
            st.action_slot = a.slots[0]
        except Exception:
            pass
log(f"клипов к экспорту: {len(ad.nla_tracks)}")

bpy.ops.object.select_all(action="DESELECT")
for o in bpy.data.objects:
    o.select_set(True)
bpy.context.view_layer.objects.active = game
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format="GLB", use_selection=True,
    export_animations=True, export_animation_mode="NLA_TRACKS",
    export_skins=True, export_yup=True, export_apply=False, export_force_sampling=True,
)
log(f"готово: {OUT}")
