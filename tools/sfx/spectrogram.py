"""
Звуки без ушей: лист со спектрограммами (лог-шкала 30 Гц…16 кГц) и огибающей сверху — по строке на файл,
плюс длина, пик и RMS в консоль. Видно: где атака (совпадает ли с кадром удара клипа), нет ли щелчка
в начале и обрыва в конце, где «мясо» звука по частотам (низ — удар, верх — звон/треск).
Так проверялись звуки Ледяного гиганта; окончательно слушает пользователь.

  python3 tools/sfx/spectrogram.py <out.png> public/sfx/giant-slam.wav public/sfx/giant-roar.mp3 …
"""
import struct
import subprocess
import sys
import wave
import zlib

import numpy as np

SR = 44100


def load(p):
    if p.endswith(".wav"):
        with wave.open(p) as w:
            x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16) / 32768
            return x if w.getnchannels() == 1 else x[:: w.getnchannels()], w.getframerate()
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", p, "-f", "s16le", "-ac", "1", "-ar", str(SR), "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.int16) / 32768, SR


def main(out, files, W=600, H=110):
    rows = []
    for p in files:
        x, sr = load(p)
        win = 1024
        hop = max(1, (len(x) - win) // W)
        S = []
        for i in range(W):
            seg = x[i * hop:i * hop + win]
            if len(seg) < win:
                seg = np.pad(seg, (0, win - len(seg)))
            S.append(np.abs(np.fft.rfft(seg * np.hanning(win))))
        S = np.array(S).T
        f = np.fft.rfftfreq(win, 1 / sr)
        ys = np.exp(np.linspace(np.log(30), np.log(16000), H))
        img = 20 * np.log10(S[np.clip(np.searchsorted(f, ys), 0, len(f) - 1)] + 1e-6)
        img = np.clip((img + 40) / 80, 0, 1)[::-1]
        envl = np.array([np.max(np.abs(x[i * hop:i * hop + hop + 1])) if i * hop < len(x) else 0 for i in range(W)])
        band = np.zeros((20, W))
        for i, e in enumerate(envl):
            band[20 - int(min(1.0, e) * 19) - 1:, i] = 1
        rows.append(np.vstack([band, img, np.ones((3, W)) * 0.3]))
        print(f"{p}: {len(x) / sr:.2f} с, пик {np.max(np.abs(x)):.2f}, rms {np.sqrt(np.mean(x ** 2)):.3f}")
    im = np.vstack(rows)
    data = (np.stack([im ** 0.8, im ** 1.2, np.sqrt(im)], -1) * 255).astype(np.uint8)
    h, w = data.shape[:2]
    raw = b"".join(b"\x00" + data[y].tobytes() for y in range(h))

    def chunk(t, b):
        return struct.pack(">I", len(b)) + t + b + struct.pack(">I", zlib.crc32(t + b) & 0xffffffff)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) \
        + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(out, "wb") as fo:
        fo.write(png)
    print("лист:", out)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2:])
