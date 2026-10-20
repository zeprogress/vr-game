# Пайплайны ассетов ZEP GAME — всё с нуля

Модели и локации **не берём готовыми**: Claude пишет короткую спецификацию (JSON), генераторы в Blender
строят из неё ассет. Спецификация — исходник в git (`art/models`, `art/locations`), результат воспроизводим
и правится числами, а не руками в Blender.

- [models.md](models.md) — мобы, боссы, герои (на скелете героев игры), пропы: формы-«глина» → сетка → скелет → клипы.
- [locations.md](locations.md) — локации: рельеф → раскраска → кит деталей → точки интереса → рассыпка → выгрузка.
- [creatures.md](creatures.md) — существо целиком (как Ледяной гигант): дизайн умений → риг → клипы ключами →
  механики на сервере → эффекты → синтез звуков → лаборатория → проверка; переделка старых мобов; умения героев.

## Команды (`npm run asset -- …`, Blender без интерфейса)

| Команда | Что делает |
|---|---|
| `gen <spec.json> <out.glb> [--preview лист.png] [--anims Idle,Walk]` | модель с нуля + лист превью (4 ракурса + строка кадров на клип) |
| `genloc <spec.json> <out.blend> [--preview лист.png]` | локация с нуля (.blend в формате пайплайна) + лист превью (сверху + 3 вида) |
| `location <сцена.blend> <папка> [--name --step]` | выгрузка локации: GLB с GPU-инстансами + карта высот + коллайдеры + бюджеты |
| `preview <модель> <out.png> [--anims all]` | лист превью любой модели |
| `inspect <модель>` | треугольники, материалы, кости, клипы, рост |
| `prep`, `newloc`, `scatter` | утилиты: доводка готового GLB под бюджеты, пустая заготовка сцены, ручная рассыпка |
| `anim <скрипт.py> <риг.blend> <out.glb> [--only Walk,Run]` | клипы своим скриптом существа (`tools/blender/icegiant_anim.py` — образец) |
| `frames <модель> <out.png> --clips "Attack:0,0.6;Walk" [--view side]` | раскадровка клипов: строка на клип, столбцы — секунды |
| `feet <модель> [--clips Walk,Run]` | стопы в шаге/беге: касание земли, уход под землю (доли роста) |
| `weights <модель>` | веса скина: вершины без костей, кости без вершин |

Код генераторов — `tools/blender/zep_gen/` (`sdf` формы и сетка, `spec` скелеты/шаблоны, `parts` детали,
`anim` клипы, `build` сборка модели, `kit` детали локаций, `location` сборка локации).
Промежуточные файлы (.blend, пробные GLB) — `art/build/` (не в git).

## Живой Blender (MCP)

Blender 5.1+ с аддоном **MCP** (Blender Lab): Preferences → System → Network → *Allow Online Access*;
Add-ons → MCP → *Start MCP Bridge Server* (+ *Auto-start*). Тогда Claude собирает то же самое прямо
в открытом Blender — пользователь крутит модель, смотрит клипы, говорит что поправить:

```python
import sys, importlib; sys.path.insert(0, "/Users/zep/VR GAME/tools/blender")
import zep_gen.build as b; importlib.reload(b)
b.build_file("/Users/zep/VR GAME/art/models/BogBrute.json", live=True)        # коллекция с именем модели
import zep_gen.location as L; importlib.reload(L)
L.build_file("/Users/zep/VR GAME/art/locations/MossGrove.json", live=True)     # отдельная сцена с именем локации
```

## Экономия токенов (правила для Claude)

- Итерация = правка чисел в спецификации → `gen`/`genloc` с `--preview` → **одна** картинка-лист.
  Не открывать .blend/GLB как текст, не делать серии скриншотов.
- Скриншот окна Blender через MCP — только когда пользователь смотрит вместе и нужно показать результат.
- Для анимаций — `--anims` только нужные клипы (у героя их 17).
- Пачка ассетов — цикл в одной команде, итог — таблица чисел из JSON.
