// colyseus 0.15 — это CJS-пакет без ESM-exports, поэтому default-импорт.
import colyseus from "colyseus";

import { ZoneRoom } from "./rooms/ZoneRoom";

const { Server } = colyseus;
const PORT = Number(process.env.GAME_SERVER_PORT ?? 2567);

const gameServer = new Server();
gameServer.define("zone", ZoneRoom);

void gameServer.listen(PORT);
console.log(`[server] Colyseus слушает :${PORT}`);
