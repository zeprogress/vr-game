#!/usr/bin/env bash
# Включает автодеплой: раз в 2 минуты сервер тянет origin/main и,
# если есть новые коммиты, пересобирает клиент и перезапускает сервер.
# Запускать от root один раз:  bash deploy/install-autopull.sh
set -euo pipefail
APPDIR=/opt/vrgame

chmod +x "$APPDIR/deploy/autopull.sh"
cp "$APPDIR/deploy/vrgame-autopull.service" /etc/systemd/system/vrgame-autopull.service
cp "$APPDIR/deploy/vrgame-autopull.timer"   /etc/systemd/system/vrgame-autopull.timer
systemctl daemon-reload
systemctl enable --now vrgame-autopull.timer

# Пересобрать и перезапустить текущий код (autopull это делает только при
# НОВЫХ коммитах, а сейчас код уже на месте — просто ещё не собран).
git config --global --add safe.directory "$APPDIR" 2>/dev/null || true
cd "$APPDIR"
sudo -u vrgame git fetch origin main
sudo -u vrgame git merge --ff-only origin/main
sudo -u vrgame npm ci
sudo -u vrgame npm run build
systemctl restart vrgame

echo
echo "Автодеплой включён. Теперь достаточно 'git push' — обновится за ~2 минуты."
echo "Статус:   systemctl list-timers vrgame-autopull"
echo "Логи:     journalctl -u vrgame-autopull -f"
