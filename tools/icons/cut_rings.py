"""
Нарезка «Таблица фэнтезийных колец редкости.png» (RGBA): строки — тиры base/gold/legendary/ruby/heroic,
колонки — уровни кольца (не ровно число гнёзд). В игру идут картинки по PICK: имя ring_<тир>_<гнёзд>.webp →
(строка, колонка) таблицы. Клетка — квадрат 256 px с запасом по краю, webp.

  python3 tools/icons/cut_rings.py "<ASSETS>/CONCEPTS /Таблица фэнтезийных колец редкости.png" public/icons/jewels
"""
import sys
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGBA")
COLS = [(323, 547), (592, 813), (838, 1050), (1068, 1284)]
ROWS = [(94, 245), (295, 453), (498, 671), (708, 888), (926, 1123)]
TIERS = ["base", "gold", "legendary", "ruby", "heroic"]
# Тир и число гнёзд в игре → клетка таблицы (2026-10-23): у фиолетовой и рубиновой строк гнёзда — цветные камни.
PICK = {("base", 0): (0, 0), ("gold", 1): (1, 1), ("legendary", 1): (2, 1), ("legendary", 2): (2, 3), ("ruby", 2): (3, 2)}
WANT = {v: k for k, v in PICK.items()}
S = 256
FIT = 0.94
for ri, (r0, r1) in enumerate(ROWS):
    for ci, (c0, c1) in enumerate(COLS):
        cell = im.crop((c0 - 6, r0 - 6, c1 + 6, r1 + 6))
        bb = cell.split()[3].point(lambda v: 255 if v > 8 else 0).getbbox()
        cell = cell.crop(bb)
        side = max(cell.width, cell.height)
        sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        sq.paste(cell, ((side - cell.width) // 2, (side - cell.height) // 2))
        w = round(S * FIT)
        sq = sq.resize((w, w), Image.LANCZOS)
        canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        canvas.paste(sq, ((S - w) // 2, (S - w) // 2), sq)
        if (ri, ci) not in WANT:
            continue
        tier, n = WANT[(ri, ci)]
        canvas.save(f"{out}/ring_{tier}_{n}.webp", "WEBP", quality=90, method=6)
print("ok")
