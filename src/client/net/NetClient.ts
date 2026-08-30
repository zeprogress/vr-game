import { Client, type Room } from "colyseus.js";

import type { ZoneState } from "#shared/net/schema";
import { MSG, type MoveMsg } from "#shared/net/messages";

const SEND_HZ = 18;
const SEND_EVERY = 1000 / SEND_HZ;

/**
 * Клиент игрового сервера. Подключение к комнате zone + отдача транспорта
 * локального игрока с троттлингом. Приём чужих — через `room.state.players`.
 */
export class NetClient {
  private client: Client | null = null;
  room: Room<ZoneState> | null = null;
  private lastSent = 0;

  get online(): boolean {
    return this.room !== null;
  }

  /** id своей сессии — чтобы не рисовать собственный аватар. */
  get sessionId(): string {
    return this.room?.sessionId ?? "";
  }

  /**
   * Подключиться к серверу. `true` — успех, `false` — сервера нет
   * (клиент продолжает в одиночном режиме).
   */
  async connect(nick: string): Promise<boolean> {
    try {
      this.client = new Client();
      const room = await this.client.joinOrCreate<ZoneState>("zone", { nick });
      // Ждём первую синхронизацию состояния — иначе onAdd не увидит уже вошедших.
      await new Promise<void>((r) => {
        const t = setTimeout(r, 800);
        room.onStateChange.once(() => {
          clearTimeout(t);
          r();
        });
      });
      this.room = room;
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

  /** Отправить свой транспорт (не чаще SEND_HZ раз в секунду). */
  sendMove(now: number, msg: MoveMsg): void {
    if (!this.room || now - this.lastSent < SEND_EVERY) return;
    this.lastSent = now;
    this.room.send(MSG.move, msg);
  }

  disconnect(): void {
    void this.room?.leave();
    this.room = null;
    this.client = null;
  }
}
