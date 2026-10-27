#!/usr/bin/env bash
# Установка спектатора ZEP на компьютер со стримом (Ubuntu). Запуск из распакованного архива:
#   ./install.sh
# Ставит программу в ~/zep-spectator и две службы systemd (пользовательские, без sudo):
#   zep-spectator.service         — спектатор; упал или закрыт — запускается снова через 5 с;
#   zep-spectator-update.timer    — раз в 5 мин проверяет новую версию на сервере и ставит её сама.
# Чтобы стрим поднимался без человека: автовход в систему (Настройки → Пользователи → Автоматический вход).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$HOME/zep-spectator"
VER="$(cat "$HERE/VERSION" 2>/dev/null || echo local)"

mkdir -p "$APP/versions"
rm -rf "$APP/versions/$VER"
cp -a "$HERE" "$APP/versions/$VER"
ln -sfn "$APP/versions/$VER" "$APP/current"
cp "$HERE/update.sh" "$APP/update.sh"
chmod +x "$APP/update.sh" "$APP/current/Spectator.sh" "$APP/current/ZEP Spectator.x86_64"

UNITS="$HOME/.config/systemd/user"
mkdir -p "$UNITS"
cat > "$UNITS/zep-spectator.service" <<EOF
[Unit]
Description=ZEP Spectator (стрим)
After=graphical-session.target
PartOf=graphical-session.target

[Service]
ExecStart=$APP/current/Spectator.sh
Restart=always
RestartSec=5

[Install]
WantedBy=graphical-session.target
EOF
cat > "$UNITS/zep-spectator-update.service" <<EOF
[Unit]
Description=ZEP Spectator — проверка обновления

[Service]
Type=oneshot
ExecStart=$APP/update.sh
EOF
cat > "$UNITS/zep-spectator-update.timer" <<EOF
[Unit]
Description=ZEP Spectator — проверять обновление раз в 5 минут

[Timer]
OnBootSec=1min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
EOF

# Службам нужен экран: берём текущие DISPLAY/XAUTHORITY сеанса.
systemctl --user import-environment DISPLAY XAUTHORITY WAYLAND_DISPLAY XDG_RUNTIME_DIR 2>/dev/null || true
systemctl --user daemon-reload
systemctl --user enable --now zep-spectator-update.timer
systemctl --user enable zep-spectator.service
systemctl --user restart zep-spectator.service

# Старые версии и распакованный архив установки больше не нужны — место на диске.
for d in "$APP/versions"/*; do [ "$d" = "$APP/versions/$VER" ] || rm -rf "$d"; done
echo "Готово: версия $VER в $APP."
echo "Папку, из которой ставили ($HERE), и скачанный архив можно удалить."
echo "Спектатор запущен; обновления ставятся сами. Журнал: journalctl --user -u zep-spectator -f"
