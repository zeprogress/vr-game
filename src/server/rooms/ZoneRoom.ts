import colyseus from "colyseus";
import type { Client } from "colyseus";

import { PlayerState, Xf, ZoneState } from "#shared/net/schema";
import { MSG, type MoveMsg, type SaveMsg, type Xf7 } from "#shared/net/messages";
import { store } from "../store";
import type { PlayerRecord } from "../PlayerStore";

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

function recToSave(r: PlayerRecord): SaveMsg {
  const { x, y, z, yaw, level, xp, unspent, str, agi, int, hp } = r;
  return { x, y, z, yaw, level, xp, unspent, str, agi, int, hp };
}

interface JoinOpts {
  nick?: string;
  token?: string;
}

/** Одна зона мира. Игроки шлют транспорт и снимки прогресса, сервер хранит. */
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

    this.onMessage(MSG.save, (client: Client, msg: SaveMsg) => {
      const token = (client.userData as { token?: string } | undefined)?.token;
      if (!token || !msg) return;
      const p = this.state.players.get(client.sessionId);
      store.put(token, { ...sanitizeSave(msg), nick: p?.nick ?? "гость" });
    });

    console.log(`[zone] комната ${this.roomId} создана`);
  }

  override onJoin(client: Client, options?: JoinOpts): void {
    const token = options?.token?.trim();
    const rec = token ? store.get(token) : undefined;

    const p = new PlayerState();
    p.nick = (options?.nick ?? "").trim().slice(0, 16) || rec?.nick || "гость";
    if (rec) {
      p.head.x = rec.x;
      p.head.y = rec.y;
      p.head.z = rec.z;
    }
    this.state.players.set(client.sessionId, p);

    client.userData = { token };
    client.send(MSG.char, rec ? recToSave(rec) : null);

    console.log(
      `[zone] + ${client.sessionId} «${p.nick}»${rec ? " (загружен)" : token ? " (новый токен)" : ""}` +
        ` — в комнате ${this.clients.length}`,
    );
  }

  override onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    store.flush(); // на диск последний известный снимок ушедшего
    console.log(`[zone] - ${client.sessionId} — осталось ${this.clients.length - 1}`);
  }

  override onDispose(): void {
    console.log(`[zone] комната ${this.roomId} закрыта`);
  }
}

function num(v: unknown, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function sanitizeSave(m: SaveMsg): SaveMsg {
  return {
    x: num(m.x, 0),
    y: num(m.y, 1.7),
    z: num(m.z, -20),
    yaw: num(m.yaw, 0),
    level: Math.max(1, Math.min(100, Math.floor(num(m.level, 1)))),
    xp: Math.max(0, num(m.xp, 0)),
    unspent: Math.max(0, Math.floor(num(m.unspent, 0))),
    str: Math.max(1, Math.floor(num(m.str, 1))),
    agi: Math.max(1, Math.floor(num(m.agi, 1))),
    int: Math.max(1, Math.floor(num(m.int, 1))),
    hp: Math.max(0, num(m.hp, 100)),
  };
}
