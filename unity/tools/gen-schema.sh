#!/bin/sh
# C#-классы состояния из src/shared/net/schema.ts. Поле `int` (атрибут ИНТ) — ключевое слово C#, экранируем.
set -e
cd "$(dirname "$0")/../.."
OUT=unity/Assets/Scripts/Schema
npx --no-install schema-codegen src/shared/net/schema.ts --csharp --namespace ZepSchema --output "$OUT"
sed -i '' -E 's/ushort int =/ushort @int =/; s/this\.int([^a-zA-Z_])/this.@int\1/g; s/nameof\(int\)/nameof(@int)/g' "$OUT"/*.cs
