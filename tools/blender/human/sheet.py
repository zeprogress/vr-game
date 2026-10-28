"""Склейка кадров frames.py в листы: python3 tools/blender/human/sheet.py <папка> — <клип>_<вид>.png по рядам."""
import glob
import os
import re
import sys

from PIL import Image

d = sys.argv[1]
groups = {}
for p in glob.glob(os.path.join(d, "*_*_[0-9]*.png")):
    m = re.match(r"(.+)_(\d+)\.png$", os.path.basename(p))
    if m:
        groups.setdefault(m.group(1), []).append((int(m.group(2)), p))
for key, items in groups.items():
    ims = [Image.open(p) for _, p in sorted(items)]
    sheet = Image.new("RGB", (sum(i.width for i in ims), ims[0].height))
    x = 0
    for im in ims:
        sheet.paste(im, (x, 0))
        x += im.width
    sheet.save(os.path.join(d, key + ".png"))
    for _, p in items:
        os.remove(p)
    print(key)
