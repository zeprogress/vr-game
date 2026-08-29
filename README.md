# VR GAME

VR MMORPG (пет-проект). Общий мир: VR (Quest 2/3), браузер на десктопе, телефон.
Полный план разработки — в [PLAN.md](PLAN.md).

## Текущий этап: 1 — одиночный «ходячий скелет» (десктоп)

Пустая зона, вид от первого лица, WASD + мышь, коллизии и гравитация. Без сервера.

## Запуск

Двойной клик по `start.command` (macOS).

Или вручную:

```bash
npm install
npm run dev
```

Открыть http://localhost:5173. Кликнуть по подсказке — захват мыши.
`WASD` — движение, мышь — камера, `Esc` — выйти из захвата.

С телефона в той же Wi-Fi: адрес из строки **Network**, которую печатает Vite.

## Структура

```
index.html              страница + canvas
src/
  main.ts               точка входа, pointer lock
  engine/Game.ts         Engine + Scene + рендер-луп
  world/Zone.ts          земля, свет, препятствия
  player/PlayerController.ts  камера от первого лица, WASD, коллизии
```

Реструктуризация в монорепо (client / server / shared) — на этапе 4 (см. PLAN.md).
