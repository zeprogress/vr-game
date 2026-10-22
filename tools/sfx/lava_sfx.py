"""
Звуки Лавового монстра (Страж и Маг, сервер — server/sim/lavaSkills.ts) — синтез (numpy, кирпичи — tools/sfx/sfxlib.py).
Шипение и треск магмы, пузыри, глухой удар о камень, рёв из формант. Образец — ice_giant_sfx.py (docs/pipelines/creatures.md).

Запуск: python3 tools/sfx/lava_sfx.py public/sfx [имя,имя]
Короткие боевые — WAV (атака в момент вызова), рёв и смерть — MP3 (см. run).
"""
import numpy as np

from sfxlib import (SR, band, clicks, env, finish, noise, ping, reseed, reverb, rng, roar_voice, run, sweep_band, t_axis,
                    thump, tinkles)

reseed(20261022)


def lava_step():
    """Тяжёлая стопа: удар о камень, треск трещин и тлеющие искры."""
    sec = 0.8
    n = int(sec * SR)
    x = thump(n, 0, 70, 34, 0.32, 0.9)
    x += band(noise(sec), 40, 300) * env(n, 0.003, 0.18) * 0.7
    x += clicks(n, np.sort(rng.random(18) ** 1.5 * 0.12), 1800, 7000, 0.45)
    x += tinkles(n, 0.02, 0.2, 5, 2200, 5500, 0.04, (0.02, 0.06))
    return finish(reverb(x, 0.5, 0.16))


def lava_slam():
    """Удар о землю: гулкий удар, глухой рокот и брызги магмы (шипение)."""
    sec = 1.9
    n = int(sec * SR)
    x = thump(n, 0, 62, 28, 0.6, 1.0)
    x += band(noise(sec), 30, 400) * env(n, 0.002, 0.9) * 0.9
    x += band(noise(sec), 2000, 7000) * env(n, 0.001, 0.25, 0.02) * 0.45
    x += clicks(n, np.sort(rng.random(60) ** 2 * 0.9), 1500, 8000, 0.4)
    x += tinkles(n, 0.05, 1.2, 40, 2000, 8000, 0.08, (0.04, 0.2), 2.0)
    return finish(reverb(x, 1.2, 0.26))


def lava_spill():
    """Разлив магмы: длинное шипение по линии, пузыри лопаются."""
    sec = 1.5
    n = int(sec * SR)
    t = t_axis(sec)
    x = band(noise(sec), 900, 4500) * env(n, 0.12, 1.2, 0.02) * 0.75
    x += sweep_band(noise(sec), 500 + 600 * t / sec, 0.8) * env(n, 0.05, 1.0) * 0.4
    pops = np.sort(rng.random(45) * 1.2)
    for p in pops:
        x += ping(n, p, rng.uniform(260, 520), 0.05, 0.3, ((1.0, 1.0), (2.1, 0.3)))
    return finish(reverb(x, 0.9, 0.2))


def lava_mark():
    """Метка лавы: восходящий гул и низкий звон — маг ставит знак."""
    sec = 1.3
    n = int(sec * SR)
    t = t_axis(sec)
    x = sweep_band(noise(sec), 300 + 1100 * (t / sec) ** 2, 0.9) * env(n, 0.3, 0.9, 0.0) * 0.7
    for f, a in ((520, 0.35), (780, 0.22), (1040, 0.14)):
        x += ping(n, 0.85, f * rng.uniform(0.99, 1.01), 0.7, a, ((1.0, 1.0), (2.0, 0.15)))
    x += thump(n, 0.9, 80, 40, 0.4, 0.6)
    return finish(reverb(x, 1.0, 0.22))


def lava_ring():
    """Кольцо углей: треск искр по кругу и сухой хлопок вспышки."""
    sec = 1.4
    n = int(sec * SR)
    x = clicks(n, np.sort(rng.random(90) * 0.9), 2500, 10000, 0.4)
    x += band(noise(sec), 1200, 6000) * env(n, 0.002, 0.4) * 0.35
    x += thump(n, 0.95, 90, 45, 0.3, 0.7)
    x += tinkles(n, 0.96, 1.3, 30, 2600, 9000, 0.06, (0.03, 0.12), 2.0)
    return finish(reverb(x, 0.9, 0.2))


def lava_hit():
    """Удар магмы по герою: хлопок, шипение и треск угасающих искр."""
    sec = 1.5
    n = int(sec * SR)
    x = thump(n, 0, 90, 36, 0.5, 0.9)
    x += band(noise(sec), 800, 6000) * env(n, 0.001, 0.5) * 0.6
    x += clicks(n, np.sort(rng.random(40) ** 2 * 0.5), 2000, 9000, 0.45)
    return finish(reverb(x, 1.0, 0.22))


def lava_roar():
    """Рёв ярости: низкий хрипящий голос с шипящими формантами."""
    sec = 2.2
    n = int(sec * SR)
    v = roar_voice(1.9, lambda tt: 80 - 30 * np.clip(tt / 1.6, 0, 1), ((420, 0.35, 1.0), (900, 0.3, 0.6), (2600, 0.25, 0.3)), 0.85, 0.5)
    v *= np.clip(np.arange(len(v)) / (0.08 * SR), 0, 1) * np.clip((1.9 - np.arange(len(v)) / SR) / 0.5, 0, 1)
    x = np.zeros(n)
    x[: len(v)] += v * 0.8
    x += thump(n, 0.02, 60, 30, 0.6, 0.9)
    x += band(noise(sec), 1500, 7000) * env(n, 0.01, 1.2) * 0.25
    return finish(reverb(x, 1.4, 0.25))


def lava_death():
    """Смерть: затихающий рёв, оседание камня и шипение остывающей магмы."""
    sec = 3.2
    n = int(sec * SR)
    v = roar_voice(1.4, lambda tt: 70 - 30 * np.clip(tt / 1.3, 0, 1), ((420, 0.35, 1.0), (900, 0.3, 0.5)), 0.8, 0.45)
    v *= np.clip(np.arange(len(v)) / (0.1 * SR), 0, 1) * np.clip((1.4 - np.arange(len(v)) / SR) / 0.6, 0, 1)
    x = np.zeros(n)
    x[: len(v)] += v * 0.7
    x += thump(n, 1.2, 55, 26, 0.9, 1.0)
    x += band(noise(sec), 30, 350) * env(n, 0.003, 1.2, 1.2) * 0.8
    x += band(noise(sec), 1500, 7000) * env(n, 0.02, 1.4, 1.3) * 0.25
    return finish(reverb(x, 1.8, 0.28))


SOUNDS = {
    "lava-step": (lava_step, False),
    "lava-slam": (lava_slam, False),
    "lava-spill": (lava_spill, False),
    "lava-mark": (lava_mark, False),
    "lava-ring": (lava_ring, False),
    "lava-hit": (lava_hit, False),
    "lava-roar": (lava_roar, True),
    "lava-death": (lava_death, True),
}

if __name__ == "__main__":
    run(SOUNDS)
