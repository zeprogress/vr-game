#!/usr/bin/env bash
# Тянет origin/main и передеплоивает. Запускается по таймеру каждые 2 мин.
#
# Собранный коммит помечается в dist/.built. Пока сборка успешно не прошла для
# текущего HEAD — каждый тик ПОВТОРЯЕТ попытку (раньше упавшая сборка advance-ила
# HEAD и застревала: "нечего делать", хотя dist старый).
#
# Бэкап dist перед сборкой; упала — откат, сервер не трогаем (прод на прошлой
# рабочей версии, а не nginx 500).
set -euo pipefail
APPDIR=/opt/vrgame
cd "$APPDIR"

sudo -u vrgame git fetch --quiet origin main
REMOTE=$(sudo -u vrgame git rev-parse origin/main)
BUILT=$(cat dist/.built 2>/dev/null || echo none)

# Уже собрано для этого коммита — и рабочий каталог на нём — выходим.
if [ "$BUILT" = "$REMOTE" ] && [ "$(sudo -u vrgame git rev-parse HEAD)" = "$REMOTE" ]; then
  exit 0
fi

echo "autopull: сборка $REMOTE (последняя успешная: $BUILT)"
sudo -u vrgame git merge --ff-only origin/main || sudo -u vrgame git reset --hard "$REMOTE"
sudo -u vrgame npm ci

sudo -u vrgame rm -rf dist.bak
[ -d dist ] && sudo -u vrgame cp -r dist dist.bak

if sudo -u vrgame npm run build; then
  sudo -u vrgame sh -c "echo $REMOTE > dist/.built"
  sudo -u vrgame rm -rf dist.bak
  systemctl restart vrgame
  echo "autopull: готово ($REMOTE)"
else
  echo "autopull: СБОРКА УПАЛА — откат dist, сервер не трогаю, повтор через 2 мин"
  sudo -u vrgame rm -rf dist
  [ -d dist.bak ] && sudo -u vrgame mv dist.bak dist
  exit 1
fi
