#!/bin/bash
# Двойной клик — запускает локальный дев-сервер игры.
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

echo "Запускаю дев-сервер. Открой http://localhost:5173"
echo "С телефона в той же Wi-Fi — по адресу, который покажет Vite (Network)."
echo "Ctrl+C — остановить."
( sleep 2 && open http://localhost:5173 ) &
npm run dev
