"""
Звуки Ледяного гиганта — синтез (numpy, кирпичи — tools/sfx/sfxlib.py). Многослойно: низкий удар, хруст и
звон льда (затухающие негармоничные «динь»), шорох, рёв (из сэмпла пользователя ниже тоном; без него —
синтез пилой с формантами и хрипом), ревербация. Образец для новых существ (docs/pipelines/creatures.md).

Запуск: python3 tools/sfx/ice_giant_sfx.py public/sfx [имя,имя]
Пишет WAV 44.1 кГц моно (короткие боевые — WAV: MP3 сдвигает атаку), длинные (рёв, смерть) — MP3 через ffmpeg.
"""
import os

import numpy as np

from sfxlib import (SR, band, clicks, env, finish, load_audio, noise, ping, pitch, reseed, reverb, rng,
                    roar_voice, run, sweep_band, t_axis, thump, tinkles)

reseed(20261019)


# ---------------------------------------------------------------- звуки

def giant_step():
    sec = 0.9
    n = int(sec * SR)
    x = thump(n, 0, 72, 36, 0.38, 1.0)
    x += band(noise(sec), 30, 260) * env(n, 0.003, 0.2) * 0.9
    x += clicks(n, np.sort(rng.random(26) ** 1.6 * 0.13), 2500, 9500, 0.55)
    x += tinkles(n, 0.01, 0.25, 7, 2600, 7000, 0.07, (0.02, 0.07))
    return finish(reverb(x, 0.6, 0.18))


def giant_swipe():
    """Скрип льда в замахе → тяжёлый свист рассекаемого воздуха (пик на 0.55 с) → звон в хвосте."""
    sec = 1.15
    n = int(sec * SR)
    t = t_axis(sec)
    f0 = 220 + 900 * np.exp(-((t - 0.55) / 0.09) ** 2) + 120 * (t / sec)
    whoosh = sweep_band(noise(sec), f0, 0.9)
    amp = np.exp(-((t - 0.55) / 0.11) ** 2) * 1.0 + np.exp(-((t - 0.3) / 0.2) ** 2) * 0.15
    x = whoosh * amp
    x += band(noise(sec), 40, 180) * np.exp(-((t - 0.56) / 0.06) ** 2) * 0.8
    x += clicks(n, 0.05 + rng.random(14) * 0.35, 1500, 5000, 0.12)  # скрип суставов-кристаллов
    x += tinkles(n, 0.58, 0.5, 12, 3000, 8000, 0.06, (0.04, 0.12), 1.5)
    return finish(reverb(x, 0.8, 0.2))


def giant_slam():
    sec = 2.8
    n = int(sec * SR)
    x = thump(n, 0, 58, 26, 1.0, 1.0)
    x += band(noise(sec), 25, 420) * env(n, 0.002, 0.55) * 1.1
    x += band(noise(sec), 1200, 7000) * env(n, 0.001, 0.09) * 0.9  # треск
    x += clicks(n, np.sort(rng.random(60) ** 2.2 * 0.5), 1800, 9000, 0.5)
    x += tinkles(n, 0.03, 1.6, 140, 2000, 9000, 0.12, (0.03, 0.16), 2.6)
    x += band(noise(sec), 20, 120) * env(n, 0.05, 1.6) * 0.6  # рокот
    return finish(reverb(x, 1.8, 0.32))


def ice_spikes():
    """Шипы вырываются: нарастающий треск, «ш-шк» вверх по частоте, стеклянный звон."""
    sec = 1.5
    n = int(sec * SR)
    t = t_axis(sec)
    sh = sweep_band(noise(sec), 1800 + 5000 * np.clip(t / 0.18, 0, 1), 0.7) * env(n, 0.02, 0.35) * 0.8
    x = sh
    x += clicks(n, np.sort(rng.random(70) * 0.22), 1500, 9000, 0.45)
    for f, a in ((1240, 0.25), (1870, 0.2), (2630, 0.16), (3510, 0.12)):
        x += ping(n, 0.05, f * rng.uniform(0.97, 1.03), 0.7, a, ((1.0, 1.0), (2.3, 0.3)))
    x += thump(n, 0.0, 90, 45, 0.25, 0.6)
    x += tinkles(n, 0.15, 0.9, 30, 2500, 8000, 0.07, (0.03, 0.12), 2.0)
    return finish(reverb(x, 1.0, 0.25))


ROAR_SRC = "/Users/zep/ASSETS/SFX/phatphrogstudio-dragon-voice-roar-477831.mp3"


def roar_from_source(t0, t1, k, fade_in=0.05, fade_out=0.8):
    x = load_audio(ROAR_SRC)[int(t0 * SR):int(t1 * SR)]
    x = pitch(x, k)
    n = len(x)
    x *= np.clip(np.arange(n) / (fade_in * SR), 0, 1) * np.clip((n - np.arange(n)) / (fade_out * SR), 0, 1)
    # глубже и «холоднее»: чуть приглушить середину, добавить низ
    return band(x, 35, 6000) + band(x, 35, 220) * 0.6


def giant_roar_synth():
    sec = 2.5
    n = int(sec * SR)
    t = t_axis(sec)
    curve = lambda tt: 52 + 26 * np.clip(tt / 0.5, 0, 1) - 22 * np.clip((tt - 1.4) / 1.0, 0, 1)
    v = roar_voice(sec, curve, ((620, 0.35, 1.0), (1080, 0.3, 0.7), (2400, 0.25, 0.35), (180, 0.4, 0.6)))
    shape = np.clip(t / 0.3, 0, 1) ** 1.5 * np.clip((sec - t) / 0.7, 0, 1)
    x = v * shape
    wind = sweep_band(noise(sec), 700 + 900 * np.clip((t - 0.3) / 1.6, 0, 1), 0.5) * np.clip((t - 0.25) / 0.5, 0, 1) * np.clip((sec - t) / 0.6, 0, 1)
    x += wind * 0.35
    x += thump(n, 0.0, 60, 35, 0.6, 0.4)
    return finish(reverb(x, 2.0, 0.3, 2500))


def giant_roar():
    if not os.path.exists(ROAR_SRC):
        return giant_roar_synth()
    v = roar_from_source(0.0, 2.3, 0.8)
    n = len(v) + int(0.6 * SR)
    sec = n / SR
    t = t_axis(sec)[:n]
    x = np.zeros(n)
    x[: len(v)] = v * 0.9
    wind = sweep_band(noise(sec)[:n], 700 + 1100 * np.clip((t - 0.2) / 1.8, 0, 1), 0.5)
    x += wind * np.clip((t - 0.15) / 0.5, 0, 1) * np.clip((sec - t) / 0.8, 0, 1) * 0.3
    x += thump(n, 0.0, 60, 32, 0.7, 0.45)
    x += clicks(n, 0.2 + np.sort(rng.random(40)) * 1.8, 2500, 9000, 0.12)  # лёд трещит на нём, пока ревёт
    return finish(reverb(x, 2.0, 0.28, 2500))


def giant_throw():
    """0 с — лёд вырван из земли (треск, рывок); 0.75 с — бросок (тяжёлый свист и выдох)."""
    sec = 1.6
    n = int(sec * SR)
    t = t_axis(sec)
    x = clicks(n, np.sort(rng.random(45) ** 1.8 * 0.3), 1200, 8000, 0.5)
    x += thump(n, 0.0, 85, 40, 0.3, 0.6)
    x += tinkles(n, 0.02, 0.4, 20, 2500, 8000, 0.08, (0.03, 0.1))
    f0 = 260 + 800 * np.exp(-((t - 0.78) / 0.08) ** 2)
    x += sweep_band(noise(sec), f0, 0.9) * np.exp(-((t - 0.78) / 0.12) ** 2) * 0.9
    grunt = roar_voice(0.45, lambda tt: 70 - 20 * tt, ((560, 0.35, 1.0), (1000, 0.3, 0.5)), 0.7, 0.5)
    i0 = int(0.68 * SR)
    g = grunt * np.clip(np.arange(len(grunt)) / (0.05 * SR), 0, 1) * np.exp(-np.arange(len(grunt)) / SR * 5)
    x[i0:i0 + len(g)] += g[: n - i0] * 0.5
    return finish(reverb(x, 0.9, 0.2))


def ice_impact():
    sec = 2.0
    n = int(sec * SR)
    x = thump(n, 0, 75, 32, 0.6, 1.0)
    x += band(noise(sec), 25, 500) * env(n, 0.002, 0.35) * 1.0
    x += band(noise(sec), 1500, 8000) * env(n, 0.001, 0.07) * 0.8
    x += clicks(n, np.sort(rng.random(50) ** 2 * 0.35), 2000, 9500, 0.45)
    x += tinkles(n, 0.02, 1.2, 110, 2400, 9500, 0.12, (0.03, 0.15), 2.4)
    return finish(reverb(x, 1.3, 0.28))


def ice_freeze():
    """Герой вмерзает: нарастающий хруст кристаллизации, стеклянный аккорд, глухой стук льда."""
    sec = 1.5
    n = int(sec * SR)
    times = np.sort(0.45 * (rng.random(130) ** 0.55))  # всё гуще к концу нарастания
    x = clicks(n, times, 2500, 10000, 0.35) * np.clip(np.arange(n) / (0.45 * SR), 0.2, 1)
    x += thump(n, 0.45, 110, 55, 0.3, 0.7)
    for f, a in ((2640, 0.3), (3960, 0.22), (5280, 0.14), (1760, 0.18)):
        x += ping(n, 0.46, f * rng.uniform(0.99, 1.01), 0.9, a, ((1.0, 1.0), (2.0, 0.2)))
    x += band(noise(sec), 4000, 12000) * env(n, 0.05, 0.6, 0.0) * 0.12
    return finish(reverb(x, 1.1, 0.3))


def ice_shatter():
    sec = 1.3
    n = int(sec * SR)
    x = band(noise(sec), 1800, 9000) * env(n, 0.001, 0.06) * 0.9
    x += thump(n, 0, 140, 60, 0.15, 0.4)
    x += clicks(n, np.sort(rng.random(40) ** 2 * 0.2), 2000, 10000, 0.5)
    x += tinkles(n, 0.01, 0.9, 90, 2600, 10000, 0.13, (0.03, 0.14), 2.2)
    return finish(reverb(x, 0.9, 0.25))


def giant_death():
    sec = 4.0
    n = int(sec * SR)
    t = t_axis(sec)
    if os.path.exists(ROAR_SRC):
        v = roar_from_source(3.0, 4.2, 0.62, 0.12, 0.7)[: int(1.9 * SR)]  # стон — ниже и тише
    else:
        v = roar_voice(1.6, lambda tt: 60 - 26 * np.clip(tt / 1.4, 0, 1), ((560, 0.35, 1.0), (980, 0.3, 0.6), (2200, 0.25, 0.25)), 0.8, 0.45)
        v *= np.clip(np.arange(len(v)) / (0.15 * SR), 0, 1) * np.clip((1.6 - np.arange(len(v)) / SR) / 0.8, 0, 1)
    x = np.zeros(n)
    x[: len(v)] += v * 0.8
    x += thump(n, 0.85, 64, 30, 0.6, 0.8)  # колени
    x += band(noise(sec), 25, 300) * env(n, 0.003, 0.4, 0.85) * 0.6
    x += thump(n, 1.85, 55, 24, 1.2, 1.0)  # рухнул
    x += band(noise(sec), 20, 400) * env(n, 0.003, 0.9, 1.85) * 1.0
    x += clicks(n, 1.85 + np.sort(rng.random(70) ** 2 * 0.5), 1800, 9000, 0.5)
    x += tinkles(n, 1.87, 1.9, 170, 2000, 9500, 0.12, (0.03, 0.18), 2.4)
    x += band(noise(sec), 20, 110) * env(n, 0.1, 1.8, 1.9) * 0.5
    return finish(reverb(x, 2.2, 0.32))


def frost_stack():
    sec = 0.6
    n = int(sec * SR)
    x = clicks(n, np.sort(rng.random(12) * 0.05), 3000, 10000, 0.4)
    for f, a in ((3150, 0.5), (4720, 0.3), (6300, 0.15)):
        x += ping(n, 0.01, f * rng.uniform(0.99, 1.01), 0.35, a, ((1.0, 1.0),))
    return finish(reverb(x, 0.5, 0.2), 0.8)


SOUNDS = {
    "giant-step": (giant_step, False),
    "giant-swipe": (giant_swipe, False),
    "giant-slam": (giant_slam, False),
    "ice-spikes": (ice_spikes, False),
    "giant-roar": (giant_roar, True),
    "giant-throw": (giant_throw, False),
    "ice-impact": (ice_impact, False),
    "ice-freeze": (ice_freeze, False),
    "ice-shatter": (ice_shatter, False),
    "giant-death": (giant_death, True),
    "frost-stack": (frost_stack, False),
}

if __name__ == "__main__":
    run(SOUNDS)
