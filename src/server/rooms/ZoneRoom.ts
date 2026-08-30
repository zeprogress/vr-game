import colyseus from "colyseus";
import type { Client } from "colyseus";

import { PlayerState, Xf, ZoneState } from "#shared/net/schema";
import { MSG, type MoveMsg, type Xf7 } from "#shared/net/messages";

const { Room } = colyseus;

function applyXf(target: Xf, v: Xf7 | undefined): void {
  if (!Array.isArray(v) || v.length !== 7) return;
  target.x = v[0];
  target.y = v[1];
  target.z = v[2];
  target.qx = v[3];
  target.qy = v[4];
  target.qz = v[5];
  target.qw = v[6];
}

/** Одна зона мира. Игроки шлют свой транспорт, сервер раздаёт его всем. */
export class ZoneRoom extends Room<ZoneState> {
  override onCreate(): void {
    this.setState(new ZoneState());

    this.onMessage(MSG.move, (client: Client, msg: MoveMsg) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !msg) return;
      if (msg.mode === "vr" || msg.mode === "flat") p.mode = msg.mode;
      applyXf(p.head, msg.head);
      applyXf(p.handL, msg.handL);
      applyXf(p.handR, msg.handR);
    });

    console.log(`[zone] комната ${this.roomId} создана`);
  }

  override onJoin(client: Client, options?: { nick?: string }): void {
    const p = new PlayerState();
    p.nick = (options?.nick ?? "").trim().slice(0, 16) || "гость";
    this.state.players.set(client.sessionId, p);
    console.log(`[zone] + ${client.sessionId} «${p.nick}» — в комнате ${this.clients.length}`);
  }

  override onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    console.log(`[zone] - ${client.sessionId} — осталось ${this.clients.length - 1}`);
  }

  override onDispose(): void {
    console.log(`[zone] комната ${this.roomId} закрыта`);
  }
}
