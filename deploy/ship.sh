#!/usr/bin/env bash
# =============================================================================
#  VR GAME — шпаргалка деплоя (одним файлом)
# =============================================================================
#
#  Сохрани себе как ~/vrgame-ship.sh и запускай:  bash ~/vrgame-ship.sh
#
#  Что внутри — меню с четырьмя способами выкладки и сервисными командами.
#  Все пути и адреса — в блоке НАСТРОЙКИ, поменяй под себя.
#
#  Коротко, как это работает:
#   • Игра — Colyseus-сервер + веб-клиент на VPS (systemd юнит vrgame, папка /opt/vrgame).
#   • Пуш в main запускает автодеплой (таймер vrgame-autopull раз в 2 мин):
#     он ждёт зелёный CI, собирает на сервере и перезапускает игру.
#   • Unity-спектатор для стрима — отдельная сборка на Маке, лежит в dist/spectator,
#     стрим-ПК сам забирает новую версию за ≤5 минут.
#
# =============================================================================

set -uo pipefail   # без -e: интерактивное меню не должно закрываться от ошибки

# ----------------------------------------------------------------- НАСТРОЙКИ
PROJECT="${ZEP_PROJECT:-/Users/zep/VR GAME}"   # папка репозитория (с пробелом в имени — ок)
SSH_HOST="${ZEP_SSH:-vrgame}"                  # ssh-alias сервера (см. ~/.ssh/config)
APP_DIR="/opt/vrgame"                          # путь проекта на сервере
SITE="https://zepgame.duckdns.org"             # адрес игры

cd "$PROJECT" 2>/dev/null || { echo "нет папки проекта: $PROJECT"; exit 1; }

c_hdr() { printf '\n\033[1;36m%s\033[0m\n' "$*"; }
c_ok()  { printf '\033[1;32m%s\033[0m\n' "$*"; }
c_warn(){ printf '\033[1;33m%s\033[0m\n' "$*"; }
c_err() { printf '\033[1;31m%s\033[0m\n' "$*"; }
pause() { read -r -p "Enter — назад в меню… " _; }

HEAD_SHA() { git rev-parse --short HEAD; }

# Показать, что сейчас реально стоит на сервере (одна команда на всё).
server_state() {
  echo "— сейчас на сервере —"
  ssh -o BatchMode=yes -o ConnectTimeout=15 "$SSH_HOST" '
    printf "  версия веба : %s\n" "$(cat '"$APP_DIR"'/dist/.built 2>/dev/null || echo нет)"
    printf "  git HEAD    : %s\n" "$(git -C '"$APP_DIR"' rev-parse --short HEAD 2>/dev/null)"
    printf "  сервис      : %s\n" "$(systemctl is-active vrgame)"
    printf "  спектатор   : %s\n" "$(cat '"$APP_DIR"'/dist/spectator/version.txt 2>/dev/null || echo нет)"
    printf "  ошибки 5 мин: %s\n" "$(journalctl -u vrgame --since \"-5min\" --no-pager 2>/dev/null | grep -ci \"error\|traceback\")"
    echo "  диск        : занято $(df -h / | tail -1 | tr -s " " | cut -d" " -f3)"
  ' 2>/dev/null || c_err "  сервер недоступен (ssh $SSH_HOST)"
}

# Локальная проверка перед выкладкой: типы + тесты.
check_all() {
  c_hdr "Проверка: типы + тесты"
  npm run typecheck --silent && c_ok "  типы ок" || { c_err "  типы: ошибки"; return 1; }
  npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)" | sed 's/^/  /'
  npm test 2>&1 | grep -qE "^ℹ fail 0" && c_ok "  тесты зелёные" || { c_err "  тесты красные"; return 1; }
}

# --------------------------------------------------- 1. БЫСТРЫЙ ДЕПЛОЙ (~15 с)
# Сборка здесь, на сервер едут только изменённые файлы dist + рестарт.
# НЕ ждёт CI: пушит и сразу выкладывает. Для мелочей и баланса.
fast_deploy() {
  c_hdr "1. Быстрый деплой (deploy/fast.sh, ~15 с)"
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    c_warn "  есть незакоммиченные правки:"
    git status --short --untracked-files=no | sed 's/^/    /'
    read -r -p "  закоммитить всё с сообщением? (Enter — да, n — отмена): " msg_ok
    [ "${msg_ok:-}" = "n" ] && { c_warn "  отменено (закоммить сам)"; return; }
    read -r -p "  сообщение коммита: " msg
    git add -A && git commit -q -m "${msg:-правки}" || { c_err "  коммит не прошёл"; return; }
  fi
  echo "  коммит: $(HEAD_SHA)"
  time deploy/fast.sh
  c_ok "  готово — проверь $(SITE)"
}

# ------------------------------ 2. БЕЗОПАСНЫЙ ДЕПЛОЙ (через CI, ~3–5 мин)
# git push → автодеплой ждёт зелёный GitHub Actions → собирает на сервере.
# Единственный путь, где тесты и схема Unity проверяются ДО выкладки.
push_only() {
  c_hdr "2. Пуш с проверкой CI (автодеплой, ~3–5 мин)"
  check_all || { c_warn "  лучше не пушить: сначала починить"; return; }
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    read -r -p "  закоммитить и запушить все правки? (y/N): " yn
    [ "$yn" = "y" ] || { c_warn "  отменено"; return; }
    read -r -p "  сообщение коммита: " msg
    git add -A && git commit -q -m "${msg:-правки}" || { c_err "  коммит не прошёл"; return; }
  fi
  git push origin main || { c_err "  push не прошёл"; return; }
  c_ok "  запушено: $(HEAD_SHA) — автодеплой подхватит в течение 2 мин"
  echo "  смотреть прогресс:"
  echo "    ssh $SSH_HOST 'journalctl -u vrgame-autopull -f'"
  echo "  CI: gh run list --limit 1   (или открой Actions в браузере)"
}

# --------------------------------- 3. UNITY-СПЕКТАТОР (для стрима, ~2 мин)
# Пересобирает Windows/Linux? Нет: собирает Linux-сборку, пакует и выкладывает.
# Стрим-ПК обновится сам за ≤5 минут. Веб не трогает.
# ВАЖНО: сборка Unity требует доступа к ~/Library — из песочницы виснет на GI-кэше.
spectator_deploy() {
  c_hdr "3. Пересборка Unity-спектатора (~2 мин)"
  c_warn "  Компьютер со стримом подхватит новую версию за ≤5 мин сам."
  read -r -p "  собирать и выкладывать? (y/N): " yn
  [ "$yn" = "y" ] || { c_warn "  отменено"; return; }
  if pgrep -f "MacOS/Unity -projectPath" >/dev/null; then
    c_err "  редактор Unity открыт — закрой и повтори"; return
  fi
  time deploy/spectator-linux.sh
}

# --------------------------------------------- 4. ОТКАТ (вернуть прошлую версию)
# Откатывает и git, и прод. Безопасно: старый коммит собирается и выкладывается.
rollback() {
  c_hdr "4. Откат на предыдущий коммит"
  git log --oneline -5 | sed 's/^/  /'
  read -r -p "  сколько коммитов назад? (1 = отменить последний, 0 — отмена): " n
  [ "${n:-0}" = "0" ] && { c_warn "  отменено"; return; }
  b=$(git rev-parse "HEAD~$n") || { c_err "  нет такого коммита"; return; }
  c_warn "  откат на: $(git log --oneline -1 "$b")"
  read -r -p "  подтверди (y/N): " yn
  [ "$yn" = "y" ] || { c_warn "  отменено"; return; }
  git reset --hard "$b"
  check_all || c_warn "  (на старом коммите проверки не зелёные — выкладываю как есть)"
  deploy/fast.sh
}

# ------------------------------------------------------- СЕРВИСНЫЕ КОМАНДЫ
logs_live()   { c_hdr "Логи игры (Ctrl+C — выход)"; ssh "$SSH_HOST" 'journalctl -u vrgame -f'; }
logs_auto()   { c_hdr "Логи автодеплоя (Ctrl+C — выход)"; ssh "$SSH_HOST" 'journalctl -u vrgame-autopull -f'; }
restart()     { c_hdr "Перезапуск игры"; ssh "$SSH_HOST" 'systemctl restart vrgame && systemctl is-active vrgame'; }
disk_clean()  { c_hdr "Чистка диска на сервере"; ssh "$SSH_HOST" 'sudo journalctl --vacuum-size=200M; df -h / | tail -1'; }
ssh_shell()   { c_hdr "SSH на сервер (exit — выход)"; ssh "$SSH_HOST"; }
open_site()   { c_hdr "Открываю $SITE"; command -v open >/dev/null && open "$SITE" || echo "$SITE"; }

# ------------------------------------------------------------------- МЕНЮ
menu() {
  while true; do
    clear 2>/dev/null || true
    echo "=============================================================="
    echo "  VR GAME — деплой"
    echo "  проект: $PROJECT   →  $(HEAD_SHA) $(git log -1 --pretty=%s | cut -c1-40)"
    echo "=============================================================="
    echo "  1) БЫСТРО     deploy/fast.sh              ~15 с   (обходит CI)"
    echo "  2) БЕЗОПАСНО  git push + автодеплой + CI  ~3–5 мин"
    echo "  3) СПЕКТАТОР  Unity для стрима            ~2 мин"
    echo "  4) ОТКАТ      на прошлый коммит           ~20 с"
    echo "  ------------------------------------------------------------"
    echo "  5) Проверить: типы + тесты"
    echo "  6) Что сейчас на сервере"
    echo "  7) Логи игры (live)"
    echo "  8) Логи автодеплоя (live)"
    echo "  9) Перезапустить игру"
    echo "  d) Почистить диск на сервере"
    echo "  s) SSH на сервер"
    echo "  o) Открыть игру в браузере"
    echo "  q) Выход"
    echo "=============================================================="
    read -r -p "выбор: " ch
    case "$ch" in
      1) fast_deploy ;;
      2) push_only ;;
      3) spectator_deploy ;;
      4) rollback ;;
      5) check_all; pause ;;
      6) c_hdr "Состояние"; server_state; pause ;;
      7) logs_live ;;
      8) logs_auto ;;
      9) restart; pause ;;
      d|D) disk_clean; pause ;;
      s|S) ssh_shell ;;
      o|O) open_site ;;
      q|Q) exit 0 ;;
      *) continue ;;
    esac
    echo
  done
}

# Можно вызывать без меню: bash vrgame-ship.sh fast | push | spectator | rollback | check | state
case "${1:-}" in
  fast)      fast_deploy ;;
  push)      push_only ;;
  spectator) spectator_deploy ;;
  rollback)  rollback ;;
  check)     check_all ;;
  state)     server_state ;;
  ""|menu)   menu ;;
  *) echo "использование: $0 [fast|push|spectator|rollback|check|state]  (без аргумента — меню)"; exit 1 ;;
esac
