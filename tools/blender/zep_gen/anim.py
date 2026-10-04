"""
Процедурные клипы по ролям костей: Idle, Walk, Run, Attack, HitReact, Death.
Позы задаются поворотами в осях арматуры (вокруг головы кости, относительно родителя) и смещением
таза; ноги — аналитическая IK на 2 кости (стопы стоят на земле, колено по «полюсу» из позы покоя).
Принципы анимации: замах → удар → возврат, запаздывание хвоста/головы, просадка таза, наклон на бегу.
Знаки (оси Blender, перед −Y): rx(+) — наклон «вперёд» для костей вверх (позвоночник), для висящих
конечностей вперёд — rx(−); rz — поворот корпуса; ry — крен.
"""
import math

from mathutils import Quaternion, Vector

FPS = 30


def rx(a):
    return Quaternion((1, 0, 0), a)


def ry(a):
    return Quaternion((0, 1, 0), a)


def rz(a):
    return Quaternion((0, 0, 1), a)


D = math.radians
I = Quaternion()


def smooth(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def ease_out(x):
    x = min(1.0, max(0.0, x))
    return 1 - (1 - x) ** 3


def ease_in(x):
    x = min(1.0, max(0.0, x))
    return x * x


def lerp(a, b, t):
    return a + (b - a) * t


def keys_lerp(keys, u):
    """Значение по ключам [(u, value)], сглаженная интерполяция между соседними."""
    if u <= keys[0][0]:
        return keys[0][1]
    for (u0, v0), (u1, v1) in zip(keys, keys[1:]):
        if u <= u1:
            t = (u - u0) / max(1e-9, u1 - u0)
            return lerp(v0, v1, smooth(t))
    return keys[-1][1]


class Rig:
    def __init__(self, arm_obj, roles, info):
        self.obj = arm_obj
        self.roles = roles
        self.info = info  # габариты тела: depth (толщина торса) и т. п.
        bones = arm_obj.data.bones
        self.names = [b.name for b in bones]
        self.q_rest = {b.name: b.matrix_local.to_quaternion() for b in bones}
        self.head = {b.name: b.head_local.copy() for b in bones}
        self.tail = {b.name: b.tail_local.copy() for b in bones}
        self.parent = {b.name: (b.parent.name if b.parent else None) for b in bones}
        self.L = roles.get("legLen", 1.0)
        self.legs = []
        for lg in roles.get("legs", []):
            th, sh, ft = lg["bones"]
            H, K, A = self.head[th], self.head[sh], self.head[ft]
            u = (A - H).normalized()
            pole = (K - H) - u * (K - H).dot(u)
            if pole.length < 1e-4:
                pole = Vector((0, -1, 0))
            self.legs.append({**lg, "H": H, "K": K, "A": A, "l1": (K - H).length, "l2": (A - K).length,
                              "pole": pole.normalized(), "flen": (self.tail[ft] - A).length})

    def local_scale(self, b, s):
        """Масштаб по осям арматуры (X, Y, Z) → по осям кости (у кости Y — вдоль неё)."""
        M = self.q_rest[b].to_matrix()
        return tuple(sum(abs(M[j][i]) * s[j] for j in range(3)) for i in range(3))

    # ---- прямая кинематика: поворот T и новая голова каждой кости ----
    def fk(self, pose, root_loc):
        T, Hn = {}, {}
        for n in self.names:
            p = self.parent[n]
            R = pose.get(n, I)
            if p is None:
                T[n] = R.copy()
                Hn[n] = self.head[n] + root_loc
            else:
                T[n] = T[p] @ R
                Hn[n] = T[p] @ (self.head[n] - self.head[p]) + Hn[p]
        return T, Hn

    def leg_ik(self, pose, root_loc, leg, target, pitch=0.0):
        th, sh, ft = leg["bones"]
        T, Hn = self.fk(pose, root_loc)
        par = self.parent[th]
        Tp = T[par] if par else I
        Hp = Tp @ (leg["H"] - self.head[par]) + Hn[par] if par else leg["H"] + root_loc
        l1, l2 = leg["l1"], leg["l2"]
        d = target - Hp
        dist = min(max(d.length, abs(l1 - l2) + 1e-4), (l1 + l2) * 0.9995)
        u = d.normalized()
        pole = Tp @ leg["pole"]
        w = pole - u * pole.dot(u)
        w = w.normalized() if w.length > 1e-6 else Vector((0, -1, 0))
        ca = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)
        sa = math.sqrt(max(0.0, 1 - ca * ca))
        Kn = Hp + (u * ca + w * sa) * l1
        An = Hp + u * dist
        u1 = (leg["K"] - leg["H"]).normalized()
        u2 = (leg["A"] - leg["K"]).normalized()
        R1 = u1.rotation_difference(Tp.inverted() @ (Kn - Hp).normalized())
        T1 = Tp @ R1
        R2 = u2.rotation_difference(T1.inverted() @ (An - Kn).normalized())
        T2 = T1 @ R2
        pose[th], pose[sh] = R1, R2
        pose[ft] = T2.inverted() @ rx(pitch)

    def plant(self, pose, root_loc, offsets=None, pitches=None):
        """Все ноги — IK к позе покоя стоп (+ смещения)."""
        for i, lg in enumerate(self.legs):
            off = offsets[i] if offsets else Vector()
            pit = pitches[i] if pitches else 0.0
            self.leg_ik(pose, root_loc, lg, lg["A"] + off, pit)


# ---------------- клипы ----------------

def _spine(rig, pose, pitch=0.0, yaw=0.0, roll=0.0):
    sp = rig.roles.get("spine", [])
    for b in sp:
        pose[b] = (pose.get(b, I) @ rz(yaw / len(sp)) @ rx(pitch / len(sp)) @ ry(roll / len(sp)))


def _arms(rig, pose, swing=None, elbow=None, out=None, base=None):
    for a in rig.roles.get("arms", []):
        sh, up, lo, hand = a["bones"]
        side = a["side"]
        sw = swing(a) if swing else 0.0
        el = elbow(a) if elbow else D(12)
        o = out(a) if out else 0.0
        b = base(a) if base else I
        pose[up] = b @ ry(-side * o) @ rx(-sw)
        pose[lo] = rx(-el)


def _tail(rig, pose, t, amp=D(12), lag=0.7, pitch=0.0):
    for i, b in enumerate(rig.roles.get("tail", [])):
        pose[b] = rz(amp * math.sin(2 * math.pi * t - lag * (i + 1))) @ rx(pitch)


def _gait(rig, t, run):
    """Шаг/бег: стопы по траектории (опора — назад по земле, перенос — дуга вперёд)."""
    L = rig.L
    kind = rig.roles["kind"]
    p = rig.info.get("anim", {}).get("run" if run else "walk", {})
    stride = p.get("stride", (1.0 if run else 0.55) * L * (0.8 if kind == "quad" else 1))
    lift = p.get("lift", (0.24 if run else 0.12) * L)
    bob = p.get("bob", (0.05 if run else 0.025) * L)
    crouch = p.get("crouch", (0.07 if run else 0.035) * L)
    duty = p.get("duty", 0.38 if run else 0.62)
    lean = D(p.get("lean", 12 if run else 3))
    pose = {}
    # таз: две просадки за цикл (на двойной опоре), на бегу — подлёт
    if run:
        z = bob * abs(math.sin(2 * math.pi * t)) - crouch
    else:
        z = -bob * math.cos(4 * math.pi * t) - crouch
    root = Vector((0, 0, z))
    pel = rig.roles["pelvis"]
    pose[pel] = rz(D(5 if run else 4) * math.sin(2 * math.pi * t)) @ ry(D(3) * math.sin(2 * math.pi * t))
    if kind == "biped":
        _spine(rig, pose, pitch=lean, yaw=-D(7 if run else 5) * math.sin(2 * math.pi * t))
        if rig.roles.get("head"):
            pose[rig.roles["head"]] = rx(-lean * 0.6 + D(2) * math.cos(4 * math.pi * t))
        amp = D(p.get("armSwing", 40 if run else 22))
        _arms(rig, pose,
              swing=lambda a: amp * math.cos(2 * math.pi * (t + a["phase"])),
              elbow=lambda a: D(75 if run else 18) + D(15 if run else 8) * max(0.0, math.cos(2 * math.pi * (t + a["phase"]))))
    else:
        _spine(rig, pose, pitch=D(2) * math.sin(4 * math.pi * t), yaw=D(4) * math.sin(2 * math.pi * t))
        if rig.roles.get("neck"):
            pose[rig.roles["neck"]] = rx(D(4 if run else 2) * math.sin(4 * math.pi * t + 0.8))
    _tail(rig, pose, t, amp=D(14 if run else 9), pitch=D(-8 if run else 0))
    offs, pits = [], []
    for lg in rig.legs:
        ph = (t + (lg.get("trot", lg["phase"]) if run and kind == "quad" else lg["phase"])) % 1.0
        if ph < duty:  # опора: стопа едет назад
            y = lerp(-stride / 2, stride / 2, ph / duty)
            zz = 0.0
            # отрыв пятки в конце опоры
            k = smooth((ph / duty - 0.7) / 0.3)
            pit = D(30 if run else 22) * k
            zz += lg["flen"] * math.sin(pit) * 0.8
        else:
            u = (ph - duty) / (1 - duty)
            y = lerp(stride / 2, -stride / 2, smooth(u))
            zz = lift * math.sin(math.pi * u) + lg["flen"] * math.sin(D(22)) * 0.8 * (1 - smooth(u * 3))
            pit = D(22) * (1 - smooth(u * 2.5)) - D(10) * math.sin(math.pi * u) * (0 if kind == "quad" else 1)
        offs.append(Vector((0, y, zz)))
        pits.append(pit)
    rig.plant(pose, root, offs, pits)
    return pose, root


def clip_idle(rig, t):
    L = rig.L
    kind = rig.roles["kind"]
    b = math.sin(2 * math.pi * t)
    pose = {}
    if kind == "blob":
        a = 0.045 * b
        return {rig.roles["pelvis"]: I, rig.roles["top"]: rx(D(3) * math.sin(2 * math.pi * t - 0.9))}, Vector(), {rig.roles["pelvis"]: (1 - a / 2, 1 - a / 2, 1 + a)}
    root = Vector((0.012 * L * math.sin(2 * math.pi * t), 0, -0.012 * L * (1 + math.sin(4 * math.pi * t)) / 2 - 0.02 * L))
    pose[rig.roles["pelvis"]] = ry(D(1.5) * math.sin(2 * math.pi * t))
    _spine(rig, pose, pitch=D(2) - D(1.8) * b, roll=-D(1.5) * math.sin(2 * math.pi * t))
    if rig.roles.get("head"):
        pose[rig.roles["head"]] = rz(D(7) * math.sin(2 * math.pi * t + 1.2)) @ rx(D(2) * math.sin(4 * math.pi * t))
    if kind == "biped":
        for a in rig.roles.get("arms", []):
            pose[a["bones"][0]] = ry(-a["side"] * D(2.5) * b)
        _arms(rig, pose, swing=lambda a: D(3) * math.sin(2 * math.pi * t + a["side"]), elbow=lambda a: D(16) + D(4) * b)
    if kind == "quad" and rig.roles.get("neck"):
        pose[rig.roles["neck"]] = rx(D(3) * b)
    _tail(rig, pose, t, amp=D(8), lag=0.6)
    rig.plant(pose, root)
    return pose, root, None


def clip_walk(rig, t):
    if rig.roles["kind"] == "blob":
        return _hop(rig, t, 0.35)
    p, r = _gait(rig, t, False)
    return p, r, None


def clip_run(rig, t):
    if rig.roles["kind"] == "blob":
        return _hop(rig, t, 0.22)
    p, r = _gait(rig, t, True)
    return p, r, None


def _hop(rig, t, height):
    """Слизень: присел → прыжок (вытянулся) → приземление (сплющился)."""
    H = rig.L * 2
    if t < 0.2:
        sq, z = 0.22 * smooth(t / 0.2), 0.0
    elif t < 0.75:
        u = (t - 0.2) / 0.55
        z = height * H * 4 * u * (1 - u)
        sq = -0.15 * math.sin(math.pi * u)
    elif t < 0.88:
        sq, z = 0.25 * math.sin(math.pi * (t - 0.75) / 0.13), 0.0
    else:
        sq, z = 0.0, 0.0
    body = rig.roles["pelvis"]
    pose = {body: I, rig.roles["top"]: rx(D(8) * math.sin(2 * math.pi * t - 1.2))}
    return pose, Vector((0, 0, z)), {body: (1 + sq * 0.6, 1 + sq * 0.6, 1 - sq)}


def clip_attack(rig, t):
    L = rig.L
    kind = rig.roles["kind"]
    style = rig.info.get("anim", {}).get("attack", "swing" if kind == "biped" else ("bite" if kind == "quad" else "lunge"))
    # замах 0–0.38 → удар 0.38–0.52 → задержка → возврат 0.62–1
    def ph(key):
        return keys_lerp(key, t)
    w = ph([(0, 0), (0.38, 1), (0.5, 0), (1, 0)])  # вес позы замаха
    if t < 0.38:
        s = 0.0
    elif t < 0.52:
        s = ease_out((t - 0.38) / 0.14)
    elif t < 0.62:
        s = 1.0
    else:
        s = 1 - smooth((t - 0.62) / 0.38)
    pose = {}
    scales = None
    if kind == "blob":
        body = rig.roles["pelvis"]
        sq = 0.25 * w - 0.2 * s
        root = Vector((0, -0.45 * L * s, 0.15 * L * s))
        pose[body] = rx(D(18) * s - D(8) * w)
        pose[rig.roles["top"]] = rx(D(10) * s)
        return pose, root, {body: (1 + sq * 0.6, 1 + sq * 0.6 - 0.15 * s, 1 - sq)}
    if kind == "quad":
        root = Vector((0, 0.08 * L * w - 0.22 * L * s, -0.06 * L * w))
        _spine(rig, pose, pitch=-D(6) * w + D(8) * s)
        if rig.roles.get("neck"):
            pose[rig.roles["neck"]] = rx(-D(28) * w + D(30) * s)
        if rig.roles.get("head"):
            pose[rig.roles["head"]] = rx(-D(15) * w + D(12) * s)
        for j in rig.roles.get("jaw", []):
            pose[j] = rx(D(35) * max(w, s * (1 - smooth((t - 0.55) / 0.2))))
        _tail(rig, pose, t, amp=D(10), pitch=D(-15) * w)
        rig.plant(pose, root)
        return pose, root, None
    # двуногий
    root = Vector((0, 0.03 * L * w - 0.1 * L * s, -0.04 * L * w - 0.06 * L * s))
    if style == "slam":
        _spine(rig, pose, pitch=-D(14) * w + D(30) * s)
        _arms(rig, pose, swing=lambda a: D(165) * w + D(60) * s * (1 - w), elbow=lambda a: D(70) * w + D(10) * s,
              out=lambda a: D(10) * w)
    elif style == "punch":
        _spine(rig, pose, pitch=D(10) * s, yaw=-D(25) * w + D(30) * s)
        _arms(rig, pose,
              swing=lambda a: (-D(35) * w + D(85) * s) if a["side"] < 0 else (D(30) * w - D(20) * s),
              elbow=lambda a: (D(110) * w + D(5) * s) if a["side"] < 0 else D(60))
    else:  # swing — правой рукой сверху наискось
        _spine(rig, pose, pitch=-D(8) * w + D(22) * s, yaw=-D(28) * w + D(32) * s)
        _arms(rig, pose,
              swing=lambda a: (D(160) * w + D(40) * s) if a["side"] < 0 else (-D(25) * w + D(-15) * s + D(10)),
              elbow=lambda a: (D(85) * w + D(8) * s) if a["side"] < 0 else D(35),
              out=lambda a: (D(15) * w) if a["side"] < 0 else 0.0)
    if rig.roles.get("head"):
        pose[rig.roles["head"]] = rx(-D(8) * s)
    offs = []
    for lg in rig.legs:
        # выпад правой ногой при ударе
        front = "R" in lg["bones"][0][-2:]
        offs.append(Vector((0, -0.22 * L * s if front else 0.05 * L * s, 0.06 * L * math.sin(math.pi * min(1, s * 1.2)) if front and t < 0.52 else 0)))
    rig.plant(pose, root, offs)
    return pose, root, None


def clip_hit(rig, t):
    L = rig.L
    kind = rig.roles["kind"]
    a = ease_out(t / 0.2) if t < 0.2 else 1 - smooth((t - 0.2) / 0.8)
    pose = {}
    if kind == "blob":
        body = rig.roles["pelvis"]
        return {body: rx(-D(14) * a), rig.roles["top"]: rx(-D(12) * a)}, Vector((0, 0.08 * L * a, 0)), {body: (1 + 0.15 * a, 1 - 0.1 * a, 1 - 0.12 * a)}
    root = Vector((0, 0.07 * L * a, -0.03 * L * a))
    _spine(rig, pose, pitch=-D(18) * a, roll=D(4) * a)
    if rig.roles.get("head"):
        pose[rig.roles["head"]] = rx(-D(16) * a)
    if rig.roles.get("neck") and kind == "quad":
        pose[rig.roles["neck"]] = rx(-D(20) * a)
    _arms(rig, pose, swing=lambda x: -D(15) * a, elbow=lambda x: D(25) + D(30) * a, out=lambda x: D(22) * a)
    _tail(rig, pose, t, amp=D(6), pitch=-D(20) * a)
    rig.plant(pose, root)
    return pose, root, None


def clip_death(rig, t):
    L = rig.L
    kind = rig.roles["kind"]
    depth = rig.info.get("depth", 0.15 * L * 2)
    pose = {}
    if kind == "blob":
        body = rig.roles["pelvis"]
        f = ease_in(min(1, t / 0.5))
        bounce = 0.08 * math.sin(math.pi * min(1, max(0, (t - 0.5) / 0.2))) if t > 0.5 else 0
        sq = 0.75 * f - bounce
        return {body: I, rig.roles["top"]: rx(D(10) * f)}, Vector((0, 0, 0)), {body: (1 + sq * 0.9, 1 + sq * 0.9, max(0.12, 1 - sq))}
    stagger = smooth(t / 0.18)
    fall = ease_in(min(1, max(0, (t - 0.15) / 0.42)))
    bounce = 0.06 * math.sin(math.pi * min(1, max(0, (t - 0.57) / 0.12))) if t > 0.57 else 0
    if kind == "quad":
        # заваливается на бок
        root = Vector((0, 0, -(L - depth * 0.9) * fall + bounce * L))
        pose[rig.roles["pelvis"]] = ry(D(88) * fall)
        _spine(rig, pose, pitch=-D(5) * stagger, roll=D(4) * fall)
        if rig.roles.get("neck"):
            pose[rig.roles["neck"]] = rx(D(25) * stagger - D(10) * fall) @ ry(D(25) * fall)
        _tail(rig, pose, 0.25, amp=D(20) * fall)
        for lg in rig.legs:
            th, sh, ft = lg["bones"]
            pose[th] = rx(D(12) * fall)
            pose[sh] = rx(-D(20) * fall)
        return pose, root, None
    # двуногий: подкосились колени → падение на спину
    root = Vector((0, 0.3 * L * fall, -0.12 * L * stagger * (1 - fall) - (L - depth * 0.9) * fall + bounce * L))
    pose[rig.roles["pelvis"]] = rx(-D(82) * fall + D(8) * stagger * (1 - fall))
    _spine(rig, pose, pitch=D(12) * stagger * (1 - fall) - D(6) * fall)
    if rig.roles.get("head"):
        pose[rig.roles["head"]] = rx(D(15) * stagger * (1 - fall) - D(10) * fall) @ ry(D(25) * smooth((t - 0.6) / 0.3))
    _arms(rig, pose, swing=lambda a: D(25) * stagger * (1 - fall) - D(55) * fall, elbow=lambda a: D(30) + D(20) * fall,
          out=lambda a: D(45) * fall)
    bend = math.sin(math.pi * min(1, t / 0.55))
    for lg in rig.legs:
        th, sh, ft = lg["bones"]
        pose[th] = rx(-D(35) * bend - D(8) * fall)
        pose[sh] = rx(D(70) * bend + D(10) * fall)
        pose[ft] = rx(-D(20) * fall)
    return pose, root, None


CLIPS = {
    # имя: (функция, кадров, петля)
    "Idle": (clip_idle, 60, True),
    "Walk": (clip_walk, 32, True),
    "Run": (clip_run, 20, True),
    "Attack": (clip_attack, 26, False),
    "HitReact": (clip_hit, 16, False),
    "Death": (clip_death, 40, False),
}


def bake(rig, names=None, log=print):
    """Клипы → действия (Action) арматуры, ключ на каждый кадр для всех костей."""
    import bpy
    arm = rig.obj
    if arm.animation_data is None:
        arm.animation_data_create()
    made = []
    scene = bpy.context.scene
    scene.render.fps = FPS  # и для выгрузки: glTF берёт время клипов из fps сцены
    pbs = arm.pose.bones
    for pb in pbs:
        pb.rotation_mode = "QUATERNION"
    for name, (fn, frames, loop) in CLIPS.items():
        if names and name not in names:
            continue
        old = bpy.data.actions.get(name)
        if old:
            bpy.data.actions.remove(old)
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        arm.animation_data.action = act
        prev = {}
        n = frames if loop else frames - 1
        for f in range(frames + (1 if loop else 0)):
            t = (f % frames) / frames if loop else f / max(1, n)
            pose, root, scales = fn(rig, t)
            for b in rig.names:
                R = pose.get(b, I)
                q = rig.q_rest[b].inverted() @ R @ rig.q_rest[b]
                if b in prev and prev[b].dot(q) < 0:
                    q.negate()
                prev[b] = q
                pb = pbs[b]
                pb.rotation_quaternion = q
                pb.keyframe_insert("rotation_quaternion", frame=f + 1, group=b)
                if rig.parent[b] is None:
                    pb.location = rig.q_rest[b].inverted() @ root
                    pb.keyframe_insert("location", frame=f + 1, group=b)
                if rig.roles["kind"] == "blob":
                    pb.scale = rig.local_scale(b, (scales or {}).get(b, (1, 1, 1)))
                    pb.keyframe_insert("scale", frame=f + 1, group=b)
        made.append({"name": name, "sec": round(frames / FPS, 2), "loop": loop})
    arm.animation_data.action = None
    for pb in pbs:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
    return made
