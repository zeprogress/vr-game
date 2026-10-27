#!/usr/bin/env bash
# Обновление спектатора ZEP (зовёт zep-spectator-update.timer раз в 5 мин, можно и руками).
# На сервере лежат version.txt и ZEP-Spectator-linux.tar.gz (кладёт deploy/spectator-linux.sh с Мака).
# Новая версия — скачать, распаковать рядом, переключить ссылку current и перезапустить спектатора.
set -euo pipefail
BASE="${ZEP_SPECTATOR_URL:-https://zepgame.duckdns.org/spectator}"
APP="$HOME/zep-spectator"

NEW="$(curl -fsS --max-time 20 "$BASE/version.txt" | tr -d '[:space:]')" || { echo "сервер недоступен"; exit 0; }
CUR="$(cat "$APP/current/VERSION" 2>/dev/null || echo none)"
[ -n "$NEW" ] && [ "$NEW" != "$CUR" ] || exit 0

echo "обновление $CUR → $NEW"
# Скачиваем и распаковываем рядом с программой (тот же диск — без лишней копии при переносе); архив удаляем
# сразу после распаковки: на компьютере стрима мало места.
TMP="$APP/.update"
rm -rf "$TMP"
mkdir -p "$TMP/x"
trap 'rm -rf "$TMP"' EXIT
curl -fsS --max-time 600 -o "$TMP/s.tar.gz" "$BASE/ZEP-Spectator-linux.tar.gz"
tar -xzf "$TMP/s.tar.gz" -C "$TMP/x"
rm -f "$TMP/s.tar.gz"
SRC="$(find "$TMP/x" -maxdepth 2 -name 'ZEP Spectator.x86_64' -printf '%h' -quit)"
[ -n "$SRC" ] || { echo "в архиве нет программы"; exit 1; }
echo "$NEW" > "$SRC/VERSION"
rm -rf "$APP/versions/$NEW"
mv "$SRC" "$APP/versions/$NEW"
chmod +x "$APP/versions/$NEW/Spectator.sh" "$APP/versions/$NEW/ZEP Spectator.x86_64"
ln -sfn "$APP/versions/$NEW" "$APP/current"
# Новый скрипт обновления — тоже из архива.
[ -f "$APP/current/update.sh" ] && cp "$APP/current/update.sh" "$APP/update.sh.new" && chmod +x "$APP/update.sh.new" && mv -f "$APP/update.sh.new" "$APP/update.sh"  # mv — не портить идущий скрипт
# --no-restart: зовёт сам Spectator.sh перед стартом — перезапускать нечего.
[ "${1:-}" = "--no-restart" ] || systemctl --user restart zep-spectator.service || true
# Старые версии не храним — только текущую (мало места).
for d in "$APP/versions"/*; do [ "$d" = "$APP/versions/$NEW" ] || rm -rf "$d"; done
echo "стоит $NEW"
