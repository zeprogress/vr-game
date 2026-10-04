"""
Подготовка модели под ZEP GAME (персонаж, моб, проп) одним прогоном — без ручной возни в Blender.

Аргументы: <вход> <выход.glb> [опции]
  --height 1.8        рост (по габариту) — модель масштабируется целиком; ступни ставятся на 0
  --rotz 180          повернуть вокруг вертикали (если модель смотрит не в «спереди» = −Y Blender)
  --tris 4000         не больше стольких треугольников (Decimate по мешам пропорционально)
  --palette 8         текстуру → K плоских цветов (k-means по цвету граней), текстуры удаляются
  --clips "Idle_X=Idle,Punch_X=Attack"   переименовать клипы (по началу имени, без регистра)
  --keep Idle,Walk,Run,Attack,HitReact,Death   оставить только эти клипы (после переименования)
  --merge             слить меши одного скелета (меньше отрисовок)
Итог: JSON как у inspect + warnings (бюджеты и обязательные клипы).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
import numpy as np  # noqa: E402
import zep_lib as z  # noqa: E402

a = z.args()
src, out = a[0], a[1]
height = z.opt(a, "--height")
rotz = float(z.opt(a, "--rotz", "0"))
tris_max = z.opt(a, "--tris")
palette = z.opt(a, "--palette")
clip_map = z.opt(a, "--clips")
keep = z.opt(a, "--keep")
merge = "--merge" in a
z.load(src)
warnings = []
scene = bpy.context.scene
# Бесхозные служебные меши (Icosphere у корня и т.п.) — долой, иначе портят рост и попадают в игру.
for o in z.strays():
    warnings.append(f"удалён бесхозный меш {o.name}")
    bpy.data.objects.remove(o)

# ---- корень: всё под один пустой узел, чтобы масштаб/поворот применить целиком ----
roots = [o for o in scene.objects if o.parent is None]
pivot = bpy.data.objects.new("zep_pivot", None)
scene.collection.objects.link(pivot)
for o in roots:
    o.parent = pivot
if rotz:
    pivot.rotation_euler[2] = math.radians(rotz)
bpy.context.view_layer.update()
if height:
    lo, hi = z.world_bbox()
    h = hi[2] - lo[2]
    if h > 1e-6:
        pivot.scale = [float(height) / h] * 3
bpy.context.view_layer.update()
lo, hi = z.world_bbox()
pivot.location[2] -= lo[2]
bpy.context.view_layer.update()

# Применить трансформ корня к детям (скелет/меши хранят свой масштаб — так экспорт чище).
bpy.ops.object.select_all(action="DESELECT")
for o in scene.objects:
    if o.parent == pivot:
        o.select_set(True)
bpy.context.view_layer.objects.active = next(iter(scene.objects))
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
bpy.data.objects.remove(pivot)
for o in scene.objects:
    if o.type in ("MESH", "ARMATURE", "EMPTY"):
        o.select_set(True)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def apply_first(o, md_name):
    """Модификатор — в начало стека и применить (скелет остаётся)."""
    bpy.context.view_layer.objects.active = o
    while o.modifiers[0].name != md_name:
        bpy.ops.object.modifier_move_up(modifier=md_name)
    bpy.ops.object.modifier_apply(modifier=md_name)


# ---- слить меши одного скелета ----
if merge:
    groups = {}
    for o in z.meshes():
        arm = next((md.object for md in o.modifiers if md.type == "ARMATURE" and md.object), None)
        groups.setdefault(arm.name if arm else "", []).append(o)
    for objs in groups.values():
        if len(objs) < 2:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.join()

# ---- урезать треугольники ----
total = sum(z.tri_count(o) for o in z.meshes())
if tris_max and total > int(tris_max):
    ratio = int(tris_max) / total
    for o in z.meshes():
        if o.data.shape_keys:
            warnings.append(f"{o.name}: shape keys — Decimate пропущен")
            continue
        md = o.modifiers.new("ZepDecimate", "DECIMATE")
        md.ratio = ratio
        md.use_collapse_triangulate = True
        apply_first(o, md.name)


# ---- палитра: текстура → K плоских цветов ----
def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


if palette:
    K = int(palette)
    cols, weights, faces = [], [], []
    img_cache = {}
    for o in z.meshes():
        me = o.data
        uv = me.uv_layers.active
        for p in me.polygons:
            mat = o.material_slots[p.material_index].material if o.material_slots else None
            base = np.array([0.8, 0.8, 0.8])
            img = None
            if mat and mat.use_nodes:
                for n in mat.node_tree.nodes:
                    if n.type == "BSDF_PRINCIPLED":
                        base = np.array(n.inputs["Base Color"].default_value[:3])
                    if n.type == "TEX_IMAGE" and n.image and img is None:
                        img = n.image
            c = base
            if img is not None and uv is not None:
                if img.name not in img_cache:
                    w, hh = img.size
                    px = np.array(img.pixels[:], dtype=np.float32).reshape(hh, w, img.channels)[..., :3]
                    img_cache[img.name] = (px, w, hh)
                px, w, hh = img_cache[img.name]
                u = sum(uv.data[li].uv[0] for li in p.loop_indices) / p.loop_total
                v = sum(uv.data[li].uv[1] for li in p.loop_indices) / p.loop_total
                x = int((u % 1.0) * (w - 1))
                y = int((v % 1.0) * (hh - 1))
                c = srgb_to_lin(px[y, x]) * base
            cols.append(c)
            weights.append(max(p.area, 1e-6))
            faces.append((o, p.index))
    X = np.array(cols)
    W = np.array(weights)
    # k-means++ с весами по площади граней.
    rng = np.random.default_rng(7)
    centers = [X[rng.choice(len(X), p=W / W.sum())]]
    for _ in range(1, min(K, len(X))):
        d = np.min(((X[:, None, :] - np.array(centers)[None]) ** 2).sum(-1), axis=1) * W
        centers.append(X[rng.choice(len(X), p=d / d.sum())] if d.sum() > 0 else X[rng.integers(len(X))])
    C = np.array(centers)
    for _ in range(15):
        lab = np.argmin(((X[:, None, :] - C[None]) ** 2).sum(-1), axis=1)
        for k in range(len(C)):
            m = lab == k
            if m.any():
                C[k] = (X[m] * W[m, None]).sum(0) / W[m].sum()
    mats = []
    for k, c in enumerate(C):
        m = bpy.data.materials.new(f"Pal_{k}")
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = (float(c[0]), float(c[1]), float(c[2]), 1)
        bsdf.inputs["Roughness"].default_value = 0.9
        mats.append(m)
    for o in z.meshes():
        o.data.materials.clear()
        for m in mats:
            o.data.materials.append(m)
    for (o, pi), k in zip(faces, lab):
        o.data.polygons[pi].material_index = int(k)
    for img in list(bpy.data.images):
        bpy.data.images.remove(img)

# ---- клипы: переименовать, отобрать ----
if clip_map:
    for pair in clip_map.split(","):
        if "=" not in pair:
            continue
        s, d = pair.split("=", 1)
        for act in bpy.data.actions:
            if act.name.lower().startswith(s.strip().lower()):
                act.name = d.strip()
                break
if keep:
    want = {k.strip().lower() for k in keep.split(",")}
    for act in list(bpy.data.actions):
        if act.name.lower() not in want:
            bpy.data.actions.remove(act)
# Экспорт берёт имена из дорожек NLA — приводим к именам действий.
for arm in z.armatures():
    ad = arm.animation_data
    if not ad:
        continue
    for tr in list(ad.nla_tracks):
        strips = [s for s in tr.strips if s.action]
        if not strips:
            ad.nla_tracks.remove(tr)
            continue
        tr.name = strips[0].action.name

# ---- выгрузка ----
os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLB",
    export_animations=True,
    export_skins=True,
    export_apply=True,
    export_yup=True,
    export_texcoords=not bool(palette),
    export_normals=True,
)

# ---- проверка бюджетов ----
tris = sum(z.tri_count(o) for o in z.meshes())
bones = sum(len(o.data.bones) for o in z.armatures())
names = [act.name for act in bpy.data.actions]
lo, hi = z.world_bbox()
if tris_max and tris > int(tris_max) * 1.05:
    warnings.append(f"треугольников {tris} > бюджета {tris_max}")
if bones > 64:
    warnings.append(f"костей {bones} > 64 (скиннинг на Quest)")
n_mats = len({s.material.name for o in z.meshes() for s in o.material_slots if s.material})
if n_mats > 10:
    warnings.append(f"материалов {n_mats} > 10")
if z.armatures():
    for need in ("Idle", "Walk", "Run", "Attack", "Death"):
        if not any(n.lower().startswith(need.lower()) for n in names):
            warnings.append(f"нет клипа {need}")
z.emit({
    "out": out,
    "tris": tris,
    "materials": n_mats,
    "bones": bones,
    "clips": names,
    "height": round(hi[2] - lo[2], 3),
    "minZ": round(lo[2], 3),
    "fileKB": round(os.path.getsize(out) / 1024),
    "warnings": warnings,
})
