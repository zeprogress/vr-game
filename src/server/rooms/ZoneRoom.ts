import colyseus from "colyseus";
import type { Client } from "colyseus";

import {
  BallState,
  DropState,
  DummyState,
  MobState,
  PlayerState,
  SlotState,
  Xf,
  ZoneState,
} from "#shared/net/schema";
import {
  MSG,
  type HitMobMsg,
  type MoveMsg,
  type SaveMsg,
  type HandsMsg,
  type StowedWeapon,
  type CarriedWeapon,
  type HeldWeapons,
  type DropWeaponMsg,
  type ActMsg,
  type ActRelay,
  type ActKind,
  isActKind,
  type OverridesMsg,
  type RtcMsg,
  type SpendMsg,
  type SetTimeMsg,
  type TakeWeaponMsg,
  type UseItemMsg,
  type Xf7,
} from "#shared/net/messages";
import {
  ADMIN_NICK,
  advanceHour,
  DAYCYCLE,
  PLAYER,
  PLAYER_HP,
  RESPAWN,
  WORLD,
} from "#shared/constants";
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
  addToBag,
  BAG,
  emptyBag,
  isItemId,
  isWeaponClass,
  isWeaponTier,
  ITEMS,
  takeOne,
  weaponDef,
  weaponKey,
  WEAPON_TAKE_REACH,
  type ItemId,
  type Slot,
  type WeaponClass,
  type WeaponTier,
} from "#shared/items";
import {
  grantXp,
  isStatName,
  maxHpFor,
  spendPoint,
  type Progress,
} from "#shared/progression";
import { store, world } from "../store";
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
  /** Секунды неуязвимости после возрождения. */
  invuln: number;
  /** Последний присланный поворот — чтобы сохранить его и при выходе. */
  yaw: number;
  /** Что игрок честно поднял: ключи вида "sword:gold". База всегда своя. */
  owned: Set<string>;
  /** Оружие за спиной — переживает выход и восстанавливается при входе. */
  stowed: StowedWeapon[];
  /** Панельные настройки игрока (JSON как есть) — применяются только у него. */
  overrides: Record<string, unknown>;
}

/** Оружие «с собой» из сейва — с проверкой, что класс и уровень существуют. */
function sanitizeCarried(v: unknown): CarriedWeapon | null {
  const w = v as CarriedWeapon | null;
  if (!w || !isWeaponClass(w.cls) || !isWeaponTier(w.tier)) return null;
  return { cls: w.cls, tier: w.tier };
}

function sanitizeHeld(v: unknown): HeldWeapons {
  const h = v as HeldWeapons | undefined;
  return { left: sanitizeCarried(h?.left), right: sanitizeCarried(h?.right) };
}

/** Принять панельные настройки: это должен быть небольшой JSON-объект. */
function sanitizeOverrides(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  try {
    if (JSON.stringify(v).length > 20000) return {};
  } catch {
    return {};
  }
  return v as Record<string, unknown>;
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

/** Зажать v в [-lim, lim]. */
function clampAbs(v: number, lim: number): number {
  return v < -lim ? -lim : v > lim ? lim : v;
}

/** Отсеять мусор из сохранённого «оружия за спиной». */
function sanitizeStowed(list: unknown): StowedWeapon[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: StowedWeapon[] = [];
  for (const s of list) {
    if (!s || !isWeaponClass(s.cls) || !isWeaponTier(s.tier)) continue;
    if (s.side !== "left" && s.side !== "right") continue;
    if (seen.has(s.side)) continue; // одно плечо — один предмет
    seen.add(s.side);
    out.push({ cls: s.cls, tier: s.tier, side: s.side });
  }
  return out;
}

/** Единичный горизонтальный вектор из сообщения — иначе (0,0). */
function unit2(x: unknown, z: unknown): [number, number] {
  const ax = num(x, 0);
  const az = num(z, 0);
  const L = Math.hypot(ax, az);
  return L > 1e-4 ? [ax / L, az / L] : [0, 0];
}

/** Схема сумки -> обычный массив, с которым работает shared/items. */
function readBag(p: PlayerState): Slot[] {
  const bag = emptyBag();
  for (let i = 0; i < bag.length; i++) {
    const s = p.bag[i];
    if (!s || !isItemId(s.item) || s.count <= 0) continue;
    bag[i] = { item: s.item, count: s.count };
  }
  return bag;
}

function writeBag(p: PlayerState, bag: Slot[]): void {
  for (let i = 0; i < bag.length; i++) {
    const src = bag[i];
    let dst = p.bag[i];
    if (!dst) {
      dst = new SlotState();
      p.bag.push(dst);
    }
    dst.item = src.item ?? "";
    dst.count = src.item ? src.count : 0;
  }
}

/** Что в руке игрока по данным состояния. null — пусто или мусор. */
function heldIn(
  p: PlayerState,
  hand: "left" | "right",
): { cls: WeaponClass; tier: WeaponTier } | null {
  const cls = hand === "left" ? p.leftCls : p.rightCls;
  const tier = hand === "left" ? p.leftTier : p.rightTier;
  if (!isWeaponClass(cls) || !isWeaponTier(tier)) return null;
  return { cls, tier };
}

/** Множитель урона от того, что в руке. Пустая рука — обычный множитель. */
function multIn(p: PlayerState, hand: "left" | "right"): number {
  const h = heldIn(p, hand);
  return h ? weaponDef(h.cls, h.tier).mult : 1;
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

/** Сумка из сейва — с проверкой, что предметы всё ещё существуют. */
function restoreBag(saved: { item: ItemId | null; count: number }[] | undefined): Slot[] {
  const bag = emptyBag();
  if (!Array.isArray(saved)) return bag;
  for (let i = 0; i < bag.length && i < saved.length; i++) {
    const s = saved[i];
    if (!s || !isItemId(s.item)) continue;
    const count = Math.floor(num(s.count, 0));
    if (count <= 0) continue;
    bag[i] = { item: s.item, count: Math.min(count, ITEMS[s.item].stack) };
  }
  return bag;
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
  /** Точный час мира. В состояние (state.hour) кладётся раз в syncSeconds. */
  private worldHour: number = DAYCYCLE.startHour;
  private clockSync = 0;
  /** Раз в 10 с скидываем всех игроков в store — чтобы деплой/сбой почти ничего не терял. */
  private persistClock = 0;

  override onCreate(): void {
    this.setState(new ZoneState());
    this.state.hour = this.worldHour;
    this.state.dayAuto = 1;
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

    // Лут, лежавший на земле до перезапуска, возвращаем в мир.
    this.sim.restoreDrops(world.loadDrops());

    this.setSimulationInterval((deltaMs) => this.step(deltaMs / 1000), 50);

    this.onMessage(MSG.move, (client: Client, msg: MoveMsg) => {
      const p = this.state.players.get(client.sessionId);
      const rt = this.rt.get(client.sessionId);
      if (!p || !rt || !msg) return;
      if (msg.mode === "vr" || msg.mode === "flat") p.mode = msg.mode;
      applyXf(p.head, msg.head);
      applyXf(p.handL, msg.handL);
      applyXf(p.handR, msg.handR);
      // За край карты не пускаем даже кривого клиента.
      const edge = WORLD.size / 2 - 2;
      p.head.x = clampAbs(p.head.x, edge);
      p.head.z = clampAbs(p.head.z, edge);
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

    this.onMessage(MSG.useItem, (client: Client, msg: UseItemMsg) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || p.dead) return;
      const slot = Math.floor(num(msg?.slot, -1));
      if (slot < 0 || slot >= BAG.slots) return;

      const bag = readBag(p);
      const held = bag[slot];
      if (!held.item || ITEMS[held.item].heal <= 0) return; // нечего пить
      if (p.hp >= p.maxHp) return; // полное здоровье — не тратим зря

      const used = takeOne(bag, slot);
      if (!used) return;
      writeBag(p, bag);
      p.hp = Math.min(p.maxHp, p.hp + ITEMS[used].heal);

      // Соседям — звук глотка.
      const relay: ActRelay = {
        k: "drink",
        id: client.sessionId,
        x: p.head.x,
        y: p.head.y,
        z: p.head.z,
      };
      this.broadcast(MSG.act, relay, { except: client });
    });

    this.onMessage(MSG.takeWeapon, (client: Client, msg: TakeWeaponMsg) => {
      const p = this.state.players.get(client.sessionId);
      const rt = this.rt.get(client.sessionId);
      if (!p || !rt || p.dead || !msg?.id) return;

      const d = this.sim.drops.get(msg.id);
      const w = d ? ITEMS[d.item].weapon : undefined;
      if (!d || !w) return; // не оружие или его уже забрали

      const feetY = p.head.y - PLAYER.eyeHeight;
      const dist = Math.hypot(d.x - p.head.x, d.y - feetY, d.z - p.head.z);
      if (dist > WEAPON_TAKE_REACH) return;

      this.sim.takeDrop(d.id);
      rt.owned.add(weaponKey(w.cls, w.tier)); // право пользоваться этим уровнем
      this.clientOf(client.sessionId)?.send(MSG.picked, { item: d.item, count: 1 });
    });

    // Что в руках. Уровень принимаем только если игрок его действительно поднял.
    this.onMessage(MSG.hands, (client: Client, msg: HandsMsg) => {
      const p = this.state.players.get(client.sessionId);
      const rt = this.rt.get(client.sessionId);
      if (!p || !rt || !msg) return;

      const put = (
        claim: { cls: WeaponClass; tier: WeaponTier } | null,
      ): { cls: string; tier: string } => {
        if (!claim || !isWeaponClass(claim.cls) || !isWeaponTier(claim.tier)) {
          return { cls: "", tier: "" };
        }
        // Не поднимал — держит базовый вариант того же класса.
        const tier =
          claim.tier === "base" || rt.owned.has(weaponKey(claim.cls, claim.tier))
            ? claim.tier
            : "base";
        return { cls: claim.cls, tier };
      };

      const l = put(msg.left);
      const r = put(msg.right);
      p.leftCls = l.cls;
      p.leftTier = l.tier;
      p.rightCls = r.cls;
      p.rightTier = r.tier;

      // За спиной — только то, что игрок честно поднял (иначе уровень режем).
      rt.stowed = Array.isArray(msg.stowed)
        ? msg.stowed
            .filter(
              (s): s is StowedWeapon =>
                !!s &&
                isWeaponClass(s.cls) &&
                isWeaponTier(s.tier) &&
                (s.side === "left" || s.side === "right"),
            )
            .map((s) => ({
              cls: s.cls,
              tier:
                s.tier === "base" || rt.owned.has(weaponKey(s.cls, s.tier)) ? s.tier : "base",
              side: s.side,
            }))
        : [];
    });

    // Голосовой чат: сервер — только «телефонистка». Он пересылает пакет
    // адресату и подписывает отправителя; сам разговор идёт мимо сервера.
    // Время суток переводит только админ — часы общие для всей зоны.
    this.onMessage(MSG.setTime, (client: Client, msg: SetTimeMsg) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || p.nick.trim().toLowerCase() !== ADMIN_NICK || !msg) return;
      if (Number.isFinite(msg.hour)) {
        this.worldHour = (((msg.hour as number) % 24) + 24) % 24;
      }
      if (msg.auto !== undefined) this.state.dayAuto = msg.auto ? 1 : 0;
      // Перевод админа — сразу всем, не дожидаясь очередной рассылки.
      this.state.hour = this.worldHour;
      this.clockSync = 0;
    });

    // Панельные настройки: храним по токену, применяются только у этого игрока.
    this.onMessage(MSG.loadout, (client: Client, msg: OverridesMsg) => {
      const rt = this.rt.get(client.sessionId);
      if (!rt || !msg || typeof msg !== "object" || Array.isArray(msg)) return;
      rt.overrides = sanitizeOverrides(msg);
      this.persist(client);
      store.flush(); // правят редко — пишем на диск сразу
    });

    // Заработанное оружие упало на землю — кладём его в мир (общее для всех
    // и переживает перезапуск). Право на уровень (owned) у игрока остаётся:
    // это кооп, а не PvP-экономика, и терять добытое из-за случайного броска
    // обиднее, чем иметь лишний меч.
    this.onMessage(MSG.dropWeapon, (client: Client, msg: DropWeaponMsg) => {
      const p = this.state.players.get(client.sessionId);
      const rt = this.rt.get(client.sessionId);
      if (!p || !rt || !msg) return;
      if (!isWeaponClass(msg.cls) || !isWeaponTier(msg.tier)) return;
      if (msg.tier === "base") return; // базовое лежит у камней, в мир не кладём
      if (!rt.owned.has(weaponKey(msg.cls, msg.tier))) return; // не поднимал — не роняет

      const edge = WORLD.size / 2 - 2;
      const x = clampAbs(num(msg.x, p.head.x), edge);
      const z = clampAbs(num(msg.z, p.head.z), edge);
      // Далеко от игрока предмет оказаться не мог даже после сильного броска.
      if (Math.hypot(x - p.head.x, z - p.head.z) > 60) return;
      this.sim.dropWeapon(msg.cls, msg.tier, x, z);
    });

    // Звуковые события: клиентские (взмах, шаг, лук, стрела) пересылаем
    // остальным. Урон/блок/глоток сервер рассылает сам из своих расчётов.
    this.onMessage(MSG.act, (client: Client, msg: ActMsg) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !msg || !isActKind(msg.k)) return;
      if (msg.k === "hurt" || msg.k === "blockShield" || msg.k === "blockSword") return;
      const x = num(msg.x, p.head.x);
      const y = num(msg.y, p.head.y);
      const z = num(msg.z, p.head.z);
      if (Math.hypot(x - p.head.x, z - p.head.z) > 40) return; // не дальше разумного
      const relay: ActRelay = { k: msg.k, id: client.sessionId, x, y, z };
      this.broadcast(MSG.act, relay, { except: client });
    });

    this.onMessage(MSG.rtc, (client: Client, msg: RtcMsg) => {
      if (!msg?.peer || typeof msg.data !== "string") return;
      if (msg.kind !== "offer" && msg.kind !== "answer" && msg.kind !== "ice") return;
      if (!this.state.players.has(msg.peer)) return; // адресата в комнате нет
      this.clientOf(msg.peer)?.send(MSG.rtc, {
        peer: client.sessionId,
        kind: msg.kind,
        data: msg.data,
      });
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
    const hand = msg.hand === "left" ? "left" : "right";
    const dmg = weaponDamage(msg.weapon, p.str, multIn(p, hand));
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
    if (this.state.dayAuto !== 0) this.worldHour = advanceHour(this.worldHour, dt);
    // Раз в syncSeconds сверяем клиентов — между сверками они крутят часы сами.
    this.clockSync += dt;
    if (this.clockSync >= DAYCYCLE.syncSeconds) {
      this.clockSync = 0;
      this.state.hour = this.worldHour;
    }

    this.persistClock += dt;
    if (this.persistClock >= 10) {
      this.persistClock = 0;
      this.state.players.forEach((_p, id) => {
        const c = this.clientOf(id);
        if (c) this.persist(c);
      });
      world.save(this.sim.saveDrops());
    }

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
      s.vx = b.vx;
      s.vy = b.vy;
      s.vz = b.vz;
    }
    this.state.balls.forEach((_s, id) => {
      if (!this.sim.balls.has(id)) this.state.balls.delete(id);
    });
    for (const d of this.sim.drops.values()) {
      if (this.state.drops.has(d.id)) continue;
      const s = new DropState();
      s.item = d.item;
      s.count = d.count;
      s.x = d.x;
      s.y = d.y;
      s.z = d.z;
      this.state.drops.set(d.id, s);
    }
    this.state.drops.forEach((_s, id) => {
      if (!this.sim.drops.has(id)) this.state.drops.delete(id);
    });

    this.pickupLoot();

    for (const h of hits) this.hurtPlayer(h);
    this.tickPlayers(dt);
  }

  /** Лут подбирается сам, когда игрок подошёл вплотную. */
  private pickupLoot(): void {
    if (this.sim.drops.size === 0) return;
    this.state.players.forEach((p, id) => {
      if (p.dead) return;
      // Считаем от ног: лут лежит на земле, а head.y — это глаза.
      const feetY = p.head.y - PLAYER.eyeHeight;
      for (const d of [...this.sim.drops.values()]) {
        if (ITEMS[d.item].weapon) continue; // оружие берут рукой, само в сумку не прыгает
        const dy = d.y - feetY;
        const dist = Math.hypot(d.x - p.head.x, dy, d.z - p.head.z);
        if (dist > BAG.pickupRadius) continue;

        const bag = readBag(p);
        const left = addToBag(bag, d.item, d.count);
        const taken = d.count - left;
        if (taken <= 0) continue; // сумка полна — лут остаётся лежать
        writeBag(p, bag);
        this.sim.takeDrop(d.id);
        this.clientOf(id)?.send(MSG.picked, { item: d.item, count: taken });
      }
    });
  }

  /** Урон по игроку от моба или плевка — с учётом щита и меча. */
  private hurtPlayer(h: PlayerHit): void {
    const p = this.state.players.get(h.target);
    const rt = this.rt.get(h.target);
    if (!p || !rt || p.dead || rt.invuln > 0) return;

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

    // Соседям — звук: щёлкнул щит, звякнул меч или охнул от урона.
    const k: ActKind =
      block.by === 1 ? "blockShield" : block.by === 2 ? "blockSword" : "hurt";
    const relay: ActRelay = { k, id: h.target, x: p.head.x, y: p.head.y, z: p.head.z };
    this.broadcast(MSG.act, relay, { except: this.clientOf(h.target) });

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
      if (rt.invuln > 0) rt.invuln -= dt;
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
    rt.invuln = RESPAWN.invuln; // чтобы не добили прямо на точке возрождения
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
    // Руки заполняем из сейва СРАЗУ: иначе первое же сохранение (оно идёт
    // раз в 10 с) запишет пустые руки, ещё до того как клиент пришлёт свои.
    const savedHeld = sanitizeHeld(rec?.held);
    p.leftCls = savedHeld.left?.cls ?? "";
    p.leftTier = savedHeld.left?.tier ?? "";
    p.rightCls = savedHeld.right?.cls ?? "";
    p.rightTier = savedHeld.right?.tier ?? "";
    writeBag(p, restoreBag(rec?.bag));
    // Мёртвым в сейве не воскресаем в бою — входим с полным здоровьем.
    p.hp = rec && rec.hp > 0 ? Math.min(rec.hp, p.maxHp) : p.maxHp;
    this.state.players.set(client.sessionId, p);
    // Свежий час новичку (и заодно всем) — не ждём таймер рассылки.
    this.state.hour = this.worldHour;
    this.clockSync = 0;

    this.rt.set(client.sessionId, {
      token,
      guard: noGuard(),
      lastHit: {},
      sinceHurt: PLAYER_HP.regenDelay,
      respawnIn: 0,
      invuln: RESPAWN.invuln,
      yaw: rec?.yaw ?? 0,
      owned: new Set(Array.isArray(rec?.owned) ? rec.owned : []),
      stowed: sanitizeStowed(rec?.stowed),
      overrides: sanitizeOverrides(rec?.overrides),
    });

    client.send(
      MSG.char,
      rec
        ? {
            x: rec.x,
            y: rec.y,
            z: rec.z,
            yaw: rec.yaw,
            stowed: sanitizeStowed(rec.stowed),
            held: sanitizeHeld(rec.held),
            overrides: sanitizeOverrides(rec.overrides),
          }
        : null,
    );

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
    const edge = WORLD.size / 2 - 2;
    const patch: Partial<PlayerRecord> = {
      nick: p.nick,
      x: clampAbs(num(msg?.x, p.head.x), edge),
      y: num(msg?.y, p.head.y),
      z: clampAbs(num(msg?.z, p.head.z), edge),
      yaw: num(msg?.yaw, rt.yaw),
      hp: p.hp,
      owned: [...rt.owned],
      stowed: rt.stowed,
      held: { left: heldIn(p, "left"), right: heldIn(p, "right") },
      overrides: rt.overrides,
      ...readProgress(p),
      bag: readBag(p).map((s) => ({ item: s.item, count: s.count })),
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

  /** Сервер останавливается (деплой) — сохраняем всех до расселения комнаты. */
  override onBeforeShutdown(): void {
    for (const client of this.clients) this.persist(client);
    store.flush();
    const drops = this.sim.saveDrops();
    world.save(drops);
    console.log(`[zone] стоп: игроков ${this.clients.length}, лута на земле ${drops.length}`);
    this.disconnect();
  }

  override onDispose(): void {
    console.log(`[zone] комната ${this.roomId} закрыта`);
  }
}
