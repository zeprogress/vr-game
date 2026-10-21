"""
Звуки «Стягивания» воина (DRAW_IN, src/shared/drawIn.ts) — синтез на кирпичах tools/sfx/sfxlib.py. Образец —
ice_giant_sfx.py. Три короткие WAV (боевые — без MP3: сдвиг атаки):
  draw-start  — звон и скрежет цепей, всё громче и выше: сталь собирается в кулак (0 с — начало, пик 0.45 с);
  draw-pull   — короткий шорох металла, летящего по воздуху к точке (на группу мобов, не на каждого);
  draw-impact — удар сталью о землю: глухой толчок, лязг, осыпь звона.

Запуск: python3 tools/sfx/steel_draw_sfx.py public/sfx [имя,имя]
"""
import numpy as np

from sfxlib import (SR, band, clicks, env, finish, noise, ping, reseed, reverb, rng, run, sweep_band, t_axis,
                    thump, tinkles)

reseed(20261021)


def draw_start():
    """Скрежет цепей: нарастающий шорох с ростом тона, дрожь звеньев и тонкий звон в пике (0.45 с)."""
    sec = 0.7
    n = int(sec * SR)
    t = t_axis(sec)
    grow = np.clip(t / 0.45, 0, 1)
    x = sweep_band(noise(sec), 900 + 3200 * grow ** 1.5, 0.6) * (0.2 + 0.8 * grow ** 2) * 0.8
    x += clicks(n, np.sort(rng.random(60) ** 1.3 * 0.6), 2000, 8000, 0.28)  # звенья цепей
    for f, a in ((1760, 0.22), (2640, 0.14)):
        x += ping(n, 0.42, f * rng.uniform(0.99, 1.01), 0.55, a, ((1.0, 1.0), (2.76, 0.4)))
    x += thump(n, 0.44, 90, 45, 0.25, 0.5)
    return finish(reverb(x, 0.8, 0.2))


def draw_pull():
    """Металл летит по воздуху: короткий свист с падением тона и шорох звеньев."""
    sec = 0.32
    n = int(sec * SR)
    t = t_axis(sec)
    f0 = 2200 - 1400 * np.clip(t / sec, 0, 1)
    x = sweep_band(noise(sec), f0, 0.7) * np.exp(-((t - 0.12) / 0.14) ** 2) * 0.7
    x += clicks(n, np.sort(rng.random(14) * sec), 2500, 7500, 0.18)
    return finish(reverb(x, 0.35, 0.15), 0.8)


def draw_impact():
    """Сталь о землю: глухой толчок, лязг и осыпь звона."""
    sec = 1.1
    n = int(sec * SR)
    x = thump(n, 0, 80, 34, 0.45, 1.0)
    x += band(noise(sec), 1500, 7000) * env(n, 0.0008, 0.06) * 0.8
    for f, a in ((1480, 0.25), (2220, 0.18), (3330, 0.12)):
        x += ping(n, 0.0, f * rng.uniform(0.99, 1.01), 0.8, a, ((1.0, 1.0), (2.4, 0.3)))
    x += tinkles(n, 0.02, 0.8, 60, 2600, 9000, 0.1, (0.03, 0.12), 2.0)
    return finish(reverb(x, 1.0, 0.25))


SOUNDS = {
    "steel-draw-start": (draw_start, False),
    "steel-draw-pull": (draw_pull, False),
    "steel-draw-impact": (draw_impact, False),
}

if __name__ == "__main__":
    run(SOUNDS)
