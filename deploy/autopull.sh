#!/usr/bin/env bash
# Тянет origin/main и передеплоивает. Таймер каждые 2 мин.
#
# Собранный коммит помечается в dist/.built — пока сборка не прошла, каждый тик
# повторяет попытку. Сборка идёт в dist.new и подменяет dist двумя быстрыми
# rename (нет секундного nginx-500 на время сборки). Упала — dist не тронут.
set -euo pipefail
APPDIR=/opt/vrgame
cd "$APPDIR"

# Общий замок с быстрым деплоем (deploy/fast.sh): пока он подменяет dist — ждём,
# а потом видим .built == origin/main и выходим без сборки.
exec 9>/run/vrgame-deploy.lock
flock 9

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

# ---- Гейт CI: не выкладываем коммит, пока GitHub Actions не сказал «зелёно» ----
# Раньше деплой стартовал сразу после fetch и мог увезти в прод коммит с упавшими
# тестами/типами (CI к тому моменту ещё не отработал). Теперь:
#   success            → деплоим;
#   failure/cancelled  → НЕ деплоим, громко пишем в журнал, ждём исправления;
#   queued/in_progress → тик ничего не делает, вернёмся через 2 минуты;
#   CI молчит дольше CI_GATE_MAX_MIN — деплоим с предупреждением (защита от залипшего CI).
# Отключить гейт: CI_GATE=0 (например, в Environment дропина).
REPO_SLUG="zeprogress/vr-game"
CI_GATE="${CI_GATE:-1}"
CI_GATE_MAX_MIN="${CI_GATE_MAX_MIN:-25}"
STAMP_DIR="/var/lib/vrgame"
ci_state() { # $1 sha → success|failure|pending|none|error
  local sha=$1 json
  json=$(curl -fsS --max-time 20 -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/${REPO_SLUG}/commits/${sha}/check-runs" 2>/dev/null) || { echo error; return; }
  printf '%s' "$json" | node -e '
    let s="";
    process.stdin.on("data", d => s += d).on("end", () => {
      let j; try { j = JSON.parse(s); } catch { console.log("error"); return; }
      const runs = j.check_runs || [];
      if (!runs.length) return console.log("none");
      if (runs.some(r => r.status !== "completed")) return console.log("pending");
      if (runs.some(r => r.conclusion && !["success", "neutral", "skipped"].includes(r.conclusion))) return console.log("failure");
      console.log("success");
    });' 2>/dev/null || echo error
}
if [ "$CI_GATE" = "1" ]; then
  STATE=$(ci_state "$REMOTE")
  case "$STATE" in
    success) echo "autopull: CI зелёный ($REMOTE)" ;;
    failure)
      echo "autopull: CI КРАСНЫЙ — деплой отменён ($REMOTE). Починить и запушить заново."
      exit 1 ;;
    *)
      mkdir -p "$STAMP_DIR"
      STAMP="$STAMP_DIR/ci-wait-${REMOTE}"
      NOW=$(date +%s)
      FIRST=$(cat "$STAMP" 2>/dev/null || echo "$NOW")
      [ -f "$STAMP" ] || echo "$FIRST" > "$STAMP"
      WAITED=$(( NOW - FIRST ))
      if [ "$WAITED" -lt $(( CI_GATE_MAX_MIN * 60 )) ]; then
        echo "autopull: ждём CI ($STATE, ${WAITED}с из ${CI_GATE_MAX_MIN}мин) — $REMOTE"
        exit 0
      fi
      echo "autopull: CI молчит ${WAITED}с — деплою с предупреждением (проверь Actions вручную)"
      ;;
  esac
fi

free -h | sed 's/^/autopull: /' # видно, если сборка потом упадёт по памяти
sudo -u vrgame git merge --ff-only origin/main || sudo -u vrgame git reset --hard "$REMOTE"
# Зависимости — только если сменился package-lock (метка — в node_modules; так же в fast-remote.sh).
LOCKH=$(sudo -u vrgame git rev-parse HEAD:package-lock.json)
if [ "$(cat node_modules/.vrgame-lock 2>/dev/null)" != "$LOCKH" ]; then
  sudo -u vrgame $LOW npm ci
  sudo -u vrgame sh -c "echo $LOCKH > node_modules/.vrgame-lock"
fi
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
  # Кэш озвучки чата живёт в dist/tts — переносим в новую сборку.
  if [ -d dist/tts ]; then sudo -u vrgame mv dist/tts dist.new/tts; fi
  # Сборка Unity-спектатора для Linux (deploy/spectator-linux.sh) — тоже не из git.
  # Страховка: если спектатора выложили от root (старая версия скрипта / вручную),
  # чинем владельца до переноса, иначе mv упрётся в Permission denied и сорвёт подмену dist.
  if [ -e dist/spectator ]; then sudo chown -R vrgame:vrgame dist/spectator; fi
  if [ -d dist/spectator ]; then sudo -u vrgame mv dist/spectator dist.new/spectator; fi
  sudo -u vrgame rm -rf dist.old
  [ -d dist ] && sudo -u vrgame mv dist dist.old
  sudo -u vrgame mv dist.new dist
  sudo -u vrgame rm -rf dist.old
  systemctl restart vrgame
  rm -f "$STAMP_DIR/ci-wait-${REMOTE}" 2>/dev/null || true
  echo "autopull: готово ($REMOTE)"
else
  sudo -u vrgame rm -rf dist.new
  echo "autopull: СБОРКА УПАЛА — прод на прошлой версии, повтор через 2 мин"
  exit 1
fi
