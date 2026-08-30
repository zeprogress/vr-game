import colyseus from "colyseus";
import type { Client } from "colyseus";

import { ZoneState } from "#shared/net/schema";

const { Room } = colyseus;

/** Одна зона мира. Пока только считает игроков в комнате. */
export class ZoneRoom extends Room<ZoneState> {
  override onCreate(): void {
    this.setState(new ZoneState());
    console.log(`[zone] комната ${this.roomId} создана`);
  }

  override onJoin(client: Client, options?: { nick?: string }): void {
    const nick = options?.nick?.trim() || "гость";
    console.log(`[zone] + ${client.sessionId} «${nick}» — в комнате ${this.clients.length}`);
  }

  override onLeave(client: Client): void {
    console.log(`[zone] - ${client.sessionId} — осталось ${this.clients.length - 1}`);
  }

  override onDispose(): void {
    console.log(`[zone] комната ${this.roomId} закрыта`);
  }
}
