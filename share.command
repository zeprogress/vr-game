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
echo "Поднимаю туннель… (адрес появится, когда связь установится)"
echo

# --url http://localhost:5173: Vite отдаёт клиент и сам проксирует
# матчмейкинг + WebSocket на игровой сервер :2567.
#
# Адрес печатаем ТОЛЬКО после «Registered tunnel connection»: cloudflared
# выдаёт ссылку сразу, ещё до того как связь с Cloudflare установлена,
# и без этой проверки скрипт выглядит успешным, даже когда туннель не встал.
url=""
warned=""
cloudflared tunnel --url http://localhost:5173 2>&1 | while read -r line; do
  echo "$line"

  case "$line" in
    *trycloudflare.com*)
      [ -n "$url" ] || url=$(echo "$line" | grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com')
      ;;
  esac

  case "$line" in
    *"Registered tunnel connection"*)
      echo
      echo "=================================================="
      echo "  СВЯЗЬ УСТАНОВЛЕНА. Публичный адрес игры:"
      echo
      echo "  >>>  $url"
      echo
      echo "  Дай эту ссылку другу. Работает, пока окно открыто."
      echo "  На Quest прими предупреждение Cloudflare, если появится."
      echo "=================================================="
      echo
      ;;
  esac

  # Типичная беда: VPN/прокси не пропускает порт 7844, на котором работает
  # туннель. Обычный интернет при этом есть, поэтому причина неочевидна.
  case "$line" in
    *"Allow outbound"*7844*|*"no recent network activity"*|*"TLS handshake with edge error"*)
      if [ -z "$warned" ]; then
        warned=1
        echo
        echo "--------------------------------------------------"
        echo "  ТУННЕЛЬ НЕ ВСТАЁТ. Почти всегда причина одна:"
        echo "  включён VPN или прокси, и он не пропускает порт 7844."
        echo
        echo "  Что делать:"
        echo "   1) выключи VPN на время игры и запусти скрипт заново;"
        echo "   2) либо в настройках VPN пропиши прямое подключение"
        echo "      для argotunnel.com и trycloudflare.com."
        echo
        echo "  Ссылка выше работать НЕ будет, пока это не починено."
        echo "--------------------------------------------------"
        echo
      fi
      ;;
  esac
done
