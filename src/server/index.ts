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

// Периодический дамп сейвов + запись при остановке.
const flushTimer = setInterval(() => store.flush(), 15_000);
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    clearInterval(flushTimer);
    store.flush();
    process.exit(0);
  });
}
