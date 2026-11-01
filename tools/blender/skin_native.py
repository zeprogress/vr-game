"""
Меш → риг героя с ГОТОВЫМИ весами модели (авторские группы Mixamo), а не переносом/расчётом.
В animate.fbx лежат и меш, и его собственные веса на 22 кости — они лучше любых вычисленных.
Скрипт переименовывает группы под кости игры (Hips, Abdomen, Torso…), раздаёт кисти по пальцам,
приводит меш к T-позе и вешает на риг героя (56 костей, 55 клипов).

Эльф → риг игрового «Человека»: импорт Human_Male.glb (56 костей, 55 клипов) и меша эльфа,
выравнивание эльфа под человека, перенос весов скина (DataTransfer POLYINTERP_NEAREST),
привязка к арматуре человека, экспорт GLB с теми же костями и клипами.

Запуск:
  Blender -b --factory-startup -P tools/blender/transfer_rig.py -- \
      <human.glb> <elf.fbx|glb> <out.glb> [--skirt hips|legs] [--blend out.blend] [--tex 2048]

--skirt hips (по умолчанию): длинный плащ жёстко за тазом (бёдрами) — не рвётся и не протыкается ногами.
--skirt legs: плащ распределяется по ногам - движется с шагом, но может растягиваться.

Как переносим веса:
  Меш человека в T-pose служит «источником» весов. У эльфа руки опущены (A-pose), поэтому перед
  переносом эльф ставится в T-pose процедурно: вершины рук поворачиваются вокруг плеча до
  горизонтали. Так ближайшие точки источника и цели ложатся на одни и те же участки тела.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
import mathutils  # noqa: E402
from mathutils import Vector  # noqa: E402
import math  # noqa: E402

import zep_lib as z  # noqa: E402

a = z.args()
human_path, elf_path, out = a[0], a[1], a[2]
blend_out = z.opt(a, "--blend")
skirt_mode = z.opt(a, "--skirt", "none")
tex_px = int(z.opt(a, "--tex", "2048"))


def log(msg):
    print(f"[transfer] {msg}", flush=True)


# ---------------------------------------------------------------- импорт человека (риг + клипы)
z.clear_scene()
bpy.ops.import_scene.gltf(filepath=human_path)
human_arms = z.armatures()
human_meshes = z.meshes()
if not human_arms or not human_meshes:
    raise SystemExit("в Human_Male.glb не нашлись арматура/меш")
arm = human_arms[0]
src_mesh = human_meshes[0]
log(f"человек: арматура «{arm.name}», костей {len(arm.data.bones)}, клипов {len(bpy.data.actions)}, меш «{src_mesh.name}» {z.tri_count(src_mesh)} треуг.")
log(f"  группы вершин: {len(src_mesh.vertex_groups)}")

# запомним клипы: у glTF-импорта каждая анимация — action; они уже навязаны через NLA/stash.
actions_before = {ac.name for ac in bpy.data.actions}

# Габариты человека в позе покоя (источник правды для масштаба эльфа).
bpy.context.view_layer.objects.active = arm
arm.data.pose_position = "REST"
bpy.context.view_layer.update()
h_lo, h_hi = z.world_bbox()
h_height = h_hi[2] - h_lo[2]
src_height = h_height
log(f"человек в rest: рост {h_height:.3f} м, стопы z={h_lo[2]:.3f}")
arm.data.pose_position = "POSE"
bpy.context.view_layer.update()

# ---------------------------------------------------------------- импорт эльфа
bpy.ops.import_scene.gltf(filepath=elf_path) if elf_path.lower().endswith((".glb", ".gltf")) \
    else bpy.ops.import_scene.fbx(filepath=elf_path, automatic_bone_orientation=True)
elf_all = [o for o in bpy.context.scene.objects if o.type == "MESH" and o not in human_meshes]
# ФБХ-импорт притаскивает мусор: служебный Cube (8 вершин), камеру и свет. Берём только
# «настоящие» меши — крупнейший по числу полигонов (модель), отбрасывая коробки-заглушки.
elf_meshes = [o for o in elf_all if o not in z.bone_shapes() and len(o.data.polygons) >= 100]
if not elf_meshes:
    raise SystemExit("меш эльфа не найден")
elf_parts = [max(elf_meshes, key=lambda o: len(o.data.polygons))]
# Убрать камеры/свет и мусорные меши из сцены, чтобы не попали в экспорт.
for o in list(bpy.context.scene.objects):
    if o in elf_all and o not in elf_parts:
        bpy.data.objects.remove(o, do_unlink=True)
    elif o.type in {"CAMERA", "LIGHT"}:
        bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.select_all(action="DESELECT")
for o in elf_parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = elf_parts[0]
if len(elf_parts) > 1:
    bpy.ops.object.join()
elf = bpy.context.view_layer.objects.active
elf.name = "ELF"
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
log(f"эльф: «{elf.name}», {z.tri_count(elf)} треуг., вершин {len(elf.data.vertices)}")

# ---------------------------------------------------------------- выравнивание эльфа под человека
def bbox(obj):
    xs = [v.co.x for v in obj.data.vertices]
    ys = [v.co.y for v in obj.data.vertices]
    zs = [v.co.z for v in obj.data.vertices]
    return (min(xs), max(xs)), (min(ys), max(ys)), (min(zs), max(zs))

(x0, x1), (y0, y1), (z0, z1) = bbox(elf)
log(f"эльф до выравнивания: X[{x0:.3f},{x1:.3f}] Y[{y0:.3f},{y1:.3f}] Z[{z0:.3f},{z1:.3f}]")

# Оси: Blender-импорт FBX/glTF кладёт модель в конвенцию Blender (вверх +Z), экспорт
# в glTF сам сделает Y-up. Длинная ось габарита = рост. Если это не Z — поворачиваем,
# чтобы рост стоял вдоль Z (иначе авто-веса лягут на «лежащую» фигуру).
dims = [(x1 - x0, 0), (y1 - y0, 1), (z1 - z0, 2)]
up_axis = max(dims, key=lambda t: t[0])[1]
log(f"длинная ось (рост) — {'XYZ'[up_axis]}")
if up_axis == 1:      # рост вдоль Y → поднимаем в Z
    elf.rotation_euler = (math.radians(90), 0, 0)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
elif up_axis == 0:    # рост вдоль X
    elf.rotation_euler = (0, math.radians(90), 0)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

(x0, x1), (y0, y1), (z0, z1) = bbox(elf)
elf_height = z1 - z0
log(f"эльф после поворота: рост {elf_height:.3f}, стопы z={z0:.3f}")

# Масштаб: под рост человека (используем тот же масштаб, что у рига — 1.0).
scale_k = src_height / elf_height
elf.scale = (scale_k, scale_k, scale_k)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
# Стопы на пол.
(x0, x1), (y0, y1), (z0, z1) = bbox(elf)
elf.location.z -= z0
bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
# Центр по X и Y — на ноль (как у человека).
(x0, x1), (y0, y1), (z0, z1) = bbox(elf)
elf.location.x -= (x0 + x1) / 2
elf.location.y -= (y0 + y1) / 2
bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
(x0, x1), (y0, y1), (z0, z1) = bbox(elf)
log(f"эльф итог: рост {z1 - z0:.3f} м, X[{x0:.3f},{x1:.3f}] Y[{y0:.3f},{y1:.3f}]")

# ---------------------------------------------------------------- T-поза (руки в стороны)
# Эльф нарисован в A-pose, риг игры — в T-pose. Меш приводится к T-позе геометрически:
# вершина считается «рукой», если ближайшая к ней КОСТЬ — из цепочки руки (а не торс/голова).
# Тогда поворот идёт строго по анатомии: рука поднимается целиком, торс и голова не задеты.
# Кости берём в их rest-позиции (у рига человека это T-pose) — важны только линии сегментов.


def elf_arm_angle(obj, shoulder):
    """Наклон руки эльфа от горизонтали (рад): 0 — как в T-pose."""
    vs = [v.co.copy() for v in obj.data.vertices]
    zmin = min(v.z for v in vs); zmax = max(v.z for v in vs); H = zmax - zmin
    left = [v for v in vs if v.x > 0.05 * H]
    if not left:
        return 0.0
    hand = sorted(left, key=lambda v: -v.x)[: max(3, len(left) // 25)]
    hx = sum(v.x for v in hand) / len(hand); hz = sum(v.z for v in hand) / len(hand)
    v = Vector((hx - shoulder.x, 0, hz - shoulder.z))
    if v.length < 1e-6:
        return 0.0
    return math.atan2(-v.z, v.x)


def seg_dist(p, a, b):
    ab = b - a
    t = 0.0 if ab.length_squared < 1e-12 else max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


def bone_segment(arm, name):
    b = arm.data.bones.get(name)
    if not b:
        return None
    mw = arm.matrix_world
    return (mw @ b.head_local, mw @ b.tail_local)


def to_t_pose(obj, arm, angle):
    if abs(math.degrees(angle)) < 2:
        return 0

    def arm_segments(side):
        """Сегменты костей руки, повёрнутые в A-pose (как висит меш): иначе висящее
        предплечье ближе к бедру, чем к горизонтальной кости, и остаётся не повёрнутым."""
        segs = []
        pv = bone_segment(arm, "UpperArm." + side)
        if not pv:
            return segs, None
        pivot = pv[0]
        ang = (-angle if side == "L" else angle)
        c, sn = math.cos(ang), math.sin(ang)

        def rot(p):
            d = Vector((p.x - pivot.x, 0.0, p.z - pivot.z))
            return Vector((pivot.x + d.x * c - d.z * sn, p.y, pivot.z + d.x * sn + d.z * c))

        for n in ("Shoulder." + side, "UpperArm." + side, "LowerArm." + side, "Fist." + side):
            sg = bone_segment(arm, n)
            if sg:
                segs.append((rot(sg[0]), rot(sg[1])))
        return segs, pivot

    body_chain = [n for n in ("Hips", "Spine", "Chest", "Neck", "Head",
                              "UpperLeg.L", "LowerLeg.L", "Foot.L",
                              "UpperLeg.R", "LowerLeg.R", "Foot.R") if bone_segment(arm, n)]
    body_segs = [bone_segment(arm, n) for n in body_chain]
    seg = {s: arm_segments(s)[0] for s in ("L", "R")}
    pivot = {s: arm_segments(s)[1] for s in ("L", "R")}

    # Кто «рука» — берём из авторских весов модели, а не по расстоянию: у женской модели
    # широкие полы плаща геометрически ближе к костям рук, и эвристика задирала их вверх.
    gidx = {g.name: g.index for g in obj.vertex_groups}
    arm_w = {
        "L": [gidx[n] for n in ("LeftArm", "LeftForeArm", "LeftHand", "LeftShoulder") if n in gidx],
        "R": [gidx[n] for n in ("RightArm", "RightForeArm", "RightHand", "RightShoulder") if n in gidx],
    }
    use_groups = bool(arm_w["L"] and arm_w["R"])

    moved = 0
    for v in obj.data.vertices:
        co = v.co
        if use_groups:
            w = {"L": 0.0, "R": 0.0}
            for g in v.groups:
                if g.group in arm_w["L"]:
                    w["L"] += g.weight
                elif g.group in arm_w["R"]:
                    w["R"] += g.weight
            side = "L" if w["L"] >= w["R"] else "R"
            if w[side] < 0.35 or pivot[side] is None:
                continue  # вершина не принадлежит руке
        else:
            d_arm = {s: min((seg_dist(co, a, b) for a, b in seg[s]), default=9.9) for s in ("L", "R")}
            d_body = min((seg_dist(co, a, b) for a, b in body_segs), default=9.9)
            side = "L" if d_arm["L"] <= d_arm["R"] else "R"
            if d_arm[side] >= d_body or pivot[side] is None:
                continue  # ближе к торсу — это не рука
        sgn = 1 if side == "L" else -1
        pv = pivot[side]
        p = Vector((co.x - pv.x, 0.0, co.z - pv.z))
        ang = (angle if sgn > 0 else -angle)
        c, sn = math.cos(ang), math.sin(ang)
        nx = p.x * c - p.z * sn
        nz = p.x * sn + p.z * c
        v.co = Vector((pv.x + nx, co.y, pv.z + nz))
        moved += 1
    return moved


_sh = bone_segment(arm, "UpperArm.L")
a_angle = elf_arm_angle(elf, _sh[0] if _sh else Vector((0.126, 0.0, 0.874)))
log(f"наклон руки эльфа от горизонтали: {math.degrees(a_angle):.1f}°")
moved = to_t_pose(elf, arm, a_angle)
(x0, x1), (y0, y1), (z0, z1) = bbox(elf)
log(f"T-поза: повернуто {moved} вершин, ширина рук X[{x0:.3f},{x1:.3f}], рост {z1 - z0:.3f}")

# ---------------------------------------------------------------- упрощение и текстуры
tris_before = z.tri_count(elf)
bpy.context.view_layer.objects.active = elf
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.remove_doubles(threshold=1e-5)
bpy.ops.object.mode_set(mode="OBJECT")
for img in bpy.data.images:
    if img.size[0] > tex_px or img.size[1] > tex_px:
        img.scale(tex_px, tex_px)

# ---------------------------------------------------------------- трансформ и рост
# FBX приходит с масштабом объекта 0.01 (сантиметры): вершины в см, кости в метрах.
# Запекаем трансформ в вершины вручную (bpy.ops.transform_apply тут молча не срабатывает)
# и выравниваем рост по человеку — иначе веса уходят не туда и модель уезжает.
from mathutils import Matrix
elf.parent = None
_mw = elf.matrix_world.copy()
for _v in elf.data.vertices:
    _v.co = _mw @ _v.co
elf.matrix_world = Matrix.Identity(4)
elf.data.update()
_zs = [v.co.z for v in elf.data.vertices]
_h = max(_zs) - min(_zs)
_k = src_height / _h if _h > 1e-6 else 1.0
if abs(_k - 1.0) > 1e-4:
    for _v in elf.data.vertices:
        _v.co *= _k
    elf.data.update()
    log(f"трансформ запечён, рост выровнен ×{_k:.3f}")
bpy.context.view_layer.update()

# ---------------------------------------------------------------- снять привязку к родному ригу
# У FBX меш уже висит на СВОЁМ скелете (модификатор Armature). Если оставить его и добавить
# второй модификатор на игровой риг, деформация применяется дважды — меш «взрывается».
for o in list(bpy.data.objects):
    if o.type == "ARMATURE" and o is not arm:
        log(f"удаляю родную арматуру: {o.name}")
        bpy.data.objects.remove(o, do_unlink=True)
elf.parent = None
for m in list(elf.modifiers):
    if m.type == "ARMATURE":
        elf.modifiers.remove(m)

# ---------------------------------------------------------------- веса: авторские, с картой имён
# Соответствие костей Mixamo → кости рига игры (shared/классы: Hips, Abdomen, Torso, Chest…).
MAP = {
    "Hips": "Hips", "Spine": "Abdomen", "Spine1": "Torso", "Spine2": "Chest",
    "Neck": "Neck", "Head": "Head",
    "LeftShoulder": "Shoulder.L", "LeftArm": "UpperArm.L", "LeftForeArm": "LowerArm.L", "LeftHand": "Fist.L",
    "RightShoulder": "Shoulder.R", "RightArm": "UpperArm.R", "RightForeArm": "LowerArm.R", "RightHand": "Fist.R",
    "LeftUpLeg": "UpperLeg.L", "LeftLeg": "LowerLeg.L", "LeftFoot": "Foot.L", "LeftToeBase": "Toe.L",
    "RightUpLeg": "UpperLeg.R", "RightLeg": "LowerLeg.R", "RightFoot": "Foot.R", "RightToeBase": "Toe.R",
}
# Meshy присылает кости с префиксом mixamorig: и по 4 фаланги на палец — срезаем префикс
# и добиваем карту пальцев (у рига игры на палец 3 кости).
for side in ("Left", "Right"):
    for finger in ("Thumb", "Index", "Middle", "Ring", "Pinky"):
        for k in (1, 2, 3):
            MAP[f"{side}Hand{finger}{k}"] = f"{side}_{finger}{k}"

old_groups = {g.name.replace("mixamorig:", ""): g.index for g in elf.vertex_groups}
log(f"авторских групп: {len(old_groups)}; из них с картой: {sum(1 for n in old_groups if n in MAP)}")

# 1) снять веса в память (по индексу вершины)
native = []
name_by_index = {g.index: g.name.replace("mixamorig:", "") for g in elf.vertex_groups}
for v in elf.data.vertices:
    native.append({name_by_index[g.group]: g.weight for g in v.groups if g.group in name_by_index})

# 2) создать группы с именами костей игры
for g in list(elf.vertex_groups):
    elf.vertex_groups.remove(g)
game_groups = {}
for new_name in MAP.values():
    if new_name not in game_groups:
        game_groups[new_name] = elf.vertex_groups.new(name=new_name)

# 3) перенести веса
mapped = 0
for i, w in enumerate(native):
    for old_name, val in w.items():
        new_name = MAP.get(old_name)
        if not new_name or val <= 1e-4:
            continue
        game_groups[new_name].add([i], val, "REPLACE")
        mapped += 1
log(f"перенесено весов: {mapped}")

# 4) Кисти → пальцы: авторские веса знают только кисть (LeftHand), а у рига игры есть пальцы.
#    Раздаём часть веса кисти двум ближайшим пальцевым костям той же руки.
for side, fist in (("L", "Fist.L"), ("R", "Fist.R")):
    fingers = [n for n in (b.name for b in arm.data.bones)
               if (n.startswith("Left_") if side == "L" else n.startswith("Right_"))]
    if not fingers:
        continue
    fist_vg = elf.vertex_groups.get(fist)
    if not fist_vg:
        continue
    fist_ids = [v.index for v in elf.data.vertices
                if any(g.group == fist_vg.index and g.weight > 0.05 for g in v.groups)]
    segs = {}
    for n in fingers:
        b = arm.data.bones[n]
        segs[n] = (arm.matrix_world @ b.head_local, arm.matrix_world @ b.tail_local)

    def dseg(p, a, b):
        ab = b - a
        L2 = ab.length_squared
        t = 0.0 if L2 < 1e-12 else max(0.0, min(1.0, (p - a).dot(ab) / L2))
        return (p - (a + ab * t)).length

    vgs = {n: elf.vertex_groups.get(n) or elf.vertex_groups.new(name=n) for n in fingers}
    for vi in fist_ids:
        p = elf.matrix_world @ elf.data.vertices[vi].co
        near = sorted(((dseg(p, *segs[n]), n) for n in fingers))[:2]
        share = 0.45
        fist_vg.add([vi], 1.0 - share, "REPLACE")
        tot = sum(1.0 / (d + 1e-4) ** 2 for d, _ in near)
        for d, n in near:
            vgs[n].add([vi], share * (1.0 / (d + 1e-4) ** 2) / tot, "REPLACE")
    log(f"кисть {fist}: {len(fist_ids)} вершин → пальцы")

bpy.context.view_layer.objects.active = elf
bpy.ops.object.select_all(action="DESELECT")
elf.select_set(True)
bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
bpy.ops.object.vertex_group_clean(group_select_mode="ALL", limit=0.005)
bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL")
weighted = sum(1 for v in elf.data.vertices if v.groups)
log(f"вершин с весами: {weighted} из {len(elf.data.vertices)}")

# ---------------------------------------------------------------- вариант плаща
def verts_of_group(obj, name):
    vg = obj.vertex_groups.get(name)
    if not vg:
        return []
    idx = vg.index
    return [v.index for v in obj.data.vertices if any(g.group == idx for g in v.groups)]

hips_verts = set(verts_of_group(elf, "Hips"))
leg_verts = set()
for nm in ("UpperLeg.L", "UpperLeg.R"):
    leg_verts |= set(verts_of_group(elf, nm))
log(f"вершин у Hips: {len(hips_verts)}, у бёдер: {len(leg_verts)}")

if skirt_mode == "hips":
    # ЮБКА К ТАЗУ: у эльфа длинный плащ до колен. Авто-веса привязывают его к ногам,
    # поэтому он разваливается/протыкается при шаге. Сохраняем плащ «колоколом» на Hips:
    # вершины ниже таза, которые сейчас тяготеют к тазу или бёдрам, получают вес 1.0 в Hips,
    # а все их прочие группы обнуляются.
    zmin, zmax = bbox(elf)[2]
    hips_vg = elf.vertex_groups.get("Hips")
    leg_vgs = [elf.vertex_groups.get(n) for n in ("UpperLeg.L", "UpperLeg.R", "LowerLeg.L", "LowerLeg.R") if elf.vertex_groups.get(n)]
    leg_idx = {vg.index for vg in leg_vgs}
    skirt_ids = []
    if hips_vg:
        all_vgs = list(elf.vertex_groups)
        hip_idx = hips_vg.index
        for v in elf.data.vertices:
            zf = (v.co.z - zmin) / max(1e-6, (zmax - zmin))
            if 0.08 < zf < 0.55:  # от ступней до чуть выше таза — зона плаща
                groups = {g.group: g.weight for g in v.groups}
                if hip_idx in groups or (leg_idx & groups.keys()):
                    skirt_ids.append(v.index)
        # Переписать веса: Hips = 1, всё остальное = 0.
        for vg in list(elf.vertex_groups):
            if vg.name != "Hips":
                vg.remove(skirt_ids)
        hips_vg.add(skirt_ids, 1.0, "REPLACE")
        log(f"плащ к тазу: {len(skirt_ids)} вершин")
elif skirt_mode == "legs":
    log("плащ к ногам: оставлены авто-веса (плащ следует за ногами)")

# ---------------------------------------------------------------- привязать к арматуре
mod = elf.modifiers.new("Armature", "ARMATURE")
mod.object = arm
elf.parent = arm
elf.matrix_parent_inverse = arm.matrix_world.inverted()

# Удалить исходный меш человека (он больше не нужен в экспорте).
bpy.data.objects.remove(src_mesh, do_unlink=True)

# ---------------------------------------------------------------- убрать лишнее из FBX
# В animate.fbx есть своя анимация («Armature|Armature|…_remap»): она крутит корневой узел
# и уезжает в экспорт — модель масштабируется в 100 раз и «пропадает». Оставляем только
# клипы рига игры.
_game_actions = {n for n in (bpy.data.actions.keys())}
for ac in list(bpy.data.actions):
    if "Armature|" in ac.name or "_remap" in ac.name:
        log(f"удаляю чужой клип: {ac.name}")
        _game_actions.discard(ac.name)
        bpy.data.actions.remove(ac)
# Лишние арматуры из FBX (у игры один скелет).
for o in list(bpy.data.objects):
    if o.type == "ARMATURE" and o is not arm:
        log(f"удаляю чужую арматуру: {o.name}")
        bpy.data.objects.remove(o, do_unlink=True)
log(f"клипов для экспорта: {len(bpy.data.actions)}")

# ---------------------------------------------------------------- единицы сцены
# FBX в сантиметрах ставит сцене unit scale 0.01 — glTF-экспорт умножает на него ВСЁ,
# и модель уезжает в 100 раз меньше. Возвращаем метры.
us = bpy.context.scene.unit_settings
log(f"unit scale сцены: {us.scale_length}")
if abs(us.scale_length - 1.0) > 1e-6:
    us.scale_length = 1.0
    log("unit scale сцены → 1.0")

# ---------------------------------------------------------------- диагностика перед выгрузкой
_wm = [elf.matrix_world @ v.co for v in elf.data.vertices]
log(f"перед экспортом: меш Z {min(p.z for p in _wm):.3f}..{max(p.z for p in _wm):.3f}, "
    f"меш scale {tuple(round(x,3) for x in elf.matrix_world.to_scale())}, "
    f"арм scale {tuple(round(x,3) for x in arm.matrix_world.to_scale())}")

# ---------------------------------------------------------------- выгрузка
out_coll = bpy.data.collections.new("ELF")
bpy.context.scene.collection.children.link(out_coll)
for o in (arm, elf):
    for c in list(o.users_collection):
        c.objects.unlink(o)
    out_coll.objects.link(o)

os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
bpy.ops.object.select_all(action="DESELECT")
for o in (arm, elf):
    o.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_yup=True,
    export_texcoords=True,
    export_normals=True,
    export_skins=True,
    export_morph=False,
)
if blend_out:
    os.makedirs(os.path.dirname(blend_out) or ".", exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=blend_out, copy=True)

z.emit({
    "elf": elf.name,
    "tris": z.tri_count(elf),
    "trisBefore": tris_before,
    "verts": len(elf.data.vertices),
    "bones": len(arm.data.bones),
    "actions": len(bpy.data.actions),
    "skirtMode": skirt_mode,
    "height": round(z.world_bbox()[1][2] - z.world_bbox()[0][2], 3),
    "out": out,
    "fileKB": round(os.path.getsize(out) / 1024),
})
