"""
Выравнивание громкости звуков (WAV, 16 бит, моно) — чтобы все сэмплы звучали одинаково громко.
Громкость — RMS по звучащей части (отсечены тихие хвосты); потолок пика — −1 dBFS, чтобы ничего не клиповало.
Перезаписывает файлы на месте.

Запуск: python3 tools/sfx/normalize_sfx.py [--target -20] public/sfx/hero-*.wav public/sfx/event-harp.wav
"""
import argparse
import wave

import numpy as np

PEAK_CEIL = 10 ** (-1 / 20)  # −1 dBFS


def read(path):
    with wave.open(path, "rb") as w:
        sr = w.getframerate()
        ch = w.getnchannels()
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768
    return data.reshape(-1, ch), sr, ch


def write(path, x, sr, ch):
    y = np.clip(x, -1, 1)
    with wave.open(path, "wb") as w:
        w.setnchannels(ch)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((y * 32767).astype(np.int16).tobytes())


def loudness(x):
    """RMS по звучащей части: отсечены отсчёты тише −40 dB от пика."""
    mono = x.mean(axis=1)
    peak = np.max(np.abs(mono))
    active = mono[np.abs(mono) > peak * 0.01]
    rms = np.sqrt(np.mean(active ** 2)) if active.size else 0.0
    return rms, peak


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", type=float, default=-20.0, help="целевой RMS, dBFS")
    ap.add_argument("files", nargs="+")
    args = ap.parse_args()
    target = 10 ** (args.target / 20)
    for path in args.files:
        x, sr, ch = read(path)
        rms, peak = loudness(x)
        if rms == 0:
            print(f"{path}: тишина, пропущено")
            continue
        gain = target / rms
        if peak * gain > PEAK_CEIL:
            gain = PEAK_CEIL / peak  # пик важнее: не даём клиповать
        y = x * gain
        new_rms, new_peak = loudness(y)
        write(path, y, sr, ch)
        print(f"{path.split('/')[-1]:28s} rms {20*np.log10(rms):6.1f} → {20*np.log10(new_rms):6.1f} dBFS, "
              f"пик {20*np.log10(peak):6.1f} → {20*np.log10(new_peak):6.1f} dBFS")


if __name__ == "__main__":
    main()
