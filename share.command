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

TLOG=$(mktemp -t vrgame-tunnel)

# Показать адрес крупно и понятно.
announce() {
  echo
  echo "=================================================="
  echo "  СВЯЗЬ УСТАНОВЛЕНА. Публичный адрес игры:"
  echo
  echo "  >>>  $1"
  echo
  echo "  Дай эту ссылку другу. Работает, пока окно открыто."
  echo "  На Quest прими предупреждение, если появится."
  [ -n "$2" ] && echo "  $2"
  echo "=================================================="
  echo
}

# --- Способ 1: Cloudflare Tunnel (порт 7844, без ограничения по времени) ---
#
# Адрес cloudflared печатает сразу, ещё до соединения с Cloudflare, поэтому
# ждём именно «Registered tunnel connection» — иначе скрипт выглядит успешным
# даже когда туннель не встал.
cloudflared tunnel --url http://localhost:5173 >"$TLOG" 2>&1 &
TUNNEL_PID=$!
CF_OK=""
for _ in $(seq 1 25); do
  sleep 1
  if grep -q "Registered tunnel connection" "$TLOG" 2>/dev/null; then CF_OK=1; break; fi
  # Порт 7844 не пропускают — ждать дальше бессмысленно.
  if grep -qE "Allow outbound|TLS handshake with edge error" "$TLOG" 2>/dev/null; then break; fi
  kill -0 "$TUNNEL_PID" 2>/dev/null || break
done

if [ -n "$CF_OK" ]; then
  announce "$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$TLOG" | head -1)"
  wait "$TUNNEL_PID"
  exit 0
fi

# --- Способ 2: запасной туннель по 443 (Cloudflare не прошёл) ---
#
# Обычно причина одна: VPN или прокси не пропускает порт 7844. Порт 443 они
# пропускают всегда, поэтому запасной туннель идёт по SSH через 443.
# Ставить и регистрировать ничего не надо, но бесплатная сессия живёт час.
kill "$TUNNEL_PID" 2>/dev/null
echo
echo "--------------------------------------------------"
echo "  Cloudflare не прошёл: похоже, VPN или прокси не пропускает порт 7844."
echo "  Перехожу на запасной туннель через порт 443."
echo "  (Он бесплатный, но живёт 1 час — потом перезапусти скрипт.)"
echo "--------------------------------------------------"

: >"$TLOG"

# Запасной туннель пускает по любому SSH-ключу, но без ключа скатывается
# к паролю и молча зависает на приглашении. Поэтому заводим отдельный ключ
# только под туннель — чужие ключи и настройки не трогаем.
KEY="$HOME/.ssh/vrgame_tunnel"
if [ ! -f "$KEY" ]; then
  echo "  Создаю ключ для туннеля: $KEY"
  mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
  ssh-keygen -t ed25519 -N "" -C "vrgame-tunnel" -f "$KEY" -q || {
    echo "  Не удалось создать ключ."; read -r -p "Enter для выхода..."; exit 1; }
fi

ssh -n -p 443 \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o BatchMode=yes \
    -o IdentitiesOnly=yes \
    -i "$KEY" \
    -o ServerAliveInterval=30 \
    -o ExitOnForwardFailure=yes \
    -R0:localhost:5173 a.pinggy.io >"$TLOG" 2>&1 &
TUNNEL_PID=$!

for _ in $(seq 1 30); do
  sleep 1
  URL=$(tr -d '\r' <"$TLOG" | grep -Eo 'https://[a-z0-9.-]+\.(pinggy-free\.link|free\.pinggy\.net)' | head -1)
  [ -n "$URL" ] && break
  kill -0 "$TUNNEL_PID" 2>/dev/null || break
done

if [ -n "$URL" ]; then
  announce "$URL" "Адрес живёт 1 час — потом запусти скрипт заново."
  wait "$TUNNEL_PID"
  exit 0
fi

echo
echo "=================================================="
echo "  Ни один туннель не поднялся."
echo
echo "  Скорее всего мешает VPN или прокси. Попробуй:"
echo "   1) выключить VPN и запустить скрипт заново;"
echo "   2) либо прописать в VPN прямое подключение для"
echo "      argotunnel.com, trycloudflare.com и pinggy.io."
echo
echo "  Лог туннеля: $TLOG"
echo "=================================================="
read -r -p "Enter для выхода..."
