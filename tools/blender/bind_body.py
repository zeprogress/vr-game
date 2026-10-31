"""
Допривязать ТЕЛО эльфа к костям (торс, голова, ноги, стопы) — руки уже привязаны.

Зачем: в elf_ZEP_rig.blend были привязаны только руки (Shoulder/UpperArm/LowerArm/Fist),
91.5% вершин. Голова, торс, ноги и стопы остались без весов — при проигрывании клипа
(AtkSword1, Run и т.п.) руки едут, а тело стоит на месте и «отрывается».

Что делает скрипт:
  1. Ищет кости тела: Hips, Abdomen, Torso, Chest, Neck, Head, UpperLeg/LowerLeg/Foot/Toe.
  2. Для каждой вершины БЕЗ весов (или с весами только на руках — по флагу) выбирает
     ближайший отрезок кости тела и даёт вес по расстоянию, с плавным переходом:
     вес убывает до нуля на радиусе FALLOFF. Берётся до 2 костей на вершину.
  3. Руки (Shoulder/UpperArm/LowerArm/Fist/пальцы) НЕ трогает.
  4. Нормализует веса, чтобы сумма на вершине была 1.

ЗАПУСК: открой elf_ZEP_rig.blend → Scripting → New → вставь → Run Script.
Перед запуском скрипт делает скрытую копию меша «ELF_ДО_тела».

Настройки: FALLOFF — радиус влияния кости (м). Больше — мягче сгибы, но «резиновей».
"""
import bpy
from mathutils import Vector

FALLOFF = 0.14      # м: радиус плавного спада веса от кости
MAX_BONES = 2       # сколько костей тела может влиять на одну вершину
TOUCH_HANDS = False # True — переписать и вершины рук тоже (обычно не нужно)


def log(msg):
    print(f"[body_bind] {msg}", flush=True)


meshes = [o for o in bpy.data.objects if o.type == "MESH" and len(o.data.polygons) >= 100]
arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
if not meshes or not arms:
    raise SystemExit("[body_bind] нужны меш и арматура — открой elf_ZEP_rig.blend")
elf = max(meshes, key=lambda o: len(o.data.polygons))
arm = arms[0]
log(f"меш «{elf.name}» ({len(elf.data.vertices)} вершин), арматура «{arm.name}» ({len(arm.data.bones)} костей)")

# ---------------------------------------------------------------- резервная копия
bak_name = elf.name + "_ДО_тела"
if bak_name not in bpy.data.objects:
    bak = elf.copy()
    bak.data = elf.data.copy()
    bak.name = bak_name
    bpy.context.scene.collection.objects.link(bak)
    # Скрывать можно только после того, как объект попал в View Layer.
    bak.hide_set(True)
    log(f"резервная копия: «{bak_name}»")

# ---------------------------------------------------------------- мировые координаты
mw = elf.matrix_world
identity = all(abs(mw[i][j] - (1.0 if i == j else 0.0)) < 1e-6 for i in range(4) for j in range(4))
if not identity:
    bpy.context.view_layer.objects.active = elf
    bpy.ops.object.select_all(action="DESELECT")
    elf.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    log("трансформ меша применён")
mw = elf.matrix_world

HAND_BONES = {"Shoulder.L", "Shoulder.R", "UpperArm.L", "UpperArm.R", "LowerArm.L", "LowerArm.R",
              "Fist.L", "Fist.R"}
HAND_BONES |= {g.name for g in elf.vertex_groups if "Index" in g.name or "Middle" in g.name or
               "Pinky" in g.name or "Ring" in g.name or "Thumb" in g.name}

BODY_BONES = ["Hips", "Abdomen", "Torso", "Chest", "Neck", "Head",
              "UpperLeg.L", "LowerLeg.L", "Foot.L", "Toe.L",
              "UpperLeg.R", "LowerLeg.R", "Foot.R", "Toe.R"]
present = [n for n in BODY_BONES if arm.data.bones.get(n)]
log(f"костей тела найдено: {len(present)} из {len(BODY_BONES)}")


def seg(name):
    b = arm.data.bones[name]
    return (arm.matrix_world @ b.head_local, arm.matrix_world @ b.tail_local)


def seg_dist(p, a, b):
    ab = b - a
    t = 0.0 if ab.length_squared < 1e-12 else max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


segs = {n: seg(n) for n in present}
# Радиус влияния — от длины кости: у таза шире, у пальцев ног уже.
rad = {n: min(FALLOFF * 1.6, max(FALLOFF * 0.6, (segs[n][1] - segs[n][0]).length * 0.45)) for n in present}

# ---------------------------------------------------------------- группы вершин
for n in present:
    if n not in elf.vertex_groups:
        elf.vertex_groups.new(name=n)
vg = {n: elf.vertex_groups[n] for n in present}

# ---------------------------------------------------------------- распределение
hand_idx = {elf.vertex_groups[n].index for n in HAND_BONES if n in elf.vertex_groups}
assigned = 0
skipped_hand = 0
for v in elf.data.vertices:
    p = mw @ v.co
    if not TOUCH_HANDS and any(g.group in hand_idx and g.weight > 0.5 for g in v.groups):
        skipped_hand += 1
        continue
    # ближайшие кости тела
    ds = sorted(((seg_dist(p, *segs[n]), n) for n in present), key=lambda t: t[0])
    picks = []
    for d, n in ds[:MAX_BONES]:
        r = rad[n]
        if d >= r:
            continue
        w = 1.0 - d / r               # линейный спад
        picks.append((n, w * w))      # квадрат — ближе к кости резче
    if not picks:
        continue
    total = sum(w for _, w in picks)
    # убрать старые веса тела, затем поставить новые
    for n in present:
        vg[n].remove([v.index])
    for n, w in picks:
        vg[n].add([v.index], w / total, "REPLACE")
    assigned += 1

log(f"вершин с новыми весами тела: {assigned} (руки пропущены: {skipped_hand})")

# ---------------------------------------------------------------- нормализация
bpy.context.view_layer.objects.active = elf
bpy.ops.object.select_all(action="DESELECT")
elf.select_set(True)
bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL")
log("веса нормализованы")

# ---------------------------------------------------------------- отчёт
unweighted = sum(1 for v in elf.data.vertices if not any(g.weight > 0.001 for g in v.groups))
log(f"вершин без весов после привязки: {unweighted} из {len(elf.data.vertices)}")
log("проверь: в Pose Mode поверни нужные кости — тело должно идти следом")
log("откат: удали «ELF» и сними скрытие с «ELF_ДО_тела»")
