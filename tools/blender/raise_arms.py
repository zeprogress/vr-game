"""
Поднять руки эльфа в T-позу — версия 2 (переписана после «всё разъехалось»).

ЧТО БЫЛО НЕ ТАК В ПЕРВОЙ ВЕРСИИ:
  • скрипт переводил вершины из мировых координат обратно в локальные через
    matrix_world.inverted() — при нетривиальном трансформе меша это ломало масштаб,
    и геометрия разъезжалась;
  • трансформ меша применялся только «мысленно» — вершины и кости сравнивались в разных
    системах координат, поэтому «рука» определялась не там, где надо;
  • поворот считался несколько раз за проход.

КАК ТЕПЕРЬ:
  • ОДИН раз применяется трансформ меша (как Ctrl+A All Transforms) — вершины и кости
    в одной системе. Если трансформа нет, шаг пропускается;
  • поворот считается ровно один раз, без обратных преобразований;
  • если руки уже горизонтальны — ничего не делает;
  • делается скрытая резервная копия «ELF_ДО_Tpose», чтобы можно было вернуться.

ЗАПУСК: открой art/elf/elf_legs.blend → вкладка Scripting → New → вставь этот текст → Run Script.
Откат: Ctrl+Z (скрипт пишет в консоль, сколько вершин повернул).
"""
import math

import bpy
from mathutils import Vector

# ---------------------------------------------------------------- настройки
DO_MIRROR = True      # True — обе руки; False — только левая
EXTRA_DEG = 0.0       # добить угол, если руки оказались чуть ниже горизонтали
MAKE_BACKUP = True    # True — оставить скрытую копию «ELF_ДО_Tpose»


def log(msg):
    print(f"[raise_arms2] {msg}", flush=True)


# ---------------------------------------------------------------- найти меш и арматуру
meshes = [o for o in bpy.data.objects if o.type == "MESH" and len(o.data.polygons) >= 100]
arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
if not meshes:
    raise SystemExit("[raise_arms2] в сцене нет меша — открой elf_legs.blend")
if not arms:
    raise SystemExit("[raise_arms2] в сцене нет арматуры — открой elf_legs.blend")

elf = max(meshes, key=lambda o: len(o.data.polygons))
arm = arms[0]
log(f"меш «{elf.name}»: вершин {len(elf.data.vertices)}; арматура «{arm.name}»: костей {len(arm.data.bones)}")

if MAKE_BACKUP:
    bak_name = elf.name + "_ДО_Tpose"
    if bak_name not in bpy.data.objects:
        bak = elf.copy()
        bak.data = elf.data.copy()
        bak.name = bak_name
        bak.hide_set(True)
        bpy.context.scene.collection.objects.link(bak)
        log(f"резервная копия: «{bak_name}» (скрыта)")

# ---------------------------------------------------------------- применить трансформ
bpy.context.view_layer.objects.active = elf
bpy.ops.object.select_all(action="DESELECT")
elf.select_set(True)
identity = all(abs(elf.matrix_world[i][j] - (1.0 if i == j else 0.0)) < 1e-6 for i in range(4) for j in range(4))
if not identity:
    log("применяю трансформ меша (Ctrl+A All Transforms)")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
else:
    log("трансформ уже единичный — пропускаю")

verts = [v.co.copy() for v in elf.data.vertices]
zmin = min(p.z for p in verts)
zmax = max(p.z for p in verts)
H = zmax - zmin
log(f"рост меша: {H:.3f} м")


# ---------------------------------------------------------------- отрезки костей
def bone_segment(name):
    b = arm.data.bones.get(name)
    if not b:
        return None
    mw = arm.matrix_world
    return (mw @ b.head_local, mw @ b.tail_local)


def seg_dist(p, a, b):
    ab = b - a
    t = 0.0 if ab.length_squared < 1e-12 else max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


sh = bone_segment("UpperArm.L")
if not sh:
    raise SystemExit("[raise_arms2] нет кости UpperArm.L — открыт не тот файл?")
pivot = sh[0]

# наклон руки от горизонтали — по самой дальней группе вершин (кисть)
left = [p for p in verts if p.x > 0.05 * H]
hand = sorted(left, key=lambda p: -p.x)[: max(3, len(left) // 25)] if left else []
if hand:
    hx = sum(p.x for p in hand) / len(hand)
    hz = sum(p.z for p in hand) / len(hand)
    v = Vector((hx - pivot.x, 0.0, hz - pivot.z))
    angle = math.atan2(-v.z, v.x) if v.length > 1e-6 else 0.0
else:
    angle = 0.0
angle += math.radians(EXTRA_DEG)
log(f"наклон руки от горизонтали: {math.degrees(angle):.1f}°")

if abs(math.degrees(angle)) < 2:
    log("руки уже горизонтально — ничего не меняю")
    raise SystemExit(0)


# ---------------------------------------------------------------- повернуть вершины (один проход)
def arm_segs(side):
    """Отрезки руки, повёрнутые в текущее (A-pose) положение — честное «кто ближе»."""
    s_upper = bone_segment("UpperArm." + side)
    if not s_upper:
        return [], None
    pv = s_upper[0]
    ang = -angle if side == "L" else angle
    c, sn = math.cos(ang), math.sin(ang)

    def rot(p):
        d = Vector((p.x - pv.x, 0.0, p.z - pv.z))
        return Vector((pv.x + d.x * c - d.z * sn, p.y, pv.z + d.x * sn + d.z * c))

    out = []
    for n in ("Shoulder." + side, "UpperArm." + side, "LowerArm." + side, "Fist." + side):
        s = bone_segment(n)
        if s:
            out.append((rot(s[0]), rot(s[1])))
    return out, pv


body_segs = [bone_segment(n) for n in ("Hips", "Spine", "Chest", "Neck", "Head",
                                       "UpperLeg.L", "LowerLeg.L", "Foot.L",
                                       "UpperLeg.R", "LowerLeg.R", "Foot.R") if bone_segment(n)]
segs = {s: arm_segs(s)[0] for s in ("L", "R")}
pivots = {s: arm_segs(s)[1] for s in ("L", "R")}

moved = {"L": 0, "R": 0}
for v, co in zip(elf.data.vertices, verts):
    d_arm = {s: min((seg_dist(co, a, b) for a, b in segs[s]), default=9.9) for s in ("L", "R")}
    d_body = min((seg_dist(co, a, b) for a, b in body_segs), default=9.9)
    side = "L" if d_arm["L"] <= d_arm["R"] else "R"
    if d_arm[side] >= d_body:
        continue  # ближе к торсу — не рука
    if side == "R" and not DO_MIRROR:
        continue
    pv = pivots[side]
    if pv is None:
        continue
    p = Vector((co.x - pv.x, 0.0, co.z - pv.z))
    ang = angle if side == "L" else -angle
    c, sn = math.cos(ang), math.sin(ang)
    v.co = Vector((pv.x + p.x * c - p.z * sn, co.y, pv.z + p.x * sn + p.z * c))
    moved[side] += 1

elf.data.update()
log(f"готово: левая рука — {moved['L']} вершин, правая — {moved['R']} вершин")
log("не устроило — Ctrl+Z, либо удали «ELF» и сними скрытие с «ELF_ДО_Tpose»")
