"""
Рендер-превью подземелья: набор модулей (GLB) + геометрия и расстановка из игры (JSON, tools/dungeon/export.mts).

    Blender -b --factory-startup -P tools/blender/preview_dungeon.py -- <kit.glb> <dungeon.json> <out_dir> [--tex public/textures/dungeon] [--views B,C,E,H,K,T,top] [--size 960x540]

Кадры — глазами героя в ключевых зонах и вид сверху (без потолков). Координаты игры → Blender: (x, y, z) → (−x, −z, y).
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
import mathutils  # noqa: E402
import numpy as np  # noqa: E402

import zep_lib as z  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
M_GB = mathutils.Matrix(((-1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # игра → Blender
M_BG = M_GB.inverted()

# Глазами героя: (камера x, y, z) → (цель x, y, z) в координатах игры (локальных подземелья).
VIEWS = {
    "B": ((18, 56.2, -146), (0, 46, -70)),
    "C": ((2, 48.8, -84), (0, 50, 10)),
    "E": ((-174, 27.8, 4), (-199, 34, -2)),
    "H": ((0, 58, 130), (0, 62, 180)),
    "K": ((48, 54, -142), (130, 44, -120)),
    "T": ((-46, 53.5, -146), (-150, 34, -160)),
    "F": ((-20, 41.8, 16), (20, 36, -30)),
    "S": ((-40, 41.5, -6), (-130, 22, 10)),
    "V": ((0, 57.8, 80), (0, 60, 120)),
    "Vw": ((4, 57.8, 100), (-120, 30, 60)),
    "G": ((-20, 57.8, 60), (-150, 25, 0)),
    "W1": ((20, 70, -60), (-120, 40, 40)),
}


def g2b(p):
    return (-p[0], -p[2], p[1])


def material(name, tex_dir, key, tint=(1, 1, 1), emit=0.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    if key == "water":
        bsdf.inputs["Base Color"].default_value = (0.02, 0.08, 0.12, 1)
        bsdf.inputs["Roughness"].default_value = 0.05
        return m

    def img(suffix, non_color):
        p = os.path.join(tex_dir, f"{key}_{suffix}.jpg")
        if not os.path.exists(p):
            return None
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = bpy.data.images.load(p, check_existing=True)
        if non_color:
            t.image.colorspace_settings.name = "Non-Color"
        return t

    c = img("c", False)
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs[0].default_value = 1.0
    if c:
        nt.links.new(c.outputs[0], mix.inputs[6])
    nt.links.new(vc.outputs[0], mix.inputs[7])
    tnode = nt.nodes.new("ShaderNodeMix")
    tnode.data_type = "RGBA"
    tnode.blend_type = "MULTIPLY"
    tnode.inputs[0].default_value = 1.0
    tnode.inputs[7].default_value = (*tint, 1)
    nt.links.new(mix.outputs[2], tnode.inputs[6])
    nt.links.new(tnode.outputs[2], bsdf.inputs["Base Color"])
    r = img("r", True)
    if r:
        nt.links.new(r.outputs[0], bsdf.inputs["Roughness"])
    n = img("n", True)
    if n:
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(n.outputs[0], nm.inputs[1])
        nt.links.new(nm.outputs[0], bsdf.inputs["Normal"])
    return m


GEO_TEX = {"floorStone": "flagstone", "floorRock": "rock", "cliff": "rock", "masonry": "masonry", "wood": "wood", "water": "water", "ceiling": "rock", "dome": "rock"}


def main():
    a = z.args()
    kit, data_path, out_dir = a[0], a[1], a[2]
    tex = z.opt(a, "--tex", os.path.join(ROOT, "public", "textures", "dungeon"))
    views = (z.opt(a, "--views", "B,C,E,H,K,T,top") or "").split(",")
    w, h = (int(x) for x in (z.opt(a, "--size", "960x540") or "960x540").split("x"))
    os.makedirs(out_dir, exist_ok=True)
    z.clear_scene()
    data = json.load(open(data_path))
    scene = bpy.context.scene

    # Набор: импорт, исходники прячем (используем их меши).
    bpy.ops.import_scene.gltf(filepath=kit)
    kit_mesh = {}
    for o in list(scene.objects):
        if o.type == "MESH" and o.name.endswith("_LOD0"):
            kit_mesh[o.name[:-5]] = o.data
            mat = o.data.materials[0].name.split(".")[0] if o.data.materials else "rock"
            o.data.materials.clear()
            o.data.materials.append(material("k_" + mat, tex, mat))
        o.hide_render = True
        o.hide_viewport = True

    # Геометрия (полы, обрывы, потолки, вода).
    ceilings = []
    for part in data["geo"]:
        pos = np.array(part["pos"], float).reshape(-1, 3)
        V = [g2b(p) for p in pos]
        idx = part["idx"]
        F = [tuple(idx[i:i + 3]) for i in range(0, len(idx), 3)]
        me = bpy.data.meshes.new("g")
        me.from_pydata(V, [], F)
        uv = me.uv_layers.new(name="UVMap")
        uvs = part["uv"]
        for poly in me.polygons:
            for li in poly.loop_indices:
                vi = me.loops[li].vertex_index
                uv.data[li].uv = (uvs[vi * 2], uvs[vi * 2 + 1])
        ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
        col = part.get("col") or []
        for vi, d in enumerate(ca.data):
            d.color = (col[vi * 3], col[vi * 3 + 1], col[vi * 3 + 2], 1) if col else (1, 1, 1, 1)
        key = GEO_TEX[part["mat"]]
        tint = (0.7, 0.7, 0.72) if part["mat"] == "ceiling" else (1, 1, 1)
        me.materials.append(material("g_" + part["mat"], tex, key, tint))
        ob = bpy.data.objects.new("geo_" + part["mat"], me)
        scene.collection.objects.link(ob)
        if part["mat"] in ("ceiling", "dome"):
            ceilings.append(ob)

    # Расстановка модулей.
    missing = set()
    for pc in data["dress"]:
        me = kit_mesh.get(pc["k"])
        if me is None:
            missing.add(pc["k"])
            continue
        f = mathutils.Vector(pc["f"]).normalized()
        up = mathutils.Vector(pc["up"]).normalized()
        r = up.cross(f).normalized()
        up = f.cross(r).normalized()
        sx, sy, sz = pc["s"]
        Wg = mathutils.Matrix((
            (r.x * sx, up.x * sy, f.x * sz, pc["p"][0]),
            (r.y * sx, up.y * sy, f.y * sz, pc["p"][1]),
            (r.z * sx, up.z * sy, f.z * sz, pc["p"][2]),
            (0, 0, 0, 1),
        ))
        ob = bpy.data.objects.new(pc["k"], me)
        ob.matrix_world = M_GB @ Wg @ M_BG
        scene.collection.objects.link(ob)

    # Водопады — светлые полосы.
    fall_m = bpy.data.materials.new("fall")
    fall_m.use_nodes = True
    em = fall_m.node_tree.nodes.new("ShaderNodeEmission")
    em.inputs[0].default_value = (0.7, 0.85, 1.0, 1)
    em.inputs[1].default_value = 2.0
    fall_m.node_tree.links.new(em.outputs[0], fall_m.node_tree.nodes["Material Output"].inputs[0])
    for fl in data["falls"]:
        bpy.ops.mesh.primitive_plane_add(size=1)
        p = bpy.context.object
        p.scale = (fl["w"], fl["top"] - fl["bottom"], 1)
        p.rotation_euler = (math.radians(90), 0, -fl["yaw"])
        p.location = g2b((fl["u"], (fl["top"] + fl["bottom"]) / 2, fl["v"]))
        p.data.materials.append(fall_m)

    # Свет: тёплые источники в залах, холодные — в пещерах; слабый общий.
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.012, 0.016, 0.03, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scene.world = world
    for zn in data["zones"]:
        warm = zn["style"] != "cave"
        ld = bpy.data.lights.new("l", "POINT")
        ld.color = (1.0, 0.62, 0.32) if warm else (0.45, 0.7, 1.0)
        ld.energy = 60000 if zn["id"] in ("H", "E", "F", "T", "K", "S") else 25000
        ld.shadow_soft_size = 3
        lo = bpy.data.objects.new("l", ld)
        lo.location = g2b((zn["u"], zn["h"] + min(zn["ceil"] * 0.55, 14), zn["v"]))
        scene.collection.objects.link(lo)

    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = w
    scene.render.resolution_y = h
    scene.render.image_settings.file_format = "PNG"
    cam_d = bpy.data.cameras.new("cam")
    cam_d.lens = 22
    cam_d.clip_end = 2000
    cam = bpy.data.objects.new("cam", cam_d)
    scene.collection.objects.link(cam)
    scene.camera = cam
    outs = []
    for v in views:
        if v == "top":
            for c in ceilings:
                c.hide_render = True
            cam_d.type = "ORTHO"
            cam_d.ortho_scale = 420
            cam.location = (0, 0, 400)
            cam.rotation_euler = (0, 0, math.radians(180))
            sun = bpy.data.lights.new("sun", "SUN")
            sun.energy = 2.5
            so = bpy.data.objects.new("sun", sun)
            so.rotation_euler = (math.radians(30), 0, math.radians(40))
            scene.collection.objects.link(so)
        else:
            cam_d.type = "PERSP"
            eye, tgt = VIEWS[v]
            e = mathutils.Vector(g2b(eye))
            t = mathutils.Vector(g2b(tgt))
            cam.location = e
            cam.rotation_euler = (t - e).to_track_quat("-Z", "Y").to_euler()
        path = os.path.join(out_dir, f"view_{v}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        outs.append(path)
    z.emit(dict(views=outs, pieces=len(data["dress"]), missing=sorted(missing)))


main()
