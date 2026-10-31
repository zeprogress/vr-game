"""
Elf Assassin — orthographic T-pose turnaround sheet generator (Blender).

Builds a stylised, game-ready elf assassin as a procedural *proxy mesh* that follows
strict T-pose / A-pose rules, then renders 5 orthographic views on a light studio
background with soft, shadowless light:

    front (-Y looking +Y)   right (+X looking -X)   back (+Y looking -Y)
    left  (-X looking +X)   top   (+Z looking -Z, inverted so the face points up)

Outputs (in OUT):
    ElfAssassin_turnaround.png   5-view sheet  (front/right/back/left row + top + palette)
    views/*.png                  individual 2048x2048 views + front view with silhouette

Run:
    Blender --background --python elf_assassin.py -- [--quick] [--no-export]
"""
import bpy
import bmesh
import math
import os
import sys
from mathutils import Vector, Matrix

# --------------------------------------------------------------------------- options
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
QUICK = "--quick" in argv
NO_EXPORT = "--no-export" in argv
# __file__ is defined when run via --python
OUT = os.path.dirname(os.path.abspath(__file__))
VIEWS_DIR = os.path.join(OUT, "views")
os.makedirs(VIEWS_DIR, exist_ok=True)

S = 1024 if QUICK else 2048          # final view resolution
SS = 1.0 if QUICK else 2.0           # render-resolution multiplier (soft AA / crisp text)
ORTHO_SCALE = 2.10                   # world height covered by a square view


# --------------------------------------------------------------------------- helpers
def srgb(hexstr, a=1.0):
    h = hexstr.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    lin = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return (lin[0], lin[1], lin[2], a)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    return sc


def link(obj, coll):
    coll.objects.link(obj)
    return obj


def add_empty(name, loc, size=0.03, coll=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = "PLAIN_AXES"
    e.empty_display_size = size
    e.location = loc
    coll.objects.link(e)
    return e


def add_sphere(name, loc, radius, mat, coll, scale=(1, 1, 1), rot=(0, 0, 0), segs=24, rings=16):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=radius)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    ob.scale = scale
    ob.rotation_euler = rot
    coll.objects.link(ob)
    ob.data.materials.append(mat)
    return ob


def add_tube(name, pts, radii, mat, coll, sides=12, taper_tip=True, close_caps=True):
    """pt[i] = (loc, quat) — tube swept along a polyline. radii: float | list of floats | list of (rx, ry)."""
    if not isinstance(radii, (list, tuple)):
        radii = [radii] * len(pts)
    verts, faces = [], []
    for i, (loc, q) in enumerate(pts):
        r = radii[i]
        rx, ry = (r if isinstance(r, (tuple, list)) else (r, r))
        for k in range(sides):
            a = 2 * math.pi * k / sides
            v = Vector((rx * math.cos(a), ry * math.sin(a), 0.0))
            verts.append(Vector(loc) + q @ v)
    n = len(pts)
    for i in range(n - 1):
        for k in range(sides):
            a = i * sides + k
            b = i * sides + (k + 1) % sides
            c = (i + 1) * sides + (k + 1) % sides
            d = (i + 1) * sides + k
            faces.append((a, b, c, d))
    if close_caps:
        faces.append(tuple(reversed(range(sides))))
        last = (n - 1) * sides
        faces.append(tuple(last + k for k in range(sides)))
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.validate()
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    ob.data.materials.append(mat)
    if taper_tip:
        sol = ob.modifiers.new("tip", "SOLIDIFY")
        sol.thickness = 0.002
        sol.offset = 0
    return ob


def add_curve_mesh(name, paths, mat, coll, bevel=0.002, sline=0.004, flat=False):
    """paths: list of list[(x,y,z)] polylines; round or flat (ribbon-like) bevel."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = bevel
    cu.bevel_resolution = 2
    if flat:  # flattened profile -> reads like a blade edge-on
        cu.extrude = 0.0
        cu.bevel_mode = "ROUND"
    cu.use_fill_caps = True
    for path in paths:
        sp = cu.splines.new("POLY")
        sp.points.add(len(path) - 1)
        for i, p in enumerate(path):
            sp.points[i].co = (p[0], p[1], p[2], 1.0)
        sp.use_smooth = True
    ob = bpy.data.objects.new(name, cu)
    coll.objects.link(ob)
    ob.data.materials.append(mat)
    return ob


def mesh_from_verts(name, verts, faces, mat, coll, smooth=True):
    bad = [v for v in verts if v is None or any(not math.isfinite(c) for c in v)]
    if bad:
        print(f"[elf] BAD VERTS in {name}: {len(bad)} / {len(verts)} e.g. {bad[:2]}")
        raise SystemExit(1)
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    me.update()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    ob.data.materials.append(mat)
    return ob


def add_ribbon(name, inner, outer, mat, coll, depth=0.03):
    """Tapered blade-like shape from two 2D polylines (x,z) extruded to thin depth."""
    n = len(inner)
    verts = []
    for i in range(n):
        verts.append((inner[i][0], -depth / 2, inner[i][1]))
        verts.append((inner[i][0], depth / 2, inner[i][1]))
    for i in range(n):
        verts.append((outer[i][0], -depth / 2, outer[i][1]))
        verts.append((outer[i][0], depth / 2, outer[i][1]))
    cnt = 2 * n
    faces = []
    for i in range(n - 1):
        a, b, c, d = i * 2, (i + 1) * 2, (i + 1) * 2 + 1, i * 2 + 1
        faces.append((a, b, c, d))  # inner wall
        a, b, c, d = cnt + i * 2, cnt + (i + 1) * 2, cnt + (i + 1) * 2 + 1, cnt + i * 2 + 1
        faces.append((a, d, c, b))
        a, b, c, d = i * 2, (i + 1) * 2, cnt + (i + 1) * 2, cnt + i * 2
        faces.append((a, d, b, c))  # front face (verts a,b at -y / back at +y -> fix below)
    # proper front/back faces
    faces = faces[:2 * (n - 1)]
    for i in range(n - 1):
        a0, a1 = i * 2, (i + 1) * 2          # back (-y)
        b0, b1 = cnt + i * 2, cnt + (i + 1) * 2
        faces.append((a0, a1, b1, b0))       # back wall
        faces.append((a0 + 1, b0 + 1, b1 + 1, a1 + 1))  # front wall
    ob = mesh_from_verts(name, verts, faces, mat, coll, smooth=False)
    me = ob.data
    me.polygons.foreach_set("use_smooth", [False] * len(me.polygons))
    return ob


def rotate_pts(pts2d, ang_deg, pivot=(0, 0)):
    a = math.radians(ang_deg)
    ca, sa = math.cos(a), math.sin(a)
    out = []
    for x, z in pts2d:
        dx, dz = x - pivot[0], z - pivot[1]
        out.append((pivot[0] + ca * dx - sa * dz, pivot[1] + sa * dx + ca * dz))
    return out


# --------------------------------------------------------------------------- materials
def make_materials():
    mats = {}

    def principled(name, hexc, rough=0.6, metal=0.0, spec=0.5, emit=None, emit_str=0.0, sheen=0.0):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = m.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = srgb(hexc)
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = metal
        if "Specular IOR Level" in bsdf.inputs:
            bsdf.inputs["Specular IOR Level"].default_value = spec
        if "Sheen Weight" in bsdf.inputs and sheen:
            bsdf.inputs["Sheen Weight"].default_value = sheen
            bsdf.inputs["Sheen Roughness"].default_value = 0.45
        if emit is not None:
            bsdf.inputs["Emission Color"].default_value = srgb(emit)
            bsdf.inputs["Emission Strength"].default_value = emit_str
        m.diffuse_color = srgb(hexc)
        return m

    mats["skin"] = principled("ELF_Skin", "#E8CFC0", rough=0.52, spec=0.35)
    mats["eye"] = principled("ELF_Eye_Glow", "#A8F7D4", rough=0.25, emit="#8DF2C6", emit_str=1.2)
    mats["mouth"] = principled("ELF_Mouth", "#8E5F5C", rough=0.6)
    mats["hair"] = principled("ELF_Hair_Platinum", "#E6E1D3", rough=0.48, spec=0.4)   # dark
    mats["hair_shadow"] = principled("ELF_Hair_Shadow", "#D7D1C1", rough=0.55)  # darker clump
    mats["leather"] = principled("ELF_Leather_Dark", "#2C313B", rough=0.42, spec=0.5)
    mats["leather2"] = principled("ELF_Leather_Mid", "#3D4552", rough=0.5)
    mats["cloth"] = principled("ELF_Cloth_Teal", "#263C3B", rough=0.78, sheen=0.35)
    mats["cloth2"] = principled("ELF_Cloth_Scarf", "#1E2B2C", rough=0.8, sheen=0.4)
    mats["metal"] = principled("ELF_Steel", "#B9BFC6", rough=0.22, metal=1.0)
    mats["metal_dark"] = principled("ELF_Steel_Dark", "#5E646C", rough=0.32, metal=1.0)
    mats["gold"] = principled("ELF_Gold", "#B9A06A", rough=0.3, metal=1.0)
    mats["acc"] = principled("ELF_Accent_Emerald", "#3FA07E", rough=0.25, emit="#2FB486", emit_str=0.6)
    mats["wrap"] = principled("ELF_Wraps_Bone", "#CFC8B8", rough=0.7)
    mats["bootstrap"] = principled("ELF_Boots", "#22262E", rough=0.45)
    mats["pouch"] = principled("ELF_Pouch", "#4A3A2C", rough=0.6)
    mats["blade"] = principled("ELF_Blade_Steel", "#AEB6BF", rough=0.16, metal=1.0)
    mats["grip"] = principled("ELF_Grip", "#1B1E24", rough=0.8)
    mats["pommel"] = principled("ELF_Pommel", "#6E5A36", rough=0.4)
    return mats


# --------------------------------------------------------------------------- skeleton (joints)
# World units: metres, feet on z=0, facing -Y, character's left = +X.
ARM_Z = 1.505
SHOULDER_X = 0.185
SHOULDER_MX = 0.125    # deltoid centre
T_ARM = Vector((0, 0, -1))  # arms point down in T-pose-ish (relaxed T/A); see build_arms

J = {
    "root": (0, 0, 0),
    "pelvis": (0, 0, 1.00),
    "spine1": (0, 0, 1.07),
    "spine2": (0, 0, 1.20),
    "chest": (0, 0, 1.33),
    "neck_base": (0, 0, 1.505),
    "head": (0, 0, 1.575),
    "head_top": (0, 0, 1.84),
}
for side, sx in (("L", 1), ("R", -1)):
    J[f"clav_{side}"] = (0.025 * sx, -0.005, 1.49)
    J[f"shoulder_{side}"] = (SHOULDER_X * sx, 0, ARM_Z)
    J[f"upperarm_{side}"] = (0.182 * sx, 0, ARM_Z)   # bicep/arm start after deltoid
    J[f"elbow_{side}"] = (0.515 * sx, 0, ARM_Z)
    J[f"neck_arm_{side}"] = (0.505 * sx, 0, ARM_Z + 0.002)
    J[f"wrist_{side}"] = (0.745 * sx, 0, ARM_Z - 0.004)
    J[f"hand_{side}"] = (0.80 * sx, 0, ARM_Z - 0.006)
    J[f"fingertip_{side}"] = (0.925 * sx, 0, ARM_Z - 0.010)
    J[f"hip_{side}"] = (0.095 * sx, 0, 0.965)
    J[f"knee_{side}"] = (0.092 * sx, -0.006, 0.535)
    J[f"ankle_{side}"] = (0.09 * sx, 0.012, 0.095)
    J[f"toe_{side}"] = (0.09 * sx, -0.135, 0.03)


# --------------------------------------------------------------------------- body parts
def body_v(v, depth, power=2.2):
    """Superellipse cross-section point on the unit circle (angle v): fuller sides / flatter front-back."""
    c, si = math.cos(v), math.sin(v)
    x = math.copysign(abs(c) ** (2.0 / power), c)
    y = math.copysign(abs(si) ** (2.0 / power), si)
    return x, y * (depth if y < 0 else depth * 0.92)


def build_body(M, coll):
    P = M["leather"]
    P2 = M["leather2"]
    C = M["cloth"]
    W = M["wrap"]
    SK = M["skin"]

    # --- torso: ring loft through the spine (broad shoulders, narrow waist)
    torso = [
        (0.915, 0.098, 0.074),
        (0.965, 0.122, 0.084),
        (1.020, 0.130, 0.088),
        (1.075, 0.122, 0.084),
        (1.125, 0.110, 0.077),
        (1.180, 0.106, 0.076),
        (1.240, 0.118, 0.083),
        (1.300, 0.136, 0.090),
        (1.355, 0.153, 0.096),
        (1.400, 0.164, 0.100),
        (1.440, 0.168, 0.097),
        (1.470, 0.160, 0.090),
        (1.495, 0.138, 0.078),
        (1.510, 0.100, 0.062),
        (1.518, 0.070, 0.050),
    ]
    SIDES = 40
    verts, faces = [], []
    for z, hw, hd in torso:
        for k in range(SIDES):
            v = 2 * math.pi * k / SIDES
            x, y = body_v(v, hd)
            verts.append((hw * x, y, z))
    for i in range(len(torso) - 1):
        for k in range(SIDES):
            a_, b_ = i * SIDES + k, i * SIDES + (k + 1) % SIDES
            faces.append((a_, b_, b_ + SIDES, a_ + SIDES))
    faces.append(tuple((len(torso) - 1) * SIDES + k for k in range(SIDES)))
    mesh_from_verts("Torso", verts, faces, P, coll)

    # --- neck
    add_tube("Neck", [(Vector((0, 0.004, 1.455)), Matrix.Identity(3).to_quaternion()),
                      (Vector((0, 0.004, 1.520)), Matrix.Identity(3).to_quaternion()),
                      (Vector((0, 0.006, 1.580)), Matrix.Identity(3).to_quaternion())],
             [0.057, 0.051, 0.049], SK, coll, sides=18)

    # --- chest harness: front straps, back straps, over-shoulder straps (mirrored)
    for S, sx in (("L", 1), ("R", -1)):
        strap_front = [
            (0.120 * sx, -0.096, 1.432), (0.095 * sx, -0.106, 1.370), (0.045 * sx, -0.090, 1.280),
            (0.008 * sx, -0.081, 1.190), (-0.006 * sx, -0.080, 1.115),
        ]
        strap_back = [
            (0.125 * sx, 0.088, 1.430), (0.096 * sx, 0.096, 1.365), (0.045 * sx, 0.080, 1.270),
            (0.008 * sx, 0.074, 1.180), (-0.006 * sx, 0.076, 1.110),
        ]
        over_sh = [(0.132 * sx, -0.086, 1.432), (0.148 * sx, 0.0, 1.466), (0.132 * sx, 0.082, 1.432)]
        add_curve_mesh(f"Harness_{S}", [strap_front], P2, coll, bevel=0.0065)
        add_curve_mesh(f"HarnessB_{S}", [strap_back], P2, coll, bevel=0.0065)
        add_curve_mesh(f"HarnessS_{S}", [over_sh], P2, coll, bevel=0.0068)
        add_sphere(f"Buckle_{S}", (0.090 * sx, -0.104, 1.366), 1.0, M["metal"], coll, scale=(0.006, 0.003, 0.008))
    add_sphere("HarnessRing", (0.0, -0.083, 1.310), 1.0, M["metal_dark"], coll,
               rot=(math.radians(90), 0, 0), scale=(0.017, 0.017, 0.006))
    add_sphere("HarnessGem", (0.0, -0.087, 1.310), 1.0, M["acc"], coll, scale=(0.008, 0.005, 0.008))

    # --- scarf cowl at the neck + short tattered scarf tail over the back
    # back mantle: a shell that hugs the back of the torso (sliced so nothing pokes through the chest)
    mv, mf = [], []
    MR, MS = 12, 40
    for i in range(MR + 1):
        t = i / MR
        z = 1.464 - 0.175 * t
        hw = 0.156 - 0.050 * t + 0.004 * math.sin(t * 3.0)
        hd = 0.084 + 0.010 * t
        for k in range(MS + 1):
            ang = math.radians(-58) + math.radians(296) * k / MS
            x = math.sin(ang) * (hw + 0.014)
            y = 0.004 + math.cos(ang) * (hd + 0.016)
            mv.append((x, y, z))
    for i in range(MR):
        for k in range(MS):
            a_, b_ = i * (MS + 1) + k, i * (MS + 1) + k + 1
            mf.append((a_, b_, b_ + MS + 1, a_ + MS + 1))
    mesh_from_verts("BackMantle", mv, mf, C, coll)
    scarf_tail = [Vector((0.052, 0.078, 1.500)), Vector((0.085, 0.104, 1.430)), Vector((0.105, 0.106, 1.360)),
                  Vector((0.128, 0.092, 1.300))]
    qs = []
    for i, p in enumerate(scarf_tail):
        nxt = scarf_tail[min(i + 1, len(scarf_tail) - 1)]
        prv = scarf_tail[max(i - 1, 0)]
        qs.append((p, (nxt - prv).normalized().to_track_quat("Z", "Y")))
    add_tube("ScarfTail", qs, [(0.034, 0.010), (0.040, 0.009), (0.036, 0.008), (0.018, 0.005)], C, coll, sides=12)

    # --- shoulder pauldrons: layered angular plates, symmetric
    for S, sx in (("L", 1), ("R", -1)):
        add_sphere(f"Pauldron_{S}", (0.172 * sx, 0.0, 1.496), 1.0, P, coll, scale=(0.070, 0.076, 0.030),
                   rot=(0, math.radians(-30 * sx), 0), segs=28, rings=14)
        add_sphere(f"Pauldron2_{S}", (0.208 * sx, 0.0, 1.476), 1.0, P2, coll, scale=(0.046, 0.070, 0.020),
                   rot=(0, math.radians(-45 * sx), 0), segs=24, rings=12)
        add_sphere(f"PauldronTrim_{S}", (0.168 * sx, 0.0, 1.507), 1.0, M["metal_dark"], coll,
                   scale=(0.060, 0.070, 0.006), rot=(0, math.radians(-30 * sx), 0), segs=24, rings=8)
        add_sphere(f"PauldronGem_{S}", (0.220 * sx, 0.0, 1.492), 1.0, M["acc"], coll, scale=(0.008, 0.008, 0.008))
        add_sphere(f"PauldronRivet_{S}", (0.165 * sx, -0.055, 1.503), 1.0, M["gold"], coll, scale=(0.005, 0.005, 0.005))

    # --- arms: STRICT T-pose (upper arm horizontal, 90 deg from torso), palms facing DOWN
    for S in ("L", "R"):
        sx = 1.0 if S == "L" else -1.0
        sh = Vector((0.150 * sx, 0.0, ARM_Z))
        d = Vector((sx, 0.0, 0.0))                      # arm axis: purely horizontal
        q = d.to_track_quat("Z", "Y")
        L_UP, L_LO = 0.288, 0.258                       # upper arm / forearm lengths
        elbow = sh + d * (L_UP + 0.045)                 # visual arm starts under deltoid
        wrist = elbow + d * L_LO
        # deltoid
        add_sphere(f"Deltoid_{S}", sh + d * 0.015, 1.0, P, coll, scale=(0.040, 0.046, 0.050), segs=24, rings=16)
        add_tube(f"Arm_{S}", [(sh, q), (sh + d * 0.08, q), (sh + d * 0.20, q), (elbow, q)],
                 [0.047, 0.046, 0.041, 0.036], SK, coll, sides=16)
        fpts = [(elbow - d * 0.07, q), (elbow, q), (elbow + d * L_LO * 0.45, q), (wrist + d * 0.012, q)]
        add_tube(f"Forearm_{S}", fpts, [0.036, 0.038, 0.040, 0.029], SK, coll, sides=16)
        # leather arm band at the top of the upper arm
        add_sphere(f"ArmBand_{S}", sh + d * 0.105, 1.0, P2, coll,
                   rot=(0, math.radians(90 * sx), 0), scale=(0.046, 0.046, 0.012))
        add_sphere(f"Elbow_{S}", elbow, 1.0, P, coll, scale=(0.022, 0.037, 0.037))
        # rolled leather bracer over the forearm + straps
        # rigid bracer: starts just below the elbow crease and widens toward the wrist
        add_tube(f"Bracer_{S}", [(elbow + d * 0.012, q), (elbow + d * 0.10, q), (wrist - d * 0.010, q)],
                 [(0.040, 0.040), (0.052, 0.050), (0.042, 0.040)], P2, coll, sides=18, close_caps=False)
        add_sphere(f"BracerCap_{S}", wrist - d * 0.006, 1.0, M["metal_dark"], coll,
                   rot=(0, math.radians(90 * sx), 0), scale=(0.042, 0.040, 0.006))
        for uu, rr in ((0.055, 0.046), (0.135, 0.046)):
            add_sphere(f"BrStrap_{S}_{uu}", elbow + d * uu, 1.0, M["leather"], coll,
                       rot=(0, math.radians(90 * sx), 0), scale=(rr, rr, 0.005))
        # bracer point guard on the back of the forearm
        add_sphere(f"BracerPlate_{S}", elbow + d * 0.09 + Vector((0, -0.030, 0.026)), 1.0, M["metal_dark"], coll,
                   rot=(0, math.radians(0), math.radians(-45 * sx)), scale=(0.050, 0.006, 0.016))
        add_sphere(f"ArmStrap_{S}", sh + d * 0.17, 1.0, P, coll,
                   rot=(0, math.radians(90 * sx), 0), scale=(0.042, 0.042, 0.008))
        # fist wrapped around the diagonal dagger grip (fingers curl around the front of the grip)
        fist = Vector((0.80 * sx, 0.0, ARM_Z - 0.004))
        add_sphere(f"Wrist_{S}", wrist, 1.0, SK, coll, scale=(0.024, 0.026, 0.027))
        add_sphere(f"Fist_{S}", fist, 1.0, SK, coll, scale=(0.036, 0.031, 0.040), segs=24, rings=16)
        for fi, zz in enumerate((0.026, 0.009, -0.008, -0.025)):
            add_sphere(f"Finger_{S}_{fi}", fist + Vector((0.004 * sx, -0.027, zz)), 1.0, SK, coll,
                       rot=(0, math.radians(-14 * sx), 0), scale=(0.026, 0.008, 0.0078), segs=16, rings=8)
        add_sphere(f"Thumb_{S}", fist + Vector((-0.006 * sx, -0.026, 0.022)), 1.0, SK, coll,
                   rot=(math.radians(15), 0, math.radians(-30 * sx)), scale=(0.009, 0.021, 0.009), segs=16, rings=8)
        add_sphere(f"WristWrap_{S}", fist + Vector((-0.030 * sx, 0, 0.004)), 1.0, W, coll,
                   rot=(0, math.radians(90 * sx), 0), scale=(0.034, 0.034, 0.008))

    # --- belt + buckle + pouches + flaps
    belt_rings = [(0.990, 0.136, 0.092), (1.010, 0.140, 0.095), (1.048, 0.138, 0.093), (1.062, 0.130, 0.088)]
    bv, bf = [], []
    BS = 40
    for z, hw, hd in belt_rings:
        for k in range(BS):
            v = 2 * math.pi * k / BS
            x, y = body_v(v, hd)
            bv.append((hw * x, y, z))
    for i in range(len(belt_rings) - 1):
        for k in range(BS):
            a_, b_ = i * BS + k, i * BS + (k + 1) % BS
            bf.append((a_, b_, b_ + BS, a_ + BS))
    mesh_from_verts("Belt", bv, bf, M["leather"], coll)
    add_sphere("BeltBuckle", (0, -0.092, 1.026), 1.0, M["metal"], coll, scale=(0.024, 0.008, 0.020))
    add_sphere("BeltGem", (0, -0.099, 1.026), 1.0, M["acc"], coll, scale=(0.011, 0.004, 0.011))
    for k, (ang, ln) in enumerate(((-34, 0.075), (-50, 0.062), (146, 0.075), (162, 0.062))):
        a = math.radians(ang)
        p = Vector((math.sin(a) * 0.128, -math.cos(a) * 0.092, 1.000))
        add_sphere(f"BeltFlap_{k}", p + Vector((0, 0, -ln / 2)), 1.0, P2, coll,
                   scale=(0.020, 0.006, ln / 2), rot=(0, 0, -a))
    add_sphere("Pouch", (0.138, 0.040, 0.952), 1.0, M["pouch"], coll, scale=(0.030, 0.046, 0.044))
    add_sphere("PouchLid", (0.138, 0.040, 0.982), 1.0, M["pouch"], coll, scale=(0.031, 0.048, 0.015))
    add_sphere("PouchBuckle", (0.138, -0.006, 0.975), 1.0, M["metal_dark"], coll, scale=(0.008, 0.006, 0.008))

    # --- tabard: teal front panel over a darker leather panel, plus a back panel
    def panel(name, y, z0, z1, w0, w1, mat, x0=-0.06, x1=0.0, step=10, bulge=0.016):
        vs, fs = [], []
        for i in range(step + 1):
            t = i / step
            z = z0 + (z1 - z0) * t
            xa = x0 - w0 + (x0 - w1 - (x0 - w0)) * t
            xb = x1 + w0 + (x1 + w1 - (x1 + w0)) * t
            yy = y + bulge * math.sin(t * math.pi) * 0.6
            vs += [(xa, yy - 0.005, z), (xb, yy - 0.005, z), (xa, yy + 0.005, z), (xb, yy + 0.005, z)]
        for i in range(step):
            a_ = i * 4
            fs += [(a_, a_ + 4, a_ + 5, a_ + 1), (a_ + 2, a_ + 3, a_ + 7, a_ + 6),
                   (a_, a_ + 2, a_ + 6, a_ + 4), (a_ + 1, a_ + 5, a_ + 7, a_ + 3),
                   (a_ + 4, a_ + 6, a_ + 7, a_ + 5)]
        return mesh_from_verts(name, vs, fs, mat, coll, smooth=False)
    panel("TabardInner", -0.090, 0.995, 0.690, 0.108, 0.098, P2, x0=-0.010, x1=0.010, bulge=0.010)
    panel("TabardFront", -0.094, 0.995, 0.600, 0.078, 0.066, C, x0=-0.010, x1=0.010, bulge=0.014)
    panel("TabardBack", 0.088, 0.995, 0.640, 0.105, 0.096, P2, x0=-0.010, x1=0.010, bulge=0.010)
    panel("TabardBackCloth", 0.092, 0.995, 0.700, 0.072, 0.060, C, x0=-0.010, x1=0.010, bulge=0.014)
    # emerald accents on the tabard
    add_sphere("TabardGem", (0.0, -0.106, 0.930), 1.0, M["metal"], coll, scale=(0.016, 0.004, 0.016))

    # --- side skirt armour (tassets)
    for S, sx in (("L", 1), ("R", -1)):
        for k, (dz, sy, sz) in enumerate(((0.000, 0.064, 0.030), (-0.052, 0.060, 0.024), (-0.094, 0.052, 0.018))):
            add_sphere(f"Tasset_{S}_{k}", (0.130 * sx - 0.004 * k * sx, 0.0, 0.962 + dz), 1.0,
                       P2 if k % 2 == 0 else P, coll, scale=(0.016, sy, sz), rot=(0, math.radians(-12 * sx), 0))
        add_sphere(f"TassetRivet_{S}", (0.144 * sx, -0.040, 0.968), 1.0, M["gold"], coll, scale=(0.005, 0.005, 0.005))

    # --- legs (straight, feet flat and parallel, slight stance)
    for S in ("L", "R"):
        sx = 1.0 if S == "L" else -1.0
        hip = Vector((0.095 * sx, 0, 0.97))
        knee = Vector((0.092 * sx, -0.004, 0.52))
        ank = Vector((0.090 * sx, 0.010, 0.095))
        up_t = (knee - hip)
        uq = up_t.normalized().to_track_quat("Z", "Y")
        add_tube(f"Thigh_{S}", [(hip + Vector((0, 0, 0.03)), uq), (hip + up_t * 0.25, uq),
                                (hip + up_t * 0.60, uq), (knee, uq)],
                 [(0.080, 0.074), (0.079, 0.072), (0.060, 0.057), (0.049, 0.047)], P, coll, sides=18)
        add_sphere(f"ThighStrap_{S}", hip + up_t * 0.80, 1.0, P2, coll, scale=(0.060, 0.057, 0.010))
        lo_t = (ank - knee)
        lq = lo_t.normalized().to_track_quat("Z", "Y")
        add_tube(f"Shin_{S}", [(knee, lq), (knee + lo_t * 0.30, lq), (knee + lo_t * 0.65, lq),
                               (ank + Vector((0, 0, 0.05)), lq)],
                 [(0.049, 0.050), (0.052, 0.056), (0.045, 0.047), (0.037, 0.039)], P, coll, sides=16)
        add_sphere(f"KneeGuard_{S}", knee + Vector((0, -0.026, 0.006)), 1.0, P2, coll,
                   scale=(0.046, 0.030, 0.058), segs=20, rings=12)
        add_sphere(f"KneeStud_{S}", knee + Vector((0, -0.056, 0.006)), 1.0, M["metal_dark"], coll,
                   scale=(0.012, 0.006, 0.012))
        # boot shaft + folded cuff
        boot_top = knee + lo_t * 0.62
        add_tube(f"Boot_{S}", [(boot_top, lq), (ank + Vector((0, 0, 0.02)), lq)],
                 [0.050, 0.043], M["bootstrap"], coll, sides=16)
        add_sphere(f"BootCuff_{S}", boot_top, 1.0, M["bootstrap"], coll, rot=lq.to_euler(), scale=(0.056, 0.056, 0.014))
        # foot: flat sole + slim toe
        fx = 0.090 * sx
        fw = 0.044
        vs = [
            (fx - fw, 0.062, 0.0), (fx + fw, 0.062, 0.0), (fx + fw * 0.88, -0.178, 0.0), (fx - fw * 0.88, -0.178, 0.0),
            (fx - fw * 0.86, 0.052, 0.105), (fx + fw * 0.86, 0.052, 0.105), (fx + fw * 0.76, -0.135, 0.062),
            (fx - fw * 0.76, -0.135, 0.062),
        ]
        fs = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        mesh_from_verts(f"Foot_{S}", vs, fs, M["bootstrap"], coll, smooth=False)
        add_tube(f"FootTip_{S}", [((fx, 0.010, 0.050), Vector((0, -1, 0)).to_track_quat("Z", "Y")),
                                  ((fx, -0.060, 0.050), Vector((0, -1, 0)).to_track_quat("Z", "Y")),
                                  ((fx, -0.150, 0.036), Vector((0, -1, 0)).to_track_quat("Z", "Y"))],
                 [(0.044, 0.048), (0.043, 0.044), (0.034, 0.030)], M["bootstrap"], coll, sides=16)
        add_sphere(f"BootStrap_{S}", (fx, -0.075, 0.080), 1.0, W, coll, scale=(0.047, 0.007, 0.006))
        for k, zb in enumerate((0.27, 0.33, 0.39)):
            add_sphere(f"ShinWrap_{S}_{k}", (0.091 * sx, 0.0, zb), 1.0, W, coll, scale=(0.046, 0.046, 0.007))


    # --- neck
    neck = [
        (Vector((0, 0.0, 1.46)), 0.058),
        (Vector((0, 0.002, 1.52)), 0.052),
        (Vector((0, 0.004, 1.575)), 0.050),
    ]
    add_tube("Neck", [(l, Matrix.Identity(3).to_quaternion()) for l, r in neck], [r for l, r in neck], SK, coll, sides=18)

    # --- chest harness: straps across chest, back and over shoulders + buckles
    for S in ("L", "R"):
        sx = 1.0 if S == "L" else -1.0
        strap_front = [
            (0.130 * sx, -0.088, 1.418), (0.095 * sx, -0.104, 1.36), (0.040 * sx, -0.080, 1.27),
            (0.008 * sx, -0.078, 1.175), (-0.008 * sx, -0.080, 1.09),
        ]
        strap_back = [
            (0.130 * sx, 0.085, 1.418), (0.095 * sx, 0.102, 1.36), (0.040 * sx, 0.080, 1.26),
            (0.008 * sx, 0.074, 1.16), (-0.008 * sx, 0.076, 1.08),
        ]
        over_sh = [(0.145 * sx, -0.075, 1.425), (0.155 * sx, 0.0, 1.452), (0.145 * sx, 0.072, 1.425)]
        add_curve_mesh(f"Harness_{S}", [strap_front], M["leather2"], coll, bevel=0.0065)
        add_curve_mesh(f"HarnessB_{S}", [strap_back], M["leather2"], coll, bevel=0.0065)
        add_curve_mesh(f"HarnessS_{S}", [over_sh], M["leather2"], coll, bevel=0.0068)
        add_sphere(f"Buckle_{sx}", (0.095 * sx, -0.106, 1.352), 0.009, M["metal"], coll, scale=(1, 0.5, 1.2))
    # chest centre ring
    add_sphere("HarnessRing", (0.0, -0.088, 1.305), 0.016, M["metal_dark"], coll, scale=(1, 0.45, 1), rot=(math.radians(90), 0, 0))
    add_sphere("HarnessGem", (0.0, -0.092, 1.305), 0.007, M["acc"], coll, scale=(1, 0.5, 1))

    # --- high collar / cowl of the scarf
    add_sphere("Cowl", (0, 0.008, 1.505), 0.085, C, coll, scale=(1.05, 0.95, 0.95), segs=28, rings=16)
    cverts, cfaces = [], []
    ring = [(-0.07, 0.0), (-0.06, 0.04), (-0.03, 0.065), (0.0, 0.072), (0.03, 0.065), (0.06, 0.04), (0.07, 0.0),
            (0.062, -0.035), (0.03, -0.058), (0.0, -0.062), (-0.03, -0.058), (-0.062, -0.035)]
    for z, sc in ((1.47, 1.0), (1.53, 0.98), (1.58, 0.92)):
        for x, y in ring:
            cverts.append((x * 1.08, 0.01 + y * 1.08, z + (0.012 if y < 0 else 0.0)))
    n = len(ring)
    for i in range(2):
        for k in range(n):
            a = i * n + k
            b = i * n + (k + 1) % n
            cfaces.append((a, b, b + n, a + n))
    mesh_from_verts("ScarfCollar", cverts, cfaces, M["cloth2"], coll)

    # --- shoulder pauldrons: layered angular plates, symmetric
    for S in ("L", "R"):
        sx = 1.0 if S == "L" else -1.0
        add_sphere(f"Pauldron_{S}", (0.172 * sx, 0.0, 1.496), 1.0, P, coll, scale=(0.070, 0.076, 0.030),
                   rot=(0, math.radians(-30 * sx), 0), segs=28, rings=14)
        add_sphere(f"Pauldron2_{S}", (0.208 * sx, 0.0, 1.476), 1.0, P2, coll, scale=(0.046, 0.070, 0.020),
                   rot=(0, math.radians(-45 * sx), 0), segs=24, rings=12)
        add_sphere(f"PauldronTrim_{S}", (0.168 * sx, 0.0, 1.507), 1.0, M["metal_dark"], coll,
                   scale=(0.060, 0.070, 0.006), rot=(0, math.radians(-30 * sx), 0), segs=24, rings=8)
        add_sphere(f"PauldronGem_{S}", (0.220 * sx, 0.0, 1.492), 1.0, M["acc"], coll, scale=(0.008, 0.008, 0.008))
        add_sphere(f"PauldronRivet_{S}", (0.165 * sx, -0.055, 1.503), 1.0, M["gold"], coll, scale=(0.005, 0.005, 0.005))

    # --- arms: STRICT T-pose (upper arm horizontal, 90 deg from torso), palms facing DOWN
    for S in ("L", "R"):
        sx = 1.0 if S == "L" else -1.0
        sh = Vector((0.150 * sx, 0.0, ARM_Z))
        d = Vector((sx, 0.0, 0.0))                      # arm axis: purely horizontal
        q = d.to_track_quat("Z", "Y")
        L_UP, L_LO = 0.288, 0.258                       # upper arm / forearm lengths
        elbow = sh + d * (L_UP + 0.045)                 # visual arm starts under deltoid
        wrist = elbow + d * L_LO
        add_tube(f"Arm_{S}", [(sh + d * 0.03, q), (sh + d * 0.13, q), (elbow, q)],
                 [0.052, 0.049, 0.040], W, coll, sides=16)
        add_tube(f"Forearm_{S}", [(elbow, q), (elbow + d * L_LO * 0.45, q), (wrist + d * 0.012, q)],
                 [0.040, 0.043, 0.032], W, coll, sides=16)
        add_sphere(f"Elbow_{S}", elbow, 0.040, W, coll, scale=(0.85, 1.0, 1.0))
        # rolled leather bracer over the forearm (leaves a little skin at the elbow)
        add_tube(f"Bracer_{S}", [(elbow + d * 0.075, q), (wrist + d * 0.004, q)],
                 [0.048, 0.038], P, coll, sides=16, close_caps=False)
        for uu in (0.10, 0.17):
            add_sphere(f"BrStrap_{S}_{uu}", elbow + d * uu, 1.0, M["leather2"], coll,
                       rot=(0, math.radians(90 * sx), 0), scale=(0.050, 0.050, 0.006))
        # upper-arm strap
        add_sphere(f"ArmStrap_{S}", sh + d * 0.17, 1.0, P2, coll,
                   rot=(0, math.radians(90 * sx), 0), scale=(0.048, 0.048, 0.009))
        # palm (flat, palms down) + four fingers + thumb
        palm = wrist + d * 0.040
        add_sphere(f"Hand_{S}", palm, 1.0, SK, coll, rot=(0, math.radians(90 * sx), 0), scale=(0.052, 0.036, 0.013))
        knuck = wrist + d * 0.080
        for fi, (off, flen) in enumerate(((-0.024, 0.062), (-0.008, 0.070), (0.008, 0.066), (0.024, 0.052))):
            sta = knuck + Vector((0, off, 0)) + d * 0.004
            add_tube(f"Finger_{S}_{fi}", [(sta, q), (sta + d * flen * 0.5, q), (sta + d * flen, q)],
                     [0.0086, 0.0080, 0.0062], SK, coll, sides=8)
        ts = wrist + d * 0.022 + Vector((0, -0.030, -0.004))
        td = (d * 0.55 + Vector((0, -0.83, 0))).normalized()
        add_tube(f"Thumb_{S}", [(ts, td.to_track_quat("Z", "Y")), (ts + td * 0.026, td.to_track_quat("Z", "Y")),
                                (ts + td * 0.052, td.to_track_quat("Z", "Y"))], [0.0105, 0.0095, 0.0075], SK, coll, sides=8)

    # --- belt + buckle + knife pouch
    add_sphere("Belt", (0, 0, 1.02), 0.118, M["leather"], coll, scale=(1.02, 0.76, 0.10), segs=32, rings=10)
    add_sphere("BeltBuckle", (0, -0.088, 1.02), 0.026, M["metal"], coll, scale=(1.1, 0.35, 1.0))
    add_sphere("BeltGem", (0, -0.093, 1.02), 0.011, M["acc"], coll, scale=(1.0, 0.4, 1.0))
    for k, (ang, ln) in enumerate(((-36, 0.07), (-53, 0.06), (146, 0.07), (163, 0.06))):
        a = math.radians(ang)
        p = Vector((math.sin(a) * 0.120, -math.cos(a) * 0.090, 0.995))
        add_sphere(f"BeltFlap_{k}", p + Vector((0, 0, -ln / 2)), 1.0, P2, coll,
                   scale=(0.020, 0.006, ln / 2), rot=(0, 0, -a))
    add_sphere("Pouch", (0.128, 0.03, 0.955), 0.042, M["pouch"], coll, scale=(0.7, 1.1, 1.0))
    add_sphere("PouchLid", (0.128, 0.03, 0.985), 0.044, M["pouch"], coll, scale=(0.72, 1.12, 0.35))

    # --- tabard panels hanging from the belt (front & back) — classic assassin read
    def panel(name, y, z0, z1, w0, w1, mat, x0=-0.07, x1=0.0, step=8):
        vs, fs = [], []
        for i in range(step + 1):
            t = i / step
            z = z0 + (z1 - z0) * t
            xa = x0 - w0 + (x0 - w1 - (x0 - w0)) * t
            xb = x1 + w0 + (x1 + w1 - (x1 + w0)) * t
            yy = y + 0.012 * math.sin(t * math.pi)
            vs.append((xa, yy - 0.006, z))
            vs.append((xb, yy - 0.006, z))
            vs.append((xa, yy + 0.006, z))
            vs.append((xb, yy + 0.006, z))
        for i in range(step):
            a = i * 4
            fs.append((a, a + 4, a + 5, a + 1))
            fs.append((a + 2, a + 3, a + 7, a + 6))
            fs.append((a, a + 2, a + 6, a + 4))
            fs.append((a + 1, a + 5, a + 7, a + 3))
            fs.append((a + 4, a + 6, a + 7, a + 5))
        ob = mesh_from_verts(name, vs, fs, mat, coll, smooth=False)
        return ob
    panel("TabardFront", -0.088, 0.99, 0.62, 0.085, 0.075, C, x0=-0.012, x1=0.012)
    panel("TabardFrontInner", -0.080, 0.99, 0.70, 0.115, 0.105, M["leather"], x0=-0.012, x1=0.012)
    panel("TabardBack", 0.088, 0.99, 0.66, 0.090, 0.080, C, x0=-0.012, x1=0.012)
    # side skirt flaps (armour tassets)
    for S in ("L", "R"):
        sx = 1.0 if S == "L" else -1.0
        add_sphere(f"Tasset_{S}", (0.125 * sx, 0.0, 0.955), 1.0, P2, coll, scale=(0.016, 0.070, 0.060),
                   rot=(0, math.radians(-14 * sx), 0))

    # --- legs (straight, feet flat and parallel, slight stance)
    for S in ("L", "R"):
        sx = 1.0 if S == "L" else -1.0
        hip = Vector((0.095 * sx, 0, 0.97))
        knee = Vector((0.092 * sx, -0.004, 0.52))
        ank = Vector((0.090 * sx, 0.010, 0.095))
        up_t = (knee - hip)
        uq = up_t.normalized().to_track_quat("Z", "Y")
        add_tube(f"Thigh_{S}", [(hip + Vector((0, 0, 0.03)), uq), (hip + up_t * 0.25, uq),
                                (hip + up_t * 0.60, uq), (knee, uq)],
                 [0.080, 0.078, 0.060, 0.049], P, coll, sides=18)
        # thigh strap (extra assassin detail)
        add_sphere(f"ThighStrap_{S}", hip + up_t * 0.78, 1.0, M["leather2"], coll, scale=(0.062, 0.062, 0.010))
        lo_t = (ank - knee)
        lq = lo_t.normalized().to_track_quat("Z", "Y")
        add_tube(f"Shin_{S}", [(knee, lq), (knee + lo_t * 0.30, lq), (knee + lo_t * 0.65, lq),
                               (ank + Vector((0, 0, 0.05)), lq)],
                 [0.049, 0.054, 0.046, 0.038], P, coll, sides=16)
        # angular knee guard (reads in both front and side)
        add_sphere(f"KneeGuard_{S}", knee + Vector((0, -0.026, 0.006)), 1.0, P2, coll,
                   scale=(0.048, 0.030, 0.058), segs=20, rings=12)
        # boot shaft + folded cuff
        boot_top = knee + lo_t * 0.62
        add_tube(f"Boot_{S}", [(boot_top, lq), (ank + Vector((0, 0, 0.02)), lq)],
                 [0.050, 0.043], M["bootstrap"], coll, sides=16)
        add_sphere(f"BootCuff_{S}", boot_top, 1.0, M["bootstrap"], coll, rot=lq.to_euler(), scale=(0.056, 0.056, 0.014))
        # foot: flat sole + slim toe, laces/Wrap accent
        fx = 0.090 * sx
        fw = 0.044
        vs = [
            (fx - fw, 0.062, 0.0), (fx + fw, 0.062, 0.0), (fx + fw * 0.88, -0.178, 0.0), (fx - fw * 0.88, -0.178, 0.0),
            (fx - fw * 0.86, 0.052, 0.105), (fx + fw * 0.86, 0.052, 0.105), (fx + fw * 0.76, -0.135, 0.062),
            (fx - fw * 0.76, -0.135, 0.062),
        ]
        fs = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        mesh_from_verts(f"Foot_{S}", vs, fs, M["bootstrap"], coll, smooth=False)
        add_tube(f"FootTip_{S}", [((fx, 0.010, 0.050), Vector((0, -1, 0)).to_track_quat("Z", "Y")),
                                  ((fx, -0.060, 0.052), Vector((0, -1, 0)).to_track_quat("Z", "Y")),
                                  ((fx, -0.140, 0.040), Vector((0, -1, 0)).to_track_quat("Z", "Y"))],
                 [(0.044, 0.046), (0.044, 0.044), (0.034, 0.030)], M["bootstrap"], coll, sides=16)
        add_sphere(f"BootStrap_{S}", (fx, -0.075, 0.071), 1.0, W, coll, scale=(0.047, 0.008, 0.006))
        # wrapped shin bindings (bone-white wraps, visible in all sides)
        for k, zb in enumerate((0.27, 0.33, 0.39)):
            add_sphere(f"ShinWrap_{S}_{k}", (0.091 * sx, 0.0, zb), 1.0, W, coll, scale=(0.047, 0.047, 0.008))


def build_head(M, coll):
    SK = M["skin"]
    HC = Vector((0, 0.0, 1.705))
    add_sphere("Head", HC, 1.0, SK, coll, scale=(0.098, 0.098, 0.128), segs=40, rings=28)
    add_sphere("Jaw", (0, -0.018, 1.640), 1.0, SK, coll, scale=(0.056, 0.060, 0.040), segs=32, rings=20)
    add_sphere("Chin", (0, -0.048, 1.631), 1.0, SK, coll, scale=(0.020, 0.020, 0.020))
    for S, sx in (("L", 1), ("R", -1)):
        add_sphere(f"Cheek_{S}", (0.045 * sx, -0.060, 1.672), 1.0, SK, coll, scale=(0.026, 0.016, 0.020))
    # --- long pointed ears (strictly mirrored)
    for S, sx in (("L", 1), ("R", -1)):
        ear_pts = [
            (Vector((0.080 * sx, 0.012, 1.696)), 0.027),
            (Vector((0.122 * sx, 0.026, 1.708)), 0.028),
            (Vector((0.162 * sx, 0.042, 1.736)), 0.020),
            (Vector((0.196 * sx, 0.056, 1.766)), 0.010),
            (Vector((0.218 * sx, 0.066, 1.786)), 0.0015),
        ]
        pts = []
        for i, (p, r) in enumerate(ear_pts):
            nxt = ear_pts[min(i + 1, len(ear_pts) - 1)][0]
            prv = ear_pts[max(i - 1, 0)][0]
            d = (nxt - prv).normalized()
            pts.append((p, d.to_track_quat("Z", "Y")))
        add_tube(f"Ear_{S}", pts, [r for _, r in ear_pts], SK, coll, sides=14)
        # inner helix ridge (slightly lighter skin) for form read
        inner = [(p.x - 0.010 * sx, p.y - 0.016, p.z + 0.010) for p, _ in ear_pts[:4]]
        add_curve_mesh(f"EarRidge_{S}", [inner], SK, coll, bevel=0.0035)
        # small silver ear cuff
        ring_c = Vector((0.136 * sx, 0.026, 1.714))
        bpy.ops.mesh.primitive_torus_add(major_radius=0.021, minor_radius=0.0032, location=ring_c,
                                         major_segments=24, minor_segments=8,
                                         rotation=(math.radians(78), 0, math.radians(28 * sx)))
        tor = bpy.context.active_object
        tor.name = f"EarCuff_{S}"
        for c in tor.users_collection:
            c.objects.unlink(tor)
        coll.objects.link(tor)
        tor.data.materials.append(M["metal"])
        for p in tor.data.polygons:
            p.use_smooth = True
    # --- slender straight nose
    add_sphere("Nose", (0, -0.093, 1.676), 1.0, SK, coll, scale=(0.0095, 0.014, 0.024), rot=(math.radians(-8), 0, 0))
    # --- eyes: dark liner + glowing emerald slit (mirrored)
    for S, sx in (("L", 1), ("R", -1)):
        add_sphere(f"EyeSock_{S}", (0.039 * sx, -0.083, 1.710), 1.0, M["leather"], coll,
                   scale=(0.025, 0.010, 0.011), rot=(0, math.radians(-8 * sx), 0))
        add_sphere(f"Eye_{S}", (0.039 * sx, -0.091, 1.709), 1.0, M["eye"], coll,
                   scale=(0.015, 0.006, 0.006), rot=(0, math.radians(-9 * sx), 0))
        add_sphere(f"Brow_{S}", (0.040 * sx, -0.087, 1.724), 1.0, M["hair_shadow"], coll,
                   scale=(0.024, 0.005, 0.004), rot=(0, math.radians(-12 * sx), 0))
    add_sphere("Lips", (0, -0.086, 1.647), 1.0, M["mouth"], coll, scale=(0.022, 0.007, 0.004))

    # --- hair: white-platinum, slicked-back crown, short sides, long low ponytail
    H, HS = M["hair"], M["hair_shadow"]
    add_sphere("HairCap", (0, 0.008, 1.716), 1.0, H, coll, scale=(0.104, 0.108, 0.140), segs=40, rings=24)
    # slicked clumps: start at the hairline (front) and sweep back over the crown to the nape
    for k, xoff in enumerate((-0.072, -0.048, -0.024, 0.0, 0.024, 0.048, 0.072)):
        fr = -0.095 + abs(xoff) * 0.55
        pts3 = [Vector((xoff * 0.55, fr, 1.752 + 0.02 * (1 - abs(xoff) / 0.08))),
                Vector((xoff * 0.95, -0.040, 1.800 + 0.012 * (1 - abs(xoff) / 0.08))),
                Vector((xoff * 1.05, 0.040, 1.806)),
                Vector((xoff * 0.85, 0.100, 1.748)),
                Vector((xoff * 0.50, 0.120, 1.700))]
        qs = []
        for i, p in enumerate(pts3):
            nxt = pts3[min(i + 1, len(pts3) - 1)]
            prv = pts3[max(i - 1, 0)]
            qs.append((p, (nxt - prv).normalized().to_track_quat("Z", "Y")))
        add_tube(f"HairClump_{k}", qs, [0.014, 0.018, 0.018, 0.016, 0.006], HS if k % 3 == 1 else H, coll, sides=10)
    # side-swept temple locks tucked behind the ears
    for S, sx in (("L", 1), ("R", -1)):
        tpts = [Vector((0.060 * sx, -0.082, 1.790)), Vector((0.084 * sx, -0.045, 1.798)),
                Vector((0.092 * sx, 0.010, 1.775)), Vector((0.086 * sx, 0.050, 1.742))]
        qs = []
        for i, p in enumerate(tpts):
            nxt = tpts[min(i + 1, len(tpts) - 1)]
            prv = tpts[max(i - 1, 0)]
            qs.append((p, (nxt - prv).normalized().to_track_quat("Z", "Y")))
        add_tube(f"TempleLock_{S}", qs, [0.012, 0.015, 0.013, 0.004], H, coll, sides=8)
    # ponytail (bound high at the back of the head, falls to the shoulder blades)
    base = Vector((0, 0.108, 1.738))
    pon = [base, Vector((0, 0.148, 1.704)), Vector((0, 0.172, 1.630)), Vector((0, 0.178, 1.540)),
           Vector((0, 0.176, 1.450)), Vector((0, 0.168, 1.360))]
    prad = [0.040, 0.038, 0.033, 0.026, 0.018, 0.003]
    ppts = []
    for i, p in enumerate(pon):
        nxt = pon[min(i + 1, len(pon) - 1)]
        prv = pon[max(i - 1, 0)]
        ppts.append((p, (nxt - prv).normalized().to_track_quat("Z", "Y")))
    add_tube("Ponytail", ppts, prad, H, coll, sides=16)
    for k, off in enumerate(((0.020, 0.008, 0), (-0.020, 0.008, 0), (0.0, 0.024, 0))):
        strand = [p + Vector(off) * (1.0 - 0.45 * (i / 4.0)) for i, p in enumerate(pon[1:])]
        spts = []
        for i, p in enumerate(strand):
            nxt = strand[min(i + 1, len(strand) - 1)]
            prv = strand[max(i - 1, 0)]
            spts.append((p, (nxt - prv).normalized().to_track_quat("Z", "Y")))
        add_tube(f"PonyStrand_{k}", spts, [0.015, 0.013, 0.010, 0.006, 0.002], HS if k == 2 else H, coll, sides=8)
    add_sphere("HairTie", base + Vector((0, 0.030, -0.022)), 1.0, M["gold"], coll,
               rot=(math.radians(40), 0, 0), scale=(0.038, 0.038, 0.011))
    # loose elven spikes at the crown (silhouette read in every ortho view)
    spikes = ((0.040, 0.010, 0.070, 0.00, 0.00), (0.024, 0.045, 0.080, 0.02, 0.00),
              (0.000, 0.010, 0.085, 0.00, 0.00), (0.040, 0.060, 0.055, -0.01, 0.00),
              (0.014, 0.070, 0.070, -0.02, 0.03))
    for k, (sx, sy, lz, ex, ey) in enumerate(spikes):
        for S, m in (("L", 1), ("R", -1)):
            if sx == 0.0 and S == "R":
                continue
            base = Vector((sx * m, sy, 1.790))
            d = Vector((sx * m * 0.6 + ex * m, sy * 0.5 + 0.08 + ey, lz)).normalized()
            q = d.to_track_quat("Z", "Y")
            add_tube(f"HairSpike_{k}_{S}", [(base, q), (base + d * 0.030, q), (base + d * 0.062, q)],
                     [0.015, 0.010, 0.0015], H if k % 2 == 0 else HS, coll, sides=8)


def build_weapons(M, coll):
    """Twin kukri-style daggers held in a reverse T-pose grip: pommel up along the arm axis,
    blade hanging vertically down beside the leg in the horizontal (0,1) hand plane."""
    for S, sx in (("L", 1), ("R", -1)):
        hx = 0.0  # local x offset below; mirrored with sx
        cz = ARM_Z
        q45 = Matrix.Rotation(math.radians(45 * sx), 3, "Y").to_quaternion()   # Z axis -> (+-0.707, 0, -0.707)
        grip_end = Vector((0.80 * sx + 0.707 * 0.062 * sx, 0.0, cz - 0.707 * 0.062))
        # pommel cap sits at the base of the fist (towards the body)
        add_sphere(f"Pommel_{S}", (0.80 * sx - 0.707 * 0.050 * sx, 0, cz + 0.707 * 0.050), 1.0, M["pommel"], coll,
                   scale=(0.020, 0.018, 0.014), rot=(0, math.radians(45 * sx), 0))
        # grip runs diagonally through the flat, palm-down fist
        add_tube(f"Grip_{S}", [((0.80 * sx - 0.707 * 0.050 * sx, 0, cz + 0.707 * 0.050), q45),
                               ((0.80 * sx + 0.040 * sx, 0, cz - 0.040), q45),
                               (grip_end, q45)], [0.016, 0.015, 0.015], M["grip"], coll, sides=12)
        for k in range(4):
            c = Vector((0.80 * sx - 0.707 * 0.038 * sx, 0, cz + 0.707 * 0.038)) + \
                Vector((0.707 * 0.022 * sx, 0, -0.707 * 0.022)) * k
            add_sphere(f"GripWrap_{S}_{k}", c, 1.0, M["wrap"], coll, scale=(0.0172, 0.0165, 0.0172),
                       rot=(0, math.radians(45 * sx), 0))
        # cross-guard (horizontal, along the hand axis)
        add_tube(f"Guard_{S}", [((grip_end.x - 0.050 * sx, 0, grip_end.z - 0.006), Vector((0, 1, 0)).to_track_quat("Z", "Y")),
                                ((grip_end.x, 0, grip_end.z + 0.002), Vector((0, 1, 0)).to_track_quat("Z", "Y")),
                                ((grip_end.x + 0.050 * sx, 0, grip_end.z - 0.006), Vector((0, 1, 0)).to_track_quat("Z", "Y"))],
                 [0.007, 0.010, 0.007], M["metal_dark"], coll, sides=10)
        gx, gz = grip_end.x - 0.707 * 0.009 * sx, grip_end.z - 0.707 * 0.009
        # --- curved kukri blade in the horizontal plane (spine in front, cutting edge behind, hooked tip).
        # A flat oval cross-section is lofted along a smooth curve instead of a rectangular extrude.
        spine_c = [(0.010, 0.000), (-0.026, -0.075), (-0.055, -0.150), (-0.072, -0.225),
                   (-0.065, -0.295), (-0.040, -0.345), (-0.012, -0.372)]
        N = 26
        vs, fs = [], []
        prev = None
        for i in range(N + 1):
            t = i / N
            u = t * (len(spine_c) - 1)
            # smooth (Catmull-Rom) interpolation through the spine control points
            i0 = min(int(u), len(spine_c) - 2)
            p1 = i0
            p0, p2, p3 = max(p1 - 1, 0), p1 + 1, min(p1 + 2, len(spine_c) - 1)
            f = u - i0

            def cr(a):
                q0, q1, q2, q3 = spine_c[p0][a], spine_c[p1][a], spine_c[p2][a], spine_c[p3][a]
                return 0.5 * ((2 * q1) + (-q0 + q2) * f + (2 * q0 - 5 * q1 + 4 * q2 - q3) * f * f +
                              (-q0 + 3 * q1 - 3 * q2 + q3) * f * f * f)
            ys, zs = cr(0), cr(1)
            width = 0.002 + 0.030 * max(0.0, math.sin(math.pi * min(1.0, t * 1.1))) ** 0.55 * (1 - t) ** 0.5
            if t > 0.9:
                width *= (1 - t) / 0.1
            thick = 0.0045 * (1 - 0.55 * t)
            x = gx + ys * sx
            z = gz + zs
            ring = []
            for k in range(8):
                ang = 2 * math.pi * k / 8
                ring.append((x + math.sin(ang) * width, 0.0, z + math.cos(ang) * thick))
            if prev is not None and math.dist(prev, (x, z)) < 1e-5:
                continue
            prev = (x, z)
            vs.extend(ring)
        N = len(vs) // 8 - 1
        for i in range(N):
            for k in range(8):
                a_, b_ = i * 8 + k, i * 8 + (k + 1) % 8
                fs.append((a_, b_, b_ + 8, a_ + 8))
        fs.append(tuple(reversed(range(8))))
        fs.append(tuple(N * 8 + k for k in range(8)))
        mesh_from_verts(f"Blade_{S}", vs, fs, M["blade"], coll, smooth=True)
        # emerald pommel gem
        add_sphere(f"Gem_{S}", (0.80 * sx - 0.707 * 0.050 * sx, -0.015, cz + 0.707 * 0.050), 1.0, M["acc"], coll,
                   scale=(0.007, 0.007, 0.007))
    # belt-mounted throwing knives at the front of the hips (silhouette detail in front/back views)
    for S, sx in (("L", 1), ("R", -1)):
        top = (0.105 * sx, -0.085, 1.000)
        bot = (0.118 * sx, -0.088, 0.880)
        d = Vector(bot) - Vector(top)
        add_tube(f"KnifeHandle_{S}", [(top, d.normalized().to_track_quat("Z", "Y")),
                                      (Vector(top) + d * 0.45, d.normalized().to_track_quat("Z", "Y"))],
                 [0.008, 0.008], M["grip"], coll, sides=8)
        add_tube(f"KnifeBlade_{S}", [(Vector(top) + d * 0.45, d.normalized().to_track_quat("Z", "Y")),
                                     (Vector(bot), d.normalized().to_track_quat("Z", "Y"))],
                 [(0.011, 0.004), (0.001, 0.001)], M["metal"], coll, sides=8)
        add_sphere(f"KnifeGuard_{S}", Vector(top) + d * 0.45, 1.0, M["metal_dark"], coll,
                   scale=(0.017, 0.005, 0.005))
    # sheaths at the back of the belt
    for S, sx in (("L", 1), ("R", -1)):
        top = Vector((0.085 * sx, 0.105, 1.00))
        bot = Vector((0.070 * sx, 0.118, 0.70))
        d = (bot - top)
        add_tube(f"Sheath_{S}", [(top, d.normalized().to_track_quat("Z", "Y")),
                                 (top + d * 0.5, d.normalized().to_track_quat("Z", "Y")),
                                 (bot, d.normalized().to_track_quat("Z", "Y"))], [0.028, 0.025, 0.012],
                 M["leather2"], coll, sides=12)
        add_sphere(f"SheathBand_{S}", top + d * 0.12, 1.0, M["metal_dark"], coll,
                   rot=d.to_track_quat("Z", "Y").to_euler(), scale=(0.030, 0.030, 0.004))


# --------------------------------------------------------------------------- lighting / cameras / world
def setup_world_and_lights(sc):
    world = bpy.data.worlds.new("Studio")
    sc.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Color"].default_value = srgb("#F2F3F5")
    bg.inputs["Strength"].default_value = 1.9      # bright, light studio background (no shadows, no gradient)
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])

    targets = ["ELFSHEET", "ELF_V_FRONT", "ELF_V_RIGHT", "ELF_V_BACK", "ELF_V_LEFT", "ELF_V_TOP"]

    backlights = []

    def area(name, loc, size, energy, color="#FFFFFF", back=False):
        ld = bpy.data.lights.new(name, "AREA")
        ld.shape = "DISK"
        ld.size = size
        ld.energy = energy
        ld.color = srgb(color)[:3]
        ob = bpy.data.objects.new(name, ld)
        ob.location = loc
        ob.rotation_mode = "QUATERNION"
        ob.rotation_quaternion = (-Vector(loc)).to_track_quat("-Z", "Y")
        sc.collection.objects.link(ob)
        # only illuminate the character collections -> the studio floor never receives light,
        # so it renders as a perfectly flat, shadow-free background in every view
        ob.light_linking.receiver_collection = bpy.data.collections["CHARACTER"]
        if back:
            backlights.append(ob)
        return ob

    # Large, soft, symmetric rig placed around the character.
    area("Key", (1.8, -2.3, 2.6), 3.2, 240)
    area("Fill", (-2.3, -1.6, 1.7), 3.6, 100)
    area("RimL", (-1.6, 2.3, 2.2), 3.0, 180, back=True)
    area("RimR", (1.9, 2.2, 2.4), 3.0, 180, back=True)
    area("Top", (0.0, 0.2, 3.4), 3.0, 80)
    area("Bottom", (0.0, -0.4, -1.2), 2.5, 40)
    return backlights


def make_collections(sc):
    """Scene collection + one view-layer collection per camera (for light linking)."""
    root = sc.collection

    def new_coll(name, parent):
        c = bpy.data.collections.new(name)
        parent.children.link(c)
        return c

    char = new_coll("CHARACTER", root)
    studio = new_coll("STUDIO", root)
    lights = new_coll("LIGHTS", root)
    view_tags = ["ELFSHEET", "ELF_V_FRONT", "ELF_V_RIGHT", "ELF_V_BACK", "ELF_V_LEFT", "ELF_V_TOP"]
    for tag in view_tags:
        holder = new_coll(tag, root)
        holder.hide_render = True
        cc = bpy.data.collections.new("CHAR_" + tag)
        cc.hide_render = True
        holder.children.link(cc)
        lc = bpy.data.collections.new("LGT_" + tag)
        lc.hide_render = True
        holder.children.link(lc)
    return char, studio, lights, view_tags


def add_ground(sc):
    me = bpy.data.meshes.new("Backdrop")
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=2, y_segments=2, size=6.0)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("Backdrop", me)
    m = bpy.data.materials.new("BackdropMat")
    m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = srgb("#ECEDEF")
    m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1.0
    me.materials.append(m)
    return ob


def look_at(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def setup_camera(sc, name, loc, target, ortho=None, roll_via_up=None):
    cd = bpy.data.cameras.new(name)
    cd.type = "ORTHO"
    cd.ortho_scale = ortho or ORTHO_SCALE
    cd.clip_start = 0.01
    cd.clip_end = 50
    ob = bpy.data.objects.new(name, cd)
    ob.location = Vector(loc)
    look_at(ob, target)
    sc.collection.objects.link(ob)
    return ob


# --------------------------------------------------------------------------- render
def config_render(sc, samples, res, transparent_bg=False, ambient=True):
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.02
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = "OPENIMAGEDENOISE"
    except Exception:
        pass
    sc.cycles.max_bounces = 6
    sc.cycles.diffuse_bounces = 3
    sc.cycles.glossy_bounces = 3
    sc.cycles.transmission_bounces = 2
    sc.cycles.caustics_reflective = False
    sc.cycles.caustics_refractive = False
    sc.cycles.sample_clamp_indirect = 4.0
    sc.render.film_transparent = transparent_bg
    sc.render.use_persistent_data = True
    sc.render.resolution_x = res
    sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA" if transparent_bg else "RGB"
    sc.render.image_settings.color_depth = "8"
    sc.render.image_settings.compression = 40
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "None"
    sc.view_settings.exposure = 0.0
    sc.view_settings.gamma = 1.0


def render_view(sc, cam, path, samples=None):
    sc.camera = cam
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


# --------------------------------------------------------------------------- sheet compositing
def composite_sheet(views, out_path, quick=False):
    """PIL 2D sheet: analysis overlay (grid, centre lines, T-pose lines, joint guides) + labels."""
    from PIL import Image, ImageDraw, ImageFont, ImageFilter

    W = 1152 if quick else 2300     # per view cell (after analysis overlay)
    PAD = 24 if quick else 48
    ROW1, ROW2 = (W, W), (W, W)
    sheet_w = PAD * 4 + W * 4
    sheet_h = PAD * 3 + W + W
    BG = (247, 247, 248)
    sheet = Image.new("RGB", (sheet_w, sheet_h), BG)

    FONT_DIR = "/System/Library/Fonts/Supplemental/"
    def font(size, bold=True):
        name = "Arial Bold.ttf" if bold else "Arial.ttf"
        try:
            return ImageFont.truetype(FONT_DIR + name, size)
        except Exception:
            return ImageFont.load_default()
    try:
        mono = ImageFont.truetype(FONT_DIR + "DIN Alternate Bold.ttf", int(W * 0.022))
    except Exception:
        mono = font(int(W * 0.022))

    ORDER = ["front", "right", "back", "left"]
    labels = {"front": "FRONT  (-Y)", "right": "RIGHT  (+X)", "back": "BACK  (+Y)", "left": "LEFT  (-X)", "top": "TOP  (+Z)"}

    # identical orthographic scale in every view -> no rescaling between cells
    ims = {k: Image.open(views[k]).convert("RGB") for k in ORDER + ["top"]}

    # analysis overlay geometry in normalized coords (fraction of view size, origin bottom-left)
    JN = {k: (x / ORTHO_SCALE + 0.5, z / ORTHO_SCALE + 0.5) for k, (x, y, z) in J.items()}
    armz_n = ARM_Z / ORTHO_SCALE + 0.5
    HAND_X = 0.925
    GU = (0, 168, 230, 235)      # guide colour
    GROUND = (214, 64, 64, 230)

    def analysis(im, key):
        size = im.size[0]
        sc_ = size / ORTHO_SCALE                      # px per metre
        ox, oy = size * 0.5, size * 0.5               # world origin in px (origin bottom-left)

        def P(x, z):
            return (ox + x * sc_, oy - z * sc_)

        ov = Image.new("RGBA", im.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(ov)
        MINOR, MAJOR = (70, 110, 160, 60), (70, 110, 160, 110)
        # 0.5 m grid aligned to the world origin
        for i in range(-9, 10):
            x = i * 0.5
            px, _ = P(x, 0)
            if 0 <= px <= size:
                d.line([(px, 0), (px, size)], fill=MAJOR if i % 2 == 0 else MINOR, width=2)
            _, py = P(0, x)
            if 0 <= py <= size:
                d.line([(0, py), (size, py)], fill=MAJOR if i % 2 == 0 else MINOR, width=2)
        # ground plane (z = 0) and centre axis
        gx0, gy = P(-1.2, 0)
        gx1, _ = P(1.2, 0)
        d.line([(gx0, gy), (gx1, gy)], fill=GROUND, width=4)
        _, cy = P(0, 0)
        cx, _ = P(0, 0)
        d.line([(cx, 0), (cx, size)], fill=(214, 64, 64, 120), width=2)
        # 0.25 m ruler ticks on the left edge
        for i in range(0, 9):
            _, py = P(0, i * 0.25)
            d.line([(0, py), (size * 0.022 if i % 2 == 0 else size * 0.012, py)], fill=GROUND, width=3)
        # T-pose axis + joint markers
        if key in ("front", "back"):
            y0 = P(0, ARM_Z)[1]
            d.line([(0, y0), (P(-HAND_X - 0.02, 0)[0], y0)], fill=GU, width=4)
            d.line([(P(HAND_X + 0.02, 0)[0], y0), (size, y0)], fill=GU, width=4)
            for nm in ("wrist_L", "wrist_R", "fingertip_L", "fingertip_R", "elbow_L", "elbow_R"):
                px, py = P(*JN[nm])
                w = 8 if nm.startswith("elbow") else 12
                d.line([(px - w, py), (px + w, py)], fill=GU, width=3)
                d.line([(px, py - w), (px, py + w)], fill=GU, width=3)
        if key in ("front", "back", "left", "right"):
            side = "" if key in ("front", "back") else ("_L" if key == "left" else "_R")
            for nm in ("knee", "ankle"):
                if nm + side not in JN:
                    continue
                px, py = P(*JN[nm + side])
                d.ellipse([px - 11, py - 11, px + 11, py + 11], outline=GU, width=3)
        return Image.alpha_composite(im.convert("RGBA"), ov).convert("RGB")

    cells = {}
    for k in ORDER + ["top"]:
        base = Image.open(views[k]).convert("RGB")
        if base.size[0] != W:
            base = base.resize((W, W), Image.LANCZOS)
        cells[k] = analysis(base, k)

    # header labels
    def label_cell(cell, key, sub):
        d = ImageDraw.Draw(cell)
        f1 = font(int(W * 0.030))
        d.rectangle([0, 0, cell.size[0], int(W * 0.075)], fill=(247, 247, 248))
        d.text((int(W * 0.012), int(W * 0.012)), labels[key], font=f1, fill=(20, 24, 30))
        f2 = font(int(W * 0.018), bold=False)
        d.text((cell.size[0] - int(W * 0.012) - d.textlength(sub, font=f2), int(W * 0.026)), sub, font=f2, fill=(90, 96, 104))
        d.rectangle([0, 0, cell.size[0] - 1, cell.size[1] - 1], outline=(205, 208, 213), width=2)
        return cell

    SUBS = {"front": "ortho · -Y", "right": "ortho · +X", "back": "ortho · +Y", "left": "ortho · -X", "top": "ortho · +Z"}
    for k in ORDER + ["top"]:
        cells[k] = label_cell(cells[k], k, SUBS[k])

    for i, k in enumerate(ORDER):
        sheet.paste(cells[k], (PAD + (W + PAD) * i, PAD))
    sheet.paste(cells["top"], (PAD, PAD * 2 + W))

    # palette strip under the top view
    px0 = PAD * 2 + W
    py0 = PAD * 2 + W
    pw = PAD * 2 + W * 3
    ph = W
    draw = ImageDraw.Draw(sheet)
    draw.rectangle([px0, py0, px0 + pw - 1, py0 + ph - 1], outline=(220, 222, 226), width=2)
    fh = font(int(W * 0.026))
    draw.text((px0 + int(W * 0.03), py0 + int(W * 0.03)), "MATERIAL PALETTE  ·  base colours", font=fh, fill=(20, 24, 30))
    sw = [
        ("Skin", "#E8CFC0"), ("Hair (platinum)", "#E6E1D3"), ("Leather (dark)", "#2C313B"), ("Leather (mid)", "#3D4552"),
        ("Cloth (teal)", "#263C3B"), ("Scarf / cowl", "#1E2B2C"), ("Steel", "#B9BFC6"), ("Steel (dark)", "#5E646C"),
        ("Gold", "#B9A06A"), ("Emerald glow", "#3FA07E"), ("Wraps (bone)", "#CFC8B8"), ("Boots", "#22262E"),
        ("Eyes (glow)", "#A8F7D4"), ("Pouch", "#4A3A2C"),
    ]
    if quick:
        sw = sw[:8]
    cols = 7
    cw = (pw - int(W * 0.06)) / cols
    ch = W * 0.12
    for i, (nm, hx) in enumerate(sw):
        r, c = divmod(i, cols)
        x = px0 + W * 0.03 + c * cw
        y = py0 + W * 0.11 + r * ch * 1.35
        rgb = tuple(int(hx[j:j + 2], 16) for j in (1, 3, 5))
        draw.rounded_rectangle([x, y, x + cw * 0.30, y + ch * 0.8], radius=6, fill=rgb, outline=(180, 183, 188), width=2)
        fs = font(int(W * 0.017))
        draw.text((x + cw * 0.32, y + ch * 0.10), nm, font=fs, fill=(30, 34, 40))
        draw.text((x + cw * 0.32, y + ch * 0.42), hx.upper(), font=fs, fill=(110, 116, 124))
    fy = py0 + W * 0.11 + ((len(sw) + cols - 1) // cols) * ch * 1.35 + W * 0.03
    fsm = font(int(W * 0.017), bold=False)
    notes = [
        "Scale: 1 unit = 1 m  ·  character height 1.84 m  ·  every view rendered at one identical orthographic scale",
        "Pose: strict T-pose (arms horizontal, palms facing down), legs vertical, feet flat",
        "Rules: no shadows (viewer rays skip the floor), no perspective, uniform soft area light, no cropping",
        "Grid: 1 m major / 0.5 m minor   ·   red line = ground (z = 0), red vertical = character centre",
        "Cyan: arm axis z = 1.505 m, wrist / fingertip + knee / ankle joint markers",
        "Use for 3D: Front/Back and Left/Right must be mirror-symmetric in silhouette",
    ]
    for i, t in enumerate(notes):
        draw.text((px0 + int(W * 0.03), fy + i * W * 0.032), t, font=fsm, fill=(70, 76, 84))
    sheet.save(out_path)
    return sheet


# --------------------------------------------------------------------------- main
def add_rig(char_coll):
    """Light humanoid armature following the T-pose joints (guides for the 3D artist)."""
    arm = bpy.data.armatures.new("ElfRig")
    rig = bpy.data.objects.new("ElfRig", arm)
    char_coll.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.edit_bones
    bones = []

    def bone(name, head, tail, parent=None, connect=False):
        b = eb.new(name)
        b.head, b.tail = Vector(head), Vector(tail)
        if parent:
            b.parent = eb[parent]
            b.use_connect = connect
        bones.append(name)

    X = 0.90
    bone("root", (0, 0, 0.0), (0, 0.25, 0.0))
    bone("pelvis", (0, 0, 0.98), (0, 0, 1.08), "root")
    bone("spine", (0, 0, 1.08), (0, 0, 1.24), "pelvis", True)
    bone("chest", (0, 0, 1.24), (0, 0, 1.45), "spine", True)
    bone("neck", (0, 0, 1.47), (0, 0.006, 1.58), "chest")
    bone("head", (0, 0.006, 1.58), (0, 0.006, 1.84), "neck", True)
    for S, sx in (("L", 1), ("R", -1)):
        bone(f"clavicle.{S}", (0.02 * sx, 0, 1.47), (0.185 * sx, 0, ARM_Z), "chest")
        bone(f"upperarm.{S}", (0.185 * sx, 0, ARM_Z), (0.515 * sx, 0, ARM_Z), f"clavicle.{S}", True)
        bone(f"forearm.{S}", (0.515 * sx, 0, ARM_Z), (0.745 * sx, 0, ARM_Z - 0.004), f"upperarm.{S}", True)
        bone(f"hand.{S}", (0.745 * sx, 0, ARM_Z - 0.004), (0.80 * sx, 0, ARM_Z - 0.006), f"forearm.{S}", True)
        bone(f"fingers.{S}", (0.80 * sx, 0, ARM_Z - 0.006), (X * sx, 0, ARM_Z - 0.006), f"hand.{S}", True)
        bone(f"thumb.{S}", (0.80 * sx, -0.02, ARM_Z - 0.01), (0.84 * sx, -0.045, ARM_Z - 0.02), f"hand.{S}")
        bone(f"thigh.{S}", (0.095 * sx, 0, 0.96), (0.092 * sx, -0.004, 0.52), "pelvis")
        bone(f"shin.{S}", (0.092 * sx, -0.004, 0.52), (0.090 * sx, 0.010, 0.095), f"thigh.{S}", True)
        bone(f"foot.{S}", (0.090 * sx, 0.010, 0.095), (0.090 * sx, -0.13, 0.03), f"shin.{S}", True)
        bone(f"toe.{S}", (0.090 * sx, -0.13, 0.03), (0.090 * sx, -0.185, 0.02), f"foot.{S}", True)
    bpy.ops.object.mode_set(mode="OBJECT")
    rig.show_in_front = True
    arm.display_type = "STICK"
    return rig, bones


def export_glb(char_coll, path):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in char_coll.objects:
        if ob.type == "MESH":
            ob.select_set(True)
    bpy.context.view_layer.objects.active = next((o for o in char_coll.objects if o.type == "MESH"), None)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                              export_yup=True)


def export_rig_bvh(rig, path, frames=60):
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, frames
    prev = rig.animation_data
    if prev is None:
        rig.animation_data_create()
    rig.animation_data.action = None
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_anim.bvh(filepath=path, frame_start=1, frame_end=frames, global_scale=1.0, rotate_mode="NATIVE",
                            root_transform_only=False)


def save_blend(path):
    bpy.ops.wm.save_as_mainfile(filepath=path, copy=True)


def make_exports():
    char = bpy.data.collections["CHARACTER"]
    rig = bpy.data.objects["ElfRig"]
    export_glb(char, os.path.join(OUT, "ElfAssassin_proxy_lowpoly.glb"))
    export_rig_bvh(rig, os.path.join(OUT, "ElfAssassin_Tpose_rig.bvh"))
    save_blend(os.path.join(OUT, "ElfAssassin_proxy.blend"))


def contact_sheet(views, out_path):
    import numpy as np
    """Silhouette contact sheet: white cut-outs on a flat grey field + joint guides (mirror check)."""
    from PIL import Image, ImageDraw, ImageFont, ImageFilter
    W = 900
    BG = (168, 170, 174)
    FONT = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
    try:
        f = ImageFont.truetype(FONT, 30)
    except Exception:
        f = ImageFont.load_default()
    ORDER = [("front", "FRONT  -Y"), ("right", "RIGHT  +X"), ("back", "BACK  +Y"), ("left", "LEFT  -X"),
             ("top", "TOP  +Z")]
    sheet = Image.new("RGB", (W * 5 + 20 * 6, W + 150), (236, 237, 239))
    d = ImageDraw.Draw(sheet)
    d.text((30, 40), "SILHOUETTE CONTACT  ·  left = right (mirror check)", font=f, fill=(30, 34, 40))
    for i, (k, lab) in enumerate(ORDER):
        im = Image.open(views[k]).convert("RGB").resize((W, W), Image.LANCZOS)
        arr = np.asarray(im, dtype=np.int16)
        r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
        bgm = (np.abs(r - g) < 7) & (np.abs(g - b) < 7) & (r > 140) & (r < 195)
        mask = Image.fromarray(np.where(bgm, 0, 255).astype(np.uint8), "L").filter(ImageFilter.MaxFilter(3))
        cut = Image.new("RGB", im.size, (255, 255, 255))
        cell = Image.new("RGB", im.size, BG)
        cell.paste(cut, (0, 0), mask)
        dd = ImageDraw.Draw(cell)
        # centre + arm line guides
        dd.line([(0, W // 2), (W, W // 2)], fill=(120, 122, 126), width=2)
        cd = mask.size[0]
        if k in ("front", "back"):
            ay = int((1 - (ARM_Z / ORTHO_SCALE + 0.5)) * W)
            dd.line([(0, ay), (W, ay)], fill=(0, 150, 210), width=3)
        x0 = 20 + (W + 20) * i
        sheet.paste(cell, (x0, 100 + 20))
        d.text((x0, 110 + W + 10), lab, font=f, fill=(30, 34, 40))
    sheet.save(out_path)


def main():
    if "--post" in argv:
        # re-composite sheets / exports from already rendered views (no re-render)
        if not NO_EXPORT:
            bpy.ops.wm.read_factory_settings(use_empty=True)
            M_ = make_materials()
            char, studio, lights, view_tags = make_collections(bpy.context.scene)
            build_body(M_, char)
            build_head(M_, char)
            build_weapons(M_, char)
            add_rig(char)
            make_exports()
        print("[elf] post done")
        return
    sc = reset_scene()
    M = make_materials()
    char, studio, lights, view_tags = make_collections(sc)

    build_body(M, char)
    build_head(M, char)
    build_weapons(M, char)
    rig, _ = add_rig(char)
    ground = add_ground(sc)
    studio.objects.link(ground)

    backlights = setup_world_and_lights(sc)
    # move lights into LIGHTS + every view tag so receivers can be resolved
    for ob in list(sc.collection.objects):
        if ob.type == "LIGHT":
            sc.collection.objects.unlink(ob)
            lights.objects.link(ob)
            for tag in view_tags:
                bpy.data.collections["LGT_" + tag].objects.link(ob)

    # link the character into every view collection (each camera only sees its own copy)
    for tag in view_tags:
        for ob_ in list(char.objects):
            bpy.data.collections["CHAR_" + tag].objects.link(ob_)

    TARGET = (0, 0, 0.96)
    D = 8.0
    cams = {
        "front": setup_camera(sc, "CAM_front", (0, -D, 0.96), TARGET),
        "right": setup_camera(sc, "CAM_right", (D, 0, 0.96), TARGET),
        "back": setup_camera(sc, "CAM_back", (0, D, 0.96), TARGET),
        "left": setup_camera(sc, "CAM_left", (-D, 0, 0.96), TARGET),
        "top": setup_camera(sc, "CAM_top", (0, 0, D + 0.96), (0, 0, 0.96)),
    }
    # TOP: look straight down, with the character's face (-Y) pointing UP in the image.
    top = cams["top"]
    up = Vector((0, -1, 0))
    dvec = Vector((0, 0, -1))
    right = dvec.cross(up)
    fwd = -dvec
    rot = Matrix((right, up, fwd)).transposed().to_4x4()   # columns X=right, Y=up, Z=backward
    top.rotation_euler = rot.to_quaternion().to_euler()

    def view_visibility(active_tag, include_ground):
        for tag in view_tags:
            bpy.data.collections["CHAR_" + tag].hide_render = (tag != active_tag)
        ground.hide_render = not include_ground

    SAMPLES = 16 if QUICK else 120
    config_render(sc, SAMPLES, int(S * SS), transparent_bg=False)
    t0 = __import__("time").time()
    views = {}
    for i, (k, cam) in enumerate(cams.items()):
        tag = "ELF_V_" + k.upper()
        view_visibility(tag, include_ground=(k != "top"))
        back = k != "front"
        bpy.data.lights["RimL"].energy = 180 if back else 0
        bpy.data.lights["RimR"].energy = 180 if back else 0
        path = os.path.join(VIEWS_DIR, f"elf_assassin_{k}.png")
        render_view(sc, cam, path)
        views[k] = path
        print(f"[elf] rendered {k} in {__import__('time').time() - t0:.1f}s")

    if not QUICK:
        try:
            composite_sheet(views, os.path.join(OUT, "ElfAssassin_turnaround.png"))
            contact_sheet(views, os.path.join(VIEWS_DIR, "contact_silhouettes.png"))
            print("[elf] sheets written")
        except Exception as e:
            import traceback
            traceback.print_exc()

    if not NO_EXPORT and not QUICK:
        try:
            make_exports()
            print("[elf] proxy glb / rig bvh / blend written")
        except Exception as e:
            import traceback
            traceback.print_exc()
            print("[elf] export failed:", e)


main()
