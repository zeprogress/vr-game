import { Client, type Room } from "colyseus.js";

import type { ZoneState } from "#shared/net/schema";

/**
 * Клиент игрового сервера. Этап 4b — только подключение к комнате zone.
 * Отдача/приём транспорта игроков добавится на 4d.
 */
export class NetClient {
  private client: Client | null = null;
  room: Room<ZoneState> | null = null;

  get online(): boolean {
    return this.room !== null;
  }

  /**
   * Подключиться к серверу. `true` — успех, `false` — сервера нет
   * (клиент продолжает в одиночном режиме).
   */
  async connect(nick: string): Promise<boolean> {
    try {
      this.client = new Client();
      this.room = await this.client.joinOrCreate<ZoneState>("zone", { nick });
      console.log(`[net] в комнате ${this.room.roomId} как ${this.room.sessionId}`);
      this.room.onLeave((code) => {
        console.log(`[net] соединение закрыто (код ${code})`);
        this.room = null;
      });
      return true;
    } catch (e) {
      console.warn("[net] сервер недоступен — одиночный режим:", (e as Error).message);
      this.client = null;
      this.room = null;
      return false;
    }
  }

  disconnect(): void {
    void this.room?.leave();
    this.room = null;
    this.client = null;
  }
}
