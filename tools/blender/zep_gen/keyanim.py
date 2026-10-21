"""
Клипы «по ключам» для своих мобов и боссов (так сделан Ледяной гигант — tools/blender/icegiant_anim.py).
Скрипт существа описывает каждый клип функцией clip(rig_, u) → поза; отсюда — общие кирпичи:

  K(keys, t)      — значение по ключам (секунда, значение[, переход]); значение — число или кортеж.
                    Переход на отрезке К этому ключу: s — плавно (по умолчанию), i — разгон (сам удар),
                    o — торможение (дотяжка), l — ровно, b — с перелётом ≈8% (удар «доводится» и пружинит).
  Q(ax, ay, az)   — поворот кости в осях арматуры (градусы), side=−1 — зеркально для правой стороны.
  BipedPose(rig)  — поза двуногого скелета biped (Hips → Spine → Chest → Neck → Head, руки, ноги):
                    torso / head делят наклон между двумя костями, arm(s, sh, up, lo, hand), ноги — IK:
                    feet[i] — сдвиг стопы от покоя (м), pitch[i] — наклон стопы (рад, > 0 — носок вниз),
                    root — сдвиг таза. done() ставит стопы на землю (anim.Rig.plant).
  biped_gait(...) — шаг/бег: опора со стопой на земле, перекат пятка → носок, перенос веса, крен,
                    встречный поворот плеч, отмашка рук с запаздыванием. Параметры — GAIT_KEYS ниже.
  shake(...)      — затухающая дрожь (удар оземь, рёв).

Знаки осей (перед модели −Y, +X — левая сторона): корпус/шея/голова ax>0 — наклон вперёд, ay>0 — крен
влево, az>0 — поворот влево; ключица ay<0 — поднять, az<0 — вперёд; рука ax<0 — вперёд/вверх, ay<0 —
отвести в сторону/вверх, az<0 — поперёк корпуса; локоть и кисть ax<0 — согнуть. Углы рук задаются «для
левой стороны»: правая — зеркально (side=−1 меняет знак ay и az).
"""
import math

from mathutils import Quaternion, Vector

D = math.radians
I = Quaternion()


def smooth(u):
    return u * u * (3 - 2 * u)


def _back(u):
    # торможение с небольшим перелётом (≈8%) — «дотяжка» удара
    c = 1.9
    u -= 1
    return 1 + (c + 1) * u * u * u + c * u * u


EASE = {
    "s": smooth,
    "i": lambda u: u * u * u,
    "o": lambda u: 1 - (1 - u) ** 3,
    "l": lambda u: u,
    "b": _back,
}


def K(keys, t):
    """Значение по ключам (секунда, значение[, переход]); значение — число или кортеж."""
    if t <= keys[0][0]:
        return keys[0][1]
    for k0, k1 in zip(keys, keys[1:]):
        if t <= k1[0]:
            u = (t - k0[0]) / max(1e-9, k1[0] - k0[0])
            e = EASE[k1[2] if len(k1) > 2 else "s"](u)
            v0, v1 = k0[1], k1[1]
            if isinstance(v0, tuple):
                return tuple(x0 + (x1 - x0) * e for x0, x1 in zip(v0, v1))
            return v0 + (v1 - v0) * e
    return keys[-1][1]


def Q(ax=0.0, ay=0.0, az=0.0, side=1):
    return Quaternion((0, 0, 1), D(az * side)) @ Quaternion((0, 1, 0), D(ay * side)) @ Quaternion((1, 0, 0), D(ax))


def shake(t, t0, t1, amp, hz=13.0):
    """Затухающая дрожь амплитуды amp на отрезке t0..t1 (с)."""
    if t < t0 or t > t1:
        return 0.0
    k = 1 - (t - t0) / (t1 - t0)
    return amp * k * k * math.sin((t - t0) * hz * 2 * math.pi)


class BipedPose:
    """Поза скелета biped (кости шаблона zep_gen: Hips, Spine, Chest, Neck, Head, Shoulder/UpperArm/
    LowerArm/Hand и UpperLeg/LowerLeg/Foot с .L/.R). Стопы — IK к земле через rig.plant."""

    def __init__(self, rig):
        self.rig = rig
        self.d = {}
        self.root = Vector()
        self.feet = [Vector(), Vector()]  # смещения стоп L, R (м, оси арматуры)
        self.pitch = [0.0, 0.0]

    def rot(self, bone, ax=0.0, ay=0.0, az=0.0, side=1):
        self.d[bone] = self.d.get(bone, I) @ Q(ax, ay, az, side)

    def torso(self, ax=0.0, ay=0.0, az=0.0):
        """Корпус: делим между Spine (40%) и Chest (60%)."""
        self.rot("Spine", ax * 0.4, ay * 0.4, az * 0.4)
        self.rot("Chest", ax * 0.6, ay * 0.6, az * 0.6)

    def head(self, ax=0.0, ay=0.0, az=0.0):
        self.rot("Neck", ax * 0.4, ay * 0.4, az * 0.4)
        self.rot("Head", ax * 0.6, ay * 0.6, az * 0.6)

    def arm(self, s, sh=(0, 0, 0), up=(0, 0, 0), lo=0.0, hand=0.0):
        """Рука стороны s ("L"/"R"): ключица, плечо (ax, ay, az), локоть и кисть (ax)."""
        side = 1 if s == "L" else -1
        self.rot("Shoulder." + s, *sh, side=side)
        self.rot("UpperArm." + s, *up, side=side)
        self.rot("LowerArm." + s, lo, 0, 0, side)
        self.rot("Hand." + s, hand, 0, 0, side)

    def done(self):
        self.rig.plant(self.d, self.root, self.feet, self.pitch)
        return self.d, self.root, None


def foot_roll(rig, i, pit, heel_back):
    """Сдвиг лодыжки, чтобы стопа поворачивалась вокруг точки на земле, а не вокруг лодыжки:
    носок вниз (pit > 0) — вокруг носка, носок вверх (pit < 0) — вокруг пятки. Без этого носок
    уходит под землю на отрыве, а пятка — на касании. heel_back — где пятка позади лодыжки (м, +Y)."""
    lg = rig.legs[i]
    A = lg["A"]
    if pit >= 0:
        T = rig.tail[lg["bones"][2]]
        P = Vector((T.x, T.y, max(0.0, T.z - 0.03)))
    else:
        P = Vector((A.x, A.y + heel_back, 0.0))
    R = Quaternion((1, 0, 0), D(pit))
    return P + R @ (A - P) - A


# Параметры biped_gait (метры — в масштабе модели, углы — градусы):
#   stride длина шага, duty доля опоры (шаг ≈0.6, бег < 0.5 — есть полёт), lift подъём стопы;
#   crouch присед, bob просадка таза после касания, sway перенос веса вбок, roll/yaw крен и поворот таза;
#   lean наклон вперёд, pitch кивок корпуса, lat крен корпуса, twist встречный поворот плеч, nod кивок головы;
#   lag запаздывание рук; shrug плечи, arm0/arm/armOut плечо (база/размах/отвод), elbow/elbowK локоть,
#   hand0/handK кисть; heel отрыв пятки в конце опоры, toeUp носок вверх перед касанием.
GAIT_KEYS = ("stride", "duty", "lift", "crouch", "bob", "sway", "roll", "yaw", "lean", "pitch", "lat", "twist", "nod",
             "lag", "shrug", "arm0", "arm", "armOut", "elbow", "elbowK", "hand0", "handK", "heel", "toeUp")


def biped_gait(rig, pose, u, g, heel_back=0.07):
    """Шаг/бег двуногого. u — доля цикла 0..1: левая стопа касается земли в u=0, правая — в 0.5.
    pose — новая поза (BipedPose или её наследник с позой рук покоя существа)."""
    p = pose
    S, duty, lift = g["stride"], g["duty"], g["lift"]
    tau = 2 * math.pi
    s = (u * 2) % 1.0  # доля шага (от касания)
    # таз: просадка сразу после касания (вес принят), выше всего — в середине опоры
    p.root.z = -g["crouch"] - g["bob"] * 0.5 * (1 + math.cos(tau * (s - 0.12)))
    # перенос веса на опорную ногу (левая опора — середина u≈0.3)
    p.root.x = g["sway"] * math.cos(tau * (u - 0.28))
    p.rot("Hips", 0, -g["roll"] * math.cos(tau * (u - 0.28)), -g["yaw"] * math.cos(tau * u))
    # корпус: наклон, встречный поворот плеч, крен на опорную ногу, кивок после удара стопы
    lean = g["lean"] + g["pitch"] * math.cos(tau * (s - 0.22))
    p.torso(lean, g["lat"] * math.cos(tau * (u - 0.33)), g["twist"] * math.cos(tau * (u - 0.04)))
    p.head(-lean * 0.7 + g["nod"] * math.cos(tau * (s - 0.3)), -g["lat"] * 0.6 * math.cos(tau * (u - 0.4)),
           -g["twist"] * 0.55 * math.cos(tau * (u - 0.1)))
    # руки: встречно ногам, с запаздыванием; вперёд — локоть сгибается сильнее
    for s_, ph in (("L", 0.5), ("R", 0.0)):
        f = math.cos(tau * (u - ph - g["lag"]))
        fh = math.cos(tau * (u - ph - g["lag"] - 0.08))
        p.arm(s_, (g["shrug"] * f, -3 + 2 * abs(f), -g["shrug"] * f),
              (-g["arm0"] - g["arm"] * f, -g["armOut"], 4),
              -(g["elbow"] + g["elbowK"] * max(0.0, f)),
              -(g["hand0"] + g["handK"] * fh))
    for i, ph in enumerate((0.0, 0.5)):
        q = (u + 1 - ph) % 1.0
        if q < duty:  # опора: стопа едет назад по земле
            v = q / duty
            y = -S / 2 + S * v
            zz = 0.008  # сгиб голени чуть «проминает» подошву в землю — на столько выше
            # касание пяткой → стопа плавно ложится плашмя → в конце опоры пятка отрывается (перекат на носок)
            pit = -g["toeUp"] * (1 - smooth(min(1.0, v / 0.2))) + g["heel"] * smooth(max(0.0, (v - 0.68) / 0.32))
        else:  # перенос: дуга вперёд, перед касанием носок задран (пятка первой)
            v = (q - duty) / (1 - duty)
            y = S / 2 - S * smooth(v)
            zz = lift * math.sin(math.pi * v) ** 1.3
            pit = g["heel"] * (1 - smooth(min(1.0, v * 2.2))) - g["toeUp"] * smooth(max(0.0, (v - 0.55) / 0.45))
        p.feet[i] = Vector((0, y, zz)) + foot_roll(rig, i, pit, heel_back)
        p.pitch[i] = D(pit)
    return p.done()
