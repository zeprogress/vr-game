"""
Клипы Владыки Бездны (дракон DragonBest) — с нуля, по ключам (2026-10-21).

Принципы, чтобы зверь был живым, а не деревянным: замах перед действием и дотяжка после, вес (корпус оседает
на опорные лапы, стопы стоят на земле — обратная кинематика в каждом кадре), перекрытие (шея отстаёт от груди,
голова — от шеи, хвост — волной от основания к кончику, пальцы крыльев — за крылом), дуги и неравномерный
тайминг (ключи K с разгоном/торможением/перелётом из zep_gen/keyanim.py), асимметрия левой и правой стороны.

Знаки осей (как в keyanim.py): нос модели −Y, +X — левая сторона; корпус/шея/голова ax>0 — наклон вперёд
(нос вниз), ay>0 — крен влево, az>0 — поворот влево. Крыло: раскрыть — вокруг вертикали Z, поднять — вокруг
продольной оси Y (наклон вокруг X раскрытое крыло не поднимает, а скручивает). Хвост: ax>0 у основания — вверх.

Скорость шага по земле — как у прежних клипов: ходьба ≈ 0.22 м/с, бег ≈ 1.05 м/с (темп бега в игре
подгоняется под скорость моба — Mob.ts RUN_CLIP_SPEED; ходьба идёт с обычным темпом).
Длительности клипов те же, что раньше (игра на них не завязана жёстко, но так не меняется ритм боя).

Риг: суставы ставит пользователь в art/build/DragonBest_rigZEP.blend → переносятся в art/models/DragonBest.json →
fit_rig.py (тепловые веса, Root без деформации) → art/build/DragonBest_rig.blend → этот скрипт →
public/models/gen/DragonBest.glb.

Запуск: Blender -b --factory-startup -noaudio -P tools/blender/dragon_anim.py -- art/build/DragonBest_rig.blend \\
        public/models/gen/DragonBest.glb [--only Idle,Walk]   (--only — только для проверки, в игру — все клипы)
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
from mathutils import Quaternion, Vector  # noqa: E402
import zep_lib as z  # noqa: E402
from zep_gen import anim, build  # noqa: E402
from zep_gen.keyanim import D, I, K, Q, shake, smooth  # noqa: E402

FPS = anim.FPS

a = z.args()
src, out = a[0], a[1]
z.load(src)
arm = z.armatures()[0]

ROLES = {
    "kind": "quad", "pelvis": "Pelvis", "top": "Chest", "spine": ["Spine1", "Chest"],
    "neck": "Neck1", "head": "Head", "jaw": ["Jaw"],
    "tail": [f"Tail{k}" for k in range(1, 9)],
    # порядок ног — индексы стоп в P.feet: 0 задняя левая, 1 задняя правая, 2 передняя левая, 3 передняя правая
    "legs": [
        {"bones": ["HindLeg1.L", "HindLeg2.L", "HindFoot.L"], "phase": 0.0},
        {"bones": ["HindLeg1.R", "HindLeg2.R", "HindFoot.R"], "phase": 0.5},
        {"bones": ["FrontLeg1.L", "FrontLeg2.L", "FrontFoot.L"], "phase": 0.25},
        {"bones": ["FrontLeg1.R", "FrontLeg2.R", "FrontFoot.R"], "phase": 0.75},
    ],
    "arms": [],
    "legLen": 0.5,
}
rig = anim.Rig(arm, ROLES, {"anim": {}, "depth": 0.3})
HL, HR, FL, FR = 0, 1, 2, 3

# Сгиб передних ног — явно: локти назад (по направлению таз → голова). Задние — из геометрии рига.
_fwd = rig.head["Head"] - rig.head["Pelvis"]
_fwd.z = 0.0
_fwd.normalize()
for _lg in rig.legs:
    if _lg["bones"][2].startswith("Front"):
        _lg["pole"] = (-_fwd).normalized()

TAIL = [f"Tail{k}" for k in range(1, 9)]
# Опора дыб (м по +Y от корня): середина между тазобедренными суставами и основанием хвоста. Корень стоит у
# земли под грудью — поворот вокруг него опускал таз и основание хвоста в землю.
PIVOT_Y = ((rig.head["HindLeg1.L"].y + rig.head["HindLeg1.R"].y) / 2 + rig.head["Tail1"].y) / 2 - rig.head["Root"].y


# Передние лапы нигде не выпрямляются полностью — полусогнуты (как в покое: 98–132°). Угол в локте не больше:
FRONT_ELBOW_MAX = 135.0  # °, 180 — прямая лапа
# Сколько корпус может осесть, чтобы опорная передняя лапа осталась согнутой; дальше (на дыбах) лапа
# поджимается и отрывается от земли — иначе корпус проседал и задние лапы уходили в землю.
FRONT_DROP_MAX = 0.03  # м


def _reach(lg, deg):
    """Расстояние плечо → стопа при угле в локте deg."""
    return math.sqrt(lg["l1"] ** 2 + lg["l2"] ** 2 - 2 * lg["l1"] * lg["l2"] * math.cos(D(deg)))


def _hip(T, Hn, lg):
    """Где сейчас верх ноги (плечо/бедро) — как в anim.Rig.leg_ik."""
    th = lg["bones"][0]
    par = rig.parent[th]
    return T[par] @ (lg["H"] - rig.head[par]) + Hn[par]


def plant_legs(pose, root, feet, pitch):
    """Стопы — обратная кинематика. Передние лапы не разгибаются больше FRONT_ELBOW_MAX: опорная лапа тянется —
    корпус чуть оседает (вес на лапе, не больше FRONT_DROP_MAX), остальное — лапа поджимается к плечу
    (на дыбах отрывается от земли). Возвращает корень (мог опуститься)."""
    root = root.copy()
    targets = []
    for i, lg in enumerate(rig.legs):
        t = lg["A"] + feet[i]
        # пятка отрывается — стопа перекатывается через носок (×1.15 — когти длиннее кости стопы)
        t.z += 1.15 * lg["flen"] * math.sin(max(0.0, pitch[i]))
        targets.append(t)
    T, Hn = rig.fk(pose, root)
    drop = 0.0
    for i in (FL, FR):
        lg = rig.legs[i]
        if feet[i].z > 0.01:
            continue
        h, t = _hip(T, Hn, lg), targets[i]
        r = _reach(lg, FRONT_ELBOW_MAX)
        horiz = math.hypot(t.x - h.x, t.y - h.y)
        if (t - h).length > r and horiz < r:
            drop = max(drop, h.z - (t.z + math.sqrt(r * r - horiz * horiz)))
    drop = min(drop, FRONT_DROP_MAX)
    if drop > 0:
        root.z -= drop
        T, Hn = rig.fk(pose, root)
    for i in (FL, FR):
        lg = rig.legs[i]
        h = _hip(T, Hn, lg)
        r = _reach(lg, FRONT_ELBOW_MAX)
        d = targets[i] - h
        if d.length > r:
            targets[i] = h + d * (r / d.length)
    for i, lg in enumerate(rig.legs):
        rig.leg_ik(pose, root, lg, targets[i], pitch[i])
    return root


class P:
    """Поза кадра: повороты костей (оси арматуры), сдвиг корня, сдвиги стоп от покоя; done() ставит стопы."""

    def __init__(self):
        self.q = {}
        self.root = Vector((0.0, 0.0, 0.0))
        self.feet = [Vector((0.0, 0.0, 0.0)) for _ in range(4)]
        self.pitch = [0.0, 0.0, 0.0, 0.0]  # наклон стопы, рад (> 0 — носок вниз)

    def rot(self, bone, ax=0.0, ay=0.0, az=0.0):
        self.q[bone] = self.q.get(bone, I) @ Q(ax, ay, az)

    def body(self, ax=0.0, ay=0.0, az=0.0):
        """Корпус целиком (корень). На дыбы (ax < 0) — с опорой позади, на задних лапах (корень поднимается,
        таз и основание хвоста не уходят в землю), хвост и сложенные крылья гасят наклон. Носом вниз (ax > 0)
        хвост поднимается сам — противовес."""
        self.rot("Root", ax, ay, az)
        if ax < 0:
            self.root.z += PIVOT_Y * math.sin(D(-ax))
            self.wings(lift=-ax * 0.7)
            self.rot("Tail1", ax=-ax)

    def neck(self, ax=0.0, ay=0.0, az=0.0):
        """Шея и голова: наклон делится по звеньям (основание — больше), голова довершает."""
        for b, k in (("Neck1", 0.4), ("Neck2", 0.35), ("Head", 0.25)):
            self.rot(b, ax * k, ay * k, az * k)

    def tail(self, fn):
        """fn(i) → (ax, ay, az) для звена i = 1..8 (от основания к кончику)."""
        for i, b in enumerate(TAIL, 1):
            self.rot(b, *fn(i))

    def wing(self, side, spread=0.0, lift=0.0, fore=0.0, fan=0.0):
        """Крыло: spread — раскрыть наружу (°), lift — поднять (°, < 0 — вниз), fore — довернуть предплечье,
        fan — развести пальцы веером. Сначала раскрыть, потом поднять (вокруг продольной оси тела)."""
        sg = -1 if side == "L" else 1
        q1 = Quaternion((0, 1, 0), D(sg * lift)) @ Quaternion((0, 0, 1), D(sg * spread))
        self.q[f"WingArm1.{side}"] = self.q.get(f"WingArm1.{side}", I) @ q1
        q2 = Quaternion((0, 1, 0), D(sg * lift * 0.35)) @ Quaternion((0, 0, 1), D(sg * (spread * 0.2 + fore)))
        self.q[f"WingArm2.{side}"] = self.q.get(f"WingArm2.{side}", I) @ q2
        for i in range(1, 5):
            self.rot(f"WingFinger{i}.{side}", az=sg * (i - 2.5) * -fan)

    def wings(self, spread=0.0, lift=0.0, fore=0.0, fan=0.0, lag=None):
        self.wing("L", spread, lift, fore, fan)
        self.wing("R", spread, lift if lag is None else lag, fore, fan)

    def done(self):
        pose = dict(self.q)
        root = plant_legs(pose, self.root, self.feet, self.pitch)
        return pose, root, None


# ---------------------------------------------------------------- стойка с весом (основа покоя и атак)

# Стойка, которая понравилась пользователю (версия 5326ceaf): корпус ровный и низко, все четыре лапы согнуты
# (передние — в локте; раньше риг ломал их в двух местах, теперь веса и суставы исправлены).
WEIGHT_DROP = 0.12  # м: корпус ближе к земле, на выдохе ниже, на вдохе выше
WEIGHT_PITCH = 0.0  # °: без наклона (вариант «вес на задних, плечи выше» — не тот)


def stance(p, k=1.0):
    """Стойка покоя: корпус опущен и наклонён носом вверх; шея, голова и хвост гасят наклон (взгляд ровный,
    кончик хвоста не уходит под землю). k — доля стойки (0 — поза рига)."""
    p.root.z -= WEIGHT_DROP * k
    p.rot("Root", ax=-WEIGHT_PITCH * k)
    p.neck(ax=WEIGHT_PITCH * k)
    # хвост и сложенные крылья гасят наклон: концы пальцев крыльев и основание хвоста не уходят под землю
    p.rot("Tail1", ax=(WEIGHT_PITCH + 2.0) * k)
    p.wings(lift=7.0 * k)


# ---------------------------------------------------------------- покой

IDLE_SEC = 3.0


# Покой — тот, что понравился пользователю (версия 5326ceaf, 2026-10-21: ровный корпус, присед 12 см,
# передние лапы согнуты), формулы те же. Стопы перекладываются после дыхания (раньше чуть скользили).
IDLE_WING_LIFT = 0.0  # ° — подъём крыльев, если кончики уйдут под землю
IDLE_TIP_LIFT = 0.0  # ° — подъём хвоста, если кончик уйдёт под землю


def _rx(deg):
    return Quaternion((1, 0, 0), D(deg))


def _ry(deg):
    return Quaternion((0, 1, 0), D(deg))


def _rz(deg):
    return Quaternion((0, 0, 1), D(deg))


def clip_idle(rig_, u):
    """Покой: корпус низко на согнутых лапах, на вдохе поднимается, на выдохе опускается;
    грудь дышит, голова и шея покачиваются, хвост — волной от основания к кончику, крылья мягко дышат,
    вес переходит с ноги на ногу. Стопы стоят на земле (IK)."""
    k = 2 * math.pi * u
    b = math.sin(k)
    root = Vector((0.0, 0.0, -WEIGHT_DROP * (0.85 + 0.15 * b)))
    pose = {}
    # стойка с весом
    pose["Root"] = _rx(-WEIGHT_PITCH)
    pose["Pelvis"] = _ry(1.2 * b)
    anim._spine(rig_, pose, pitch=D(1.5) * b, roll=-D(1.0) * b)
    pose["Neck1"] = _rx(3.0 * b + WEIGHT_PITCH * 0.6)
    pose["Head"] = _rz(5.0 * math.sin(k + 1.2)) @ _rx(2.0 * math.sin(2 * k) + WEIGHT_PITCH * 0.4)
    anim._tail(rig_, pose, u, amp=D(8), lag=0.6)
    pose["Tail1"] = _rx(WEIGHT_PITCH + IDLE_TIP_LIFT) @ pose.get("Tail1", I)
    # крылья: один мягкий взмах за цикл (> 0 — вниз, правое зеркально)
    flap = 6.0 * b - IDLE_WING_LIFT
    pose["WingArm1.L"] = _ry(flap)
    pose["WingArm1.R"] = _ry(-flap)
    pose["WingArm2.L"] = _ry(flap * 0.7)
    pose["WingArm2.R"] = _ry(-flap * 0.7)

    # живость поверх: дыхание грудью, голова и шея, хвост волной, шевеление крыльев, вес с ноги на ногу
    def add(bone, q):
        pose[bone] = pose.get(bone, I) @ q

    add("Chest", _rx(2.5 * math.sin(k)))
    add("Spine1", _rx(1.2 * math.sin(k - 0.4)))
    add("Neck1", _rx(-1.5 * math.sin(k)))
    add("Neck2", _rx(-1.0 * math.sin(k - 0.2)))
    add("Head", _ry(7.0 * math.sin(k)) @ _rx(2.0 * math.sin(k + 0.5)))
    add("Head", _ry(2.5 * math.sin(2 * k + 1.2)))
    add("Jaw", _rx(2.2 * max(0.0, math.sin(k))))
    add("Root", _rz(0.8 * math.sin(k)))
    for i in range(1, 9):
        add(f"Tail{i}", _rz(3.0 * math.sin(k - 0.45 * i)) @ _rx(1.5 * math.sin(2 * k - 0.3 * i)))
    add("WingArm2.L", _ry(2.5 * math.sin(2 * k + 0.8)))
    add("WingArm2.R", _ry(-2.5 * math.sin(2 * k + 0.8)))
    # грудь и корень сдвинули плечи и таз — стопы на место (передние лапы — полусогнуты)
    root = plant_legs(pose, root, [Vector((0.0, 0.0, 0.0))] * 4, [0.0] * 4)
    return pose, root, None


# ---------------------------------------------------------------- шаг и бег

WALK_SEC, RUN_SEC = 1.6, 1.0
# Шаг: латеральная последовательность (задняя левая → передняя левая → задняя правая → передняя правая).
WALK = {"stride": 0.25, "duty": 0.70, "lift": 0.07, "phase": (0.0, 0.5, 0.25, 0.75)}
# Бег: галоп — задние парой, передние парой со сдвигом, между ними полёт.
RUN = {"stride": 0.37, "duty": 0.35, "lift": 0.14, "phase": (0.0, 0.08, 0.45, 0.55)}


def foot_cycle(u, phase, g):
    """Стопа на цикле: опора — на земле едет назад (равномерно, это и есть скорость), в конце опоры пятка
    отрывается; перенос — дугой вперёд, лапа подогнута и раскрывается к касанию."""
    ph = (u - phase) % 1.0
    duty, stride, lift = g["duty"], g["stride"], g["lift"]
    if ph < duty:
        s = ph / duty
        pit = D(24) * max(0.0, (s - 0.72) / 0.28) ** 2
        return Vector((0.0, -stride / 2 + stride * s, 0.0)), pit
    s = (ph - duty) / (1 - duty)
    y = stride / 2 - stride * smooth(s)
    zz = lift * math.sin(math.pi * s) * (1.0 + 0.25 * math.sin(math.pi * s))
    pit = D(24) * (1 - smooth(s)) + D(14) * math.sin(math.pi * s)
    return Vector((0.0, y, zz)), pit


def clip_walk(rig_, u):
    """Шаг: стопы по очереди, корпус проседает на двойной опоре и качается к опорной стороне, спина изгибается
    S-образно (таз и грудь — навстречу), шея держит голову ровно, хвост волной, крылья подрагивают в такт."""
    k = 2 * math.pi * u
    p = P()
    for i, ph in enumerate(WALK["phase"]):
        p.feet[i], p.pitch[i] = foot_cycle(u, ph, WALK)
    p.root.z = -0.10 - 0.012 * math.cos(2 * k)  # низкая посадка, как в покое: передние лапы полусогнуты
    p.root.x = 0.018 * math.sin(k)
    p.rot("Root", ax=-3.0, az=2.0 * math.sin(k))
    p.rot("Pelvis", ay=2.0 * math.sin(k), az=3.0 * math.sin(k))
    p.rot("Spine1", az=-2.0 * math.sin(k))
    p.rot("Chest", ay=-2.0 * math.sin(k + 0.5 * math.pi), az=-2.5 * math.sin(k))
    p.neck(ax=3.0 + 1.2 * math.cos(2 * k + 0.5), az=1.6 * math.sin(k + 0.4))
    p.rot("Head", ax=-0.8 * math.cos(2 * k + 0.9))
    p.rot("Tail1", ax=3.0)
    p.tail(lambda i: (0.8 * math.sin(2 * k - 0.4 * i), 0.0, (2.0 + 0.9 * i) * math.sin(k - 0.55 * i)))
    p.wings(spread=3, lift=2.5 * math.sin(2 * k - 0.8), lag=2.5 * math.sin(2 * k - 1.1))
    return p.done()


def clip_run(rig_, u):
    """Бег (галоп): задние толкают парой, передние подхватывают, между ними полёт — корпус поднимается;
    спина сгибается, когда лапы собраны, и вытягивается в полёте; шея вытянута вперёд, голова гасит качку;
    хвост поднят и бьёт волной, крылья приоткрыты и взмахивают раз за шаг (равновесие)."""
    k = 2 * math.pi * u
    p = P()
    for i, ph in enumerate(RUN["phase"]):
        p.feet[i], p.pitch[i] = foot_cycle(u, ph, RUN)
    flight = max(0.0, math.sin(k - 0.4))
    p.root.z = -0.06 + 0.06 * flight
    p.rot("Root", ax=4.0 + 4.0 * math.sin(k + 0.3), az=1.5 * math.sin(k))
    p.rot("Spine1", ax=5.0 * math.sin(k + 0.9))
    p.rot("Chest", ax=-3.5 * math.sin(k + 0.9))
    p.neck(ax=8.0 - 3.0 * math.sin(k + 1.4), az=1.0 * math.sin(k))
    # голова покачивается по инерции — с запаздыванием за качкой корпуса (вверх-вниз и чуть в стороны)
    p.rot("Head", ax=-9.0 + 2.5 * math.sin(k + 1.8) + 4.0 * math.sin(k - 0.9), az=2.5 * math.sin(k - 1.2))
    p.rot("Jaw", ax=6.0 + 3.0 * max(0.0, math.sin(k + 2.0)))
    p.rot("Tail1", ax=2.0)  # хвост ближе к земле
    p.tail(lambda i: (2.0 * math.sin(k - 0.5 * i), 0.0, (2.5 + 1.1 * i) * math.sin(k - 0.6 * i)))
    p.wings(spread=18, lift=6 + 12 * math.sin(k - 0.5), fan=6, lag=6 + 12 * math.sin(k - 0.65))
    return p.done()


# ---------------------------------------------------------------- разворот на месте (бой)
# Игра крутит модель вокруг её начала координат не быстрее TURN_RATE и, пока дракон стоит, играет TurnL/TurnR
# с темпом «скорость разворота / TURN_RATE». В клипе корпус неподвижен, а стоящие стопы плывут назад по дуге
# ровно с этой скоростью — в мире стопа стоит на месте; шагает — вперёд, догоняя корпус. Пары по диагонали.
TURN_RATE = 60.0  # °/с — то же число, что ELITE_MOBS.catDragon.turnRate в src/shared/mobs.ts
TURN_SEC = 1.0
TURN_PERIOD = 0.5  # с — каждая лапа шагает раз в 0.5 с (при обычном темпе)
TURN_STEP = 0.2  # с — сам шаг
TURN_PHASE = {HL: 0.0, FR: 0.0, HR: TURN_PERIOD / 2, FL: TURN_PERIOD / 2}
MODEL_ORIGIN = Vector((0.0, 0.0, 0.0))  # вокруг начала координат модели её крутит игра (Mob.ts root.rotation.y)


def clip_turn(sign):
    """Разворот на месте: sign = +1 — влево, −1 — вправо. Корпус чуть клонится в поворот, голова ведёт
    поворот, хвост отстаёт; лапы переставляются парами, стоящие стопы плывут против поворота."""
    def f(rig_, u):
        s = u * TURN_SEC
        k = 2 * math.pi * u
        p = P()
        stance(p)
        amp = TURN_RATE * (TURN_PERIOD - TURN_STEP) / 2  # стопа ходит вокруг корпуса ±amp
        for leg, ph in TURN_PHASE.items():
            tau = (s - ph) % TURN_PERIOD
            planted = TURN_PERIOD - TURN_STEP
            if tau < planted:
                psi, h, pit = amp - TURN_RATE * tau, 0.0, 0.0
            else:
                q = (tau - planted) / TURN_STEP
                psi, h, pit = -amp + 2 * amp * smooth(q), 0.07 * math.sin(math.pi * q), D(18) * math.sin(math.pi * q)
            a0 = rig.legs[leg]["A"]
            turned = MODEL_ORIGIN + Quaternion((0, 0, 1), D(sign * psi)) @ (a0 - MODEL_ORIGIN)
            p.feet[leg] = turned - a0 + Vector((0.0, 0.0, h))
            p.pitch[leg] = pit
        # чуть ниже стойки (передним лапам — запас на сгиб) и проседает на каждой паре шагов
        p.root.z -= 0.03 + 0.008 * (0.5 - 0.5 * math.cos(4 * k))
        p.body(ay=2.0 * sign)
        p.neck(az=14.0 * sign, ax=1.0 * math.sin(2 * k))
        p.tail(lambda i: (0.0, 0.0, -sign * (1.5 + 0.5 * i) + 1.5 * math.sin(k - 0.5 * i)))
        p.wings(spread=3, lift=1.5 * math.sin(2 * k))
        return p.done()
    return f


# ---------------------------------------------------------------- атаки

BITE_SEC, CLAW_SEC, TAIL_SEC, WINGS_SEC, BREATH_SEC, CHARGE_SEC = 1.2, 1.4, 2.6, 1.8, 2.4, 2.0
BITE_HIT = 0.5  # с — пасть захлопывается


def clip_bite(rig_, u):
    """Укус: корпус откатывается назад, шея взводится вверх-назад, пасть раскрыта; бросок — корпус вперёд,
    шея выстреливает вниз-вперёд, пасть захлопывается; после — трёпка головой и возврат."""
    s = u * BITE_SEC
    p = P()
    stance(p)
    p.root.y += K([(0, 0), (0.35, 0.10), (BITE_HIT, -0.16, "i"), (0.75, -0.10, "o"), (BITE_SEC, 0)], s)
    p.root.z += K([(0, 0), (0.35, 0.02), (BITE_HIT, -0.04, "i"), (0.8, -0.02), (BITE_SEC, 0)], s)
    p.body(ax=K([(0, 0), (0.35, -4), (BITE_HIT, 7, "i"), (0.75, 4), (BITE_SEC, 0)], s))
    p.rot("Chest", ax=K([(0, 0), (0.35, -5), (BITE_HIT, 6, "i"), (0.8, 3), (BITE_SEC, 0)], s))
    p.neck(ax=K([(0, 0), (0.35, -26), (BITE_HIT, 26, "i"), (0.7, 20), (BITE_SEC, 0)], s),
           az=shake(s, BITE_HIT, 0.95, 9, hz=6))
    p.rot("Head", ax=K([(0, 0), (0.35, -8), (BITE_HIT, 10, "i"), (0.8, 6), (BITE_SEC, 0)], s))
    p.rot("Jaw", ax=K([(0, 0), (0.3, 30), (0.45, 40), (BITE_HIT, 0, "i"), (0.8, 0), (0.95, 6), (BITE_SEC, 0)], s))
    p.tail(lambda i: (K([(0, 0), (0.35, 1.5), (BITE_HIT + 0.04 * i, -1.0), (BITE_SEC, 0)], s), 0.0,
                      shake(s, BITE_HIT + 0.03 * i, 1.1, 2.0 + 0.6 * i, hz=4)))
    p.wings(spread=K([(0, 3), (0.35, 14), (BITE_HIT, 6), (BITE_SEC, 3)], s),
            lift=K([(0, 0), (0.35, 12), (BITE_HIT, -6, "i"), (0.85, -2), (BITE_SEC, 0)], s))
    return p.done()


CLAW_HIT = 0.58  # с — когти касаются земли


def clip_claw(rig_, u):
    """Удар когтями (передняя левая): вес уходит на правые и задние лапы, корпус взводится; лапа взлетает
    высоко, подогнута, — и рвёт наискось вперёд-вниз, корпус доворачивается в удар, голова провожает лапу;
    лапа встаёт, возврат."""
    s = u * CLAW_SEC
    p = P()
    stance(p)
    p.root.x += K([(0, 0), (0.3, -0.06), (CLAW_HIT, -0.02, "i"), (0.95, -0.01), (CLAW_SEC, 0)], s)
    p.root.y += K([(0, 0), (0.3, 0.05), (CLAW_HIT, -0.08, "i"), (0.95, -0.03), (CLAW_SEC, 0)], s)
    p.body(ax=K([(0, 0), (0.3, -5), (CLAW_HIT, 5, "i"), (0.95, 2), (CLAW_SEC, 0)], s),
          ay=K([(0, 0), (0.3, -5), (CLAW_HIT, 3, "i"), (CLAW_SEC, 0)], s),
          az=K([(0, 0), (0.3, 8), (CLAW_HIT, -10, "i"), (0.95, -5), (CLAW_SEC, 0)], s))
    p.rot("Chest", az=K([(0, 0), (0.3, 6), (CLAW_HIT, -12, "i"), (1.0, -4), (CLAW_SEC, 0)], s))
    p.feet[FL] = Vector((
        K([(0, 0), (0.3, 0.04), (CLAW_HIT, -0.12, "i"), (CLAW_SEC, 0)], s),
        K([(0, 0), (0.3, 0.06), (0.48, -0.10), (CLAW_HIT, -0.30, "i"), (0.95, -0.22), (CLAW_SEC, 0)], s),
        K([(0, 0), (0.3, 0.44, "o"), (0.48, 0.32), (CLAW_HIT, 0.0, "i"), (CLAW_SEC, 0)], s)))
    p.pitch[FL] = D(K([(0, 0), (0.3, 45), (0.5, -15), (CLAW_HIT, 0, "i"), (CLAW_SEC, 0)], s))
    p.neck(ax=K([(0, 0), (0.3, -12), (CLAW_HIT, 16, "i"), (1.0, 6), (CLAW_SEC, 0)], s),
           az=K([(0, 0), (0.3, 10), (CLAW_HIT, -14, "i"), (1.0, -4), (CLAW_SEC, 0)], s))
    p.rot("Jaw", ax=K([(0, 0), (0.4, 16), (CLAW_HIT, 26), (0.9, 4), (CLAW_SEC, 0)], s))
    p.tail(lambda i: (0.0, 0.0, K([(0, 0), (0.3 + 0.02 * i, -6 - i), (CLAW_HIT + 0.03 * i, 7 + 1.2 * i, "i"),
                                    (CLAW_SEC, 0)], s)))
    p.wing("L", spread=K([(0, 3), (0.3, 22), (CLAW_HIT, 8), (CLAW_SEC, 3)], s),
           lift=K([(0, 0), (0.3, 16), (CLAW_HIT, -4), (CLAW_SEC, 0)], s))
    p.wing("R", spread=K([(0, 3), (0.3, 10), (CLAW_SEC, 3)], s), lift=K([(0, 0), (0.3, 6), (CLAW_SEC, 0)], s))
    return p.done()


# Удар хвостом (2026-10-21, по просьбе: размашисто, одним движением): подготовка — каждая лапа один шаг,
# корпус приседает и взводится в обратную сторону; удар — одним махом задняя часть с хвостом разворачивается
# вокруг передних лап (задние — одним прыжком, передние — одним коротким шагом), хвост отстаёт и хлещет
# вперёд; затем двумя спокойными шагами — обратно в стойку. Между шагами стопа стоит на месте.
TAIL_PIVOT = (rig.legs[FL]["A"] + rig.legs[FR]["A"]) / 2  # опора разворота — между передними лапами
TAIL_PIVOT.z = 0.0
ROOT0 = Vector((rig.head["Root"].x, rig.head["Root"].y, 0.0))
TAIL_TURN = 115.0  # ° — задняя часть заносится, хвост дохлёстывает к морде цели
TAIL_HIT = 1.12  # с — хвост проходит перед мордой цели
# Хлёст по звеньям (°): длина хвоста — в основании (0.52, 0.48, 0.35 м … кончик по 0.11), поэтому гнётся
# сильнее основание — иначе длинная часть оставалась сбоку, а заворачивался один кончик.
TAIL_WHIP = (28.0, 26.0, 21.0, 16.0, 13.0, 10.0, 8.0, 8.0)


def _tail_theta(t):
    return K([(0, 0), (0.55, -25), (0.72, -27), (1.08, TAIL_TURN - 6, "s"), (1.22, TAIL_TURN, "o"), (1.55, TAIL_TURN),
              (2.25, 0, "s"), (TAIL_SEC, 0)], t)


# Шаги лап: (начало, конец, подъём, м); цель шага — угол корпуса в конце шага (лапа догоняет корпус).
TAIL_STEPS = {
    HL: ((0.12, 0.40, 0.08), (0.74, 1.08, 0.16), (1.55, 1.85, 0.08), (1.95, 2.25, 0.08)),
    HR: ((0.26, 0.54, 0.08), (0.74, 1.08, 0.16), (1.70, 2.00, 0.08), (2.08, 2.38, 0.08)),
    FL: ((0.30, 0.52, 0.05), (0.80, 1.04, 0.06), (1.62, 1.88, 0.05), (2.02, 2.30, 0.05)),
    FR: ((0.18, 0.40, 0.05), (0.80, 1.04, 0.06), (1.78, 2.04, 0.05), (2.14, 2.42, 0.05)),
}


def foot_yaw(t, steps):
    """Угол стопы вокруг опоры и подъём: стоит, пока не шагнёт; шаг — дугой к углу корпуса в конце шага."""
    yaw = 0.0
    for t0, t1, h in steps:
        target = _tail_theta(t1)
        if t < t0:
            return yaw, 0.0
        if t <= t1:
            k = (t - t0) / (t1 - t0)
            return yaw + (target - yaw) * smooth(k), h * math.sin(math.pi * k)
        yaw = target
    return yaw, 0.0


def clip_tail(rig_, u):
    """Удар хвостом вперёд, размашисто: подготовка шагами и взвод, один мах корпусом вокруг передних лап
    (хвост отстаёт, а когда корпус тормозит — хлещет вперёд перед мордой цели), голова держит цель;
    затем шагами обратно в стойку."""
    s = u * TAIL_SEC
    p = P()
    stance(p)
    th = _tail_theta(s)
    om = (_tail_theta(s + 0.02) - _tail_theta(s - 0.02)) / 0.04  # °/с
    # корпус крутится вокруг передних лап: корень смещается по дуге
    shift = TAIL_PIVOT + Quaternion((0, 0, 1), D(th)) @ (ROOT0 - TAIL_PIVOT) - ROOT0
    p.root.x += shift.x
    p.root.y += shift.y
    p.body(az=th)
    # присед перед махом, подскок задних лап на махе, приземление с осадкой
    p.root.z += K([(0, 0), (0.55, -0.04), (0.72, -0.05), (0.9, 0.02), (1.1, -0.04), (1.4, -0.02), (TAIL_SEC, 0)], s)
    for leg, steps in TAIL_STEPS.items():
        yaw, h = foot_yaw(s, steps)
        a_ = rig.legs[leg]["A"]
        turned = TAIL_PIVOT + Quaternion((0, 0, 1), D(yaw)) @ (a_ - TAIL_PIVOT)
        p.feet[leg] = turned - a_ + Vector((0.0, 0.0, h))
        p.pitch[leg] = D(20) * min(1.0, h / 0.06)
    p.rot("Chest", az=-0.015 * om)  # грудь чуть отстаёт от таза на махе
    p.neck(az=-0.5 * th, ax=K([(0, 0), (0.55, -6), (TAIL_HIT, 6), (TAIL_SEC, 0)], s))
    p.rot("Jaw", ax=K([(0, 0), (0.6, 12), (TAIL_HIT, 26), (1.5, 6), (TAIL_SEC, 0)], s))

    def tail_seg(i):
        drag = -om * (0.012 + 0.002 * i)  # отстаёт от маха
        w = TAIL_WHIP[i - 1]
        whip = K([(0, 0), (TAIL_HIT - 0.12 + 0.015 * i, 0), (TAIL_HIT + 0.02 * i, w, "b"),
                  (1.6 + 0.02 * i, 0.25 * w), (2.2, -2), (TAIL_SEC, 0)], s)  # хлёст вперёд, в сторону маха
        return K([(0, 0), (0.55, 2), (TAIL_HIT, 3), (TAIL_SEC, 0)], s), 0.0, drag + whip

    p.tail(tail_seg)
    p.wings(spread=K([(0, 3), (0.55, 12), (0.9, 26), (TAIL_HIT, 18), (1.6, 8), (TAIL_SEC, 3)], s),
            lift=K([(0, 0), (0.55, 8), (0.9, 18), (TAIL_HIT, 8), (TAIL_SEC, 0)], s))
    return p.done()


WINGS_HIT = 0.85  # с — крылья бьют вниз (кольцо пламени, отброс)


def clip_wings(rig_, u):
    """Взмах обоими крыльями: крылья поднимаются и раскрываются, пальцы веером, корпус привстаёт и вдыхает;
    удар вниз — корпус оседает на лапы, голова выбрасывается вперёд с рёвом, хвост хлёстко вверх;
    крылья складываются обратно с затуханием."""
    s = u * WINGS_SEC
    p = P()
    stance(p)
    p.root.z += K([(0, 0), (0.6, 0.04), (WINGS_HIT, -0.07, "i"), (1.15, -0.04), (WINGS_SEC, 0)], s)
    p.body(ax=K([(0, 0), (0.6, -6), (WINGS_HIT, 5, "i"), (1.15, 2), (WINGS_SEC, 0)], s))
    p.rot("Chest", ax=K([(0, 0), (0.6, -7), (WINGS_HIT, 8, "i"), (1.15, 4), (WINGS_SEC, 0)], s))
    p.neck(ax=K([(0, 0), (0.6, -18), (WINGS_HIT, 16, "i"), (1.15, 10), (WINGS_SEC, 0)], s))
    p.rot("Jaw", ax=K([(0, 0), (0.7, 6), (WINGS_HIT, 34, "i"), (1.2, 30), (1.6, 0), (WINGS_SEC, 0)], s))
    spread = K([(0, 3), (0.6, 62, "o"), (WINGS_HIT, 64), (1.15, 56), (WINGS_SEC, 3)], s)
    lift = K([(0, 0), (0.6, 45, "o"), (WINGS_HIT, -1, "i"), (1.15, 0), (1.5, 3), (WINGS_SEC, 0)], s)
    lag = K([(0, 0), (0.64, 45, "o"), (WINGS_HIT + 0.03, -1, "i"), (1.18, 0), (1.53, 3), (WINGS_SEC, 0)], s)
    p.wings(spread=spread, lift=lift, fan=12 * min(1.0, spread / 60.0), lag=lag)
    p.tail(lambda i: (K([(0, 0), (0.6, 0.5), (WINGS_HIT + 0.04 * i, 3, "b"), (1.3, 0.5), (WINGS_SEC, 0)], s), 0.0,
                      shake(s, WINGS_HIT + 0.03 * i, 1.6, 1.5 + 0.4 * i, hz=3)))
    return p.done()


BREATH_START, BREATH_END = 1.25, 1.95  # с — пламя идёт изо рта


def clip_breath(rig_, u):
    """Огненное дыхание: корпус встаёт на дыбы (вес на задние), грудь раздувается, шея взводится назад-вверх;
    выброс — корпус подаётся вперёд, шея выстреливает вперёд-вниз, пасть настежь; пока идёт пламя — голова
    ведёт струю слева направо (конус), шея дрожит от напора; затем возврат."""
    s = u * BREATH_SEC
    p = P()
    stance(p)
    p.root.y += K([(0, 0), (0.7, 0.08), (BREATH_START, -0.10, "i"), (BREATH_END, -0.07), (BREATH_SEC, 0)], s)
    p.root.z += K([(0, 0), (0.7, 0.03), (BREATH_START, -0.04, "i"), (BREATH_END, -0.03), (BREATH_SEC, 0)], s)
    p.body(ax=K([(0, 0), (0.7, -8), (1.0, -10), (BREATH_START, 8, "i"), (BREATH_END, 6), (BREATH_SEC, 0)], s))
    p.rot("Spine1", ax=K([(0, 0), (0.7, -3), (BREATH_START, 3, "i"), (BREATH_SEC, 0)], s))
    p.rot("Chest", ax=K([(0, 0), (0.7, -6), (1.0, -8), (BREATH_START, 6, "i"), (BREATH_END, 4), (BREATH_SEC, 0)], s))
    sweep = K([(0, 0), (BREATH_START, 0), (1.45, -14), (1.8, 12), (BREATH_END, 8), (2.25, 0), (BREATH_SEC, 0)], s)
    p.neck(ax=K([(0, 0), (0.7, -34), (1.0, -40), (BREATH_START, 24, "i"), (BREATH_END, 20), (2.3, 0),
                 (BREATH_SEC, 0)], s) + shake(s, BREATH_START, BREATH_END + 0.1, 2.5, hz=14), az=sweep)
    p.rot("Jaw", ax=K([(0, 0), (0.7, 10), (1.0, 16), (BREATH_START, 50, "i"), (BREATH_END, 46), (2.2, 0),
                       (BREATH_SEC, 0)], s))
    p.wings(spread=K([(0, 3), (0.7, 26), (BREATH_START, 14), (BREATH_SEC, 3)], s),
            lift=K([(0, 0), (0.7, 22), (BREATH_START, -6, "i"), (BREATH_END, -3), (BREATH_SEC, 0)], s))
    p.tail(lambda i: (K([(0, 0), (0.7, 3), (BREATH_START, -2), (BREATH_SEC, 0)], s), 0.0,
                      -0.35 * sweep * (0.4 + 0.12 * i)))
    return p.done()


CHARGE_PEAK = 1.3  # с — заряд набран (метеоры)


def clip_charge(rig_, u):
    """Заряд (метеоры): корпус встаёт на дыбы, крылья поднимаются и раскрываются во всю ширину, пальцы веером,
    голова задрана к своду, пасть раскрыта — рёв; на пике тело дрожит от силы; затем опускается."""
    s = u * CHARGE_SEC
    p = P()
    stance(p)
    p.root.y += K([(0, 0), (0.8, 0.08), (CHARGE_PEAK, 0.09), (CHARGE_SEC, 0.0)], s)
    p.body(ax=K([(0, 0), (0.8, -10, "o"), (CHARGE_PEAK, -12), (1.7, -5), (CHARGE_SEC, 0)], s)
          + shake(s, 1.0, 1.6, 1.2, hz=11))
    p.rot("Chest", ax=K([(0, 0), (0.8, -8), (CHARGE_PEAK, -9), (CHARGE_SEC, 0)], s))
    p.neck(ax=K([(0, 0), (0.8, -30, "o"), (CHARGE_PEAK, -34), (1.7, -14), (CHARGE_SEC, 0)], s))
    p.rot("Jaw", ax=K([(0, 0), (0.8, 24), (CHARGE_PEAK, 36), (1.7, 10), (CHARGE_SEC, 0)], s))
    spread = K([(0, 3), (0.8, 64, "o"), (CHARGE_PEAK, 68), (1.75, 30), (CHARGE_SEC, 3)], s)
    p.wings(spread=spread, lift=K([(0, 0), (0.8, 34, "o"), (CHARGE_PEAK, 38), (1.75, 10), (CHARGE_SEC, 0)], s)
            + shake(s, 1.0, 1.6, 2.0, hz=9), fan=14 * min(1.0, spread / 60.0))
    p.tail(lambda i: (K([(0, 0), (0.8, 5), (CHARGE_PEAK, 6), (CHARGE_SEC, 0)], s), 0.0,
                      shake(s, 0.9 + 0.03 * i, 1.8, 1.5 + 0.5 * i, hz=5)))
    return p.done()


# ---------------------------------------------------------------- урон и смерть

HIT_SEC, DEATH_SEC = 0.6, 2.6


def clip_hit(rig_, u):
    """Получение урона: корпус отбрасывает назад, голова дёргается, крылья вздрагивают, хвост дёргается;
    возврат с небольшим перелётом."""
    s = u * HIT_SEC
    p = P()
    stance(p)
    a_ = K([(0, 0), (0.08, 1, "o"), (0.32, -0.15), (HIT_SEC, 0)], s)
    p.root.y += 0.07 * a_
    p.body(ax=-5 * a_, ay=2 * a_)
    p.rot("Chest", ax=-5 * a_)
    p.neck(ax=-20 * a_, az=6 * a_)
    p.rot("Jaw", ax=16 * max(0.0, a_))
    p.wings(spread=3 + 8 * max(0.0, a_), lift=12 * a_, lag=10 * K([(0, 0), (0.11, 1, "o"), (0.35, -0.15), (HIT_SEC, 0)], s))
    p.tail(lambda i: (0.0, 0.0, 7 * K([(0, 0), (0.08 + 0.02 * i, 1, "o"), (0.35 + 0.02 * i, -0.3), (HIT_SEC, 0)], s)))
    return p.done()


def clip_death(rig_, u):
    """Смерть: шатнуло, задние лапы подламываются, затем передние — корпус валится на грудь и набок, лапы
    разъезжаются; шея падает последней и подскакивает; крылья опадают на землю; хвост ложится."""
    s = u * DEATH_SEC
    p = P()
    stance(p, K([(0, 1), (0.6, 1), (1.4, 0.3), (DEATH_SEC, 0.3)], s))
    fall = K([(0, 0), (0.35, 0.05), (0.8, 0.45, "i"), (1.4, 0.95, "i"), (1.55, 1.0, "b"), (DEATH_SEC, 1.0)], s)
    p.root.x += 0.03 * math.sin(s * 9) * (1 - fall) + 0.10 * fall
    p.root.z -= 0.27 * fall
    p.body(ax=K([(0, 0), (0.8, -4), (1.5, 6), (DEATH_SEC, 6)], s), ay=-16 * fall)
    for i, sx in ((HL, 1), (HR, -1), (FL, 1), (FR, -1)):
        p.feet[i] = Vector((sx * 0.14 * fall, (-0.08 if i >= FL else 0.04) * fall, 0.0))
    p.neck(ax=K([(0, 0), (0.5, -14), (1.2, 10), (1.75, 34, "i"), (1.9, 28), (2.05, 32), (DEATH_SEC, 31)], s),
           ay=-8 * fall)
    p.rot("Jaw", ax=K([(0, 0), (0.5, 20), (1.2, 6), (1.8, 10), (DEATH_SEC, 12)], s))
    # валится на правый бок: правое крыло подворачивается вверх, над телом; левое раскинуто и опадает
    p.wing("R", spread=K([(0, 3), (0.5, 22), (1.4, 16), (DEATH_SEC, 18)], s),
           lift=K([(0, 0), (0.5, 14), (1.5, 20, "i"), (DEATH_SEC, 18)], s))
    p.wing("L", spread=K([(0, 3), (0.5, 26), (1.4, 36), (DEATH_SEC, 40)], s),
           lift=K([(0, 0), (0.5, 14), (1.5, -12, "i"), (1.7, -8), (DEATH_SEC, -10)], s))
    p.tail(lambda i: (K([(0, 0), (0.6, 4), (1.6, -3), (DEATH_SEC, -3)], s), 0.0,
                      K([(0, 0), (0.7, 3 + 0.5 * i), (1.6 + 0.03 * i, -(2 + 0.6 * i), "b"), (DEATH_SEC, -(2 + 0.5 * i))], s)))
    return p.done()


# ---------------------------------------------------------------- выгрузка

CLIPS = {
    # имя: (функция, кадров, петля) — имена прежние (игра берёт attackClip "attackbite" и т. п.)
    "Idle": (clip_idle, round(IDLE_SEC * FPS), True),
    "Walk": (clip_walk, round(WALK_SEC * FPS), True),
    "Run": (clip_run, round(RUN_SEC * FPS), True),
    "TurnL": (clip_turn(1), round(TURN_SEC * FPS), True),
    "TurnR": (clip_turn(-1), round(TURN_SEC * FPS), True),
    "AttackBite": (clip_bite, round(BITE_SEC * FPS) + 1, False),
    "AttackClaw": (clip_claw, round(CLAW_SEC * FPS) + 1, False),
    "AttackTail": (clip_tail, round(TAIL_SEC * FPS) + 1, False),
    "AttackWings": (clip_wings, round(WINGS_SEC * FPS) + 1, False),
    "AttackBreath": (clip_breath, round(BREATH_SEC * FPS) + 1, False),
    "MagicCharge": (clip_charge, round(CHARGE_SEC * FPS) + 1, False),
    "HitReact": (clip_hit, round(HIT_SEC * FPS) + 1, False),
    "Death": (clip_death, round(DEATH_SEC * FPS) + 1, False),
}
only = z.opt(a, "--only")
anim.CLIPS = {k: v for k, v in CLIPS.items() if not only or k in only.split(",")}
made = anim.bake(rig)
arm.animation_data.action = None

# текстуры — не больше 2048 (как в игровой модели): на шлеме и телефоне 4096 — лишний вес
TEX_MAX = 2048
for img in bpy.data.images:
    w, h = img.size
    if w and h and max(w, h) > TEX_MAX:
        k_ = TEX_MAX / max(w, h)
        img.scale(int(w * k_), int(h * k_))

coll = bpy.data.collections.get("DragonBest") or arm.users_collection[0]
os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
build.export(coll, out, texcoords=True, jpeg=True)
z.emit({"out": out, "clips": made, "fileKB": round(os.path.getsize(out) / 1024)})
