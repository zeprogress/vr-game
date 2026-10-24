"""
Звуки умений героев (все шесть классов) — синтез на кирпичах tools/sfx/sfxlib.py. Образец — ice_giant_sfx.py.
Короткие боевые звуки — WAV (MP3 сдвигает атаку на 10–25 мс). Имена файлов — hero-*.wav, карта имён — Sfx.ts.

Воин: sword-windup (замах по дуге), sword-impact (гарда о щит/землю + звон), ground-slam (удар оземь с осыпью).
Лучник: arrow-whistle (свист летящих стрел, в доплере), arrow-impact (стрелы в грунт и камень),
        blast-boom (разрыв взрывной стрелы), web-shot (паутина: вжих и липкость).
Поддержка: heal-chime (звон исцеления), holy-seal (глубокий колокол и хор-аккорд печати).
Ассасин: shadow-step (шорох в тени), knife-fan (веер ножей: свист и стук), smoke-puff (дымовая бомба),
         caltrops (россыпь шипов о камень).
Копьё: spear-thrust (укол с выпадом и чвак по телу), storm? нет — копьё только укол и ливень копий (spear-rain).
Боевой маг: storm-zap (разряд молнии с громом), storm-jump (тяжёлый прыжок с треском воздуха).

Запуск: python3 tools/sfx/hero_skills_sfx.py public/sfx [имя,имя]
"""
import numpy as np

from sfxlib import (SR, band, clicks, env, finish, noise, ping, reseed, reverb, rng, run, sine_sweep,
                    sweep_band, t_axis, thump)

reseed(20261024)
rng_local = np.random.default_rng(7)


def add(out, sig, at=0.0):
    """Наложить сигнал sig на out с задержкой at (с). Обрезает по концу out."""
    i0 = int(at * SR)
    if i0 >= len(out):
        return out
    L = min(len(sig), len(out) - i0)
    out[i0:i0 + L] += sig[:L]
    return out


def blank(sec):
    return np.zeros(int(sec * SR))


def pad(sig, sec):
    """Сигнал в дорожку полной длины sec: чтобы add() мог дописывать слои дальше первого."""
    return add(blank(sec), sig)


def knock(sec, f_from, f_to, decay, amp):
    """Короткий удар: синус, падающий по тону, огибающая decay — без хвоста на весь буфер."""
    n = int(sec * SR)
    y = sine_sweep(n, f_from, f_to) * env(n, 0.002, decay)
    return y * amp


def crack(sec, lo, hi, decay, amp, attack=0.001):
    """Треск: полосовой шум с быстрым спадом."""
    n = int(sec * SR)
    return band(noise(sec), lo, hi) * env(n, attack, decay) * amp


def whoosh(sec, f_start, f_end, amp, attack=0.05, decay=0.2):
    """Свист по воздуху: полоса бежит от f_start к f_end (Гц), затем спад."""
    n = int(sec * SR)
    f0 = f_start * (f_end / f_start) ** np.linspace(0, 1, n)
    return sweep_band(noise(sec), f0, 0.6) * env(n, attack, decay) * amp


# --- Воин -----------------------------------------------------------------------------------------

def sword_windup():
    """Замах мечом по дуге (0.55 с): свист, растущий и гаснущий, с металлическим шорохом."""
    sec = 0.55
    x = whoosh(sec, 2600, 450, 0.55, attack=0.12, decay=0.3)
    x = add(x, band(noise(0.25), 2500, 6000) * env(int(0.25 * SR), 0.04, 0.08, 0.0) * 0.1, 0.2)
    return finish(x)


def sword_impact():
    """Удар эфесом и гардой в щит и землю (0.8 с): низкий толчок, звон стали, треск, осыпь."""
    sec = 0.8
    n = int(sec * SR)
    x = knock(sec, 110, 42, 0.22, 0.9)
    x = add(x, ping(n, 0.0, 820, 0.35, 0.22))
    x = add(x, ping(n, 0.004, 1340, 0.22, 0.12))
    x = add(x, crack(0.04, 1500, 6000, 0.02, 0.55))
    x = add(x, clicks(n, np.sort(rng.random(12) * 0.25), 1200, 5000, 0.22))
    x = add(x, band(noise(0.5), 50, 260) * env(int(0.5 * SR), 0.002, 0.4) * 0.25)
    return finish(reverb(x, 0.5, 0.12))


def ground_slam():
    """Удар оземь (0.9 с): тяжёлый бум, осыпь щебня и затихающий грохот."""
    sec = 0.9
    n = int(sec * SR)
    x = knock(sec, 90, 30, 0.4, 0.9)
    x = add(x, crack(0.08, 300, 1200, 0.05, 0.5))
    x = add(x, clicks(n, np.sort(rng.random(30) ** 1.5 * 0.5), 500, 3000, 0.3))
    x = add(x, band(noise(0.6), 800, 4000) * env(int(0.6 * SR), 0.001, 0.35) * 0.2, 0.02)
    x = add(x, band(noise(0.8), 40, 200) * env(int(0.8 * SR), 0.003, 0.5) * 0.3)
    return finish(reverb(x, 0.6, 0.15))


# --- Лучник ---------------------------------------------------------------------------------------

def arrow_whistle():
    """Залп стрел в воздухе (1.1 с): 14 свистов, каждый падает по тону (доплер) и стихает."""
    sec = 1.1
    x = blank(sec)
    for _ in range(14):
        at = rng.random() * 0.8
        dur = rng.uniform(0.28, 0.4)
        m = int(dur * SR)
        f0 = 4200 * (1400 / 4200) ** np.linspace(0, 1, m)
        seg = sweep_band(noise(dur), f0, 0.5) * env(m, 0.02, 0.25) * rng.uniform(0.07, 0.12)
        x = add(x, seg, at)
    return finish(reverb(x, 0.4, 0.12))


def arrow_impact():
    """Град стрел в землю (1.3 с): 16 ударов — глухой толчок, сухой «тук» древка, пыль; иногда по камню."""
    sec = 1.3
    x = blank(sec)
    for _ in range(16):
        at = (rng.random() ** 1.4) * 1.1
        u = rng.uniform(0.5, 1.0)
        x = add(x, knock(0.06, 170, 60, 0.05, 0.3 * u), at)
        x = add(x, crack(0.025, 900, 3500, 0.018, 0.5 * u), at)
        x = add(x, crack(0.1, 250, 1800, 0.07, 0.12 * u, attack=0.002), at)
        if rng.random() < 0.3:
            x = add(x, ping(int(sec * SR), 0.0, rng.uniform(1700, 2600), 0.09, 0.06 * u), at)
    return finish(x)


def blast_boom():
    """Разрыв взрывной стрелы (0.9 с): короткий бум и раскат."""
    sec = 0.9
    n = int(sec * SR)
    x = knock(sec, 120, 35, 0.35, 0.9)
    x = add(x, crack(0.6, 60, 900, 0.45, 0.6, attack=0.002), 0.02)
    x = add(x, whoosh(0.25, 3000, 900, 0.12, attack=0.02, decay=0.1))
    return finish(reverb(x, 0.8, 0.2))


def web_shot():
    """Паутина (0.5 с): вжих выстрела, щелчок натянутой нити и липкое шипение."""
    sec = 0.5
    x = pad(whoosh(0.25, 2000, 600, 0.5, attack=0.005, decay=0.12), sec)
    x = add(x, ping(int(sec * SR), 0.2, 500, 0.15, 0.15))
    x = add(x, band(noise(0.3), 1500, 5000) * env(int(0.3 * SR), 0.05, 0.15, 0.15) * 0.1)
    return finish(x)


# --- Поддержка ------------------------------------------------------------------------------------

def heal_chime():
    """Исцеление (1.0 с): тёплый аккорд нарастает медленно, снизу вверх, и растворяется; сверху — мягкое
    мерцание света без звонка. Свой генератор шума: остальные звуки от него не сдвигаются."""
    sec = 1.0
    n = int(sec * SR)
    t = t_axis(sec)
    chord = sum(np.sin(2 * np.pi * f * t + rng_local.uniform(0, 6.28)) for f in (262, 330, 392, 524)) / 4
    rise = np.clip(t / 0.45, 0, 1) ** 1.5
    x = chord * rise * env(n, 0.45, 0.5) * 0.22
    shimmer = band(rng_local.standard_normal(n), 3500, 9000)
    x = add(x, shimmer * env(n, 0.3, 0.6, 0.1) * 0.02)
    return finish(reverb(x, 1.0, 0.3))


def holy_seal():
    """Печать света (1.0 с): глубокий колокол и тихий хор-аккорд, медленно растворяются."""
    sec = 1.0
    n = int(sec * SR)
    x = ping(n, 0.0, 220, 1.2, 0.2)
    x = add(x, ping(n, 0.0, 330, 1.0, 0.1))
    t = t_axis(sec)
    chord = sum(np.sin(2 * np.pi * f * t) for f in (440, 554, 660)) / 3
    x = add(x, chord * env(n, 0.2, 0.8) * 0.08)
    return finish(reverb(x, 1.2, 0.35))


# --- Ассасин --------------------------------------------------------------------------------------

def shadow_step():
    """Рывок в тени (0.5 с): тихий шорох ткани и свист, почти без звона."""
    sec = 0.5
    x = pad(whoosh(0.3, 900, 200, 0.3, attack=0.1, decay=0.12), sec)
    x = add(x, band(noise(0.2), 1500, 4000) * env(int(0.2 * SR), 0.05, 0.08) * 0.08)
    return finish(x)


def knife_fan():
    """Веер ножей (0.35 с): свист лезвия в полёте и тупой стук в цель."""
    sec = 0.35
    x = pad(whoosh(0.2, 4000, 2500, 0.2, attack=0.01, decay=0.08), sec)
    x = add(x, knock(0.12, 160, 80, 0.04, 0.5), 0.22)
    x = add(x, crack(0.1, 800, 3000, 0.04, 0.5), 0.22)
    return finish(x)


def smoke_puff():
    """Дымовая бомба (1.2 с): хлопок и долгое шипение дыма."""
    sec = 1.2
    x = pad(knock(0.15, 180, 60, 0.08, 0.6), sec)
    x = add(x, band(noise(sec), 200, 2500) * env(int(sec * SR), 0.25, 0.9) * 0.25)
    return finish(x)


def caltrops():
    """Шипы на камнях (0.6 с): россыпь металлических щелчков и звон одного шипа."""
    sec = 0.6
    n = int(sec * SR)
    x = clicks(n, np.sort(rng.random(10) * 0.4), 2000, 7000, 0.4)
    x = add(x, ping(n, 0.15, 600, 0.05, 0.1))
    return finish(x)


# --- Копьё ----------------------------------------------------------------------------------------

def spear_thrust():
    """Укол копьём (0.5 с): свист древка, затем глухой чвак по телу."""
    sec = 0.5
    x = pad(whoosh(0.25, 1800, 700, 0.35, attack=0.02, decay=0.1), sec)
    x = add(x, knock(0.1, 150, 70, 0.08, 0.5), 0.22)
    x = add(x, crack(0.05, 600, 2500, 0.03, 0.4), 0.22)
    return finish(x)


def spear_rain():
    """Ливень копий (0.9 с): три тяжёлых удара сверху, каждый с металлическим звоном о камень."""
    sec = 0.9
    n = int(sec * SR)
    x = blank(sec)
    for at in (0.0, 0.15, 0.32):
        x = add(x, whoosh(0.2, 2500, 900, 0.15, attack=0.01, decay=0.06), at)
        x = add(x, knock(0.15, 130, 50, 0.07, 0.6), at + 0.2)
        x = add(x, ping(n, at + 0.2, 1500, 0.2, 0.1))
    return finish(reverb(x, 0.4, 0.1))


# --- Боевой маг -----------------------------------------------------------------------------------

def storm_zap():
    """Разряд молнии (0.7 с): треск разряда, раскат грома и электрический шорох."""
    sec = 0.7
    n = int(sec * SR)
    x = pad(crack(0.1, 1000, 8000, 0.06, 0.7), sec)
    x = add(x, band(noise(1.0), 40, 300) * env(int(1.0 * SR), 0.02, 0.6, 0.02) * 0.6)
    x = add(x, clicks(n, np.sort(rng.random(40) * 0.3), 3000, 9000, 0.35))
    return finish(reverb(x, 1.2, 0.2))


def storm_jump():
    """Тяжёлый прыжок мага (0.6 с): треск воздуха и низкий удар приземления."""
    sec = 0.6
    n = int(sec * SR)
    x = pad(whoosh(0.3, 1200, 300, 0.25, attack=0.05, decay=0.15), sec)
    x = add(x, clicks(n, np.sort(rng.random(12) * 0.2), 3000, 8000, 0.25))
    x = add(x, knock(0.3, 110, 40, 0.2, 0.7), 0.3)
    return finish(x)


SOUNDS = {
    "hero-sword-windup": (sword_windup, False),
    "hero-sword-impact": (sword_impact, False),
    "hero-ground-slam": (ground_slam, False),
    "hero-arrow-whistle": (arrow_whistle, False),
    "hero-arrow-impact": (arrow_impact, False),
    "hero-blast-boom": (blast_boom, False),
    "hero-web-shot": (web_shot, False),
    "hero-heal-chime": (heal_chime, False),
    "hero-holy-seal": (holy_seal, False),
    "hero-shadow-step": (shadow_step, False),
    "hero-knife-fan": (knife_fan, False),
    "hero-smoke-puff": (smoke_puff, False),
    "hero-caltrops": (caltrops, False),
    "hero-spear-thrust": (spear_thrust, False),
    "hero-spear-rain": (spear_rain, False),
    "hero-storm-zap": (storm_zap, False),
    "hero-storm-jump": (storm_jump, False),
}

if __name__ == "__main__":
    run(SOUNDS)
