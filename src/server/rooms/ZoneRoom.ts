import colyseus from "colyseus";
import type { Client } from "colyseus";

import { BallState, DummyState, MobState, PlayerState, Xf, ZoneState } from "#shared/net/schema";
import {
  MSG,
  type HitMobMsg,
  type MoveMsg,
  type SaveMsg,
  type SpendMsg,
  type Xf7,
} from "#shared/net/messages";
import { PLAYER, PLAYER_HP, RESPAWN } from "#shared/constants";
import { terrainHeight } from "#shared/terrain";
import {
  isWeaponKind,
  noGuard,
  resolveBlock,
  weaponDamage,
  WEAPON_RATE,
  WEAPON_REACH,
  type GuardState,
  type WeaponKind,
} from "#shared/combat";
import {
  grantXp,
  isStatName,
  maxHpFor,
  spendPoint,
  type Progress,
} from "#shared/progression";
import { store } from "../store";
import type { PlayerRecord } from "../PlayerStore";
import { ZoneSim, type PlayerHit, type SimPlayer } from "../sim/ZoneSim";

const { Room } = colyseus;

/** Сколько HP доливается за новый уровень (как было на клиенте). */
const LEVEL_UP_HEAL = 10;

/** Несетевое состояние игрока: защита, темп ударов, таймеры. */
interface Runtime {
  token?: string;
  guard: GuardState;
  /** Момент последнего засчитанного удара каждым видом оружия (сек. комнаты). */
  lastHit: Partial<Record<WeaponKind, number>>;
  sinceHurt: number;
  respawnIn: number;
  /** Последний присланный поворот — чтобы сохранить его и при выходе. */
  yaw: number;
}

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

function num(v: unknown, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

/** Единичный горизонтальный вектор из сообщения — иначе (0,0). */
function unit2(x: unknown, z: unknown): [number, number] {
  const ax = num(x, 0);
  const az = num(z, 0);
  const L = Math.hypot(ax, az);
  return L > 1e-4 ? [ax / L, az / L] : [0, 0];
}

function readProgress(p: PlayerState): Progress {
  return { level: p.level, xp: p.xp, unspent: p.unspent, str: p.str, agi: p.agi, int: p.int };
}

function writeProgress(p: PlayerState, s: Progress): void {
  p.level = s.level;
  p.xp = s.xp;
  p.unspent = s.unspent;
  p.str = s.str;
  p.agi = s.agi;
  p.int = s.int;
}

interface JoinOpts {
  nick?: string;
  token?: string;
}

/**
 * Одна зона мира. Сервер авторитетен: мобы, куклы, плевки, здоровье игроков,
 * блок щитом/мечом, опыт и уровни. Клиент шлёт только транспорт и заявки
 * на удар — досягаемость, темп и урон проверяются здесь.
 */
export class ZoneRoom extends Room<ZoneState> {
  private sim!: ZoneSim;
  private readonly rt = new Map<string, Runtime>();
  /** Секунды с запуска комнаты — по ним считается темп ударов. */
  private elapsed = 0;

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
      const rt = this.rt.get(client.sessionId);
      if (!p || !rt || !msg) return;
      if (msg.mode === "vr" || msg.mode === "flat") p.mode = msg.mode;
      applyXf(p.head, msg.head);
      applyXf(p.handL, msg.handL);
      applyXf(p.handR, msg.handR);
      const g = msg.guard;
      [rt.guard.sx, rt.guard.sz] = unit2(g?.sx, g?.sz);
      [rt.guard.wx, rt.guard.wz] = unit2(g?.wx, g?.wz);
    });

    this.onMessage(MSG.save, (client: Client, msg: SaveMsg) => this.persist(client, msg));

    this.onMessage(MSG.hitMob, (client: Client, msg: HitMobMsg) =>
      this.tryHit(client, msg),
    );

    this.onMessage(MSG.spend, (client: Client, msg: SpendMsg) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !isStatName(msg?.stat)) return;
      const prog = readProgress(p);
      if (!spendPoint(prog, msg.stat)) return;
      writeProgress(p, prog);
      // Прибавку к потолку HP доливаем сразу — как это делал клиент.
      const before = p.maxHp;
      p.maxHp = maxHpFor(p.str);
      p.hp = Math.min(p.maxHp, p.hp + Math.max(0, p.maxHp - before));
    });

    console.log(`[zone] комната ${this.roomId} создана`);
  }

  // ---- удары игрока ----

  /** Заявка на попадание. Дистанцию, темп и урон решает сервер. */
  private tryHit(client: Client, msg: HitMobMsg): void {
    const p = this.state.players.get(client.sessionId);
    const rt = this.rt.get(client.sessionId);
    if (!p || !rt || p.dead || !msg?.id) return;
    if (msg.target !== "mob" && msg.target !== "dummy") return;
    if (!isWeaponKind(msg.weapon)) return;

    // Темп: чаще, чем позволяет оружие, удары не засчитываются.
    const last = rt.lastHit[msg.weapon];
    if (last !== undefined && this.elapsed - last < WEAPON_RATE[msg.weapon]) return;

    const at = this.sim.targetCenter(msg.target, msg.id);
    if (!at) return;
    const dist = Math.hypot(at.x - p.head.x, at.y - p.head.y, at.z - p.head.z);
    if (dist > WEAPON_REACH[msg.weapon]) return; // слишком далеко — не верим

    rt.lastHit[msg.weapon] = this.elapsed;
    const dmg = weaponDamage(msg.weapon, p.str);
    const [dx, dz] = unit2(msg.dx, msg.dz);

    if (msg.target === "dummy") {
      this.sim.hitDummy(msg.id, dmg);
      return;
    }
    const xp = this.sim.hitMob(msg.id, dmg, dx || 0, dz || 1);
    if (xp > 0) this.awardXp(client, p, xp);
  }

  private awardXp(client: Client, p: PlayerState, amount: number): void {
    const prog = readProgress(p);
    const levels = grantXp(prog, amount);
    writeProgress(p, prog);
    if (levels <= 0) return;
    p.maxHp = maxHpFor(p.str);
    p.hp = Math.min(p.maxHp, p.hp + LEVEL_UP_HEAL * levels);
    client.send(MSG.levelUp, { level: p.level });
  }

  // ---- тик ----

  private step(dt: number): void {
    this.elapsed += dt;

    // Мобы гоняются только за живыми.
    const players: SimPlayer[] = [];
    this.state.players.forEach((p, id) => {
      if (!p.dead) players.push({ sessionId: id, x: p.head.x, y: p.head.y, z: p.head.z });
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

    for (const h of hits) this.hurtPlayer(h);
    this.tickPlayers(dt);
  }

  /** Урон по игроку от моба или плевка — с учётом щита и меча. */
  private hurtPlayer(h: PlayerHit): void {
    const p = this.state.players.get(h.target);
    const rt = this.rt.get(h.target);
    if (!p || !rt || p.dead) return;

    // Направление ОТ игрока К источнику удара.
    let ax = h.fromX - p.head.x;
    let az = h.fromZ - p.head.z;
    const L = Math.hypot(ax, az);
    if (L > 1e-6) {
      ax /= L;
      az /= L;
    } else {
      ax = 0;
      az = 1;
    }

    const block = resolveBlock(rt.guard, ax, az, h.projectile);
    const dmg = h.dmg * block.mult;
    rt.sinceHurt = 0;
    if (dmg > 0) p.hp = Math.max(0, p.hp - dmg);

    this.clientOf(h.target)?.send(MSG.mobHit, {
      dmg,
      fromX: h.fromX,
      fromZ: h.fromZ,
      by: block.by,
    });

    if (p.hp <= 0) {
      p.dead = 1;
      rt.respawnIn = RESPAWN.delay;
    }
  }

  /** Реген, отсчёт до возрождения. */
  private tickPlayers(dt: number): void {
    this.state.players.forEach((p, id) => {
      const rt = this.rt.get(id);
      if (!rt) return;
      if (p.dead) {
        rt.respawnIn -= dt;
        if (rt.respawnIn <= 0) this.respawn(id, p, rt);
        return;
      }
      rt.sinceHurt += dt;
      if (p.hp > 0 && p.hp < p.maxHp && rt.sinceHurt > PLAYER_HP.regenDelay) {
        p.hp = Math.min(p.maxHp, p.hp + PLAYER_HP.regen * dt);
      }
    });
  }

  private respawn(id: string, p: PlayerState, rt: Runtime): void {
    const x = RESPAWN.spawnX;
    const z = RESPAWN.spawnZ;
    const y = terrainHeight(x, z) + PLAYER.eyeHeight;
    p.dead = 0;
    p.hp = p.maxHp;
    p.head.x = x;
    p.head.y = y;
    p.head.z = z;
    rt.sinceHurt = PLAYER_HP.regenDelay;
    this.clientOf(id)?.send(MSG.respawn, { x, y, z });
  }

  private clientOf(sessionId: string): Client | undefined {
    return this.clients.find((c) => c.sessionId === sessionId);
  }

  // ---- вход / выход / сохранение ----

  override onJoin(client: Client, options?: JoinOpts): void {
    const token = options?.token?.trim();
    const rec = token ? store.get(token) : undefined;

    const p = new PlayerState();
    p.nick = (options?.nick ?? "").trim().slice(0, 16) || rec?.nick || "гость";
    if (rec) {
      p.head.x = rec.x;
      p.head.y = rec.y;
      p.head.z = rec.z;
      p.level = rec.level;
      p.xp = rec.xp;
      p.unspent = rec.unspent;
      p.str = rec.str;
      p.agi = rec.agi;
      p.int = rec.int;
    }
    p.maxHp = maxHpFor(p.str);
    // Мёртвым в сейве не воскресаем в бою — входим с полным здоровьем.
    p.hp = rec && rec.hp > 0 ? Math.min(rec.hp, p.maxHp) : p.maxHp;
    this.state.players.set(client.sessionId, p);

    this.rt.set(client.sessionId, {
      token,
      guard: noGuard(),
      lastHit: {},
      sinceHurt: PLAYER_HP.regenDelay,
      respawnIn: 0,
      yaw: rec?.yaw ?? 0,
    });

    client.send(MSG.char, rec ? { x: rec.x, y: rec.y, z: rec.z, yaw: rec.yaw } : null);

    console.log(
      `[zone] + ${client.sessionId} «${p.nick}» ур.${p.level}` +
        `${rec ? " (загружен)" : token ? " (новый токен)" : ""} — в комнате ${this.clients.length}`,
    );
  }

  /** Записать текущее состояние игрока в хранилище. */
  private persist(client: Client, msg?: SaveMsg): void {
    const rt = this.rt.get(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    if (!rt?.token || !p) return;
    if (msg) rt.yaw = num(msg.yaw, rt.yaw);
    const patch: Partial<PlayerRecord> = {
      nick: p.nick,
      x: num(msg?.x, p.head.x),
      y: num(msg?.y, p.head.y),
      z: num(msg?.z, p.head.z),
      yaw: num(msg?.yaw, rt.yaw),
      hp: p.hp,
      ...readProgress(p),
    };
    store.put(rt.token, patch);
  }

  override onLeave(client: Client): void {
    this.persist(client);
    this.state.players.delete(client.sessionId);
    this.rt.delete(client.sessionId);
    store.flush();
    console.log(`[zone] - ${client.sessionId} — осталось ${this.clients.length - 1}`);
  }

  override onDispose(): void {
    console.log(`[zone] комната ${this.roomId} закрыта`);
  }
}
