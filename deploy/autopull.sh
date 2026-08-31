#!/usr/bin/env bash
# Тянет новые коммиты из origin/main и передеплоивает, если HEAD изменился.
# Запускается по таймеру (vrgame-autopull.timer). Тихий, если обновлять нечего.
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
sudo -u vrgame npm run build
systemctl restart vrgame
echo "autopull: готово"
