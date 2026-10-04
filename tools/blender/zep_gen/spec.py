"""
Спецификация модели (JSON) → скелет (суставы, кости, роли для анимации) + формы тела + жёсткие детали.
Шаблоны скелета: biped (двуногий), quad (четвероногий), blob (слизень/дух), none (проп).
Координаты Blender: X вбок (+ — левая сторона модели, суффикс .L), Y назад (перед — −Y), Z вверх.
Ссылка на точку: [x, y, z] | "сустав" | ["сустав", [dx, dy, dz]]; в формах — "at" + "off".
"mirror": true — копия с X → −X и .L ↔ .R.
"""
import copy
import math

import numpy as np

from . import sdf


def _swap_side(name):
    if isinstance(name, str):
        if name.endswith(".L"):
            return name[:-2] + ".R"
        if name.endswith(".R"):
            return name[:-2] + ".L"
    return name


def mirror_item(it):
    """Зеркальная копия описания формы/детали: X → −X, .L ↔ .R (рекурсивно по ссылкам)."""
    m = copy.deepcopy(it)
    m.pop("mirror", None)

    def flip_pt(p):
        if isinstance(p, str):
            return _swap_side(p)
        if isinstance(p, list) and len(p) == 2 and isinstance(p[0], str):
            return [_swap_side(p[0]), [-p[1][0], p[1][1], p[1][2]]]
        if isinstance(p, list) and len(p) == 3 and all(isinstance(x, (int, float)) for x in p):
            return [-p[0], p[1], p[2]]
        return p

    for key in ("at", "a", "b", "to"):
        if key in m:
            m[key] = flip_pt(m[key])
    for key in ("off", "off2", "dir", "bend"):
        if key in m and isinstance(m[key], list):
            m[key] = [-m[key][0], m[key][1], m[key][2]]
    if "rot" in m:  # отражение поворота по X: (rx, −ry, −rz)
        r = m["rot"]
        m["rot"] = [r[0], -r[1], -r[2]]
    if "bone" in m:
        m["bone"] = _swap_side(m["bone"])
    if "path" in m:
        m["path"] = [flip_pt(p) for p in m["path"]]
    return m


def expand_mirror(items):
    out = []
    for it in items or []:
        out.append({k: v for k, v in it.items() if k != "mirror"})
        if it.get("mirror"):
            out.append(mirror_item(it))
    return out


class Skeleton:
    """Суставы (имя → точка), кости [(имя, голова, хвост, родитель)], роли для анимации."""

    def __init__(self):
        self.joints = {}
        self.bones = []  # dict(name, head, tail, parent)
        self.roles = {}

    def add(self, name, head, tail, parent=None):
        self.bones.append({"name": name, "head": head, "tail": tail, "parent": parent})

    def bone(self, name):
        return next((b for b in self.bones if b["name"] == name), None)

    def pt(self, ref):
        if isinstance(ref, str):
            return np.array(self.joints[ref], dtype=float)
        if isinstance(ref, list) and len(ref) == 2 and isinstance(ref[0], str):
            return np.array(self.joints[ref[0]], dtype=float) + np.array(ref[1], dtype=float)
        return np.array(ref, dtype=float)

    def owner(self, joint):
        """Кость, к которой «прилипает» сустав: та, что из него растёт, иначе та, что в нём кончается."""
        for b in self.bones:
            if b["head"] == joint:
                return b["name"]
        for b in self.bones:
            if b["tail"] == joint:
                return b["name"]
        return None

    def nearest_bone(self, p):
        best, bd = None, 1e9
        for b in self.bones:
            a, c = self.pt(b["head"]), self.pt(b["tail"])
            ab = c - a
            t = np.clip(np.dot(p - a, ab) / max(1e-9, np.dot(ab, ab)), 0, 1)
            d = np.linalg.norm(p - (a + ab * t))
            if d < bd:
                best, bd = b["name"], d
        return best

    def graph_dist(self):
        """Расстояние по дереву костей (для весов: соседи не дальше WEIGHT_HOPS шагов). Кости, чьи концы почти
        касаются, тоже соседи (у героев пака стопы — дети корня ради IK, но стыкуются с голенью)."""
        names = [b["name"] for b in self.bones]
        adj = {n: set() for n in names}
        for b in self.bones:
            if b["parent"]:
                adj[b["name"]].add(b["parent"])
                adj[b["parent"]].add(b["name"])
        pts = {b["name"]: (self.pt(b["head"]), self.pt(b["tail"])) for b in self.bones}
        allp = np.array([p for ab in pts.values() for p in ab])
        near = 0.04 * float(np.max(allp.max(0) - allp.min(0))) if len(allp) else 0
        for i, a in enumerate(names):
            for c in names[i + 1:]:
                if min(np.linalg.norm(x - y) for x in pts[a] for y in pts[c]) < near:
                    adj[a].add(c)
                    adj[c].add(a)
        dist = {}
        for s in names:
            d = {s: 0}
            frontier = [s]
            while frontier:
                nxt = []
                for u in frontier:
                    for v in adj[u]:
                        if v not in d:
                            d[v] = d[u] + 1
                            nxt.append(v)
                frontier = nxt
            dist[s] = d
        return dist


# ---------------- шаблоны ----------------

BIPED = {
    "legLen": 0.85, "torso": 0.55, "neck": 0.1, "head": 0.28, "shoulderW": 0.42, "hipW": 0.2,
    "armLen": 0.72, "armSpread": 22, "hunch": 0, "footLen": 0.2, "kneeBend": 0.03,
    "r": {
        "pelvis": [0.17, 0.13, 0.12], "belly": [0.17, 0.13, 0.16], "chest": [0.2, 0.14, 0.17],
        "neck": 0.065, "head": [0.12, 0.13, 0.14], "shoulder": 0.07,
        "upperArm": [0.065, 0.05], "forearm": [0.05, 0.04], "hand": [0.045, 0.03, 0.06],
        "thigh": [0.09, 0.065], "calf": [0.065, 0.045], "foot": [0.055, 0.11, 0.045],
    },
    "k": {"torso": 0.08, "limb": 0.05, "head": 0.05, "hand": 0.03, "foot": 0.03},
}

QUAD = {
    "legLen": 0.55, "bodyLen": 0.8, "neck": 0.3, "neckUp": 35, "head": 0.25, "tail": 0.5, "tailSegs": 3,
    "tailUp": 10, "hipW": 0.16, "chestW": 0.18, "footLen": 0.08,
    "r": {
        "hips": [0.16, 0.22, 0.16], "belly": [0.17, 0.3, 0.17], "chest": [0.19, 0.22, 0.2],
        "neck": [0.09, 0.07], "head": [0.1, 0.15, 0.1], "snout": [0.065, 0.11, 0.06],
        "shoulder": [0.08, 0.12, 0.13], "haunch": [0.09, 0.15, 0.14],
        "frontUpper": [0.075, 0.055], "frontLower": [0.05, 0.04], "hindUpper": [0.1, 0.065],
        "hindLower": [0.055, 0.04], "foot": [0.045, 0.065, 0.035], "tail": [0.06, 0.015],
    },
    "k": {"torso": 0.16, "limb": 0.07, "head": 0.07, "foot": 0.03, "tail": 0.05},
}

BLOB = {"height": 0.9, "width": 0.55, "r": {"body": [0.45, 0.42, 0.42]}, "k": {"body": 0.1}}


def _merge(base, over):
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k].update(v)
        else:
            out[k] = v
    return out


def biped(p):
    """Двуногий: Hips → Spine → Chest → Neck → Head; руки Shoulder/UpperArm/LowerArm/Hand; ноги UpperLeg/LowerLeg/Foot."""
    s = Skeleton()
    L, T, hw, sw = p["legLen"], p["torso"], p["hipW"] / 2, p["shoulderW"] / 2
    hunch = math.radians(p["hunch"])
    j = s.joints
    j["hips"] = [0, 0, L]
    j["spine"] = [0, 0.0, L + T * 0.35]
    # горб: грудь и шея уходят вперёд (−Y)
    j["chest"] = [0, -math.sin(hunch) * T * 0.35, L + T * 0.35 + math.cos(hunch) * T * 0.35]
    j["neck"] = [0, -math.sin(hunch) * T, L + T * 0.35 + math.cos(hunch) * T * 0.65]
    nk = np.array(j["neck"])
    j["head"] = list(nk + [0, -math.sin(hunch) * p["neck"] * 1.5, p["neck"]])
    j["headTop"] = list(np.array(j["head"]) + [0, 0, p["head"]])
    spread = math.radians(p["armSpread"])
    a = p["armLen"]
    for side, sx in (("L", 1), ("R", -1)):
        ch = np.array(j["neck"]) + [0, 0, -0.05 * T]
        j["clav." + side] = list(ch + [sx * 0.04, 0, 0])
        sh = ch + [sx * sw, 0.02, -0.03]
        j["shoulder." + side] = list(sh)
        dirv = np.array([sx * math.sin(spread), 0.0, -math.cos(spread)])
        el = sh + dirv * a * 0.45 + [0, 0.02, 0]
        wr = el + dirv * a * 0.42 + [0, -0.04, 0]
        j["elbow." + side] = list(el)
        j["wrist." + side] = list(wr)
        j["hand." + side] = list(wr + dirv * a * 0.13)
        hp = np.array([sx * hw, 0, L - 0.04])
        j["hip." + side] = list(hp)
        j["knee." + side] = list([sx * hw, -p["kneeBend"] * L, L * 0.52])
        j["ankle." + side] = list([sx * hw, 0.02, p["footLen"] * 0.35])
        j["toe." + side] = list([sx * hw, -p["footLen"] * 0.8, 0.0])
    s.add("Hips", "hips", "spine")
    s.add("Spine", "spine", "chest", "Hips")
    s.add("Chest", "chest", "neck", "Spine")
    s.add("Neck", "neck", "head", "Chest")
    s.add("Head", "head", "headTop", "Neck")
    for side in ("L", "R"):
        s.add("Shoulder." + side, "clav." + side, "shoulder." + side, "Chest")
        s.add("UpperArm." + side, "shoulder." + side, "elbow." + side, "Shoulder." + side)
        s.add("LowerArm." + side, "elbow." + side, "wrist." + side, "UpperArm." + side)
        s.add("Hand." + side, "wrist." + side, "hand." + side, "LowerArm." + side)
        s.add("UpperLeg." + side, "hip." + side, "knee." + side, "Hips")
        s.add("LowerLeg." + side, "knee." + side, "ankle." + side, "UpperLeg." + side)
        s.add("Foot." + side, "ankle." + side, "toe." + side, "LowerLeg." + side)
    s.roles = {
        "kind": "biped", "pelvis": "Hips", "spine": ["Spine", "Chest"], "neck": "Neck", "head": "Head",
        "legs": [{"bones": ["UpperLeg.L", "LowerLeg.L", "Foot.L"], "phase": 0.0},
                 {"bones": ["UpperLeg.R", "LowerLeg.R", "Foot.R"], "phase": 0.5}],
        "arms": [{"bones": ["Shoulder.L", "UpperArm.L", "LowerArm.L", "Hand.L"], "side": 1, "phase": 0.5},
                 {"bones": ["Shoulder.R", "UpperArm.R", "LowerArm.R", "Hand.R"], "side": -1, "phase": 0.0}],
        "legLen": L,
    }
    # формы тела по шаблону
    r, k = p["r"], p["k"]
    sh = []

    def add(kind, bone, mat="skin", kk=0.05, **kw):
        sh.append({"shape": kind, "bone": bone, "mat": mat, "k": kk, **kw})

    if r.get("pelvis"):
        add("ellipsoid", "Hips", at="hips", off=[0, 0.01, 0.02], r=r["pelvis"], kk=k["torso"])
    if r.get("belly"):
        add("ellipsoid", "Spine", at="spine", off=[0, -0.01, 0.0], r=r["belly"], kk=k["torso"])
    if r.get("chest"):
        add("ellipsoid", "Chest", at="chest", off=[0, 0.0, T * 0.2], r=r["chest"], kk=k["torso"])
    if r.get("neck"):
        add("cone", "Neck", a="neck", b="head", r1=r["neck"], r2=r["neck"] * 0.9, kk=k["head"])
    if r.get("head"):
        add("ellipsoid", "Head", at="head", off=[0, -0.01, p["head"] * 0.45], r=r["head"], kk=k["head"])
    for side in ("L", "R"):
        if r.get("shoulder"):
            add("sphere", "UpperArm." + side, at="shoulder." + side, r=r["shoulder"], kk=k["limb"])
        if r.get("upperArm"):
            add("cone", "UpperArm." + side, a="shoulder." + side, b="elbow." + side, r1=r["upperArm"][0], r2=r["upperArm"][1], kk=k["limb"])
        if r.get("forearm"):
            add("cone", "LowerArm." + side, a="elbow." + side, b="wrist." + side, r1=r["forearm"][0], r2=r["forearm"][1], kk=k["limb"])
        if r.get("hand"):
            add("ellipsoid", "Hand." + side, at="hand." + side, off=[0, 0, 0.01], r=r["hand"], kk=k["hand"])
        if r.get("thigh"):
            add("cone", "UpperLeg." + side, a="hip." + side, b="knee." + side, r1=r["thigh"][0], r2=r["thigh"][1], kk=k["limb"])
        if r.get("calf"):
            add("cone", "LowerLeg." + side, a="knee." + side, b="ankle." + side, r1=r["calf"][0], r2=r["calf"][1], kk=k["limb"])
        if r.get("foot"):
            add("ellipsoid", "Foot." + side, at="ankle." + side, off=[0, -p["footLen"] * 0.35, -p["footLen"] * 0.12], r=r["foot"], kk=k["foot"])
    return s, sh


def quad(p):
    """Четвероногий: Hips → Spine → Chest → Neck → Head; ноги Front/Hind 1-2 + Foot; хвост Tail1..n."""
    s = Skeleton()
    j = s.joints
    L, B = p["legLen"], p["bodyLen"]
    j["hips"] = [0, B * 0.5, L + 0.05]
    j["spine"] = [0, B * 0.05, L + 0.08]
    j["chest"] = [0, -B * 0.4, L + 0.1]
    nu = math.radians(p["neckUp"])
    j["neck"] = [0, -B * 0.55, L + 0.18]
    j["head"] = list(np.array(j["neck"]) + [0, -math.cos(nu) * p["neck"], math.sin(nu) * p["neck"]])
    j["snout"] = list(np.array(j["head"]) + [0, -p["head"], -p["head"] * 0.15])
    tail = np.array(j["hips"]) + [0, 0.08, 0.02]
    j["tail0"] = list(tail)
    tu = math.radians(p["tailUp"])
    n = max(1, int(p["tailSegs"]))
    for i in range(1, n + 1):
        j[f"tail{i}"] = list(tail + np.array([0, math.cos(tu), math.sin(tu)]) * p["tail"] * i / n)
    for side, sx in (("L", 1), ("R", -1)):
        fx, hx = sx * p["chestW"] / 2, sx * p["hipW"] / 2
        fy, hy = -B * 0.42, B * 0.42
        j["fShoulder." + side] = [fx, fy, L]
        j["fElbow." + side] = [fx, fy + 0.06 * L, L * 0.55]
        j["fWrist." + side] = [fx, fy, p["footLen"] * 0.8]
        j["fToe." + side] = [fx, fy - p["footLen"], 0.0]
        j["hHip." + side] = [hx, hy, L]
        j["hKnee." + side] = [hx, hy - 0.12 * L, L * 0.6]
        j["hHock." + side] = [hx, hy + 0.12 * L, L * 0.25]
        j["hToe." + side] = [hx, hy - p["footLen"] * 0.6, 0.0]
    s.add("Hips", "hips", "spine")
    s.add("Spine", "spine", "chest", "Hips")
    s.add("Chest", "chest", "neck", "Spine")
    s.add("Neck", "neck", "head", "Chest")
    s.add("Head", "head", "snout", "Neck")
    prev = "Hips"
    s.add("Tail1", "tail0", "tail1", "Hips")
    prev = "Tail1"
    for i in range(2, n + 1):
        s.add(f"Tail{i}", f"tail{i-1}", f"tail{i}", prev)
        prev = f"Tail{i}"
    for side in ("L", "R"):
        s.add("FrontLeg1." + side, "fShoulder." + side, "fElbow." + side, "Chest")
        s.add("FrontLeg2." + side, "fElbow." + side, "fWrist." + side, "FrontLeg1." + side)
        s.add("FrontFoot." + side, "fWrist." + side, "fToe." + side, "FrontLeg2." + side)
        s.add("HindLeg1." + side, "hHip." + side, "hKnee." + side, "Hips")
        s.add("HindLeg2." + side, "hKnee." + side, "hHock." + side, "HindLeg1." + side)
        s.add("HindFoot." + side, "hHock." + side, "hToe." + side, "HindLeg2." + side)
    s.roles = {
        "kind": "quad", "pelvis": "Hips", "spine": ["Spine", "Chest"], "neck": "Neck", "head": "Head",
        "tail": [f"Tail{i}" for i in range(1, n + 1)],
        # шаг: задняя левая → передняя левая → задняя правая → передняя правая
        "legs": [{"bones": ["HindLeg1.L", "HindLeg2.L", "HindFoot.L"], "phase": 0.0, "trot": 0.0},
                 {"bones": ["FrontLeg1.L", "FrontLeg2.L", "FrontFoot.L"], "phase": 0.25, "trot": 0.5},
                 {"bones": ["HindLeg1.R", "HindLeg2.R", "HindFoot.R"], "phase": 0.5, "trot": 0.5},
                 {"bones": ["FrontLeg1.R", "FrontLeg2.R", "FrontFoot.R"], "phase": 0.75, "trot": 0.0}],
        "arms": [], "legLen": L,
    }
    r, k = p["r"], p["k"]
    sh = []

    def add(kind, bone, mat="skin", kk=0.05, **kw):
        sh.append({"shape": kind, "bone": bone, "mat": mat, "k": kk, **kw})

    if r.get("hips"):
        add("ellipsoid", "Hips", at="hips", off=[0, -0.04, 0.02], r=r["hips"], kk=k["torso"])
    if r.get("belly"):
        add("ellipsoid", "Spine", at="spine", r=r["belly"], kk=k["torso"])
    if r.get("chest"):
        add("ellipsoid", "Chest", at="chest", off=[0, 0, 0.02], r=r["chest"], kk=k["torso"])
    if r.get("neck"):
        add("cone", "Neck", a="neck", b="head", r1=r["neck"][0], r2=r["neck"][1], kk=k["head"])
    if r.get("head"):
        add("ellipsoid", "Head", at="head", off=[0, -p["head"] * 0.25, 0.02], r=r["head"], kk=k["head"])
    if r.get("snout"):
        add("ellipsoid", "Head", at="snout", off=[0, p["head"] * 0.25, -0.01], r=r["snout"], kk=k["head"])
    if r.get("tail"):
        t0, t1 = r["tail"]
        for i in range(1, n + 1):
            ra = t0 + (t1 - t0) * (i - 1) / n
            rb = t0 + (t1 - t0) * i / n
            add("cone", f"Tail{i}", a=f"tail{i-1}", b=f"tail{i}", r1=ra, r2=rb, kk=k["tail"])
    for side in ("L", "R"):
        # лопатки и ляжки: мышцы у основания ног — переход от корпуса к ноге без «спичек»
        if r.get("shoulder"):
            add("ellipsoid", "FrontLeg1." + side, at="fShoulder." + side, off=[0, 0, 0.02], r=r["shoulder"], kk=k["limb"])
        if r.get("haunch"):
            add("ellipsoid", "HindLeg1." + side, at="hHip." + side, off=[0, 0.01, -0.02], r=r["haunch"], kk=k["limb"])
        if r.get("frontUpper"):
            add("cone", "FrontLeg1." + side, a="fShoulder." + side, b="fElbow." + side, r1=r["frontUpper"][0], r2=r["frontUpper"][1], kk=k["limb"])
        if r.get("frontLower"):
            add("cone", "FrontLeg2." + side, a="fElbow." + side, b="fWrist." + side, r1=r["frontLower"][0], r2=r["frontLower"][1], kk=k["limb"])
        if r.get("hindUpper"):
            add("cone", "HindLeg1." + side, a="hHip." + side, b="hKnee." + side, r1=r["hindUpper"][0], r2=r["hindUpper"][1], kk=k["limb"])
        if r.get("hindLower"):
            add("cone", "HindLeg2." + side, a="hKnee." + side, b="hHock." + side, r1=r["hindLower"][0], r2=r["hindLower"][1], kk=k["limb"])
            add("cone", "HindFoot." + side, a="hHock." + side, b="hToe." + side, r1=r["hindLower"][1], r2=r["hindLower"][1] * 0.9, kk=k["foot"])
        if r.get("foot"):
            add("ellipsoid", "FrontFoot." + side, at="fToe." + side, off=[0, p["footLen"] * 0.5, p["footLen"] * 0.3], r=r["foot"], kk=k["foot"])
            add("ellipsoid", "HindFoot." + side, at="hToe." + side, off=[0, p["footLen"] * 0.3, p["footLen"] * 0.3], r=r["foot"], kk=k["foot"])
    return s, sh


def blob(p):
    """Слизень/дух: Body (низ → центр) → Top (центр → верх)."""
    s = Skeleton()
    H = p["height"]
    s.joints = {"base": [0, 0, 0], "mid": [0, 0, H * 0.45], "top": [0, 0, H]}
    s.add("Body", "base", "mid")
    s.add("Top", "mid", "top", "Body")
    s.roles = {"kind": "blob", "pelvis": "Body", "top": "Top", "legs": [], "arms": [], "legLen": H * 0.5}
    r = p["r"]["body"]
    sh = [{"shape": "ellipsoid", "bone": "Body", "mat": "skin", "k": p["k"]["body"], "at": "mid", "off": [0, 0, -H * 0.02], "r": r}]
    return s, sh


# Герой на скелете пака (CharacterArmature Quaternius, поза T, «чиби»): суставы — головы костей,
# «<Кость>.end» — хвосты. Радиусы сняты с Knight_Male (средние по вершинам каждой кости).
CHAR = {
    "r": {
        "hips": [0.27, 0.21, 0.25], "abdomen": [0.27, 0.21, 0.22], "torso": [0.31, 0.23, 0.29], "neck": 0.11,
        "head": [0.5, 0.47, 0.5], "shoulder": [0.14, 0.16], "upperArm": [0.15, 0.13], "lowerArm": [0.13, 0.12],
        "fist": [0.15, 0.12, 0.13], "upperLeg": [0.19, 0.14], "lowerLeg": [0.13, 0.11], "foot": [0.12, 0.2, 0.08],
    },
    "k": {"torso": 0.16, "limb": 0.07, "head": 0.08, "hand": 0.04, "foot": 0.04},
    "headUp": 0.5,
}


def char(p, skel):
    r, k = p["r"], p["k"]
    sh = []

    def add(kind, bone, kk, **kw):
        if skel.bone(bone):
            sh.append({"shape": kind, "bone": bone, "mat": "skin", "k": kk, **kw})

    if r.get("hips"):
        add("ellipsoid", "Hips", k["torso"], at="Hips", off=[0, -0.01, 0.12], r=r["hips"])
    if r.get("abdomen"):
        add("ellipsoid", "Abdomen", k["torso"], at="Abdomen", off=[0, -0.02, 0.19], r=r["abdomen"])
    if r.get("torso"):
        add("ellipsoid", "Torso", k["torso"], at="Torso", off=[0, -0.01, 0.22], r=r["torso"])
    if r.get("neck"):
        add("cone", "Neck", k["head"], a="Neck", b="Neck.end", r1=r["neck"], r2=r["neck"])
    if r.get("head"):
        add("ellipsoid", "Head", k["head"], at="Head", off=[0, 0.0, p["headUp"]], r=r["head"])
    for sd in ("L", "R"):
        if r.get("shoulder"):
            add("cone", "Shoulder." + sd, k["limb"], a="Shoulder." + sd, b="Shoulder." + sd + ".end", r1=r["shoulder"][0], r2=r["shoulder"][1])
        if r.get("upperArm"):
            add("cone", "UpperArm." + sd, k["limb"], a="UpperArm." + sd, b="UpperArm." + sd + ".end", r1=r["upperArm"][0], r2=r["upperArm"][1])
        if r.get("lowerArm"):
            add("cone", "LowerArm." + sd, k["limb"], a="LowerArm." + sd, b="LowerArm." + sd + ".end", r1=r["lowerArm"][0], r2=r["lowerArm"][1])
        if r.get("fist"):
            sx = 1 if sd == "L" else -1
            add("ellipsoid", "Fist." + sd, k["hand"], at="Fist." + sd, off=[sx * 0.14, 0, 0], r=r["fist"])
        if r.get("upperLeg"):
            add("cone", "UpperLeg." + sd, k["limb"], a="UpperLeg." + sd, b="UpperLeg." + sd + ".end", r1=r["upperLeg"][0], r2=r["upperLeg"][1])
        if r.get("lowerLeg"):
            add("cone", "LowerLeg." + sd, k["limb"], a="LowerLeg." + sd, b="LowerLeg." + sd + ".end", r1=r["lowerLeg"][0], r2=r["lowerLeg"][1])
        if r.get("foot"):
            add("ellipsoid", "Foot." + sd, k["foot"], at="Foot." + sd, off=[0, -0.1, 0.05], r=r["foot"])
    return sh


def skeleton_from_armature(arm):
    """Скелет из готовой арматуры (мировые координаты): сустав «Кость» — голова, «Кость.end» — хвост."""
    s = Skeleton()
    mw = arm.matrix_world
    for b in arm.data.bones:
        s.joints[b.name] = list(mw @ b.head_local)
        s.joints[b.name + ".end"] = list(mw @ b.tail_local)
    for b in arm.data.bones:
        if b.use_deform and not b.name.startswith("PoleTarget") and b.name != "Bone":
            s.add(b.name, b.name, b.name + ".end", b.parent.name if b.parent and b.parent.name != "Bone" else None)
    s.roles = {"kind": "char", "legs": [], "arms": []}
    return s


TEMPLATES = {"biped": (BIPED, biped), "quad": (QUAD, quad), "blob": (BLOB, blob)}


def spec_mirror(b, items):
    """Кость с "mirror": true в исходном списке (по имени)."""
    return any(x.get("mirror") and x["name"] == b["name"] for x in items or [])


def build_skeleton(spec, arm=None):
    rig = spec.get("rig", "biped")
    if rig == "char":
        s = skeleton_from_armature(arm)
        shapes = char(_merge(CHAR, spec.get("body")), s)
        drop = set(spec.get("drop") or [])
        return s, [x for x in shapes if x["bone"] not in drop]
    if rig == "none":
        s = Skeleton()
        s.roles = {"kind": "none", "legs": [], "arms": []}
        return s, []
    base, fn = TEMPLATES[rig]
    params = _merge(base, spec.get("body"))
    s, shapes = fn(params)
    for name, pt in (spec.get("joints") or {}).items():  # точечные правки суставов
        s.joints[name] = list(s.pt(pt))
    bones = []
    for b in spec.get("bones") or []:  # свои кости: уши, челюсть, крылья, доп. хвосты
        b = {k: v for k, v in b.items() if k != "mirror"}
        bones.append(b)
        if spec_mirror(b, spec.get("bones")):
            m = mirror_item({**b, "at": b["head"], "to": b["tail"]})
            bones.append({**b, "name": _swap_side(b["name"]), "head": m["at"], "tail": m["to"],
                          "parent": _swap_side(b.get("parent"))})
    for b in bones:
        for key in ("head", "tail"):
            ref = b[key]
            if not (isinstance(ref, str) and ref in s.joints):
                jn = b["name"] + "." + key
                s.joints[jn] = list(s.pt(ref))
                b[key] = jn
        s.add(b["name"], b["head"], b["tail"], b.get("parent"))
        if b.get("role"):
            s.roles.setdefault(b["role"], []).append(b["name"])
    # убрать формы шаблона по имени кости (например, "drop": ["Hand.L", "Hand.R"])
    drop = set(spec.get("drop") or [])
    shapes = [x for x in shapes if x["bone"] not in drop]
    return s, shapes


def make_shapes(skel, items, default_mat="skin"):
    """Описания форм → sdf.Shape (с костью и материалом)."""
    out = []
    for it in items:
        kind = it["shape"]
        op = it.get("op", "add")
        mat = it.get("mat", default_mat)
        k = float(it.get("k", 0.04))
        noise = it.get("noise")
        R = sdf.rot_matrix(it.get("rot")) if it.get("rot") else None
        bone = it.get("bone")
        if kind in ("sphere", "ellipsoid", "box", "torus"):
            c = skel.pt(it["at"]) + np.array(it.get("off", [0, 0, 0]), dtype=float)
            if not bone:
                bone = skel.owner(it["at"]) if isinstance(it["at"], str) else (
                    skel.owner(it["at"][0]) if isinstance(it["at"], list) and isinstance(it["at"][0], str) else skel.nearest_bone(c))
            if kind == "sphere":
                sh = sdf.Shape("sphere", op, k, mat, bone, noise, c=c, r=float(it["r"]))
            elif kind == "ellipsoid":
                sh = sdf.Shape("ellipsoid", op, k, mat, bone, noise, c=c, r=[float(x) for x in it["r"]], R=R)
            elif kind == "box":
                sh = sdf.Shape("box", op, k, mat, bone, noise, c=c, h=[float(x) for x in it["h"]], rnd=float(it.get("rnd", 0.0)), R=R)
            else:
                sh = sdf.Shape("torus", op, k, mat, bone, noise, c=c, R=float(it["R"]), r=float(it["r"]), R3=R)
        elif kind in ("cone", "cyl"):
            a = skel.pt(it["a"]) + np.array(it.get("off", [0, 0, 0]), dtype=float)
            b = skel.pt(it["b"]) + np.array(it.get("off2", it.get("off", [0, 0, 0])), dtype=float)
            if not bone:
                an = it["a"] if isinstance(it["a"], str) else (it["a"][0] if isinstance(it["a"], list) and isinstance(it["a"][0], str) else None)
                bn = it["b"] if isinstance(it["b"], str) else None
                seg = next((x["name"] for x in skel.bones if x["head"] == an and x["tail"] == bn), None)
                bone = seg or (skel.owner(an) if an else skel.nearest_bone((a + b) / 2))
            if kind == "cone":
                r1 = float(it.get("r1", it.get("r", [0.05])[0] if isinstance(it.get("r"), list) else it.get("r", 0.05)))
                r2 = float(it.get("r2", it.get("r")[1] if isinstance(it.get("r"), list) else it.get("r", 0.05)))
                sh = sdf.Shape("cone", op, k, mat, bone, noise, a=a, b=b, r1=r1, r2=r2)
            else:
                sh = sdf.Shape("cyl", op, k, mat, bone, noise, a=a, b=b, r=float(it["r"]), rnd=float(it.get("rnd", 0.0)))
        else:
            raise ValueError("форма: " + kind)
        out.append(sh)
    return out
