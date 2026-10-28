import bpy, json
from mathutils import Vector
bpy.ops.wm.open_mainfile(filepath="/Users/zep/ASSETS/3D/human/Human50k_game_anim.blend")
arm = bpy.data.objects["HumanRig"]; scn = bpy.context.scene
arm.animation_data_create(); arm.animation_data.action = bpy.data.actions["Fist"]; scn.frame_set(12)
out = {}
for side, S in (("Right", "R"), ("Left", "L")):
    H = arm.pose.bones[f"{side}Hand"].matrix  # armature space
    Hi = H.inverted()
    loc = lambda p: Hi @ p
    pb = arm.pose.bones
    mcp = {f: loc(pb[f"{side}_{f}1"].head) for f in ("Index", "Middle", "Ring", "Pinky")}
    pip = {f: loc(pb[f"{side}_{f}2"].head) for f in ("Index", "Middle", "Ring", "Pinky")}
    dip = {f: loc(pb[f"{side}_{f}3"].head) for f in ("Index", "Middle", "Ring", "Pinky")}
    tip = {f: loc(pb[f"{side}_{f}3"].tail) for f in ("Index", "Middle", "Ring", "Pinky")}
    T = (mcp["Index"] - mcp["Pinky"]).normalized()           # через кулак, к большому пальцу
    Lh = Vector((0, 1, 0)); Lh = (Lh - T * Lh.dot(T)).normalized()  # вдоль кисти
    N = Lh.cross(T)
    # центр рукояти: в плоскости сечения (среднего пальца) — между костяшкой, средним суставом и кончиком
    sect = [mcp["Middle"], pip["Middle"], dip["Middle"], tip["Middle"]]
    c = sum(sect, Vector()) / 4
    across = (sum(mcp.values(), Vector()) / 4)
    c = c - T * (c - across).dot(T)  # по оси хвата — середина костяшек
    out[S] = {"T": list(T), "L": list(Lh), "N": list(N), "C": list(c),
              "mcp": list(mcp["Middle"]), "pip": list(pip["Middle"]), "tip": list(tip["Middle"])}
print("GRIP", json.dumps(out))
