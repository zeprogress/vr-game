#!/bin/bash
# Двойной клик — временный публичный адрес игры (сервер + клиент) через
# Cloudflare Tunnel. Можно дать другу на Quest / телефон / другой ПК.
# Работает, пока это окно открыто. Ctrl+C — остановить.
cd "$(dirname "$0")" || exit 1

if ! command -v npm >/dev/null 2>&1; then
  echo "Не найден Node.js. Установи с https://nodejs.org (LTS)."
  read -r -p "Enter для выхода..."; exit 1
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "Нужен cloudflared (туннель Cloudflare)."
  if command -v brew >/dev/null 2>&1; then
    read -r -p "Поставить его через Homebrew? [y/N] " ans
    [ "$ans" = "y" ] || [ "$ans" = "Y" ] && brew install cloudflared
  fi
  command -v cloudflared >/dev/null 2>&1 || {
    echo "Поставь вручную: brew install cloudflared  (или https://github.com/cloudflare/cloudflared/releases)"
    read -r -p "Enter для выхода..."; exit 1
  }
fi

[ -d node_modules ] || npm install || { echo "npm install упал"; read -r -p "Enter..."; exit 1; }

# Игровой сервер + клиент по HTTP (публичный HTTPS даёт сам туннель).
npm run server >/tmp/vrgame-server.log 2>&1 &
SERVER_PID=$!
npm run dev >/tmp/vrgame-client.log 2>&1 &
CLIENT_PID=$!
trap 'kill $SERVER_PID $CLIENT_PID $TUNNEL_PID 2>/dev/null' EXIT

echo "Поднимаю сервер и клиент…"; sleep 4

echo
echo "=================================================="
echo "  Публичный адрес игры (действует пока окно открыто):"
echo "=================================================="
# --url http://localhost:5173: Vite отдаёт клиент и сам проксирует
# матчмейкинг + WebSocket на игровой сервер :2567.
cloudflared tunnel --url http://localhost:5173 2>&1 | while read -r line; do
  echo "$line"
  if echo "$line" | grep -qE 'https://[a-z0-9-]+\.trycloudflare\.com'; then
    url=$(echo "$line" | grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com')
    echo
    echo "  >>>  ОТКРОЙ:  $url   (и дай другу)"
    echo "  На Quest прими предупреждение Cloudflare, если появится."
    echo
  fi
done
