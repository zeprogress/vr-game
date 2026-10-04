"""
Осмотр модели: короткий JSON вместо скриншотов — треугольники, материалы и их цвета, текстуры,
кости, клипы (имя, длина), рост и где «ступни». Всё, что нужно, чтобы решить, годится ли модель.
Аргументы: <файл>
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
import zep_lib as z  # noqa: E402

a = z.args()
z.load(a[0])
ms = z.meshes()
arms = z.armatures()
lo, hi = z.world_bbox()
mats = {}
for o in ms:
    for slot in o.material_slots:
        m = slot.material
        if not m or m.name in mats:
            continue
        col = None
        tex = []
        if m.use_nodes:
            for n in m.node_tree.nodes:
                if n.type == "BSDF_PRINCIPLED":
                    c = n.inputs["Base Color"].default_value
                    col = [round(c[0], 3), round(c[1], 3), round(c[2], 3)]
                if n.type == "TEX_IMAGE" and n.image:
                    tex.append(f"{n.image.name} {n.image.size[0]}x{n.image.size[1]}")
        mats[m.name] = f"{col}" + (f" tex: {', '.join(tex)}" if tex else "")
clips = []
for act in bpy.data.actions:
    f0, f1 = act.frame_range
    clips.append(f"{act.name} {round((f1 - f0) / bpy.context.scene.render.fps, 2)}с")
z.emit({
    "file": os.path.basename(a[0]),
    "meshes": len(ms),
    "tris": sum(z.tri_count(o) for o in ms),
    "skinned": sum(1 for o in ms if any(md.type == "ARMATURE" for md in o.modifiers)),
    "materials": len(mats),
    "materialList": mats,
    "armatures": len(arms),
    "bones": sum(len(o.data.bones) for o in arms),
    "clips": clips,
    "heightZ": round(hi[2] - lo[2], 3),
    "sizeXY": [round(hi[0] - lo[0], 3), round(hi[1] - lo[1], 3)],
    "minZ": round(lo[2], 3),
    "fileKB": round(os.path.getsize(a[0]) / 1024) if os.path.isfile(a[0]) else None,
    "strays": [o.name for o in z.strays()],
})
