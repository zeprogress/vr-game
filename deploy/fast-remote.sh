#!/usr/bin/env bash
# Серверная половина deploy/fast.sh (приходит по SSH через stdin, от root).
# dist.up уже залит с Мака. Всё — от имени vrgame (иначе сломаются права: озвучка, автопул).
set -euo pipefail
SHA=$1
cd /opt/vrgame

# Тот же замок, что у autopull.sh: пока один подменяет dist, второй ждёт, а потом видит .built == SHA.
exec 9>/run/vrgame-deploy.lock
flock 9

if [ "$(cat dist/.built 2>/dev/null)" = "$SHA" ]; then
  rm -rf dist.up
  echo "fast: $SHA уже собран (успел autopull)"
  exit 0
fi

sudo -u vrgame git fetch --quiet origin main
if [ "$(sudo -u vrgame git rev-parse origin/main)" != "$SHA" ]; then
  echo "fast: на GitHub main не $SHA — отмена"
  rm -rf dist.up
  exit 1
fi
sudo -u vrgame git merge --ff-only --quiet origin/main || sudo -u vrgame git reset --quiet --hard "$SHA"

# Зависимости сервера — только если сменился package-lock (метка — в node_modules).
LOCKH=$(sudo -u vrgame git rev-parse HEAD:package-lock.json)
if [ "$(cat node_modules/.vrgame-lock 2>/dev/null)" != "$LOCKH" ]; then
  sudo -u vrgame npm ci --no-audit --no-fund
  sudo -u vrgame sh -c "echo $LOCKH > node_modules/.vrgame-lock"
fi

chown -R vrgame:vrgame dist.up
# Кэш озвучки чата живёт в dist/tts — переносим, а не теряем.
if [ -d dist/tts ]; then mv dist/tts dist.up/tts; fi
# Сборка Unity-спектатора для Linux (deploy/spectator-linux.sh) — тоже не из git, переносим.
if [ -d dist/spectator ]; then mv dist/spectator dist.up/spectator; fi
# Полный SHA — autopull сверяет его с origin/main.
sudo -u vrgame sh -c "echo $SHA > dist.up/.built"
rm -rf dist.old
if [ -d dist ]; then mv dist dist.old; fi
mv dist.up dist
rm -rf dist.old
systemctl restart vrgame
echo "fast: готово ($SHA)"
