#!/usr/bin/env bash
# Тянет origin/main и передеплоивает. Таймер каждые 2 мин.
#
# Собранный коммит помечается в dist/.built — пока сборка не прошла, каждый тик
# повторяет попытку. Сборка идёт в dist.new и подменяет dist двумя быстрыми
# rename (нет секундного nginx-500 на время сборки). Упала — dist не тронут.
set -euo pipefail
APPDIR=/opt/vrgame
cd "$APPDIR"

# 1 ядро / 1 ГБ: сборку чуть придерживаем по приоритету, чтобы игровой сервер
# не голодал. НЕ idle-класс (на busy-боксе сборка могла зависнуть навсегда).
LOW="nice -n 10"
# Куча Node для сборки: при 1 ГБ RAM лишнее уйдёт в swap (2 ГБ), а не в OOM.
export NODE_OPTIONS="--max-old-space-size=2048"

# fetch может упасть по авторизации (токен в remote-URL протух / кэш истёк).
# Явно об этом говорим, а не глотаем в общем "expected flush after ref listing".
if ! sudo -u vrgame git fetch --quiet origin main; then
  echo "autopull: git fetch не смог — проверь токен в 'git remote -v' (github_pat_...)"
  exit 1
fi
REMOTE=$(sudo -u vrgame git rev-parse origin/main)
BUILT=$(cat dist/.built 2>/dev/null || echo none)

if [ "$BUILT" = "$REMOTE" ] && [ "$(sudo -u vrgame git rev-parse HEAD)" = "$REMOTE" ]; then
  exit 0
fi

echo "autopull: сборка $REMOTE (последняя успешная: $BUILT)"
free -h | sed 's/^/autopull: /' # видно, если сборка потом упадёт по памяти
sudo -u vrgame git merge --ff-only origin/main || sudo -u vrgame git reset --hard "$REMOTE"
sudo -u vrgame $LOW npm ci
sudo -u vrgame rm -rf dist.new

# Перед сборкой — сбросить кэш страниц (освободить RAM), и до 3 попыток подряд:
# пик памяти плавает, повтор в ту же минуту быстрее, чем ждать следующий тик таймера.
build_ok=0
for attempt in 1 2 3; do
  sync; echo 1 > /proc/sys/vm/drop_caches || true
  sudo -u vrgame rm -rf dist.new
  # sudo сбрасывает окружение (env_reset) — NODE_OPTIONS передаём явно, иначе куча 493 МБ и OOM.
  if sudo -u vrgame env NODE_OPTIONS="$NODE_OPTIONS" $LOW npx vite build --outDir dist.new; then build_ok=1; break; fi
  echo "autopull: попытка сборки $attempt не удалась"
done

if [ "$build_ok" = 1 ]; then
  sudo -u vrgame sh -c "echo $REMOTE > dist.new/.built"
  sudo -u vrgame rm -rf dist.old
  [ -d dist ] && sudo -u vrgame mv dist dist.old
  sudo -u vrgame mv dist.new dist
  sudo -u vrgame rm -rf dist.old
  systemctl restart vrgame
  echo "autopull: готово ($REMOTE)"
else
  sudo -u vrgame rm -rf dist.new
  echo "autopull: СБОРКА УПАЛА — прод на прошлой версии, повтор через 2 мин"
  exit 1
fi
