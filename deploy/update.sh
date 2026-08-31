#!/usr/bin/env bash
# Обновить VR GAME на сервере после git push. Запускать от root:  bash update.sh
set -euo pipefail
APPDIR=/opt/vrgame

git config --global --add safe.directory "$APPDIR" 2>/dev/null || true
cd "$APPDIR"
# Явная ветка: bare `git pull` иногда падает с "multiple branches".
sudo -u vrgame git fetch origin main
sudo -u vrgame git merge --ff-only origin/main
sudo -u vrgame npm ci
sudo -u vrgame npm run build
systemctl restart vrgame
echo "обновлено, сервер перезапущен"
