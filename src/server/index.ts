// colyseus 0.15 — это CJS-пакет без ESM-exports, поэтому default-импорт.
import colyseus from "colyseus";

import { ZoneRoom } from "./rooms/ZoneRoom";
import { store } from "./store";

const { Server } = colyseus;
const PORT = Number(process.env.GAME_SERVER_PORT ?? 2567);

const gameServer = new Server();
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
