"""
Модель с нуля по спецификации: npm run asset -- gen <spec.json> <out.glb> [--blend out.blend]
Спецификация и приёмы — docs/pipelines/models.md. Итог — JSON (треугольники, кости, клипы, рост, предупреждения).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import zep_lib as z  # noqa: E402
from zep_gen import build  # noqa: E402

a = z.args()
res = build.build_file(a[0], a[1] if len(a) > 1 and not a[1].startswith("--") else None, z.opt(a, "--blend"))
z.emit(res)
