"""
Нарезка сетки ожерелий 5×4 (колонки — тиры base/gold/legendary/ruby/heroic, строки — 0..3 гнезда) по связным
областям альфы: цепочки, залезающие в соседнюю клетку, остаются у своего ожерелья. Клетка — квадрат 256 px, webp.

  python3 tools/icons/cut_necklaces.py "<ASSETS>/CONCEPTS /Сетка фантазийных ожерелий разных редкостей.png" <папка>
  python3 tools/icons/glow_necklaces.py <папка> public/icons/jewels
"""
import sys
import numpy as np
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGBA")
A = np.array(im)
mask = A[:, :, 3] > 8
# Связные области альфы (8-соседство) — простая разметка без scipy.
H, W = mask.shape
lab = np.zeros((H, W), np.int32)
n = 0
sizes_l, cy_l, cx_l = [], [], []
for y0 in range(H):
    row = mask[y0]
    for x0 in np.nonzero(row & (lab[y0] == 0))[0]:
        if lab[y0, x0]:
            continue
        n += 1
        stack = [(y0, x0)]
        lab[y0, x0] = n
        cnt = sy = sx = 0
        while stack:
            y, x = stack.pop()
            cnt += 1; sy += y; sx += x
            for dy in (-1, 0, 1):
                yy = y + dy
                if yy < 0 or yy >= H:
                    continue
                for dx in (-1, 0, 1):
                    xx = x + dx
                    if 0 <= xx < W and mask[yy, xx] and not lab[yy, xx]:
                        lab[yy, xx] = n
                        stack.append((yy, xx))
        sizes_l.append(cnt); cy_l.append(sy / cnt); cx_l.append(sx / cnt)
sizes = np.array(sizes_l)
cols = [(25, 318), (336, 624), (635, 920), (929, 1215), (1228, 1516)]
rows = [(0, 238), (238, 470), (470, 709), (709, 1024)]
tiers = ["base", "gold", "legendary", "ruby", "heroic"]
SIZE = 256
for ci, (c0, c1) in enumerate(cols):
    for ri, (r0, r1) in enumerate(rows):
        # Области, чей центр масс внутри клетки (цепочки, торчащие в соседнюю клетку, остаются у своего ожерелья).
        keep = np.zeros(n + 1, bool)
        for k, (cy, cx) in enumerate(zip(cy_l, cx_l), start=1):
            if c0 <= cx < c1 and r0 <= cy < r1 and sizes[k - 1] > 30:
                keep[k] = True
        m = keep[lab]
        ys, xs = np.nonzero(m)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        crop = A[y0:y1, x0:x1].copy()
        crop[~m[y0:y1, x0:x1], 3] = 0
        img = Image.fromarray(crop, "RGBA")
        side = max(img.width, img.height)
        canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
        canvas = canvas.resize((SIZE, SIZE), Image.LANCZOS)
        name = f"necklace_{tiers[ci]}_{ri}.webp"
        canvas.save(f"{out}/{name}", "WEBP", quality=90, method=6)
        print(name, (x1 - x0, y1 - y0))
