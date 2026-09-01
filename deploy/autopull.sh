#!/usr/bin/env bash
# Тянет новые коммиты из origin/main и передеплоивает, если HEAD изменился.
# Запускается по таймеру (vrgame-autopull.timer). Тихий, если обновлять нечего.
#
# Перед сборкой делаем бэкап dist; если сборка упала — откатываем dist и НЕ
# трогаем сервер (прод остаётся на прошлой рабочей версии, а не в nginx 500).
set -euo pipefail
APPDIR=/opt/vrgame
cd "$APPDIR"

sudo -u vrgame git fetch --quiet origin main
LOCAL=$(sudo -u vrgame git rev-parse HEAD)
REMOTE=$(sudo -u vrgame git rev-parse origin/main)
[ "$LOCAL" = "$REMOTE" ] && exit 0

echo "autopull: $LOCAL -> $REMOTE"
sudo -u vrgame git merge --ff-only origin/main
sudo -u vrgame npm ci

sudo -u vrgame rm -rf dist.bak
[ -d dist ] && sudo -u vrgame cp -r dist dist.bak

if sudo -u vrgame npm run build; then
  sudo -u vrgame rm -rf dist.bak
  systemctl restart vrgame
  echo "autopull: готово"
else
  echo "autopull: СБОРКА УПАЛА — откатываю dist, сервер не трогаю"
  sudo -u vrgame rm -rf dist
  [ -d dist.bak ] && sudo -u vrgame mv dist.bak dist
  exit 1
fi
