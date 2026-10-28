"""
Веса тела героя «Человек» заново: автоматические веса Blender (тепловая диффузия по сетке — гладкие переходы
на плечах, тазе, локтях и коленях), кисти и пальцы — как поставил fix_fingers.py (их не трогаем).
Не больше 4 костей на вершину (предел glTF), веса нормированы.

Запуск: Blender -b -P tools/blender/human/fix_weights.py
Читает и перезаписывает Human50k_rig_lowZEP_fingers.blend; дальше — build_human.py → moves.py → to_game.py.
"""
import bpy

RIG = "/Users/zep/ASSETS/3D/human/Human50k_rig_lowZEP_fingers.blend"
bpy.ops.wm.open_mainfile(filepath=RIG)
arm = bpy.data.objects["HumanRig"]
body = bpy.data.objects["node_0"]
me = body.data
AW = arm.matrix_world
W = body.matrix_world

# 1) запомнить веса кистей (за запястьем, у каждой руки — по оси руки)
keep = {}
for side, s in (("Left", 1.0), ("Right", -1.0)):
    wrist = AW @ arm.data.bones[f"{side}Hand"].head_local
    for v in me.vertices:
        p = W @ v.co
        if s * p.x > s * wrist.x - 0.006 and abs(p.y - wrist.y) < 0.09 and abs(p.z - wrist.z) < 0.09:
            keep[v.index] = [(body.vertex_groups[g.group].name, g.weight) for g in v.groups]
print("HAND_VERTS", len(keep))

# 2) автоматические веса на всё тело
for m in list(body.modifiers):
    if m.type == 'ARMATURE':
        body.modifiers.remove(m)
mw = body.matrix_world.copy()
body.parent = None
body.matrix_world = mw
body.vertex_groups.clear()
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
print("GROUPS", len(body.vertex_groups))

# 3) вернуть кисти
groups = {g.name: g for g in body.vertex_groups}
for i, ws in keep.items():
    for g in body.vertex_groups:
        g.remove([i])
    for n, w in ws:
        (groups.get(n) or body.vertex_groups.new(name=n)).add([i], w, 'REPLACE')

# 3б) вершины, до которых тепло не дошло (мелкие отдельные куски сетки), — веса ближайшей взвешенной
import mathutils  # noqa: E402

weighted = [v for v in me.vertices if any(g.weight > 1e-4 for g in v.groups)]
kd = mathutils.kdtree.KDTree(len(weighted))
for v in weighted:
    kd.insert(v.co, v.index)
kd.balance()
for v in me.vertices:
    if any(g.weight > 1e-4 for g in v.groups):
        continue
    _, j, _ = kd.find(v.co)
    for g in me.vertices[j].groups:
        body.vertex_groups[g.group].add([v.index], g.weight, 'REPLACE')

# 4) не больше 4 костей, нормировать
bpy.context.view_layer.objects.active = body
bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
bpy.ops.object.mode_set(mode='OBJECT')

empty = [v.index for v in me.vertices if not any(g.weight > 1e-4 for g in v.groups)]
print("UNWEIGHTED", len(empty))
bpy.ops.wm.save_as_mainfile(filepath=RIG)
print("SAVED")
