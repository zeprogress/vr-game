"""
Постановщик поз героя «Человек» (риг Human50k, имена костей Mixamo): позу задаём не углами костей, а тем,
где стоят ступни, как сдвинут и повёрнут таз, как развёрнут и наклонён корпус, где хват в кисти и куда смотрит
оружие. Руки и ноги ставит аналитический двухзвенный IK, кисть доворачивается так, чтобы оружие в ней
смотрело куда задано (с учётом посадки в кулаке — та же, что в игре, botGear.MODEL_SEATS).

Пространство героя: x — вправо, y — вверх, z — вперёд. Ступни и таз — в долях высоты таза (H), кисти — в долях
длины руки (A) от середины плеч. Углы — в градусах.

Используется из moves.py: build(key) → поза, key_pose(action, frame, pose).
"""
import bpy
import math
from mathutils import Vector, Quaternion

arm = bpy.data.objects["HumanRig"]
BONES = arm.data.bones
FINGER = ("Thumb", "Index", "Middle", "Ring", "Pinky")
BODY = [b.name for b in BONES if not any(f in b.name for f in FINGER)]
FINGERS = [b.name for b in BONES if any(f in b.name for f in FINGER)]

# Пространство героя → пространство арматуры (герой смотрит в -Y, правая рука — в -X).
RIGHT = Vector((-1, 0, 0))
UP = Vector((0, 0, 1))
FWD = Vector((0, -1, 0))


SPIN = [Quaternion()]  # поворот всей позы вокруг вертикали (ключ «spin»: вихрь, подсечка)


def C(v):
    return SPIN[0] @ (RIGHT * v[0] + UP * v[1] + FWD * v[2])


R0 = {b.name: b.matrix_local.to_quaternion() for b in BONES}
H0 = {b.name: b.head_local.copy() for b in BONES}
PAR = {b.name: (b.parent.name if b.parent else None) for b in BONES}
ORDER = []


def _walk(b):
    ORDER.append(b.name)
    for c in b.children:
        _walk(c)


for _b in BONES:
    if _b.parent is None:
        _walk(_b)
LT = {n: (R0[PAR[n]].inverted() @ R0[n]) if PAR[n] else R0[n] for n in ORDER}
OFF = {n: (R0[PAR[n]].inverted() @ (H0[n] - H0[PAR[n]])) if PAR[n] else Vector() for n in ORDER}

H = H0["Hips"].z  # высота таза
LU = (H0["RightForeArm"] - H0["RightArm"]).length
LD = (H0["RightHand"] - H0["RightForeArm"]).length
ARM = LU + LD  # длина руки до запястья
# Единица положений кистей в постановке (moves.py). Позы ставились при руке 0.242; после удлинения рук (proportions.py,
# ×1.35) — 0.28: кисти не уходят за досягаемость, жесты не съёживаются.
A = 0.28
LLU = (H0["RightLeg"] - H0["RightUpLeg"]).length
LLD = (H0["RightFoot"] - H0["RightLeg"]).length
ANKLE = H0["RightFoot"].z

# Хват в кулаке (локально кости кисти, grip.py): ось рукояти T, вдоль кисти L, третья N = L × T, центр рукояти.
GRIP = {
    "R": {"T": Vector((-0.9681, 0.0851, -0.2355)), "L": Vector((0.0827, 0.9964, 0.0201)), "N": Vector((-0.2364, 0.0, 0.9717)),
          "C": Vector((0.0128, 0.0505, -0.0212))},
    "L": {"T": Vector((0.978, 0.0685, -0.1973)), "L": Vector((-0.0671, 0.9977, 0.0135)), "N": Vector((-0.1977, 0.0, -0.9803)),
          "C": Vector((-0.0089, 0.0545, -0.0234))},
}
# Куда смотрит оружие (+Y меша) в осях кулака рыцаря (N, L, T) — из посадок BOT_GEAR.
WEAPON_Y = {"sword": (-0.39, 0.50, 0.77), "staff": (-0.23, 0.14, 0.96), "bow": (-0.31, 0.04, 0.95)}


def blade_local(side, kind):
    n, l, t = WEAPON_Y.get(kind, WEAPON_Y["sword"])
    g = GRIP[side]
    return (g["N"] * n + g["L"] * l + g["T"] * t).normalized()


def toward(a, b, deg):
    """Поворот, который ведёт вектор a к вектору b на deg градусов."""
    ax = a.cross(b)
    if ax.length < 1e-8 or abs(deg) < 1e-6:
        return Quaternion()
    return Quaternion(ax.normalized(), math.radians(deg))


def frame_to(src_a, src_b, dst_a, dst_b):
    """Поворот, переводящий пару векторов (a главный, b вспомогательный) в пару (a', b')."""
    def basis(a, b):
        x = a.normalized()
        bn = b.normalized()
        y = bn - x * bn.dot(x)
        if y.length < 0.35:
            # вспомогательная ось почти вдоль главной — плавно подмешиваем запасную (верх или вперёд), без скачка
            fb = UP if abs(x.dot(UP)) < 0.9 else FWD
            fp = fb - x * fb.dot(x)
            y = y + fp.normalized() * (0.35 - y.length) / 0.35 * 0.5
        y = y.normalized() if y.length > 1e-8 else (x.orthogonal().normalized())
        z = x.cross(y)
        from mathutils import Matrix
        return Matrix((x, y, z)).transposed()
    return (basis(dst_a, dst_b) @ basis(src_a, src_b).transposed()).to_quaternion()


class Pose:
    def __init__(self):
        self.q = {n: Quaternion() for n in ORDER}
        self.loc = Vector()
        self.fk()

    def fk(self):
        self.W = {}
        self.P = {}
        for n in ORDER:
            p = PAR[n]
            if p is None:
                self.W[n] = R0[n] @ self.q[n]
                self.P[n] = H0[n] + R0[n] @ self.loc
            else:
                self.W[n] = self.W[p] @ LT[n] @ self.q[n]
                self.P[n] = self.P[p] + self.W[p] @ OFF[n]

    def rest_world(self, n):
        """Мировой поворот кости при нулевом базисе (родитель — как сейчас)."""
        p = PAR[n]
        return (self.W[p] @ LT[n]) if p else R0[n]

    def set_world(self, n, w):
        p = PAR[n]
        self.q[n] = ((self.W[p] @ LT[n]) if p else R0[n]).inverted() @ w
        self.fk()

    def rotate(self, n, d):
        """Повернуть кость в мире на d (поверх её текущего поворота)."""
        self.set_world(n, d @ self.W[n])

    def aim(self, n, to):
        """Направить кость (её ось Y) в точку to с минимальным поворотом от позы с нулевым базисом."""
        w0 = self.rest_world(n)
        y = w0 @ Vector((0, 1, 0))
        d = to - self.P[n]
        self.set_world(n, y.rotation_difference(d.normalized()) @ w0)

    def axis_y(self, n):
        return self.W[n] @ Vector((0, 1, 0))


def _hinge(a, flex_to):
    """Ось сгиба сустава в осях кости a: локоть сгибается так, что предплечье идёт вперёд, колено — голень назад
    (поза покоя почти прямая — по ней ось не определить)."""
    ya = (R0[a] @ Vector((0, 1, 0))).normalized()
    return (R0[a].inverted() @ ya.cross(flex_to).normalized()).normalized()


HINGE = {"LeftArm": _hinge("LeftArm", FWD), "RightArm": _hinge("RightArm", FWD),
         "LeftUpLeg": _hinge("LeftUpLeg", -FWD), "RightUpLeg": _hinge("RightUpLeg", -FWD)}


def ik2(pose, a, b, end, target, pole, la, lb):
    """Двухзвенный IK: кости a (плечо/бедро) и b (предплечье/голень) — конец b в target, сгиб — в сторону pole.
    Кость a доворачивается вокруг своей оси так, чтобы сустав гнулся вокруг своей оси покоя (HINGE) — иначе
    локоть и колено гнутся «вбок», и сетку плеча и бедра крутит."""
    s = pose.P[a]
    d = target - s
    # «Мягкий» предел вытяжения: у самого края длина подходит к максимуму плавно (у прямой руки IK особенно
    # чувствителен — сантиметр цели давал резкий сгиб локтя). И не складывать руку/ногу вплотную.
    lmax = (la + lb) * 0.999
    lsoft = lmax * 0.96
    dl = d.length
    if dl > lsoft:
        dl = lsoft + (lmax - lsoft) * (1 - math.exp(-(dl - lsoft) / (lmax - lsoft)))
    L = max((la + lb) * 0.3, dl)
    u = d.normalized()
    ca = max(-1.0, min(1.0, (la * la + L * L - lb * lb) / (2 * la * L)))
    sa = math.sqrt(max(0.0, 1 - ca * ca))
    pn = pole.normalized()
    v = pn - u * pn.dot(u)
    if v.length < 0.5:
        # цель почти на линии полюса — плоскость сгиба не определена и переворачивается; плавно подмешиваем
        # запасной полюс (для рук — назад, для ног — вперёд), без скачка
        alt = -FWD if a.endswith("Arm") else FWD
        alt = alt - u * alt.dot(u)
        if alt.length > 1e-6:
            v = v + alt.normalized() * (0.5 - v.length)
    v = v.normalized() if v.length > 1e-6 else u.orthogonal().normalized()
    if DBG_IK and a in DBG_IK_BONES:
        print("IK", tuple(round(x, 2) for x in u), "pole", tuple(round(x, 2) for x in pn), "v", tuple(round(x, 2) for x in v), "L", round(L, 3))
    e = s + u * (la * ca) + v * (la * sa)
    t = s + u * L
    pose.aim(a, e)
    want = v.cross(u)  # ось сгиба (= плечо × предплечье по знаку) из плоскости «на цель + полюс»: устойчива и у прямой руки
    if a in HINGE and want.length > 1e-5:
        ax = pose.axis_y(a).normalized()
        cur = pose.W[a] @ HINGE[a]
        cur_p = (cur - ax * cur.dot(ax))
        want_p = (want - ax * want.dot(ax))
        if cur_p.length > 1e-6 and want_p.length > 1e-6:
            cur_p.normalize()
            want_p.normalize()
            ang = math.atan2(cur_p.cross(want_p).dot(ax), cur_p.dot(want_p))
            pose.rotate(a, Quaternion(ax, ang))
    pose.aim(b, t)


DBG_IK = False
DBG_IK_BONES = ("RightArm", "LeftArm")
TW_PREV = {}  # разворот кисти в прошлом кадре (по предплечью) — сбрасывает reset_state()


def reset_state():
    TW_PREV.clear()


def spread_twist(pose, fore, hand, share=0.7):
    """Разворот кисти вокруг предплечья — большую часть на предплечье (иначе запястье скручивается «фантиком»)."""
    w = pose.W[hand].copy()
    rel = (pose.W[fore] @ LT[hand]).inverted() @ w
    tw = 2 * math.atan2(rel.y, rel.w)
    prev = TW_PREV.get(fore)
    if prev is None:
        tw = (tw + math.pi) % (2 * math.pi) - math.pi
    else:
        # тот же оборот, что в прошлом кадре: разворот не перескакивает через 180°
        tw = prev + ((tw - prev + math.pi) % (2 * math.pi) - math.pi)
    TW_PREV[fore] = tw
    pose.rotate(fore, Quaternion(pose.axis_y(fore).normalized(), tw * share))
    pose.set_world(hand, w)


ERR = {}  # насколько кисть не дошла до хвата (м) — замер для отчёта moves.py
FIST_Q = {}
RELAX_Q = {}


def load_hands():
    """Позы пальцев из клипа Fist: кадр 1 — спокойная кисть, 12 — кулак."""
    act = bpy.data.actions["Fist"]
    arm.animation_data_create()
    arm.animation_data.action = act
    for f, store in ((1, RELAX_Q), (12, FIST_Q)):
        bpy.context.scene.frame_set(f)
        for n in FINGERS:
            store[n] = arm.pose.bones[n].rotation_quaternion.copy()
    arm.animation_data.action = None


STANCE_FEET = {"L": (-0.2, 0.0, 0.0), "R": (0.2, 0.0, 0.0)}


def place_arms(pose, k, push, polepush):
    """Руки по ключу (IK, кисть под оружие). push — сдвиг хвата (м, мир), polepush — куда отвести локоть.
    Итоговые цели рук (мир) — в pose.targets: по ним moves.py сглаживает движение и ставит руки заново."""
    misses = {}
    pose.targets = {}
    mid = (pose.P["LeftArm"] + pose.P["RightArm"]) / 2
    hands = {}
    for side in ("R", "L"):
        h = k.get(side)
        if h:
            hands[side] = h
    two = k.get("two")
    if two:
        # Двуручное оружие: центр, направление и места кистей на древке (r, l — от центра, в A). Центр тянем к груди,
        # пока обе кисти не достают (руки у модели короткие).
        d = C(two["dir"]).normalized()
        c = mid + C(two["at"]) * A + push["two"]
        reach = ARM * 0.97 + GRIP["R"]["C"].length
        near = ARM * 0.55

        def too_close(cc):
            g1, g2 = cc + d * (two["r"] * A), cc + d * (two["l"] * A)
            return near - min((g1 - pose.P["RightArm"]).length, (g2 - pose.P["LeftArm"]).length)

        if too_close(c) > 0:
            # кисть у самого плеча (рука сложена до упора) — отодвинуть оружие вперёд от груди, плавно
            fw = C((0, 0, 1))
            lo, hi = 0.0, 0.4
            for _ in range(14):
                m = (lo + hi) / 2
                if too_close(c + fw * m) > 0:
                    lo = m
                else:
                    hi = m
            c = c + fw * hi
        c0 = c
        tgt = mid + C((0, 0, 0.4 * A))

        def at(lam):
            k_ = 1 - 0.6 * lam if abs(two["r"] - two["l"]) > 0.5 else 1.0  # и сводим кисти на древке
            cc = c0 + (tgt - c0) * lam
            return cc, cc + d * (two["r"] * k_ * A), cc + d * (two["l"] * k_ * A)

        def over(lam):
            _, g1, g2 = at(lam)
            return max((g1 - pose.P["RightArm"]).length, (g2 - pose.P["LeftArm"]).length) - reach

        lam = 0.0
        if over(0.0) > 0:
            lo, hi = 0.0, 1.0
            for _ in range(14):  # наименьшая доля пути к груди, при которой обе кисти достают — без ступенек
                m = (lo + hi) / 2
                if over(m) > 0:
                    lo = m
                else:
                    hi = m
            lam = hi
        c, gr, gl = at(lam)
        hands["R"] = {"atw": gr, "dirw": d, "kind": two.get("kind", "sword")}
        hands["L"] = {"atw": gl, "dirw": d, "kind": two.get("kind", "sword")}
    # сначала рука с хватом «at», потом вторая на древке (shaft — от хвата первой вдоль оружия)
    grips = {}
    for side in sorted(hands, key=lambda s: 1 if "shaft" in hands[s] else 0):
        h = hands[side]
        s = "Right" if side == "R" else "Left"
        kind = h.get("kind", "sword")
        if "shaft" in h:
            # хват на древке: ближайшая к плечу точка древка в пределах ±0.8 A от заданной (руки короткие —
            # жёсткая точка часто недостижима), со своей стороны от первой руки
            other = "L" if side == "R" else "R"
            gp, gd = grips[other]
            sh = h["shaft"]
            lo, hi = sh - 0.8, sh + 0.8
            if sh > 0:
                lo = max(lo, 0.35)
            else:
                hi = min(hi, -0.35)
            t = max(lo, min(hi, (pose.P[f"{s}Arm"] - gp).dot(gd) / A))
            grip = gp + gd * (t * A) + push[side]
            want_dir = gd
        elif "atw" in h:
            grip, want_dir = h["atw"] + push[side], h.get("dirw")
        else:
            grip = mid + C(h["at"]) * A + push[side]
            want_dir = C(h["dir"]).normalized() if "dir" in h else None
        pole = (h["polew"] if "polew" in h else C(h.get("elbow", (0.6 if side == "R" else -0.6, -1.0, -0.35)))) + polepush[side]
        hand = f"{s}Hand"
        if want_dir is None:
            # без оружия: «at» — запястье, кисть продолжает предплечье (+ разворот вокруг него)
            ik2(pose, f"{s}Arm", f"{s}ForeArm", hand, grip, pole, LU, LD)
            fore = (grip - pose.P[f"{s}ForeArm"]).normalized()
            w = pose.rest_world(hand)
            if h.get("roll"):
                w = Quaternion(fore, math.radians(h["roll"])) @ w
            if h.get("bend"):
                w = toward(fore, C(h["bendTo"]) if "bendTo" in h else UP, h["bend"]) @ w
            pose.set_world(hand, w)
            spread_twist(pose, f"{s}ForeArm", hand)
            grips[side] = (grip, fore)
            pose.targets[side] = {"atw": grip.copy(), "polew": pole.copy(), "roll": h.get("roll", 0.0), "hold": h.get("hold", False)}
            continue
        # с оружием: «at» — центр рукояти; запястье ищем за пару проходов (поворот кисти зависит от предплечья)
        bl = blade_local(side, kind)
        wrist = grip.copy()
        for _ in range(4):
            ik2(pose, f"{s}Arm", f"{s}ForeArm", hand, wrist, pole, LU, LD)
            fore = (pose.P[hand] - pose.P[f"{s}ForeArm"]).normalized()
            # кисть смотрит от своего плеча к рукояти (не от предплечья: тот круг «кисть ↔ предплечье ↔ запястье»
            # не сходился и прыгал между двумя решениями от кадра к кадру); у двуручного — запястья по своим сторонам
            if "knuckw" in h:
                knuck = h["knuckw"]
            else:
                knuck = C(h["knuck"]).normalized() if "knuck" in h else (grip - pose.P[f"{s}Arm"]).normalized()
            pose.set_world(hand, frame_to(bl, Vector((0, 1, 0)), want_dir, knuck))
            wrist = grip - pose.W[hand] @ GRIP[side]["C"]
        ik2(pose, f"{s}Arm", f"{s}ForeArm", hand, wrist, pole, LU, LD)
        pose.set_world(hand, frame_to(bl, Vector((0, 1, 0)), want_dir, knuck))
        spread_twist(pose, f"{s}ForeArm", hand)
        miss = (pose.P[hand] + pose.W[hand] @ GRIP[side]["C"] - grip).length
        misses[side] = miss
        grips[side] = (grip, want_dir)
        pose.targets[side] = {"atw": grip.copy(), "dirw": want_dir.copy(), "knuckw": knuck.copy(), "polew": pole.copy(),
                              "kind": kind, "hold": True, "pair": bool(two)}

    for side, m in misses.items():
        ERR[side] = max(ERR.get(side, 0.0), m)
    return hands


ARM_R = {"upper": 0.035, "fore": 0.03, "hand": 0.04}
TORSO_W, TORSO_D = 0.11, 0.088  # полуширина и полуглубина туловища (сечения сетки)
HEAD_R = 0.08


def _seg_closest(p1, q1, p2, q2):
    """Ближайшие точки двух отрезков."""
    d1, d2, r = q1 - p1, q2 - p2, p1 - p2
    a, e, f = d1.dot(d1), d2.dot(d2), d2.dot(r)
    c, b = d1.dot(r), d1.dot(d2)
    den = a * e - b * b
    s = max(0.0, min(1.0, (b * f - c * e) / den)) if den > 1e-12 else 0.0
    t = (b * s + f) / e if e > 1e-12 else 0.0
    if t < 0:
        t, s = 0.0, max(0.0, min(1.0, -c / a))
    elif t > 1:
        t, s = 1.0, max(0.0, min(1.0, (b - c) / a))
    return p1 + d1 * s, p2 + d2 * t


def arm_segments(pose, side):
    s = "Right" if side == "R" else "Left"
    a, fo, h = pose.P[f"{s}Arm"], pose.P[f"{s}ForeArm"], pose.P[f"{s}Hand"]
    tip = h + pose.W[f"{s}Hand"] @ Vector((0, 0.09, 0))
    return [(a.lerp(fo, 0.4), fo, ARM_R["upper"]), (fo, h, ARM_R["fore"]), (h, tip, ARM_R["hand"])]


def penetration(pose):
    """Самое глубокое проникновение руки в туловище или голову: (сторона, часть, глубина м, нормаль наружу) или None."""
    base, top = pose.P["Hips"], pose.P["Neck"]
    up = (top - base).normalized()
    hgt = (top - base).dot(up)
    r = (pose.P["RightArm"] - pose.P["LeftArm"]).normalized()
    fwd = up.cross(r).normalized()
    r = fwd.cross(up).normalized()
    head = pose.P["Head"] + pose.W["Head"] @ Vector((0, 0.08, 0))
    worst = None
    for side, s in (("R", "Right"), ("L", "Left")):
        a, f, h = pose.P[f"{s}Arm"], pose.P[f"{s}ForeArm"], pose.P[f"{s}Hand"]
        pts = [("upper", a.lerp(f, t), ARM_R["upper"]) for t in (0.5, 0.75, 1.0)]
        pts += [("fore", f.lerp(h, t), ARM_R["fore"]) for t in (0.33, 0.66, 1.0)]
        pts += [("hand", h + pose.W[f"{s}Hand"] @ GRIP[side]["C"], ARM_R["hand"]),
                ("hand", h + pose.W[f"{s}Hand"] @ Vector((0, 0.09, 0)), 0.03)]
        for part, p, rad in pts:
            rel = p - base
            y = rel.dot(up)
            if 0.0 < y < hgt:
                x, z = rel.dot(r), rel.dot(fwd)
                wx, wz = TORSO_W + rad, TORSO_D + rad
                e = (x / wx) ** 2 + (z / wz) ** 2
                if e < 1.0:
                    depth = (1 - math.sqrt(e)) * min(wx, wz)
                    n = r * (x / (wx * wx)) + fwd * (z / (wz * wz))
                    n = n.normalized() if n.length > 1e-6 else fwd.copy()
                    if worst is None or depth > worst[2]:
                        worst = (side, part, depth, n)
            dv = p - head
            if dv.length < HEAD_R + rad:
                depth = HEAD_R + rad - dv.length
                n = dv.normalized() if dv.length > 1e-6 else fwd.copy()
                if worst is None or depth > worst[2]:
                    worst = (side, part, depth, n)
    # рука с рукой: n — от левой к правой
    for i1, (p1, q1, r1) in enumerate(arm_segments(pose, "R")):
        for i2, (p2, q2, r2) in enumerate(arm_segments(pose, "L")):
            if i1 == 2 and i2 == 2:
                continue  # кисть о кисть — двуручный хват, так и держат
            c1, c2 = _seg_closest(p1, q1, p2, q2)
            dv = c1 - c2
            depth = r1 + r2 + 0.005 - dv.length
            if depth > 0 and (worst is None or depth > worst[2]):
                n = dv.normalized() if dv.length > 1e-6 else (pose.P["RightArm"] - pose.P["LeftArm"]).normalized()
                worst = ("RL", "arms", depth, n)
    return worst


def build(k, fixed=None):
    """Поза по ключу (словарь, см. moves.py). fixed=(push, polepush) — толчки рук заданы (сглаженные по кадрам),
    без поиска столкновений; иначе ищем их сами и записываем в pose.push / pose.polepush."""
    pose = Pose()
    spin = k.get("spin", 0.0)
    SPIN[0] = Quaternion(UP, math.radians(-spin))
    # Таз: сдвиг (H), поворот вокруг вертикали yaw, наклон tilt (вперёд +)
    pose.loc = R0["Hips"].inverted() @ (C(k.get("hips", (0, 0, 0))) * H)
    pose.fk()
    yaw = k.get("yaw", 0.0)
    q_yaw = Quaternion(UP, math.radians(-(yaw + spin)))  # + — грудью/тазом вправо; spin — вся поза
    pose.rotate("Hips", q_yaw)
    fwd = q_yaw @ FWD
    right = q_yaw @ RIGHT
    if k.get("tilt"):
        pose.rotate("Hips", toward(UP, fwd, k["tilt"]))
    # Корпус: разворот, наклон, боковой наклон — поровну на три позвонка
    tw, ln, sd = k.get("twist", 0.0), k.get("lean", 0.0), k.get("side", 0.0)
    for n, f in (("Spine", 0.3), ("Spine1", 0.35), ("Spine2", 0.35)):
        qt = Quaternion(UP, math.radians(-tw * f))
        d = toward(UP, fwd, ln * f) @ toward(UP, right, sd * f) @ qt
        pose.rotate(n, d)
    fwd_t = Quaternion(UP, math.radians(-(yaw + tw + spin))) @ FWD
    # Голова: обратно к цели (доля от разворота) + наклон
    hb = k.get("headBack", 0.7)
    hp = k.get("headPitch", 0.0)
    pose.rotate("Head", Quaternion(UP, math.radians((yaw + tw) * hb)) @ toward(UP, fwd_t, hp - ln * 0.5))
    # Ключицы: подъём плеча
    for s, side in (("Left", "L"), ("Right", "R")):
        sh = k.get("shrug", {}).get(side, 0.0)
        if sh:
            n = f"{s}Shoulder"
            pose.rotate(n, toward(pose.axis_y(n), UP, sh))
    # Ноги: ступни на земле
    feet = dict(STANCE_FEET)
    feet.update(k.get("feet", {}))
    for s, side in (("Left", "L"), ("Right", "R")):
        x, z, fy = feet[side]
        lift = k.get("lift", {}).get(side, 0.0)
        ankle = C((x * H, 0, z * H)) + UP * (ANKLE + lift * H)
        fq = Quaternion(UP, math.radians(-(fy + spin)))
        knee = (fq @ FWD) + C((0.25 if side == "R" else -0.25, 0, 0))
        ik2(pose, f"{s}UpLeg", f"{s}Leg", f"{s}Foot", ankle, knee, LLU, LLD)
        pose.set_world(f"{s}Foot", fq @ R0[f"{s}Foot"])
    # Руки: поставить, проверить проникновение в туловище и голову, вытолкнуть хват / отвести локоть, повторить
    push = {"R": Vector(), "L": Vector(), "two": Vector()}
    polepush = {"R": Vector(), "L": Vector()}
    if fixed is not None:
        push = {kk: v.copy() for kk, v in fixed[0].items()}
        polepush = {kk: v.copy() for kk, v in fixed[1].items()}
    tries = 18 if fixed is None else (fixed[2] if len(fixed) > 2 else 1)
    for _ in range(tries):
        hands = place_arms(pose, k, push, polepush)
        hit = penetration(pose)
        if hit is None or hit[2] < 0.004:
            break
        side, part, depth, n = hit
        step = n * (depth + 0.012)
        if part == "arms":
            # руки пересеклись: локти — в разные стороны, кисти (без двуручного хвата) — раздвинуть
            polepush["R"] += n * 1.5
            polepush["L"] -= n * 1.5
            if k.get("two"):
                # двуручное: вынести оружие от груди — руки распрямляются и расходятся
                push["two"] += C((0, 0, 1)) * (depth + 0.01)
            elif k.get("pair"):
                push["R"] += C((0, 0, 1)) * (depth + 0.01)
                push["L"] += C((0, 0, 1)) * (depth + 0.01)
            else:
                push["R"] += step * 0.5
                push["L"] -= step * 0.5
            continue
        if part == "upper":
            polepush[side] += n * 1.5
        if k.get("two"):
            push["two"] += step
        elif side == "RL" or k.get("pair"):  # двуручный хват (проход 3) — обе кисти вместе, хват на древке цел
            push["R"] += step
            push["L"] += step
        else:
            push[side] += step
    hit = penetration(pose)
    ERR["body"] = max(ERR.get("body", 0.0), hit[2] if hit else 0.0)
    pose.push, pose.polepush = push, polepush
    pose.fingers = {}
    for n in FINGERS:
        side = "R" if n.startswith("Right") else "L"
        held = side in hands and hands[side].get("hold", "kind" in hands[side] or "dir" in hands[side] or "shaft" in hands[side])
        pose.fingers[n] = FIST_Q[n] if held else RELAX_Q[n]
    return pose


def key_pose(act, frame, pose, prev):
    """Записать позу в клип на кадр; prev — прошлые кватернионы (для непрерывности знака)."""
    arm.animation_data.action = act
    pb = arm.pose.bones
    for n in BODY + FINGERS:
        q = pose.fingers[n] if n in pose.fingers else pose.q[n]
        q = q.copy()
        if n in prev and prev[n].dot(q) < 0:
            q.negate()
        prev[n] = q
        b = pb[n]
        b.rotation_mode = 'QUATERNION'
        b.rotation_quaternion = q
        b.keyframe_insert("rotation_quaternion", frame=frame)
    pb["Hips"].location = pose.loc
    pb["Hips"].keyframe_insert("location", frame=frame)
