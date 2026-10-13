"""
Модульный набор подземелья с нуля: скалы, сталактиты, колонны, арки, стены, лестницы, пролёты мостов.

    Blender -b --factory-startup -P tools/blender/gen_dkit.py -- <out.glb> [--preview лист.png] [--tex public/textures/dungeon]
    (обёртка: npm run asset -- dkit <out.glb> --preview <лист.png>)

Каждый модуль — SDF-формы (shared с моделями: tools/blender/zep_gen/sdf.py) → сетка surface nets →
прореживание до бюджета LOD0 и LOD1 → UV кубической проекцией В МИРОВЫХ МЕТРАХ (общие бесшовные
материалы ложатся одинаково на все модули) → цвета вершин: затенение по полю форм (AO) и мох сверху.
Материалов на весь набор — по семейству (rock, masonry, …): текстуры не в GLB, игра вешает общие
(public/textures/dungeon, генератор — tools/textures/gen_tiles.py). Имена мешей: <модуль>_<вариант>_LOD<n>.

Координаты модулей — Blender (Z вверх), низ модуля на z=0, «лицо» стены смотрит в −Y.
"""
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
import numpy as np  # noqa: E402

import zep_lib as z  # noqa: E402
from zep_gen import sdf  # noqa: E402
from zep_gen.build import decimate  # noqa: E402
from zep_gen.paint import sdf_ao  # noqa: E402

S = sdf.Shape
rm = sdf.rot_matrix  # углы Эйлера (°) → матрица поворота формы
ROOT = os.path.join(os.path.dirname(__file__), "..", "..")

# Метров на один повтор текстуры по семействам (плотность текселей одна на весь набор).
TILE_M = {"rock": 4.0, "masonry": 3.0, "flagstone": 3.0, "wood": 1.2, "metal": 1.0, "crystal": 1.0, "cloth": 1.5, "bone": 0.6}


# ---------------------------------------------------------------------------
# Гранёные глыбы.


def hull_planes(rng, size, n=14, jag=0.18):
    """Плоскости сколов глыбы размером size (полуоси x, y, z): нормали случайные, отступ — по эллипсоиду."""
    out = []
    ax = np.array(size, float)
    for _ in range(n):
        v = rng.normal(size=3)
        v /= np.linalg.norm(v)
        off = float(np.sqrt(((ax * v) ** 2).sum())) * rng.uniform(1 - jag, 1.0)
        out.append([v[0], v[1], v[2], off])
    for sgn in (1, -1):  # верх и низ — пологие (как плиты породы)
        v = np.array([rng.uniform(-0.15, 0.15), rng.uniform(-0.15, 0.15), sgn])
        v /= np.linalg.norm(v)
        out.append([v[0], v[1], v[2], ax[2] * rng.uniform(0.85, 1.0)])
    return out


def chunk(rng, c, size, k=0.25, n=14, jag=0.18, rot=None):
    """Глыба-скол в точке c."""
    return S("hull", c=list(c), planes=hull_planes(rng, size, n, jag), R=rm(rot or [0, 0, rng.uniform(0, 360)]), k=k)


# ---------------------------------------------------------------------------
# Модули. Каждая функция (rng, вариант) → dict(shapes, mat, h (шаг сетки), tris (LOD0), lod1 (доля)).


def rock_wall(rng, i):
    """Скальная стена ~10×4×8 м: массив из гранёных глыб-пластов; спина и низ срезаны (уходят в оболочку и пол)."""
    sh = []
    for k in range(7):
        cx = -4.2 + k * 1.4 + rng.uniform(-0.4, 0.4)
        cz = rng.uniform(1.8, 6.2)
        sh.append(chunk(rng, [cx, rng.uniform(-0.3, 0.7), cz], [rng.uniform(1.4, 2.4), rng.uniform(1.3, 1.9), rng.uniform(1.5, 2.6)], k=0.35))
    sh.append(S("box", op="sub", c=[0, 3.0, 4], h=[8, 1.3, 8], k=0.2))
    sh.append(S("box", op="sub", c=[0, 0, -1.0], h=[8, 4, 1.0], k=0.15))
    sh.append(sdf.Surface(noise=[0.06, 1.4, 20 + i], cracks=[0.06, 0.7, 0.08, 30 + i], strata=[0.22, 0.9, 40 + i]))
    return dict(shapes=sh, mat="rock", h=0.12, tris=1200, lod1=0.3)


def rock_outcrop(rng, i):
    """Выступ ~4×3×3 м — у стен, на полу, укрытие: 2–3 гранёные глыбы."""
    sh = [chunk(rng, [0, 0, 1.2], [1.9, 1.4, 1.4], k=0.25)]
    for k in range(2):
        sh.append(chunk(rng, [rng.uniform(-1.4, 1.4), rng.uniform(-0.6, 0.6), rng.uniform(0.6, 1.6)], [rng.uniform(0.8, 1.2), rng.uniform(0.7, 1.0), rng.uniform(0.6, 1.1)], k=0.2))
    sh.append(S("box", op="sub", c=[0, 0, -1.0], h=[4, 4, 1.0], k=0.1))
    sh.append(sdf.Surface(noise=[0.04, 2.0, 60 + i], cracks=[0.04, 1.1, 0.08, 70 + i], strata=[0.08, 0.5, 75 + i]))
    return dict(shapes=sh, mat="rock", h=0.07, tris=800, lod1=0.3)


def rubble(rng, i):
    """Обломок 0.6–1 м: гранёный камень (мелочь у стен, завалы)."""
    sh = [chunk(rng, [0, 0, 0.3], [0.5, 0.4, 0.32], k=0.06, n=12, jag=0.25)]
    sh.append(S("box", op="sub", c=[0, 0, -0.5], h=[1, 1, 0.5]))
    sh.append(sdf.Surface(cracks=[0.03, 2.5, 0.1, 90 + i]))
    return dict(shapes=sh, mat="rock", h=0.045, tris=140, lod1=0.4)


def stalactite(rng, i):
    """Сталактит со свода: длина 3–6 м, вершина на z=0 сверху вниз (модуль висит — ставится основанием в свод)."""
    L = 3 + i * 1.5
    sh = [S("cone", a=[0, 0, 0], b=[rng.uniform(-0.2, 0.2), rng.uniform(-0.2, 0.2), -L], r1=0.55 + i * 0.12, r2=0.05, k=0.2, noise=[0.08, 1.8, 100 + i])]
    sh.append(S("cone", a=[0.3, 0.1, 0], b=[0.45, 0.2, -L * 0.45], r1=0.3, r2=0.04, k=0.25, noise=[0.05, 2.2, 110 + i]))
    sh.append(S("box", op="sub", c=[0, 0, 0.5], h=[2, 2, 0.5]))
    sh.append(sdf.Surface(noise=[0.03, 4, 120 + i]))
    return dict(shapes=sh, mat="rock", h=0.06, tris=260, lod1=0.35)


def stalagmite(rng, i):
    """Сталагмит с пола: 2.5–5 м."""
    L = 2.5 + i * 1.2
    sh = [S("cone", a=[0, 0, 0], b=[rng.uniform(-0.15, 0.15), rng.uniform(-0.15, 0.15), L], r1=0.7 + i * 0.15, r2=0.06, k=0.2, noise=[0.08, 1.8, 130 + i])]
    sh.append(S("cone", a=[-0.35, 0, 0], b=[-0.5, 0.1, L * 0.4], r1=0.35, r2=0.05, k=0.3, noise=[0.05, 2.2, 140 + i]))
    sh.append(S("box", op="sub", c=[0, 0, -0.5], h=[2, 2, 0.5]))
    sh.append(sdf.Surface(noise=[0.03, 4, 150 + i]))
    return dict(shapes=sh, mat="rock", h=0.06, tris=260, lod1=0.35)


def cliff_pillar(rng, i):
    """Скальная опора ~6×6×20 м: под площадками и мостами, уходит в бездну (верх — на z=20). Пласты глыб."""
    sh = []
    for k in range(6):
        z0 = k * 3.5 + 1.5
        sh.append(chunk(rng, [rng.uniform(-0.6, 0.6), rng.uniform(-0.6, 0.6), z0], [rng.uniform(2.4, 3.2), rng.uniform(2.4, 3.2), 2.2], k=0.5))
    sh.append(S("box", op="sub", c=[0, 0, 21], h=[5, 5, 1]))
    sh.append(S("box", op="sub", c=[0, 0, -1], h=[5, 5, 1]))
    sh.append(sdf.Surface(noise=[0.08, 1.0, 170 + i], cracks=[0.07, 0.5, 0.1, 180 + i], strata=[0.25, 1.1, 185 + i]))
    return dict(shapes=sh, mat="rock", h=0.18, tris=1400, lod1=0.3)


def column(rng, i):
    """Колонна 1.6 × 8 м: база, ствол с каннелюрами-гранями, капитель; вариант 1 — обломанная."""
    H = 8.0
    sh = [S("box", c=[0, 0, 0.3], h=[1.05, 1.05, 0.3], rnd=0.06),
          S("cyl", a=[0, 0, 0.6], b=[0, 0, 0.9], r=0.95, rnd=0.08, k=0.1),
          S("cyl", a=[0, 0, 0.9], b=[0, 0, H - 0.9], r=0.72, rnd=0.0, k=0.15, noise=[0.02, 3, 190 + i]),
          S("cyl", a=[0, 0, H - 0.9], b=[0, 0, H - 0.55], r=0.95, rnd=0.08, k=0.12),
          S("box", c=[0, 0, H - 0.28], h=[1.05, 1.05, 0.28], rnd=0.06)]
    if i == 1:  # обломок: верх срезан наклонно и рвано
        sh.append(S("box", op="sub", c=[0, 0, 7.5], h=[2, 2, 3], R=rm([18, 8, 0]), k=0.05, noise=[0.15, 2.0, 200]))
    sh.append(sdf.Surface(noise=[0.012, 6, 210 + i], cracks=[0.025, 1.2, 0.08, 220 + i]))
    return dict(shapes=sh, mat="masonry", h=0.07, tris=700, lod1=0.35)


def arch(rng, i):
    """Арка-проём: пролёт 8 м, высота проёма 8 м, толщина 2 м, общая ширина 12 м, высота 10.5 м."""
    sh = [S("box", c=[0, 0, 5.25], h=[6.0, 1.0, 5.25], rnd=0.05),
          S("box", c=[0, 0, 10.2], h=[6.4, 1.15, 0.35], rnd=0.05, k=0.05),  # карниз
          S("cyl", op="sub", a=[0, -2, 4.0], b=[0, 2, 4.0], r=4.0, k=0.05),  # свод
          S("box", op="sub", c=[0, 0, 2.0], h=[4.0, 2, 2.0], k=0.05)]  # проём до пят свода
    sh.append(sdf.Surface(noise=[0.01, 5, 230 + i], cracks=[0.03, 0.9, 0.08, 240 + i]))
    return dict(shapes=sh, mat="masonry", h=0.08, tris=900, lod1=0.35)


def wall(rng, i):
    """Стена 4 × 1 × 6 м (тёсаные блоки — текстурой); вариант 1 — разрушенная: верх обломан, пролом."""
    sh = [S("box", c=[0, 0, 3.0], h=[2.0, 0.5, 3.0], rnd=0.04)]
    if i == 1:
        sh.append(S("box", op="sub", c=[0.6, 0, 6.3], h=[1.8, 1, 2.2], R=rm([0, 0, 0]), k=0.1, noise=[0.25, 1.4, 250]))
        sh.append(S("ellipsoid", op="sub", c=[-0.6, 0, 2.6], r=[0.8, 1.0, 1.1], k=0.1, noise=[0.15, 2.0, 251]))
    sh.append(sdf.Surface(noise=[0.01, 6, 260 + i], cracks=[0.03, 1.0, 0.07, 270 + i]))
    return dict(shapes=sh, mat="masonry", h=0.06, tris=500, lod1=0.35)


def stairs(rng, i):
    """Лестничный марш 4 м ширины, 8 ступеней по 0.3 × 0.45 м (подъём 2.4 м на 3.6 м), монолит до низа."""
    # каждый блок тянется до конца марша — склеиваются в монолит
    sh = [S("box", c=[0, (-1.8 + k * 0.45 + 1.8) / 2, (k + 1) * 0.15], h=[2.0, (1.8 - (-1.8 + k * 0.45)) / 2, (k + 1) * 0.15], rnd=0.02) for k in range(8)]
    sh.append(sdf.Surface(noise=[0.008, 6, 280 + i], cracks=[0.02, 1.3, 0.06, 290 + i]))
    return dict(shapes=sh, mat="masonry", h=0.05, tris=600, lod1=0.4)


def bridge_seg(rng, i):
    """Пролёт каменного моста 6 × 4 м: настил, низ арочкой, низкий парапет по краям (0.9 м)."""
    sh = [S("box", c=[0, 0, -0.5], h=[3.0, 2.0, 0.5], rnd=0.04),
          S("box", c=[0, 0, -1.6], h=[2.2, 2.0, 0.8], rnd=0.2, k=0.6),
          S("box", c=[-2.8, 0, 0.45], h=[0.22, 2.0, 0.45], rnd=0.05),
          S("box", c=[2.8, 0, 0.45], h=[0.22, 2.0, 0.45], rnd=0.05)]
    if i == 1:  # разрушенный: обломан край парапета и угол настила
        sh.append(S("ellipsoid", op="sub", c=[2.9, 0.8, 0.5], r=[0.6, 1.1, 0.8], noise=[0.12, 2.5, 300]))
        sh.append(S("ellipsoid", op="sub", c=[-3.2, -1.9, -0.8], r=[0.9, 0.8, 1.0], noise=[0.12, 2.5, 301]))
    sh.append(sdf.Surface(noise=[0.01, 6, 310 + i], cracks=[0.03, 1.0, 0.07, 320 + i]))
    return dict(shapes=sh, mat="masonry", h=0.06, tris=600, lod1=0.35)


def crystal(rng, i):
    """Друза кристаллов: гранёные шестигранные призмы с острыми верхушками, веером из общего основания.
    i=0 — мелкая (0.8 м, в трещины), 1 — средняя (2.5 м, на стены и пол), 2 — гигант-ориентир (7 м).
    Сетка строится прямо (грани должны быть острыми — SDF их сгладил бы)."""
    size = (0.8, 2.5, 7.0)[i]
    count = (7, 9, 7)[i]
    V, F, C = [], [], []
    for k in range(count):
        main = k == 0
        L = size * (1.0 if main else rng.uniform(0.35, 0.8))
        r = L * rng.uniform(0.11, 0.16)
        tilt = 0 if main else rng.uniform(15, 50)
        yaw = rng.uniform(0, 360)
        R = sdf.rot_matrix([tilt, 0, yaw])
        off = np.array([0, 0, 0]) if main else np.array([rng.uniform(-0.25, 0.25) * size * 0.4, rng.uniform(-0.25, 0.25) * size * 0.4, 0])
        tip_h = r * rng.uniform(1.6, 2.4)
        base = len(V)
        ring = []
        for a in range(6):
            ang = a / 6 * 2 * math.pi
            ring.append((math.cos(ang) * r, math.sin(ang) * r))
        # кольцо низа (z=0, утоплено), кольцо плеч (z=L−tip), вершина
        for z in (-0.15 * size, L - tip_h):
            for (x, y) in ring:
                V.append(list(R @ np.array([x, y, z]) + off))
                C.append(0.35 if z < 0 else 0.85)
        V.append(list(R @ np.array([0, 0, L]) + off))
        C.append(1.0)
        top = base + 12
        for a in range(6):
            b0, b1 = base + a, base + (a + 1) % 6
            s0, s1 = base + 6 + a, base + 6 + (a + 1) % 6
            F.append([b0, b1, s1, s0])
            F.append([s0, s1, top])
    return dict(mesh=(np.array(V), F, np.array(C)), mat="crystal")


IRON = (0.16, 0.16, 0.17)
EMBER = (0.55, 0.16, 0.05)
BONE = (0.86, 0.8, 0.66)


def brazier(rng, i):
    """Железная жаровня на треноге ~1.3 м: три изогнутые ноги, открытая чаша с ободом, горка углей
    (огонь — в игре, шейдером). Не «статуя»: ажурная, видно сквозь ноги."""
    sh = []
    for k in range(3):
        a = k / 3 * 2 * math.pi
        foot = [math.cos(a) * 0.55, math.sin(a) * 0.55, 0.02]
        knee = [math.cos(a) * 0.32, math.sin(a) * 0.32, 0.6]
        top = [math.cos(a) * 0.22, math.sin(a) * 0.22, 1.0]
        sh.append(S("cone", a=foot, b=knee, r1=0.045, r2=0.035, k=0.02, mat="iron"))
        sh.append(S("cone", a=knee, b=top, r1=0.035, r2=0.04, k=0.03, mat="iron"))
        sh.append(S("sphere", c=foot, r=0.07, k=0.02, mat="iron"))
    sh.append(S("torus", c=[0, 0, 0.62], R=0.33, r=0.025, k=0.02, mat="iron"))  # кольцо-распорка
    sh.append(S("ellipsoid", c=[0, 0, 1.12], r=[0.5, 0.5, 0.26], k=0.05, mat="iron"))
    sh.append(S("ellipsoid", op="sub", c=[0, 0, 1.2], r=[0.44, 0.44, 0.24], k=0.02))
    sh.append(S("cyl", op="sub", a=[0, 0, 1.3], b=[0, 0, 1.6], r=0.6))
    sh.append(S("torus", c=[0, 0, 1.28], R=0.47, r=0.035, k=0.02, mat="iron"))
    sh.append(S("ellipsoid", c=[0, 0, 1.2], r=[0.36, 0.36, 0.12], k=0.04, mat="ember", noise=[0.03, 9, 340]))
    sh.append(sdf.Surface(noise=[0.004, 14, 341]))
    return dict(shapes=sh, mat="metal", h=0.022, tris=900, lod1=0.35, tints={"iron": IRON, "ember": EMBER})


def sconce(rng, i):
    """Настенный факел: кованый кронштейн от стены (−Y — к стене, лицо +Y?), чашка; стена — за y=0."""
    sh = [S("box", c=[0, 0.06, 0], h=[0.09, 0.05, 0.2], rnd=0.02, mat="iron"),
          S("cone", a=[0, 0.08, -0.05], b=[0, 0.42, 0.18], r1=0.03, r2=0.03, k=0.02, mat="iron"),
          S("cone", a=[0, 0.42, 0.1], b=[0, 0.42, 0.3], r1=0.07, r2=0.13, k=0.03, mat="iron"),
          S("cyl", op="sub", a=[0, 0.42, 0.24], b=[0, 0.42, 0.4], r=0.1),
          S("ellipsoid", c=[0, 0.42, 0.25], r=[0.09, 0.09, 0.05], mat="ember")]
    return dict(shapes=sh, mat="metal", h=0.012, tris=300, lod1=0.4, tints={"iron": IRON, "ember": EMBER})


def barrel(rng, i):
    """Бочка 1.2 м: выпуклые клёпки (текстура дерева), три железных обруча; вариант 1 — лежит на боку."""
    sh = [S("ellipsoid", c=[0, 0, 0.6], r=[0.46, 0.46, 0.9], k=0.0, mat="wood"),
          S("box", op="sub", c=[0, 0, 1.6], h=[1, 1, 0.4]), S("box", op="sub", c=[0, 0, -0.4], h=[1, 1, 0.4])]
    for z in (0.12, 0.6, 1.08):
        r = 0.46 * math.sqrt(max(0.0, 1 - ((z - 0.6) / 0.9) ** 2)) + 0.012
        sh.append(S("torus", c=[0, 0, z], R=r, r=0.03, k=0.01, mat="iron"))
    sh.append(S("cyl", op="sub", a=[0, 0, 1.17], b=[0, 0, 1.3], r=0.36))  # крышка утоплена
    sh.append(sdf.Surface(noise=[0.004, 10, 350 + i]))
    d = dict(shapes=sh, mat="wood", h=0.025, tris=600, lod1=0.35, tints={"wood": (1, 1, 1), "iron": IRON})
    if i == 1:
        d["rot"] = [90, 0, 0]
    return d


def crate(rng, i):
    """Ящик ~0.9 м: доски (текстура), рамка по рёбрам темнее, сколы."""
    s0 = (0.9, 0.7)[i]
    h = s0 / 2
    sh = [S("box", c=[0, 0, h], h=[h, h, h], rnd=0.02, mat="wood")]
    for ax in range(3):
        for sx in (-1, 1):
            for sy in (-1, 1):
                c = [0, 0, h]
                e = [0.06, 0.06, 0.06]
                o = [i for i in range(3) if i != ax]
                c[o[0]] += sx * (h - 0.03)
                c[o[1]] += sy * (h - 0.03)
                e[ax] = h
                sh.append(S("box", c=c, h=e, rnd=0.01, mat="frame"))
    sh.append(S("box", op="sub", c=[h * 0.9, 0, h * 1.8], h=[0.2, 0.3, 0.15], R=sdf.rot_matrix([0, 30, 0]), noise=[0.03, 6, 360 + i]))
    return dict(shapes=sh, mat="wood", h=0.02, tris=400, lod1=0.4, tints={"wood": (1, 1, 1), "frame": (0.55, 0.45, 0.38)})


def chest(rng, i):
    """Сундук 1.2 × 0.7 м: ящик, полукруглая крышка, железные полосы и замок."""
    sh = [S("box", c=[0, 0, 0.28], h=[0.6, 0.36, 0.28], rnd=0.02, mat="wood"),
          S("cyl", a=[-0.6, 0, 0.56], b=[0.6, 0, 0.56], r=0.36, mat="wood", k=0.02),
          S("box", op="sub", c=[0, 0, 0.2], h=[0.7, 0.5, 0.36])]
    sh = [S("box", c=[0, 0, 0.28], h=[0.6, 0.36, 0.28], rnd=0.02, mat="wood"),
          S("cyl", a=[-0.6, 0, 0.56], b=[0.6, 0, 0.56], r=0.36, mat="wood", k=0.01)]
    sh.append(S("box", op="sub", c=[0, 0, 0.2], h=[0.7, 0.5, 0.0]))
    for x in (-0.42, 0.0, 0.42):
        sh.append(S("box", c=[x, 0, 0.3], h=[0.04, 0.375, 0.3], mat="iron"))
        sh.append(S("cyl", a=[x - 0.04, 0, 0.56], b=[x + 0.04, 0, 0.56], r=0.375, mat="iron"))
    sh.append(S("box", c=[0, -0.38, 0.5], h=[0.08, 0.03, 0.1], rnd=0.01, mat="gold"))
    sh.append(S("box", op="sub", c=[0, 0, -0.5], h=[1, 1, 0.5]))
    return dict(shapes=sh, mat="wood", h=0.02, tris=700, lod1=0.35, tints={"wood": (0.9, 0.75, 0.6), "iron": IRON, "gold": (1.4, 1.0, 0.35)})


def mine_cart(rng, i):
    """Шахтная тележка: железный кузов-короб, расширяется кверху, рёбра, четыре колеса на осях."""
    sh = [S("box", c=[0, 0, 0.75], h=[0.62, 0.42, 0.32], rnd=0.03, mat="iron"),
          S("box", op="sub", c=[0, 0, 0.88], h=[0.56, 0.36, 0.3])]
    for x in (-0.62, 0, 0.62):
        sh.append(S("box", c=[x, 0, 0.75], h=[0.03, 0.44, 0.33], mat="rib"))
    for x in (-0.42, 0.42):
        for y in (-0.46, 0.46):
            sh.append(S("cyl", a=[x, y - 0.05, 0.25], b=[x, y + 0.05, 0.25], r=0.24, rnd=0.02, mat="wheel"))
        sh.append(S("cyl", a=[x, -0.5, 0.25], b=[x, 0.5, 0.25], r=0.04, mat="wheel"))
    sh.append(S("box", c=[0, 0, 0.42], h=[0.5, 0.3, 0.04], mat="iron"))
    return dict(shapes=sh, mat="metal", h=0.025, tris=700, lod1=0.35, tints={"iron": (0.42, 0.3, 0.22), "rib": IRON, "wheel": (0.12, 0.12, 0.13)})


def cage(rng, i):
    """Клетка-висячая/стоячая 2.4 м: кольца и прутья (сетка прямо — тонкие прутья SDF дорог), купол."""
    V, F, C = [], [], []

    def bar(a, b, r=0.025):
        a, b = np.array(a, float), np.array(b, float)
        d = b - a
        L = np.linalg.norm(d)
        z = d / L
        x = np.cross(z, [0, 0, 1] if abs(z[2]) < 0.9 else [1, 0, 0])
        x /= np.linalg.norm(x)
        y = np.cross(z, x)
        base = len(V)
        for e in (a, b):
            for k in range(4):
                ang = k / 4 * 2 * math.pi
                V.append(list(e + (x * math.cos(ang) + y * math.sin(ang)) * r))
                C.append(1.0)
        for k in range(4):
            F.append([base + k, base + (k + 1) % 4, base + 4 + (k + 1) % 4, base + 4 + k])

    R, H, n = 0.7, 1.9, 12
    pts = lambda z, rr: [(math.cos(k / n * 2 * math.pi) * rr, math.sin(k / n * 2 * math.pi) * rr, z) for k in range(n)]
    for z, rr in ((0.05, R), (0.9, R), (H, R)):
        ring = pts(z, rr)
        for k in range(n):
            bar(ring[k], ring[(k + 1) % n], 0.035)
    lo, hi = pts(0.05, R), pts(H, R)
    for k in range(n):
        bar(lo[k], hi[k])
        bar(hi[k], (0, 0, H + 0.45))
    bar((0, 0, H + 0.45), (0, 0, H + 0.75), 0.04)
    base = len(V)
    for (x, y, z) in pts(0.02, R) + [(0, 0, 0.02)]:
        V.append([x, y, z])
        C.append(0.6)
    for k in range(n):
        F.append([base + n, base + (k + 1) % n, base + k])
    return dict(mesh=(np.array(V), F, np.array(C)), mat="metal")


def banner(rng, i):
    """Знамя на стойке 4.2 м: древко, перекладина, полотнище с волной и ласточкиным хвостом
    (цвет — в вершинах: тёмно-красное с золотой каймой и знаком; вариант 1 — изорванное)."""
    V, F, C3 = [], [], []

    def col(rgb):
        C3.append(rgb)

    def box(c, h, rgb):
        base = len(V)
        for dx in (-1, 1):
            for dy in (-1, 1):
                for dz in (-1, 1):
                    V.append([c[0] + dx * h[0], c[1] + dy * h[1], c[2] + dz * h[2]])
                    col(rgb)
        q = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]
        for f in q:
            F.append([base + k for k in f])

    wood = (0.32, 0.2, 0.12)
    box([0, 0, 2.1], [0.05, 0.05, 2.1], wood)
    box([0, 0.08, 4.0], [0.75, 0.04, 0.04], wood)
    box([0, 0, 0.06], [0.28, 0.28, 0.06], (0.25, 0.24, 0.24))
    W, Ht, nx, nz = 1.4, 2.4, 8, 14
    base = len(V)
    for r in range(nz + 1):
        t = r / nz
        for c in range(nx + 1):
            u = c / nx
            x = (u - 0.5) * W
            z = 3.98 - t * Ht
            if t > 0.82:  # ласточкин хвост
                z += abs(u - 0.5) * 2 * (t - 0.82) / 0.18 * 0.45 * Ht * 0.18 * 2 - (t - 0.82) * Ht * 0
            y = 0.12 + math.sin(u * 5 + t * 2) * 0.06 * t + t * t * 0.05
            V.append([x, y, z])
            edge = u < 0.08 or u > 0.92 or t < 0.06
            sign = abs(u - 0.5) < 0.12 and 0.25 < t < 0.65 or (abs(u - 0.5) < 0.3 and abs(t - 0.38) < 0.04)
            if edge or sign:
                col((1.2, 0.85, 0.3))
            else:
                col((0.5, 0.06, 0.05))
    for r in range(nz):
        for c in range(nx):
            if i == 1 and r > 6 and rng.random() < 0.18:
                continue
            a = base + r * (nx + 1) + c
            F.append([a, a + 1, a + nx + 2, a + nx + 1])
    return dict(mesh=(np.array(V), F, np.array(C3)), mat="cloth", rgb=True)


def statue(rng, i):
    """Статуя воина в доспехе ~4 м на постаменте: опирается на меч остриём вниз (вариант 1 — без головы и руки)."""
    sh = [S("box", c=[0, 0, 0.35], h=[0.8, 0.8, 0.35], rnd=0.04),
          S("box", c=[0, 0, 0.8], h=[0.7, 0.7, 0.12], rnd=0.03, k=0.05)]
    leg = lambda x: [S("cone", a=[x, 0, 0.95], b=[x, 0.02, 1.85], r1=0.17, r2=0.2, k=0.08),
                     S("cone", a=[x, 0.02, 1.85], b=[x * 0.9, 0, 2.55], r1=0.2, r2=0.22, k=0.08)]
    sh += leg(-0.2) + leg(0.2)
    sh.append(S("ellipsoid", c=[0, 0, 2.6], r=[0.42, 0.28, 0.3], k=0.1))  # пояс и юбка доспеха
    sh.append(S("ellipsoid", c=[0, 0, 3.05], r=[0.45, 0.3, 0.45], k=0.12))  # торс
    sh.append(S("ellipsoid", c=[-0.48, 0, 3.4], r=[0.22, 0.24, 0.17], k=0.05))  # наплечники
    sh.append(S("ellipsoid", c=[0.48, 0, 3.4], r=[0.22, 0.24, 0.17], k=0.05))
    if i == 0:
        sh.append(S("sphere", c=[0, 0, 3.72], r=0.21, k=0.06))  # шлем
        sh.append(S("box", c=[0, -0.12, 3.95], h=[0.04, 0.18, 0.1], k=0.03))  # гребень
    # руки к эфесу перед собой, меч остриём в постамент
    for x in (-0.42, 0.42):
        sh.append(S("cone", a=[x, 0, 3.3], b=[x * 0.5, -0.32, 2.85], r1=0.11, r2=0.1, k=0.06))
        if not (i == 1 and x > 0):
            sh.append(S("cone", a=[x * 0.5, -0.32, 2.85], b=[0, -0.42, 2.7], r1=0.1, r2=0.09, k=0.05))
    sh.append(S("box", c=[0, -0.44, 1.8], h=[0.07, 0.025, 0.85], k=0.01))  # клинок
    sh.append(S("box", c=[0, -0.44, 2.66], h=[0.28, 0.05, 0.04], k=0.01))  # гарда
    sh.append(S("cyl", a=[0, -0.44, 2.7], b=[0, -0.44, 2.95], r=0.035))
    sh.append(sdf.Surface(noise=[0.012, 5, 370 + i], cracks=[0.02, 1.4, 0.06, 371 + i]))
    return dict(shapes=sh, mat="masonry", h=0.035, tris=1600, lod1=0.3)


def bones(rng, i):
    """Останки: i=0 — череп с костями, 1 — россыпь костей, 2 — скелет у стены (сидит, череп свешен)."""
    sh = []

    def bone(a, b, r=0.035):
        sh.append(S("cone", a=a, b=b, r1=r, r2=r * 0.9, k=0.01, mat="bone"))
        sh.append(S("sphere", c=a, r=r * 1.6, k=0.01, mat="bone"))
        sh.append(S("sphere", c=b, r=r * 1.5, k=0.01, mat="bone"))

    def skull(c, tilt=0):
        sh.append(S("ellipsoid", c=c, r=[0.1, 0.12, 0.11], k=0.02, mat="bone"))
        sh.append(S("ellipsoid", c=[c[0], c[1] - 0.08, c[2] - 0.08], r=[0.07, 0.06, 0.05], k=0.03, mat="bone"))
        for x in (-0.04, 0.04):
            sh.append(S("sphere", op="sub", c=[c[0] + x, c[1] - 0.11, c[2] + 0.0], r=0.032, k=0.01))
    if i in (0, 1):
        for _ in range(6 if i == 0 else 10):
            a = rng.uniform(-0.6, 0.6, 2)
            ang = rng.uniform(0, 2 * math.pi)
            L = rng.uniform(0.25, 0.45)
            bone([a[0], a[1], 0.04], [a[0] + math.cos(ang) * L, a[1] + math.sin(ang) * L, 0.04 + rng.uniform(0, 0.05)])
        if i == 0:
            skull([0.1, 0.0, 0.1])
    else:
        bone([0, 0.1, 0.05], [0, 0.15, 0.55], 0.04)  # позвоночник
        for z in (0.25, 0.35, 0.45):
            bone([-0.15, 0.05, z], [0.15, 0.05, z], 0.02)
        bone([-0.12, 0.1, 0.06], [-0.2, -0.35, 0.05])
        bone([0.12, 0.1, 0.06], [0.22, -0.35, 0.08])
        bone([-0.2, -0.35, 0.05], [-0.25, -0.75, 0.04])
        bone([0.22, -0.35, 0.08], [0.3, -0.72, 0.04])
        bone([-0.18, 0.12, 0.5], [-0.3, -0.1, 0.2], 0.03)
        skull([0.0, 0.0, 0.72])
    sh.append(S("box", op="sub", c=[0, 0, -0.5], h=[2, 2, 0.5]))
    return dict(shapes=sh, mat="bone", h=0.014, tris=900, lod1=0.35, tints={"bone": BONE})


MODULES = {
    "RockWall": (rock_wall, 3),
    "RockOutcrop": (rock_outcrop, 3),
    "Rubble": (rubble, 4),
    "Stalactite": (stalactite, 3),
    "Stalagmite": (stalagmite, 3),
    "CliffPillar": (cliff_pillar, 2),
    "Column": (column, 2),
    "Arch": (arch, 1),
    "Wall": (wall, 2),
    "Stairs": (stairs, 1),
    "BridgeSeg": (bridge_seg, 2),
    "Crystal": (crystal, 3),
    "Brazier": (brazier, 1),
    "Sconce": (sconce, 1),
    "Barrel": (barrel, 2),
    "Crate": (crate, 2),
    "Chest": (chest, 1),
    "MineCart": (mine_cart, 1),
    "Cage": (cage, 1),
    "Banner": (banner, 2),
    "Statue": (statue, 2),
    "Bones": (bones, 3),
}


# ---------------------------------------------------------------------------
# Сетка, UV, цвета вершин.


def tri_count(F):
    return sum(len(f) - 2 for f in F)


def make_object(name, V, F, mat, shapes, coll, tints=None):
    """Меш + UV кубической проекцией в метрах + цвет вершин (AO по полю, мох сверху)."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in V], [], [tuple(f) for f in F])
    me.update()
    me.validate()
    for p in me.polygons:
        p.use_smooth = True
    # UV: по доминирующей оси нормали грани, масштаб — метры / TILE_M
    tm = TILE_M[mat]
    uv = me.uv_layers.new(name="UVMap")
    co = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    for p in me.polygons:
        n = p.normal
        ax = int(np.argmax(np.abs([n.x, n.y, n.z])))
        for li in p.loop_indices:
            v = co[me.loops[li].vertex_index]
            if ax == 0:
                uv.data[li].uv = (v[1] / tm * math.copysign(1, n.x), v[2] / tm)
            elif ax == 1:
                uv.data[li].uv = (-v[0] / tm * math.copysign(1, n.y), v[2] / tm)
            else:
                uv.data[li].uv = (v[0] / tm, v[1] / tm * math.copysign(1, n.z))
    # Цвет вершин: AO по полю форм × мох на верхних гранях (только камень пещеры).
    me.calc_loop_triangles()
    nrm = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get("normal", nrm)
    nrm = nrm.reshape(-1, 3)
    geo = [s for s in shapes if s.op != "surface"]
    ao = sdf_ao(geo, co, nrm, 0.6 if mat == "rock" else 0.25, 1.1)
    ao = 0.35 + 0.65 * ao
    col = np.repeat(ao[:, None], 3, 1)
    if tints:
        # цвет части — по ближайшей форме (обручи бочки, угли жаровни, оковка сундука)
        named = [s for s in geo if s.op == "add"]
        D = sdf.shape_dists(named, co)
        near = np.argmin(D, 0)
        tint = np.array([tints.get(named[k].mat, (1, 1, 1)) for k in near])
        col = col * tint
    if mat in ("rock", "masonry"):
        noise = sdf.Noise(77)
        up = np.clip((nrm[:, 2] - 0.55) / 0.35, 0, 1)
        patch = np.clip((noise.fbm(co * 0.6) + 0.1) * 3, 0, 1)
        moss = up * patch * (0.8 if mat == "rock" else 0.5)
        mc = np.array([0.32, 0.4, 0.2])
        col = col * (1 - moss[:, None]) + (mc * ao[:, None]) * moss[:, None]
    ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    rgba = np.concatenate([col, np.ones((len(col), 1))], 1).astype(np.float32)
    ca.data.foreach_set("color", rgba.ravel())
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    m = bpy.data.materials.get(mat) or bpy.data.materials.new(mat)
    ob.data.materials.append(m)
    return ob


def make_raw(name, V, F, C, mat, coll):
    """Меш как есть (острые грани — без сглаживания), цвет вершин — яркость (у кристалла: низ темнее, верхушки ярче)."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in V], [], [tuple(f) for f in F])
    me.update()
    uv = me.uv_layers.new(name="UVMap")
    for p in me.polygons:
        for li in p.loop_indices:
            v = V[me.loops[li].vertex_index]
            uv.data[li].uv = (float(v[0] + v[1]), float(v[2]))
    ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    C = np.asarray(C, dtype=np.float32)
    rgba = (np.concatenate([C, np.ones((len(C), 1), np.float32)], 1) if C.ndim == 2 else np.stack([C, C, C, np.ones_like(C)], 1)).astype(np.float32)
    ca.data.foreach_set("color", rgba.ravel())
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    m = bpy.data.materials.get(mat) or bpy.data.materials.new(mat)
    ob.data.materials.append(m)
    return ob


def remesh(V, F, h):
    """Воксельная пересборка: сетка из поля бывает неманифолдной (тонкие места) — на таком прореживание
    застревает (2.5k треугольников вместо 600). После пересборки поверхность чистая."""
    me = bpy.data.meshes.new("_rm")
    me.from_pydata([tuple(v) for v in V], [], [tuple(f) for f in F])
    me.update()
    ob = bpy.data.objects.new("_rm", me)
    bpy.context.scene.collection.objects.link(ob)
    md = ob.modifiers.new("rm", "REMESH")
    md.mode = "VOXEL"
    md.voxel_size = h
    m2 = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    V2 = np.zeros(len(m2.vertices) * 3)
    m2.vertices.foreach_get("co", V2)
    F2 = [list(p.vertices) for p in m2.polygons]
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    bpy.data.meshes.remove(m2)
    return V2.reshape(-1, 3), F2


def build_module(name, fn, variant, coll):
    rng = np.random.default_rng(1000 + sum(map(ord, name)) + variant * 17)  # hash() в Python случаен между запусками
    d = fn(rng, variant)
    if "mesh" in d:
        V, F, C = d["mesh"]
        o0 = make_raw(f"{name}_{variant}_LOD0", V, F, C, d["mat"], coll)
        o1 = make_raw(f"{name}_{variant}_LOD1", V, F, C, d["mat"], coll)
        lo, hi = V.min(0), V.max(0)
        return o0, o1, dict(name=f"{name}_{variant}", mat=d["mat"], raw=tri_count(F), lod0=tri_count(F), lod1=tri_count(F),
                            size=[round(float(x), 2) for x in (hi - lo)])
    V, Q = sdf.mesh(d["shapes"], d["h"])
    F = [list(q) for q in Q]
    raw = tri_count(F)
    V, F = remesh(V, F, d["h"])
    V0, F0 = decimate(V, F, d["tris"], symmetric=False)
    V1, F1 = decimate(V0, F0, max(40, int(d["tris"] * d["lod1"])), symmetric=False)
    o0 = make_object(f"{name}_{variant}_LOD0", V0, F0, d["mat"], d["shapes"], coll, d.get("tints"))
    o1 = make_object(f"{name}_{variant}_LOD1", V1, F1, d["mat"], d["shapes"], coll, d.get("tints"))
    if d.get("rot"):  # лежачий вариант (бочка на боку): повернуть и опустить на пол
        R = sdf.rot_matrix(d["rot"])
        for ob in (o0, o1):
            co = np.zeros(len(ob.data.vertices) * 3)
            ob.data.vertices.foreach_get("co", co)
            co = co.reshape(-1, 3) @ R.T
            co[:, 2] -= co[:, 2].min()
            ob.data.vertices.foreach_set("co", co.ravel())
            ob.data.update()
        V0 = (V0 @ R.T)
    lo, hi = V0.min(0), V0.max(0)
    return o0, o1, dict(name=f"{name}_{variant}", mat=d["mat"], raw=raw, lod0=tri_count(F0), lod1=tri_count(F1),
                        size=[round(float(x), 2) for x in (hi - lo)])


# ---------------------------------------------------------------------------
# Превью: модули в ряд, материалы с текстурами, свет «тёплый факел + холодный кристалл».


def preview_materials(tex_dir):
    for name in ("rock", "masonry", "flagstone", "wood", "metal"):
        m = bpy.data.materials.get(name)
        if not m:
            continue
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        nt.links.new(bsdf.outputs[0], out.inputs[0])
        def img(suffix, non_color):
            p = os.path.join(tex_dir, f"{name}_{suffix}.jpg")
            if not os.path.exists(p):
                return None
            t = nt.nodes.new("ShaderNodeTexImage")
            t.image = bpy.data.images.load(p)
            if non_color:
                t.image.colorspace_settings.name = "Non-Color"
            return t
        c = img("c", False)
        vc = nt.nodes.new("ShaderNodeVertexColor")
        vc.layer_name = "Col"
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs[0].default_value = 1.0
        if c:
            nt.links.new(c.outputs[0], mix.inputs[6])
        nt.links.new(vc.outputs[0], mix.inputs[7])
        nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
        r = img("r", True)
        if r:
            nt.links.new(r.outputs[0], bsdf.inputs["Roughness"])
        n = img("n", True)
        if n:
            nm = nt.nodes.new("ShaderNodeNormalMap")
            nm.inputs[0].default_value = 1.0
            nt.links.new(n.outputs[0], nm.inputs[1])
            nt.links.new(nm.outputs[0], bsdf.inputs["Normal"])


def preview(objs, path, tex_dir):
    preview_materials(tex_dir)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1000
    scene.render.image_settings.file_format = "PNG"
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.02, 0.025, 0.04, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
    scene.world = world
    # раскладка: по рядам, слева направо
    x, row_y, row_h = 0.0, 0.0, 0.0
    placed = []
    for o in objs:
        dims = o.dimensions
        if x + dims.x > 46:
            x = 0.0
            row_y += row_h + 4
            row_h = 0.0
        o.location = (x + dims.x / 2, row_y, -min(v.co.z for v in o.data.vertices) if o.name.startswith("Stalactite") else 0)
        if o.name.startswith("Stalactite"):
            o.location.z = max(v.co.z for v in o.data.vertices) * 0 + 6.5
        x += dims.x + 2.5
        row_h = max(row_h, dims.y)
        placed.append(o)
    # пол
    bpy.ops.mesh.primitive_plane_add(size=200, location=(20, row_y / 2, 0))
    floor = bpy.context.object
    fm = bpy.data.materials.get("flagstone") or bpy.data.materials.new("flagstone")
    floor.data.materials.append(fm)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.uv.cube_project(cube_size=TILE_M["flagstone"] * 2)
    bpy.ops.object.mode_set(mode="OBJECT")
    if "Col" not in floor.data.color_attributes:
        ca = floor.data.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
        for d in ca.data:
            d.color = (1, 1, 1, 1)
    preview_materials(tex_dir)
    cx, cy = 22, row_y / 2
    cam_d = bpy.data.cameras.new("cam")
    cam_d.lens = 30
    cam = bpy.data.objects.new("cam", cam_d)
    scene.collection.objects.link(cam)
    cam.location = (cx, cy - 46, 26)
    cam.rotation_euler = (math.radians(62), 0, 0)
    scene.camera = cam
    for (loc, col, energy) in [((cx - 18, cy - 14, 9), (1.0, 0.6, 0.3), 9000), ((cx + 18, cy - 10, 12), (0.4, 0.65, 1.0), 9000),
                               ((cx, cy + 10, 20), (0.6, 0.7, 0.9), 6000)]:
        ld = bpy.data.lights.new("l", "POINT")
        ld.color = col
        ld.energy = energy
        ld.shadow_soft_size = 1.5
        lo = bpy.data.objects.new("l", ld)
        lo.location = loc
        scene.collection.objects.link(lo)
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 1.2
    sun.color = (0.7, 0.75, 0.9)
    so = bpy.data.objects.new("sun", sun)
    so.rotation_euler = (math.radians(50), 0, math.radians(30))
    scene.collection.objects.link(so)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    a = z.args()
    out = a[0]
    prev = z.opt(a, "--preview")
    only = [x for x in (z.opt(a, "--only", "") or "").split(",") if x]
    tex = z.opt(a, "--tex", os.path.join(ROOT, "public", "textures", "dungeon"))
    z.clear_scene()
    coll = bpy.data.collections.new("DungeonKit")
    bpy.context.scene.collection.children.link(coll)
    t0 = time.time()
    report = []
    lod0 = []
    for name, (fn, nvar) in MODULES.items():
        if only and name not in only:
            continue
        for v in range(nvar):
            o0, o1, info = build_module(name, fn, v, coll)
            report.append(info)
            lod0.append(o0)
    # Экспорт: все меши, UV и цвета вершин; материалы — только имена.
    for o in bpy.context.view_layer.objects:
        o.select_set(o.name in coll.objects)
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
                              export_texcoords=True, export_normals=True, export_vertex_color="ACTIVE",
                              export_animations=False, export_materials="PLACEHOLDER")
    res = dict(glb=out, modules=report, secs=round(time.time() - t0, 1), kb=round(os.path.getsize(out) / 1024))
    if prev:
        for o in coll.objects:
            o.hide_render = not o.name.endswith("LOD0")
        preview(lod0, prev, tex)
        res["preview"] = prev
    z.emit(res)


main()
