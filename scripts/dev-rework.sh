#!/bin/bash
# Один терминал: сервер реворка (свои сейвы) + Vite-клиент.
# Ctrl+C останавливает оба процесса.
cd "$(dirname "$0")/.." || exit 1

kill_tree() {
  local pid="$1"
  [ -z "$pid" ] && return
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}

echo "=================================================="
echo "  REWORK: сервер :2567 + клиент :5173"
echo "  Сейвы: src/server/.data/rework"
echo "  Ctrl+C — остановить оба."
echo "=================================================="

npm run server:rework &
SERVER_PID=$!

cleanup() {
  trap - EXIT INT TERM
  echo
  echo "Останавливаю сервер реворка…"
  kill_tree "$SERVER_PID"
}
trap cleanup EXIT INT TERM

npm run dev
