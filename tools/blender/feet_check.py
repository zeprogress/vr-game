"""
Стопы в шаге и беге: на каждом кадре — нижняя точка левой и правой ноги (по вершинам скина). В опоре
стопа должна стоять на земле (≈0), в полёте бега — обе выше; ниже нуля — нога уходит под землю
(носок на отрыве, пятка на касании). Так ловился «провал» стопы у Ледяного гиганта.

  npm run asset -- feet <модель.glb|.blend> [--clips Walk,Run] [--step 1]

Итог в долях роста модели (на игровом размере умножь на рост в метрах): contactMax — худший зазор
опорной стопы над землёй, below — глубже всего под землёй, airFrames — кадры без опоры (бег — норма).
"""
import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import zep_lib as z  # noqa: E402

a = z.args()
z.load(a[0])
clips = (z.opt(a, "--clips", "Walk,Run")).split(",")
step = int(z.opt(a, "--step", "1"))
arm = z.armatures()[0]
skinned = [o for o in bpy.data.objects if o.type == "MESH" and o.find_armature()]
scene = bpy.context.scene


def verts():
    dg = bpy.context.evaluated_depsgraph_get()
    out = []
    for ob in skinned:
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        co = np.empty(len(me.vertices) * 3)
        me.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        m = np.array(ob.matrix_world)
        out.append(co @ m[:3, :3].T + m[:3, 3])
        ev.to_mesh_clear()
    return np.vstack(out)


arm.animation_data_create()
arm.animation_data.action = None
scene.frame_set(0)
rest = verts()
h = float(rest[:, 2].max() - min(0.0, rest[:, 2].min()))
side = 0.02 * h
low = 0.22 * h
eps = 0.01 * h

res = {"height": round(h, 3), "clips": {}}
for name in clips:
    act = bpy.data.actions.get(name) or next((x for x in bpy.data.actions if x.name.lower().startswith(name.lower())), None)
    if not act:
        res["clips"][name] = "нет клипа"
        continue
    arm.animation_data.action = act
    f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
    rows, contact, below, air = [], 0.0, 0.0, 0
    for f in range(f0, f1 + 1, step):
        scene.frame_set(f)
        co = verts()
        co = co[co[:, 2] < low]
        zl = co[co[:, 0] > side, 2].min() if (co[:, 0] > side).any() else None
        zr = co[co[:, 0] < -side, 2].min() if (co[:, 0] < -side).any() else None
        zs = [v for v in (zl, zr) if v is not None]
        if not zs:
            continue
        stance = min(zs)
        below = min(below, stance)
        if stance > eps:
            air += 1
        else:
            contact = max(contact, abs(stance))
        rows.append([f, None if zl is None else round(zl / h, 4), None if zr is None else round(zr / h, 4)])
    res["clips"][act.name] = {
        "contactMax": round(contact / h, 4), "below": round(below / h, 4), "airFrames": air, "frames": len(rows),
        "rows": rows,
    }
z.emit(res)
