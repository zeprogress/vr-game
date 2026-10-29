#!/bin/sh
# Проверка, что C#-схема (unity/Assets/Scripts/Schema) не разошлась с исходником
# src/shared/net/schema.ts. Запускается в CI (Linux) и локально (macOS).
# Если кто-то добавил поле в schema.ts и забыл перегенерировать — скрипт падает,
# и деплой не пропустит рассинхрон (раньше он молча ломал Unity-спектатор).
#
# Обновить схему вручную: bash unity/tools/gen-schema.sh (или этот же скрипт + git add).
set -e
cd "$(dirname "$0")/../.."

OUT=unity/Assets/Scripts/Schema

# Перегенерировать во временную копию? Проще — в ту же папку, затем сравнить с git.
# Генерация детерминированная (schema-codegen), поэтому повторный прогон даёт те же байты.
npx --no-install schema-codegen src/shared/net/schema.ts --csharp --namespace ZepSchema --output "$OUT"

# Экранирование поля `int` (ключевое слово C#) — как в gen-schema.sh, но переносимо
# между macOS (BSD sed, нужен `-i ''`) и Linux (GNU sed, `-i` без аргумента).
if sed --version >/dev/null 2>&1; then
  # GNU sed (Linux, CI).
  sed -i -E 's/ushort int =/ushort @int =/; s/this\.int([^a-zA-Z_])/this.@int\1/g; s/nameof\(int\)/nameof(@int)/g' "$OUT"/*.cs
else
  # BSD sed (macOS).
  sed -i '' -E 's/ushort int =/ushort @int =/; s/this\.int([^a-zA-Z_])/this.@int\1/g; s/nameof\(int\)/nameof(@int)/g' "$OUT"/*.cs
fi

# Отличие от закоммиченной схемы = дрейф. Сообщаем понятно и падаем.
if ! git diff --quiet -- "$OUT"; then
  echo "✗ C#-схема разошлась с src/shared/net/schema.ts." >&2
  echo "  Обнови: bash unity/tools/gen-schema.sh && git add unity/Assets/Scripts/Schema" >&2
  git diff --stat -- "$OUT" >&2
  exit 1
fi

echo "✓ Unity-схема совпадает с schema.ts"
