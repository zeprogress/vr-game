"""
Синтез звуков существ (numpy) — общие кирпичи. Так сделаны звуки Ледяного гиганта
(tools/sfx/ice_giant_sfx.py — образец, docs/pipelines/creatures.md). Скрипт существа:

    from sfxlib import SR, rng, reseed, band, env, thump, clicks, tinkles, reverb, finish, run
    reseed(20261019)             # свой seed — повторный запуск даёт те же файлы
    def boss_step(): ...         # слои складываются: x = thump(...) + band(noise(...)) * env(...) + ...
    SOUNDS = {"boss-step": (boss_step, False)}   # True — длинный (рёв, смерть) → MP3
    if __name__ == "__main__": run(SOUNDS)

Слои: thump — низкий удар (синус, падающий по тону); band(noise) · env — шум в полосе (грохот, треск, шорох);
clicks — хруст (короткие щелчки); ping / tinkles — звон льда, стекла, металла (негармоничные «динь»);
sweep_band — свист с бегущей полосой (замах, ветер); roar_voice — голос (пила с формантами и хрипом);
reverb — пространство; finish — центр, фейды, нормализация.
Голоса (рёв, стон) лучше брать из сэмплов пользователя (load_audio + pitch ниже тоном), синтез — запасной.
Короткие боевые — WAV (MP3 сдвигает атаку на 10–25 мс), длинные — MP3. Проверка без ушей —
tools/sfx/spectrogram.py (огибающая + спектр), слушает пользователь.
"""
import os
import subprocess
import sys
import wave

import numpy as np

SR = 44100
rng = np.random.default_rng(0)


def reseed(seed):
    """Свой seed на скрипт существа: тот же объект rng (импортированный по имени — тоже), звуки воспроизводимы."""
    rng.bit_generator.state = np.random.default_rng(seed).bit_generator.state


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


def load_audio(path):
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", path, "-f", "s16le", "-ac", "1", "-ar", str(SR), "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.int16).astype(np.float64) / 32768


def pitch(x, k):
    """Ниже тоном и медленнее в k раз (k < 1): простая передискретизация."""
    n = int(len(x) / k)
    return np.interp(np.arange(n) * k, np.arange(len(x)), x)


def run(sounds, default_out="public/sfx"):
    """python3 <скрипт> [папка] [имя,имя] — записать звуки (все или перечисленные)."""
    out_dir = sys.argv[1] if len(sys.argv) > 1 else default_out
    only = sys.argv[2].split(",") if len(sys.argv) > 2 else None
    os.makedirs(out_dir, exist_ok=True)
    for name, (fn, mp3) in sounds.items():
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
