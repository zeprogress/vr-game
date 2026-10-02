#!/usr/bin/env -S npx tsx
/**
 * Лаборатория баланса — НАСТОЯЩИЙ серверный код (ZoneRoom + ZoneSim + ИИ
 * ботов) без сети и без записи сейвов: бот с заданным билдом (уровень,
 * атрибуты, оружие и роллы, умения) бьётся в ускоренном времени, а мы
 * считаем снятое HP, лечение, смерти и умения. В отличие от npm run balance
 * (формулы-модель), здесь всё — как на сервере: кулдауны, ИИ бота, броня
 * и уворот мобов, «окно неуязвимости» моба после удара и т.п.
 *
 *   npm run lab:balance                      — всё (≈ несколько минут)
 *   npm run lab:balance -- --quick           — короче бои, меньше вариантов
 *   npm run lab:balance -- --only dps,camp   — выбрать опыты: dps, skills, attrs, affix, tier, group, camp, def, nav
 *   npm run lab:balance -- --lvl 33          — уровень героя для DPS-опытов (по умолчанию 33)
 *   npm run lab:balance -- --json out.json   — сырые результаты в файл
 *   npm run lab:balance -- --whatif nohurtcd — «что если» без окна 0.2 с у моба после удара
 *   npm run lab:balance -- --trace кинжал    — состояние бота раз в секунду (отладка опыта)
 *   npm run lab:balance -- --seed 7          — другое зерно случайности (прогоны повторяемы при том же зерне)
 *
 * Опыты:
 *  dps    — каждый набор оружия, раскладка класса по умолчанию: DPS по Пугалу (240 с);
 *  skills — все пары умений класса;
 *  attrs  — «всё в один атрибут» (6 вариантов) против раскладки класса;
 *  affix  — по одному ролла на максимуме (Урон, Скорость, Крит, Вампиризм);
 *  tier   — обычное / золотое / уникальное без роллов;
 *  group  — 1/3/6 героев бьют одну цель (теряются ли удары);
 *  camp   — бой в лагере мобов своего уровня (3 мин): убийства, смерти, урон по герою, лечение;
 *  def    — защита в бою: роллы щита, Эгида, вампиризм, «всё в ТЕЛ/УДЧ/МДР» против физ. и маг. мобов;
 *  nav    — боты из случайных точек карты идут к Пугалу: сколько застряло у склонов.
 * В конце — список аномалий (что выбивается из ряда).
 */
process.env.STAGING = "1"; // без чата Twitch и восстановления ботов из сейва

// ---- детерминированный Math.random: прогоны повторяемы
const seedArg = process.argv.indexOf("--seed");
let seed = seedArg > 0 ? Number(process.argv[seedArg + 1]) : 20261002;
Math.random = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ---- своё время: сервер живёт по Date.now() — крутим его сами
const realNow = Date.now.bind(Date);
let simNow = realNow();
Date.now = () => simNow;

// ---- ни одной записи на диск
const { PlayerStore } = await import("../src/server/PlayerStore.ts");
(PlayerStore.prototype as unknown as { flush: () => void }).flush = () => {};
const { WorldStore } = await import("../src/server/WorldStore.ts");
(WorldStore.prototype as unknown as { writeFile: () => void }).writeFile = () => {};
const { ChatLog } = await import("../src/server/ChatLog.ts");
(ChatLog.prototype as unknown as { append: () => void }).append = () => {};
const { serverPerf } = await import("../src/server/perf.ts");
(serverPerf as unknown as { start: () => void }).start = () => {};
const { store } = await import("../src/server/store.ts");

const { ZoneRoom } = await import("../src/server/rooms/ZoneRoom.ts");
const { ELITE_MOBS, BOT, SCARECROW, PLAYER } = await import("../src/shared/constants.ts");
const { terrainHeight } = await import("../src/shared/terrain.ts");
const { HUB } = await import("../src/shared/hub.ts");
const { equipHands } = await import("../src/shared/hands.ts");
const { affixRange, emptyBag, AEGIS_NAME } = await import("../src/shared/items.ts");
const AEGIS = AEGIS_NAME;
const C2 = await import("../src/shared/classes2.ts");
const { maxHpFor } = await import("../src/shared/progression.ts");
type ClassId = import("../src/shared/classes2.ts").ClassId;
type SkillId = import("../src/shared/classes2.ts").SkillId;
type Attr = import("../src/shared/classes2.ts").Attr;
type WeaponInstance = import("../src/shared/items.ts").WeaponInstance;
type AffixSub = import("../src/shared/items.ts").AffixSub;
type WeaponTier = import("../src/shared/items.ts").WeaponTier;

// ---------------------------------------------------------------- параметры

const argv = process.argv.slice(2);
const arg = (k: string): string | undefined => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const QUICK = argv.includes("--quick");
const LVL = Number(arg("--lvl") ?? 33);
const ONLY = new Set((arg("--only") ?? "dps,skills,attrs,affix,tier,group,camp,def,nav").split(","));
const JSON_OUT = arg("--json");
/**
 * --whatif nohurtcd — «что если»: у моба нет окна 0.2 с после удара, в которое
 * чужие удары/сплэш/умения пропадают (Mob.hurtCd). Код игры не меняется.
 */
const WHATIF = new Set((arg("--whatif") ?? "").split(",").filter(Boolean));
/** --trace <ключ опыта> (напр. «кинжал») — печатать состояние бота раз в секунду. */
const TRACE = arg("--trace");
/** Бой по Пугалу: долго — чтобы криты (шанс) не давали шума в сравнении роллов и атрибутов. */
const DPS_SEC = QUICK ? 40 : 240;
const CAMP_SEC = QUICK ? 90 : 180;
const TICK_MS = 50;

// Логи сервера — в счётчик, не на экран (их тысячи).
const serverLog: string[] = [];
const realLog = console.log;
const realWarn = console.warn;
const say = (...a: unknown[]): void => realLog(...a);
console.log = (...a: unknown[]) => void serverLog.push(a.join(" "));
console.warn = (...a: unknown[]) => void serverLog.push("WARN " + a.join(" "));

// ---------------------------------------------------------------- наборы оружия

interface Loadout {
  id: string;
  R: string;
  L?: string;
}
const LOADOUTS: Loadout[] = [
  { id: "меч+щит", R: "sword", L: "shield" },
  { id: "меч×2", R: "sword", L: "sword" },
  { id: "меч", R: "sword" },
  { id: "кинжал", R: "dagger" },
  { id: "кинжал×2", R: "dagger", L: "dagger" },
  { id: "кинжал+щит", R: "dagger", L: "shield" },
  { id: "лук", R: "bow" },
  { id: "посох", R: "staff" },
  { id: "посох+щит", R: "staff", L: "shield" },
  { id: "копьё", R: "spear" },
  { id: "молот", R: "hammer" },
];

interface Build {
  lvl: number;
  load: Loadout;
  tier?: WeaponTier;
  /** Роллы основного оружия (и второго такого же — те же). */
  affix?: { sub: AffixSub; t?: number }[];
  /** Роллы щита. */
  shieldAffix?: { sub: AffixSub; t?: number }[];
  aegis?: boolean;
  attrs?: Record<Attr, number>;
  skills?: [SkillId, SkillId];
}

function classOf(load: Loadout): ClassId {
  const h = { rightCls: "", rightTier: "", leftCls: "", leftTier: "" };
  equipHands(h, load.R, "gold");
  if (load.L) equipHands(h, load.L, "gold", "left");
  return C2.classOf2(h.leftCls as never, h.rightCls as never) ?? "warrior";
}

/** Всё в один атрибут (по цене очков, как в игре); остаток — в ТЕЛ, если влезет. */
function pureBuild(stat: Attr, lvl: number): Record<Attr, number> {
  const a = C2.blankAttrs();
  let left = C2.pointsAt(lvl);
  while (C2.stepCost(a[stat]) <= left) {
    left -= C2.stepCost(a[stat]);
    a[stat]++;
  }
  return a;
}

let uid = 0;
function inst(cls: string, tier: WeaponTier, affix: { sub: AffixSub; t?: number }[] = [], aegis = false): WeaponInstance {
  return {
    id: `lab${++uid}`,
    cls: cls as WeaponInstance["cls"],
    tier,
    affixes: affix.map((a) => {
      const [lo, hi] = affixRange(a.sub, { cls: cls as WeaponInstance["cls"], nm: aegis ? AEGIS : undefined });
      const kind = a.sub === "dmgFlat" ? "dmg" : a.sub === "atkSpeedPct" ? "atkSpeed" : a.sub === "critChance" ? "crit" : a.sub;
      return { kind: kind as never, sub: a.sub, value: lo + (a.t ?? 1) * (hi - lo) };
    }),
    lv: 7,
    ...(aegis ? { nm: AEGIS } : {}),
    ...(cls === "staff" ? { sv: 1 } : {}),
  };
}

// ---------------------------------------------------------------- комната

/* eslint-disable @typescript-eslint/no-explicit-any */
type Room = any;

interface Meter {
  dealt: Map<string, number>;
  hits: Map<string, number>;
  lost: Map<string, number>;
  miss: Map<string, number>;
  maxHit: Map<string, number>;
  firstHit: Map<string, number>;
  casts: Map<string, Map<string, number>>;
  /** Победы: убийство (штатный учёт сервера — mobKills), осколок голема, раскол голема. */
  kills: Map<string, number>;
  /** Урон мобов по герою: «сырой» (до защиты) и сколько HP реально ушло. */
  rawIn: Map<string, number>;
  realIn: Map<string, number>;
}

function makeRoom(keep: (m: any) => boolean): { room: Room; step: () => void; meter: Meter; t: () => number } {
  simNow = realNow();
  const room: Room = new (ZoneRoom as any)();
  let tick: ((ms: number) => void) | null = null;
  room.setSimulationInterval = (cb: (ms: number) => void) => void (tick = cb);
  room.setPatchRate(0);
  room.broadcast = () => {};
  room.clock.now = () => simNow;
  room.clock.start();
  room.onCreate();
  room.autoDispose = false;
  room.eventPhaseAt = Number.POSITIVE_INFINITY; // без нашествий и охот
  // Лишних мобов — прочь: быстрее и чище опыт.
  for (const [id, m] of [...room.sim.mobs]) {
    if (keep(m)) continue;
    room.sim.mobs.delete(id);
    room.state.mobs.delete(id);
  }
  const meter: Meter = {
    dealt: new Map(), hits: new Map(), lost: new Map(), miss: new Map(), maxHit: new Map(), firstHit: new Map(), casts: new Map(), kills: new Map(), rawIn: new Map(), realIn: new Map(),
  };
  const hurt = room.hurtPlayer.bind(room);
  room.hurtPlayer = (h: { target: string; dmg: number; dot?: boolean }) => {
    const p = room.state.players.get(h.target);
    const before = p ? p.hp : 0;
    const alive = p && !p.dead && (room.rt.get(h.target)?.invuln ?? 0) <= 0;
    hurt(h);
    if (p && alive) {
      add(meter.rawIn, h.target, h.dmg);
      add(meter.realIn, h.target, Math.max(0, before - p.hp));
    }
  };
  const kills = room.sim.mobKills as { owner: string; champ: boolean }[];
  const push = kills.push.bind(kills);
  kills.push = (...items: { owner: string; champ: boolean }[]) => {
    for (const it of items) add(meter.kills, it.owner, 1);
    return push(...items);
  };
  // Голем не умирает, а раскалывается — раскол засчитываем как победу над ним (единственный боец в опыте лагеря).
  const splitGolem = room.sim.splitGolem.bind(room.sim);
  let lastAttacker = "";
  room.sim.splitGolem = (m: unknown) => {
    if (lastAttacker) add(meter.kills, lastAttacker, 1);
    return splitGolem(m);
  };
  const add = (mp: Map<string, number>, k: string, v: number): void => void mp.set(k, (mp.get(k) ?? 0) + v);
  // Снятое HP по каждому бойцу: до и после hitMob (броня, уворот, «окно» после удара — всё внутри).
  const hitMob = room.sim.hitMob.bind(room.sim);
  room.sim.hitMob = (id: string, dmg: number, dx: number, dz: number, attacker = "", rangedHit = false, dot = false, magic = false, crit = false) => {
    const m = room.sim.mobs.get(id);
    const before = m ? m.hp : 0;
    lastAttacker = attacker;
    if (WHATIF.has("nohurtcd") && m) m.hurtCd = 0;
    const cd = m ? m.hurtCd : 0;
    const misses = room.sim.mobMisses.length;
    const r = hitMob(id, dmg, dx, dz, attacker, rangedHit, dot, magic, crit);
    if (r === "shard" && attacker) add(meter.kills, attacker, 1); // осколки в mobKills не попадают
    if (m && attacker) {
      const dealt = Math.max(0, before - m.hp + (m.scarecrow && m.hp > before ? m.maxHp : 0));
      add(meter.dealt, attacker, dealt);
      if (!dot) add(meter.hits, attacker, 1);
      if (!dot && cd > 0 && dmg > 0) add(meter.lost, attacker, 1);
      if (room.sim.mobMisses.length > misses) add(meter.miss, attacker, 1);
      if (dealt > 0) {
        meter.maxHit.set(attacker, Math.max(meter.maxHit.get(attacker) ?? 0, dealt));
        if (!meter.firstHit.has(attacker)) meter.firstHit.set(attacker, room.elapsed);
      }
    }
    return r;
  };
  const castSkill = room.castSkill.bind(room);
  room.castSkill = (kind: string, ownerId: string, ...rest: unknown[]) => {
    const ok = castSkill(kind, ownerId, ...rest);
    if (ok) {
      const c = meter.casts.get(ownerId) ?? new Map<string, number>();
      c.set(kind, (c.get(kind) ?? 0) + 1);
      meter.casts.set(ownerId, c);
    }
    return ok;
  };
  // Старые ботовые умения идут мимо castSkill (оглушение воина, град стрел лучника) — считаем момент удара.
  for (const [fn, kind] of [["botStunBashLand", "stunBash"], ["botArrowRainLand", "arrowRain"]] as const) {
    const orig = room[fn].bind(room);
    room[fn] = (bot: { id: string }) => {
      const c = meter.casts.get(bot.id) ?? new Map<string, number>();
      c.set(kind, (c.get(kind) ?? 0) + 1);
      meter.casts.set(bot.id, c);
      return orig(bot);
    };
  }
  return {
    room,
    meter,
    t: () => room.elapsed,
    step: () => {
      simNow += TICK_MS;
      room.clock.tick();
      tick!(TICK_MS);
    },
  };
}

/** Бот с билдом `b` — через обычный spawnBot (сейв в памяти), затем руки/роллы ровно как заданы. */
function addBot(room: Room, name: string, b: Build, campPref?: string): { id: string; norm: string; bot: any } {
  const norm = name.toLowerCase();
  const cls = classOf(b.load);
  const tier = b.tier ?? "gold";
  const attrs = b.attrs ?? C2.autoBuild(cls, b.lvl);
  const h = { rightCls: "", rightTier: "", leftCls: "", leftTier: "" };
  equipHands(h, b.load.R, tier);
  if (b.load.L) equipHands(h, b.load.L, b.load.L === "shield" ? "gold" : tier, "left");
  const wR = inst(h.rightCls, tier, b.affix);
  const wL = h.leftCls
    ? h.leftCls === "shield"
      ? inst("shield", b.aegis ? "legendary" : "gold", b.shieldAffix, b.aegis)
      : inst(h.leftCls, tier, b.affix)
    : null;
  if (wL?.cls === "shield") h.leftTier = wL.tier;
  const skills = b.skills ?? C2.CLASSES2[cls].defaultSkills;
  store.put(`nick:${norm}`, {
    nick: name,
    level: b.lvl,
    xp: 0,
    unspent: 0,
    ...attrs,
    manualAttrs: true,
    weapons: [wR, ...(wL ? [wL] : [])],
    equippedWeaponId: { right: wR.id, left: wL?.id ?? null },
    held: { right: { cls: h.rightCls, tier: h.rightTier }, left: h.leftCls ? { cls: h.leftCls, tier: h.leftTier } : null },
    botClass: h.rightCls,
    skills: { [cls]: [...skills] },
    campPref: campPref ?? undefined,
    botActive: true,
    lastChatAt: simNow,
  } as never);
  room.spawnBot(name, norm);
  room.chatSeen?.set?.(norm, simNow);
  const bot = room.bots.get(norm);
  const p = bot.state;
  // Руки и склад — ровно как в билде (spawnBot выбирает сам по сейву).
  Object.assign(p, h);
  bot.rt.weapons = [wR, ...(wL ? [wL] : [])];
  bot.rt.equippedWeaponId = { right: wR.id, left: wL?.id ?? null };
  p.maxHp = maxHpFor(p.level, p);
  p.hp = p.maxHp;
  // Без зелий — меряем сам билд.
  const bag = emptyBag();
  for (let i = 0; i < p.bag.length; i++) {
    p.bag[i].item = bag[i]?.item ?? "";
    p.bag[i].count = 0;
  }
  return { id: bot.id, norm, bot };
}

// ---------------------------------------------------------------- опыты

/** Поставить героя в точку (телепорт, без проверки пути). */
function put(p: any, x: number, z: number): void {
  p.head.x = x;
  p.head.z = z;
  p.head.y = terrainHeight(x, z) + PLAYER.eyeHeight;
}

interface DpsResult {
  key: string;
  cls: ClassId;
  load: string;
  dps: number;
  maxHit: number;
  hitsPerSec: number;
  lostPct: number;
  missPct: number;
  casts: Record<string, number>;
  handsOk: boolean;
}

/** DPS по Пугалу: бот подходит вплотную и бьёт DPS_SEC секунд (замер — от первого удара). */
function dpsRun(key: string, b: Build, nBots = 1): DpsResult {
  const { room, step, meter, t } = makeRoom((m) => !!m.scarecrow);
  const sc = HUB.training.scarecrow;
  const bots = Array.from({ length: nBots }, (_, i) => addBot(room, `lab${i}`, b));
  for (const [i, x] of bots.entries()) {
    const a = (i / nBots) * Math.PI * 2;
    put(x.bot.state, sc.x + Math.cos(a) * 3, sc.z + Math.sin(a) * 3);
    x.bot.testUntil = simNow + 3600_000;
  }
  const want = { rightCls: bots[0].bot.state.rightCls, leftCls: bots[0].bot.state.leftCls };
  const end = DPS_SEC + 8;
  let nextTrace = 0;
  while (t() < end) {
    step();
    if (TRACE && key === TRACE && t() >= nextTrace) {
      nextTrace = t() + 1;
      const bt = bots[0].bot;
      const p = bt.state;
      const scd = room.sim.mobs.get(room.sim.scarecrowId);
      say(
        `  t=${f(t(), 1)} pos=(${f(p.head.x, 1)},${f(p.head.z, 1)}) до пугала ${f(Math.hypot(p.head.x - scd.x, p.head.z - scd.z), 1)} м` +
          ` цель=${bt.target ?? "—"} замах=${bt.swingTarget ?? "—"} кд=${f(bt.attackCd, 2)} руки=${p.rightCls}/${p.leftCls || "—"}` +
          ` hp=${f(p.hp)} снято=${f(meter.dealt.get(bt.id) ?? 0)} умения=${p.skill1}/${p.skill2}`,
      );
    }
  }
  let dealt = 0;
  let hits = 0;
  let lost = 0;
  let miss = 0;
  let maxHit = 0;
  const casts: Record<string, number> = {};
  for (const x of bots) {
    dealt += meter.dealt.get(x.id) ?? 0;
    hits += meter.hits.get(x.id) ?? 0;
    lost += meter.lost.get(x.id) ?? 0;
    miss += meter.miss.get(x.id) ?? 0;
    maxHit = Math.max(maxHit, meter.maxHit.get(x.id) ?? 0);
    for (const [k, v] of meter.casts.get(x.id) ?? []) casts[k] = (casts[k] ?? 0) + v;
  }
  const first = Math.min(...bots.map((x) => meter.firstHit.get(x.id) ?? end));
  const dur = Math.max(1, end - first);
  const p = bots[0].bot.state;
  const handsOk = p.rightCls === want.rightCls && p.leftCls === want.leftCls;
  return {
    key, cls: classOf(b.load), load: b.load.id,
    dps: dealt / dur, maxHit, hitsPerSec: hits / dur, lostPct: hits ? lost / hits : 0, missPct: hits ? miss / hits : 0, casts, handsOk,
  };
}

interface CampResult {
  key: string;
  load: string;
  camp: string;
  kills: number;
  deaths: number;
  firstDeath: number;
  dmgTaken: number;
  healed: number;
  dealt: number;
  hp: number;
  casts: Record<string, number>;
  /** Доля урона мобов, срезанная защитой (броня, маг. защита, блок, уворот, роллы щита…). */
  mitig: number;
}

/** Бой в лагере мобов: CAMP_SEC секунд, бот сам выбирает цели; без зелий. */
function campRun(key: string, b: Build, campType: string): CampResult {
  const { room, step, meter, t } = makeRoom((m) => m.campType === campType);
  const camp = room.sim.mobs.size;
  void camp;
  const x = addBot(room, "lab0", b, campType);
  const home = { x: x.bot.homeX, z: x.bot.homeZ };
  put(x.bot.state, home.x + 18, home.z);
  const p = x.bot.state;
  let deaths = 0;
  let firstDeath = Number.POSITIVE_INFINITY;
  let taken = 0;
  let healed = 0;
  let prevHp = p.hp;
  let wasDead = false;
  while (t() < CAMP_SEC) {
    step();
    if (p.dead && !wasDead) {
      deaths++;
      if (!Number.isFinite(firstDeath)) firstDeath = t();
    }
    if (!p.dead && !wasDead) {
      if (p.hp < prevHp) taken += prevHp - p.hp;
      else healed += p.hp - prevHp;
    }
    wasDead = p.dead;
    prevHp = p.hp;
  }
  const kills = meter.kills.get(x.id) ?? 0;
  return {
    key, load: b.load.id, camp: campType, kills, deaths, firstDeath, dmgTaken: taken, healed,
    dealt: meter.dealt.get(x.id) ?? 0, hp: p.maxHp, casts: Object.fromEntries(meter.casts.get(x.id) ?? []),
    mitig: 1 - (meter.realIn.get(x.id) ?? 0) / Math.max(1, meter.rawIn.get(x.id) ?? 0),
  };
}

// ---------------------------------------------------------------- вывод

const f = (n: number, d = 0): string => (Number.isFinite(n) ? n.toFixed(d) : "—");
const pct = (n: number): string => `${Math.round(n * 100)}%`;
const pad = (s: string, n: number): string => (s.length >= n ? s : s + " ".repeat(n - s.length));
const lp = (s: string, n: number): string => (s.length >= n ? s : " ".repeat(n - s.length) + s);
const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const castStr = (c: Record<string, number>, cls?: ClassId): string =>
  Object.entries(c).map(([k, v]) => `${cls ? C2.skillName(k as SkillId, cls) : C2.SKILLS2[k as SkillId]?.name ?? k}×${v}`).join(", ") || "—";

const anomalies: string[] = [];
const results: Record<string, unknown[]> = {};
const t0 = realNow();
const ATTRS = C2.ATTRS as readonly Attr[];
const AN = (a: Attr): string => C2.ATTR_INFO[a].short;

say(`\n=== ЛАБОРАТОРИЯ БАЛАНСА · настоящий серверный код · герой ${LVL} ур. · Пугало ${DPS_SEC} с, лагерь ${CAMP_SEC} с${WHATIF.size ? ` · ЧТО ЕСЛИ: ${[...WHATIF].join(", ")}` : ""} ===`);

// 1. DPS по наборам оружия (раскладка и умения класса по умолчанию)
const baseDps = new Map<string, DpsResult>();
if (ONLY.has("dps") || ONLY.has("attrs") || ONLY.has("affix") || ONLY.has("tier")) {
  say(`\n── 1. DPS по Пугалу: набор оружия, золото без роллов, раскладка класса ──`);
  say(pad("набор", 13) + pad("класс", 14) + ["DPS", "макс", "удар/с", "потеря", "промах"].map((h) => lp(h, 8)).join("") + "  умения");
  const rows: DpsResult[] = [];
  for (const load of LOADOUTS) {
    const r = dpsRun(load.id, { lvl: LVL, load });
    rows.push(r);
    baseDps.set(load.id, r);
    say(
      pad(load.id, 13) + pad(C2.CLASSES2[r.cls].name, 14) +
        [f(r.dps), f(r.maxHit), f(r.hitsPerSec, 2), pct(r.lostPct), pct(r.missPct)].map((v) => lp(v, 8)).join("") +
        "  " + castStr(r.casts, r.cls) + (r.handsOk ? "" : "  ⚠ руки поменялись"),
    );
    if (!r.handsOk) anomalies.push(`${load.id}: бот сменил оружие в руках во время боя`);
    if (r.lostPct > 0.1) anomalies.push(`${load.id}: ${pct(r.lostPct)} ударов по цели теряются («окно» моба 0.2 с после удара)`);
  }
  const med = median(rows.map((r) => r.dps));
  for (const r of rows) {
    if (r.dps > med * 1.6) anomalies.push(`${r.load}: DPS ${f(r.dps)} — в ${f(r.dps / med, 1)} раза выше медианы наборов (${f(med)})`);
    if (r.dps < med * 0.5) anomalies.push(`${r.load}: DPS ${f(r.dps)} — всего ${pct(r.dps / med)} от медианы наборов (${f(med)})`);
  }
  results.dps = rows;
}

// 2. Пары умений
if (ONLY.has("skills")) {
  say(`\n── 2. Пары умений класса: DPS по Пугалу и сколько раз бот применил умение ──`);
  const rows: (DpsResult & { pair: string })[] = [];
  const seen = new Set<ClassId>();
  for (const load of LOADOUTS) {
    const cls = classOf(load);
    if (seen.has(cls)) continue;
    seen.add(cls);
    const pool = C2.CLASSES2[cls].skills as SkillId[];
    say(`  ${C2.CLASSES2[cls].name} (${load.id}):`);
    const used = new Map<string, number>();
    for (let i = 0; i < pool.length; i++)
      for (let j = i + 1; j < pool.length; j++) {
        const pair: [SkillId, SkillId] = [pool[i], pool[j]];
        const r = dpsRun(`${load.id}:${pair.join("+")}`, { lvl: LVL, load, skills: pair });
        const name = pair.map((k) => C2.skillName(k, cls)).join(" + ");
        rows.push({ ...r, pair: name });
        for (const k of pair) used.set(k, (used.get(k) ?? 0) + (r.casts[k] ?? 0));
        say(`    ${pad(name, 42)} DPS ${lp(f(r.dps), 6)}   ${castStr(r.casts, cls)}`);
      }
    void used; // по одной цели часть умений (баффы, лечение, АОЕ) и не нужна — проверка «применяет ли» — в бою (7б)
  }
  results.skills = rows;
}

// 3. Атрибуты: всё в один
if (ONLY.has("attrs")) {
  say(`\n── 3. Всё в один атрибут (DPS по Пугалу; в скобках — к раскладке класса) ──`);
  say(pad("набор", 13) + lp("класс", 8) + ATTRS.map((a) => lp(AN(a), 12)).join(""));
  const rows: Record<string, unknown>[] = [];
  for (const load of LOADOUTS) {
    const base = baseDps.get(load.id) ?? dpsRun(load.id, { lvl: LVL, load });
    let line = pad(load.id, 13) + lp(f(base.dps), 8);
    const vals: Record<string, number> = {};
    for (const a of ATTRS) {
      const r = dpsRun(`${load.id}:all-${a}`, { lvl: LVL, load, attrs: pureBuild(a, LVL) });
      vals[a] = r.dps;
      line += lp(`${f(r.dps)} (${pct(r.dps / base.dps)})`, 12);
    }
    say(line);
    rows.push({ load: load.id, base: base.dps, ...vals });
    const best = ATTRS.reduce((x, y) => (vals[x] > vals[y] ? x : y));
    if (vals[best] > base.dps * 1.5) anomalies.push(`${load.id}: всё в ${AN(best)} даёт ${pct(vals[best] / base.dps)} DPS раскладки класса — раскладка класса или атрибут перекошены`);
  }
  results.attrs = rows;
}

// 4. Роллы
if (ONLY.has("affix")) {
  say(`\n── 4. Один ролл на максимуме (прирост DPS к золоту без роллов) ──`);
  const subs: AffixSub[] = ["dmgFlat", "atkSpeedPct", "critChance", "vamp"];
  say(pad("набор", 13) + lp("без", 8) + subs.map((s) => lp(s === "dmgFlat" ? "Урон" : s === "atkSpeedPct" ? "Скорость" : s === "critChance" ? "Крит" : "Вамп(HP/с)", 12)).join(""));
  const rows: Record<string, unknown>[] = [];
  for (const load of LOADOUTS) {
    const base = baseDps.get(load.id) ?? dpsRun(load.id, { lvl: LVL, load });
    let line = pad(load.id, 13) + lp(f(base.dps), 8);
    const vals: Record<string, number> = {};
    for (const s of subs) {
      if (s === "vamp" && !["sword", "dagger", "spear", "hammer"].includes(load.R)) {
        line += lp("—", 12);
        continue;
      }
      const r = dpsRun(`${load.id}:${s}`, { lvl: LVL, load, affix: [{ sub: s }] });
      vals[s] = r.dps;
      line += lp(s === "vamp" ? `${f(r.dps)}` : `+${pct(r.dps / base.dps - 1)}`, 12);
      const gain = r.dps / base.dps - 1;
      const [, hi] = affixRange(s, { cls: load.R as WeaponInstance["cls"] });
      if (s === "dmgFlat" && (gain < hi * 0.5 || gain > hi * 2)) anomalies.push(`${load.id}: ролл Урон +${pct(hi)} дал ${pct(gain)} DPS`);
      if (s === "atkSpeedPct" && gain < hi * 0.4) anomalies.push(`${load.id}: ролл Скорость атаки +${pct(hi)} дал всего ${pct(gain)} DPS`);
      if (s === "critChance" && gain < 0.05) anomalies.push(`${load.id}: ролл Крит +${pct(hi)} почти не влияет на DPS (${pct(gain)})`);
    }
    say(line);
    rows.push({ load: load.id, base: base.dps, ...vals });
  }
  results.affix = rows;
}

// 5. Тир
if (ONLY.has("tier")) {
  say(`\n── 5. Тир оружия без роллов (DPS по Пугалу) ──`);
  const rows: Record<string, unknown>[] = [];
  for (const load of LOADOUTS) {
    const v: Record<string, number> = {};
    for (const tier of ["base", "gold", "legendary"] as WeaponTier[]) v[tier] = dpsRun(`${load.id}:${tier}`, { lvl: LVL, load, tier }).dps;
    say(`${pad(load.id, 13)} обычное ${lp(f(v.base), 6)} · золото ${lp(f(v.gold), 6)} (${pct(v.gold / v.base)}) · уникальное ${lp(f(v.legendary), 6)} (${pct(v.legendary / v.base)})`);
    if (v.gold <= v.base * 1.02 || v.legendary <= v.gold * 1.02) anomalies.push(`${load.id}: тир оружия почти не меняет DPS (${f(v.base)} / ${f(v.gold)} / ${f(v.legendary)})`);
    rows.push({ load: load.id, ...v });
  }
  results.tier = rows;
}

// 6. Группа на одну цель
if (ONLY.has("group")) {
  say(`\n── 6. Несколько героев бьют одну цель: суммарный DPS ──`);
  const rows: Record<string, unknown>[] = [];
  for (const id of ["меч+щит", "кинжал×2", "копьё", "молот", "лук"]) {
    const load = LOADOUTS.find((l) => l.id === id)!;
    const one = dpsRun(`${id}:g1`, { lvl: LVL, load }, 1);
    const three = dpsRun(`${id}:g3`, { lvl: LVL, load }, 3);
    const six = dpsRun(`${id}:g6`, { lvl: LVL, load }, 6);
    say(`${pad(id, 13)} 1 герой ${lp(f(one.dps), 6)} · 3 героя ${lp(f(three.dps), 6)} (×${f(three.dps / one.dps, 1)}, потеряно ${pct(three.lostPct)}) · 6 героев ${lp(f(six.dps), 6)} (×${f(six.dps / one.dps, 1)}, потеряно ${pct(six.lostPct)})`);
    if (six.dps < one.dps * 4.5) anomalies.push(`${id}: 6 героев по одной цели наносят лишь ×${f(six.dps / one.dps, 1)} урона одного — ${pct(six.lostPct)} ударов теряются`);
    rows.push({ load: id, one: one.dps, three: three.dps, six: six.dps, lost3: three.lostPct, lost6: six.lostPct });
  }
  results.group = rows;
}

// 7. Бой в лагере
if (ONLY.has("camp")) {
  const camps: { lvl: number; type: string }[] = QUICK
    ? [{ lvl: 33, type: "boneWraith" }, { lvl: 40, type: "rockBreaker" }]
    : [
        { lvl: 26, type: "golem" },
        { lvl: 33, type: "boneWraith" },
        { lvl: 33, type: "mushColossus" },
        { lvl: 36, type: "infernoDemon" },
        { lvl: 40, type: "spearThrower" },
        { lvl: 40, type: "spikeTail" },
        { lvl: 40, type: "rockBreaker" },
      ];
  const rows: CampResult[] = [];
  for (const c of camps) {
    const def = ELITE_MOBS[c.type];
    say(`\n── 7. Лагерь «${def.name}» (${def.level} ур.), герой ${c.lvl} ур., ${CAMP_SEC} с без зелий ──`);
    say(pad("набор", 13) + ["HP", "убил", "смертей", "1-я смерть", "срезано", "урон/с по нему", "лечение/с", "его DPS"].map((h) => lp(h, 11)).join("") + "  умения");
    const cr: CampResult[] = [];
    for (const load of LOADOUTS) {
      const r = campRun(`${load.id}@${c.type}`, { lvl: c.lvl, load }, c.type);
      cr.push(r);
      say(
        pad(load.id, 13) +
          [f(r.hp), String(r.kills), String(r.deaths), Number.isFinite(r.firstDeath) ? `${f(r.firstDeath)} с` : "—", pct(r.mitig), f(r.dmgTaken / CAMP_SEC, 1), f(r.healed / CAMP_SEC, 1), f(r.dealt / CAMP_SEC)]
            .map((v) => lp(v, 11)).join("") + "  " + castStr(r.casts, classOf(load)),
      );
    }
    const medK = median(cr.map((r) => r.kills));
    for (const r of cr) {
      if (r.kills === 0) anomalies.push(`${r.load} в лагере «${def.name}»: за ${CAMP_SEC} с ни одного убийства`);
      else if (medK > 0 && r.kills >= medK * 2.5) anomalies.push(`${r.load} в лагере «${def.name}»: ${r.kills} убийств — в ${f(r.kills / medK, 1)} раза больше медианы (${medK})`);
      if (r.deaths >= 3) anomalies.push(`${r.load} в лагере «${def.name}»: ${r.deaths} смертей за ${CAMP_SEC} с`);
    }
    if (cr.every((r) => r.deaths === 0)) anomalies.push(`Лагерь «${def.name}» (${def.level} ур.): ни один набор героя ${c.lvl} ур. не умер за ${CAMP_SEC} с — возможно, мобы слабые`);
    if (cr.filter((r) => r.deaths > 0).length >= cr.length * 0.7) anomalies.push(`Лагерь «${def.name}» (${def.level} ур.): умирают почти все наборы героя ${c.lvl} ур.`);
    rows.push(...cr);
  }
  results.camp = rows;
}

// 7б. Умения в настоящем бою: каждое умение класса хотя бы в одной паре — применяет ли его бот
if (ONLY.has("skills")) {
  say(`\n── 7б. Умения в бою (лагерь «Костяной призрак», герой 33 ур., ${CAMP_SEC} с): сколько раз бот применил ──`);
  const seen = new Set<ClassId>();
  for (const load of LOADOUTS) {
    const cls = classOf(load);
    if (seen.has(cls)) continue;
    seen.add(cls);
    const pool = C2.CLASSES2[cls].skills as SkillId[];
    for (const pair of [[pool[0], pool[1]], [pool[2], pool[3]]] as [SkillId, SkillId][]) {
      const r = campRun(`${load.id}:${pair.join("+")}@camp`, { lvl: 33, load, skills: pair }, "boneWraith");
      say(`  ${pad(C2.CLASSES2[cls].name, 15)} ${pad(pair.map((k) => C2.skillName(k, cls)).join(" + "), 40)} ${castStr(r.casts, cls)}`);
      for (const k of pair) if (!r.casts[k]) anomalies.push(`${C2.CLASSES2[cls].name}: в бою (${CAMP_SEC} с) бот ни разу не применил «${C2.skillName(k, cls)}»`);
    }
  }
}

// 8. Защита: роллы щита/вампиризм и защитные атрибуты — в настоящем бою (физ. и маг. мобы)
if (ONLY.has("def")) {
  const camps = [
    { lvl: 33, type: "boneWraith" }, // магия вблизи
    { lvl: 40, type: "rockBreaker" }, // физика вблизи
  ];
  type V = { name: string; b: Omit<Build, "lvl"> };
  const sw = LOADOUTS.find((l) => l.id === "меч+щит")!;
  const st = LOADOUTS.find((l) => l.id === "посох+щит")!;
  const sp = LOADOUTS.find((l) => l.id === "копьё")!;
  const variants: V[] = [
    { name: "меч+щит без роллов", b: { load: sw } },
    { name: "  щит: Блок 20%", b: { load: sw, shieldAffix: [{ sub: "block" }] } },
    { name: "  щит: Физ. защита 20%", b: { load: sw, shieldAffix: [{ sub: "physDef" }] } },
    { name: "  щит: Маг. защита 20%", b: { load: sw, shieldAffix: [{ sub: "magDef" }] } },
    { name: "  щит: Регенерация 1%/с", b: { load: sw, shieldAffix: [{ sub: "regen" }] } },
    { name: "  Эгида: Блок+Отраж.+Физ.", b: { load: sw, aegis: true, shieldAffix: [{ sub: "block" }, { sub: "reflect" }, { sub: "physDef" }] } },
    { name: "  меч: Вампиризм 10%", b: { load: sw, affix: [{ sub: "vamp" }] } },
    { name: "посох+щит без роллов", b: { load: st } },
    { name: "  щит: Маг. защита 20%", b: { load: st, shieldAffix: [{ sub: "magDef" }] } },
    { name: "копьё без роллов", b: { load: sp } },
    { name: "  копьё: Вампиризм 10%", b: { load: sp, affix: [{ sub: "vamp" }] } },
  ];
  const rows: (CampResult & { variant: string; attrs?: string })[] = [];
  for (const c of camps) {
    const def = ELITE_MOBS[c.type];
    say(`\n── 8. Защита в лагере «${def.name}» (${def.level} ур.${def.magicMelee ? ", бьёт магией" : ", бьёт физикой"}), герой ${c.lvl} ур., ${CAMP_SEC} с ──`);
    say(pad("вариант", 30) + ["HP", "убил", "смертей", "срезано", "урон/с по нему", "лечение/с"].map((h) => lp(h, 11)).join(""));
    const show = (name: string, r: CampResult): void =>
      say(pad(name, 30) + [f(r.hp), String(r.kills), String(r.deaths), pct(r.mitig), f(r.dmgTaken / CAMP_SEC, 1), f(r.healed / CAMP_SEC, 1)].map((v) => lp(v, 11)).join(""));
    let base: CampResult | null = null;
    for (const v of variants) {
      const r = campRun(`${v.name}@${c.type}`, { lvl: c.lvl, ...v.b }, c.type);
      if (v.name.endsWith("без роллов")) base = r;
      show(v.name, r);
      rows.push({ ...r, variant: v.name });
      // Физ. защита — только против физики, Маг. защита — только против магии.
      const fits = /Блок|Эгида/.test(v.name) || (/Физ/.test(v.name) && !def.magicMelee) || (/Маг/.test(v.name) && !!def.magicMelee);
      if (base && r !== base && fits && r.mitig < base.mitig + 0.05) {
        anomalies.push(`«${v.name.trim()}» в лагере «${def.name}»: защита срезает ${pct(r.mitig)} урона — почти как без ролла (${pct(base.mitig)})`);
      }
    }
    // Защитные атрибуты: всё в ТЕЛ / УДЧ / МДР против раскладки класса (меч+щит).
    for (const a of ["con", "luc", "wis"] as Attr[]) {
      const r = campRun(`all-${a}@${c.type}`, { lvl: c.lvl, load: sw, attrs: pureBuild(a, c.lvl) }, c.type);
      show(`меч+щит, всё в ${AN(a)}`, r);
      rows.push({ ...r, variant: `меч+щит всё в ${AN(a)}`, attrs: a });
    }
  }
  results.def = rows;
}

// 9. Навигация: боты из случайных точек карты идут к Пугалу — сколько дошло (застревание у склонов)
if (ONLY.has("nav")) {
  const N = QUICK ? 24 : 60;
  const LIMIT = 150;
  say(`\n── 9. Навигация: ${N} ботов из случайных точек карты идут к Пугалу (до ${LIMIT} с) ──`);
  const { findPath } = await import("../src/server/sim/nav.ts");
  const { WORLD } = await import("../src/shared/constants.ts");
  const sc = HUB.training.scarecrow;
  // Известные места застревания (край столовой горы у лагеря Костяных вождей) + случайные точки.
  const starts: [number, number][] = [[52.9, 59.6]];
  const { canClimb } = await import("../src/shared/terrain.ts");
  // Половина стартов — у подножия крутых склонов (там и застревают), половина — где угодно.
  const nearSlope = (x: number, z: number): boolean => {
    for (let a = 0; a < 8; a++) {
      const dx = Math.cos((a / 8) * Math.PI * 2);
      const dz = Math.sin((a / 8) * Math.PI * 2);
      if (!canClimb(x + dx * 2, z + dz * 2, dx, dz)) return true;
    }
    return false;
  };
  while (starts.length < N) {
    const x = (Math.random() * 2 - 1) * (WORLD.playHalf - 6);
    const z = (Math.random() * 2 - 1) * (WORLD.playHalf - 6);
    if (starts.length < N / 2 && !nearSlope(x, z)) continue;
    const path = findPath(x, z, sc.x, sc.z, 200000);
    const end = path?.[path.length - 1];
    if (!path || !end || Math.hypot(end[0] - sc.x, end[1] - sc.z) > 1) continue; // в недостижимые места не ставим
    starts.push([x, z]);
  }
  const { room, step, t } = makeRoom((m) => !!m.scarecrow);
  const bots = starts.map((st, i) => {
    const x = addBot(room, `nav${i}`, { lvl: 33, load: LOADOUTS[i % LOADOUTS.length] });
    put(x.bot.state, st[0], st[1]);
    x.bot.testUntil = simNow + 3600_000;
    return { ...x, st, at: Number.POSITIVE_INFINITY };
  });
  let nextTrace = 0;
  while (t() < LIMIT && bots.some((b) => !Number.isFinite(b.at))) {
    step();
    if (TRACE === "nav" && t() >= nextTrace && !Number.isFinite(bots[0].at)) {
      nextTrace = t() + 0.5;
      const bt = bots[0].bot;
      const p = bt.state;
      say(`  t=${f(t(), 1)} (${f(p.head.x, 2)},${f(p.head.z, 2)}) v=(${f(bt.vx, 2)},${f(bt.vz, 2)}) путь=${JSON.stringify(bt.nav?.path?.slice(0, 3) ?? null)} всего ${bt.nav?.path?.length ?? 0} цель=${bt.target}`);
    }
    for (const b of bots) {
      const p = b.bot.state;
      // 12 м: вокруг Пугала толпа — вплотную всем не встать.
      if (!Number.isFinite(b.at) && Math.hypot(p.head.x - sc.x, p.head.z - sc.z) < 12) b.at = t();
    }
  }
  const stuck = bots.filter((b) => !Number.isFinite(b.at));
  const times = bots.filter((b) => Number.isFinite(b.at)).map((b) => b.at);
  say(`  дошли ${bots.length - stuck.length} из ${bots.length} · время в пути: медиана ${f(median(times))} с, худшее ${f(Math.max(0, ...times))} с`);
  for (const b of stuck) {
    const p = b.bot.state;
    say(`  ✗ застрял: старт (${f(b.st[0])}, ${f(b.st[1])}) → стоит в (${f(p.head.x, 1)}, ${f(p.head.z, 1)}), до Пугала ${f(Math.hypot(p.head.x - sc.x, p.head.z - sc.z))} м`);
    if (TRACE === "nav") {
      const dirs = [0, 1, 2, 3, 4, 5, 6, 7].map((a) => (canClimb(p.head.x, p.head.z, Math.cos((a * Math.PI) / 4), Math.sin((a * Math.PI) / 4)) ? "+" : "·")).join("");
      say(`      путь ${JSON.stringify(b.bot.nav?.path?.slice(0, 4))} (${b.bot.nav?.path?.length ?? 0}) · проходимо по 8 сторонам (В,СВ,С…): ${dirs} · цель ${b.bot.target} · рейд ${b.bot.raiding}`);
    }
  }
  if (stuck.length) anomalies.push(`Навигация: ${stuck.length} из ${bots.length} ботов не дошли до цели за ${LIMIT} с (застревают у склонов)`);
  results.nav = bots.map((b) => ({ start: b.st, at: b.at }));
}

say(`\n=== АНОМАЛИИ (${anomalies.length}) ===`);
for (const a of anomalies) say(` • ${a}`);
const errs = serverLog.filter((l) => /error|exception|TypeError|ReferenceError/i.test(l));
if (errs.length) say(`\n⚠ ошибки сервера во время опытов (${errs.length}):\n` + [...new Set(errs)].slice(0, 10).join("\n"));
say(`\nготово за ${f((realNow() - t0) / 1000)} с`);
if (JSON_OUT) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(JSON_OUT, JSON.stringify({ lvl: LVL, anomalies, results }, null, 2));
  say(`результаты: ${JSON_OUT}`);
}
void realWarn;
void BOT;
void SCARECROW;
process.exit(0);
