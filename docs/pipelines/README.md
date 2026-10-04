# Пайплайны ассетов ZEP GAME

- [models.md](models.md) — персонажи, мобы, пропы: источник → `inspect` → `prep` → `preview` → в игру.
- [locations.md](locations.md) — локации: бриф → заготовка → блок-аут → кит → scatter → выгрузка → проверка.

Инструменты: `npm run asset -- <команда>` (`scripts/asset.mjs`), скрипты Blender — `tools/blender/`.
Blender: `/Applications/Blender.app` или переменная `BLENDER`. Всё работает без интерфейса Blender;
Blender MCP нужен только для совместной доводки (живой Blender с аддоном MCP, порт 9876).

| Команда | Что делает |
|---|---|
| `inspect <модель>` | треугольники, материалы и цвета, текстуры, кости, клипы, рост, служебные меши |
| `preview <модель> <out.png> [--anim Run]` | лист 512×512: 4 ракурса (+4 кадра клипа) |
| `prep <вход> <выход.glb> [--height --rotz --tris --palette --clips --keep --merge]` | под стиль и бюджеты игры |
| `newloc <сцена.blend> [--size --relief]` | заготовка локации с коллекциями пайплайна |
| `scatter <сцена.blend> --kit <коллекция> [--count/--density --min-dist --slope --avoid --align]` | расстановка деталей по земле |
| `location <сцена.blend> <папка> [--name --step]` | GLB с инстансами + карта высот + коллайдеры + сводка бюджета |

Входящие файлы (скачанные/сгенерированные) — в `tools/inbox/` (не в git).
