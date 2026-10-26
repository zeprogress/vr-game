# ZEP GAME — Unity-клиент (вертикальный срез)

Unity 6.3 LTS (6000.3.27f1), URP. Сервер — тот же Colyseus 0.15 (`src/server`), комната `zone`.

## Открыть
Unity Hub → Add → папка `unity/`. Сцена `Assets/Scenes/Slice.unity`.

## Пересобрать срез
- Рельеф и деревья из `src/shared/terrain.ts`/`trees.ts`: `npx tsx scripts/unity-heightmap.mts`
- C#-схема из `src/shared/net/schema.ts`: `unity/tools/gen-schema.sh`
- Сцена, URP, уровни качества: меню **Zep → Build Slice**
- Розовые материалы после обновления glTFast: **Zep → Reimport Models**

## Вход на сервер
Объект `Net` в сцене: `serverUrl` (локально `ws://localhost:2567`), `nick`, `adminPass`.
Обычные ники сервер пускает только после кода из чата Twitch, поэтому для теста —
админ-ник с `ADMIN_PASS` сервера.

## Спектатор (стрим)
Сцена `Assets/Scenes/Spectator.unity`: тот же мир без героя, вход с ключом спектатора,
камерой рулит `SpectatorDirector` — перенос `src/client/spectator/SpectatorCamera.ts`
(обзор, орбита, бок, дуэль, группа, погоня, дрон, напротив, моб, босс, кинопути
и вступление «Вся поляна»). Пульт работает как с веб-спектатором: кадр, авто,
«только боты», плавность камеры. F3 — строка состояния. Кинопути и константы берутся
из `Assets/Terrain/spectator.json` (тот же `scripts/unity-heightmap.mts`).
Катакомбы, рейд, башня, оверлей и звук пока не перенесены.

Программа для OBS: **Zep → Build Spectator (macOS / Windows)** → `unity/Builds/…`.
Сервер задаётся при запуске:
`open "unity/Builds/Spectator-mac/ZEP Spectator.app" --args -server wss://zepgame.duckdns.org`

## Управление
ПК: WASD, ПКМ — обзор, колесо — дистанция, ЛКМ — удар.
Телефон: левая половина экрана — стик, правая — обзор, тап — удар.

## Качество
`Mobile` (URP_Mobile: без HDR/SSAO, тени 40 м, render scale 0.8) и `PC High`
(HDR, MSAA 4×, мягкие тени 4 каскада 4096, SSAO). Выбор по платформе — `QualityBoot`.
