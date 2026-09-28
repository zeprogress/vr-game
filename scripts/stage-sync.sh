#!/usr/bin/env bash
# Свежая копия данных прода (герои, лут в мире, сессии инвентаря) в локальный
# стенд. Локальные данные перед этим сохраняются в src/server/.data.bak-<время>.
# Прод при этом только читается.
set -euo pipefail
cd "$(dirname "$0")/.."
D=src/server/.data
mkdir -p "$D"
if ls "$D"/*.json >/dev/null 2>&1; then
  B="src/server/.data.bak-$(date +%Y%m%d-%H%M%S)"
  cp -r "$D" "$B"
  echo "локальные данные сохранены в $B"
fi
for f in players.json world.json invSessions.json; do
  scp -q "vrgame:/opt/vrgame/src/server/.data/$f" "$D/$f" 2>/dev/null && echo "  ← $f" || echo "  (нет $f на проде — пропуск)"
done
echo "готово: стенд возьмёт эти данные при следующем запуске (npm run stage)"
