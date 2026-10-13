#!/usr/bin/env python3
"""
Бесшовные текстуры материалов подземелья — с нуля, процедурно (numpy + Pillow, без Blender).

Каждый материал: цвет (_c.jpg, sRGB), нормаль (_n.jpg, касательное пространство OpenGL, из карты высот),
шероховатость (_r.jpg, светлее — грубее). Все карты бесшовные: шум и ячейки считаются на торе (период = кадр).

    python3 tools/textures/gen_tiles.py [out_dir] [--size 1024] [--only rock,masonry] [--sheet лист.png]

По умолчанию out_dir = public/textures/dungeon. Детерминированно (seed в описании материала).
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

# ---------------------------------------------------------------------------
# Бесшовный шум.


def value_noise(n, period, rng):
    """Сглаженный шум на решётке period×period, растянутый на n×n, бесшовный."""
    g = rng.random((period, period)).astype(np.float32)
    x = np.arange(n, dtype=np.float32) * period / n
    i0 = np.floor(x).astype(int)
    t = x - i0
    t = t * t * (3 - 2 * t)
    i1 = (i0 + 1) % period
    a = g[i0][:, i0] * (1 - t)[None, :] + g[i0][:, i1] * t[None, :]
    b = g[i1][:, i0] * (1 - t)[None, :] + g[i1][:, i1] * t[None, :]
    return a * (1 - t)[:, None] + b * t[:, None]


class PNoise:
    """Бесшовный шум, который можно брать в произвольных точках (x, y в долях кадра) — для искажения координат."""

    def __init__(self, rng, period):
        self.P = period
        self.g = rng.random((period, period)).astype(np.float32)

    def at(self, x, y):
        P = self.P
        X = x * P
        Y = y * P
        x0 = np.floor(X).astype(int)
        y0 = np.floor(Y).astype(int)
        tx = X - x0
        ty = Y - y0
        tx = tx * tx * (3 - 2 * tx)
        ty = ty * ty * (3 - 2 * ty)
        x0 %= P
        y0 %= P
        x1 = (x0 + 1) % P
        y1 = (y0 + 1) % P
        g = self.g
        a = g[y0, x0] * (1 - tx) + g[y0, x1] * tx
        b = g[y1, x0] * (1 - tx) + g[y1, x1] * tx
        return a * (1 - ty) + b * ty


def pfbm(rng, x, y, base, octaves, gain=0.5, ridge=False):
    out = np.zeros_like(x)
    amp, tot, p = 1.0, 0.0, base
    for _ in range(octaves):
        v = PNoise(rng, p).at(x, y)
        if ridge:
            v = (1 - np.abs(v * 2 - 1)) ** 2
        out += v * amp
        tot += amp
        amp *= gain
        p *= 2
    return out / tot


def pvoronoi_edges(rng, x, y, count):
    """Расстояние до границы ячеек (F2 − F1) в произвольных точках на торе."""
    pts = rng.random((count, 2)).astype(np.float32)
    d1 = np.full(x.shape, 9.0, np.float32)
    d2 = np.full(x.shape, 9.0, np.float32)
    for px, py in pts:
        dx = np.abs(x % 1.0 - px)
        dy = np.abs(y % 1.0 - py)
        dx = np.minimum(dx, 1 - dx)
        dy = np.minimum(dy, 1 - dy)
        d = np.sqrt(dx * dx + dy * dy)
        closer = d < d1
        d2 = np.where(closer, d1, np.minimum(d2, d))
        d1 = np.where(closer, d, d1)
    return d2 - d1


def fbm(n, base, octaves, rng, gain=0.5):
    out = np.zeros((n, n), np.float32)
    amp, tot = 1.0, 0.0
    p = base
    for _ in range(octaves):
        if p > n:
            break
        out += value_noise(n, p, rng) * amp
        tot += amp
        amp *= gain
        p *= 2
    return out / tot


def ridged(n, base, octaves, rng):
    """«Хребты» шума — трещины и прожилки (1 на линии, 0 вдали)."""
    out = np.zeros((n, n), np.float32)
    amp, tot, p = 1.0, 0.0, base
    for _ in range(octaves):
        if p > n:
            break
        v = 1 - np.abs(value_noise(n, p, rng) * 2 - 1)
        out += v ** 4 * amp
        tot += amp
        amp *= 0.5
        p *= 2
    return out / tot


def voronoi(n, count, rng, jitter=1.0, aspect=(1.0, 1.0)):
    """Ячейки на торе: (d1, d2, id) — расстояние до ближайшей и второй точки (в долях кадра), номер ячейки."""
    pts = rng.random((count, 2)).astype(np.float32)
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32) / n
    d1 = np.full((n, n), 9.0, np.float32)
    d2 = np.full((n, n), 9.0, np.float32)
    ids = np.zeros((n, n), np.int32)
    for k, (px, py) in enumerate(pts):
        dx = np.abs(xs - px)
        dy = np.abs(ys - py)
        dx = np.minimum(dx, 1 - dx) * aspect[0]
        dy = np.minimum(dy, 1 - dy) * aspect[1]
        d = np.sqrt(dx * dx + dy * dy)
        closer = d < d1
        d2 = np.where(closer, d1, np.minimum(d2, d))
        ids = np.where(closer, k, ids)
        d1 = np.where(closer, d, d1)
    return d1, d2, ids


def blur(a, r=1):
    for _ in range(r):
        a = (a + np.roll(a, 1, 0) + np.roll(a, -1, 0) + np.roll(a, 1, 1) + np.roll(a, -1, 1)) / 5
    return a


def norm01(a):
    lo, hi = np.percentile(a, 1), np.percentile(a, 99)
    return np.clip((a - lo) / max(1e-6, hi - lo), 0, 1)


def hexc(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)


def ramp(t, stops):
    """Цвет по градиенту: stops — [(t, '#hex'), ...]."""
    t = np.clip(t, 0, 1)
    out = np.zeros(t.shape + (3,), np.float32)
    for (t0, c0), (t1, c1) in zip(stops[:-1], stops[1:]):
        m = (t >= t0) & (t <= t1)
        k = ((t - t0) / max(1e-6, t1 - t0))[..., None]
        out = np.where(m[..., None], hexc(c0) * (1 - k) + hexc(c1) * k, out)
    return out


def normal_from_height(h, strength):
    """Нормаль (OpenGL, +Y вверх в текстуре) из высоты 0..1; бесшовно."""
    n = h.shape[0]
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * n / 256 * strength
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * n / 256 * strength
    nx, ny, nz = -gx, gy, np.ones_like(h)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / l, ny / l, nz / l], -1) * 0.5 + 0.5


# ---------------------------------------------------------------------------
# Материалы. Каждая функция → (albedo sRGB 0..1 [n,n,3], height 0..1, rough 0..1).


def mat_rock(n, rng):
    """Влажная тёмная порода пещеры: искажённые гребни, сеть тонких трещин (две шкалы), пласты,
    светлые выпуклые кромки и тёмные впадины, минеральные вкрапления, мелкое зерно."""
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32) / n
    # искажение координат — порода «течёт», без ватных пятен
    wx = xs + 0.18 * (pfbm(rng, xs, ys, 3, 4) - 0.5)
    wy = ys + 0.18 * (pfbm(rng, xs + 0.37, ys + 0.71, 3, 4) - 0.5)
    ridges = pfbm(rng, wx, wy, 4, 6, ridge=True)
    mass = pfbm(rng, wx, wy, 2, 5)
    strata = np.sin((wy * 11 + mass * 1.8) * np.pi * 2) * 0.5 + 0.5
    # трещины: тонкие границы ячеек по искажённым координатам, крупные и мелкие
    c1 = pvoronoi_edges(rng, wx, wy, 14)
    c2 = pvoronoi_edges(rng, wx * 1.0 + 0.13, wy * 1.0 + 0.29, 60)
    crack = np.clip(1 - c1 / 0.012, 0, 1) * 0.9 + np.clip(1 - c2 / 0.006, 0, 1) * 0.5
    crack *= np.clip(pfbm(rng, xs, ys, 6, 3) * 2 - 0.4, 0, 1)  # трещины рвутся, не сплошная сетка
    grain = pfbm(rng, xs, ys, 128, 3)
    pores = np.clip((pfbm(rng, xs, ys, 256, 2) - 0.68) * 6, 0, 1)
    h = 0.45 * ridges + 0.25 * mass + 0.08 * strata + 0.12 * grain - 0.35 * np.clip(crack, 0, 1) - 0.06 * pores
    h = norm01(h)
    cav = norm01(h - blur(h, 6))  # выпуклость (кромки) vs впадины
    tone = norm01(0.5 * mass + 0.3 * ridges + 0.2 * grain)
    col = ramp(tone, [(0, "#0d0e10"), (0.35, "#1d1f22"), (0.7, "#30333a"), (1, "#4a4d52")])
    warm = np.clip((pfbm(rng, xs, ys, 4, 4) - 0.55) * 3, 0, 1) * 0.35  # охристые потёки железа
    col = col * (1 - warm[..., None]) + hexc("#4a3a2b") * warm[..., None]
    col *= (0.7 + 0.6 * cav)[..., None]  # кромки светлее, впадины темнее
    col *= (1 - np.clip(crack, 0, 1) * 0.75)[..., None]
    speck = np.clip((pfbm(rng, xs, ys, 256, 2) - 0.7) * 8, 0, 1)
    col = col * (1 - speck[..., None] * 0.5) + hexc("#8b9196") * speck[..., None] * 0.5
    col *= (0.9 + 0.2 * (grain - 0.5))[..., None]
    wet = np.clip((pfbm(rng, xs, ys, 3, 4) - 0.5) * 2.5, 0, 1)
    col *= (1 - wet * 0.2)[..., None]
    rough = np.clip(0.9 - wet * 0.45 + (grain - 0.5) * 0.25 - cav * 0.1, 0.25, 1)
    return col, h, rough


def detail_map(n, rng):
    """Детальная карта Babylon (StandardMaterial.detailMap): R — яркость (0.5 нейтр.), G — нормаль Y,
    B — шероховатость (0.5 нейтр.), A — нормаль X. Мелкий рельеф камня для взгляда вплотную."""
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32) / n
    h = 0.6 * pfbm(rng, xs, ys, 16, 4, ridge=True) + 0.4 * pfbm(rng, xs, ys, 64, 3)
    e = pvoronoi_edges(rng, xs, ys, 40)
    h -= np.clip(1 - e / 0.01, 0, 1) * 0.35
    h = norm01(h)
    nm = normal_from_height(h, 5.0)
    out = np.zeros((n, n, 4), np.float32)
    out[..., 0] = 0.5 + (h - 0.5) * 0.35
    out[..., 1] = nm[..., 1]
    out[..., 2] = 0.5 + (0.5 - h) * 0.2
    out[..., 3] = nm[..., 0]
    return out


def mat_masonry(n, rng):
    """Старая кладка древних сооружений: ряды тёсаных блоков разной длины, сколы кромок, швы, износ."""
    rows = 4
    rh = n / rows
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    chips = fbm(n, 32, 4, rng)
    wear = fbm(n, 8, 6, rng)
    grain = fbm(n, 128, 3, rng)
    edge_d = np.zeros((n, n), np.float32)
    tint = np.zeros((n, n), np.float32)
    for r in range(rows):
        y0, y1 = r * rh, (r + 1) * rh
        m_y = (ys >= y0) & (ys < y1)
        # границы блоков по x в ряду: случайные длины, ряд — замкнутое кольцо длиной n
        cuts = [0.0]
        while cuts[-1] < n:
            cuts.append(cuts[-1] + rh * (1.3 + rng.random() * 1.3))
        cuts[-1] = n
        if cuts[-1] - cuts[-2] < rh * 0.7 and len(cuts) > 2:
            cuts.pop(-2)
        cuts = np.array(cuts, np.float32)
        shift = rng.random() * n
        xr = (xs + shift) % n
        k = np.clip(np.searchsorted(cuts, xr, side="right") - 1, 0, len(cuts) - 2)
        ex = np.minimum(xr - cuts[k], cuts[k + 1] - xr)
        ey = np.minimum(ys - y0, y1 - ys)
        e = np.minimum(ex, ey)
        edge_d = np.where(m_y, e, edge_d)
        tints = rng.random(len(cuts)).astype(np.float32)
        tint = np.where(m_y, tints[k], tint)
    bevel = np.clip(edge_d / (rh * 0.07) + (chips - 0.5) * 1.8, 0, 1)
    h = norm01(0.25 + 0.6 * bevel * (0.85 + 0.15 * wear) + grain * 0.06 - (chips > 0.72) * bevel * 0.12)
    tone = np.clip(0.5 * tint + 0.35 * wear + 0.15 * grain, 0, 1)
    # Тёмный серый гранит (решение пользователя 2026-10-12): холоднее и темнее, с зернистой «солью».
    col = ramp(tone, [(0, "#1c1d20"), (0.5, "#2d2f33"), (1, "#42454a")])
    salt = np.clip((fbm(n, 256, 2, rng) - 0.66) * 6, 0, 1)
    col = col * (1 - salt[..., None] * 0.35) + hexc("#8d9093") * salt[..., None] * 0.35
    mortar = bevel < 0.15
    col = np.where(mortar[..., None], hexc("#16171a"), col)
    dirt = np.clip((fbm(n, 4, 5, rng) - 0.55) * 2.2, 0, 1)
    moss = np.clip((fbm(n, 12, 4, rng) - 0.7) * 3, 0, 1) * (1 - bevel * 0.5)
    col *= (1 - dirt * 0.28)[..., None]
    col = col * (1 - moss[..., None] * 0.4) + hexc("#353f26") * moss[..., None] * 0.4
    col *= (0.78 + 0.22 * h)[..., None]
    col *= (0.93 + 0.14 * (grain - 0.5))[..., None]
    rough = np.clip(0.9 + (grain - 0.5) * 0.15 - dirt * 0.1, 0.5, 1)
    return col, h, rough


def mat_flagstone(n, rng):
    """Пол из каменных плит неправильной формы: скруглённые кромки, тонкие трещины, стёртость, грязь в швах."""
    cnt = 20
    d1, d2, ids = voronoi(n, cnt, rng)
    gap = d2 - d1
    slab = np.clip(gap * n / 10 + (fbm(n, 32, 4, rng) - 0.5) * 0.8, 0, 1)  # ~10 px кромка
    rnd = rng.random(cnt).astype(np.float32)
    t = rnd[ids]
    wear = fbm(n, 8, 6, rng)
    grain = fbm(n, 128, 3, rng)
    crack = np.clip((ridged(n, 6, 5, rng) - 0.78) * 7, 0, 1) * (rnd[ids] > 0.5)
    h = norm01(slab * (0.88 + 0.12 * wear) - crack * 0.3 + grain * 0.07 + (t - 0.5) * 0.08 * slab)
    col = ramp(np.clip(0.5 * t + 0.35 * wear + 0.15 * grain, 0, 1), [(0, "#1e1d1c"), (0.5, "#302e2c"), (1, "#45413d")])
    col = np.where((slab < 0.2)[..., None], hexc("#1d1b18"), col)
    col *= (1 - crack * 0.5)[..., None]
    col *= (0.8 + 0.2 * h)[..., None]
    col *= (0.93 + 0.14 * (grain - 0.5))[..., None]
    rough = np.clip(0.85 + (grain - 0.5) * 0.2 - wear * 0.15, 0.4, 1)
    return col, h, rough


def mat_wood(n, rng):
    """Тёмное дерево мостов и опор: доски поперёк кадра, волокна, сучки, щели, гвозди."""
    planks = 4
    ph = n / planks
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    idx = np.minimum((ys // ph).astype(int), planks - 1)
    pr = rng.random(planks).astype(np.float32)
    off = rng.random(planks).astype(np.float32)
    grain = np.sin((ys / n * 70 + fbm(n, 8, 5, rng) * 5 + fbm(n, 2, 3, rng) * 3) * np.pi)
    streak = fbm(n, 64, 3, rng)
    fiber = fbm(n, 256, 2, rng)
    v = (ys % ph) / ph
    seam = np.clip(np.minimum(v, 1 - v) * ph / 3, 0, 1)
    h = norm01(0.55 * seam + 0.12 * grain + 0.1 * streak + 0.06 * fiber)
    tone = np.clip(0.35 * pr[idx] + 0.25 * (grain * 0.5 + 0.5) + 0.25 * streak + 0.15 * fiber, 0, 1)
    col = ramp(tone, [(0, "#24180f"), (0.5, "#3b2819"), (1, "#5a3d24")])
    # сучки
    for _ in range(5):
        cx, cy, r = rng.random() * n, rng.random() * n, n * (0.012 + rng.random() * 0.012)
        dx = np.minimum(np.abs(xs - cx), n - np.abs(xs - cx))
        dy = np.minimum(np.abs(ys - cy), n - np.abs(ys - cy))
        k = np.clip(1 - np.sqrt(dx * dx + dy * dy) / r, 0, 1)
        col *= (1 - k * 0.5)[..., None]
        h = h - k * 0.15
    # гвозди у концов досок
    for p in range(planks):
        for gx in (off[p] * n, (off[p] * n + n / 2) % n):
            cy = p * ph + ph / 2
            dx = np.minimum(np.abs(xs - gx), n - np.abs(xs - gx))
            dy = np.abs(ys - cy)
            k = np.clip(1 - np.sqrt(dx * dx + dy * dy) / (n * 0.006), 0, 1)
            col = col * (1 - k[..., None]) + hexc("#1a1a1c") * k[..., None]
            h = h + k * 0.25
    col *= (0.55 + 0.45 * seam)[..., None]
    rough = np.clip(0.78 + streak * 0.15, 0.5, 1)
    return col, norm01(h), rough


def mat_metal(n, rng):
    """Металл решёток и креплений: тёмное кованое железо, молотковые вмятины, ржавчина пятнами и в углах."""
    ham = fbm(n, 16, 6, rng)
    d1, d2, _ = voronoi(n, 60, rng)
    dents = norm01(d1)
    rust = np.clip((fbm(n, 8, 6, rng) - 0.5) * 3, 0, 1) * np.clip((fbm(n, 64, 3, rng) - 0.3) * 2, 0, 1)
    pits = np.clip((fbm(n, 128, 3, rng) - 0.6) * 4, 0, 1) * rust
    h = norm01(0.6 * dents + 0.3 * ham - 0.2 * pits)
    iron = ramp(ham, [(0, "#1b1c1f"), (1, "#3a3b3f")])
    rc = ramp(fbm(n, 24, 3, rng), [(0, "#4a2614"), (0.6, "#7a3f1c"), (1, "#9a5a2a")])
    col = iron * (1 - rust[..., None]) + rc * rust[..., None]
    rough = np.clip(0.45 + rust * 0.5 + ham * 0.1, 0.3, 1)
    return col, h, rough


def mat_cloth(n, rng):
    """Старая ткань баннеров: плетение, выцветание, грязь, потёртости (цвет — белёсый, красится в игре)."""
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    f = n / 8  # нитей на кадр — n/8 (на 1024 — 128)
    warp = np.sin(xs / n * np.pi * 2 * f) * 0.5 + 0.5
    weft = np.sin(ys / n * np.pi * 2 * f) * 0.5 + 0.5
    weave = np.where((np.floor(xs / n * f) + np.floor(ys / n * f)) % 2 == 0, warp, weft)
    fade = fbm(n, 6, 6, rng)
    dirt = np.clip((fbm(n, 10, 5, rng) - 0.5) * 2, 0, 1)
    h = norm01(weave * 0.6 + fade * 0.4)
    col = ramp(fade, [(0, "#b8ada0"), (1, "#e6ded2")])
    col *= (1 - dirt * 0.35)[..., None]
    col *= (0.9 + 0.1 * weave)[..., None]
    rough = np.full((n, n), 0.95, np.float32)
    return col, h, rough


def mat_water(n, rng):
    """Рябь воды: сумма бегущих волн (целые частоты — бесшовно) и мелкой зыби. Нужна карта нормалей."""
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32) / n
    h = np.zeros((n, n), np.float32)
    for _ in range(9):
        kx, ky = int(rng.integers(-6, 7)), int(rng.integers(-6, 7))
        if kx == 0 and ky == 0:
            continue
        ph = rng.random() * 6.283
        h += np.sin((xs * kx + ys * ky) * 6.283 + ph) / np.hypot(kx, ky)
    h = norm01(h) * 0.7 + pfbm(rng, xs, ys, 16, 3) * 0.3
    col = np.zeros((n, n, 3), np.float32) + hexc("#0b1a22")
    return col, norm01(h), np.full((n, n), 0.1, np.float32)


def pebbles(rng, xs, ys, count, size):
    """Галька: выпуклые камешки (купола в ячейках), возвращает (высота, маска)."""
    pts = rng.random((count, 2)).astype(np.float32)
    rad = (size * (0.5 + rng.random(count))).astype(np.float32)
    h = np.zeros_like(xs)
    for (px, py), r in zip(pts, rad):
        dx = np.abs(xs - px)
        dy = np.abs(ys - py)
        dx = np.minimum(dx, 1 - dx)
        dy = np.minimum(dy, 1 - dy)
        d = np.sqrt(dx * dx + dy * dy) / r
        h = np.maximum(h, np.sqrt(np.clip(1 - d * d, 0, 1)))
    return h


def mat_cavefloor(n, rng):
    """Пол пещеры: неровная порода (бугры, сколы), галька и щебень, песок/ил в низинах, мокрые пятна."""
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32) / n
    wx = xs + 0.12 * (pfbm(rng, xs, ys, 3, 4) - 0.5)
    wy = ys + 0.12 * (pfbm(rng, xs + 0.4, ys + 0.2, 3, 4) - 0.5)
    rock = pfbm(rng, wx, wy, 4, 6, ridge=True) * 0.6 + pfbm(rng, wx, wy, 8, 5) * 0.4
    crack = np.clip(1 - pvoronoi_edges(rng, wx, wy, 18) / 0.01, 0, 1) * np.clip(pfbm(rng, xs, ys, 5, 3) * 2 - 0.5, 0, 1)
    low = pfbm(rng, xs, ys, 3, 4)
    sand = np.clip((0.45 - low) * 4, 0, 1)  # низины засыпаны песком/илом
    peb = pebbles(rng, xs, ys, 420, 0.009) * np.clip(sand * 1.5 + 0.1, 0, 1)
    grain = pfbm(rng, xs, ys, 256, 2)
    h = norm01(rock * (1 - sand * 0.7) + sand * 0.15 + peb * 0.35 - crack * 0.3 + grain * 0.05)
    col = ramp(norm01(rock + grain * 0.3), [(0, "#121315"), (0.5, "#24262a"), (1, "#3b3e44")])
    sandc = ramp(pfbm(rng, xs, ys, 64, 3), [(0, "#2a2620"), (1, "#3d382f")])
    col = col * (1 - sand[..., None]) + sandc * sand[..., None]
    pebc = ramp(pfbm(rng, xs, ys, 32, 2), [(0, "#1d1e21"), (1, "#383a3e")])
    pm = np.clip(peb * 3, 0, 1)
    col = col * (1 - pm[..., None]) + pebc * pm[..., None] * (0.7 + 0.3 * peb[..., None])
    col *= (1 - crack * 0.6)[..., None]
    wet = np.clip((pfbm(rng, xs, ys, 4, 4) - 0.55) * 3, 0, 1) * (1 - peb)
    col *= (1 - wet * 0.35)[..., None]
    rough = np.clip(0.9 - wet * 0.7 - sand * 0.0 + (grain - 0.5) * 0.2, 0.15, 1)
    return col, h, rough


def mat_ruinfloor(n, rng):
    """Пол руин: крупные стёртые плиты, края скруглены и сколоты, швы и пятна засыпаны грунтом и щебнем."""
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32) / n
    wx = xs + 0.04 * (pfbm(rng, xs, ys, 4, 3) - 0.5)
    wy = ys + 0.04 * (pfbm(rng, xs + 0.3, ys, 4, 3) - 0.5)
    # плиты: прямоугольники разных размеров (ряды со сдвигом) — по искажённым координатам
    rows = 3
    ry = wy * rows
    row = np.floor(ry).astype(int) % rows
    shift = rng.random(rows).astype(np.float32)
    cols_n = np.array([2, 3, 2])[row]
    rx = (wx + shift[row]) % 1.0 * cols_n
    fx = rx - np.floor(rx)
    fy = ry - np.floor(ry)
    edge = np.minimum(np.minimum(fx, 1 - fx) / cols_n * rows, np.minimum(fy, 1 - fy))
    tid = (np.floor(rx) + row * 7).astype(int)
    tint = rng.random(64).astype(np.float32)[tid % 64]
    wear = pfbm(rng, xs, ys, 6, 5)
    chip = pfbm(rng, xs, ys, 24, 4)
    slab = np.clip(edge * 14 - 0.15 + (chip - 0.5) * 1.2, 0, 1)
    dirt = np.clip((0.42 - pfbm(rng, xs, ys, 4, 4)) * 4, 0, 1)  # участки, засыпанные грунтом
    peb = pebbles(rng, xs, ys, 180, 0.01) * np.clip((1 - slab) + dirt, 0, 1)
    crack = np.clip(1 - pvoronoi_edges(rng, wx, wy, 30) / 0.006, 0, 1) * (tint > 0.5)
    grain = pfbm(rng, xs, ys, 256, 2)
    h = norm01(slab * (0.85 + 0.15 * wear) * (1 - dirt * 0.6) + dirt * 0.25 + peb * 0.3 - crack * 0.25 + grain * 0.06)
    col = ramp(np.clip(0.5 * tint + 0.35 * wear + 0.15 * grain, 0, 1), [(0, "#1b1b1c"), (0.5, "#2c2b2a"), (1, "#3f3d3a")])
    gap = np.clip(1 - slab * 1.5, 0, 1)
    dirtc = ramp(pfbm(rng, xs, ys, 48, 3), [(0, "#1e1b17"), (1, "#2f2a23")])
    dm = np.clip(gap + dirt, 0, 1)
    col = col * (1 - dm[..., None]) + dirtc * dm[..., None]
    pm = np.clip(peb * 3, 0, 1)
    col = col * (1 - pm[..., None]) + hexc("#45464a") * pm[..., None] * (0.6 + 0.4 * peb[..., None])
    col *= (1 - crack * 0.6)[..., None]
    rough = np.clip(0.85 + (grain - 0.5) * 0.2 - wear * 0.2, 0.3, 1)
    return col, h, rough


MATS = {
    "rock": (mat_rock, 11, 4.5),
    "masonry": (mat_masonry, 12, 2.6),
    "flagstone": (mat_flagstone, 13, 2.2),
    "wood": (mat_wood, 14, 2.0),
    "metal": (mat_metal, 15, 1.6),
    "cloth": (mat_cloth, 16, 0.8),
    "water": (mat_water, 17, 2.5),
    "cavefloor": (mat_cavefloor, 18, 4.0),
    "ruinfloor": (mat_ruinfloor, 19, 3.5),
}


def flatten_low(col, keep=6):
    """Убрать из цвета крупные пятна (размером с кадр и его половину/треть): они повторяются на больших
    площадях «плиткой». Делим на сглаженную яркость (низкие частоты через БПФ на торе — бесшовно);
    крупную вариацию тона в игре даёт цвет вершин."""
    n = col.shape[0]
    lum = col.mean(-1)
    F = np.fft.fft2(lum)
    fy = np.fft.fftfreq(n)[:, None] * n
    fx = np.fft.fftfreq(n)[None, :] * n
    low = np.real(np.fft.ifft2(F * (np.hypot(fx, fy) < keep)))
    k = lum.mean() / np.maximum(low, 1e-3)
    return np.clip(col * k[..., None], 0, 1)


def save(out_dir, name, col, h, rough, strength):
    n = col.shape[0]
    srgb = np.clip(col, 0, 1)
    Image.fromarray((srgb * 255).astype(np.uint8)).save(os.path.join(out_dir, f"{name}_c.jpg"), quality=88)
    nm = normal_from_height(h, strength)
    Image.fromarray((nm * 255).astype(np.uint8)).save(os.path.join(out_dir, f"{name}_n.jpg"), quality=92)
    Image.fromarray((np.clip(rough, 0, 1) * 255).astype(np.uint8)).save(os.path.join(out_dir, f"{name}_r.jpg"), quality=88)
    return (srgb * 255).astype(np.uint8), (nm * 255).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out", nargs="?", default="public/textures/dungeon")
    ap.add_argument("--size", type=int, default=1024)
    ap.add_argument("--only", default="")
    ap.add_argument("--sheet", default="")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    names = [x for x in a.only.split(",") if x and x != "detail"] or ([] if a.only == "detail" else list(MATS))
    tiles = []
    for name in names:
        fn, seed, strength = MATS[name]
        rng = np.random.default_rng(seed)
        col, h, rough = fn(a.size, rng)
        if name in ("rock", "masonry", "flagstone", "cavefloor", "ruinfloor"):
            col = flatten_low(col)
            # и в рельефе — без крупных «холмов» на весь кадр
            hl = np.real(np.fft.ifft2(np.fft.fft2(h) * (np.hypot(np.fft.fftfreq(a.size)[None, :] * a.size, np.fft.fftfreq(a.size)[:, None] * a.size) < 4)))
            h = norm01(h - hl * 0.85)
        c, nm = save(a.out, name, col, h, rough, strength)
        tiles.append((name, c, nm))
        print(f"{name}: ok", file=sys.stderr)
    if not a.only or "detail" in a.only:
        d = detail_map(512, np.random.default_rng(21))
        Image.fromarray((np.clip(d, 0, 1) * 255).astype(np.uint8), "RGBA").save(os.path.join(a.out, "rock_detail.png"))
        print("detail: ok", file=sys.stderr)
    if a.sheet:
        # Лист: на каждый материал — цвет 2×2 (видно, что бесшовно) и нормаль.
        t = 384
        sheet = Image.new("RGB", (t * 3, t * len(tiles) + 0), (14, 16, 22))
        d = ImageDraw.Draw(sheet)
        for i, (name, c, nm) in enumerate(tiles):
            tile2 = np.concatenate([np.concatenate([c, c], 1), np.concatenate([c, c], 1)], 0)
            sheet.paste(Image.fromarray(tile2).resize((t * 2, t)), (0, i * t))
            sheet.paste(Image.fromarray(nm).resize((t, t)), (t * 2, i * t))
            d.rectangle([4, i * t + 4, 150, i * t + 26], fill=(0, 0, 0))
            d.text((10, i * t + 8), name, fill=(255, 255, 255))
        sheet.save(a.sheet)


if __name__ == "__main__":
    main()
