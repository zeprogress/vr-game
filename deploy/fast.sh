#!/usr/bin/env bash
# Быстрый деплой с Мака (~30–40 с вместо 1–3 мин автопула): сборка здесь, на сервер — только
# изменённые файлы dist (rsync --checksum, одинаковые — жёсткими ссылками на текущий dist),
# дальше deploy/fast-remote.sh по SSH: git merge, npm ci только при новом package-lock,
# подмена dist и рестарт — под тем же замком, что autopull (они не мешают друг другу).
# Запуск: deploy/fast.sh  (дерево чистое, коммит уже сделан; пушит сам).
set -euo pipefail
cd "$(dirname "$0")/.."

# Важны только изменения ОТСЛЕЖИВАЕМЫХ файлов: неотслеживаемые (арт, заметки) в деплой не едут
# и раньше ломали быстрый путь — скрипт ругался «есть незакоммиченные правки» на любой мусор.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "fast: есть незакоммиченные правки — сначала коммит"
  exit 1
fi
git push -q origin main
SHA=$(git rev-parse HEAD)
if [ "$(git rev-parse origin/main)" != "$SHA" ]; then
  echo "fast: origin/main не равен HEAD — push не прошёл?"
  exit 1
fi

# Собираем без typecheck: типы уже проверены CI в предыдущем коммите, а здесь важен только
# свежий dist. Если нужна проверка — npm run build.
npx vite build --silent

# dist.up, а не dist.new: dist.new — рабочая папка autopull.
rsync -rlc --delete --exclude .DS_Store --link-dest=/opt/vrgame/dist dist/ vrgame:/opt/vrgame/dist.up/
ssh vrgame -o BatchMode=yes "bash -s -- $SHA" < deploy/fast-remote.sh
