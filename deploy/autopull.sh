#!/usr/bin/env bash
# Тянет новые коммиты из origin/main и передеплоивает, если HEAD изменился.
# Запускается по таймеру (vrgame-autopull.timer). Тихий, если обновлять нечего.
#
# Сборка идёт в dist.new и подменяет dist только при успехе — упавшая сборка
# больше НЕ оставляет прод с пустым dist (nginx 500). Тайпчек в деплое не
# гоняем (он тяжёлый по памяти на 1 ГБ — делается локально перед коммитом).
set -euo pipefail
APPDIR=/opt/vrgame
cd "$APPDIR"

sudo -u vrgame git fetch --quiet origin main
LOCAL=$(sudo -u vrgame git rev-parse HEAD)
REMOTE=$(sudo -u vrgame git rev-parse origin/main)
[ "$LOCAL" = "$REMOTE" ] && exit 0

echo "autopull: $LOCAL -> $REMOTE"
sudo -u vrgame git merge --ff-only origin/main
sudo -u vrgame npm ci --no-audit --no-fund

if sudo -u vrgame env NODE_OPTIONS=--max-old-space-size=768 npx vite build --outDir dist.new --emptyOutDir; then
  sudo -u vrgame rm -rf dist
  sudo -u vrgame mv dist.new dist
  systemctl restart vrgame
  echo "autopull: готово"
else
  sudo -u vrgame rm -rf dist.new
  echo "autopull: СБОРКА УПАЛА — прод остался на старой версии, сервер не трогали"
  exit 1
fi
