#!/usr/bin/env bash
# Обновить VR GAME на сервере после git push. Запускать от root:  bash update.sh
set -euo pipefail
APPDIR=/opt/vrgame

cd "$APPDIR"
sudo -u vrgame git pull --ff-only
sudo -u vrgame npm ci
sudo -u vrgame npm run build
systemctl restart vrgame
echo "обновлено, сервер перезапущен"
