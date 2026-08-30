import colyseus from "colyseus";
import type { Client } from "colyseus";

import { BallState, DummyState, MobState, PlayerState, Xf, ZoneState } from "#shared/net/schema";
import {
  MSG,
  type HitMobMsg,
  type MoveMsg,
  type SaveMsg,
  type Xf7,
} from "#shared/net/messages";
import { store } from "../store";
import type { PlayerRecord } from "../PlayerStore";
import { ZoneSim, type SimPlayer } from "../sim/ZoneSim";

const { Room } = colyseus;
const MAX_HIT_DMG = 60;

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

interface JoinOpts {
  nick?: string;
  token?: string;
}

/** Одна зона мира. Игроки шлют транспорт; мобы/куклы/плевки считает сервер. */
export class ZoneRoom extends Room<ZoneState> {
  private sim!: ZoneSim;

  override onCreate(): void {
    this.setState(new ZoneState());
    this.sim = new ZoneSim();

    // Схема мобов/кукол создаётся один раз — дальше только обновляем поля.
    for (const m of this.sim.mobs.values()) {
      const s = new MobState();
      s.kind = m.kind;
      this.state.mobs.set(m.id, s);
    }
    for (const d of this.sim.dummies.values()) {
      const s = new DummyState();
      s.x = d.x;
      s.y = d.y;
      s.z = d.z;
      this.state.dummies.set(d.id, s);
    }

    this.setSimulationInterval((deltaMs) => this.step(deltaMs / 1000), 50);

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

    this.onMessage(MSG.hitMob, (client: Client, msg: HitMobMsg) => {
      if (!msg?.id) return;
      const dmg = Math.max(0, Math.min(MAX_HIT_DMG, num(msg.dmg, 0)));
      if (dmg <= 0) return;
      const dx = num(msg.dx, 0);
      const dz = num(msg.dz, 1);
      if (msg.target === "dummy") {
        this.sim.hitDummy(msg.id, dmg);
      } else {
        const xp = this.sim.hitMob(msg.id, dmg, dx, dz);
        if (xp > 0) client.send(MSG.xp, { amount: xp });
      }
    });

    console.log(`[zone] комната ${this.roomId} создана`);
  }

  private step(dt: number): void {
    const players: SimPlayer[] = [];
    this.state.players.forEach((p, id) => {
      players.push({ sessionId: id, x: p.head.x, y: p.head.y, z: p.head.z });
    });

    const hits = this.sim.tick(dt, players);

    // sim -> схема
    for (const m of this.sim.mobs.values()) {
      const s = this.state.mobs.get(m.id);
      if (!s) continue;
      s.x = m.x;
      s.y = m.y;
      s.z = m.z;
      s.yaw = m.yaw;
      s.hp = Math.max(0, m.hp);
      s.maxHp = m.maxHp;
      s.dead = m.dead ? 1 : 0;
      s.grounded = m.grounded ? 1 : 0;
      s.hurtSeq = m.hurtSeq;
      s.hurtDx = m.hurtDx;
      s.hurtDz = m.hurtDz;
    }
    for (const d of this.sim.dummies.values()) {
      const s = this.state.dummies.get(d.id);
      if (!s) continue;
      s.hp = Math.max(0, d.hp);
      s.dead = d.dead ? 1 : 0;
      s.hurtSeq = d.hurtSeq;
    }
    // Плевки появляются и исчезают — синхронизируем множество.
    for (const b of this.sim.balls.values()) {
      let s = this.state.balls.get(b.id);
      if (!s) {
        s = new BallState();
        this.state.balls.set(b.id, s);
      }
      s.x = b.x;
      s.y = b.y;
      s.z = b.z;
    }
    this.state.balls.forEach((_s, id) => {
      if (!this.sim.balls.has(id)) this.state.balls.delete(id);
    });

    for (const h of hits) {
      const c = this.clients.find((cl) => cl.sessionId === h.target);
      c?.send(MSG.mobHit, { dmg: h.dmg, fromX: h.fromX, fromZ: h.fromZ });
    }
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
    store.flush();
    console.log(`[zone] - ${client.sessionId} — осталось ${this.clients.length - 1}`);
  }

  override onDispose(): void {
    console.log(`[zone] комната ${this.roomId} закрыта`);
  }
}
