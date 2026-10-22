"""
Клипы лавового монстра (75 ур., art/models/LavaMonster.json → art/build/LavaMonster_rig.blend): покой, шаг, бег,
удар кулаками о землю (кулаки сжаты), удар когтями (пальцы сжимаются на ударе), реакция на урон, смерть.
Скелет гуманоида: большой палец (Thumb) и остальные пальцы (Fingers) — сгибаются в кулак.

Образец — icegiant_anim.py (кирпичи zep_gen/keyanim.py). Длительности и кадры ударов (*_SEC, *_HIT) — те же числа,
что в src/shared/mobs.ts (LAVA_MONSTER.clipSec / hitSec): поменял здесь — поменяй там.

Запуск: npm run asset -- anim lavamonster_anim.py art/build/LavaMonster_rig.blend public/models/gen/LavaMonster.glb [--only Walk,Run]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
from mathutils import Quaternion, Vector  # noqa: E402
import zep_lib as z  # noqa: E402
from zep_gen import anim, build  # noqa: E402
from zep_gen.keyanim import D, K, BipedPose, biped_gait, shake, smooth  # noqa: E402

FPS = anim.FPS

a = z.args()
src, out = a[0], a[1]
z.load(src)
arm = z.armatures()[0]

ROLES = {
    "kind": "biped", "pelvis": "Hips", "spine": ["Spine", "Chest"], "neck": "Neck", "head": "Head",
    "legs": [{"bones": ["UpperLeg.L", "LowerLeg.L", "Foot.L"], "phase": 0.0},
             {"bones": ["UpperLeg.R", "LowerLeg.R", "Foot.R"], "phase": 0.5}],
    "arms": [],
    "legLen": 0.85,
}
rig = anim.Rig(arm, ROLES, {"anim": {}, "depth": 0.3})


def Pose():
    return BipedPose(rig)


def fist(p, side, amount, t_keys=None):
    """Сжатие кулака: большой палец и остальные пальцы сгибаются на amount градусов (ось X кисти)."""
    p.rot("Thumb." + side, amount * 0.7, 0, 0)
    p.rot("Fingers." + side, amount, 0, 0)


# Базовая стойка: чуть присел, руки отведены от корпуса, кулаки полусогнуты.
ARM_REST = {"sh": (0, -2, 0), "up": (-6, -9, 4), "lo": -22.0, "hand": -8.0}


def rest_arms(p, k=1.0):
    for s in ("L", "R"):
        p.arm(s, tuple(v * k for v in ARM_REST["sh"]), tuple(v * k for v in ARM_REST["up"]),
              ARM_REST["lo"] * k, ARM_REST["hand"] * k)
        fist(p, s, 30 * k)


# ---------------------------------------------------------------- покой и шаг

IDLE_SEC = 3.0


def clip_idle(rig_, u):
    tau = 2 * math.pi
    b = math.sin(tau * u)
    p = Pose()
    p.root.z = -0.03 - 0.008 * (1 - b) / 2
    p.torso(5 - 2.0 * b, 1.2 * math.sin(tau * u), -1.2 * math.sin(tau * u + 0.8))
    p.head(-3 + 2.0 * (1 - b) / 2, -2 * math.sin(tau * u + 1.3), 8 * math.sin(tau * u + 1.0))
    rest_arms(p)
    return p.done()


WALK_SEC, RUN_SEC = 1.5, 1.0
WALK = {"stride": 0.36, "duty": 0.62, "lift": 0.10, "crouch": 0.03, "bob": 0.03, "sway": 0.04, "roll": 4.0,
        "yaw": 5.0, "lean": 8.0, "pitch": 2.5, "lat": 3.0, "twist": 8.0, "nod": 3.0, "lag": 0.07,
        "shrug": 3.0, "arm0": 4.0, "arm": 14.0, "armOut": 10.0, "elbow": 8.0, "elbowK": 10.0,
        "hand0": -6.0, "handK": 6.0, "heel": 16.0, "toeUp": 9.0}
RUN = {"stride": 0.46, "duty": 0.46, "lift": 0.2, "crouch": 0.07, "bob": 0.06, "sway": 0.04, "roll": 5.0,
       "yaw": 7.0, "lean": 16.0, "pitch": 4.0, "lat": 3.5, "twist": 12.0, "nod": 5.0, "lag": 0.06,
       "shrug": 5.0, "arm0": 6.0, "arm": 26.0, "armOut": 12.0, "elbow": 14.0, "elbowK": 20.0,
       "hand0": -8.0, "handK": 10.0, "heel": 24.0, "toeUp": 11.0}
HEEL_BACK = 0.07


def gait(u, g):
    p = Pose()
    biped_gait(rig, p, u, g, HEEL_BACK)
    return p.done()


def clip_walk(rig_, u):
    return gait(u, WALK)


def clip_run(rig_, u):
    return gait(u, RUN)


# ---------------------------------------------------------------- удар кулаками о землю

SLAM_SEC = 2.4
SLAM_HIT = 1.3


def clip_slam(rig_, u):
    """Замах обоими кулаками над головой, кулаки сжаты; удар о землю на SLAM_HIT, потом подъём в стойку."""
    t = u * SLAM_SEC
    p = Pose()
    fw = K([(0, 0), (0.3, 8), (1.0, -20, "o"), (1.12, -24), (SLAM_HIT, 40, "i"), (1.62, 36), (2.4, 0)], t)
    fw += shake(t, SLAM_HIT, 1.75, 2.0)
    p.torso(fw, 0, 0)
    p.head(K([(0, 0), (0.3, 6), (1.0, -26, "o"), (SLAM_HIT, -16, "i"), (1.62, -18), (2.4, 0)], t))
    p.root.z = K([(0, -0.03), (0.3, -0.08), (1.0, 0.02, "o"), (SLAM_HIT, -0.25, "i"), (1.62, -0.24), (2.4, -0.03)], t)
    for s in ("L", "R"):
        up = K([(0, (-6, -9, 4)), (0.3, (-12, -10, 0)), (1.0, (-160, -14, -6), "o"), (1.12, (-164, -16, -8)),
                (SLAM_HIT, (-58, -8, -14), "i"), (1.62, (-60, -8, -14)), (2.4, (-6, -9, 4))], t)
        p.arm(s, (0, -2, 0), up,
              K([(0, -22), (0.3, -30), (1.0, -70, "o"), (1.12, -76), (SLAM_HIT, -12, "i"), (1.62, -14), (2.4, -22)], t),
              K([(0, -8), (0.3, -14), (1.0, 30, "o"), (SLAM_HIT, -10, "i"), (1.62, -8), (2.4, -8)], t))
        # кулак: сжат весь замах и удар, разжимается при подъёме
        c = K([(0, 30), (0.3, 60), (1.0, 110, "o"), (1.62, 110), (2.2, 30)], t)
        fist(p, s, c)
    return p.done()


# ---------------------------------------------------------------- удар когтями

ATTACK_SEC = 1.3
ATTACK_HIT = 0.6


def clip_claw(rig_, u):
    """Правой лапой наотмашь, пальцы сжимаются на ударе (когти цепляют), левая — прикрывает."""
    t = u * ATTACK_SEC
    p = Pose()
    tw = K([(0, 0), (0.42, -26), (ATTACK_HIT, 30, "i"), (0.84, 34, "o"), (1.3, 0)], t)
    fw = K([(0, 0), (0.42, 12), (ATTACK_HIT, 4, "i"), (0.84, -4, "o"), (1.3, 0)], t)
    p.rot("Hips", 0, 0, tw * 0.35)
    p.torso(fw, 0, tw * 0.6)
    p.head(-fw * 0.5, 0, -tw * 0.4)
    p.arm("R", (0, -2, 0), K([(0, (-6, -9, 4)), (0.42, (-30, -10, 4)), (ATTACK_HIT, (-60, -30, -10), "i"),
                              (0.84, (-72, -36, -18), "o"), (1.3, (-6, -9, 4))], t),
          K([(0, -22), (0.42, -50), (ATTACK_HIT, -20, "i"), (1.3, -22)], t), -6)
    c = K([(0, 30), (0.42, 20), (ATTACK_HIT, 120, "i"), (0.84, 110), (1.3, 30)], t)
    fist(p, "R", c)
    p.arm("L", (0, -2, 0), K([(0, (-6, -9, 4)), (0.42, (-20, -12, -4)), (1.3, (-6, -9, 4))], t),
          K([(0, -22), (1.3, -22)], t), -6)
    fist(p, "L", 30)
    return p.done()


# ---------------------------------------------------------------- реакция и смерть

HIT_SEC = 0.5


def clip_hit(rig_, u):
    t = u * HIT_SEC
    p = Pose()
    k = K([(0, 0), (0.1, 1, "o"), (HIT_SEC, 0)], t)
    p.torso(-8 * k, 0, 0)
    p.head(-10 * k, 0, 0)
    rest_arms(p)
    return p.done()


DEATH_SEC = 2.0


def clip_death(rig_, u):
    t = u * DEATH_SEC
    p = Pose()
    fall = K([(0, 0), (0.6, 0.2), (1.0, 0.6, "i"), (1.5, 1.0, "b"), (DEATH_SEC, 1.0)], t)
    p.torso(40 * fall, 0, 0)
    p.root.z = -0.5 * fall
    p.head(20 * fall, 0, 0)
    for s in ("L", "R"):
        p.arm(s, (0, -2, 0), K([(0, (-6, -9, 4)), (1.0, (-40, -20, 0)), (DEATH_SEC, (-70, -30, 0))], t),
              K([(0, -22), (DEATH_SEC, -40)], t), -10)
        fist(p, s, 40 * fall)
    return p.done()

# ---------------------------------------------------------------- Страж: разлив магмы (ладонь по земле вперёд)

SPILL_SEC = 1.6
SPILL_HIT = 1.0


def clip_spill(rig_, u):
    """Правая рука уходит назад и сметает землю вперёд (линия магмы), корпус наклоняется; удар на SPILL_HIT."""
    t = u * SPILL_SEC
    p = Pose()
    p.torso(K([(0, 0), (0.4, -6), (SPILL_HIT, 18, "i"), (1.3, 10), (1.6, 0)], t), 0, 0)
    p.head(K([(0, 0), (0.5, -8), (SPILL_HIT, 10), (1.6, 0)], t))
    for s in ("L", "R"):
        if s == "L":
            p.arm(s, (0, -2, 0), (-6, -9, 4), -22.0, -8.0)
            fist(p, s, 30)
            continue
        up = K([(0, (-6, -9, 4)), (0.4, (-34, -10, 4), "o"), (SPILL_HIT, (42, -10, 10), "i"), (1.3, (30, -8, 8)), (1.6, (-6, -9, 4))], t)
        p.arm(s, (0, -2, 0), up, K([(0, -22), (0.4, -40), (SPILL_HIT, -6, "i"), (1.6, -22)], t), -8)
        fist(p, s, K([(0, 30), (0.4, 70), (SPILL_HIT, 110, "i"), (1.3, 90), (1.6, 30)], t))
    return p.done()


# ---------------------------------------------------------------- Страж: ярость (рёв, кулаки вверх)

ROAR_SEC = 2.2
ROAR_HIT = 1.5


def clip_roar(rig_, u):
    """Грудь раздувается, голова назад, кулаки вверх; на ROAR_HIT — тряска (рёв). Стоит на месте."""
    t = u * ROAR_SEC
    p = Pose()
    p.torso(K([(0, 0), (0.4, -10, "o"), (ROAR_HIT, -18, "i"), (1.8, -8), (2.2, 0)], t), 0, 0)
    p.head(K([(0, 0), (0.4, -18), (ROAR_HIT, -30, "i"), (1.8, -10), (2.2, 0)], t))
    p.root.z = shake(t, ROAR_HIT, 0.6, 1.5) + K([(0, 0), (0.4, 0.03), (ROAR_HIT, 0.06, "i"), (2.2, 0)], t)
    for s in ("L", "R"):
        up = K([(0, (-6, -9, 4)), (0.4, (-120, -12, 4), "o"), (ROAR_HIT, (-150, -14, 6), "i"), (1.8, (-130, -12, 4)), (2.2, (-6, -9, 4))], t)
        p.arm(s, (0, -2, 0), up, K([(0, -22), (0.4, -40), (ROAR_HIT, -50), (2.2, -22)], t), -8)
        fist(p, s, K([(0, 30), (0.4, 100, "o"), (ROAR_HIT, 120, "i"), (1.8, 110), (2.2, 30)], t))
    return p.done()


# ---------------------------------------------------------------- Маг: метка лавы (ладони вниз, вперёд)

MARK_SEC = 2.0


def clip_mark(rig_, u):
    """Оба предплечья тянутся вперёд, ладони раскрыты вниз — маг держит метку; пульс в конце."""
    t = u * MARK_SEC
    p = Pose()
    p.torso(K([(0, 0), (0.5, 12, "o"), (1.5, 14), (1.9, 8), (2.0, 0)], t), 0, 0)
    p.head(K([(0, 0), (0.5, 14), (1.5, 16), (2.0, 0)], t))
    for s in ("L", "R"):
        up = K([(0, (-6, -9, 4)), (0.5, (-78, -20, 8 if s == "R" else -8), "o"), (1.5, (-84, -22, 10 if s == "R" else -10)), (2.0, (-6, -9, 4))], t)
        p.arm(s, (0, -2, 0), up, K([(0, -22), (0.5, -62), (1.5, -66), (2.0, -22)], t), -10)
        fist(p, s, K([(0, 30), (0.5, 0), (1.5, 0), (2.0, 30)], t))
    return p.done()


# ---------------------------------------------------------------- Маг: кольцо углей (руки врозь, круг)

RING_SEC = 1.6
RING_HIT = 1.0


def clip_ring(rig_, u):
    """Руки разводятся в стороны и опускаются круговым жестом; на RING_HIT — кольцо углей."""
    t = u * RING_SEC
    p = Pose()
    p.torso(K([(0, 0), (0.4, -6), (RING_HIT, -12, "i"), (1.3, 0), (1.6, 0)], t), 0, 0)
    p.head(K([(0, 0), (0.4, -6), (RING_HIT, -10), (1.6, 0)], t))
    for s, k in (("L", -1), ("R", 1)):  # знак по оси Z: руки уходят в стороны, а не внутрь
        up = K([(0, (-6, -9, 4)), (0.4, (-20, -10, 80 * k), "o"), (RING_HIT, (-30, -14, 96 * k), "i"), (1.3, (-18, -10, 60 * k)), (1.6, (-6, -9, 4))], t)
        p.arm(s, (0, -2, 0), up, K([(0, -22), (0.4, -10), (RING_HIT, -6, "i"), (1.6, -22)], t), -8)
        fist(p, s, K([(0, 30), (0.4, 10), (RING_HIT, 0, "i"), (1.6, 30)], t))
    return p.done()


# ---------------------------------------------------------------- разворот на месте (бой)
# Игра крутит модель вокруг её начала координат не быстрее TURN_RATE и, пока монстр стоит, играет TurnL/TurnR
# с темпом «скорость разворота / TURN_RATE» (то же число — ELITE_MOBS.lavaGuard/lavaMage.turnRate в src/shared/mobs.ts).
# Стоящие стопы плывут назад по дуге ровно с этой скоростью, шагающие — вперёд; корпус почти неподвижен.
TURN_RATE = 60.0  # °/с
TURN_SEC = 1.0
TURN_PERIOD = 0.6  # с — каждая нога шагает раз в период
TURN_STEP = 0.25  # с — сам шаг


def clip_turn(sign):
    """Разворот на месте: sign = +1 — влево, −1 — вправо. Ноги переставляются по очереди, стоящие плывут по дуге."""
    def f(rig_, u):
        s = u * TURN_SEC
        p = Pose()
        amp = TURN_RATE * (TURN_PERIOD - TURN_STEP) / 2
        for i, ph in enumerate((0.0, TURN_PERIOD / 2)):
            tau = (s - ph) % TURN_PERIOD
            planted = TURN_PERIOD - TURN_STEP
            if tau < planted:
                psi, h = amp - TURN_RATE * tau, 0.0
            else:
                q = (tau - planted) / TURN_STEP
                psi, h = -amp + 2 * amp * smooth(q), 0.06 * math.sin(math.pi * q)
            a0 = rig.legs[i]["A"]
            turned = Quaternion((0.0, 0.0, 1.0), math.radians(sign * psi)) @ a0
            p.feet[i] = (turned - a0) + Vector((0.0, 0.0, h))
        p.root.z = -0.02
        p.torso(0.0, 0.0, 2.0 * sign)
        p.head(0.0, 0.0, -2.0 * sign)
        for s_ in ("L", "R"):
            p.arm(s_, (0, -2, 0), (-6, -9, 4), -22.0, -8.0)
            fist(p, s_, 30)
        return p.done()
    return f



CLIPS = {
    "Idle": (clip_idle, round(IDLE_SEC * FPS), True),
    "Walk": (clip_walk, round(WALK_SEC * FPS), True),
    "Run": (clip_run, round(RUN_SEC * FPS), True),
    "Slam": (clip_slam, round(SLAM_SEC * FPS) + 1, False),
    "Attack": (clip_claw, round(ATTACK_SEC * FPS) + 1, False),
    "HitReact": (clip_hit, round(HIT_SEC * FPS) + 1, False),
    "Death": (clip_death, round(DEATH_SEC * FPS) + 1, False),
    # Особые приёмы: Страж — разлив магмы и рёв ярости; Маг — метка лавы и кольцо углей.
    "Spill": (clip_spill, round(SPILL_SEC * FPS) + 1, False),
    "Roar": (clip_roar, round(ROAR_SEC * FPS) + 1, False),
    "Mark": (clip_mark, round(MARK_SEC * FPS) + 1, False),
    "Ring": (clip_ring, round(RING_SEC * FPS) + 1, False),
    # Разворот на месте: игра играет их, пока монстр стоит и поворачивается (turnRate).
    "TurnL": (clip_turn(1), round(TURN_SEC * FPS), True),
    "TurnR": (clip_turn(-1), round(TURN_SEC * FPS), True),
}
only = z.opt(a, "--only")
anim.CLIPS = {k: v for k, v in CLIPS.items() if not only or k in only.split(",")}
made = anim.bake(rig)

coll = bpy.data.collections.get("LavaMonster") or arm.users_collection[0]
build.export(coll, out, texcoords=True, jpeg=True)
blend_out = z.opt(a, "--blend")
if blend_out:
    bpy.ops.wm.save_as_mainfile(filepath=blend_out, copy=True)
z.emit({"out": out, "clips": made, "fileKB": round(os.path.getsize(out) / 1024)})
