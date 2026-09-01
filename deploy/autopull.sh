#!/usr/bin/env bash
# Тянет origin/main и передеплоивает. Таймер каждые 2 мин.
#
# Собранный коммит помечается в dist/.built — пока сборка не прошла, каждый тик
# повторяет попытку. Сборка идёт в dist.new и подменяет dist двумя быстрыми
# rename (нет секундного nginx-500 на время сборки). Упала — dist не тронут.
set -euo pipefail
APPDIR=/opt/vrgame
cd "$APPDIR"

# 1 ядро / 1 ГБ: сборку чуть придерживаем по приоритету, чтобы игровой сервер
# не голодал. НЕ idle-класс (на busy-боксе сборка могла зависнуть навсегда).
LOW="nice -n 10"

sudo -u vrgame git fetch --quiet origin main
REMOTE=$(sudo -u vrgame git rev-parse origin/main)
BUILT=$(cat dist/.built 2>/dev/null || echo none)

if [ "$BUILT" = "$REMOTE" ] && [ "$(sudo -u vrgame git rev-parse HEAD)" = "$REMOTE" ]; then
  exit 0
fi

echo "autopull: сборка $REMOTE (последняя успешная: $BUILT)"
sudo -u vrgame git merge --ff-only origin/main || sudo -u vrgame git reset --hard "$REMOTE"
sudo -u vrgame $LOW npm ci
sudo -u vrgame rm -rf dist.new

if sudo -u vrgame $LOW npx vite build --outDir dist.new; then
  sudo -u vrgame sh -c "echo $REMOTE > dist.new/.built"
  sudo -u vrgame rm -rf dist.old
  [ -d dist ] && sudo -u vrgame mv dist dist.old
  sudo -u vrgame mv dist.new dist
  sudo -u vrgame rm -rf dist.old
  systemctl restart vrgame
  echo "autopull: готово ($REMOTE)"
else
  sudo -u vrgame rm -rf dist.new
  echo "autopull: СБОРКА УПАЛА — прод на прошлой версии, повтор через 2 мин"
  exit 1
fi
