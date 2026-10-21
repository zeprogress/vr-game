"""
Звуки Владыки Бездны (дракон катакомб, DRAGON) — синтез на кирпичах tools/sfx/sfxlib.py поверх сэмплов из
ASSETS/SFX (голос — эпический рёв и рёв-голос ниже тоном: дракон огромный; огонь — запись дыхания огнём;
заряд — «мана»; печать — «каст»). Многослойно: низкий удар, шорох и треск огня, обломки, ревербация зала.

Пик каждого звука — в кадр удара клипа (DRAGON.hitSec, tools/blender/dragon_anim.py): звук запускается в начале
клипа или события, и его главный удар стоит на той же секунде, что урон на сервере.

Запуск: python3 tools/sfx/dragon_sfx.py public/sfx [имя,имя]
Пишет WAV 44.1 кГц моно (короткие боевые — WAV: MP3 сдвигает атаку), длинные (горение, заряд, ярость, смерть) — MP3.
"""
import os

import numpy as np

from sfxlib import (SR, band, clicks, env, finish, load_audio, noise, pitch, reseed, reverb, rng, roar_voice, run,
                    sine_sweep, sweep_band, t_axis, thump, tinkles)

reseed(20261021)

SRC = "/Users/zep/ASSETS/SFX/"
FIRE = SRC + "dragon-studio-dragon-breathing-fire-364475.mp3"
EPIC = SRC + "dragon-studio-epic-dragon-roar-364481.mp3"
VOICE = SRC + "phatphrogstudio-dragon-voice-roar-477831.mp3"
CHARGE = SRC + "fxprosound-magic-charge-mana-2-186628.mp3"
CAST = SRC + "yodguard-casting-magic-3-382381.mp3"

# Кадры ударов — те же числа, что DRAGON.hitSec (src/shared/mobs.ts).
BITE_HIT = 0.5
TAIL_HIT = 1.12
WINGS_HIT = 0.85
BREATH_START, BREATH_END = 1.25, 1.95
CHARGE_PEAK = 1.3
METEOR_FALL = 0.6
RING_TELEGRAPH = 1.8

_cache = {}


def src(path):
    if path not in _cache:
        _cache[path] = load_audio(path) if os.path.exists(path) else None
    return _cache[path]


def seg(path, t0, t1, k=1.0, fade_in=0.03, fade_out=0.3):
    """Кусок сэмпла t0..t1 с, ниже тоном в k раз (k < 1), с мягкими краями; нет файла — None."""
    x = src(path)
    if x is None:
        return None
    x = pitch(x[int(t0 * SR):int(t1 * SR)], k)
    n = len(x)
    i = np.arange(n)
    return x * np.clip(i / max(1, fade_in * SR), 0, 1) * np.clip((n - i) / max(1, fade_out * SR), 0, 1)


def put(out, x, at, gain=1.0):
    """Подмешать x в out с секунды at (раньше нуля — начало x обрезается)."""
    if x is None:
        return out
    i0 = int(at * SR)
    if i0 < 0:
        x = x[-i0:]
        i0 = 0
    m = min(len(x), len(out) - i0)
    if m > 0:
        out[i0:i0 + m] += x[:m] * gain
    return out


def bell(t, at, w):
    return np.exp(-((t - at) / w) ** 2)


def crackle(n, start, dur, count, amp=0.25, lo=900, hi=6500):
    """Треск огня: щелчки, гуще в начале."""
    return clicks(n, start + np.sort(rng.random(count) ** 1.3) * dur, lo, hi, amp)


# ---------------------------------------------------------------- шаги и пасть

def lord_step():
    """Тяжёлая лапа на камень: глубокий удар, когти щёлкают по полу, осыпается каменная крошка."""
    sec = 0.95
    n = int(sec * SR)
    x = thump(n, 0, 52, 27, 0.45, 1.0)
    x += band(noise(sec), 25, 220) * env(n, 0.004, 0.26) * 0.9
    x += clicks(n, 0.004 + np.sort(rng.random(5)) * 0.04, 1800, 5200, 0.35)  # когти
    x += clicks(n, 0.03 + np.sort(rng.random(22) ** 1.5) * 0.4, 700, 3800, 0.16)  # крошка
    x += band(noise(sec), 500, 2500) * env(n, 0.002, 0.07) * 0.25
    return finish(reverb(x, 0.9, 0.22, 2200))


def lord_bite():
    """Рык нарастает → щелчок пасти в кадр укуса (0.5 с): хруст зубов, глухой удар, искры."""
    sec = 1.1
    n = int(sec * SR)
    t = t_axis(sec)
    g = seg(VOICE, 4.55, 5.05, 0.72, 0.08, 0.12)
    x = np.zeros(n)
    if g is None:
        g = roar_voice(0.55, lambda tt: 58 + 18 * tt, ((520, 0.35, 1.0), (950, 0.3, 0.6), (2100, 0.25, 0.3)), 0.7, 0.4)
        g *= np.clip(np.arange(len(g)) / (0.25 * SR), 0, 1)
    put(x, band(g, 40, 5000), BITE_HIT - len(g) / SR + 0.04, 0.75)
    i = int(BITE_HIT * SR)
    x += band(noise(sec), 1200, 7000) * env(n, 0.0008, 0.04, BITE_HIT) * 0.9  # щелчок
    x += thump(n, BITE_HIT, 320, 140, 0.06, 0.5)  # зубы о зубы
    x += thump(n, BITE_HIT, 75, 40, 0.3, 0.8)
    x += crackle(n, BITE_HIT + 0.02, 0.35, 14, 0.12)
    x[i:] += band(noise(sec), 60, 400)[: n - i] * np.exp(-np.arange(n - i) / SR * 6) * 0.25
    return finish(reverb(x, 1.0, 0.24))


def lord_snort():
    """Фырканье: два выдоха из ноздрей («пф-ф»), низкий хрип, в конце — потрескивание тлеющего жара."""
    sec = 0.9
    n = int(sec * SR)
    t = t_axis(sec)
    breath = band(noise(sec), 280, 2600)
    x = breath * (bell(t, 0.06, 0.035) * 0.6 + np.clip((t - 0.16) / 0.03, 0, 1) * np.exp(-np.clip(t - 0.16, 0, None) * 5.5)) * 0.9
    x += band(noise(sec), 50, 220) * np.exp(-((t - 0.2) / 0.15) ** 2) * 0.5
    x += crackle(n, 0.25, 0.5, 9, 0.08)
    return finish(reverb(x, 0.7, 0.2), 0.85)


# ---------------------------------------------------------------- огненное дыхание

def lord_breath_in():
    """Вдох перед пламенем (клип: голова назад, пасть приоткрыта): воздух втягивается всё выше и громче, в горле
    рокочет и разгорается — до кадра 1.25 с, где пойдёт пламя."""
    sec = BREATH_START + 0.12
    n = int(sec * SR)
    t = t_axis(sec)
    grow = np.clip(t / BREATH_START, 0, 1)
    air = sweep_band(noise(sec), 420 + 1500 * grow ** 1.5, 0.7) * (0.15 + 0.85 * grow ** 2)
    x = air * np.clip((BREATH_START + 0.02 - t) / 0.04, 0, 1) * 0.8
    rum = roar_voice(sec, lambda tt: 36 + 10 * np.clip(tt / BREATH_START, 0, 1), ((240, 0.4, 1.0), (520, 0.3, 0.5)), 0.8, 0.15)
    x += band(rum, 30, 900) * grow ** 1.6 * 0.55
    x += crackle(n, 0.55, BREATH_START - 0.55, 26, 0.1) * grow
    x += thump(n, BREATH_START - 0.02, 90, 50, 0.12, 0.35)  # «глоток» перед выдохом
    return finish(reverb(x, 1.1, 0.25))


def lord_breath():
    """Пламя (0.7 с струи): удар воспламенения, рёв огня из записи ниже тоном, рык дракона под ним, треск."""
    sec = 1.9
    n = int(sec * SR)
    t = t_axis(sec)
    x = np.zeros(n)
    stream = BREATH_END - BREATH_START
    f = seg(FIRE, 0.9, 2.9, 0.78, 0.01, 0.6)
    if f is not None:
        f = band(f, 60, 9000) * np.clip(1.25 - np.clip(np.arange(len(f)) / SR - stream, 0, None) * 0.9, 0.12, 1.25)
        put(x, f, 0.0, 1.0)
    else:
        x += band(noise(sec), 120, 5000) * np.clip(t / 0.03, 0, 1) * np.exp(-np.clip(t - stream, 0, None) * 4)
    v = seg(EPIC, 0.35, 1.5, 0.72, 0.05, 0.5)
    put(x, band(v, 40, 3500) if v is not None else None, 0.0, 0.42)
    x += thump(n, 0.0, 70, 32, 0.4, 0.8)  # воспламенение
    x += band(noise(sec), 30, 160) * np.clip(t / 0.05, 0, 1) * np.exp(-np.clip(t - stream, 0, None) * 3) * 0.6
    x += crackle(n, 0.05, stream + 0.6, 50, 0.13)
    return finish(reverb(x, 1.4, 0.28))


def lord_burn():
    """Горит земля (3 с): треск и гул пламени, вспышки; к концу гаснет и шипит."""
    sec = 3.6
    n = int(sec * SR)
    t = t_axis(sec)
    x = np.zeros(n)
    f = seg(FIRE, 3.0, 6.6, 1.0, 0.25, 1.2)
    put(x, band(f, 150, 7000) if f is not None else band(noise(sec), 200, 4000) * 0.4, 0.0, 0.55)
    x += crackle(n, 0.0, 3.2, 120, 0.16, 800, 7000)
    flick = 1 + 0.35 * band(rng.standard_normal(n), 2, 9) * 6
    x += band(noise(sec), 50, 260) * flick * np.clip(t / 0.2, 0, 1) * np.clip((sec - t) / 1.2, 0, 1) * 0.45
    x += band(noise(sec), 3500, 9000) * np.clip((t - 2.4) / 0.4, 0, 1) * np.clip((sec - t) / 0.8, 0, 1) * 0.06  # шипит
    return finish(reverb(x, 1.2, 0.25), 0.85)


# ---------------------------------------------------------------- хвост

def lord_tail():
    """Удар хвостом (клип 2.6 с): перестановка лап — сами шаги звучат по касанию стоп; здесь — тяжёлый размах:
    нарастающий гул воздуха, пик свиста в кадр хлёста (1.12 с), затухающий хвост после."""
    sec = 1.75
    n = int(sec * SR)
    t = t_axis(sec)
    f0 = 140 + 650 * bell(t, TAIL_HIT, 0.1) + 120 * np.clip((t - 0.6) / 0.5, 0, 1)
    w = sweep_band(noise(sec), f0, 0.9)
    amp = bell(t, TAIL_HIT, 0.13) * 1.0 + bell(t, 0.85, 0.22) * 0.35 + bell(t, TAIL_HIT + 0.22, 0.15) * 0.25
    x = w * amp
    x += band(noise(sec), 30, 140) * bell(t, TAIL_HIT, 0.1) * 0.9
    x += clicks(n, 0.15 + rng.random(10) * 0.7, 1200, 4000, 0.08)  # чешуя скрипит
    return finish(reverb(x, 1.1, 0.22))


def lord_tail_hit():
    """Хлёст: удар по камню, треск, летят обломки и пыль."""
    sec = 1.5
    n = int(sec * SR)
    x = thump(n, 0, 62, 27, 0.6, 1.0)
    x += band(noise(sec), 30, 420) * env(n, 0.002, 0.42) * 1.0
    x += band(noise(sec), 1500, 7500) * env(n, 0.0008, 0.06) * 0.8  # треск
    x += clicks(n, 0.02 + np.sort(rng.random(60) ** 1.8) * 0.75, 700, 4200, 0.3)  # обломки
    x += band(noise(sec), 400, 2200) * env(n, 0.02, 0.6, 0.03) * 0.15  # осыпается пыль
    return finish(reverb(x, 1.5, 0.32))


# ---------------------------------------------------------------- метеоры

def lord_charge():
    """Заряд (клип MagicCharge): рёв к своду и нарастающая мана, на пике (1.3 с) — разряд вверх и гул."""
    sec = 2.4
    n = int(sec * SR)
    t = t_axis(sec)
    x = np.zeros(n)
    v = seg(EPIC, 0.05, 2.3, 0.86, 0.15, 0.7)
    if v is None:
        v = roar_voice(2.0, lambda tt: 48 + 30 * np.clip(tt / 1.1, 0, 1) - 18 * np.clip((tt - 1.4) / 0.6, 0, 1),
                       ((600, 0.35, 1.0), (1050, 0.3, 0.7), (2300, 0.25, 0.35)), 0.6, 0.35)
    # рёв нарастает к пику заряда и стихает после (громче всего — в кадр разряда)
    tv = np.arange(len(v)) / SR + 0.25
    v = v * (0.35 + 0.65 * np.clip(tv / CHARGE_PEAK, 0, 1) ** 1.5) * np.where(tv > CHARGE_PEAK, np.exp(-(tv - CHARGE_PEAK) * 1.2) * 0.6 + 0.4, 1.0)
    put(x, band(v, 40, 6000), 0.25, 0.85)
    c = seg(CHARGE, 0.0, 1.2, 0.7, 0.05, 0.25)  # пик сэмпла 0.5 с → 0.71 с ниже тоном
    put(x, band(c, 200, 9000) if c is not None else None, CHARGE_PEAK - 0.71, 0.55)
    x += band(noise(sec), 25, 140) * np.clip(t / CHARGE_PEAK, 0, 1) ** 2 * np.exp(-np.clip(t - CHARGE_PEAK, 0, None) * 2.5) * 0.7
    x += thump(n, CHARGE_PEAK, 85, 40, 0.5, 0.6)
    x += sweep_band(noise(sec), 500 + 2500 * np.clip((t - CHARGE_PEAK) / 0.4, 0, 1), 0.6) * bell(t, CHARGE_PEAK + 0.15, 0.15) * 0.4
    return finish(reverb(x, 2.0, 0.3, 2600))


def lord_meteor_fall():
    """Падение (0.6 с): свист вниз по тону и растущий гул пламени — оборвётся в кадр удара."""
    sec = METEOR_FALL + 0.05
    n = int(sec * SR)
    t = t_axis(sec)
    grow = np.clip(t / METEOR_FALL, 0, 1)
    x = sine_sweep(n, 1500, 420) * 0.25 * grow ** 1.5
    x += sweep_band(noise(sec), 3200 - 2400 * grow, 0.5) * (0.2 + 0.8 * grow ** 2) * 0.7
    x += band(noise(sec), 120, 1800) * grow ** 2.5 * 0.6
    x *= np.clip((sec - t) / 0.05, 0, 1)
    return finish(x, 0.85, 0.0)


def lord_meteor_hit():
    """Метеор бьёт в пол: взрыв, клуб огня, разлёт камней."""
    sec = 2.0
    n = int(sec * SR)
    x = thump(n, 0, 72, 29, 0.75, 1.0)
    x += band(noise(sec), 30, 650) * env(n, 0.002, 0.5) * 1.1
    x += band(noise(sec), 1500, 8000) * env(n, 0.0008, 0.08) * 0.8
    f = seg(FIRE, 0.5, 1.6, 0.7, 0.005, 0.6)
    put(x, band(f, 80, 6000) if f is not None else None, 0.0, 0.5)
    x += clicks(n, 0.03 + np.sort(rng.random(55) ** 2) * 0.9, 700, 4500, 0.3)
    x += crackle(n, 0.1, 1.2, 30, 0.08)
    return finish(reverb(x, 1.7, 0.35))


# ---------------------------------------------------------------- кольцо пламени

def lord_ring_mark():
    """Кольцо разгорается (1.8 с телеграфа): гул огня нарастает со всех сторон, треск всё гуще — оборвётся ударом."""
    sec = RING_TELEGRAPH + 0.06
    n = int(sec * SR)
    t = t_axis(sec)
    grow = np.clip(t / RING_TELEGRAPH, 0, 1)
    x = np.zeros(n)
    f = seg(FIRE, 2.0, 3.9, 1.0, 0.3, 0.05)
    if f is not None:
        put(x, band(f, 120, 7000) * (0.2 + 0.8 * np.clip(np.arange(len(f)) / SR / RING_TELEGRAPH, 0, 1) ** 1.5), 0.0, 0.6)
    x += sweep_band(noise(sec), 220 + 1300 * grow ** 1.4, 0.7) * grow ** 2 * 0.5
    x += band(noise(sec), 30, 150) * grow ** 1.5 * 0.6
    x += crackle(n, 0.2, RING_TELEGRAPH - 0.2, 60, 0.12) * (0.3 + 0.7 * grow)
    x *= np.clip((sec - t) / 0.06, 0, 1)
    return finish(x, 0.85, 0.0)


def lord_wings():
    """Удар крыльями вниз (клип AttackWings): мягкий подъём, перепонки хлопают, тяжёлый «вухх» в кадр 0.85 с."""
    sec = 1.5
    n = int(sec * SR)
    t = t_axis(sec)
    lift = sweep_band(noise(sec), 300 + 400 * np.clip(t / 0.6, 0, 1), 0.8) * bell(t, 0.45, 0.2) * 0.25
    x = lift
    flap = 1 + 0.6 * np.sin(2 * np.pi * 23 * t)
    x += band(noise(sec), 250, 1400) * flap * bell(t, WINGS_HIT - 0.05, 0.12) * 0.7
    x += band(noise(sec), 35, 300) * bell(t, WINGS_HIT, 0.07) * 1.2
    x += thump(n, WINGS_HIT - 0.01, 58, 30, 0.35, 0.8)
    x += sweep_band(noise(sec), 900 - 500 * np.clip((t - WINGS_HIT) / 0.4, 0, 1), 0.7) * bell(t, WINGS_HIT + 0.12, 0.16) * 0.4
    return finish(reverb(x, 1.2, 0.25))


def lord_ring():
    """Взрыв кольца: фронт огня бежит от дракона — удар, свист пламени вниз по тону, рёв огня, треск."""
    sec = 2.2
    n = int(sec * SR)
    t = t_axis(sec)
    x = thump(n, 0, 60, 27, 0.8, 1.0)
    x += band(noise(sec), 30, 500) * env(n, 0.002, 0.45) * 0.9
    x += sweep_band(noise(sec), 1700 - 1300 * np.clip(t / 0.5, 0, 1), 0.8) * np.clip(t / 0.01, 0, 1) * np.exp(-t * 3.2) * 0.8
    f = seg(FIRE, 0.6, 2.3, 0.75, 0.005, 0.8)
    put(x, band(f, 80, 7000) if f is not None else None, 0.0, 0.6)
    x += crackle(n, 0.05, 1.4, 50, 0.12)
    return finish(reverb(x, 1.9, 0.35))


# ---------------------------------------------------------------- печать и ярость

def lord_shield():
    """Печать разбита: звон и осыпание магического стекла, низкий удар, дракон рычит от боли."""
    sec = 2.0
    n = int(sec * SR)
    x = band(noise(sec), 2000, 9500) * env(n, 0.0008, 0.07) * 0.9
    x += thump(n, 0, 82, 36, 0.5, 0.8)
    x += tinkles(n, 0.01, 1.3, 130, 1800, 9000, 0.12, (0.05, 0.3), 2.2)
    m = seg(CAST, 0.25, 1.4, 0.8, 0.01, 0.5)
    put(x, band(m, 300, 9000) if m is not None else None, 0.0, 0.4)
    v = seg(VOICE, 2.15, 2.95, 0.8, 0.05, 0.35)
    put(x, band(v, 40, 5000) if v is not None else None, 0.12, 0.6)
    return finish(reverb(x, 1.6, 0.32))


def lord_rage():
    """Ярость (клип заряда): рёв к своду ниже тоном, на пике (1.3 с) — огненный выдох вверх и удар жара."""
    sec = 3.6
    n = int(sec * SR)
    t = t_axis(sec)
    x = np.zeros(n)
    v = seg(EPIC, 0.0, 3.1, 0.8, 0.08, 0.9)
    if v is None:
        v = roar_voice(3.2, lambda tt: 46 + 30 * np.clip(tt / 1.2, 0, 1) - 20 * np.clip((tt - 1.8) / 1.2, 0, 1),
                       ((600, 0.35, 1.0), (1080, 0.3, 0.7), (2400, 0.25, 0.35), (190, 0.4, 0.6)), 0.6, 0.35)
    tv = np.arange(len(v)) / SR + 0.15
    v = v * (0.45 + 0.55 * np.clip(tv / CHARGE_PEAK, 0, 1) ** 1.3) * np.where(tv > CHARGE_PEAK + 0.3, np.exp(-(tv - CHARGE_PEAK - 0.3) * 0.7) * 0.7 + 0.3, 1.0)
    put(x, band(v, 35, 6500) + band(v, 35, 200) * 0.5, 0.15, 0.9)
    f = seg(FIRE, 1.0, 2.2, 0.8, 0.01, 0.6)
    put(x, band(f, 80, 7000) if f is not None else None, CHARGE_PEAK, 0.6)
    x += thump(n, CHARGE_PEAK, 64, 28, 0.9, 0.75)
    x += band(noise(sec), 22, 120) * np.clip(t / 0.6, 0, 1) * np.clip((sec - t) / 1.5, 0, 1) * 0.45
    return finish(reverb(x, 2.4, 0.3, 2500))


def lord_death():
    """Смерть: предсмертный рёв ниже тоном и тише; тело рушится (1.45 с), голова падает (1.8 с), последний выдох."""
    sec = 4.4
    n = int(sec * SR)
    t = t_axis(sec)
    x = np.zeros(n)
    v = seg(EPIC, 1.2, 3.4, 0.64, 0.1, 1.2)
    if v is None:
        v = roar_voice(2.4, lambda tt: 54 - 24 * np.clip(tt / 2.0, 0, 1), ((540, 0.35, 1.0), (980, 0.3, 0.6), (2200, 0.25, 0.25)), 0.8, 0.45)
        v *= np.clip(np.arange(len(v)) / (0.2 * SR), 0, 1) * np.clip((2.4 - np.arange(len(v)) / SR) / 1.0, 0, 1)
    put(x, band(v, 35, 5000), 0.0, 0.8)
    x += thump(n, 0.6, 60, 30, 0.4, 0.5)  # задние лапы подломились
    x += thump(n, 1.45, 48, 22, 1.2, 1.0)  # тело рухнуло
    x += band(noise(sec), 20, 420) * env(n, 0.004, 0.9, 1.45) * 1.0
    x += clicks(n, 1.47 + np.sort(rng.random(70) ** 2) * 0.9, 700, 4500, 0.3)
    x += thump(n, 1.8, 72, 34, 0.45, 0.6)  # голова
    x += band(noise(sec), 220, 1300) * np.clip((t - 2.6) / 0.2, 0, 1) * np.exp(-np.clip(t - 2.6, 0, None) * 1.6) * 0.3  # выдох
    x += band(noise(sec), 20, 110) * env(n, 0.1, 1.6, 1.5) * 0.5
    return finish(reverb(x, 2.4, 0.33))


SOUNDS = {
    "lord-step": (lord_step, False),
    "lord-bite": (lord_bite, False),
    "lord-snort": (lord_snort, False),
    "lord-breath-in": (lord_breath_in, False),
    "lord-breath": (lord_breath, False),
    "lord-burn": (lord_burn, True),
    "lord-tail": (lord_tail, False),
    "lord-tail-hit": (lord_tail_hit, False),
    "lord-charge": (lord_charge, True),
    "lord-meteor-fall": (lord_meteor_fall, False),
    "lord-meteor-hit": (lord_meteor_hit, False),
    "lord-ring-mark": (lord_ring_mark, False),
    "lord-wings": (lord_wings, False),
    "lord-ring": (lord_ring, False),
    "lord-shield": (lord_shield, False),
    "lord-rage": (lord_rage, True),
    "lord-death": (lord_death, True),
}

if __name__ == "__main__":
    run(SOUNDS)
