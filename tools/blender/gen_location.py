"""
Локация с нуля по спецификации: npm run asset -- genloc <spec.json> <out.blend> [--preview лист.png]
Дальше выгрузка в игру: npm run asset -- location <out.blend> <папка>. Приёмы — docs/pipelines/locations.md.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import zep_lib as z  # noqa: E402
from zep_gen import location  # noqa: E402

a = z.args()
z.emit(location.build_file(a[0], a[1] if len(a) > 1 and not a[1].startswith("--") else None))
