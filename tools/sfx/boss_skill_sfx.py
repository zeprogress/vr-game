"""
Звук ПРИЁМА босса катакомб (не рог ивента): низкий гул, подъём «ветра», удар в конце.
Сделан по тому же замыслу, что синтез Sfx.bossSkill в вебе (src/client/audio/Sfx.ts),
чтобы в игре и у спектатора звучало одинаково.

Запуск: python3 tools/sfx/boss_skill_sfx.py public/sfx
"""
import numpy as np

from sfxlib import (SR, band, env, finish, noise, reverb, reseed, roar_voice, run, sweep_band, t_axis, thump)

reseed(20261101)


def boss_skill():
    sec = 1.35
    n = int(sec * SR)
    out = np.zeros(n)

    def add(sig, at=0.0):
        nonlocal out
        i0 = int(at * SR)
        L = min(len(sig), n - i0)
        if L > 0:
            out[i0:i0 + L] += sig[:L]

    # 1) Подземный гул: низкий голос с тёмными формантами, тянет вниз.
    growl = roar_voice(
        0.95,
        lambda t: 58 - 16 * (t / 0.95),
        formants=[(240, 0.5, 1.0), (420, 0.6, 0.55), (900, 0.7, 0.22)],
        rough=0.6,
        breath=0.18,
    )
    # Огибающая обязательна: без неё голос обрывается на 0.95 с — слышен щелчок.
    add(growl * env(len(growl), 0.09, 0.9) * 0.5)

    # 2) Суб-бас: провал вниз — «толчок» приёма.
    add(thump(n, 0, 110, 44, 0.55, 0.85))

    # 3) Подъём «ветра»: шум, срез уходит вниз.
    wn = int(0.7 * SR)
    f_curve = np.linspace(1100, 260, wn)  # срез уходит вниз вместе с гулом
    wind = sweep_band(noise(0.7), f_curve, 1.6) * env(wn, 0.18, 0.5)
    add(wind * 0.35, 0.02)

    # 4) Каменный оттенок: короткий скрежет в конце подъёма.
    rock = band(noise(0.25), 1500, 5200) * env(int(0.25 * SR), 0.01, 0.2)
    add(rock * 0.16, 0.55)

    out = reverb(out, 1.1, 0.22, 2600)
    return finish(out, 0.9, 0.06)


run({"boss-skill": (boss_skill, False)})
