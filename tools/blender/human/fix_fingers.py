"""
Пальцы рига по сетке: у Human50k_rig_lowZEP кости пальцев стоят у запястья и зеркально перепутаны.
Находим пальцы меша (за костяшками они распадаются на 4 куска + большой палец снизу-спереди),
ставим по три фаланги от костяшки к кончику и пересчитываем веса только на кистях.
Ось X рига — вдоль рук (левая +x), -y — перёд (большой палец), z — вверх; ладони вниз.
"""
import bpy
from mathutils import Vector

SRC = "/Users/zep/ASSETS/3D/human/Human50k_rig_lowZEP.blend"
OUT = "/Users/zep/ASSETS/3D/human/Human50k_rig_lowZEP_fingers.blend"
bpy.ops.wm.open_mainfile(filepath=SRC)
arm = bpy.data.objects["HumanRig"]
body = bpy.data.objects["node_0"]
me = body.data
W = body.matrix_world
AW = arm.matrix_world
AWi = AW.inverted()
P = [W @ v.co for v in me.vertices]
adj = {}
for e in me.edges:
    a, b = e.vertices
    adj.setdefault(a, []).append(b)
    adj.setdefault(b, []).append(a)


def comps(S):
    seen = set()
    out = []
    for s in S:
        if s in seen:
            continue
        st = [s]
        c = []
        seen.add(s)
        while st:
            v = st.pop()
            c.append(v)
            for n in adj.get(v, []):
                if n in S and n not in seen:
                    seen.add(n)
                    st.append(n)
        out.append(c)
    return sorted(out, key=len, reverse=True)


def mean(ids):
    return sum((P[i] for i in ids), Vector()) / len(ids)


report = {}
plan = {}  # имя кости → (head, tail) в мире
for side, s in (("Left", 1.0), ("Right", -1.0)):
    U = lambda p: s * p.x  # вдоль руки
    wrist = AW @ arm.data.bones[f"{side}Hand"].head_local
    uw = U(wrist)
    hand_ids = [i for i, p in enumerate(P) if U(p) > uw - 0.01 and abs(p.y - wrist.y) < 0.09 and abs(p.z - wrist.z) < 0.09]
    umax = max(U(P[i]) for i in hand_ids)
    L = umax - uw  # длина кисти
    # четыре пальца — куски за линией, где они расходятся
    fingers = None
    for f in (0.62, 0.65, 0.68, 0.72, 0.76):
        cs = comps({i for i in hand_ids if U(P[i]) > uw + f * L})
        cs = [c for c in cs if len(c) >= 4]
        if len(cs) >= 4:
            fingers = cs[:4]
            cut = f
            break
    assert fingers, f"{side}: не нашёл 4 пальца"
    fingers.sort(key=lambda c: mean(c).y)  # от большого пальца (-y) к мизинцу
    # большой палец — ниже ладони со стороны -y
    zc = wrist.z
    thumb_cs = comps({i for i in hand_ids if U(P[i]) > uw + 0.12 * L and U(P[i]) < uw + 0.75 * L
                      and P[i].y < wrist.y + 0.005 and P[i].z < zc - 0.025})
    thumb = thumb_cs[0]
    knuckle_u = uw + 0.47 * L
    for name, c in zip(("Index", "Middle", "Ring", "Pinky"), fingers):
        tipv = max(c, key=lambda i: U(P[i]))
        near_tip = [i for i in c if (P[i] - P[tipv]).length < 0.012]
        tip = mean(near_tip)
        tip = tip + (P[tipv] - tip) * 0.7  # почти до кончика
        mid = mean(c)
        d = (tip - mid).normalized()
        # костяшка — продолжение линии пальца назад до knuckle_u
        t = (knuckle_u - U(mid)) / (s * d.x)
        base = mid + d * t
        base.z = mid.z + (base.z - mid.z) * 0.5
        plan[f"{side}_{name}"] = (base, tip)
    # мизинец короткий и за линией виден лишь кончик — костяшку ставим в ряд с остальными
    bi, bm, br = (plan[f"{side}_{n}"][0] for n in ("Index", "Middle", "Ring"))
    pt = plan[f"{side}_Pinky"][1]
    pb = br + (br - bm)
    pb.z = br.z - 0.004
    plan[f"{side}_Pinky"] = (pb, pt)
    tipv = max(thumb, key=lambda i: (P[i] - wrist).length)
    near_tip = [i for i in thumb if (P[i] - P[tipv]).length < 0.012]
    ttip = mean(near_tip)
    ttip = ttip + (P[tipv] - ttip) * 0.7
    idx_base = plan[f"{side}_Index"][0]
    tbase = wrist + (idx_base - wrist) * 0.3
    tbase.y = idx_base.y - 0.006
    tbase.z = wrist.z - 0.012
    plan[f"{side}_Thumb"] = (tbase, ttip)
    report[side] = {"hand_len": round(L, 3), "cut": cut, "finger_sizes": [len(c) for c in fingers], "thumb": len(thumb)}

# кости: три фаланги на палец
SPLIT = {"Thumb": (0.4, 0.3, 0.3), "Index": (0.45, 0.3, 0.25), "Middle": (0.45, 0.3, 0.25),
         "Ring": (0.45, 0.3, 0.25), "Pinky": (0.45, 0.3, 0.25)}
bpy.context.view_layer.objects.active = arm
for o in bpy.context.selected_objects:
    o.select_set(False)
arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
eb = arm.data.edit_bones
segs = {}  # кость → (head, tail) в мире, для весов
for key, (base, tip) in plan.items():
    side, fing = key.split("_")
    parts = SPLIT[fing]
    a = 0.0
    prev = eb[f"{side}Hand"]
    for i, w in enumerate(parts, 1):
        h = base + (tip - base) * a
        a += w
        t = base + (tip - base) * a
        nm = f"{key}{i}"
        b = eb.get(nm) or eb.new(nm)
        b.head = AWi @ h
        b.tail = AWi @ t
        b.parent = prev
        b.use_connect = i > 1
        # рулон: z кости — вверх (тыл ладони), чтобы сгиб шёл вокруг локального X
        b.align_roll(AWi.to_3x3() @ Vector((0, 0, 1)))
        segs[nm] = (h, t)
        prev = b
bpy.ops.object.mode_set(mode='OBJECT')

# веса кисти: ближайшие отрезки (предплечье, ладонь, фаланги), обратный квадрат расстояния в 4-й, два лучших
def seg_dist(p, h, t):
    d = t - h
    k = max(0.0, min(1.0, (p - h).dot(d) / max(1e-9, d.length_squared)))
    return (p - (h + d * k)).length

groups = {g.name: g for g in body.vertex_groups}
def grp(n):
    if n not in groups:
        groups[n] = body.vertex_groups.new(name=n)
    return groups[n]

# старые веса пальцев (от кривых костей) — со всей сетки
import re
for g in body.vertex_groups:
    if re.match(r"^(Left|Right)_(Thumb|Index|Middle|Ring|Pinky)\d$", g.name):
        g.remove(list(range(len(me.vertices))))

for side, s in (("Left", 1.0), ("Right", -1.0)):
    hb = arm.data.bones[f"{side}Hand"]
    fb = arm.data.bones[f"{side}ForeArm"]
    wrist = AW @ hb.head_local
    palm_end = sum((plan[f"{side}_{f}"][0] for f in ("Index", "Middle", "Ring", "Pinky")), Vector()) / 4
    cand = {f"{side}ForeArm": (AW @ fb.head_local, AW @ fb.tail_local), f"{side}Hand": (wrist, palm_end)}
    cand.update({n: v for n, v in segs.items() if n.startswith(side + "_")})
    knuckle_u = s * palm_end.x
    names = [g.name for g in body.vertex_groups]
    for i, p in enumerate(P):
        u = s * p.x
        if u < s * wrist.x - 0.02 or abs(p.y - wrist.y) > 0.09 or abs(p.z - wrist.z) > 0.09:
            continue
        # сначала палец (ближайшая цепочка), потом вес между его фалангами, ладонью и предплечьем —
        # иначе вершины между сросшимися пальцами тянутся к соседу и дают изломы
        dist = {}
        for n, (h, t) in cand.items():
            if "_" in n and "Thumb" not in n and u < knuckle_u - 0.012:
                continue  # пальцы не тянут ладонь
            if n.endswith("ForeArm") and u > s * wrist.x + 0.015:
                continue
            dist[n] = seg_dist(p, h, t)
        chains = {}
        for n, d in dist.items():
            if "_" in n:
                f = n[:-1]
                chains[f] = min(chains.get(f, 9), d)
        own = min(chains, key=chains.get) if chains else None
        sc = [(1.0 / (d + 0.003) ** 3, n) for n, d in dist.items() if "_" not in n or n[:-1] == own]
        sc.sort(reverse=True)
        sc = sc[:3]
        tot = sum(w for w, _ in sc)
        for g in list(me.vertices[i].groups):
            body.vertex_groups[g.group].remove([i])
        for w, n in sc:
            grp(n).add([i], w / tot, 'REPLACE')

# сглаживание весов пальцев по соседям (только вершины кистей)
hand_v = set()
for side, s in (("Left", 1.0), ("Right", -1.0)):
    wrist = AW @ arm.data.bones[f"{side}Hand"].head_local
    hand_v |= {i for i, p in enumerate(P) if s * p.x > s * wrist.x + 0.01 and abs(p.y - wrist.y) < 0.09 and abs(p.z - wrist.z) < 0.09}
for _ in range(2):
    cur = {i: {body.vertex_groups[g.group].name: g.weight for g in me.vertices[i].groups} for i in hand_v}
    for i in hand_v:
        acc = dict((k, v * 2) for k, v in cur[i].items())
        nb = [n for n in adj.get(i, []) if n in cur]
        mine = {k[:-1] for k in cur[i] if "_" in k}
        for n in nb:
            for k, v in cur[n].items():
                if "_" in k and k[:-1] not in mine:
                    continue  # чужой палец не подмешиваем
                acc[k] = acc.get(k, 0) + v
        tot = sum(acc.values())
        top = sorted(acc.items(), key=lambda kv: -kv[1])[:4]
        t4 = sum(v for _, v in top)
        for g in list(me.vertices[i].groups):
            body.vertex_groups[g.group].remove([i])
        for k, v in top:
            grp(k).add([i], v / t4, 'REPLACE')

bpy.ops.wm.save_as_mainfile(filepath=OUT)
print("REPORT", report)
