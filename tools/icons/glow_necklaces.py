"""Свечение ожерелий по тиру: ореол цвета тира под картинкой; от обычного (нет) к мифическому синему (сильнее всех)."""
import sys
from PIL import Image, ImageFilter, ImageChops

src, out = sys.argv[1], sys.argv[2]
S = 256
FIT = 0.84  # доля клетки под само ожерелье — остальное место ореолу
# тир: (цвет, сила, радиус широкого, радиус плотного)
GLOW = {
    "base": ((0, 0, 0), 0.0, 1, 1),
    "gold": ((255, 190, 60), 0.45, 7, 3),
    "legendary": ((170, 100, 255), 0.65, 9, 3),
    "ruby": ((255, 40, 80), 0.8, 11, 4),
    "heroic": ((60, 150, 255), 1.0, 14, 5),
}
for tier, (col, k, r1, r2) in GLOW.items():
    for n in range(4):
        im = Image.open(f"{src}/necklace_{tier}_{n}.webp").convert("RGBA")
        w = round(S * FIT)
        im = im.resize((w, w), Image.LANCZOS)
        base = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        base.paste(im, ((S - w) // 2, (S - w) // 2), im)
        canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        if k > 0:
            a = base.split()[3]
            wide = a.filter(ImageFilter.GaussianBlur(r1)).point(lambda v: min(255, int(v * 1.6 * k)))
            tight = a.filter(ImageFilter.GaussianBlur(r2)).point(lambda v: min(255, int(v * 1.2 * k)))
            ga = ImageChops.lighter(wide, tight)
            glow = Image.new("RGBA", (S, S), col + (0,))
            glow.putalpha(ga)
            canvas = Image.alpha_composite(canvas, glow)
        canvas = Image.alpha_composite(canvas, base)
        canvas.save(f"{out}/necklace_{tier}_{n}.webp", "WEBP", quality=90, method=6)
print("ok")
