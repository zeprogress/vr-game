"""
Общие помощники пайплайна ассетов ZEP GAME для Blender (запуск без интерфейса:
`Blender -b --factory-startup -P tools/blender/<script>.py -- <аргументы>`; обёртка — scripts/asset.mjs).

Соглашения игры (их проверяет inspect/prep):
  • единицы — метры, вверх +Y в glTF (в Blender +Z), «вперёд» модели — +Y Blender (-Z glTF);
  • ступни на нуле, герой ~1.8 м, мобы — по описанию;
  • стиль — плоские цвета материалов (игра перекрашивает по baseColor, текстуры не нужны);
  • клипы: Idle, Walk, Run, Attack, HitReact, Death (+ свои); одно Armature на модель.
"""
import json
import os
import sys

import bpy

IMPORTERS = {
    ".glb": lambda p: bpy.ops.import_scene.gltf(filepath=p),
    ".gltf": lambda p: bpy.ops.import_scene.gltf(filepath=p),
    ".fbx": lambda p: bpy.ops.import_scene.fbx(filepath=p, automatic_bone_orientation=True),
    ".obj": lambda p: bpy.ops.wm.obj_import(filepath=p),
    ".blend": None,
}


def args() -> list:
    """Аргументы после `--`."""
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def opt(a: list, name: str, default=None):
    """--name value из списка аргументов."""
    if name in a:
        i = a.index(name)
        if i + 1 < len(a):
            return a[i + 1]
    return default


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def load(path: str) -> None:
    """Пустая сцена + импорт файла (.blend открывается как есть)."""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".blend":
        bpy.ops.wm.open_mainfile(filepath=path)
        return
    clear_scene()
    imp = IMPORTERS.get(ext)
    if not imp:
        raise SystemExit(f"неизвестный формат: {ext}")
    imp(path)


def bone_shapes():
    """Меши-фигуры костей (импортёр glTF создаёт «Icosphere» для отображения костей) — не часть модели."""
    out = set()
    for o in bpy.context.scene.objects:
        if o.type == "ARMATURE" and o.pose:
            for pb in o.pose.bones:
                if pb.custom_shape:
                    out.add(pb.custom_shape.name)
    return out


def meshes():
    skip = bone_shapes()
    return [o for o in bpy.context.scene.objects if o.type == "MESH" and o.name not in skip]


def armatures():
    return [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]


def strays():
    """Бесхозные меши у модели со скелетом: не привязаны к скелету и без модификатора Armature
    (служебные Icosphere/Cube из пака) — портят габарит и лишние в игре."""
    if not armatures():
        return []
    out = []
    for o in meshes():
        skinned = any(md.type == "ARMATURE" for md in o.modifiers)
        under_arm = o.parent is not None and o.parent.type == "ARMATURE"
        if not skinned and not under_arm:
            out.append(o)
    return out


def tri_count(obj) -> int:
    me = obj.data
    return sum(len(p.vertices) - 2 for p in me.polygons)


def world_bbox():
    """Габариты всех мешей в мировых координатах (Blender: Z вверх) — в позе покоя скелета
    (иначе меряется текущий кадр клипа: присел/замахнулся — и рост «прыгает»)."""
    import mathutils
    arms = armatures()
    saved = [(o, o.data.pose_position) for o in arms]
    for o in arms:
        o.data.pose_position = "REST"
    bpy.context.view_layer.update()
    lo = [1e9, 1e9, 1e9]
    hi = [-1e9, -1e9, -1e9]
    dg = bpy.context.evaluated_depsgraph_get()
    for o in meshes():
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        mw = ev.matrix_world
        for v in me.vertices:
            w = mw @ v.co
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
        ev.to_mesh_clear()
    for o, pp in saved:
        o.data.pose_position = pp
    bpy.context.view_layer.update()
    return lo, hi


def emit(data: dict) -> None:
    """Результат одной строкой JSON с меткой — обёртка вырезает его из шума Blender."""
    print("ZEP_RESULT " + json.dumps(data, ensure_ascii=False))
