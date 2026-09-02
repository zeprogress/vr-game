# scripts/quest — отладка игры прямо на шлеме

Игра крутится в Quest Browser (WebXR). Через ADB + CDP (Chrome DevTools Protocol)
можно читать её консоль, дёргать `window.game`, снимать экран — **не снимая шлем**,
в т.ч. во время immersive-сессии. VPN (v2RayTun) этому не мешает.

## Один раз за подключение шлема

```bash
scripts/quest/connect.sh
```

Пробрасывает `localhost:9222` → DevTools Quest Browser. Шлем — по USB или
`metavr device wifi_adb_set --enable true` по сети.

## Команды

| Скрипт | Что делает |
|---|---|
| `node scripts/quest/eval.mjs '<expr>'` | выполнить JS в игре, вернуть результат (`game.printLoadout()`, состояние боя, позиции) |
| `node scripts/quest/console.mjs [ms] [--eval '<expr>'] [--follow]` | поток `console.*` + ошибок/варнингов из игры |
| `node scripts/quest/watch.mjs [ms] [--follow]` | ставит перехваты `hooks.js` (события `[CAST]`, `[BURST]`, `[CAST-ABORT]`) и стримит консоль — под игровую сессию |
| `node scripts/quest/record.mjs [сек] [шаг]` | записать экран, забрать mp4, разложить на кадры в `.tmp/quest/…` |
| `hooks.js` | сам набор перехватов (инъекция через watch.mjs) |

## Типовой цикл проверки фичи

1. `scripts/quest/connect.sh`
2. `node scripts/quest/watch.mjs 180000 > .tmp/session.log &` (или `record.mjs`)
3. надеть шлем, потестить фичу
4. снять шлем → смотрим `.tmp/session.log` / кадры

## Прочее через metavr напрямую

- скриншот: MCP `take_screenshot` или `metavr capture screenshot -o out.png`
- системные краши/GPU: `metavr adb logcat -e 'Babylon|WebGL|FATAL' -l W`
- перфетто-трейс кадров: MCP `capture_perfetto_trace` → `analyze_trace`
