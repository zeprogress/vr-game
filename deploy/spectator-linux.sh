#!/usr/bin/env bash
# Выложить Unity-спектатора для Linux: сборка на Маке → архив → сервер (dist/spectator).
# Компьютер со стримом сам заберёт новую версию за ≤5 мин (unity/linux/update.sh) и перезапустит спектатора.
# Запуск: deploy/spectator-linux.sh            — собрать и выложить (редактор Unity должен быть закрыт);
#         deploy/spectator-linux.sh --no-build — выложить уже собранное.
set -euo pipefail
cd "$(dirname "$0")/.."
U=/Applications/Unity/Hub/Editor/6000.3.27f1/Unity.app/Contents/MacOS/Unity
B=unity/Builds/Spectator-linux

if [ "${1:-}" != "--no-build" ]; then
  if pgrep -f "MacOS/Unity -projectPath" >/dev/null; then echo "закройте редактор Unity"; exit 1; fi
  "$U" -batchmode -quit -nographics -projectPath "$PWD/unity" -executeMethod SliceSetup.Build -logFile /tmp/zep-slice.log
  "$U" -batchmode -quit -projectPath "$PWD/unity" -buildTarget Linux64 -executeMethod SliceSetup.BuildSpectatorLinux -logFile /tmp/zep-linux.log
  grep -q "спектатор StandaloneLinux64: Succeeded" /tmp/zep-linux.log || { echo "сборка не удалась: /tmp/zep-linux.log"; exit 1; }
fi
[ -f "$B/ZEP Spectator.x86_64" ] || { echo "нет сборки в $B"; exit 1; }

VER="$(git rev-parse --short HEAD)-$(date +%Y%m%d%H%M)"
cp unity/linux/install.sh unity/linux/update.sh "$B/"
chmod +x "$B/install.sh" "$B/update.sh" "$B/Spectator.sh" "$B/ZEP Spectator.x86_64"
echo "$VER" > "$B/VERSION"
OUT="$(mktemp -d)"
tar -czf "$OUT/ZEP-Spectator-linux.tar.gz" -C unity/Builds --exclude '*_BurstDebugInformation_DoNotShip' -s ',^Spectator-linux,ZEP-Spectator,' Spectator-linux
echo "$VER" > "$OUT/version.txt"
# Папка/файлы должны принадлежать vrgame (не root), иначе autopull упрётся в
# «mv dist/spectator → dist.new/spectator: Permission denied» при деплое (см. autopull.sh).
ssh vrgame -o BatchMode=yes "sudo -u vrgame mkdir -p /opt/vrgame/dist/spectator"
# Сначала архив, потом версия: компьютер со стримом не увидит новую версию раньше её архива.
rsync -t --rsync-path='sudo -u vrgame rsync' "$OUT/ZEP-Spectator-linux.tar.gz" vrgame:/opt/vrgame/dist/spectator/
rsync -t --rsync-path='sudo -u vrgame rsync' "$OUT/version.txt" vrgame:/opt/vrgame/dist/spectator/
rm -rf "$OUT"
echo "выложено: $VER — https://zepgame.duckdns.org/spectator/ZEP-Spectator-linux.tar.gz"
