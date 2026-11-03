# Как поднять сервер ветки `rework`

Локальный запуск копии игры для проверки реворка. Клиент и сервер — те же, что
в `main`, но сейвы лучше держать отдельно: реворк меняет кривую опыта и дерево,
и `players.json` мигрируется при первом запуске.

## 1. Ветка и зависимости

```bash
cd "/Users/zep/VR GAME"
git switch rework
git pull                       # если ветка есть на сервере
npm install                    # если node_modules ещё нет
```

## 2. Сервер с отдельными сейвами (рекомендую)

```bash
npm run server:rework
```

Это то же, что `npm run server`, но `PLAYERS_FILE=src/server/.data/rework/players.json`:
сейвы основной ветки не трогаются, миграции XP/дерева остаются в `rework/`.
Сервер слушает **:2567**.

Если хочешь играть на своих текущих сейвах — сначала сделай резервную копию:

```bash
cp src/server/.data/players.json src/server/.data/players.json.bak-before-rework
npm run server
```

Помни: после этого `main` тоже увидит мигрированные сейвы. Для сравнения веток
лучше отдельный файл из `server:rework`.

## 3. Клиент

Второй терминал:

```bash
npm run dev          # обычный HTTP, http://localhost:5173
# или
npm run dev:vr       # HTTPS для Quest/телефона, https://localhost:5173
```

Vite проксирует `/matchmake`, `/api` и WebSocket комнаты на `:2567` — отдельный
адрес сервера в клиенте указывать не нужно. Открой `http://localhost:5173`.

Для шлема: запусти `npm run dev:vr`, возьми IP из строки Network и открой
`https://<IP>:5173` в Quest (сертификат самоподписанный — прими предупреждение).

`start.command` / `share.command` поднимают **обычный** `npm run server`, без
отдельного файла сейвов. Для реворка используй команды выше; для туннеля
другу — `npm run tunnel` при уже запущенном клиенте.

## 4. Вход

Обычные ники пускаются только после кода из Twitch-чата. Для локальной проверки
проще админ-ник и пароль:

```bash
ADMIN_PASS=любой-пароль npm run server:rework
```

На экране входа: ник `zep` (или `zeprogress`), пароль — тот, что задал в
`ADMIN_PASS`. Новому герою выбери класс в списке на экране входа: он фиксируется
навсегда, умения работают только с оружием этого класса.

## 5. Быстрая проверка

```bash
npm run typecheck
npm test
npm run lab:check
npm run lab:balance -- --quick --only skills --lvl 33
```

Лаборатория: `npm run lab` → `http://localhost:5173/lab.html?s=skills`.
Порт сервера меняется только через `GAME_SERVER_PORT`; тогда прокси Vite тоже
нужно править — по умолчанию не трогай.
