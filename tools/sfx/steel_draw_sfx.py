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
    """Сбор стягивания (звучит весь подход мобов, 0.45 с): шелест цепи, нарастающий, без свиста — полоса
    низкая, верх срезан. В пике (0.44 с) — глухой толчок. После пика шелест гаснет."""
    sec = 0.7
    n = int(sec * SR)
    t = t_axis(sec)
    grow = np.clip(t / 0.45, 0, 1)
    fade = np.exp(-np.clip(t - 0.45, 0, None) * 9)
    x = band(noise(sec), 180, 900) * (0.2 + 0.8 * grow ** 2) * fade * 0.7
    x += clicks(n, np.sort(rng.random(60) ** 1.3 * 0.6), 900, 3500, 0.2)  # звенья цепи
    x += thump(n, 0.44, 80, 40, 0.3, 0.6)
    x += band(noise(sec), 60, 400) * env(n, 0.02, 0.2, 0.4) * 0.35
    x = band(x, 40, 2000)
    return finish(reverb(x, 0.6, 0.18))


def draw_pull():
    """Металл тянется по воздуху: низкий шелест звеньев с нарастанием и спадом, редкие мягкие щелчки.
    Без свиста: свист — это полоса, ведущая частоту вниз; здесь полоса низкая и ровная."""
    sec = 0.34
    n = int(sec * SR)
    t = t_axis(sec)
    env_ = np.sin(np.pi * np.clip(t / sec, 0, 1)) ** 1.5  # мягко вверх и вниз
    x = band(noise(sec), 180, 900) * env_ * 0.6
    x += clicks(n, np.sort(rng.random(12) * sec), 900, 2600, 0.12)  # звенья, не визг
    x = band(x, 120, 2400)
    return finish(reverb(x, 0.3, 0.12), 0.7)


def draw_impact():
    """Удар о землю (конец стягивания): глухой толчок, короткий треск и отчётливый, но недолгий звон стали."""
    sec = 1.1
    n = int(sec * SR)
    x = thump(n, 0, 80, 34, 0.45, 1.0)
    x += band(noise(sec), 60, 450) * env(n, 0.002, 0.22) * 0.7
    x += band(noise(sec), 1200, 4000) * env(n, 0.0008, 0.04) * 0.45
    for f, a in ((1480, 0.16), (2220, 0.09), (3330, 0.05)):
        x += ping(n, 0.0, f * rng.uniform(0.99, 1.01), 0.45, a, ((1.0, 1.0), (2.4, 0.25)))
    x += tinkles(n, 0.02, 0.5, 30, 2600, 8000, 0.05, (0.03, 0.12), 2.0)
    return finish(reverb(x, 0.8, 0.2))


SOUNDS = {
    "steel-draw-start": (draw_start, False),
    "steel-draw-pull": (draw_pull, False),
    "steel-draw-impact": (draw_impact, False),
}

if __name__ == "__main__":
    run(SOUNDS)
