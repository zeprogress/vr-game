"""
Звуки катакомбных боссов и ловушек — синтез на sfxlib (образец — hero_skills_sfx.py). WAV, моно.
Имена hero-cat-*.wav — их грузит Sfx.ts вместе со звуками умений (HERO_SFX).
Запуск: python3 tools/sfx/catacomb_sfx.py public/sfx [имя,имя]
"""
import numpy as np

from sfxlib import (SR, band, clicks, env, finish, noise, ping, reseed, reverb, rng, run, sine_sweep, t_axis,
                    thump)

reseed(20261031)


def add(out, sig, at=0.0):
    i0 = int(at * SR)
    if i0 >= len(out):
        return out
    L = min(len(sig), len(out) - i0)
    out[i0:i0 + L] += sig[:L]
    return out


def blank(sec):
    return np.zeros(int(sec * SR))


def cat_charge():
    """Страж встаёт (1.2 с): низкий гул растёт, в нём дрожь и шорох камня, без удара."""
    sec = 1.2
    n = int(sec * SR)
    t = t_axis(sec)
    f = 55 * (110 / 55) ** (t / sec)
    phase = 2 * np.pi * np.cumsum(f) / SR
    body = sum((1 / k) * np.sin(k * phase) for k in range(1, 5)) * 0.35 * (0.8 + 0.2 * np.sin(2 * np.pi * 6 * t))
    x = body * env(n, 0.8, 0.4) * 0.8
    x = add(x, band(noise(sec), 200, 800) * env(n, 0.9, 0.3) * 0.12)
    return finish(reverb(x, 1.0, 0.2))


def cat_slam():
    """Удар стража о камень (1.0 с): тяжёлый толчок, треск плиты и осыпь щебня."""
    sec = 1.0
    n = int(sec * SR)
    x = blank(sec)
    x = add(x, thump(n, 0.0, 90, 28, 0.45, 0.9))
    x = add(x, band(noise(0.06), 1800, 3500) * env(int(0.06 * SR), 0.001, 0.03) * 0.5)
    x = add(x, clicks(n, np.sort(rng.random(20) ** 1.4 * 0.45), 600, 3500, 0.25))
    return finish(reverb(x, 0.7, 0.15))


def cat_rockfall():
    """Обвал (1.4 с): камни сыплются со свода — частые щелчки, три глухих удара и долгая пыль."""
    sec = 1.4
    n = int(sec * SR)
    x = blank(sec)
    x = add(x, clicks(n, np.sort(rng.random(40) * 0.9), 400, 3000, 0.3))
    for at in (0.25, 0.55, 0.8):
        x = add(x, thump(n, at, 120, 45, 0.12, 0.5), 0.0)
    x = add(x, band(noise(1.2), 300, 2000) * env(int(1.2 * SR), 0.05, 0.9) * 0.15)
    return finish(reverb(x, 0.8, 0.2))


def cat_crystal():
    """Лунный кристалл разбивается (1.2 с): сверкающий звон осколков и короткий удар."""
    sec = 1.2
    n = int(sec * SR)
    x = blank(sec)
    for _ in range(14):
        at = rng.random() ** 1.5 * 0.7
        x = add(x, ping(n, at, rng.uniform(2500, 6500), 0.4, 0.09))
    x = add(x, thump(n, 0.0, 160, 60, 0.06, 0.4))
    return finish(reverb(x, 1.0, 0.25))


def cat_soul():
    """Гейзер душ (1.8 с): протяжный вой с дрожью, поднимается и срывается, под ним удар."""
    sec = 1.8
    n = int(sec * SR)
    t = t_axis(sec)
    f = 300 + 180 * np.sin(np.pi * t / sec) + 12 * np.sin(2 * np.pi * 5 * t)
    phase = 2 * np.pi * np.cumsum(f) / SR
    wail = sum((1 / k) * np.sin(k * phase) for k in range(1, 4)) * 0.3
    x = wail * env(n, 0.3, 1.0) * 0.8
    x = add(x, band(noise(sec), 800, 2200) * env(n, 0.4, 1.2) * 0.1)
    x = add(x, thump(n, 0.0, 70, 30, 0.35, 0.6))
    return finish(reverb(x, 1.4, 0.3))


def cat_gate():
    """Каменные ворота (1.6 с): скрежет плиты — полоса шума модулируется, в конце глухой стук."""
    sec = 1.6
    n = int(sec * SR)
    t = t_axis(sec)
    grind = band(noise(sec), 150, 700) * (0.5 + 0.5 * np.sign(np.sin(2 * np.pi * 9 * t)))
    x = grind * env(n, 0.1, 1.0) * 0.4
    x = add(x, thump(n, sec - 0.35, 80, 35, 0.25, 0.7))
    return finish(reverb(x, 1.0, 0.2))


def cat_shield():
    """Печать-щит (1.0 с): гул барьера с мерцанием и шипящий пробой по куполу."""
    sec = 1.0
    n = int(sec * SR)
    t = t_axis(sec)
    hum = (np.sin(2 * np.pi * 220 * t) + 0.5 * np.sin(2 * np.pi * 330 * t)) / 1.5
    x = hum * (0.7 + 0.3 * np.sin(2 * np.pi * 8 * t)) * env(n, 0.05, 0.8) * 0.25
    x = add(x, band(noise(0.25), 3000, 7000) * env(int(0.25 * SR), 0.005, 0.2) * 0.15)
    x = add(x, ping(n, 0.0, 1320, 0.5, 0.12))
    return finish(reverb(x, 0.9, 0.3))


def cat_chest():
    """Сундук стража (1.2 с): скрип петель, звон монет и тяжёлая крышка."""
    sec = 1.2
    n = int(sec * SR)
    t = t_axis(sec)
    creak = band(noise(sec), 400, 1000) * (0.5 + 0.5 * np.sin(2 * np.pi * 3 * t))
    x = creak * env(n, 0.2, 0.6) * 0.25
    for at in (0.5, 0.6, 0.66, 0.72):
        x = add(x, ping(n, at, rng.uniform(3000, 5000), 0.2, 0.09))
    x = add(x, thump(n, 0.9, 100, 40, 0.15, 0.6))
    return finish(reverb(x, 0.7, 0.15))


SOUNDS = {
    "hero-cat-charge": (cat_charge, False),
    "hero-cat-slam": (cat_slam, False),
    "hero-cat-rockfall": (cat_rockfall, False),
    "hero-cat-crystal": (cat_crystal, False),
    "hero-cat-soul": (cat_soul, False),
    "hero-cat-gate": (cat_gate, False),
    "hero-cat-shield": (cat_shield, False),
    "hero-cat-chest": (cat_chest, False),
}

if __name__ == "__main__":
    run(SOUNDS)
