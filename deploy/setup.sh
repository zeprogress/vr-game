#!/usr/bin/env bash
# Первичная установка VR GAME на чистый Ubuntu-сервер (22.04 / 24.04).
# Запускать от root:  bash setup.sh <домен> <git-url>
# Пример: bash setup.sh zepgame.duckdns.org https://github.com/zeprogress/vr-game.git
set -euo pipefail

DOMAIN="${1:?использование: setup.sh <домен> <git-url>}"
REPO="${2:?использование: setup.sh <домен> <git-url>}"
APPDIR=/opt/vrgame
NODE_MAJOR=22

echo ">>> Пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git nginx ufw
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt "$NODE_MAJOR" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
fi

echo ">>> Пользователь и код"
id vrgame >/dev/null 2>&1 || useradd --system --create-home --home-dir "$APPDIR" --shell /usr/sbin/nologin vrgame
if [ -d "$APPDIR/.git" ]; then
  sudo -u vrgame git -C "$APPDIR" pull --ff-only
else
  rm -rf "$APPDIR"
  git clone "$REPO" "$APPDIR"
  chown -R vrgame:vrgame "$APPDIR"
fi

echo ">>> Зависимости и сборка клиента"
cd "$APPDIR"
sudo -u vrgame npm ci
sudo -u vrgame npm run build

echo ">>> systemd-сервис"
sed "s#__APPDIR__#$APPDIR#g" deploy/vrgame.service > /etc/systemd/system/vrgame.service
systemctl daemon-reload
systemctl enable --now vrgame

echo ">>> nginx"
sed "s#__DOMAIN__#$DOMAIN#g; s#__APPDIR__#$APPDIR#g" deploy/nginx-vrgame.conf > /etc/nginx/sites-available/vrgame
ln -sf /etc/nginx/sites-available/vrgame /etc/nginx/sites-enabled/vrgame
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo ">>> Файрвол"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null

echo ">>> HTTPS (Let's Encrypt)"
apt-get install -y -qq certbot python3-certbot-nginx
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
  --register-unsafely-without-email --redirect
systemctl restart vrgame

echo
echo "=========================================="
echo "  Готово:  https://$DOMAIN"
echo "  Логи сервера:  journalctl -u vrgame -f"
echo "=========================================="
