"""
Звуки Ледяного гиганта — синтез с нуля (numpy), без чужих сэмплов. Многослойно: низкий удар, хруст и
звон льда (затухающие негармоничные «динь»), шорох, рёв (пила с формантами и хрипом), ревербация.

Запуск: python3 tools/sfx/ice_giant_sfx.py public/sfx
Пишет WAV 44.1 кГц моно (короткие боевые — WAV: MP3 сдвигает атаку), длинные (рёв, смерть) — ещё и MP3 через ffmpeg.
"""
import os
import subprocess
import sys
import wave

import numpy as np

SR = 44100
rng = np.random.default_rng(20261019)


def t_axis(sec):
    return np.arange(int(sec * SR)) / SR


def noise(sec):
    return rng.standard_normal(int(sec * SR))


def band(x, lo, hi, soft=0.25):
    """Полоса lo..hi Гц (мягкие края в октавах) — через спектр (с запасом нулей: хвост фильтра не заворачивается в начало)."""
    n0 = len(x)
    pad = int(0.4 * SR)
    x = np.concatenate([x, np.zeros(pad)])
    n = len(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    X = np.fft.rfft(x)
    lf = np.log2(np.maximum(f, 1.0))
    m = np.ones_like(f)
    if lo > 0:
        m *= 1 / (1 + np.exp(-(lf - np.log2(lo)) / (soft / 4)))
    if hi < SR / 2:
        m *= 1 / (1 + np.exp((lf - np.log2(hi)) / (soft / 4)))
    return np.fft.irfft(X * m, n)[:n0]


def sweep_band(x, f0, width_oct=0.6, win=1024, hop=256):
    """Полоса, центр которой бежит по кривой f0(t) (массив той же длины) — STFT с перекрытием."""
    n = len(x)
    w = np.hanning(win)
    out = np.zeros(n + win)
    norm = np.zeros(n + win)
    xp = np.concatenate([x, np.zeros(win)])
    f = np.fft.rfftfreq(win, 1 / SR)
    lf = np.log2(np.maximum(f, 1.0))
    for s in range(0, n, hop):
        seg = xp[s:s + win] * w
        c = f0[min(n - 1, s + win // 2)]
        m = np.exp(-0.5 * ((lf - np.log2(c)) / (width_oct / 2)) ** 2)
        y = np.fft.irfft(np.fft.rfft(seg) * m, win) * w
        out[s:s + win] += y
        norm[s:s + win] += w * w
    return out[:n] / np.maximum(norm[:n], 1e-3)


def env(n, attack, decay, at=0.0):
    """Огибающая: тишина до at, нарастание attack, экспоненциальный спад decay (с — до −60 дБ)."""
    t = np.arange(n) / SR - at
    e = np.where(t < 0, 0.0, np.where(t < attack, t / max(attack, 1e-4), np.exp(-(t - attack) * 6.9 / max(decay, 1e-3))))
    return e


def sine_sweep(n, f_from, f_to, curve=3.0):
    """n отсчётов синуса, частота плавно (экспонентой) от f_from к f_to."""
    t = np.arange(n) / SR
    u = t / max(t[-1], 1e-6)
    f = f_to + (f_from - f_to) * np.exp(-u * curve)
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def ping(n, at, freq, decay, amp, partials=((1.0, 1.0), (2.76, 0.45), (5.4, 0.2))):
    """Льдинка: затухающие негармоничные синусы (колокольчик) с мгновенной атакой."""
    out = np.zeros(n)
    i0 = int(at * SR)
    if i0 >= n:
        return out
    L = min(n - i0, int(decay * 1.4 * SR))
    t = np.arange(L) / SR
    y = np.zeros(L)
    for mul, a in partials:
        fr = freq * mul
        if fr > SR / 2.2:
            continue
        y += a * np.sin(2 * np.pi * fr * t + rng.uniform(0, 6.28)) * np.exp(-t * 6.9 / (decay / mul ** 0.5))
    out[i0:i0 + L] += amp * y
    return out


def clicks(n, times, lo=2500, hi=9000, amp=0.3):
    """Хруст: короткие щелчки отфильтрованного шума в моменты times."""
    out = np.zeros(n)
    for at in times:
        i0 = int(at * SR)
        L = int(rng.uniform(0.002, 0.007) * SR)
        if i0 + L >= n:
            continue
        b = rng.standard_normal(L) * np.exp(-np.arange(L) / (L / 4))
        out[i0:i0 + L] += b * amp * rng.uniform(0.4, 1.0)
    return band(out, lo, hi)


def tinkles(n, start, dur, count, lo=2200, hi=8500, amp=0.25, decay=(0.03, 0.14), dens=2.5):
    """Россыпь осколков: count льдинок с start на dur с, чаще в начале (dens — крутизна)."""
    out = np.zeros(n)
    for _ in range(count):
        at = start + dur * (rng.random() ** dens)
        f = np.exp(rng.uniform(np.log(lo), np.log(hi)))
        out += ping(n, at, f, rng.uniform(*decay), amp * rng.uniform(0.3, 1.0))
    return out


def thump(n, at, f_from, f_to, decay, amp):
    out = np.zeros(n)
    i0 = int(at * SR)
    L = n - i0
    if L <= 0:
        return out
    y = sine_sweep(L, f_from, f_to)
    out[i0:] = amp * y * env(L, 0.004, decay)
    return out


def reverb(x, sec=1.2, wet=0.25, damp=3000):
    L = int(sec * SR)
    ir = rng.standard_normal(L) * np.exp(-np.arange(L) / SR * 6.9 / sec)
    ir = band(ir, 120, damp)
    ir /= np.sqrt(np.sum(ir ** 2)) + 1e-9
    n = len(x) + L
    y = np.fft.irfft(np.fft.rfft(x, n) * np.fft.rfft(ir, n), n)[:len(x)]
    return x * (1 - wet) + y * wet * 2.2


def finish(x, peak=0.92, fade=0.05):
    x = x - np.mean(x)
    f = int(fade * SR)
    if f > 0:
        x[-f:] *= np.linspace(1, 0, f)
    x[: int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR))
    return x / (np.max(np.abs(x)) + 1e-9) * peak


def write(path, x):
    y = np.clip(x, -1, 1)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((y * 32767).astype(np.int16).tobytes())


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


def roar_voice(sec, f_curve, formants, rough=0.55, breath=0.35):
    """Голос: пила (гармоники до 4 кГц) с дрожью тона, хрипом (АМ), формантами и дыханием."""
    n = int(sec * SR)
    t = t_axis(sec)
    jit = band(rng.standard_normal(n), 0.5, 18) * 0.06
    f = f_curve(t) * (1 + 0.025 * np.sin(2 * np.pi * 5.3 * t) + jit)
    ph = 2 * np.pi * np.cumsum(f) / SR
    src = np.zeros(n)
    for k in range(1, 70):
        mask = (f * k < 4200).astype(float)
        src += mask * np.sin(k * ph) / k ** 0.9
    am = 1 + rough * band(rng.standard_normal(n), 25, 55) * 3
    src *= am
    v = np.zeros(n)
    for fc, bw, g in formants:
        v += band(src, fc / (1 + bw), fc * (1 + bw), 0.2) * g
    v += band(noise(sec), 450, 3200) * breath
    return v


ROAR_SRC = "/Users/zep/ASSETS/SFX/phatphrogstudio-dragon-voice-roar-477831.mp3"


def load_audio(path):
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", path, "-f", "s16le", "-ac", "1", "-ar", str(SR), "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.int16).astype(np.float64) / 32768


def pitch(x, k):
    """Ниже тоном и медленнее в k раз (k < 1): простая передискретизация."""
    n = int(len(x) / k)
    return np.interp(np.arange(n) * k, np.arange(len(x)), x)


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
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "public/sfx"
    only = sys.argv[2].split(",") if len(sys.argv) > 2 else None
    os.makedirs(out_dir, exist_ok=True)
    for name, (fn, mp3) in SOUNDS.items():
        if only and name not in only:
            continue
        x = fn()
        wav = os.path.join(out_dir, name + ".wav")
        write(wav, x)
        if mp3:
            mp = os.path.join(out_dir, name + ".mp3")
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-codec:a", "libmp3lame", "-b:a", "96k", mp], check=True)
            os.remove(wav)
            print(name, "mp3", round(os.path.getsize(mp) / 1024), "КБ")
        else:
            print(name, "wav", round(os.path.getsize(wav) / 1024), "КБ")
