#!/bin/bash
# Двойной клик — запускает дев-сервер с HTTPS, чтобы работал VR на Quest.
# WebXR требует защищённого соединения, поэтому поднимаем vite с
# самоподписанным сертификатом и показываем адрес для шлема.
cd "$(dirname "$0")" || exit 1

if ! command -v npm >/dev/null 2>&1; then
  echo "Не найден Node.js. Установи с https://nodejs.org (LTS) и запусти снова."
  read -r -p "Enter для выхода..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Первый запуск: ставлю зависимости..."
  npm install || { echo "npm install упал"; read -r -p "Enter..."; exit 1; }
fi

# IP в локальной сети — по нему заходить со шлема и телефона.
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)

echo
echo "=================================================="
echo "  Сервер игры (HTTPS — нужен для VR)"
echo "=================================================="
echo "  На этом компьютере:  https://localhost:5173"
if [ -n "$LAN_IP" ]; then
  echo "  В шлеме Quest:       https://$LAN_IP:5173"
else
  echo "  В шлеме Quest:       см. строку Network ниже"
fi
echo
echo "  Сертификат самоподписанный — браузер шлема покажет"
echo "  предупреждение. Жми «Advanced» -> «Proceed»."
echo "  Ctrl+C — остановить сервер."
echo "=================================================="
echo

( sleep 3 && open https://localhost:5173 ) &
npm run dev:vr
