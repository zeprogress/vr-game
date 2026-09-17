// colyseus 0.15 — это CJS-пакет без ESM-exports, поэтому default-импорт.
import colyseus from "colyseus";
import http from "node:http";

import { ZoneRoom } from "./rooms/ZoneRoom";
import { TowerRoom } from "./rooms/TowerRoom";
import { InventoryRoom } from "./rooms/InventoryRoom";
import { store, chatLog } from "./store";

const { Server } = colyseus;
const PORT = Number(process.env.GAME_SERVER_PORT ?? 2567);

/**
 * Свой http.Server вместо того, чтобы отдать colyseus создать его самому —
 * так можно повесить пару собственных путей ДО того, как colyseus навесит
 * свои матчмейкинг-роуты на тот же сервер (см. `new Server({ server })`
 * ниже). Нужен nginx-проксинг этого пути (deploy/nginx-vrgame.conf,
 * `location /api/`) — без него запрос до Node вообще не долетит, отдаст
 * статику/404 сам nginx.
 */
const httpServer = http.createServer((req, res) => {
  if (req.method === "GET" && req.url?.startsWith("/api/chatlog")) {
    const token = new URL(req.url, "http://x").searchParams.get("token") ?? "";
    const want = process.env.CHATLOG_TOKEN || "";
    if (!want || token !== want) {
      res.writeHead(403, { "content-type": "application/json" }).end('{"error":"forbidden"}');
      return;
    }
    const body = JSON.stringify(chatLog.readRecent());
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" }).end(body);
    return;
  }
  // Не наш путь — ничего не делаем и не закрываем ответ: следующий
  // слушатель 'request' (навешивает сам colyseus) обработает /matchmake/ и т.п.
});

// Пинг терпимее дефолта (3 с / 2 попытки ≈ 6–9 с): на мобильной сети и через
// VPN понг запаздывал, сервер рвал живого клиента, тот переподключался — и у
// стрим-игроков персонаж мигал в бота и обратно. ~15–20 с + окно
// allowReconnection в ZoneRoom.onLeave.
const gameServer = new Server({ server: httpServer, pingInterval: 5000, pingMaxRetries: 3 });
gameServer.define("zone", ZoneRoom);
// Охотничья башня — приватная комната на одну попытку (см. TowerRunManager в
// ZoneRoom, matchMaker.createRoom("tower_room", ...); клиент сюда напрямую не джойнит).
gameServer.define("tower_room", TowerRoom);
// Веб-страница инвентаря ("!inv" в чате) — см. InventoryRoom.ts, разовый
// джойн-и-ответ через уже проксированный matchmake/WS, без нового HTTP-роута.
gameServer.define("inventory_room", InventoryRoom);

void gameServer.listen(PORT);
console.log(`[server] Colyseus слушает :${PORT}`);

// Периодический дамп сейвов на диск.
const flushTimer = setInterval(() => store.flush(), 15_000);

// При остановке (в т.ч. `systemctl restart` на деплое) Colyseus сам ловит
// SIGTERM/SIGINT, корректно расселяет комнаты (onBeforeShutdown -> persist
// всех) и лишь потом зовёт это. Свои обработчики сигналов не ставим — они
// перебивали graceful shutdown вызовом process.exit до сохранения.
gameServer.onShutdown(() => {
  clearInterval(flushTimer);
  store.flush();
  console.log("[server] остановлен, сейвы записаны");
});
