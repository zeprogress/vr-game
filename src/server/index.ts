// colyseus 0.15 — это CJS-пакет без ESM-exports, поэтому default-импорт.
import colyseus from "colyseus";

import { ZoneRoom } from "./rooms/ZoneRoom";
import { store } from "./store";

const { Server } = colyseus;
const PORT = Number(process.env.GAME_SERVER_PORT ?? 2567);

// Пинг терпимее дефолта (3 с / 2 попытки ≈ 6–9 с): на мобильной сети и через
// VPN понг запаздывал, сервер рвал живого клиента, тот переподключался — и у
// стрим-игроков персонаж мигал в бота и обратно. ~15–20 с + окно
// allowReconnection в ZoneRoom.onLeave.
const gameServer = new Server({ pingInterval: 5000, pingMaxRetries: 3 });
gameServer.define("zone", ZoneRoom);

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
