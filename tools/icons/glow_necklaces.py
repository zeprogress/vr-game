"""Свечение ожерелий по тиру: ореол цвета тира под картинкой; от обычного (нет) к мифическому синему (сильнее всех)."""
import sys
from PIL import Image, ImageChops, ImageEnhance, ImageFilter

src, out = sys.argv[1], sys.argv[2]
S = 256
FIT = 0.84  # доля клетки под само ожерелье — остальное место ореолу
BRIGHT = 1.3  # 2026-10-23: картинки ожерелий ярче (были тёмные рядом с кольцами)
# тир: (цвет, сила, радиус широкого, радиус плотного)
GLOW = {
    # 2026-10-23: свечение слабее в целом, разница между тирами — сильнее (шаг силы и радиуса растёт).
    "base": ((0, 0, 0), 0.0, 1, 1),
    "gold": ((255, 190, 60), 0.12, 4, 2),
    "legendary": ((170, 100, 255), 0.3, 6, 2),
    "ruby": ((255, 40, 80), 0.55, 8, 3),
    "heroic": ((60, 150, 255), 0.95, 11, 4),
}
for tier, (col, k, r1, r2) in GLOW.items():
    for n in range(4):
        im = Image.open(f"{src}/necklace_{tier}_{n}.webp").convert("RGBA")
        w = round(S * FIT)
        im = im.resize((w, w), Image.LANCZOS)
        a0 = im.split()[3]
        im = ImageEnhance.Brightness(im).enhance(BRIGHT)
        im.putalpha(a0)
        base = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        base.paste(im, ((S - w) // 2, (S - w) // 2), im)
        canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        if k > 0:
            a = base.split()[3]
            wide = a.filter(ImageFilter.GaussianBlur(r1)).point(lambda v: min(255, int(v * 1.2 * k)))
            tight = a.filter(ImageFilter.GaussianBlur(r2)).point(lambda v: min(255, int(v * 1.0 * k)))
            ga = ImageChops.lighter(wide, tight)
            glow = Image.new("RGBA", (S, S), col + (0,))
            glow.putalpha(ga)
            canvas = Image.alpha_composite(canvas, glow)
        canvas = Image.alpha_composite(canvas, base)
        canvas.save(f"{out}/necklace_{tier}_{n}.webp", "WEBP", quality=90, method=6)
print("ok")
