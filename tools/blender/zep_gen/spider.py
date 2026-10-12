"""
Клипы паука (спецификация "rigKind": "spider"): десять ног L1–L5 и R1–R5 (L — +X, номер 1 — самая
передняя) и два сегмента тела: Body — головогрудь (лицо −Y), Abdomen — брюшко.

Ноги ведём по кончикам: в опоре кончик стоит на полу (z = 0), стопа не наклонена (как в покое),
колено и лодыжка решаются IK (Rig.leg_ik). Клипы — функции от t в [0, 1), как клипы скелета
(zep_gen/anim.py): петли (Idle, Walk, Run) и однократные (Attack, Attack2, HitReact, Death).
Смерть прижимается к полу в bake (spec anim.death.pin).
"""
import math

from mathutils import Vector

from zep_gen import anim
from zep_gen.anim import D, keys_lerp, lerp, rx, ry, rz, smooth

LEG_NAMES = ["L1", "L2", "L3", "L4", "L5", "R1", "R2", "R3", "R4", "R5"]
# шаг в противофазе: группа A — L1, L3, L5, R2, R4; группа B — L2, L4, R1, R3, R5
PHASE = {"L1": 0.0, "L3": 0.0, "L5": 0.0, "R2": 0.0, "R4": 0.0,
         "L2": 0.5, "L4": 0.5, "R1": 0.5, "R3": 0.5, "R5": 0.5}
FRONT = ("L1", "R1")   # передняя пара — удар
SECOND = ("L2", "R2")  # вторая пара — замах


def roles(leg_len):
    """Роли для Rig: десять ног (UpperLeg/LowerLeg/Foot) с фазами; корень — Body."""
    legs = [{"bones": [f"UpperLeg.{k}", f"LowerLeg.{k}", f"Foot.{k}"], "phase": PHASE[k], "name": k}
            for k in LEG_NAMES]
    return {"kind": "spider", "pelvis": "Body", "legs": legs, "legLen": leg_len}


def _ground(rig, lg):
    """Место кончика когтя в покое, но на полу (z = 0)."""
    t = rig.tail[lg["bones"][2]]
    return Vector((t.x, t.y, 0.0))


def _solve(rig, pose, root, lg, toe):
    """Нога: кончик — в toe, лодыжка — на том же смещении от кончика, что в покое; стопа не наклонена."""
    ankle = toe + (lg["A"] - rig.tail[lg["bones"][2]])
    rig.leg_ik(pose, root, lg, ankle, 0.0)


def _step(rig, pose, root, lg, t, duty, stride, lift):
    """Шаг ноги: опора — кончик едет назад по полу (относительно тела), перенос — дуга вперёд."""
    p = (t + lg["phase"]) % 1.0
    g = _ground(rig, lg)
    if p < duty:
        y = lerp(-stride / 2, stride / 2, p / duty)
        z = 0.0
    else:
        v = (p - duty) / (1 - duty)
        y = lerp(stride / 2, -stride / 2, smooth(v))
        z = lift * math.sin(math.pi * v)
    _solve(rig, pose, root, lg, g + Vector((0, y, z)))


def _bob(t, amp):
    """Две просадки тела за цикл (по одной на каждую группу ног)."""
    return -amp * (1 - math.cos(4 * math.pi * t)) / 2


def clip_idle(rig, t):
    """Покой: дыхание, брюшко качается, ноги чуть переступают — не в такт."""
    L = rig.L
    ph = 2 * math.pi * t
    root = Vector((0, 0, 0.004 * L * math.sin(ph)))
    pose = {"Abdomen": rx(-D(2.5) * math.sin(ph))}
    for i, lg in enumerate(rig.legs):
        q = ph + 0.7 * i
        off = Vector((0, 0.006 * L * math.sin(q), 0.004 * L * max(0.0, math.sin(2 * q))))
        _solve(rig, pose, root, lg, _ground(rig, lg) + off)
    return pose, root, None


def clip_walk(rig, t):
    """Шаг: две группы ног по пять в противофазе, тело качается."""
    L = rig.L
    root = Vector((0, 0, _bob(t, 0.012 * L)))
    pose = {"Body": rz(D(2.5) * math.sin(2 * math.pi * t)) @ rx(D(2) * math.sin(4 * math.pi * t)),
            "Abdomen": rx(-D(3) * math.sin(4 * math.pi * (t - 0.1)))}
    for lg in rig.legs:
        _step(rig, pose, root, lg, t, duty=0.5, stride=0.20 * L, lift=0.10 * L)
    return pose, root, None


def clip_run(rig, t):
    """Бег: тело ниже и наклонено вперёд, ноги чаще и выше."""
    L = rig.L
    root = Vector((0, 0, -0.02 * L + _bob(t, 0.012 * L)))
    pose = {"Body": rx(D(5)) @ rz(D(3) * math.sin(2 * math.pi * t)),
            "Abdomen": rx(-D(5) * math.sin(4 * math.pi * (t - 0.1)))}
    for lg in rig.legs:
        _step(rig, pose, root, lg, t, duty=0.4, stride=0.28 * L, lift=0.20 * L)
    return pose, root, None


def clip_attack(rig, t):
    """Удар: передняя пара встаёт, тело подаётся вперёд и валится на кончики."""
    L = rig.L
    lift = keys_lerp([(0.0, 0.0), (0.35, 0.25 * L), (0.45, 0.0), (1.0, 0.0)], t)
    fwd = keys_lerp([(0.0, 0.0), (0.35, 0.06 * L), (0.45, -0.20 * L), (0.65, -0.04 * L), (1.0, 0.0)], t)
    lean = keys_lerp([(0.0, 0.0), (0.35, D(-6)), (0.45, D(14)), (0.7, D(4)), (1.0, 0.0)], t)
    lunge = keys_lerp([(0.0, 0.0), (0.35, 0.0), (0.45, -0.05 * L), (0.7, -0.01 * L), (1.0, 0.0)], t)
    root = Vector((0, lunge, 0))
    pose = {"Body": rx(lean)}
    for lg in rig.legs:
        g = _ground(rig, lg)
        toe = g + Vector((0, fwd, lift)) if lg["name"] in FRONT else g
        _solve(rig, pose, root, lg, toe)
    return pose, root, None


def clip_attack2(rig, t):
    """Второй удар: вторая пара ног бьёт по дуге, тело разворачивается за ударом."""
    L = rig.L
    sweep = keys_lerp([(0.0, 0.0), (0.2, 0.10 * L), (0.5, -0.20 * L), (0.7, -0.20 * L), (1.0, 0.0)], t)
    arc = keys_lerp([(0.0, 0.0), (0.2, 0.05 * L), (0.35, 0.22 * L), (0.5, 0.05 * L), (0.6, 0.0), (1.0, 0.0)], t)
    yaw = keys_lerp([(0.0, 0.0), (0.2, D(-8)), (0.5, D(10)), (1.0, 0.0)], t)
    root = Vector((0, 0, 0))
    pose = {"Body": rz(yaw)}
    for lg in rig.legs:
        g = _ground(rig, lg)
        toe = g + Vector((0, sweep, arc)) if lg["name"] in SECOND else g
        _solve(rig, pose, root, lg, toe)
    return pose, root, None


def clip_hit(rig, t):
    """Получение урона: откат назад, ноги подбрасывает."""
    L = rig.L
    pulse = math.sin(math.pi * t)
    root = Vector((0, 0.05 * L * pulse, 0))
    pose = {"Body": rx(-D(10) * pulse)}
    for lg in rig.legs:
        _solve(rig, pose, root, lg, _ground(rig, lg) + Vector((0, 0, 0.04 * L * pulse)))
    return pose, root, None


def clip_death(rig, t):
    """Смерть: тело заваливается на бок, ноги поджимаются к брюху (прижатие к полу — в bake)."""
    L = rig.L
    fall = anim.ease_in(min(1.0, max(0.0, (t - 0.1) / 0.6)))
    root = Vector((0, 0, -0.05 * L * fall))
    pose = {"Body": ry(D(70) * fall), "Abdomen": rx(D(8) * fall)}
    for lg in rig.legs:
        g = _ground(rig, lg)
        inward = Vector((-g.x, -g.y, 0.0))
        if inward.length > 1e-6:
            inward.normalize()
        toe = g + inward * (0.15 * L * fall) + Vector((0, 0, 0.10 * L * fall))
        _solve(rig, pose, root, lg, toe)
    return pose, root, None


# имя: (функция, кадров, петля) — как в anim.CLIPS
CLIPS = {
    "Idle": (clip_idle, 60, True),
    "Walk": (clip_walk, 40, True),
    "Run": (clip_run, 24, True),
    "Attack": (clip_attack, 26, False),
    "Attack2": (clip_attack2, 26, False),
    "HitReact": (clip_hit, 16, False),
    "Death": (clip_death, 40, False),
}
