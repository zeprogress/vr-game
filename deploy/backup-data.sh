#!/usr/bin/env bash
# Резервная копия сейвов (персонажи, мир, чат) → /var/backups/vrgame/data-<дата>.tar.gz.
# Хранится 14 последних. Запуск: раз в 6 часов (vrgame-backup.timer) или вручную.
set -euo pipefail
SRC=/opt/vrgame/src/server/.data
DST=/var/backups/vrgame
mkdir -p "$DST"
tar -czf "$DST/data-$(date +%Y%m%d-%H%M%S).tar.gz" -C "$SRC" .
ls -1t "$DST"/data-*.tar.gz | tail -n +57 | xargs -r rm -f
