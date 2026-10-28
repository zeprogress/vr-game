"""
Клипы боя героя «Человек»: стойки с оружием, по нескольку вариантов атаки на каждое оружие (игра мешает их
случайно) и клипы умений. Позы — через poser.py (IK рук и ног, оружие по посадке в кулаке).

Запуск: Blender -b -P tools/blender/human/moves.py [-- only=AtkSword1,StanceSword]
Пишет клипы в Human50k_game_anim.blend (старые Stance*/Atk*/Sk* заменяются). Дальше — to_game.py.

Имена клипов — одним словом (игра режет имя клипа по «_» и «|»): StanceSword → stancesword, AtkSword1 → atksword1,
SkCleave → skcleave. Кадр удара (касание цели) — около 35–45 % клипа, как у старых клипов: окно удара в игре то же.
"""
import bpy
import os
import sys

BLEND = "/Users/zep/ASSETS/3D/human/Human50k_game_anim.blend"
bpy.ops.wm.open_mainfile(filepath=BLEND)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import poser  # noqa: E402
from poser import build, key_pose  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ONLY = set()
for a in ARGS:
    if a.startswith("only="):
        ONLY = set(a[5:].split(","))

poser.load_hands()
FPS = bpy.context.scene.render.fps / bpy.context.scene.render.fps_base


def merge(base, over):
    out = dict(base)
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict) and k in ("feet", "shrug", "lift"):
            d = dict(out[k])
            d.update(v)
            out[k] = d
        else:
            out[k] = v
    return out


CLIPS = {}


def clip(name, keys, loop=False):
    """keys: [(секунды, поза)], поза — словарь poser.build; loop — первый ключ повторяется в конце."""
    CLIPS[name] = (keys, loop)


import math  # noqa: E402


def mirror(k):
    """Зеркальная поза (лево ↔ право): для атак левой рукой."""
    def mx(v):
        return (-v[0], v[1], v[2]) if v is not None else None

    out = dict(k)
    for f in ("twist", "yaw", "side"):
        if f in k:
            out[f] = -k[f]
    if "hips" in k:
        out["hips"] = mx(k["hips"])
    if "feet" in k:
        out["feet"] = {("L" if s == "R" else "R"): (-x, z, -fy) for s, (x, z, fy) in k["feet"].items()}
    for f in ("shrug", "lift"):
        if f in k:
            out[f] = {("L" if s == "R" else "R"): v for s, v in k[f].items()}
    out.pop("R", None)
    out.pop("L", None)
    for s in ("R", "L"):
        if s in k:
            h = dict(k[s])
            for f in ("at", "dir", "knuck", "elbow", "bendTo"):
                if f in h:
                    h[f] = mx(h[f])
            if "roll" in h:
                h["roll"] = -h["roll"]
            out["L" if s == "R" else "R"] = h
    return out


def spin(k, deg):
    """Вся поза повёрнута вокруг вертикали на deg (+ — вправо): таз, ступни, кисти и оружие вместе (poser «spin»);
    голова крутится с телом (не доворачивается к цели)."""
    out = dict(k)
    out["spin"] = deg
    out["headBack"] = 0.0
    return out


# ------------------------------------------------------------------ стойки

FEET_FIGHT = {"L": (-0.24, 0.16, -10.0), "R": (0.26, -0.14, 25.0)}
FEET_WIDE = {"L": (-0.3, 0.2, -15.0), "R": (0.3, -0.18, 30.0)}
FEET_SIDE = {"L": (-0.2, 0.3, 30.0), "R": (0.25, -0.2, 70.0)}  # боком к цели (лук, копьё)
SHIELD = {"at": (-0.35, -0.5, 0.95), "elbow": (-1, -0.6, 0.2), "roll": -70, "hold": True}

SWORD_ST = {
    "hips": (0.0, -0.05, 0.0), "yaw": 12, "twist": 4, "lean": 6, "feet": FEET_FIGHT,
    "R": {"at": (0.85, -0.85, 0.75), "dir": (0.15, 0.55, 0.8), "kind": "sword"},
    "L": SHIELD,
}
DAG_ST = {
    "hips": (0.0, -0.1, 0.0), "yaw": 5, "lean": 14, "feet": FEET_WIDE,
    "R": {"at": (0.75, -0.75, 0.9), "dir": (0.05, 0.3, 1), "kind": "sword"},
    "L": {"at": (-0.65, -0.65, 0.75), "dir": (-0.05, 0.3, 1), "kind": "sword"},
}


def SP2(at, d, r=-0.55, l=0.55):
    """Копьё двумя руками: центр, куда смотрит наконечник; правая сзади, левая впереди."""
    return {"at": at, "dir": d, "r": r, "l": l}


def HM2(at, d, r=0.35, l=-0.45):
    """Молот двумя руками: центр, куда смотрит боёк; правая ближе к бойку, левая ниже."""
    return {"at": at, "dir": d, "r": r, "l": l}


def HMS(at, d):
    """Молот при махе поперёк тела: кисти сложены вместе на рукояти (как биту) — руки сходятся буквой V и не
    перекрещиваются, куда бы ни смотрел боёк."""
    return HM2(at, d, 0.07, -0.07) if d[0] >= 0 else HM2(at, d, -0.07, 0.07)  # правая — со своей стороны


SPEAR_ST = {
    "hips": (0.0, -0.06, 0.0), "yaw": 35, "twist": 0, "lean": 5, "headBack": 0.85, "feet": FEET_SIDE,
    "two": SP2((0.12, -0.75, 0.6), (-0.15, 0.3, 1)),
}
HAMMER_ST = {
    "hips": (0.0, -0.06, 0.0), "yaw": 15, "twist": 5, "lean": 5, "feet": FEET_FIGHT,
    "two": HM2((0.4, -0.9, 0.6), (0.25, 1, 0.3)),
}
BOW_ST = {
    "hips": (0.0, -0.04, 0.0), "yaw": 20, "twist": 0, "headBack": 0.6, "feet": FEET_FIGHT,
    "L": {"at": (-0.8, -0.9, 0.6), "dir": (0.1, 1, 0.3), "kind": "bow"},
    "R": {"at": (0.75, -1.0, 0.3), "hold": False},
}
STAFF_ST = {
    "hips": (0.0, -0.03, 0.0), "yaw": 8, "lean": 3, "feet": FEET_FIGHT,
    "R": {"at": (0.95, -0.75, 0.55), "dir": (0.05, 1, 0.12), "kind": "staff"},
    "L": {"at": (-0.6, -1.0, 0.45), "hold": False},
}


def breathe(st):
    return [(0, st), (1.0, merge(st, {"hips": (st["hips"][0], st["hips"][1] - 0.015, st["hips"][2]), "lean": st.get("lean", 0) + 2}))]


clip("StanceSword", breathe(SWORD_ST), loop=True)
clip("StanceDagger", breathe(DAG_ST), loop=True)
clip("StanceSpear", breathe(SPEAR_ST), loop=True)
clip("StanceHammer", breathe(HAMMER_ST), loop=True)
clip("StanceBow", breathe(BOW_ST), loop=True)
clip("StanceStaff", breathe(STAFF_ST), loop=True)

# ------------------------------------------------------------------ меч (щит в левой)


def sw(**over):
    return merge(SWORD_ST, over)


def R(at, d, **x):
    return dict({"at": at, "dir": d, "kind": "sword"}, **x)


clip("AtkSword1", [  # горизонтальный рез справа налево
    (0.00, SWORD_ST),
    (0.20, sw(twist=40, yaw=25, R=R((0.95, 0.05, 0.05), (0.55, 0.45, -0.7)))),
    (0.34, sw(twist=-30, yaw=0, lean=10, hips=(0, -0.08, 0.06), R=R((0.05, -0.25, 1.05), (-0.95, 0.05, 0.3), knuck=(0, 0, 1)))),
    (0.46, sw(twist=-45, yaw=-5, lean=10, hips=(0, -0.08, 0.05), R=R((-0.6, -0.4, 0.55), (-0.7, -0.25, -0.65)))),
    (0.85, SWORD_ST),
])
clip("AtkSword2", [  # рубящий сверху
    (0.00, SWORD_ST),
    (0.22, sw(twist=15, lean=-8, shrug={"R": 15}, R=R((0.6, 1.1, -0.1), (0.1, 0.4, -0.9)))),
    (0.36, sw(twist=0, lean=22, hips=(0, -0.12, 0.08), R=R((0.25, -0.4, 1.15), (0, -0.55, 0.85)))),
    (0.50, sw(twist=-3, lean=24, hips=(0, -0.13, 0.08), R=R((0.2, -0.65, 1.0), (0, -0.75, 0.6)))),
    (0.90, SWORD_ST),
])
clip("AtkSword3", [  # укол с выпадом
    (0.00, SWORD_ST),
    (0.18, sw(twist=30, R=R((0.9, -0.5, -0.2), (0, 0.15, 1)))),
    (0.30, sw(twist=-15, lean=14, hips=(0, -0.1, 0.16), feet={"L": (-0.24, 0.34, -10.0)}, R=R((0.2, -0.25, 1.4), (0, 0.05, 1)))),
    (0.42, sw(twist=-15, lean=14, hips=(0, -0.1, 0.16), feet={"L": (-0.24, 0.34, -10.0)}, R=R((0.2, -0.28, 1.35), (0, 0.02, 1)))),
    (0.80, SWORD_ST),
])
clip("AtkSword4", [  # снизу вверх наискось слева направо
    (0.00, SWORD_ST),
    (0.20, sw(twist=-35, lean=12, hips=(0, -0.1, 0.0), R=R((-0.5, -0.9, 0.6), (-0.6, -0.5, 0.6)))),
    (0.34, sw(twist=35, lean=0, R=R((1.0, 0.5, 0.6), (0.6, 0.75, 0.2)))),
    (0.46, sw(twist=40, lean=-4, R=R((1.0, 0.8, 0.1), (0.4, 0.9, -0.3)))),
    (0.85, SWORD_ST),
])

# ------------------------------------------------------------------ кинжалы (правой; левой — зеркально)


def dg(**over):
    return merge(DAG_ST, over)


DAG_R = {
    "AtkDaggerR1": [  # укол
        (0.00, DAG_ST),
        (0.10, dg(twist=15, R=R((0.8, -0.6, 0.2), (0, 0.2, 1)))),
        (0.18, dg(twist=-25, lean=18, hips=(0, -0.12, 0.12), R=R((0.3, -0.35, 1.4), (0, 0, 1)))),
        (0.26, dg(twist=-25, lean=18, hips=(0, -0.12, 0.12), R=R((0.3, -0.38, 1.35), (0, -0.05, 1)))),
        (0.45, DAG_ST),
    ],
    "AtkDaggerR2": [  # полоснуть наискось
        (0.00, DAG_ST),
        (0.12, dg(twist=20, R=R((1.0, 0.2, 0.4), (0.4, 0.6, 0.7)))),
        (0.22, dg(twist=-25, lean=16, R=R((-0.3, -0.7, 1.0), (-0.6, -0.3, 0.8)))),
        (0.30, dg(twist=-28, lean=16, R=R((-0.45, -0.85, 0.85), (-0.6, -0.45, 0.6)))),
        (0.45, DAG_ST),
    ],
    "AtkDaggerR3": [  # снизу вверх
        (0.00, DAG_ST),
        (0.12, dg(lean=20, hips=(0, -0.14, 0.0), R=R((0.6, -1.2, 0.7), (0, 0.2, 1)))),
        (0.22, dg(lean=2, hips=(0, -0.06, 0.08), R=R((0.3, 0.35, 1.15), (0, 0.8, 0.6)))),
        (0.30, dg(lean=0, hips=(0, -0.06, 0.08), R=R((0.3, 0.45, 1.05), (0, 0.9, 0.4)))),
        (0.48, DAG_ST),
    ],
}
for n, keys in DAG_R.items():
    clip(n, keys)
    clip(n.replace("DaggerR", "DaggerL"), [(t, mirror(k)) for t, k in keys])

# ------------------------------------------------------------------ копьё (две руки: левая на древке)


def sp(**over):
    return merge(SPEAR_ST, over)


clip("AtkSpear1", [  # прямой выпад
    (0.00, SPEAR_ST),
    (0.14, sp(yaw=45, two=SP2((0.2, -0.75, 0.25), (-0.15, 0.3, 1)))),
    (0.26, sp(yaw=20, lean=14, hips=(0, -0.1, 0.18), feet={"L": (-0.2, 0.45, 30.0)}, two=SP2((0.05, -0.5, 1.15), (-0.05, 0.08, 1)))),
    (0.36, sp(yaw=20, lean=14, hips=(0, -0.1, 0.18), feet={"L": (-0.2, 0.45, 30.0)}, two=SP2((0.05, -0.52, 1.1), (-0.05, 0.06, 1)))),
    (0.67, SPEAR_ST),
])
clip("AtkSpear2", [  # сверху вниз
    (0.00, SPEAR_ST),
    (0.16, sp(yaw=35, lean=-6, shrug={"R": 20}, two=SP2((0.25, 0.45, 0.75), (-0.1, -0.05, 1)))),
    (0.28, sp(yaw=20, lean=16, hips=(0, -0.12, 0.14), two=SP2((0.08, -0.3, 1.0), (0, -0.4, 1)))),
    (0.38, sp(yaw=20, lean=16, hips=(0, -0.12, 0.14), two=SP2((0.08, -0.38, 0.95), (0, -0.45, 1)))),
    (0.70, SPEAR_ST),
])
clip("AtkSpear3", [  # размашистый удар древком вбок
    (0.00, SPEAR_ST),
    (0.18, sp(yaw=55, twist=20, two=SP2((0.6, -0.6, 0.3), (0.7, 0.1, 0.7)))),
    (0.34, sp(yaw=0, twist=-35, lean=8, two=SP2((-0.05, -0.6, 0.8), (-0.8, 0.0, 0.6)))),
    (0.46, sp(yaw=-5, twist=-45, lean=8, two=SP2((-0.4, -0.6, 0.6), (-1, -0.05, 0.1)))),
    (0.80, SPEAR_ST),
])

# ------------------------------------------------------------------ молот (две руки: левая ниже по рукояти)


def hm(**over):
    return merge(HAMMER_ST, over)


clip("AtkHammer1", [  # сверху о землю
    (0.00, HAMMER_ST),
    (0.28, hm(twist=10, lean=-12, shrug={"R": 20, "L": 20}, two=HM2((0.2, 1.0, 0.1), (0, 0.3, -1)))),
    (0.42, hm(twist=0, lean=30, hips=(0, -0.16, 0.1), two=HM2((0.1, -0.6, 1.0), (0, -0.8, 0.6)))),
    (0.56, hm(twist=0, lean=32, hips=(0, -0.17, 0.1), two=HM2((0.1, -0.7, 0.95), (0, -0.9, 0.45)))),
    (0.95, HAMMER_ST),
])
clip("AtkHammer2", [  # боковой мах
    (0.00, HAMMER_ST),
    (0.26, hm(twist=50, yaw=25, two=HMS((0.8, 0.0, 0.0), (0.5, 0.4, -0.75)))),
    (0.42, hm(twist=-45, yaw=-10, lean=10, hips=(0, -0.08, 0.08), two=HMS((0.1, -0.3, 1.1), (-0.9, 0.1, 0.4)))),
    (0.55, hm(twist=-60, yaw=-15, lean=10, hips=(0, -0.08, 0.06), two=HMS((-0.15, -0.35, 1.0), (-0.8, -0.1, 0.3)))),
    (0.75, hm(twist=-20, yaw=-5, lean=6, two=HMS((0.15, -0.5, 0.95), (-0.1, 1, 0.3)))),  # молот вверх перед грудью
    (0.95, HAMMER_ST),
])
clip("AtkHammer3", [  # снизу вверх
    (0.00, HAMMER_ST),
    (0.26, hm(twist=25, lean=18, hips=(0, -0.16, 0.0), two=HM2((0.6, -1.0, 0.1), (0.2, -0.6, -0.8)))),
    (0.42, hm(twist=-5, lean=-10, hips=(0, -0.02, 0.06), two=HM2((0.25, 0.5, 0.9), (0, 0.9, 0.4)))),
    (0.55, hm(twist=-8, lean=-12, hips=(0, -0.01, 0.06), two=HM2((0.2, 0.7, 0.6), (0, 0.95, -0.1)))),
    (0.95, HAMMER_ST),
])

# ------------------------------------------------------------------ лук (левая держит лук, правая тянет тетиву)


def bw(**over):
    return merge(BOW_ST, over)


def BOWL(at, d=(0.05, 1, 0.05)):
    return {"at": at, "dir": d, "kind": "bow"}


AIM = dict(yaw=60, twist=5, headBack=0.95, feet=FEET_SIDE)
clip("AtkBow1", [  # обычный выстрел
    (0.00, BOW_ST),
    (0.18, bw(**AIM, L=BOWL((-0.25, 0.05, 1.3)), R={"at": (-0.05, 0.0, 1.05), "hold": True})),
    (0.42, bw(**AIM, L=BOWL((-0.25, 0.05, 1.32)), R={"at": (0.4, 0.32, 0.05), "hold": True})),
    (0.48, bw(**AIM, L=BOWL((-0.25, 0.06, 1.34)), R={"at": (0.6, 0.38, -0.25), "hold": False})),
    (0.75, BOW_ST),
])
clip("AtkBow2", [  # быстрый выстрел с бедра
    (0.00, BOW_ST),
    (0.12, bw(**AIM, L=BOWL((-0.3, -0.25, 1.25), (0.3, 0.9, 0.1)), R={"at": (-0.05, -0.3, 1.0), "hold": True})),
    (0.28, bw(**AIM, L=BOWL((-0.3, -0.25, 1.27), (0.3, 0.9, 0.1)), R={"at": (0.4, -0.02, 0.15), "hold": True})),
    (0.33, bw(**AIM, L=BOWL((-0.3, -0.24, 1.28), (0.3, 0.9, 0.1)), R={"at": (0.6, 0.02, -0.12), "hold": False})),
    (0.55, BOW_ST),
])

# ------------------------------------------------------------------ посох


def st(**over):
    return merge(STAFF_ST, over)


def S(at, d, **x):
    return dict({"at": at, "dir": d, "kind": "staff"}, **x)


PALM = {"at": (-0.4, -0.1, 1.25), "roll": 80, "hold": False}
clip("AtkStaff1", [  # навершием вперёд
    (0.00, STAFF_ST),
    (0.18, st(twist=20, R=S((0.9, -0.5, 0.2), (0, 0.3, 1)))),
    (0.30, st(twist=-10, lean=12, hips=(0, -0.06, 0.12), R=S((0.45, -0.3, 1.05), (0, 0.15, 1)), L=PALM)),
    (0.42, st(twist=-10, lean=12, hips=(0, -0.06, 0.12), R=S((0.45, -0.32, 1.0), (0, 0.12, 1)), L=PALM)),
    (0.80, STAFF_ST),
])
clip("AtkStaff2", [  # сверху вниз
    (0.00, STAFF_ST),
    (0.22, st(lean=-8, shrug={"R": 20}, R=S((0.6, 1.1, 0.0), (0, 0.6, -0.8)))),
    (0.36, st(lean=18, hips=(0, -0.1, 0.08), R=S((0.3, -0.3, 1.0), (0, -0.3, 1)))),
    (0.48, st(lean=18, hips=(0, -0.1, 0.08), R=S((0.3, -0.45, 0.95), (0, -0.4, 1)))),
    (0.85, STAFF_ST),
])
clip("AtkStaff3", [  # вскинуть и опустить, ладонь вперёд
    (0.00, STAFF_ST),
    (0.20, st(lean=-6, R=S((0.75, 0.4, 0.5), (0, 1, 0.05)), L={"at": (-0.6, -0.4, 0.8), "roll": 60, "hold": False})),
    (0.34, st(lean=14, hips=(0, -0.12, 0.06), R=S((0.75, -0.9, 0.75), (0, 1, 0.2)), L=PALM)),
    (0.46, st(lean=14, hips=(0, -0.12, 0.06), R=S((0.75, -0.95, 0.75), (0, 1, 0.2)), L=PALM)),
    (0.90, STAFF_ST),
])

# ------------------------------------------------------------------ умения

clip("SkCleave", [  # широкий рассекающий удар с шагом
    (0.00, SWORD_ST),
    (0.30, sw(twist=60, yaw=25, lean=4, R=R((1.1, 0.2, -0.4), (0.5, 0.5, -0.7)))),
    (0.48, sw(twist=-60, yaw=-10, lean=14, hips=(0, -0.12, 0.14), feet={"L": (-0.24, 0.36, -10.0)},
              R=R((-0.9, -0.4, 0.7), (-0.9, -0.1, 0.3)))),
    (0.62, sw(twist=-65, yaw=-12, lean=14, hips=(0, -0.12, 0.14), feet={"L": (-0.24, 0.36, -10.0)},
              R=R((-1.0, -0.5, 0.4), (-0.85, -0.2, -0.4)))),
    (1.00, SWORD_ST),
])
WHIRL = sw(twist=0, yaw=0, lean=6, hips=(0, -0.1, 0), feet={"L": (-0.25, 0.0, 0.0), "R": (0.25, 0.0, 0.0)},
           R=R((1.5, -0.25, 0.3), (0.95, 0.0, 0.3)), L=dict(SHIELD, at=(-0.9, -0.4, 0.4)))
clip("SkWhirlwind", [(0.0, SWORD_ST), (0.15, spin(WHIRL, 0)), (1.85, spin(WHIRL, 1440)), (2.0, SWORD_ST)])  # 4 оборота
clip("SkStunBash", [  # удар щитом с шагом
    (0.00, SWORD_ST),
    (0.25, sw(twist=-25, R=R((0.9, -0.8, 0.2), (0.2, 0.6, 0.6)), L=dict(SHIELD, at=(-0.6, -0.35, 0.35)))),
    (0.38, sw(twist=20, lean=16, hips=(0, -0.08, 0.16), feet={"L": (-0.24, 0.38, -10.0)},
              R=R((0.9, -0.8, 0.2), (0.2, 0.6, 0.6)), L=dict(SHIELD, at=(-0.15, -0.15, 1.45)))),
    (0.50, sw(twist=20, lean=16, hips=(0, -0.08, 0.16), feet={"L": (-0.24, 0.38, -10.0)},
              R=R((0.9, -0.8, 0.2), (0.2, 0.6, 0.6)), L=dict(SHIELD, at=(-0.15, -0.15, 1.4)))),
    (0.85, SWORD_ST),
])
ROAR = sw(lean=-14, headPitch=-22, hips=(0, -0.02, 0), shrug={"R": 25, "L": 25},
          R=R((1.6, 0.4, 0.3), (0.3, 0.95, 0.1)), L=dict(SHIELD, at=(-1.6, 0.4, 0.3), roll=-20))
clip("SkWarcry", [  # клич: собраться и раскинуть руки
    (0.00, SWORD_ST),
    (0.30, sw(lean=18, hips=(0, -0.14, 0), R=R((0.5, -1.0, 0.6), (0, 0.6, 0.8)), L=dict(SHIELD, at=(-0.5, -0.9, 0.6)))),
    (0.55, ROAR),
    (1.05, merge(ROAR, {"lean": -12})),
    (1.40, SWORD_ST),
])
clip("SkSeal", [  # клинок в землю
    (0.00, SWORD_ST),
    (0.30, sw(lean=-6, R=R((0.6, 0.6, 0.6), (0, -1, 0.15)))),
    (0.45, sw(lean=34, hips=(0, -0.4, 0.08), R=R((0.45, -1.15, 1.15), (0, -1, 0.15)), L=dict(SHIELD, at=(-0.6, -0.9, 0.8)))),
    (0.90, sw(lean=35, hips=(0, -0.41, 0.08), R=R((0.45, -1.2, 1.15), (0, -1, 0.15)), L=dict(SHIELD, at=(-0.6, -0.9, 0.8)))),
    (1.20, SWORD_ST),
])
clip("SkCrush", [  # прыжок и удар о землю (молот)
    (0.00, HAMMER_ST),
    (0.15, hm(lean=20, hips=(0, -0.18, 0), two=HM2((0.5, -0.9, 0.1), (0.2, 0.2, -1)))),
    (0.35, hm(lean=-12, hips=(0, 0.22, 0.08), lift={"L": 0.22, "R": 0.18}, shrug={"R": 25, "L": 25},
              two=HM2((0.2, 1.1, 0.1), (0, 0.4, -0.9)))),
    (0.52, hm(lean=32, hips=(0, -0.2, 0.12), two=HM2((0.1, -0.7, 1.0), (0, -0.85, 0.5)))),
    (0.70, hm(lean=32, hips=(0, -0.21, 0.12), two=HM2((0.1, -0.75, 0.98), (0, -0.9, 0.45)))),
    (1.00, HAMMER_ST),
])
clip("SkChain", [  # молния с ладони
    (0.00, HAMMER_ST),
    (0.20, hm(twist=20, two=None, R=R((0.8, -1.0, 0.2), (0.3, 1, 0.1)), L={"at": (-0.3, -0.3, 0.5), "roll": 40, "hold": False})),
    (0.32, hm(twist=-25, lean=10, hips=(0, -0.05, 0.08), two=None, R=R((0.8, -1.0, 0.2), (0.3, 1, 0.1)),
              L={"at": (-0.1, 0.1, 1.45), "roll": 90, "hold": False})),
    (0.55, hm(twist=-25, lean=10, hips=(0, -0.05, 0.08), two=None, R=R((0.8, -1.0, 0.2), (0.3, 1, 0.1)),
              L={"at": (-0.1, 0.12, 1.4), "roll": 90, "hold": False})),
    (0.85, HAMMER_ST),
])
HEAL = st(lean=-10, headPitch=-18, shrug={"R": 25}, R=S((0.5, 1.4, 0.3), (0, 1, 0.05)),
          L={"at": (-0.9, 0.4, 0.6), "roll": 160, "hold": False})
clip("SkMassHeal", [  # посох ввысь
    (0.00, STAFF_ST), (0.35, HEAL), (0.9, merge(HEAL, {"lean": -8})), (1.2, STAFF_ST),
])
CAST = st(lean=8, hips=(0, -0.04, 0.08), R=S((0.6, 0.2, 1.2), (0, 0.55, 1)), L=PALM)
clip("SkCastStaff", [  # посох к небу, потом вперёд
    (0.00, STAFF_ST),
    (0.30, merge(HEAL, {"L": {"at": (-0.6, -0.2, 0.7), "hold": False}})),
    (0.50, CAST), (0.80, merge(CAST, {"lean": 10})), (1.1, STAFF_ST),
])
UP_AIM = dict(yaw=55, twist=0, lean=-14, headBack=0.9, headPitch=-30, feet=FEET_SIDE)
clip("SkArrowRain", [  # выстрел вверх
    (0.00, BOW_ST),
    (0.20, bw(**UP_AIM, L=BOWL((-0.2, 0.9, 1.0), (0.05, 0.7, -0.7)), R={"at": (-0.1, 0.6, 0.8), "hold": True})),
    (0.50, bw(**UP_AIM, L=BOWL((-0.2, 0.92, 1.02), (0.05, 0.7, -0.7)), R={"at": (0.15, 0.4, 0.15), "hold": True})),
    (0.57, bw(**UP_AIM, L=BOWL((-0.2, 0.93, 1.03), (0.05, 0.7, -0.7)), R={"at": (0.45, 0.4, -0.1), "hold": False})),
    (0.90, BOW_ST),
])
clip("SkAim", [  # долгий прицельный выстрел
    (0.00, BOW_ST),
    (0.22, bw(**AIM, L=BOWL((-0.25, 0.05, 1.3)), R={"at": (-0.05, 0.0, 1.05), "hold": True})),
    (0.55, bw(**AIM, L=BOWL((-0.25, 0.06, 1.33)), R={"at": (0.42, 0.33, 0.04), "hold": True})),
    (0.62, bw(**AIM, L=BOWL((-0.25, 0.07, 1.35)), R={"at": (0.62, 0.4, -0.28), "hold": False})),
    (0.95, BOW_ST),
])
FL_IN = sp(yaw=40, two=SP2((0.2, -0.75, 0.3), (-0.12, 0.2, 1)))
FL_OUT = sp(yaw=20, lean=12, hips=(0, -0.08, 0.14), two=SP2((0.05, -0.5, 1.05), (-0.05, 0.08, 1)))
clip("SkFlurry", [(0, SPEAR_ST)] + [(0.08 + 0.24 * i + d, k) for i in range(8) for d, k in ((0, FL_IN), (0.12, FL_OUT))]
     + [(2.1, SPEAR_ST)])
SWEEP = sp(yaw=0, twist=0, lean=20, hips=(0, -0.22, 0), feet={"L": (-0.3, 0.0, 0.0), "R": (0.3, 0.0, 0.0)},
           two=SP2((-0.4, -1.0, 0.9), (-0.95, -0.15, 0.2), r=-0.3, l=0.3))  # наконечник ведёт влево, по вращению
clip("SkSweep", [(0, SPEAR_ST), (0.1, spin(SWEEP, 0)), (0.5, spin(SWEEP, -360)),
                 (0.68, sp(yaw=10, lean=12, hips=(0, -0.12, 0), two=SP2((0.0, -0.8, 0.95), (-0.3, -0.05, 1), r=-0.3, l=0.3))),
                 (0.95, SPEAR_ST)])
clip("SkSpearCall", [  # копьё к небу и вперёд
    (0.00, SPEAR_ST),
    (0.30, sp(yaw=20, lean=-12, headPitch=-25, two=SP2((0.4, 0.6, 0.5), (0, 1, 0.1), r=-0.4, l=0.4))),
    (0.60, sp(yaw=20, lean=-12, headPitch=-25, two=SP2((0.4, 0.65, 0.5), (0, 1, 0.12), r=-0.4, l=0.4))),
    (0.80, FL_OUT), (1.1, SPEAR_ST),
])
clip("SkThrow", [  # веер ножей обеими руками
    (0.00, DAG_ST),
    (0.15, dg(lean=-4, R=R((0.75, 0.25, 0.05), (0.2, 0.9, -0.4)), L=R((-0.75, 0.25, 0.05), (-0.2, 0.9, -0.4)))),  # ножи к плечам
    (0.28, dg(lean=16, hips=(0, -0.1, 0.08), R=R((1.2, -0.3, 0.9), (0.7, 0.0, 0.7)), L=R((-1.2, -0.3, 0.9), (-0.7, 0.0, 0.7)))),
    (0.40, dg(lean=16, hips=(0, -0.1, 0.08), R=R((1.25, -0.35, 0.85), (0.75, -0.05, 0.6)), L=R((-1.25, -0.35, 0.85), (-0.75, -0.05, 0.6)))),
    (0.65, DAG_ST),
])
clip("SkCrossCut", [  # скрестить клинки и развести
    (0.00, DAG_ST),
    (0.20, dg(lean=4, shrug={"R": 15, "L": 15}, R=R((-0.3, 0.6, 0.8), (-0.5, 0.8, 0.2)), L=R((0.3, 0.6, 0.8), (0.5, 0.8, 0.2)))),
    (0.34, dg(lean=20, hips=(0, -0.14, 0.1), R=R((1.0, -0.8, 0.8), (0.6, -0.5, 0.6)), L=R((-1.0, -0.8, 0.8), (-0.6, -0.5, 0.6)))),
    (0.48, dg(lean=20, hips=(0, -0.14, 0.1), R=R((1.05, -0.9, 0.75), (0.6, -0.6, 0.5)), L=R((-1.05, -0.9, 0.75), (-0.6, -0.6, 0.5)))),
    (0.80, DAG_ST),
])


# ------------------------------------------------------------------ сборка

def blend(a, b, u):
    """Смесь двух поз: числа и тройки — линейно, словари — по ключам (нет у одной — берётся у другой), прочее — скачком."""
    if isinstance(a, dict) or isinstance(b, dict):
        if not isinstance(a, dict) or not isinstance(b, dict):
            return a if u < 0.5 else b
        out = {}
        for key in set(a) | set(b):
            if key not in a:
                out[key] = b[key]
            elif key not in b:
                out[key] = a[key]
            else:
                out[key] = blend(a[key], b[key], u)
        return out
    if isinstance(a, bool) or isinstance(b, bool) or isinstance(a, str) or a is None or b is None:
        return a if u < 0.5 else b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a + (b - a) * u
    if isinstance(a, (tuple, list)) and isinstance(b, (tuple, list)) and len(a) == len(b):
        return tuple(blend(x, y, u) for x, y in zip(a, b))
    return a if u < 0.5 else b


def norm(k):
    """Позу — с умолчаниями, чтобы смесь не прыгала там, где у одного ключа поле не задано."""
    out = {"yaw": 0.0, "twist": 0.0, "lean": 0.0, "side": 0.0, "tilt": 0.0, "headPitch": 0.0, "headBack": 0.7,
           "hips": (0.0, 0.0, 0.0), "shrug": {"L": 0.0, "R": 0.0}, "lift": {"L": 0.0, "R": 0.0}}
    out.update(k)
    fe = dict(poser.STANCE_FEET)
    fe.update(k.get("feet", {}))
    out["feet"] = fe
    for f in ("shrug", "lift"):
        d = {"L": 0.0, "R": 0.0}
        d.update(k.get(f, {}))
        out[f] = d
    return out


TENSION = 0.6  # доля касательной Кэтмелла–Рома: меньше — меньше перелёт за ключ


def curve(vp, va, vb, vn, tp, ta, tb, tn, u):
    """Значение между ключами a и b с непрерывной скоростью (Эрмит, касательные по соседям; у крайних ключей — 0)."""
    if isinstance(va, dict) or isinstance(vb, dict):
        if not isinstance(va, dict) or not isinstance(vb, dict):
            return va if u < 0.5 else vb
        out = {}
        for key in set(va) | set(vb):
            a_ = va.get(key, vb.get(key))
            b_ = vb.get(key, a_)
            p_ = vp.get(key, a_) if isinstance(vp, dict) else a_
            n_ = vn.get(key, b_) if isinstance(vn, dict) else b_
            out[key] = curve(p_, a_, b_, n_, tp, ta, tb, tn, u)
        return out
    if isinstance(va, bool) or isinstance(vb, bool) or isinstance(va, str) or va is None or vb is None:
        return va if u < 0.5 else vb
    if isinstance(va, (tuple, list)) and isinstance(vb, (tuple, list)) and len(va) == len(vb):
        lp = vp if isinstance(vp, (tuple, list)) and len(vp) == len(va) else va
        ln = vn if isinstance(vn, (tuple, list)) and len(vn) == len(vb) else vb
        return tuple(curve(lp[i], va[i], vb[i], ln[i], tp, ta, tb, tn, u) for i in range(len(va)))
    if isinstance(va, (int, float)) and isinstance(vb, (int, float)):
        dt = tb - ta
        ma = (vb - vp) / (tb - tp) * TENSION if tp is not None and isinstance(vp, (int, float)) else 0.0
        mb = (vn - va) / (tn - ta) * TENSION if tn is not None and isinstance(vn, (int, float)) else 0.0
        u2, u3 = u * u, u * u * u
        return ((2 * u3 - 3 * u2 + 1) * va + (u3 - 2 * u2 + u) * dt * ma
                + (-2 * u3 + 3 * u2) * vb + (u3 - u2) * dt * mb)
    return va if u < 0.5 else vb


def avg_params(items):
    """Взвешенное среднее поз [(поза, вес)]: числа и тройки — среднее, словари — по ключам, прочее — от центральной."""
    center = max(items, key=lambda it: it[1])[0]
    if isinstance(center, dict):
        out = {}
        for key in center:
            sub = [(it[0][key], it[1]) for it in items if isinstance(it[0], dict) and key in it[0]]
            out[key] = avg_params(sub)
        return out
    if isinstance(center, bool) or not isinstance(center, (int, float, tuple)):
        return center
    if isinstance(center, tuple):
        sub = [it for it in items if isinstance(it[0], tuple) and len(it[0]) == len(center)]
        return tuple(avg_params([(it[0][i], it[1]) for it in sub]) for i in range(len(center)))
    sub = [it for it in items if isinstance(it[0], (int, float)) and not isinstance(it[0], bool)]
    tot = sum(w for _, w in sub)
    return sum(v * w for v, w in sub) / tot


def dilate(seq, w=2):
    """Для каждого кадра — самый сильный толчок в окне ±w (по каждой руке): сглаживание после этого не ослабляет пик."""
    out = []
    for i in range(len(seq)):
        d = {}
        for j in range(max(0, i - w), min(len(seq), i + w + 1)):
            for kk, v in seq[j].items():
                if kk not in d or v.length > d[kk].length:
                    d[kk] = v.copy()
        out.append(d)
    return out


def smooth(seq, w=3):
    """Сгладить по кадрам последовательность словарей векторов (толчки рук) — треугольное окно ±w."""
    out = []
    for i in range(len(seq)):
        acc, tot = {}, 0.0
        for j in range(max(0, i - w), min(len(seq), i + w + 1)):
            wt = w + 1 - abs(i - j)
            tot += wt
            for kk, v in seq[j].items():
                acc[kk] = acc.get(kk, v * 0) + v * wt
        out.append({kk: v / tot for kk, v in acc.items()})
    return out


ARM_BONES = [f"{s}{b}" for s in ("Left", "Right") for b in ("Shoulder", "Arm", "ForeArm", "Hand")]


def make(name, keys, loop):
    old = bpy.data.actions.get(name)
    if old:
        bpy.data.actions.remove(old)
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    seq = list(keys) + ([(keys[-1][0] + (keys[1][0] - keys[0][0] if len(keys) > 1 else 0.5), keys[0][1])] if loop else [])
    seq = [(t, norm(k)) for t, k in seq]
    T = [t for t, _ in seq]
    V = [k for _, k in seq]
    f_end = 1 + round(T[-1] * FPS)
    # Поза на каждом кадре: числа ключей — по кривой с непрерывной скоростью (рука проходит ключ, не останавливаясь),
    # IK на каждом кадре (кисти на древке, ступни на месте).
    frames = []
    for f in range(1, f_end + 1):
        t = min(T[-1], (f - 1) / FPS)
        i = max(0, min(len(T) - 2, next((j for j in range(len(T) - 1) if T[j] <= t <= T[j + 1]), len(T) - 2)))
        u = (t - T[i]) / max(1e-6, T[i + 1] - T[i])
        tp, vp = (T[i - 1], V[i - 1]) if i > 0 else (None, V[i])
        tn, vn = (T[i + 2], V[i + 2]) if i + 2 < len(T) else (None, V[i + 1])
        frames.append(curve(vp, V[i], V[i + 1], vn, tp, T[i], T[i + 1], tn, u))
    # Сама постановка — мягко по времени (±2 кадра): удар гасится за пару кадров, а не встаёт в одном.
    # Первый и последний кадры не трогаем (стыки со стойкой и повтор).
    sm = [frames[0]]
    for i in range(1, len(frames) - 1):
        w = min(2, i, len(frames) - 1 - i)
        sm.append(avg_params([(frames[j], w + 1 - abs(i - j)) for j in range(i - w, i + w + 1)]))
    frames = sm + ([frames[-1]] if len(frames) > 1 else [])
    # Проход 1: столкновения рук с телом и друг с другом — толчки на каждом кадре; сглаживаем их по кадрам,
    # проход 2: позы с готовыми толчками (иначе толчок включается и выключается рывком).
    poser.reset_state()
    pushes, poles = [], []
    for k in frames:
        p = build(k)
        pushes.append(p.push)
        poles.append(p.polepush)
    raw_push, raw_pole = pushes, poles
    pushes, poles = smooth(dilate(pushes)), smooth(dilate(poles))
    if os.environ.get("DEBUG_CLIP") == name:
        for f in [int(x) for x in os.environ.get("DEBUG_FRAMES", "1").split(",")]:
            k = frames[f - 1]
            a1 = build(k)
            h1 = poser.penetration(a1)
            a2 = build(k, fixed=(raw_push[f - 1], raw_pole[f - 1]))
            h2 = poser.penetration(a2)
            a3 = build(k, fixed=(pushes[f - 1], poles[f - 1]))
            h3 = poser.penetration(a3)
            show = lambda h: (h[0], h[1], round(h[2] * 100, 1)) if h else None
            print("PEN", f, "проход1", show(h1), "те же толчки", show(h2), "сглаженные", show(h3),
                  "raw", {kk: round(v.length, 3) for kk, v in raw_push[f - 1].items()}, "smooth", {kk: round(v.length, 3) for kk, v in pushes[f - 1].items()})
    poser.reset_state()
    prev = {}
    poses = [build(k, fixed=(pushes[f], poles[f])) for f, k in enumerate(frames)]
    # Проход 3: цели рук (точка хвата, направление оружия, разворот кисти, полюс локтя) — сглаживаем по кадрам (±2)
    # и ставим руки заново: одиночные всплески IK уходят, резкий стоп удара — на пару кадров, хват на древке цел.
    zero = ({"R": poser.Vector(), "L": poser.Vector(), "two": poser.Vector()}, {"R": poser.Vector(), "L": poser.Vector()})
    out = []
    poser.reset_state()
    for i, k in enumerate(frames):
        if os.environ.get("NO_PASS3"):
            out.append(poses[i])
            continue
        if k.get("two"):
            # двуручное — через решатель хвата (обе кисти на одном древке), толчки уже сглажены
            out.append(build(k, fixed=(pushes[i], poles[i])))
            continue
        k3 = {kk: v for kk, v in k.items() if kk not in ("R", "L", "two")}
        for side in ("R", "L"):
            seq = [p.targets.get(side) for p in poses]
            if seq[i] is None:
                continue
            w = min(2, i, len(seq) - 1 - i)
            h = dict(seq[i])
            for fld in ("atw", "dirw", "knuckw", "polew"):
                if fld not in h:
                    continue
                acc, tot = poser.Vector(), 0.0
                for j in range(i - w, i + w + 1):
                    if seq[j] is not None and fld in seq[j]:
                        wt = w + 1 - abs(i - j)
                        acc += seq[j][fld] * wt
                        tot += wt
                v = acc / tot
                h[fld] = v.normalized() if fld in ("dirw", "knuckw") else v
            k3[side] = h
        if all(k3.get(sd, {}).get("pair") for sd in ("R", "L")):
            k3["pair"] = True
        out.append(build(k3, fixed=zero))
    poses = out
    if os.environ.get("DEBUG_CLIP") == name:
        for f in [int(x) for x in os.environ.get("DEBUG_FRAMES", "1").split(",")]:
            t = poses[f - 1].targets.get("L", {})
            print("DBG", f, "L", {kk: (tuple(round(c, 3) for c in v) if hasattr(v, "__len__") else v) for kk, v in t.items()},
                  "push", {kk: tuple(round(c, 3) for c in v) for kk, v in pushes[f - 1].items()},
                  "pole", {kk: tuple(round(c, 2) for c in v) for kk, v in poles[f - 1].items()},
                  "fore", tuple(round(c, 3) for c in poses[f - 1].P["LeftForeArm"]), "frameL", frames[f - 1].get("L"))
    for f, pz in enumerate(poses, start=1):
        key_pose(act, f, pz, prev)
    act.use_frame_range = True
    act.frame_range = (1, f_end)
    poser.arm.animation_data.action = None
    return act


for n, (keys, loop) in CLIPS.items():
    if ONLY and n not in ONLY:
        continue
    poser.ERR.clear()
    make(n, keys, loop)
    print("CLIP", n, "недотяг кисти, см:", {k: round(v * 100, 1) for k, v in poser.ERR.items()})

for pb in poser.arm.pose.bones:
    pb.rotation_quaternion = (1, 0, 0, 0)
    pb.location = (0, 0, 0)
bpy.ops.wm.save_as_mainfile(filepath=BLEND)
print("SAVED")
