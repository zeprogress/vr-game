#!/usr/bin/env python3
"""Значки плашек для Unity-клиента: щиты защит моба (MOB_ARMOR_LOOK в src/shared/look.ts, щит MOB_DEF_SHIELD)
и значки платформы/бота (эмодзи, как drawPlatformIcon в client/ui/NameTag.ts).
python3 scripts/unity-icons.py → unity/Assets/Resources/Icons/*.png (нужен Pillow).
Пути SVG короткие (M/L/H/V/C и строчные) — разбираем сами: SVG-отрисовщик ImageMagick теряет обводку."""
import os, re
from PIL import Image, ImageDraw, ImageFont

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = os.path.join(root, "unity/Assets/Resources/Icons")
os.makedirs(out, exist_ok=True)
look = open(os.path.join(root, "src/shared/look.ts"), encoding="utf8").read()
shield = re.search(r'MOB_DEF_SHIELD = "([^"]+)"', look).group(1)
armor = {"phys": 1, "ranged": 2, "magic": 4, "dodge": 8, "parry": 16, "reflect": 32}  # MOB_ARMOR в shared/mobs.ts

SIZE = 128
SS = 8  # сглаживание: рисуем крупнее и уменьшаем
K = SIZE * SS / 20  # квадрат 20×20, как в NameTag.drawDefIcon


def subpaths(d):
    """Путь SVG → список ломаных (кривые Безье — по 16 точек)."""
    toks = re.findall(r"[MmLlHhVvCcZz]|-?\d*\.?\d+", d)
    res, cur, i, cmd = [], [], 0, None
    x = y = sx = sy = 0.0
    num = lambda: float(toks[i])
    while i < len(toks):
        if re.match(r"[A-Za-z]", toks[i]):
            cmd = toks[i]
            i += 1
            if cmd in "Zz":
                cur.append((sx, sy))
                x, y = sx, sy
                continue
        rel = cmd.islower()
        c = cmd.upper()
        if c == "M":
            nx, ny = float(toks[i]), float(toks[i + 1]); i += 2
            if rel: nx += x; ny += y
            if cur: res.append(cur)
            x, y, sx, sy = nx, ny, nx, ny
            cur = [(x, y)]
            cmd = "l" if rel else "L"
        elif c == "L":
            nx, ny = float(toks[i]), float(toks[i + 1]); i += 2
            if rel: nx += x; ny += y
            x, y = nx, ny; cur.append((x, y))
        elif c == "H":
            nx = num(); i += 1
            x = x + nx if rel else nx; cur.append((x, y))
        elif c == "V":
            ny = num(); i += 1
            y = y + ny if rel else ny; cur.append((x, y))
        elif c == "C":
            p = [float(t) for t in toks[i:i + 6]]; i += 6
            if rel: p = [p[0] + x, p[1] + y, p[2] + x, p[3] + y, p[4] + x, p[5] + y]
            for s in range(1, 17):
                t = s / 16; u = 1 - t
                cur.append((u**3 * x + 3 * u * u * t * p[0] + 3 * u * t * t * p[2] + t**3 * p[4],
                            u**3 * y + 3 * u * u * t * p[1] + 3 * u * t * t * p[3] + t**3 * p[5]))
            x, y = p[4], p[5]
    if cur: res.append(cur)
    return [[(px * K, py * K) for px, py in sp] for sp in res]


def stroke(draw, pts, color, w):
    w = int(w * K)
    draw.line(pts, fill=color, width=w, joint="curve")
    for p in (pts[0], pts[-1]):  # круглые концы
        draw.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=color)


for name, color, sym in re.findall(r'\{ bit: MOB_ARMOR\.(\w+), color: "([^"]+)", sym: "([^"]*)" \}', look):
    img = Image.new("RGBA", (SIZE * SS, SIZE * SS), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    sh = subpaths(shield)[0]
    stroke(dr, sh, (6, 8, 12, 230), 2.4)
    dr.polygon(sh, fill=color)
    for sp in subpaths(sym) if sym else []:
        stroke(dr, sp, "#15171d", 2.3)
    dst = os.path.join(out, f"armor_{armor[name]}.png")
    img.resize((SIZE, SIZE), Image.LANCZOS).save(dst)
    print(dst)

emoji = ImageFont.truetype("/System/Library/Fonts/Apple Color Emoji.ttc", 160)
for name, ch in {"plat_1": "🖥", "plat_2": "📱", "plat_3": "🥽", "bot": "🤖"}.items():
    img = Image.new("RGBA", (160, 160), (0, 0, 0, 0))
    ImageDraw.Draw(img).text((0, 0), ch, font=emoji, embedded_color=True)
    dst = os.path.join(out, f"{name}.png")
    img.resize((SIZE, SIZE), Image.LANCZOS).save(dst)
    print(dst)
