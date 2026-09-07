import colyseus from "colyseus";
import type { Client } from "colyseus";

import {
  BallState,
  BoltState,
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
  type BotSayMsg,
  type LeaderboardRow,
  type BotEmote,
  type EmoteMsg,
  type VoiceMsg,
  isActKind,
  type OverridesMsg,
  type RtcMsg,
  type SpendMsg,
  type SetSkinMsg,
  type SetLeaveBotMsg,
  type CastMsg,
  type WorldLoadoutMsg,
  type SetTimeMsg,
  type ComfortMsg,
  type SpecCmd,
  type SpecCamMsg,
  type SetPvpMsg,
  type TakeWeaponMsg,
  type UseItemMsg,
  type Xf7,
} from "#shared/net/messages";
import {
  ADMIN_NICK,
  advanceHour,
  BOSS,
  COMBAT,
  BOT,
  DAYCYCLE,
  MOB,
  PLAYER,
  PLAYER_HP,
  PROGRESSION,
  PVP,
  ELITE_MOBS,
  MOB_CAMPS,
  RESPAWN,
  SPITTER,
  SPECTATOR_KEY,
  STREAM_NICKS,
  TWITCH_CHANNEL,
  WORLD,
} from "#shared/constants";
import { TwitchChat } from "../TwitchChat";
import { synthChat, ttsAvailable } from "../tts";
import {
  isTtsVoice,
  TTS_DEFAULT_VOICE,
  ttsVoiceFromQuery,
  ttsVoiceMenu,
  ttsVoiceName,
} from "#shared/tts";
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
  atMaxLevel,
  attackSpeedFor,
  grantXp,
  isStatName,
  maxHpFor,
  moveSpeedFor,
  spendPoint,
  xpToNext,
  type Progress,
  type StatName,
} from "#shared/progression";
import {
  MAGIC,
  maxManaFor,
  manaRegenFor,
  fireboltDamage,
  fireboltSpeed,
  fireboltRadius,
  fireboltHitRadius,
  fireboltSplashRadius,
  healAmountFor,
} from "#shared/magic";
import { inHubSafeZone, hubSpawnPoint } from "#shared/hub";
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
  /** Момент последнего обмена ударами в PvP (сек. комнаты) — для disengage. */
  lastPvpAt: number;
  /** Момент последнего каста посохом — для кулдауна. */
  lastCast: number;
  /** Последний присланный поворот — чтобы сохранить его и при выходе. */
  yaw: number;
  /** Что игрок честно поднял: ключи вида "sword:gold". База всегда своя. */
  owned: Set<string>;
  /** Оружие за спиной — переживает выход и восстанавливается при входе. */
  stowed: StowedWeapon[];
  /** Панельные настройки игрока (JSON как есть) — применяются только у него. */
  overrides: Record<string, unknown>;
  /** Добитых мобов за сессию + сейв — таблица лидеров (Ф10). */
  kills: number;
  /** Продолжать ли персонажа ботом после выхода. По умолчанию — нет. */
  leaveBot: boolean;
}

/** Бот зрителя (Ф10): безголовый игрок, которым рулит сервер. */
interface Bot {
  nick: string; // отображаемый
  norm: string; // нормализованный (ключ в this.bots)
  id: string; // ключ в state.players / rt: "bot:<norm>"
  state: PlayerState;
  rt: Runtime;
  target: string | null; // id моба
  /** id лежащего золотого меча, за которым бот сейчас идёт (Ф10). */
  lootTarget: string | null;
  /** Нормализованный ник, за которым идём между боями (!follow/!come, Ф10). null — никого. */
  followNorm: string | null;
  /**
   * Рейд на босса (!raid): идём к Багровому слизню и бьём его, забыв про
   * зону и обычных мобов. Снимается победой над боссом, гибелью героя
   * (одна попытка — один рейд) или повторным !raid.
   */
  raiding: boolean;
  /** ms последней эмоции (!cheer, авто-кувырок на бегу, левелап) — антиспам. */
  emoteAt: number;
  /** ms — до этого момента бот стоит на месте, играет эмоцию. */
  emoteFreezeUntil: number;
  attackCd: number;
  wanderCd: number;
  wanderX: number;
  wanderZ: number;
  yaw: number; // сглаженный поворот модели
  vx: number; // сглаженная скорость — движение без рывков
  vz: number;
  reskinAt: number; // ms последней команды !skin (антиспам)
  drinkCd: number; // с до следующего глотка зелья
  healCd: number; // с до следующего массового хила (посох)
  healCastT: number; // с до конца каста массового хила (>0 — кастует, стоит)
  cleaveCd: number; // с до следующего рассекающего удара (меч)
  cleaveCastT: number; // с до конца замаха рассекающего
  cleaveYaw: number; // куда был направлен сектор в момент замаха
  rainCd: number; // с до следующего града стрел (лук)
  rainCastT: number; // с до конца замаха града
  rainX: number; // куда намечен град
  rainZ: number;
  sayAt: number; // ms последней реплики в чат (антиспам)
  statsAt: number; // ms последнего ответа про статы (антиспам)
  /** Секунд до касания клинка (0 — замаха нет). Урон наносится в этот момент. */
  swingIn: number;
  swingTarget: string | null; // по какому мобу замахнулись
  swingDx: number; // направление удара, запомненное на начало замаха
  swingDz: number;
  /** id моба, недавно ударившего бота (плевун сзади в рейде) + когда (ms). */
  hurtByMob: string | null;
  hurtByMobAt: number;
  /** Центр «зоны» бота — куда его высадили по уровню (поляна или лагерь). */
  homeX: number;
  homeZ: number;
}

/**
 * Оружие бота по преобладающей характеристике: строго больше остальных —
 * ловкость→лук, интеллект→посох; сила максимум или ничья → меч.
 */
function botWeaponFor(str: number, agi: number, int: number): "sword" | "bow" | "staff" {
  if (agi > str && agi > int) return "bow";
  if (int > str && int > agi) return "staff";
  return "sword";
}

/** Лагеря мобов по возрастанию силы (уровня их мобов) — расселение ботов. */
const CAMPS_BY_POWER = [...MOB_CAMPS].sort(
  (a, b) => ELITE_MOBS[a.type].level - ELITE_MOBS[b.type].level,
);

/**
 * Куда высадить/возродить бота: чем выше уровень, тем ближе к сильным мобам.
 * До 5 ур. — обычная поляна у спавна; дальше — рядом с лагерем по силе.
 */
function botHome(level: number): { x: number; z: number } {
  if (level < 5 || CAMPS_BY_POWER.length === 0) {
    return { x: RESPAWN.spawnX, z: RESPAWN.spawnZ };
  }
  const tier = Math.min(CAMPS_BY_POWER.length - 1, Math.floor((level - 5) / 3));
  const c = CAMPS_BY_POWER[tier];
  return { x: c.x, z: c.z };
}

/** Точка появления у дома бота: рядом, но с разбросом (не в куче мобов). */
function botSpawnAt(home: { x: number; z: number }): { x: number; z: number } {
  const a = Math.random() * Math.PI * 2;
  const r = 9 + Math.random() * 7;
  return { x: home.x + Math.cos(a) * r, z: home.z + Math.sin(a) * r };
}

/** Нормализация ника для сравнения/ключей. */
function normNick(n: string): string {
  return n.trim().toLowerCase().slice(0, 24);
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
    // Раньше лимит был 20 КБ — при полном снимке всех целей блок мог его
    // превысить и тихо обнулиться. Подняли с запасом; клиент теперь и так
    // шлёт только изменённые цели.
    if (JSON.stringify(v).length > 60000) return {};
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

function unit3(x: unknown, y: unknown, z: unknown): [number, number, number] {
  const ax = num(x, 0);
  const ay = num(y, 0);
  const az = num(z, 0);
  const L = Math.hypot(ax, ay, az);
  return L > 1e-4 ? [ax / L, ay / L, az / L] : [0, 0, 1];
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

/** Сколько лечебных зелий в сумке — бот идёт за бутылкой, только если мало. */
function countPotions(p: PlayerState): number {
  return readBag(p).reduce(
    (n, s) => n + (s.item && ITEMS[s.item].heal > 0 ? s.count : 0),
    0,
  );
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
  /** Ключ невидимого спектатора для стрима (этап 17). */
  spectator?: string;
  /** Вход по нику (Ф10): забрать своего бота / персонажа. Без токена. */
  stream?: boolean;
}

/** Ключ спектатора: из окружения, иначе — встроенный (см. shared/constants). */
const SPEC_KEY = process.env.SPECTATOR_KEY || SPECTATOR_KEY;

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
  /** Текущий оверлей стрима (мердж патчей с пульта) — источник правды, переживает рестарт. */
  private overlayCfg: Record<string, unknown> = {};
  // Состояние авто-режиссёра камеры стрима живёт на клиенте-спектаторе; здесь
  // держим последнюю известную копию, чтобы пережить рестарт и отдать её
  // заново подключившемуся спектатору/дашборду (Ф10 — «всё с пульта глобально»).
  private pultAuto = true;
  private pultBotsOnly = false;

  // ---- боты зрителей (Ф10) ----
  private twitch: TwitchChat | null = null;
  private readonly bots = new Map<string, Bot>(); // ключ — normNick
  private readonly chatSeen = new Map<string, number>(); // normNick -> ms последнего сообщения
  private readonly ttsLast = new Map<string, number>(); // normNick -> ms последней озвучки
  private readonly playCd = new Map<string, number>(); // normNick -> ms последнего !play
  private infoAt = 0; // ms последнего ответа на !info (общий кулдаун)
  private bossFighting = false; // босс сейчас в бою (для баннера появления)
  private bossAnnouncedAt = 0; // ms последнего баннера «БОСС ПОЯВИЛСЯ»
  private readonly hintAt = new Map<string, number>(); // normNick -> ms последней подсказки

  override onCreate(): void {
    this.setState(new ZoneState());
    // Настройки пульта — переживают рестарт (Ф10): время суток, видимость
    // метки камеры зрителя и её лучей, оверлей. Мобы/куклы всё равно
    // считаются заново, их сюда не тащим.
    const pult = world.loadPult();
    this.worldHour = typeof pult.hour === "number" ? pult.hour : DAYCYCLE.startHour;
    this.state.hour = this.worldHour;
    this.state.dayAuto = pult.dayAuto === false ? 0 : 1;
    this.state.specVisible = pult.specVisible === false ? 0 : 1;
    this.state.specRaysVisible = pult.specRaysVisible === false ? 0 : 1;
    this.state.specVoice = pult.specVoice === true ? 1 : 0;
    this.state.ttsOn = pult.ttsOn === true ? 1 : 0;
    this.state.ttsVoice = isTtsVoice(pult.ttsVoice ?? "") ? pult.ttsVoice! : TTS_DEFAULT_VOICE;
    this.overlayCfg = { ...(pult.overlay ?? {}) };
    this.pultAuto = pult.auto !== false;
    this.pultBotsOnly = pult.botsOnly === true;
    this.state.mobsOn = pult.mobsOn === false ? 0 : 1;
    this.sim = new ZoneSim();
    this.sim.mobsEnabled = pult.mobsOn !== false;

    // Схема мобов/кукол создаётся один раз — дальше только обновляем поля.
    for (const m of this.sim.mobs.values()) {
      const s = new MobState();
      s.kind = m.kind;
      s.scale = m.scale;
      s.model = m.model;
      s.mobName = m.eliteName;
      s.mobLevel = m.eliteLevel;
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
    // Общая подгонка снаряжения — сразу в состояние, клиенты применят при входе.
    try {
      this.state.worldLoadout = JSON.stringify(world.loadLoadout() ?? {});
    } catch {
      this.state.worldLoadout = "{}";
    }

    this.setSimulationInterval((deltaMs) => this.step(deltaMs / 1000), 50);

    // Чат Twitch: `!play` — бот под ником зрителя, `!stop` — убрать.
    this.twitch = new TwitchChat(
      process.env.TWITCH_CHANNEL || TWITCH_CHANNEL,
      (nick, text) => this.onChat(nick, text),
      // Логин и токен бота — только из окружения (deploy/stream.env на VPS).
      // Не заданы — чат читается как раньше, просто без ответов.
      { user: process.env.TWITCH_BOT_USER, token: process.env.TWITCH_OAUTH },
    );
    this.twitch.start();

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
      p.maxHp = maxHpFor(p.level, p.str);
      p.hp = Math.min(p.maxHp, p.hp + Math.max(0, p.maxHp - before));
      const beforeMana = p.maxMana;
      p.maxMana = maxManaFor(p.level, p.int);
      p.mana = Math.min(p.maxMana, p.mana + Math.max(0, p.maxMana - beforeMana));
    });

    // Смена модельки (панель C) — реальные игроки теперь тоже её носят,
    // не только боты. Живёт только в плоском режиме — рендер решает клиент.
    this.onMessage(MSG.setSkin, (client: Client, msg: SetSkinMsg) => {
      const p = this.state.players.get(client.sessionId);
      const rt = this.rt.get(client.sessionId);
      if (!p || !rt?.token) return;
      const n = Math.floor(Number(msg?.skin));
      if (!Number.isFinite(n) || n < 1 || n > BOT.skins) return;
      p.skin = n;
      store.put(rt.token, { skin: n });
    });

    // Оставлять ли персонажа ботом после выхода (панель C). Срабатывает
    // только у токенов nick:<ник> — у гостевого бот и так никогда не встаёт
    // (см. onLeave), но флаг всё равно сохраняем, вреда нет.
    this.onMessage(MSG.setLeaveBot, (client: Client, msg: SetLeaveBotMsg) => {
      const rt = this.rt.get(client.sessionId);
      if (!rt?.token) return;
      rt.leaveBot = msg?.on !== 0;
      store.put(rt.token, { leaveBot: rt.leaveBot });
    });

    this.onMessage(MSG.cast, (client: Client, msg: CastMsg) => {
      const p = this.state.players.get(client.sessionId);
      const rt = this.rt.get(client.sessionId);
      if (!p || !rt || p.dead || !msg) return;
      // Держит ли посох (любой рукой) — иначе каст невозможен.
      const holds = p.leftCls === "staff" || p.rightCls === "staff";
      if (!holds) return;

      const charge = Math.max(0, Math.min(1, num(msg.charge, 0)));
      const pull = Math.max(0, Math.min(1, num(msg.pull, 0)));

      // --- лечение (небоевое) ---
      if (msg.spell === "heal") {
        const h = MAGIC.heal;
        if (this.elapsed - rt.lastCast < h.cooldown) return;
        if (charge < h.minCharge || p.mana < h.minMana) return;
        // Цель: союзник в радиусе, иначе сам.
        let target = p;
        if (typeof msg.targetId === "string" && msg.targetId !== client.sessionId) {
          const tp = this.state.players.get(msg.targetId);
          const near =
            tp &&
            !tp.dead &&
            Math.hypot(tp.head.x - p.head.x, tp.head.y - p.head.y, tp.head.z - p.head.z) < h.allyRange;
          if (near) target = tp;
        }
        const hcost = Math.min(p.mana, charge * h.chargeTime * h.manaPerSec);
        p.mana = Math.max(0, p.mana - hcost);
        rt.lastCast = this.elapsed;
        const beforeHp = target.hp;
        target.hp = Math.min(target.maxHp, target.hp + healAmountFor(p.level, p.int, charge));
        // Лечение союзника в бою с боссом — вклад в общий опыт (гибридный делёж).
        if (target !== p) this.sim.bossHeal(client.sessionId, target.hp - beforeHp);
        return;
      }

      if (this.elapsed - rt.lastCast < MAGIC.firebolt.cooldown) return;
      // Заряд ниже минимума ИЛИ не хватило маны на минимальный старт — впустую.
      if (charge < MAGIC.firebolt.minCharge || p.mana < MAGIC.firebolt.minMana) return;

      // Мана уже списывалась на клиенте по мере накопления; сервер списывает
      // столько, сколько стоил бы этот заряд, но не больше, чем есть.
      const cost = Math.min(p.mana, (charge / 1) * MAGIC.firebolt.chargeTime * MAGIC.firebolt.manaPerSec);
      p.mana = Math.max(0, p.mana - cost);
      rt.lastCast = this.elapsed;

      const [dx, dy, dz] = unit3(msg.dx, msg.dy, msg.dz);
      const boltDmg = fireboltDamage(p.level, p.int, charge);
      this.sim.castBolt(
        num(msg.ox, p.head.x),
        num(msg.oy, p.head.y),
        num(msg.oz, p.head.z),
        dx, dy, dz,
        fireboltSpeed(pull),
        fireboltRadius(charge),
        fireboltHitRadius(charge),
        boltDmg,
        client.sessionId,
        MAGIC.firebolt.life,
        0,
        fireboltSplashRadius(charge),
        boltDmg * MAGIC.firebolt.splashFraction,
      );
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
      // Соседям — анимация подбора на модельке (PickUp).
      const relay: ActRelay = { k: "pickup", id: client.sessionId, x: p.head.x, y: p.head.y, z: p.head.z };
      this.broadcast(MSG.act, relay, { except: client });
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

    // Общие настройки комфорта VR (виньетка, режим перемещения) — только админ.
    this.onMessage(MSG.comfort, (client: Client, msg: ComfortMsg) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || p.nick.trim().toLowerCase() !== ADMIN_NICK || !msg) return;
      if (msg.vignette !== undefined) this.state.comfortVignette = msg.vignette ? 1 : 0;
      if (msg.teleport !== undefined) this.state.teleportMove = msg.teleport ? 1 : 0;
    });

    // Общая подгонка снаряжения — только админ. Применяется всем, переживает
    // перезапуск сервера. Клиент шлёт частичный Loadout (hands/items/belt/hud/light).
    this.onMessage(MSG.setWorldLoadout, (client: Client, msg: WorldLoadoutMsg) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || p.nick.trim().toLowerCase() !== ADMIN_NICK) return;
      if (!msg || typeof msg !== "object" || Array.isArray(msg)) return;
      let json: string;
      try {
        json = JSON.stringify(msg);
      } catch {
        return;
      }
      if (json.length > 8000) return; // защита от мусора
      world.saveLoadout(msg as Record<string, unknown>);
      this.state.worldLoadout = json; // схема разошлёт всем
    });

    // Очистка мира от лежащего лута — по кнопке в панели, только админ.
    this.onMessage(MSG.clearWorld, (client: Client) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || p.nick.trim().toLowerCase() !== ADMIN_NICK) return;
      this.wipeWorld(`админ ${p.nick}`);
    });

    // PvP-флаг (этап 10). Включить можно всегда; снять — только если с
    // последнего обмена ударами прошло PVP.disengage секунд.
    this.onMessage(MSG.setPvp, (client: Client, msg: SetPvpMsg) => {
      const p = this.state.players.get(client.sessionId);
      const rt = this.rt.get(client.sessionId);
      if (!p || !rt || !msg) return;
      const want = msg.on ? 1 : 0;
      if (want === 0 && p.pvp === 1) {
        const left = PVP.disengage - (this.elapsed - rt.lastPvpAt);
        if (left > 0) {
          client.send(MSG.setPvp, { on: 1, wait: Math.ceil(left) } satisfies SetPvpMsg);
          return;
        }
      }
      p.pvp = want;
      client.send(MSG.setPvp, { on: want } satisfies SetPvpMsg);
    });

    // Панельные настройки: храним по токену, применяются только у этого игрока.
    this.onMessage(MSG.loadout, (client: Client, msg: OverridesMsg) => {
      const rt = this.rt.get(client.sessionId);
      if (!rt || !msg || typeof msg !== "object" || Array.isArray(msg)) return;
      const next = sanitizeOverrides(msg);
      // Пустой блок НЕ затирает сохранённую подгонку: если у клиента
      // почистился localStorage, «Сохранить» не должно обнулить настройки
      // на сервере. Осознанный сброс идёт покнопочно (resetTarget).
      if (Object.keys(next).length === 0 && Object.keys(rt.overrides).length > 0) return;
      rt.overrides = next;
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
      // Адресат — игрок в комнате или рендерящий спектатор (он слушает голос
      // игроков для стрима, микрофона у него нет).
      if (!this.state.players.has(msg.peer) && !this.spectators.has(msg.peer)) return;
      this.clientOf(msg.peer)?.send(MSG.rtc, {
        peer: client.sessionId,
        kind: msg.kind,
        data: msg.data,
      });
    });

    // Голос через сервер (запасной путь, когда прямое соединение не встало).
    this.onMessage(MSG.voice, (client: Client, msg: VoiceMsg) => {
      if (!msg || typeof msg.t !== "number" || !Array.isArray(msg.d)) return;
      if (msg.d.length === 0 || msg.d.length > 4000) return;
      this.broadcast(MSG.voice, { id: client.sessionId, t: msg.t, d: msg.d }, { except: client });
    });

    // Команды стрим-дашборда (этап 17 Ф5). Только между спектаторскими
    // подключениями; `time` применяет сам сервер.
    this.onMessage(MSG.specCmd, (client: Client, msg: SpecCmd) => {
      if (!this.spectators.has(client.sessionId) || !msg || typeof msg.t !== "string") return;
      if (msg.t === "time" && typeof msg.hour === "number" && Number.isFinite(msg.hour)) {
        this.worldHour = (((msg.hour % 24) + 24) % 24) as number;
        this.state.hour = this.worldHour;
        this.state.dayAuto = 0; // ручной перевод останавливает авто-ход
        this.clockSync = 0;
        world.savePult({ hour: this.worldHour, dayAuto: false });
      } else if (msg.t === "dayAuto") {
        this.state.dayAuto = msg.on ? 1 : 0;
        world.savePult({ dayAuto: msg.on !== 0 });
      } else if (msg.t === "clearLoot") {
        this.wipeWorld("админ-панель пульта");
      } else if (msg.t === "mobsOn") {
        this.sim.mobsEnabled = msg.on !== 0;
        this.state.mobsOn = msg.on !== 0 ? 1 : 0;
        world.savePult({ mobsOn: msg.on !== 0 });
      } else if (msg.t === "auto") {
        this.pultAuto = msg.on !== 0;
        world.savePult({ auto: this.pultAuto });
      } else if (msg.t === "bots") {
        this.pultBotsOnly = msg.on !== 0;
        if (this.pultBotsOnly) this.pultAuto = true;
        world.savePult({ botsOnly: this.pultBotsOnly, auto: this.pultAuto });
      } else if (msg.t === "specVisible") {
        this.state.specVisible = msg.on !== 0 ? 1 : 0;
        world.savePult({ specVisible: msg.on !== 0 });
      } else if (msg.t === "specRaysVisible") {
        this.state.specRaysVisible = msg.on !== 0 ? 1 : 0;
        world.savePult({ specRaysVisible: msg.on !== 0 });
      } else if (msg.t === "specVoice") {
        this.state.specVoice = msg.on !== 0 ? 1 : 0;
        world.savePult({ specVoice: msg.on !== 0 });
      } else if (msg.t === "tts") {
        this.state.ttsOn = msg.on !== 0 ? 1 : 0;
        world.savePult({ ttsOn: msg.on !== 0 });
      } else if (msg.t === "ttsVoice" && isTtsVoice(msg.ref)) {
        this.state.ttsVoice = msg.ref;
        world.savePult({ ttsVoice: msg.ref });
      } else if (msg.t === "overlay" && msg.patch && typeof msg.patch === "object") {
        Object.assign(this.overlayCfg, msg.patch);
        world.savePult({ overlay: this.overlayCfg });
      }
      this.broadcast(MSG.specCmd, msg, { except: client });
    });

    // Позиция камеры стрима — только от рендерящего спектатора (у пульта
    // своей камеры нет, он её и не шлёт). Троттлит сам клиент; здесь просто
    // кладём в синхронизируемое состояние — метку в мире рисует Game.ts.
    this.onMessage(MSG.specCam, (client: Client, msg: SpecCamMsg) => {
      if (!this.spectators.has(client.sessionId) || !msg) return;
      const n = (v: unknown, d: number): number => (Number.isFinite(v) ? (v as number) : d);
      this.state.specX = n(msg.x, this.state.specX);
      this.state.specY = n(msg.y, this.state.specY);
      this.state.specZ = n(msg.z, this.state.specZ);
      this.state.specTX = n(msg.tx, this.state.specTX);
      this.state.specTY = n(msg.ty, this.state.specTY);
      this.state.specTZ = n(msg.tz, this.state.specTZ);
      this.state.specActive = 1;
    });

    console.log(`[zone] комната ${this.roomId} создана`);
  }

  // ---- удары игрока ----

  /** Заявка на попадание. Дистанцию, темп и урон решает сервер. */
  private tryHit(client: Client, msg: HitMobMsg): void {
    const p = this.state.players.get(client.sessionId);
    const rt = this.rt.get(client.sessionId);
    if (!p || !rt || p.dead || !msg?.id) return;
    if (msg.target !== "mob" && msg.target !== "dummy" && msg.target !== "player") return;
    if (!isWeaponKind(msg.weapon)) return;

    // Темп: чаще, чем позволяет оружие, удары не засчитываются. Скорость
    // атаки (уровень + ловкость) укорачивает интервал.
    const last = rt.lastHit[msg.weapon];
    const rate = WEAPON_RATE[msg.weapon] / attackSpeedFor(p.level, p.agi);
    if (last !== undefined && this.elapsed - last < rate) return;

    const hand = msg.hand === "left" ? "left" : "right";

    // PvP: урон между игроками — только если у ОБОИХ включён флаг.
    if (msg.target === "player") {
      const tp = this.state.players.get(msg.id);
      const trt = this.rt.get(msg.id);
      if (!tp || !trt || msg.id === client.sessionId || tp.dead || trt.invuln > 0) return;
      if (p.pvp !== 1 || tp.pvp !== 1) return;
      const d = Math.hypot(
        tp.head.x - p.head.x,
        tp.head.y - p.head.y,
        tp.head.z - p.head.z,
      );
      if (d > WEAPON_REACH[msg.weapon]) return;
      rt.lastHit[msg.weapon] = this.elapsed;
      rt.lastPvpAt = this.elapsed;
      trt.lastPvpAt = this.elapsed;
      const pvpDmg = weaponDamage(msg.weapon, p.level, p.str, multIn(p, hand), p.agi) * PVP.damageMult;
      this.hurtPlayer({
        target: msg.id,
        dmg: pvpDmg,
        fromX: p.head.x,
        fromZ: p.head.z,
        projectile: msg.weapon === "arrow",
        byName: p.nick,
      });
      return;
    }

    const at = this.sim.targetCenter(msg.target, msg.id);
    if (!at) return;
    const dist = Math.hypot(at.x - p.head.x, at.y - p.head.y, at.z - p.head.z);
    if (dist > WEAPON_REACH[msg.weapon]) return; // слишком далеко — не верим

    rt.lastHit[msg.weapon] = this.elapsed;
    const dmg = weaponDamage(msg.weapon, p.level, p.str, multIn(p, hand), p.agi);
    const [dx, dz] = unit2(msg.dx, msg.dz);

    if (msg.target === "dummy") {
      this.sim.hitDummy(msg.id, dmg);
      return;
    }
    // Позиция цели ДО удара: моб может умереть и исчезнуть, а сплэш считаем
    // вокруг того места, куда пришёлся клинок.
    const struck = msg.target === "mob" ? this.sim.mobs.get(msg.id) : undefined;
    const sx = struck?.x ?? 0;
    const sy = struck?.y ?? 0;
    const sz = struck?.z ?? 0;
    // Опыт, счётчик убийств и кил-фид — через общий делёж (sim.mobXpShare /
    // sim.mobKills), не здесь: моба мог добить один, а бить помогали несколько.
    this.sim.hitMob(msg.id, dmg, dx || 0, dz || 1, client.sessionId);
    // Меч задевает соседей рядом с целью — небольшой АОЕ.
    if (struck && msg.weapon === "sword") {
      this.sim.splashDamage(
        sx, sy, sz,
        COMBAT.swordSplashRadius,
        dmg * COMBAT.swordSplashFraction,
        msg.id,
        client.sessionId,
      );
    }
  }

  /** id игрока/бота в state.players по его состоянию. */
  private idOf(p: PlayerState): string | null {
    for (const [id, st] of this.state.players) if (st === p) return id;
    return null;
  }

  private awardXp(client: Client | undefined, p: PlayerState, amount: number): void {
    const prog = readProgress(p);
    const levels = grantXp(prog, amount);
    writeProgress(p, prog);
    p.maxMana = maxManaFor(p.level, p.int);
    if (levels <= 0) return;
    // Новый уровень: потолок HP вырос — доливаем разницу плюс бонус.
    const beforeHp = p.maxHp;
    p.maxHp = maxHpFor(p.level, p.str);
    p.hp = Math.min(p.maxHp, p.hp + Math.max(0, p.maxHp - beforeHp) + LEVEL_UP_HEAL * levels);
    client?.send(MSG.levelUp, { level: p.level });
    // Соседям (и спектатору) — чтобы над телом всплыли оранжевые крестики и
    // прозвучал уровень. У бота клиента нет, так что это единственный сигнал.
    const id = this.idOf(p);
    if (id) {
      const relay: ActRelay = { k: "levelUp", id, x: p.head.x, y: p.head.y, z: p.head.z };
      this.broadcast(MSG.act, relay, client ? { except: client } : undefined);
    }
    // У бота уровень ещё и отмечаем эмоцией — виден со стороны на модельке.
    if (id?.startsWith("bot:")) {
      const bot = this.bots.get(id.slice(4));
      if (bot) this.triggerEmote(bot, "cheer");
    }
  }

  // ---- боты зрителей (Ф10) ----

  /**
   * Топ по ник-токенам (`nick:<ник>`) — только герои зрителей, обычных
   * игроков без публичного ника в таблицу не тащим. Живые (бот в мире или
   * зритель зашёл сам) перекрывают сейв — тот отстаёт до 10 с (см. step()).
   * Сортировка: уровень → опыт → убийства.
   */
  private leaderboard(limit: number): LeaderboardRow[] {
    const byNorm = new Map<string, LeaderboardRow>();
    for (const rec of store.entries()) {
      if (!rec.token.startsWith("nick:")) continue;
      byNorm.set(rec.token.slice(5), {
        nick: rec.nick || rec.token.slice(5),
        level: rec.level,
        xp: rec.xp,
        kills: rec.kills ?? 0,
      });
    }
    for (const [id, rt] of this.rt) {
      if (!rt.token?.startsWith("nick:")) continue;
      const p = this.state.players.get(id);
      if (!p) continue;
      byNorm.set(rt.token.slice(5), { nick: p.nick, level: p.level, xp: p.xp, kills: rt.kills });
    }
    return [...byNorm.values()]
      .sort((a, b) => b.level - a.level || b.xp - a.xp || b.kills - a.kills)
      .slice(0, limit);
  }

  private broadcastLeaderboard(): void {
    if (this.clients.length === 0) return;
    this.broadcast(MSG.leaderboard, this.leaderboard(5));
  }

  /** `!top` — топ-5 текстом в чат канала. */
  private sayTop(): void {
    const top = this.leaderboard(5);
    if (top.length === 0) {
      this.reply("Пока никто не начал приключение — !play, чтобы стать первым.");
      return;
    }
    const medal = ["🥇", "🥈", "🥉", "4)", "5)"];
    this.reply(
      `Топ героев: ${top
        .map((r, i) => `${medal[i]} ${r.nick} ур.${r.level} (${r.kills})`)
        .join(" · ")}`,
    );
  }

  /** `!cheer` — разовая эмоция на модельке бота (Ф10). */
  private botEmote(nick: string, norm: string, emote: BotEmote): void {
    const bot = this.bots.get(norm);
    if (!bot) {
      if (this.hintOk(norm)) this.reply(`@${nick} героя нет в мире — сначала !play.`);
      return;
    }
    if (Date.now() - bot.emoteAt < BOT.emoteCooldown * 1000) return; // антиспам, молча
    this.triggerEmote(bot, emote);
  }

  /**
   * Пускает клип эмоции без проверки кулдауна из чата — общий момент для
   * `!cheer` и автоматических триггеров (уровень, случайный кувырок на бегу).
   * Сам кулдаун (`emoteAt`) всё равно ставим — иначе автотриггер и команда
   * из чата могли бы наложиться друг на друга без паузы между ними.
   */
  private triggerEmote(bot: Bot, emote: BotEmote): void {
    const now = Date.now();
    bot.emoteAt = now;
    // Стоим смирно, пока играет клип — иначе модель "едет" под анимацией.
    bot.emoteFreezeUntil = now + BOT.emoteDuration[emote] * 1000;
    const msg: EmoteMsg = { id: bot.id, emote };
    this.broadcast(MSG.emote, msg);
  }

  /**
   * `!follow <ник>` / `!come` (алиас на стримера) / `!unfollow` — держаться
   * рядом с кем-то между боями. `target` уже нормализован, `null` — снять.
   */
  /** Босс-моб из симуляции (или undefined, пока не заспавнен). Тип выводится. */
  private bossMob() {
    for (const m of this.sim.mobs.values()) if (m.kind === "boss") return m;
    return undefined;
  }

  /** `!raid` / `!boss` — послать/отозвать героя в рейд на Багрового слизня. */
  private setRaid(nick: string, norm: string): void {
    const bot = this.bots.get(norm);
    if (!bot) {
      if (this.hintOk(norm)) this.reply(`@${nick} героя нет в мире — сначала !play.`);
      return;
    }
    if (bot.raiding) {
      bot.raiding = false;
      this.reply(`@${nick} герой вышел из рейда — снова бродит по зоне.`);
      return;
    }
    const boss = this.bossMob();
    if (!boss || boss.dead) {
      this.reply(`@${nick} Багровый слизень сейчас повержен — вернётся позже.`);
      return;
    }
    bot.raiding = true;
    bot.followNorm = null; // рейд важнее !follow
    const n = [...this.bots.values()].filter((b) => b.raiding).length;
    this.reply(
      n === 1
        ? `@${nick} повёл героя на Багрового слизня! Погибнет — возродится и пойдёт снова, ` +
            `пока Багровый не падёт. Ещё !raid — отозвать. Пишите вместе — идём толпой.`
        : `@${nick} в рейде на Багрового. Героев идёт: ${n}.`,
    );
  }

  private setFollow(nick: string, norm: string, target: string | null): void {
    const bot = this.bots.get(norm);
    if (!bot) {
      if (this.hintOk(norm)) this.reply(`@${nick} героя нет в мире — сначала !play.`);
      return;
    }
    bot.raiding = false; // !follow/!come/!stay отменяет рейд
    bot.followNorm = target;
    if (!target) {
      this.reply(`@${nick} герой сам по себе — снова бродит и бьёт мобов.`);
      return;
    }
    const here = [...this.state.players.values()].some((ps) => normNick(ps.nick) === target);
    this.reply(
      here
        ? `@${nick} герой держится рядом с ${target}, пока не бьётся с мобом.`
        : `@${nick} герой пойдёт к ${target}, как только тот появится в игре.`,
    );
  }

  /** Ник допущен: в ручном списке или недавно писал в чат. */
  private allowedNick(norm: string): boolean {
    if (STREAM_NICKS.includes(norm)) return true;
    const seen = this.chatSeen.get(norm) ?? 0;
    return Date.now() - seen < BOT.chatWindowSec * 1000;
  }

  /** Этим ником сейчас играет живой клиент (не бот)? */
  private nickIsPlayed(norm: string): boolean {
    const want = `nick:${norm}`;
    for (const [id, rt] of this.rt) {
      if (!id.startsWith("bot:") && rt.token === want) return true;
    }
    return false;
  }

  private onChat(nick: string, text: string): void {
    const norm = normNick(nick);
    if (!norm) return;
    this.chatSeen.set(norm, Date.now());
    const parts = text.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();
    if (cmd === "!play" || cmd === "!join") this.requestBot(nick, norm);
    else if (cmd === "!stop" || cmd === "!leave") {
      if (this.bots.has(norm)) {
        this.removeBot(norm);
        this.reply(`@${nick} герой ушёл из мира. !play — вернуть.`);
      }
    }
    else if (cmd === "!skin" || cmd === "!model" || cmd === "!skins") this.reskinBot(norm, parts[1]);
    else if (cmd === "!info" || cmd === "!help" || cmd === "!commands") this.sayInfo();
    else if (cmd === "!stats" || cmd === "!stat" || cmd === "!hero" || cmd === "!me") {
      this.sayStats(norm);
    } else if (cmd === "!str" || cmd === "!dex" || cmd === "!int") {
      // В чате ловкость — !dex, внутри она по-прежнему agi.
      const stat: StatName = cmd === "!dex" ? "agi" : (cmd.slice(1) as StatName);
      this.spendBotPoint(norm, stat, parts[1]);
    } else if (
      cmd === "!respec" ||
      cmd === "!reroll" ||
      cmd === "!перекачать" ||
      cmd === "!сбросочки"
    ) {
      this.respecBot(norm);
    } else if (cmd === "!delete" || cmd === "!reset") {
      this.deleteBot(nick, norm);
    } else if (cmd === "!top" || cmd === "!leaders" || cmd === "!leaderboard") {
      this.sayTop();
    } else if (cmd === "!cheer" || cmd === "!defeat") {
      // !roll и !jump убраны из чата: roll теперь сам иногда играет на
      // бегу, а отдельная команда под него/jump не нужна (см. tickBot).
      this.botEmote(nick, norm, cmd.slice(1) as BotEmote);
    } else if (cmd === "!follow") {
      this.setFollow(nick, norm, normNick(parts[1] ?? ""));
    } else if (cmd === "!unfollow" || cmd === "!stay" || cmd === "!stayhere") {
      this.setFollow(nick, norm, null);
    } else if (cmd === "!come") {
      this.setFollow(nick, norm, normNick(ADMIN_NICK));
    } else if (cmd === "!raid" || cmd === "!boss") {
      this.setRaid(nick, norm);
    } else if (cmd === "!voice" || cmd === "!голос") {
      this.setChatVoice(nick, norm, parts.slice(1).join(" "));
    }
    else if (cmd && !cmd.startsWith("!")) {
      this.botSay(norm, text);
      this.voiceChat(nick, norm, text);
    }
  }

  /** `!voice` — зритель выбирает голос озвучки СВОИХ сообщений в чате. */
  private setChatVoice(nick: string, norm: string, arg: string): void {
    const a = arg.trim().toLowerCase();
    if (!a || a === "list" || a === "список" || a === "?") {
      this.reply(`@${nick} голоса: ${ttsVoiceMenu()} · выбрать: !voice <номер|имя>, сбросить: !voice off`);
      return;
    }
    if (a === "off" || a === "выкл" || a === "сброс" || a === "reset") {
      world.setChatVoice(norm, null);
      this.reply(`@${nick} голос сброшен — озвучка общим голосом стрима.`);
      return;
    }
    const ref = ttsVoiceFromQuery(arg);
    if (!ref) {
      this.reply(`@${nick} не нашёл такой голос. Список: !voice list`);
      return;
    }
    world.setChatVoice(norm, ref);
    this.reply(`@${nick} твой голос озвучки: ${ttsVoiceName(ref)}.`);
  }

  /**
   * Озвучка сообщения чата на стриме (Fish Audio). Трогает сеть/файлы только
   * когда пульт включил озвучку И подключён рендерящий спектатор И задан ключ.
   * Готовый mp3 шлём ТОЛЬКО спектаторам — игроки его не слышат.
   */
  private voiceChat(nick: string, norm: string, text: string): void {
    if (!this.state.ttsOn || !ttsAvailable() || this.spectators.size === 0) return;
    const now = Date.now();
    if (now - (this.ttsLast.get(norm) ?? 0) < 4000) return; // не частим на одного
    this.ttsLast.set(norm, now);
    // Выбор зрителя (!voice) в приоритете; иначе общий голос стрима с пульта.
    const own = world.chatVoice(norm);
    const voice =
      own && isTtsVoice(own)
        ? own
        : isTtsVoice(this.state.ttsVoice)
          ? this.state.ttsVoice
          : TTS_DEFAULT_VOICE;
    void synthChat(text, voice).then((url) => {
      if (!url || this.spectators.size === 0) return;
      const cmd: SpecCmd = { t: "ttsPlay", url, nick };
      for (const c of this.clients) {
        if (this.spectators.has(c.sessionId)) c.send(MSG.specCmd, cmd);
      }
    });
  }

  /**
   * Ответ в чат канала. Работает, только если в окружении задан аккаунт бота
   * (см. TwitchChat) — иначе тихо пропускается.
   */
  private reply(text: string): void {
    this.twitch?.say(text);
  }

  /** Русское имя атрибута для чата. */
  private static statName(stat: StatName): string {
    return stat === "str" ? "сила" : stat === "agi" ? "ловкость" : "интеллект";
  }

  /** Антиспам подсказок для ников без активного бота. */
  private hintOk(norm: string): boolean {
    const now = Date.now();
    if (now - (this.hintAt.get(norm) ?? 0) < BOT.statsCooldown * 1000) return false;
    this.hintAt.set(norm, now);
    return true;
  }

  /** `!stats` — прогресс бота, а если его нет — что сделать, чтобы он был. */
  private sayStats(norm: string): void {
    const bot = this.bots.get(norm);
    if (!bot) {
      if (!this.hintOk(norm)) return;
      const rec = store.get(`nick:${norm}`);
      if (rec) {
        // Герой есть в сейве, просто сейчас не в мире.
        this.reply(
          `@${rec.nick || norm} герой ур.${rec.level} ждёт за воротами — !play, чтобы вывести его в мир.`,
        );
      } else {
        this.reply(`@${norm} у тебя ещё нет героя — напиши !play, и он выйдет в мир.`);
      }
      return;
    }
    const now = Date.now();
    if (now - bot.statsAt < BOT.statsCooldown * 1000) return;
    bot.statsAt = now;
    const p = bot.state;
    const xp = atMaxLevel(p.level) ? "макс" : `${Math.floor(p.xp)}/${xpToNext(p.level)}`;
    const points =
      p.unspent > 0 ? `свободных очков ${p.unspent} → !str !dex !int` : "свободных очков нет";
    this.reply(
      `@${bot.nick} ур.${p.level} · опыт ${xp} · HP ${Math.ceil(p.hp)}/${Math.round(p.maxHp)} · ` +
        `сила ${p.str} · ловкость ${p.agi} · интеллект ${p.int} · ${points}`,
    );
  }

  /** `!str` / `!agi` / `!int` [сколько] — вложить очки в атрибут. */
  private spendBotPoint(norm: string, stat: StatName, arg: string | undefined): void {
    const bot = this.bots.get(norm);
    if (!bot) {
      if (this.hintOk(norm)) this.reply(`@${norm} героя нет в мире — сначала !play.`);
      return;
    }
    const p = bot.state;
    if (p.unspent <= 0) {
      // Без кулдауна тут был бы флуд отказами, поэтому делим его со !stats.
      const now = Date.now();
      if (now - bot.statsAt < BOT.statsCooldown * 1000) return;
      bot.statsAt = now;
      this.reply(`@${bot.nick} свободных очков нет — их дают за новый уровень.`);
      return;
    }

    const want = Math.max(1, Math.min(p.unspent, Math.floor(Number(arg)) || 1));
    const prog = readProgress(p);
    let done = 0;
    while (done < want && spendPoint(prog, stat)) done++;
    if (done === 0) return;
    writeProgress(p, prog);

    // Потолки HP/маны растут сразу — как в обработчике MSG.spend.
    const beforeHp = p.maxHp;
    p.maxHp = maxHpFor(p.level, p.str);
    p.hp = Math.min(p.maxHp, p.hp + Math.max(0, p.maxHp - beforeHp));
    const beforeMana = p.maxMana;
    p.maxMana = maxManaFor(p.level, p.int);
    p.mana = Math.min(p.maxMana, p.mana + Math.max(0, p.maxMana - beforeMana));

    // Перекос характеристик сменился — меняем оружие бота на лету. Если он нёс
    // найденный золотой меч, а билд стал не мечевым — меч падает на поляну.
    const w = botWeaponFor(p.str, p.agi, p.int);
    if (w !== p.rightCls) {
      if (p.rightTier === "gold" && p.rightCls === "sword") {
        this.sim.dropWeapon("sword", "gold", p.head.x, p.head.z);
      }
      p.rightCls = w;
      p.rightTier = "base";
      p.leftCls = w === "bow" ? "" : "shield";
      p.leftTier = w === "bow" ? "" : "base";
    }
    this.persistBot(bot);

    const name = ZoneRoom.statName(stat);
    this.reply(
      `@${bot.nick} ${name} ${prog[stat]}` +
        (done > 1 ? ` (+${done})` : "") +
        ` · осталось очков ${p.unspent}`,
    );
  }

  /**
   * `!delete` — убрать героя и стереть его прогресс. Следующий `!play`
   * создаст нового с 1 уровня.
   */
  private deleteBot(nick: string, norm: string): void {
    if (this.nickIsPlayed(norm)) {
      this.reply(`@${nick} нельзя удалять героя, пока играешь им сам — сначала выйди из игры.`);
      return;
    }
    const token = `nick:${norm}`;
    const had = this.bots.has(norm) || !!store.get(token);
    if (!had) {
      if (this.hintOk(norm)) this.reply(`@${nick} удалять нечего — героя ещё нет.`);
      return;
    }
    // Сначала снимаем бота с карты, иначе автосохранение вернёт запись обратно.
    const bot = this.bots.get(norm);
    if (bot) {
      this.state.players.delete(bot.id);
      this.rt.delete(bot.id);
      this.bots.delete(norm);
    }
    store.del(token);
    store.flush(); // сброс должен пережить падение сервера сразу
    this.playCd.delete(norm); // не заставляем ждать кулдаун !play после сброса
    console.log(`[bot] удалён прогресс ${nick}`);
    this.reply(`@${nick} герой удалён, прогресс обнулён. !play — начать заново с 1 уровня.`);
    if (this.state.players.size === 0) this.wipeWorld("мир опустел");
  }

  /**
   * `!respec` / `!reroll` / `!перекачать` — вернуть все вложенные очки атрибутов
   * в запас. Уровень, опыт и всё прочее не трогаем.
   */
  private respecBot(norm: string): void {
    const bot = this.bots.get(norm);
    if (!bot) {
      if (this.hintOk(norm)) this.reply(`@${norm} героя нет в мире — сначала !play.`);
      return;
    }
    const p = bot.state;
    const base = PROGRESSION.startStat;
    const back = p.str - base + (p.agi - base) + (p.int - base);
    if (back <= 0) {
      const now = Date.now();
      if (now - bot.statsAt < BOT.statsCooldown * 1000) return;
      bot.statsAt = now;
      this.reply(`@${bot.nick} очки атрибутов ещё не вложены — сбрасывать нечего.`);
      return;
    }
    const prog = readProgress(p);
    prog.str = prog.agi = prog.int = base;
    prog.unspent += back;
    writeProgress(p, prog);

    // Потолки HP/маны пересчитываем от новых (базовых) атрибутов.
    p.maxHp = maxHpFor(p.level, p.str);
    p.hp = Math.min(p.hp, p.maxHp);
    p.maxMana = maxManaFor(p.level, p.int);
    p.mana = Math.min(p.mana, p.maxMana);

    // Билд стал нейтральным — оружие возвращается к мечу (золотой не-меч роняем).
    const w = botWeaponFor(p.str, p.agi, p.int);
    if (w !== p.rightCls) {
      if (p.rightTier === "gold" && p.rightCls === "sword") {
        this.sim.dropWeapon("sword", "gold", p.head.x, p.head.z);
      }
      p.rightCls = w;
      p.rightTier = "base";
      p.leftCls = w === "bow" ? "" : "shield";
      p.leftTier = w === "bow" ? "" : "base";
    }
    this.persistBot(bot);
    this.reply(`@${bot.nick} очки атрибутов сброшены · свободных очков ${p.unspent} → !str !dex !int`);
  }

  /** `!info` — список команд. Общий на всех, поэтому с глобальным кулдауном. */
  private sayInfo(): void {
    const now = Date.now();
    if (now - this.infoAt < BOT.infoCooldown * 1000) return;
    this.infoAt = now;
    // Двумя сообщениями: одной строкой TwitchChat.say() режет на 460
    // символов (see MAX_LEN) — список команд разросся и в одну не влезал.
    this.reply(
      "Команды: !play — твой герой выходит в мир и сам дерётся с мобами · " +
        "!stop — убрать его · !skin — сменить внешность (или !skin 3, всего " +
        `${BOT.skins}) · !stats — его прогресс · !str/!dex/!int — вложить очко атрибута · ` +
        "!respec — вернуть все очки атрибутов в запас · " +
        "!delete — стереть героя и начать заново · !top — таблица лидеров.",
    );
    this.reply(
      "Ещё: !raid — герой идёт на Багрового слизня (ещё !raid — выйти, пишите " +
        "вместе — идём толпой) · !cheer/!defeat — эмоции · !follow <ник> / !come — " +
        "идти рядом, !unfollow — назад к делам · !voice <номер|имя> — выбрать голос " +
        "озвучки своих сообщений (!voice list — список) · обычное сообщение в чат он " +
        "скажет вслух над головой. Зайти за своего героя самому: ссылка в описании " +
        "стрима, ник — как в Twitch.",
    );
  }

  /** Обычная реплика в чате канала — облачком над своим ботом (Ф10). */
  private botSay(norm: string, text: string): void {
    const bot = this.bots.get(norm);
    if (!bot) return;
    const now = Date.now();
    if (now - bot.sayAt < BOT.sayCooldown * 1000) return;
    // Схлопываем переносы/лишние пробелы и режем — облачко не резиновое.
    const clean = text.replace(/\s+/g, " ").trim().slice(0, BOT.sayMaxLen);
    if (!clean) return;
    bot.sayAt = now;
    const msg: BotSayMsg = { id: bot.id, text: clean };
    this.broadcast(MSG.botSay, msg);
  }

  /** `!skin` / `!skin 3` — сменить модель своего бота (рандом или номер 1..N). */
  private reskinBot(norm: string, arg: string | undefined): void {
    const bot = this.bots.get(norm);
    if (!bot) return;
    const now = Date.now();
    if (now - bot.reskinAt < 3000) return; // антиспам
    bot.reskinAt = now;

    const p = bot.state;
    const n = arg ? parseInt(arg, 10) : NaN;
    let next: number;
    if (Number.isFinite(n) && n >= 1 && n <= BOT.skins) {
      next = n;
    } else {
      next = 1 + Math.floor(Math.random() * BOT.skins);
      if (BOT.skins > 1 && next === p.skin) next = (next % BOT.skins) + 1; // не тот же
    }
    if (next === p.skin) return;
    p.skin = next;
    this.persistBot(bot);
    console.log(`[bot] ${bot.nick} модель → ${next}`);
    this.reply(`@${bot.nick} внешность ${next} из ${BOT.skins}.`);
  }

  private requestBot(nick: string, norm: string): void {
    if (!this.allowedNick(norm)) return;
    if (this.nickIsPlayed(norm)) {
      this.reply(`@${nick} ты сейчас сам за этого героя — бот не нужен.`);
      return;
    }
    if (this.bots.has(norm)) {
      this.reply(`@${nick} твой герой уже в мире.`);
      return;
    }
    const now = Date.now();
    if (now - (this.playCd.get(norm) ?? 0) < BOT.playCooldown * 1000) return; // антиспам, молча
    if (this.bots.size >= BOT.maxBots) {
      console.log(`[bot] отказ ${nick}: потолок ${BOT.maxBots}`);
      this.reply(`@${nick} сейчас в мире максимум героев (${BOT.maxBots}) — попробуй чуть позже.`);
      return;
    }
    this.playCd.set(norm, now);
    this.spawnBot(nick, norm);
    const p = this.bots.get(norm)?.state;
    this.reply(`@${nick} твой герой вышел в мир, ур.${p?.level ?? 1}. !stop — убрать, !skin — сменить внешность.`);
  }

  private spawnBot(nick: string, norm: string): void {
    const id = `bot:${norm}`;
    const token = `nick:${norm}`;
    const rec = store.get(token);

    const p = new PlayerState();
    p.nick = nick.trim().slice(0, 16) || rec?.nick || "зритель";
    p.mode = "flat";
    if (rec) {
      p.level = rec.level;
      p.xp = rec.xp;
      p.unspent = rec.unspent;
      p.str = rec.str;
      p.agi = rec.agi;
      p.int = rec.int;
    }
    // Расселение по уровню: слабых — на поляну, прокачанных — к сильным лагерям.
    const home = botHome(p.level);
    const sp = botSpawnAt(home);
    p.head.x = sp.x;
    p.head.z = sp.z;
    p.head.y = terrainHeight(p.head.x, p.head.z) + PLAYER.eyeHeight;
    p.maxHp = maxHpFor(p.level, p.str);
    p.hp = p.maxHp;
    p.maxMana = maxManaFor(p.level, p.int);
    p.mana = p.maxMana;
    // Оружие сохраняем (золотой меч из лута, ранее выданный лук/посох — не
    // должны сбрасываться на каждом !play). Новому боту раздаём случайно:
    // часть — лучники/маги, остальные — мечники.
    const savedHeld = sanitizeHeld(rec?.held);
    // Оружие строго по преобладающей характеристике: сила→меч, ловкость→лук,
    // интеллект→посох (ничья / нет перекоса → меч).
    const rc = botWeaponFor(p.str, p.agi, p.int);
    const hadGold =
      savedHeld.right?.cls === "sword" && savedHeld.right?.tier === "gold";
    p.rightCls = rc;
    // Золотой меч (найден на земле) остаётся только у мечевого билда; иначе
    // роняем его обратно на поляну — кто-нибудь подберёт.
    p.rightTier = hadGold && rc === "sword" ? "gold" : "base";
    if (hadGold && rc !== "sword") {
      this.sim.dropWeapon("sword", "gold", p.head.x, p.head.z);
    }
    // Лук занимает обе руки — без щита; меч/посох — со щитом.
    p.leftCls = rc === "bow" ? "" : "shield";
    p.leftTier = rc === "bow" ? "" : "base";
    // Зелья выдаём при каждом выходе в мир — подбирать их на земле бот
    // умеет (см. pickupLoot), но без стартового запаса первый бой может
    // не пережить.
    const bag = emptyBag();
    addToBag(bag, "potion", BOT.potions);
    writeBag(p, bag);
    p.skin =
      typeof rec?.skin === "number" && rec.skin >= 1 && rec.skin <= BOT.skins
        ? rec.skin
        : 1 + Math.floor(Math.random() * BOT.skins);
    this.state.players.set(id, p);

    const rt: Runtime = {
      token,
      guard: noGuard(),
      lastHit: {},
      sinceHurt: PLAYER_HP.regenDelay,
      respawnIn: 0,
      invuln: RESPAWN.invuln,
      lastPvpAt: -999,
      lastCast: -999,
      yaw: 0,
      owned: new Set(),
      stowed: [],
      overrides: {},
      kills: rec?.kills ?? 0,
      leaveBot: rec?.leaveBot === true, // ботом не читается — только у живого игрока
    };
    this.rt.set(id, rt);

    this.bots.set(norm, {
      nick: p.nick,
      norm,
      id,
      state: p,
      rt,
      target: null,
      lootTarget: null,
      followNorm: null,
      raiding: false,
      emoteAt: 0,
      emoteFreezeUntil: 0,
      attackCd: 0,
      wanderCd: 0,
      wanderX: sp.x,
      wanderZ: sp.z,
      yaw: 0,
      vx: 0,
      vz: 0,
      reskinAt: 0,
      drinkCd: 0,
      healCd: 0,
      healCastT: 0,
      cleaveCd: 0,
      cleaveCastT: 0,
      cleaveYaw: 0,
      rainCd: 0,
      rainCastT: 0,
      rainX: 0,
      rainZ: 0,
      sayAt: 0,
      statsAt: 0,
      swingIn: 0,
      swingTarget: null,
      swingDx: 0,
      swingDz: 1,
      hurtByMob: null,
      hurtByMobAt: 0,
      homeX: home.x,
      homeZ: home.z,
    });
    console.log(`[bot] + ${p.nick} ур.${p.level} — ботов ${this.bots.size}`);
  }

  private removeBot(norm: string): void {
    const bot = this.bots.get(norm);
    if (!bot) return;
    this.persistBot(bot);
    this.state.players.delete(bot.id);
    this.rt.delete(bot.id);
    this.bots.delete(norm);
    store.flush();
    console.log(`[bot] - ${bot.nick} — ботов ${this.bots.size}`);
    if (this.state.players.size === 0) this.wipeWorld("мир опустел");
  }

  private persistBot(bot: Bot): void {
    const p = bot.state;
    const edge = WORLD.size / 2 - 2;
    store.put(bot.rt.token ?? `nick:${bot.norm}`, {
      nick: p.nick,
      x: clampAbs(p.head.x, edge),
      y: p.head.y,
      z: clampAbs(p.head.z, edge),
      yaw: bot.rt.yaw,
      hp: p.hp,
      // Золотое оружие бот не "покупал" — нашёл на земле (lootTarget в tickBot),
      // но право распоряжаться им то же: если зритель зайдёт за этого героя
      // сам, он должен суметь и покидать его обратно (см. MSG.dropWeapon).
      owned: p.rightTier === "gold" ? [weaponKey(p.rightCls as WeaponClass, "gold")] : [],
      stowed: [],
      held: { left: heldIn(p, "left"), right: heldIn(p, "right") },
      overrides: {},
      skin: p.skin,
      ...readProgress(p),
      bag: [],
      kills: bot.rt.kills,
    });
  }

  /** ИИ одного бота на кадр. */
  private tickBot(dt: number, bot: Bot): void {
    const p = bot.state;
    if (p.dead) {
      bot.swingIn = 0; // умер на замахе — удара не будет
      bot.swingTarget = null;
      // bot.raiding НЕ снимаем: возродится на спавне и снова пойдёт на босса,
      // пока тот не убит или пока не напишут !raid ещё раз.
      return; // возрождение — общий tickPlayers
    }
    bot.attackCd = Math.max(0, bot.attackCd - dt);
    bot.drinkCd = Math.max(0, bot.drinkCd - dt);
    bot.healCd = Math.max(0, bot.healCd - dt);
    bot.cleaveCd = Math.max(0, bot.cleaveCd - dt);
    bot.rainCd = Math.max(0, bot.rainCd - dt);

    // Клинок долетел до цели — вот теперь урон (замах ушёл клиентам раньше).
    if (bot.swingIn > 0) {
      bot.swingIn -= dt;
      if (bot.swingIn <= 0) this.resolveBotHit(bot);
    }

    // Глоток — уже ПОСЛЕ добивания: добивание может дать уровень и полечить
    // (LEVEL_UP_HEAL), а зелёные крестики зелья не должны мелькать вместе с
    // оранжевыми уровня из-за того, что глоток посчитали по старому HP.
    this.botDrink(bot);
    this.botGroupHeal(bot, dt);
    this.botCleave(bot, dt);
    this.botArrowRain(bot, dt);

    // Зона бота — вокруг его дома (поляна у спавна или лагерь по уровню).
    const cx = bot.homeX;
    const cz = bot.homeZ;
    const inZone = (x: number, z: number): boolean =>
      Math.hypot(x - cx, z - cz) < BOT.zoneRadius;

    // Рейд (!raid): цель — босс, зона и обычные мобы побоку. Снимается, если
    // босс уже повержен или ещё не заспавнен.
    let raidBoss = bot.raiding ? this.bossMob() : undefined;
    if (raidBoss?.dead) raidBoss = undefined;
    if (bot.raiding && !raidBoss) bot.raiding = false;
    // Сам босс, пока рейд активен — держим отдельно от `raidBoss` (его ниже
    // могут обнулить, если бот отвлёкся на осколок): выталкивание из туши
    // должно работать всегда, а не только пока цель — босс.
    const raidBossMob = raidBoss;

    // Цель: моб (не босс/осколок) в зоне.
    let mob = bot.target ? this.sim.mobs.get(bot.target) : undefined;
    const okMob = (m: { dead: boolean; kind: string; x: number; z: number }): boolean =>
      !m.dead && m.kind !== "boss" && m.kind !== "shard" && inZone(m.x, m.z);
    if (!mob || !okMob(mob)) {
      bot.target = null;
      mob = undefined;
      // Сколько других ботов уже целятся в каждого моба — предпочитаем «своего».
      const claimed = new Map<string, number>();
      for (const other of this.bots.values()) {
        if (other === bot || !other.target) continue;
        claimed.set(other.target, (claimed.get(other.target) ?? 0) + 1);
      }
      let bd = Infinity;
      for (const m of this.sim.mobs.values()) {
        if (!okMob(m)) continue;
        const d =
          Math.hypot(m.x - p.head.x, m.z - p.head.z) +
          (claimed.get(m.id) ?? 0) * BOT.targetSpread;
        if (d < bd) {
          bd = d;
          mob = m;
        }
      }
      if (mob) bot.target = mob.id;
    }

    // Рейд, но по боту лупит обычный моб / осколок босса — сперва добиваем
    // его (в радиусе raidAddRange и уже агрнут), потом снова к боссу. Делаем
    // это, подменяя цель на моба и снимая raidBoss на текущий тик: всё
    // движение/удар ниже уже умеют драться с обычным мобом.
    if (raidBoss) {
      let addId: string | null = null;
      // 1) Кто недавно нанёс урон боту (плевун сзади и т.п.) — приоритет.
      //    Не по inZone (рейд идёт далеко от спавна), а по дистанции до бота:
      //    плевун стреляет из ~20 м, дальше него не гонимся.
      const hm = bot.hurtByMob ? this.sim.mobs.get(bot.hurtByMob) : undefined;
      if (
        hm &&
        !hm.dead &&
        hm.kind !== "boss" &&
        Date.now() - bot.hurtByMobAt < BOT.raidAddMemory * 1000 &&
        Math.hypot(hm.x - p.head.x, hm.z - p.head.z) < SPITTER.fireRange + 6
      ) {
        addId = bot.hurtByMob;
      }
      // 2) Иначе — ближайший агрнутый не-босс в радиусе (мельтешит у ног).
      if (!addId) {
        let addD: number = BOT.raidAddRange;
        for (const m of this.sim.mobs.values()) {
          if (m.dead || m.kind === "boss" || !m.aggro) continue;
          const d = Math.hypot(m.x - p.head.x, m.z - p.head.z);
          if (d < addD) {
            addD = d;
            addId = m.id;
          }
        }
      }
      if (addId) {
        mob = this.sim.mobs.get(addId);
        bot.target = addId;
        raidBoss = undefined;
      } else {
        bot.hurtByMob = null; // адов рядом нет — вернулись к боссу
      }
    }

    // Лут на земле — идём поднять раньше, чем добивать моба (моб подождёт).
    // Приоритет: золотое оружие СВОЕГО класса (разовый апгрейд) > бутылка зелья
    // (пока в сумке меньше BOT.potions+2 — не тащимся через полкарты за лишней).
    const wantGoldWeapon = p.rightTier !== "gold";
    const wantPotion = countPotions(p) < BOT.potions + 2;
    let loot = bot.lootTarget ? this.sim.drops.get(bot.lootTarget) : undefined;
    const okLoot = (d: typeof loot): boolean => {
      if (!d || !inZone(d.x, d.z)) return false;
      const w = ITEMS[d.item].weapon;
      if (w) return wantGoldWeapon && w.cls === p.rightCls && w.tier === "gold";
      return wantPotion && ITEMS[d.item].heal > 0;
    };
    if (!okLoot(loot)) {
      bot.lootTarget = null;
      loot = undefined;
      let bestScore = -Infinity;
      for (const d of this.sim.drops.values()) {
        if (!okLoot(d)) continue;
        const dd = Math.hypot(d.x - p.head.x, d.z - p.head.z);
        if (dd >= BOT.lootRadius) continue;
        // меч всегда важнее бутылки; при прочих равных — что ближе.
        const score = (ITEMS[d.item].weapon ? 1000 : 0) - dd;
        if (score > bestScore) {
          bestScore = score;
          loot = d;
        }
      }
      if (loot) bot.lootTarget = loot.id;
    }
    // Пока идём за мечом, моба не бьём — но и цель по мобу не бросаем:
    // okMob-выбор выше продолжает работать, просто движение приоритетнее.
    // В рейде цель одна — босс, всё остальное игнорируем.
    const chasingMob = raidBoss ?? (loot ? undefined : mob);

    // «!follow / !come»: бой всё равно важнее — догоняем только если мобов
    // рядом нет (иначе вместо честного боя бот бы просто стоял столбом
    // около зрителя). Ник ищем среди всех, живых и ботов — id у сессий
    // меняется при переподключении, а ник нет.
    let follow: { x: number; z: number } | undefined;
    if (!loot && !mob && bot.followNorm) {
      for (const [id, ps] of this.state.players) {
        if (id === bot.id) continue;
        if (normNick(ps.nick) === bot.followNorm) {
          follow = ps.head;
          break;
        }
      }
      if (follow && !inZone(follow.x, follow.z)) follow = undefined;
    }

    let tx: number;
    let tz: number;
    if (raidBoss) {
      tx = raidBoss.x;
      tz = raidBoss.z;
    } else if (loot) {
      tx = loot.x;
      tz = loot.z;
    } else if (mob) {
      tx = mob.x;
      tz = mob.z;
    } else if (follow) {
      tx = follow.x;
      tz = follow.z;
    } else {
      bot.wanderCd -= dt;
      if (bot.wanderCd <= 0) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * BOT.zoneRadius * 0.6;
        bot.wanderX = cx + Math.cos(a) * r;
        bot.wanderZ = cz + Math.sin(a) * r;
        bot.wanderCd = BOT.wanderInterval;
      }
      tx = bot.wanderX;
      tz = bot.wanderZ;
    }

    const dxRaw = tx - p.head.x;
    const dzRaw = tz - p.head.z;
    const dist = Math.hypot(dxRaw, dzRaw) || 1e-6;
    const dx = dxRaw / dist;
    const dz = dzRaw / dist;
    // Босс крупный (scale ~4.25): бить и останавливаться надо от его КРАЯ,
    // а не от центра — иначе бот лезет внутрь туши и мажет (см. resolveBotHit).
    // Радиус туши шире сферического хитбокса — BOSS.bodyMult (модель слизня).
    const bossR = (m: { scale: number }): number =>
      MOB.bodyRadius * m.scale * BOSS.bodyMult;
    const bossEdge = raidBoss ? bossR(raidBoss) : 0;
    const attackReach = bossEdge + BOT.attackRange;
    // Держимся от края туши босса: он крупный и сам скачет — иначе бот
    // оказывается внутри модели.
    const bossKeepOut = bossEdge + PLAYER.radius + 0.35;
    // Дальний бой: лучник/маг не подходит в упор — стоит на дистанции стрельбы
    // и отходит, если моб подобрался (как плевун).
    const ranged =
      (p.rightCls === "bow" || p.rightCls === "staff") && !loot && !!chasingMob;
    const rangedStop = bossEdge + BOT.shootKeepDist;
    const stopAt = raidBoss
      ? ranged
        ? rangedStop
        : bossKeepOut + 0.4
      : loot
        ? WEAPON_TAKE_REACH * 0.85
        : ranged && mob
          ? BOT.shootKeepDist
          : mob
            ? BOT.attackRange * 0.7
            : follow
              ? BOT.followRange
              : 0.5;

    // Расталкивание: без него боты, бегущие к одному мобу, слипаются в одну
    // точку. Складываем с движением к цели ДО сглаживания скорости — иначе
    // получается дрожь на месте.
    let sepX = 0;
    let sepZ = 0;
    for (const other of this.bots.values()) {
      if (other === bot || other.state.dead) continue;
      const ox = p.head.x - other.state.head.x;
      const oz = p.head.z - other.state.head.z;
      const d2 = ox * ox + oz * oz;
      if (d2 >= BOT.separation * BOT.separation) continue;
      const d = Math.sqrt(d2);
      if (d < 1e-3) {
        // Ровно друг в друге — расталкиваем по стабильному признаку (id).
        const a = bot.id < other.id ? 1 : -1;
        sepX += a;
        continue;
      }
      const push = (BOT.separation - d) / BOT.separation; // 0..1, у края мягко
      sepX += (ox / d) * push;
      sepZ += (oz / d) * push;
    }

    // Толпой суммарный толчок легко перевесит бег к цели — ограничиваем.
    const sepLen = Math.hypot(sepX, sepZ);
    if (sepLen > 1) {
      sepX /= sepLen;
      sepZ /= sepLen;
    }
    // Убираем составляющую ПРОТИВ хода: сосед впереди иначе тормозил бота,
    // тот отходил, толчок пропадал, он снова разгонялся — это и был рывок.
    // Обойти сбоку можно, пятиться на ровном месте — нет.
    const against = sepX * dx + sepZ * dz;
    if (against < 0) {
      sepX -= dx * against;
      sepZ -= dz * against;
    }

    // Плавно разгоняемся к желаемой скорости и тормозим у цели — без рывков
    // на смене цели и у путевых точек.
    // На замахе и на эмоции (!cheer, авто-кувырок, левелап) ноги на месте: иначе модель
    // «едет» посреди анимации. Расталкивание при этом работает — соседи
    // всё равно не должны стоять внутри.
    const emoting = Date.now() < bot.emoteFreezeUntil;
    // Скорость бега — от характеристик персонажа (как у живого игрока), чуть
    // медленнее ради читаемости на стриме.
    const botSpeed = moveSpeedFor(p.level, p.agi) * BOT.speedFactor;
    // Дальник отходит, если моб подобрался ближе shootKeepDist.
    const retreat = ranged && chasingMob && dist < BOT.shootKeepDist - 1;
    const wantSpeed =
      bot.swingIn > 0 || emoting
        ? 0
        : retreat
          ? -botSpeed * 0.75
          : dist > stopAt
            ? botSpeed * Math.min(1, (dist - stopAt) / 1.5)
            : 0;
    const wvx = dx * wantSpeed + sepX * BOT.separationForce;
    const wvz = dz * wantSpeed + sepZ * BOT.separationForce;
    const accel = Math.min(1, dt * 6);
    bot.vx += (wvx - bot.vx) * accel;
    bot.vz += (wvz - bot.vz) * accel;
    p.head.x += bot.vx * dt;
    p.head.z += bot.vz * dt;

    // Жёстко не даём стоять внутри туши босса (соседей расталкивает цикл
    // выше, а босса там нет — он моб). Работает всё время рейда, даже когда
    // бот отвлёкся на осколок и цель — не босс.
    if (raidBossMob && !raidBossMob.dead) {
      const keepOut = bossR(raidBossMob) + PLAYER.radius + 0.35;
      const bx = p.head.x - raidBossMob.x;
      const bz = p.head.z - raidBossMob.z;
      const bd = Math.hypot(bx, bz);
      if (bd > 1e-3 && bd < keepOut) {
        p.head.x = raidBossMob.x + (bx / bd) * keepOut;
        p.head.z = raidBossMob.z + (bz / bd) * keepOut;
        const inward = (bot.vx * bx + bot.vz * bz) / bd;
        if (inward < 0) {
          bot.vx -= (bx / bd) * inward;
          bot.vz -= (bz / bd) * inward;
        }
      }
    }

    p.head.y = terrainHeight(p.head.x, p.head.z) + PLAYER.eyeHeight;

    // Доворот модели — по фактической скорости (плавнее, чем к цели напрямую).
    const spd = Math.hypot(bot.vx, bot.vz);

    // Кувырок сам собой на бегу — редко, только если сейчас не бой; кулдаун
    // общий с !cheer, чтобы автотриггер и команда из чата не наложились.
    if (
      spd > botSpeed * 0.7 &&
      bot.swingIn <= 0 &&
      Date.now() - bot.emoteAt > BOT.emoteCooldown * 1000 &&
      Math.random() < BOT.rollChancePerSec * dt
    ) {
      this.triggerEmote(bot, "roll");
    }

    // Дальник, у которого цель в зоне выстрела, разворачивается на неё — даже
    // на бегу (отход от подобравшегося моба). Иначе он «стрелял спиной»:
    // корпус смотрел по ходу движения, а снаряд летел из затылка.
    const wantAim = ranged && !!chasingMob && !emoting && dist < BOT.shootRange;
    const aimYaw = Math.atan2(dx, dz);
    // Идём — смотрим по ходу; целимся (дальник) — на моба.
    const facingYaw = wantAim
      ? aimYaw
      : spd > 0.15
        ? Math.atan2(bot.vx, bot.vz)
        : ranged && chasingMob
          ? aimYaw
          : null;
    if (facingYaw !== null) {
      let d = facingYaw - bot.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const maxStep = BOT.turnRate * dt;
      bot.yaw += Math.abs(d) < maxStep ? d : Math.sign(d) * maxStep;
    }
    // Насколько корпус ещё не довёрнут на цель — по этому гейтим выстрел.
    let aimErr = Math.PI;
    if (wantAim) {
      let e = aimYaw - bot.yaw;
      while (e > Math.PI) e -= Math.PI * 2;
      while (e < -Math.PI) e += Math.PI * 2;
      aimErr = Math.abs(e);
    }
    bot.rt.yaw = bot.yaw;
    p.head.qx = 0;
    p.head.qy = Math.sin(bot.yaw / 2);
    p.head.qz = 0;
    p.head.qw = Math.cos(bot.yaw / 2);

    // Дальний бой: лучник/маг стреляет снарядом с дистанции (реальный Bolt в
    // симуляции — летит, бьёт, клиенты рисуют по kind).
    if (
      wantAim &&
      chasingMob &&
      // Пока корпус не довёрнут на цель — не стреляем (никаких выстрелов в спину).
      aimErr <= BOT.aimCone &&
      bot.attackCd <= 0 &&
      bot.swingIn <= 0
    ) {
      const atk = attackSpeedFor(p.level, p.agi);
      const bow = p.rightCls === "bow";
      bot.attackCd = (bow ? BOT.bowCooldown : BOT.staffCooldown) / atk;
      const tgt = chasingMob;
      const ox = p.head.x;
      const oy = p.head.y - 0.25;
      const oz = p.head.z;
      const aimY =
        terrainHeight(tgt.x, tgt.z) + MOB.bodyRadius * (tgt.scale ?? 1) - oy;
      const adx = tgt.x - ox;
      const adz = tgt.z - oz;
      // лёгкая компенсация проседания снаряда на дистанцию
      const ady = aimY + (bow ? 0.05 : 0.03) * Math.hypot(adx, adz);
      const mult = multIn(p, "right");
      if (bow) {
        this.sim.castBolt(
          ox, oy, oz, adx, ady, adz,
          BOT.arrowSpeed, 0.05, 0.2,
          weaponDamage("arrow", p.level, p.str, mult, p.agi),
          bot.id, 2.5, 1,
        );
      } else {
        const bd = fireboltDamage(p.level, p.int, 0.7);
        this.sim.castBolt(
          ox, oy, oz, adx, ady, adz,
          BOT.boltSpeed, fireboltRadius(0.7), fireboltHitRadius(0.7),
          bd,
          bot.id, MAGIC.firebolt.life, 0,
          fireboltSplashRadius(0.7), bd * MAGIC.firebolt.splashFraction,
        );
      }
      const relay: ActRelay = {
        k: bow ? "bow" : "swing",
        id: bot.id,
        x: p.head.x,
        y: p.head.y,
        z: p.head.z,
      };
      this.broadcast(MSG.act, relay);
    }

    // Замах. Урон не здесь: сначала клиенты получают анимацию, а клинок
    // касается моба через BOT.attackImpact — см. resolveBotHit(). За мечом
    // на земле идём молча — chasingMob пуст, пока loot не подобран.
    if (!ranged && chasingMob && !emoting && dist < attackReach && bot.attackCd <= 0 && bot.swingIn <= 0) {
      // Скорость атаки от уровня: чаще бьёт и быстрее доводит замах —
      // анимация на модельке ускоряется на клиенте под тот же множитель.
      const atk = attackSpeedFor(p.level, p.agi);
      bot.attackCd = BOT.attackCooldown / atk;
      bot.swingIn = BOT.attackImpact / atk;
      bot.swingTarget = chasingMob.id;
      bot.swingDx = dx;
      bot.swingDz = dz;
      // Замах видят все — анимация на модельке бота + звук.
      const relay: ActRelay = { k: "swing", id: bot.id, x: p.head.x, y: p.head.y, z: p.head.z };
      this.broadcast(MSG.act, relay);
    }

    // Дошли до лута — подбираем.
    if (loot) {
      const feetY = p.head.y - PLAYER.eyeHeight;
      const d3 = Math.hypot(loot.x - p.head.x, loot.y - feetY, loot.z - p.head.z);
      if (d3 <= WEAPON_TAKE_REACH) {
        let took = false;
        const lw = ITEMS[loot.item].weapon;
        if (lw) {
          // золотое оружие своего класса — вооружаемся
          this.sim.takeDrop(loot.id);
          p.rightCls = lw.cls;
          p.rightTier = lw.tier;
          p.leftCls = lw.cls === "bow" ? "" : "shield";
          p.leftTier = lw.cls === "bow" ? "" : "base";
          bot.rt.owned.add(weaponKey(lw.cls, lw.tier));
          this.persistBot(bot);
          console.log(`[bot] ${bot.nick} подобрал ${lw.cls}:${lw.tier}`);
          took = true;
        } else {
          // бутылка зелья — в сумку
          const bag = readBag(p);
          const left = addToBag(bag, loot.item, loot.count);
          if (loot.count - left > 0) {
            writeBag(p, bag);
            this.sim.takeDrop(loot.id);
            took = true;
          }
        }
        bot.lootTarget = null;
        if (took) {
          const relay: ActRelay = { k: "pickup", id: bot.id, x: p.head.x, y: p.head.y, z: p.head.z };
          this.broadcast(MSG.act, relay);
        }
      }
    }
  }

  /**
   * Бот сам лечится: просел по здоровью — пьёт зелье из своей сумки.
   * Повторяет обработчик MSG.useItem, которым лечится живой игрок, чтобы
   * правила были одни и те же.
   */
  private botDrink(bot: Bot): void {
    const p = bot.state;
    if (bot.drinkCd > 0 || p.hp >= p.maxHp * BOT.drinkAt) return;

    const bag = readBag(p);
    const slot = bag.findIndex((s) => s.item && ITEMS[s.item].heal > 0 && s.count > 0);
    if (slot < 0) return;
    const used = takeOne(bag, slot);
    if (!used) return;

    writeBag(p, bag);
    p.hp = Math.min(p.maxHp, p.hp + ITEMS[used].heal);
    bot.drinkCd = BOT.drinkCooldown;
    // Соседям — звук глотка, как у игрока.
    const relay: ActRelay = { k: "drink", id: bot.id, x: p.head.x, y: p.head.y, z: p.head.z };
    this.broadcast(MSG.act, relay);
  }

  /** Момент касания клинка: наносим урон, если моб ещё жив и достаём. */
  private resolveBotHit(bot: Bot): void {
    const id = bot.swingTarget;
    bot.swingTarget = null;
    bot.swingIn = 0;
    if (!id) return;
    const p = bot.state;
    const mob = this.sim.mobs.get(id);
    if (!mob || mob.dead) return; // добили, пока шёл замах — бьём воздух
    // Моб мог чуть отойти за время замаха — небольшой допуск, иначе боты
    // постоянно мажут по подвижным слизням. У босса ещё запас на радиус туши.
    const reach =
      BOT.attackRange * 1.4 +
      (mob.kind === "boss" ? MOB.bodyRadius * mob.scale * BOSS.bodyMult : 0);
    if (Math.hypot(mob.x - p.head.x, mob.z - p.head.z) > reach) return;
    // Множитель тира меча — как у живого игрока (multIn). Раньше стояла
    // единица: бот с золотым мечом бил как базовым, урон «за персонажа» у
    // игрока выходил выше при том же снаряжении.
    const dmg = weaponDamage("sword", p.level, p.str, multIn(p, "right"));
    const sx = mob.x;
    const sy = mob.y;
    const sz = mob.z;
    const killed = this.sim.hitMob(mob.id, dmg, bot.swingDx, bot.swingDz, bot.id);
    this.sim.splashDamage(
      sx, sy, sz,
      COMBAT.swordSplashRadius,
      dmg * COMBAT.swordSplashFraction,
      mob.id,
      bot.id,
    );
    // Опыт/kills — через общий делёж (sim.mobXpShare / mobKills).
    if (killed) {
      bot.target = null;
      // Бот активно фармит — не деспавним его по «тишине в чате».
      this.chatSeen.set(bot.norm, Date.now());
    }
  }

  /**
   * Бот с посохом — групповой лекарь. Если рядом несколько раненых союзников
   * (игроков или других ботов) — лечит всех разом вместо огнешара. Одного
   * раненого не трогает: это именно массовый хил.
   */
  private botGroupHeal(bot: Bot, dt: number): void {
    const p = bot.state;
    const h = MAGIC.heal;

    // Каст идёт — стоим и ждём; в конце выброс лечения.
    if (bot.healCastT > 0) {
      bot.healCastT = Math.max(0, bot.healCastT - dt);
      if (bot.healCastT > 0) return;
      this.botGroupHealLand(bot);
      return;
    }

    if (p.rightCls !== "staff" || bot.healCd > 0) return;
    if (p.mana < h.minMana) return;
    if (this.woundedNear(p).length < BOT.healMinTargets) return;
    if (Math.random() >= BOT.skillChancePerSec * dt) return;

    // Начало каста: мана списывается сразу, бот замирает, вокруг горит аура.
    const cost = Math.min(p.mana, BOT.healCharge * h.chargeTime * h.manaPerSec);
    p.mana = Math.max(0, p.mana - cost);
    bot.healCd = BOT.healCooldown;
    bot.healCastT = BOT.healCastTime;
    bot.emoteFreezeUntil = Date.now() + BOT.healCastTime * 1000;
    const aura: ActRelay = {
      k: "healAura",
      id: bot.id,
      x: p.head.x,
      y: p.head.y - PLAYER.eyeHeight,
      z: p.head.z,
    };
    this.broadcast(MSG.act, aura);
  }

  /**
   * Бот с мечом — «Рассекающий удар»: массовый скилл по конусу перед собой.
   * Замах (перед ботом горит красный сектор), потом урон всем внутри и
   * отбрасывание. Скилл редкий: кулдаун + шанс срабатывания.
   */
  private botCleave(bot: Bot, dt: number): void {
    const p = bot.state;

    if (bot.cleaveCastT > 0) {
      bot.cleaveCastT = Math.max(0, bot.cleaveCastT - dt);
      if (bot.cleaveCastT > 0) return;
      this.botCleaveLand(bot);
      return;
    }
    if (p.rightCls !== "sword" || bot.cleaveCd > 0) return;
    // Целимся туда, куда бот и так смотрит: сектор строится от его yaw.
    if (this.mobsInCone(p, bot.yaw).length < BOT.cleaveMinTargets) return;
    if (Math.random() >= BOT.skillChancePerSec * dt) return;

    bot.cleaveCd = BOT.cleaveCooldown;
    bot.cleaveCastT = BOT.cleaveCastTime;
    bot.cleaveYaw = bot.yaw;
    bot.emoteFreezeUntil = Date.now() + BOT.cleaveCastTime * 1000;
    const fx: ActRelay = {
      k: "cleave",
      id: bot.id,
      x: p.head.x,
      y: p.head.y - PLAYER.eyeHeight,
      z: p.head.z,
    };
    this.broadcast(MSG.act, fx);
  }

  /** Мобы в конусе перед точкой `p`, направление — `yaw`. */
  private mobsInCone(p: PlayerState, yaw: number): { id: string; x: number; z: number }[] {
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const cone = Math.cos(BOT.cleaveCone);
    const out: { id: string; x: number; z: number }[] = [];
    for (const m of this.sim.mobs.values()) {
      if (m.dead) continue;
      const dx = m.x - p.head.x;
      const dz = m.z - p.head.z;
      const d = Math.hypot(dx, dz);
      if (d > BOT.cleaveRange || d < 1e-3) continue;
      if ((dx / d) * fx + (dz / d) * fz < cone) continue;
      out.push({ id: m.id, x: m.x, z: m.z });
    }
    return out;
  }

  /** Замах дочитан — бьём и раскидываем всех, кто остался в секторе. */
  private botCleaveLand(bot: Bot): void {
    const p = bot.state;
    const dmg =
      weaponDamage("sword", p.level, p.str, multIn(p, "right")) * BOT.cleaveDamageMult;
    for (const t of this.mobsInCone(p, bot.cleaveYaw)) {
      const dx = t.x - p.head.x;
      const dz = t.z - p.head.z;
      const l = Math.hypot(dx, dz) || 1;
      this.sim.hitMob(t.id, dmg, dx / l, dz / l, bot.id);
      this.sim.shoveMob(t.id, dx / l, dz / l, BOT.cleaveKnockback);
    }
    this.chatSeen.set(bot.norm, Date.now());
  }

  /**
   * Бот с луком — «Град стрел»: намечает круг на земле там, где кучнее всего
   * мобов, и через замах туда падает залп. Мобы успевают разбежаться.
   */
  private botArrowRain(bot: Bot, dt: number): void {
    const p = bot.state;

    if (bot.rainCastT > 0) {
      bot.rainCastT = Math.max(0, bot.rainCastT - dt);
      if (bot.rainCastT > 0) return;
      this.botArrowRainLand(bot);
      return;
    }
    if (p.rightCls !== "bow" || bot.rainCd > 0) return;
    const spot = this.bestRainSpot(p);
    if (!spot) return;
    if (Math.random() >= BOT.skillChancePerSec * dt) return;

    bot.rainCd = BOT.rainCooldown;
    bot.rainCastT = BOT.rainCastTime;
    bot.rainX = spot.x;
    bot.rainZ = spot.z;
    bot.emoteFreezeUntil = Date.now() + BOT.rainCastTime * 1000;
    const fx: ActRelay = {
      k: "arrowRain",
      id: bot.id,
      x: spot.x,
      y: terrainHeight(spot.x, spot.z),
      z: spot.z,
    };
    this.broadcast(MSG.act, fx);
  }

  /** Самый «кучный» моб в радиусе залпа — вокруг него и наметим круг. */
  private bestRainSpot(p: PlayerState): { x: number; z: number } | null {
    let best: { x: number; z: number } | null = null;
    let bestN = 0;
    for (const m of this.sim.mobs.values()) {
      if (m.dead) continue;
      if (Math.hypot(m.x - p.head.x, m.z - p.head.z) > BOT.rainRange) continue;
      let n = 0;
      for (const o of this.sim.mobs.values()) {
        if (o.dead) continue;
        if (Math.hypot(o.x - m.x, o.z - m.z) <= BOT.rainRadius) n++;
      }
      if (n > bestN) {
        bestN = n;
        best = { x: m.x, z: m.z };
      }
    }
    return bestN >= BOT.rainMinTargets ? best : null;
  }

  /** Залп упал — урон всем, кто остался в круге. */
  private botArrowRainLand(bot: Bot): void {
    const p = bot.state;
    const dmg =
      weaponDamage("arrow", p.level, p.str, multIn(p, "right"), p.agi) * BOT.rainDamageMult;
    for (const m of [...this.sim.mobs.values()]) {
      if (m.dead) continue;
      const dx = m.x - bot.rainX;
      const dz = m.z - bot.rainZ;
      if (Math.hypot(dx, dz) > BOT.rainRadius) continue;
      const l = Math.hypot(dx, dz) || 1;
      this.sim.hitMob(m.id, dmg, dx / l, dz / l, bot.id);
    }
    this.chatSeen.set(bot.norm, Date.now());
  }

  /** Кто рядом с ботом ранен и достаётся массовым хилом. */
  private woundedNear(p: PlayerState): PlayerState[] {
    const out: PlayerState[] = [];
    this.state.players.forEach((ally) => {
      if (ally.dead || ally.maxHp <= 0) return;
      if (ally.hp >= ally.maxHp * BOT.healAt) return;
      const d = Math.hypot(ally.head.x - p.head.x, ally.head.z - p.head.z);
      if (d > BOT.healRadius) return;
      out.push(ally);
    });
    return out;
  }

  /** Каст дочитан — лечим всех раненых, кто к этому моменту рядом. */
  private botGroupHealLand(bot: Bot): void {
    const p = bot.state;
    const targets = this.woundedNear(p);
    const charge = BOT.healCharge;
    const amount = healAmountFor(p.level, p.int, charge) * BOT.healGroupFraction;
    for (const ally of targets) {
      const before = ally.hp;
      ally.hp = Math.min(ally.maxHp, ally.hp + amount);
      const healed = ally.hp - before;
      if (healed <= 0) continue;
      // Зелёные крестики над телом — тем же актом, что и глоток зелья.
      const relay: ActRelay = {
        k: "drink",
        id: this.idOf(ally) ?? bot.id,
        x: ally.head.x,
        y: ally.head.y,
        z: ally.head.z,
      };
      this.broadcast(MSG.act, relay);
      // Лечение союзника в бою с боссом — вклад в общий опыт.
      this.sim.bossHeal(bot.id, healed);
    }
    this.chatSeen.set(bot.norm, Date.now());
  }

  private tickBots(dt: number): void {
    // Наплыв игроков (`!play`): +2 слизня на бота, убираются когда толпа
    // расходится. Дёшево — sim ничего не делает, если число не изменилось.
    this.sim.setExtraSlimes(this.bots.size * 2);
    if (this.bots.size === 0) return;
    const nowMs = Date.now();
    // Пока идёт стрим (подключён спектатор) — держим ботов дольше: зрители
    // ради них и заходят, а деспавн по 30-минутной тишине их зря снимал.
    const idleLimit = BOT.idleDespawnSec * 1000 * (this.spectators.size > 0 ? 5 : 1);
    for (const bot of [...this.bots.values()]) {
      if (
        !STREAM_NICKS.includes(bot.norm) &&
        nowMs - (this.chatSeen.get(bot.norm) ?? 0) > idleLimit
      ) {
        this.removeBot(bot.norm);
        continue;
      }
      this.tickBot(dt, bot);
    }
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
      for (const bot of this.bots.values()) this.persistBot(bot);
      world.save(this.sim.saveDrops());
      this.broadcastLeaderboard();
    }

    this.tickBots(dt);

    // Мана восстанавливается всегда (от интеллекта).
    this.state.players.forEach((p) => {
      if (p.mana < p.maxMana) {
        p.mana = Math.min(p.maxMana, p.mana + manaRegenFor(p.int) * dt);
      }
    });

    // Мобы гоняются только за живыми и только за теми, кто ВНЕ безопасной зоны
    // лагеря (HUB). Внутри HUB игрок для ИИ мобов не существует — ни агро, ни
    // погони, ни ударов. Проверка серверная: клиент себя безопасным не объявит.
    const players: SimPlayer[] = [];
    this.state.players.forEach((p, id) => {
      if (p.dead || inHubSafeZone(p.head.x, p.head.z)) return;
      players.push({ sessionId: id, x: p.head.x, y: p.head.y, z: p.head.z });
    });

    const hits = this.sim.tick(dt, players);

    // sim -> схема. Осколки босса появляются/исчезают — заводим схему на лету.
    for (const m of this.sim.mobs.values()) {
      let s = this.state.mobs.get(m.id);
      if (!s) {
        s = new MobState();
        s.kind = m.kind;
        s.scale = m.scale;
        s.model = m.model;
        s.mobName = m.eliteName;
        s.mobLevel = m.eliteLevel;
        this.state.mobs.set(m.id, s);
      }
      s.x = m.x;
      s.y = m.y;
      s.z = m.z;
      s.yaw = m.yaw;
      s.hp = Math.max(0, m.hp);
      s.maxHp = m.maxHp;
      s.dead = m.dead ? 1 : 0;
      s.grounded = m.grounded ? 1 : 0;
      s.hurtSeq = m.hurtSeq;
      s.attackSeq = m.attackSeq;
      s.hurtDx = m.hurtDx;
      s.hurtDz = m.hurtDz;
      if (m.kind === "boss") {
        s.windup = m.slamTelegraph;
        s.slamSeq = m.slamSeq;
        s.enraged = m.enraged ? 1 : 0;
        s.charging = m.charging ? 1 : 0;
      }
    }
    this.state.mobs.forEach((_s, id) => {
      if (!this.sim.mobs.has(id)) this.state.mobs.delete(id);
    });
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
        s.boss = b.boss ? 1 : 0;
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
    // Огненные снаряды игроков.
    for (const bo of this.sim.bolts.values()) {
      let s = this.state.bolts.get(bo.id);
      if (!s) {
        s = new BoltState();
        s.r = bo.radius;
        s.kind = bo.kind;
        this.state.bolts.set(bo.id, s);
      }
      s.x = bo.x;
      s.y = bo.y;
      s.z = bo.z;
      s.vx = bo.vx;
      s.vy = bo.vy;
      s.vz = bo.vz;
    }
    this.state.bolts.forEach((_s, id) => {
      if (!this.sim.bolts.has(id)) this.state.bolts.delete(id);
    });
    // Опыт за любых мобов — поделён между всеми, кто нанёс урон (sim.mobXpShare).
    // Режем «не больше уровня за раз».
    for (const k of this.sim.mobXpShare) {
      const kp = this.state.players.get(k.owner);
      if (!kp) continue;
      const lvlCap = xpToNext(kp.level);
      const xp = Number.isFinite(lvlCap) ? Math.min(k.xp, lvlCap) : k.xp;
      this.awardXp(this.clientOf(k.owner), kp, xp);
      if (k.owner.startsWith("bot:")) this.chatSeen.set(k.owner.slice(4), Date.now());
    }
    this.sim.mobXpShare.length = 0;
    // Добивания: счётчик kills добившему + кил-фид (кроме осколков и босса —
    // босса объявляем отдельно, по крупнейшему вкладу).
    for (const k of this.sim.mobKills) {
      const krt = this.rt.get(k.owner);
      if (krt) krt.kills++;
      if (k.kind === "shard" || k.kind === "boss") continue;
      const kp = this.state.players.get(k.owner);
      if (!kp) continue;
      const victim = k.name || (k.kind === "spitter" ? "Плевун" : "Слизень");
      this.broadcast(MSG.killFeed, { by: kp.nick, victim });
    }
    this.sim.mobKills.length = 0;
    // Опыт с босса — гибридный делёж (поровну + за вклад, с потолком) считает
    // ZoneSim. Здесь только раздаём и режем «не больше уровня за один бой».
    if (this.sim.bossXpShare.length) {
      let topOwner = "";
      let topXp = -1;
      for (const k of this.sim.bossXpShare) {
        const kp = this.state.players.get(k.owner);
        if (kp) {
          const lvlCap = xpToNext(kp.level); // Infinity на максимальном уровне
          const xp = Number.isFinite(lvlCap) ? Math.min(k.xp, lvlCap) : k.xp;
          this.awardXp(this.clientOf(k.owner), kp, xp);
          if (k.owner.startsWith("bot:")) this.chatSeen.set(k.owner.slice(4), Date.now());
          if (xp > topXp) {
            topXp = xp;
            topOwner = kp.nick;
          }
        }
      }
      if (topOwner) this.broadcast(MSG.killFeed, { by: topOwner, victim: "Багровый" });
      this.broadcast(MSG.bossEvent, { kind: "down", by: topOwner });
      this.bossFighting = false;
      this.sim.bossXpShare.length = 0;
    }

    // Босс вступил в бой — баннер «БОСС ПОЯВИЛСЯ» (не чаще раза в минуту).
    {
      const boss = this.bossMob();
      const active = !!boss && !boss.dead && boss.aggro;
      if (active && !this.bossFighting && Date.now() - this.bossAnnouncedAt > 60_000) {
        this.bossFighting = true;
        this.bossAnnouncedAt = Date.now();
        this.broadcast(MSG.bossEvent, { kind: "spawn" });
      } else if (!active && this.bossFighting) {
        this.bossFighting = false;
      }
    }
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
        const client = this.clientOf(id);
        client?.send(MSG.picked, { item: d.item, count: taken });
        // Соседям (и боту тоже — у него просто нет client, кому исключать) —
        // анимация подбора на модельке.
        const relay: ActRelay = { k: "pickup", id, x: p.head.x, y: p.head.y, z: p.head.z };
        this.broadcast(MSG.act, relay, client ? { except: client } : undefined);
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

    // Щит блокирует «по взгляду» у всех, кто не целится им физически: боты
    // вообще не шлют guard, а на телефоне (третье лицо) щит висит на руке рига
    // и его нормаль случайна. В VR оставляем как есть — там щитом реально
    // подставляются, и подмена на взгляд обесценила бы блок.
    let guard = rt.guard;
    const holdsShield = p.leftCls === "shield" || p.rightCls === "shield";
    if (holdsShield && p.mode !== "vr") {
      const yaw = 2 * Math.atan2(p.head.qy, p.head.qw);
      guard = { sx: Math.sin(yaw), sz: Math.cos(yaw), wx: guard.wx, wz: guard.wz };
    }

    const block = resolveBlock(guard, ax, az, h.projectile);
    const dmg = h.dmg * block.mult;
    rt.sinceHurt = 0;
    if (dmg > 0) p.hp = Math.max(0, p.hp - dmg);

    // Бота ударил моб — запоминаем, чтобы в рейде он переключился и добил его
    // (плевун бьёт издалека сзади и в raidAddRange не попадает).
    if (h.byMob && h.target.startsWith("bot:")) {
      const b = this.bots.get(h.target.slice(4));
      if (b) {
        b.hurtByMob = h.byMob;
        b.hurtByMobAt = Date.now();
      }
    }

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
      this.broadcast(MSG.killFeed, { by: h.byName ?? "", victim: p.nick });
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
    // Боты возрождаются у своего дома (по уровню — может быть у лагеря);
    // живые игроки — в безопасном лагере (HUB), а не в поле среди мобов.
    const bot = id.startsWith("bot:") ? this.bots.get(id.slice(4)) : undefined;
    let sp: { x: number; z: number };
    if (bot) {
      const home = botHome(p.level); // уровень мог вырасти — пересчитываем
      bot.homeX = home.x;
      bot.homeZ = home.z;
      sp = botSpawnAt(home);
    } else {
      sp = hubSpawnPoint();
    }
    const x = sp.x;
    const z = sp.z;
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

  /** Спектаторы стрима — sessionId. В `state.players` их нет. */
  private readonly spectators = new Set<string>();

  override onJoin(client: Client, options?: JoinOpts): void {
    // Невидимый спектатор (этап 17): без PlayerState, без rt, без сейва.
    // Состояние комнаты Colyseus синхронизирует ему сам.
    if (options?.spectator !== undefined) {
      if (options.spectator !== SPEC_KEY) {
        throw new Error("спектатор: неверный ключ");
      }
      this.spectators.add(client.sessionId);
      console.log(`[zone] + спектатор ${client.sessionId} — эфирных ${this.spectators.size}`);
      // Начальная синхронизация настроек пульта. Слать сразу из onJoin нельзя:
      // клиент ещё не навесил room.onMessage(specCmd) (это происходит после
      // того, как joinOrCreate у него зарезолвится), и colyseus.js такие
      // сообщения молча роняет — спектатор открывался с недогруженным пультом.
      // Небольшая задержка + повтор гарантируют доставку.
      const pushInit = (): void => {
        if (!this.spectators.has(client.sessionId)) return;
        client.send(MSG.leaderboard, this.leaderboard(5));
        if (Object.keys(this.overlayCfg).length) {
          client.send(MSG.specCmd, { t: "overlay", patch: this.overlayCfg } satisfies SpecCmd);
        }
        client.send(MSG.specCmd, { t: "specVoice", on: this.state.specVoice } satisfies SpecCmd);
        client.send(MSG.specCmd, { t: "auto", on: this.pultAuto ? 1 : 0 } satisfies SpecCmd);
        client.send(MSG.specCmd, { t: "bots", on: this.pultBotsOnly ? 1 : 0 } satisfies SpecCmd);
      };
      this.clock.setTimeout(pushInit, 400);
      this.clock.setTimeout(pushInit, 1500);
      return;
    }

    let token = options?.token?.trim();

    // Вход по нику (Ф10): забрать своего бота / персонажа зрителя.
    if (options?.stream) {
      const norm = normNick(options?.nick ?? "");
      if (!norm || !this.allowedNick(norm)) {
        throw new Error("ник не допущен — напиши !play в чате канала");
      }
      if (this.nickIsPlayed(norm)) {
        throw new Error("этим персонажем уже играют");
      }
      token = `nick:${norm}`;
      this.removeBot(norm); // если был бот — его прогресс уходит в store под этим токеном
    } else {
      // Обычный вход (не по ссылке ?stream=1): ник — и есть личность, без
      // allowedNick(). Раньше это была одна из проверок под !play, но здесь
      // цель другая — просто не плодить второй, никак не связанный аккаунт
      // на один и тот же ник, если завтра тем же ником придут из чата
      // (или наоборот: ник давно в чате, а сегодня впервые зашли с сайта).
      // Занят прямо сейчас (nickIsPlayed) — не отбираем, просто гостевой
      // токен, как раньше; это не про доступ, а про столкновение сессий.
      const norm = normNick(options?.nick ?? "");
      // "гость" — не ник, а то, что подставляет клиент, когда поле пустое
      // (см. Login.ts). Ловить под этим именем чужой прогресс — не то же
      // самое, что «тот же ник — тот же человек»: тут никакого ника и нет.
      if (norm && norm !== "гость" && !this.nickIsPlayed(norm)) {
        token = `nick:${norm}`;
        this.removeBot(norm);
      }
    }

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
    } else {
      // Новичок без сейва — в лагерь (иначе первые кадры торчит в (0,0,0)
      // посреди поляны, пока клиент не пришлёт свою позицию).
      const sp = hubSpawnPoint();
      p.head.x = sp.x;
      p.head.z = sp.z;
      p.head.y = terrainHeight(sp.x, sp.z) + PLAYER.eyeHeight;
    }
    // Модель персонажа (панель C, плоский режим). Если заходят за бота —
    // rec.skin уже стоит от него, модель не меняется. Новому токену без
    // сейва даём случайную, а не заглушку по умолчанию: обычные игроки
    // тоже должны выглядеть персонажем сразу, без похода в панель.
    p.skin =
      rec?.skin && rec.skin >= 1 && rec.skin <= BOT.skins
        ? rec.skin
        : 1 + Math.floor(Math.random() * BOT.skins);
    p.maxHp = maxHpFor(p.level, p.str);
    p.maxMana = maxManaFor(p.level, p.int);
    p.mana = p.maxMana;
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
      lastPvpAt: -999,
      lastCast: -999,
      yaw: rec?.yaw ?? 0,
      owned: new Set(Array.isArray(rec?.owned) ? rec.owned : []),
      stowed: sanitizeStowed(rec?.stowed),
      overrides: sanitizeOverrides(rec?.overrides),
      kills: rec?.kills ?? 0,
      leaveBot: rec?.leaveBot === true,
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
            leaveBot: rec.leaveBot === true,
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
      kills: rt.kills,
      // Даже если модель не меняли ни разу: случайная, выданная при входе
      // без сейва, должна закрепиться за ником, а не выпадать заново.
      skin: p.skin,
    };
    store.put(rt.token, patch);
  }

  override async onLeave(client: Client, consented?: boolean): Promise<void> {
    if (this.spectators.delete(client.sessionId)) {
      console.log(`[zone] - спектатор ${client.sessionId} — эфирных ${this.spectators.size}`);
      // Ни одного спектатора не осталось — метка камеры стрима больше не
      // актуальна (мог уйти как раз рендерящий, а не только пульт).
      if (this.spectators.size === 0) this.state.specActive = 0;
      return;
    }
    const rt = this.rt.get(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    const streamNorm = rt?.token?.startsWith("nick:") ? rt.token.slice(5) : null;

    // Обрыв связи (не осознанный выход) — держим место 20 с. Клиент сам
    // переподключается тем же токеном (NetClient.reconnectLoop), и тогда
    // персонаж не мигает в бота и обратно на каждом сетевом чихе.
    this.persist(client); // на случай падения сервера в это окно
    if (!consented && p) {
      try {
        await this.allowReconnection(client, 20);
        console.log(`[zone] ~ ${client.sessionId} вернулся`);
        return;
      } catch {
        console.log(`[zone] ${client.sessionId} не вернулся за 20 с`);
      }
    }

    this.state.players.delete(client.sessionId);
    this.rt.delete(client.sessionId);
    store.flush();

    // Стрим-игрок вышел — персонаж продолжает жить ботом, только если сам
    // это включил (панель C, по умолчанию — нет) и ник всё ещё допущен.
    if (
      streamNorm &&
      p &&
      rt?.leaveBot &&
      this.allowedNick(streamNorm) &&
      this.bots.size < BOT.maxBots
    ) {
      this.spawnBot(p.nick, streamNorm);
    }

    console.log(`[zone] - ${client.sessionId} — осталось игроков ${this.state.players.size}`);
    // Ни одного игрока (спектаторы не в счёт) — подчищаем лежащий лут.
    if (this.state.players.size === 0) this.wipeWorld("мир опустел");
  }

  /** Убрать весь лут с земли (мир опустел или команда админа). */
  private wipeWorld(reason: string): void {
    const n = this.sim.clearDrops();
    this.state.drops.clear();
    world.save([]);
    console.log(`[zone] очистка мира (${reason}) — убрано предметов: ${n}`);
  }

  /** Сервер останавливается (деплой) — сохраняем всех до расселения комнаты. */
  override onBeforeShutdown(): void {
    for (const client of this.clients) this.persist(client);
    for (const bot of this.bots.values()) this.persistBot(bot);
    store.flush();
    const drops = this.sim.saveDrops();
    world.save(drops);
    console.log(`[zone] стоп: игроков ${this.clients.length}, лута на земле ${drops.length}`);
    this.disconnect();
  }

  override onDispose(): void {
    this.twitch?.stop();
    console.log(`[zone] комната ${this.roomId} закрыта`);
  }
}
