"""
Веса скина после рига (fit_rig / gen): вершины без костей (останутся на месте, тянутся «нитками»),
кости без вершин (ничего не двигают), сколько вершин у каждой кости по главному весу, вершины с > 4 костями.

  npm run asset -- weights <модель.glb|.blend>

Смотреть на распределение: у кисти/когтей должны быть свои вершины, у ноги — не задевать руку (руки
в покое разведены). Подозрение — проверить позой в Blender или раскадровкой (npm run asset -- frames).
"""
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
import zep_lib as z  # noqa: E402

z.load(z.args()[0])
arm = z.armatures()[0]
deform = [b.name for b in arm.data.bones if b.use_deform]
res = {"meshes": {}}
total = {b: 0 for b in deform}
for ob in [o for o in bpy.data.objects if o.type == "MESH" and o.find_armature()]:
    names = {g.index: g.name for g in ob.vertex_groups}
    none, weak, many = 0, 0, 0
    for v in ob.data.vertices:
        gs = [g for g in v.groups if names.get(g.group) in total and g.weight > 1e-4]
        if not gs:
            none += 1
            continue
        if sum(g.weight for g in gs) < 0.5:
            weak += 1
        if len(gs) > 4:
            many += 1
        total[names[max(gs, key=lambda g: g.weight).group]] += 1
    res["meshes"][ob.name] = {"verts": len(ob.data.vertices), "noBone": none, "weakSum": weak, "over4": many}
res["perBone"] = total
res["emptyBones"] = [b for b, n in total.items() if n == 0]
z.emit(res)
