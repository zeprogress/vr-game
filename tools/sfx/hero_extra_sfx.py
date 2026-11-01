"""
Недостающие звуки умений героев (ульты поддержки, молот боевого мага, исцеляющая стрела).
Сделаны на кирпичах tools/sfx/sfxlib.py в стиле hero_skills_sfx.py.

Запуск: python3 tools/sfx/hero_extra_sfx.py public/sfx
"""
import numpy as np

from sfxlib import SR, band, env, finish, noise, ping, reseed, reverb, run, sine_sweep, thump

reseed(20261102)


def ult_heal():
    """Ульта поддержки: тёплый хор-аккорд и восходящее сияние."""
    sec = 1.8
    n = int(sec * SR)
    out = np.zeros(n)
    for f, dt, amp in ((261.63, 0.0, 0.5), (329.63, 0.08, 0.42), (392.0, 0.16, 0.38), (523.25, 0.26, 0.3)):
        t = np.arange(n)/SR - dt
        e = np.where(t < 0, 0, np.exp(-np.maximum(t, 0) * 1.6))
        tone = np.sin(2*np.pi*f*t) + 0.35*np.sin(2*np.pi*f*2*t) + 0.15*np.sin(2*np.pi*f*3*t)
        out += amp * tone * e
    # сияние: шум с полосой вверх
    sh = band(noise(1.2), 1800, 5200) * env(int(1.2*SR), 0.35, 0.8)
    out[:len(sh)] += sh * 0.12
    out = reverb(out, 1.6, 0.3, 3200)
    return finish(out, 0.9, 0.08)


def ult_slow():
    """Ульта замедления: низкий гонг и ледяной звон."""
    sec = 1.6
    n = int(sec*SR)
    out = np.zeros(n)
    out += ping(n, 0.0, 98.0, 1.4, 0.7, partials=((1,1),(2.02,0.5),(3.1,0.3),(4.3,0.18)))
    out += ping(n, 0.12, 196.0, 1.0, 0.3)
    # ледяные искры
    z = band(noise(0.5), 2600, 7000) * env(int(0.5*SR), 0.01, 0.45)
    out[:len(z)] += z * 0.16
    out = reverb(out, 1.4, 0.25, 2800)
    return finish(out, 0.9, 0.08)


def hammer_wave():
    """Волна молота: тяжёлый замах и удар в землю с осыпью."""
    sec = 1.1
    n = int(sec*SR)
    out = np.zeros(n)
    # замах: шум-свист
    w = band(noise(0.35), 400, 1800) * env(int(0.35*SR), 0.12, 0.25)
    out[:len(w)] += w * 0.35
    # удар
    out += thump(n, 0.32, 90, 38, 0.5, 0.9)
    rock = band(noise(0.4), 900, 3600) * env(int(0.4*SR), 0.005, 0.35)
    i0 = int(0.32*SR)
    out[i0:i0+len(rock)] += rock * 0.35
    out = reverb(out, 1.0, 0.2, 2600)
    return finish(out, 0.92, 0.06)


def life_arrow():
    """Исцеляющая стрела: свист и мягкий звон исцеления."""
    sec = 1.0
    n = int(sec*SR)
    out = np.zeros(n)
    m = int(0.4*SR)
    out[:m] += (sine_sweep(m, 1400, 600) * env(m, 0.02, 0.3)) * 0.25
    out += ping(n, 0.32, 523.25, 0.7, 0.5, partials=((1,1),(2,0.4),(3,0.2)))
    out += ping(n, 0.40, 784.0, 0.6, 0.3)
    out = reverb(out, 1.1, 0.25, 3000)
    return finish(out, 0.9, 0.06)


run({
    "hero-ult-heal": (ult_heal, False),
    "hero-ult-slow": (ult_slow, False),
    "hero-hammer-wave": (hammer_wave, False),
    "hero-life-arrow": (life_arrow, False),
})
