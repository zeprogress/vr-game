import colyseus from "colyseus";
import { invHub, type InvActKind, type InvActResult } from "../invHub";
import { devChat } from "../devChat";
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
  KICK_SAME_NICK_CODE,
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
  type CatBoardRow,
  type CatReportMsg,
  type CatReportRow,
  type TowerMobsMsg,
  type BotEmote,
  type EmoteMsg,
  type VoiceMsg,
  isActKind,
  type OverridesMsg,
  type RtcMsg,
  type SpendMsg,
  type SetSkinMsg,
  type SetSkillsMsg,
  type SetLeaveBotMsg,
  type CastMsg,
  type SkillMsg,
  type WorldLoadoutMsg,
  type SetTimeMsg,
  type ComfortMsg,
  type SpecCmd,
  type SpecCamMsg,
  type DmgHitsMsg,
  type SetPvpMsg,
  type TakeWeaponMsg,
  type UseItemMsg,
  type FishMsg,
  type Xf7,
  type WorldEventMsg,
  type WeaponsListMsg,
  type WarehouseActMsg,
  type TtsPlayMsg,
  type LootItem,
  type PickupFeedMsg,
  type ChatLineMsg,
  type PcInvActMsg,
  type QuestActMsg,
  type ShopBuyMsg,
  type ShopData,
  type ShopSwap,
  type FishWaitMsg,
  type QuestData,
  type PcInvData,
  type AutoGoMsg,
} from "#shared/net/messages";
import { ADMIN_NICK, isAdminNick, advanceHour, SHIELD, BOW, COMBAT, BOT, STAFF_CRIT_MULT, SWORD_CRIT_MULT, DAYCYCLE, CAMPFIRE, DROP_CHANCE, PLAYER, PLAYER_HP, POTION_CD, respecCostFor, RESPEC_ENABLED, PVP, EVENT, LAKE, RESPAWN, SKILL, SPECTATOR_KEY, STREAM_NICKS, TWITCH_CHANNEL, WORLD } from "#shared/constants";
import { SCARECROW, BOSS, MOB, ELITE_MOBS, MOB_CAMPS, SPITTER, FREEZE } from "#shared/mobs";
import { clampToPlay, inPlayArea, RAID, RAID_FIGHT, raidAngle, raidWaypoint } from "#shared/raid";
import { RaidFight, type RaidHost } from "./raidFight";
import { heroStatLine, heroStatRows } from "#shared/heroStats";
import { TwitchChat } from "../TwitchChat";
import { synthChat, ttsAvailable } from "../tts";
import {
  isTtsVoice,
  TTS_DEFAULT_VOICE,
  ttsVoiceFromQuery,
  ttsVoiceMenu,
  ttsVoiceName,
} from "#shared/tts";
import { climbStep, reachAlong, terrainHeight, lakeEllipseDist, lakeShoreDistIn, LAKE_R_AVG } from "#shared/terrain";
import {
  isWeaponKind,
  noGuard,
  resolveBlock,
  rollCritMult,
  weaponDamage,
  WEAPON_RATE,
  HIT_RATE_SLACK,
  WEAPON_REACH,
  type BlockedBy,
  type GuardState,
  type WeaponKind,
  isBladeKind,
  BASE_CRIT,
} from "#shared/combat";
import {
  AEGIS_NAME,
  addToBag,
  migrateStaffAffixes,
  migrateLoot,
  shieldBlockChance,
  vampFrac,
  handsRoll,
  handsCrit,
  isMeleeClass,
  affixPoints,
  bagCount,
  takeFromBag,
  enchantInfo,
  enchantApply,
  isRubyFuel,
  RUBY,
  ENCHANT,
  HEAL_CARRY_MAX,
  affixLabel,
  instanceLabels,
  instanceName,
  instanceStars,
  heldAffixText,
  instanceEffects,
  isAegis,
  shieldReflect,
  shieldRegen,
  shieldPhysDef,
  shieldMagDef,
  weaponQuality,
  affixSum,
  BAG,
  bestWeaponInstance,
  bothHandsCls,
  ATTACK_CLASSES,
  FAV_MAX,
  emptyBag,
  isItemId,
  isWeaponClass,
  isWeaponTier,
  ITEMS,
  plainWeaponInstance,
  rollWeaponInstance,
  swapRubyClass,
  scrapValue,
  takeOne,
  weaponDef,
  weaponKey,
  WEAPON_TAKE_REACH,
  type ItemId,
  type Slot,
  type WeaponClass,
  type WeaponInstance,
  type WeaponTier,
  type AffixSub,
} from "#shared/items";
import {
  hpRegenFrac,
  atMaxLevel,
  meleeSpeedFor,
  staffCastInterval,
  armorFrac,
  dodgeChance,
  holdsOneItem,
  grantXp,
  isStatName,
  maxHpFor,
  moveSpeedFor,
  heroAttackInterval,
  spendPoint,
  resetAttrs,
  statCost,
  STAT_NAMES,
  xpToNext,
  type Progress,
  type StatName,
} from "#shared/progression";
import { canHoldTogether, equipHands, handsValid, hasAttackWeapon, unequipHand } from "#shared/hands";
import { findPath, navCellCenter, straightOk, warmNav } from "../sim/nav";
import { ATTR2 } from "#shared/attrs2";
import { ABYSS, LIFE_ARROW, JUMP_BEHIND, ASSASSIN_STEP_STUN, ASSASSIN_WHIRL_DASH, ASSASSIN_WHIRL_SLOW, PLAGUE, SMOKE, SOUL_STEAL, skillAttrMul, autoSpend, ASSASSIN_FAN_HOP, ASSASSIN_LEAP, classOf2, skillCdMul2, hopDistance, hopsBack, SPEAR_HOP_TRAP, SPEAR_FLURRY, SPEAR_PIERCE_DMG, STORM_CRUSH, CLASSES2, CLASS_IDS, DAGGER, DUAL, isDualPair, HAMMER, SEAL, SKILLS2, skillName, staffMagicTier, WHIRL, WARCRY, MARK, CLEAVE, CHAIN, FAN, GUARD_SEAL, HEAL_AURA, WEAPONS2, type ClassId, type SkillId, type Weapon2 } from "#shared/classes2";
import { ULTS, ULT_COOLDOWN, ULT_HEAL_FRAC, ULT_ARCHER_WAVES, ULT_ASSASSIN_HITS, ULT_ASSASSIN_STEP, ULT_BURN_SEC, ULT_PULL_PULSES, ULT_PULL_POWER } from "#shared/ultimates";
import {
  MAGIC,
  maxManaFor,
  manaRegenFor,
  magicResistFrac,
  potionPowerFor,
  fireboltDamage,
  fireboltSpeed,
  fireboltRadius,
  fireboltHitRadius,
  fireboltSplashRadius,
  healAmountFor,
  magicPowerFor,
  burnHpFracFor,
} from "#shared/magic";
import { HUB, HUB_CENTER, inHubSafeZone, hubSpawnPoint } from "#shared/hub";
import {
  QUEST,
  makeBoard,
  questDay,
  secsToNextDay,
  slotDone,
  slotReward,
  slotTitle,
  questXpFrac,
  type QuestSave,
  type QuestSlot,
  type QuestKind,
  STORY,
  STORY_REWARD,
  STORY_TITLE,
  WEEKLY,
  makeWeekly,
  questWeek,
  secsToNextWeek,
  weeklyDone,
  CHAT_QUEST,
  TITLES,
  TITLE_GOALS,
  type StorySave,
  type WeeklySave,
} from "#shared/quests";
import { CHEST_MIN_QUALITY, HARD_SCROLL_CHANCE, SCROLL, SHOP, TAVERN_REACH } from "#shared/shop";
import { chatLog, store, world } from "../store";
import type { PlayerRecord } from "../PlayerStore";
import { eliteOpts, WEAPON_DROP, ZoneSim, type Mob, type PlayerHit, type SimPlayer } from "../sim/ZoneSim";
import { CatacombDirector, type CatHost } from "./catacombs";
import { TELEGRAM } from "#shared/changelog";
import { CAT_HALLS, CAT_HAZARD, CAT_SHRINE, CAT_SHRINES, CATACOMBS, type CatAffix, catEntry, catProject, catXpFrac, inCatRegion } from "#shared/catacombs";
import type { CatacombMsg, CatStatsMsg } from "#shared/net/messages";
import { TowerRunManager } from "./TowerRunManager";
import { serverPerf } from "../perf";
import type { TowerRunResult, TowerSnapshot } from "./TowerRoom";
import { TOWER, TOWER_HIDE, TOWER_PROP_POS } from "#shared/tower";
import { randomUUID } from "node:crypto";
import { attrOf } from "#shared/attrs2";
import { giveItems, parseTradeItem, parseTradeList, takeItems, takenName, tradeLog, tradeViewOf, TRADE_ACTS, type InvSnap, type Taken, type TradeAct, type TradeItem, type TradeSession, type TradeSide } from "../trade";
import { applyJewelOp, gemName, JEWEL_ACTS, jewelBonus, jewelOpFrom, jewelsOf, pcInvJewels, RING_LOOK, ringName, rollJewelDrop, type JewelAct, type JewelSave } from "#shared/jewels";

const { Room } = colyseus;

/** Сколько HP доливается за новый уровень (как было на клиенте). */
/** Поисков пути (A*) ботам за один тик сервера — остальные ждут следующего тика. */
const BOT_NAV_PER_TICK = 2;
const LEVEL_UP_HEAL = 10;
/** Рыбалка: сколько ждать поклёвку — 40–60 с (см. MSG.fish, tickBotFishing). */
const FISH_WAIT_MIN = 40;
const FISH_WAIT_SPREAD = 20;
/** Игрок: авторыбалка — медленнее (60–80 с на рыбу), вручную — мини-игра, быстрее. */
const FISH_AUTO = { min: 60, spread: 20 };
const FISH_MANUAL = { min: 5, spread: 4, window: 9 };

/** Несетевое состояние игрока: защита, темп ударов, таймеры. */
interface Runtime {
  /** Когда последний раз писал в чат из игры (elapsed) — не чаще раза в 1.5 с. */
  chatSayAt?: number;
  /** Человек-герой записан на событие или рейд (!event / !raid) — клиент ведёт автобоем. */
  autoGoKind?: "event" | "raid";
  /** Когда последний раз пил зелье (elapsed) — общий откат POTION_CD. */
  lastDrinkAt?: number;
  token?: string;
  guard: GuardState;
  /** Момент последнего засчитанного удара каждым видом оружия (сек. комнаты). */
  lastHit: Partial<Record<WeaponKind, number>>;
  /** Темп ударов «счётом»: с какого момента (elapsed) следующий удар этим оружием в норме (см. tryHit). */
  hitNext?: Partial<Record<WeaponKind, number>>;
  sinceHurt: number;
  respawnIn: number;
  /** Секунды неуязвимости после возрождения. */
  invuln: number;
  /** Момент последнего обмена ударами в PvP (сек. комнаты) — для disengage. */
  lastPvpAt: number;
  /** Момент последнего каста посохом — для кулдауна. */
  lastCast: number;
  /** Массовый хил игрока: когда начат каст (сек. комнаты, -1 — не идёт) и когда последний раз сработал. */
  massHealAt: number;
  /** Подпись последнего отправленного клиенту склада оружия (чтобы слать только при изменении). */
  weaponsSig?: string;
  /** Игрок (VR) слушает озвучку чата Twitch — ему шлём ttsPlay. */
  ttsListen?: boolean;
  lastMassHeal: number;
  /** Момент последнего активного умения оружия (воин/лучник) — для кулдауна. */
  lastSkillAt: number;
  /** «Классы 2.0»: когда последний раз применено каждое умение (сек. комнаты). */
  skillAt: Partial<Record<SkillId, number>>;
  /** Когда последний раз применена ульта (`!ульта`), сек. комнаты. */
  ultAt: number;
  /** До какого момента следующий удар — гарантированный крит («Теневой рывок»). */
  forceCritUntil: number;
  /** До какого момента действует «Боевой клич»/«Благословение» (сек. комнаты). */
  cryUntil: number;
  /** Вид клича: 1 — боевой клич, 2 — «Сбор» (темп), 3 — «Благословение». */
  cryKind: number;
  /** «Вихрь»: до какого момента и вид (1 — воин, −30% урона; 2 — ассасин, неуязвим). */
  whirlUntil: number;
  whirlKind: number;
  /** 🧪 «Чумной клинок»: до какого момента удары накладывают яд. */
  plagueUntil: number;
  /** 🧪 «Призрак бездны»: в тени до этого момента (мобы не видят); strike — первый удар из тени ещё не нанесён. */
  abyssUntil: number;
  abyssStrike: boolean;
  /** Ускорение темпа после выхода из тени — до этого момента. */
  hasteUntil: number;
  /** Класс, под который сейчас выставлены skill1/skill2 (смена оружия — другой набор). */
  skillCls: string;
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
  /** ms окончания баффа победы над событием (×2 опыт/урон). 0 — нет баффа. */
  eventBuffUntil: number;
  /** Бафф «Тепло костра» до этого момента (Date.now()); 0 — нет. */
  campBuffUntil: number;
  /** Сколько секунд подряд герой греется у костра (для баффа). */
  campWarm: number;
  /** Когда последний раз показали крестики лечения в лагере (мс). */
  campHealFxAt: number;
  /** Секунда игрового времени (this.elapsed), до которой оглушён (спец-атака моба). */
  stunnedUntil: number;
  /** Обморожение: до какой секунды (this.elapsed) бег медленнее на slowFrac. */
  slowUntil: number;
  slowFrac: number;
  /** Кровотечение: до какой секунды, урон в секунду, кто нанёс, накопитель тика. */
  bleedUntil: number;
  bleedDps: number;
  bleedBy: string;
  bleedT: number;
  /** id моба, по которому только что ударили (для «!follow»-телохранителя — фокус-фаер). */
  lastHitMobId: string | null;
  /** Секунда игрового времени (this.elapsed) последнего удара по lastHitMobId. */
  lastHitMobAt: number;
  /** Собранные инстансы оружия (весь склад, не только надетое). */
  weapons: WeaponInstance[];
  /** Какой именно инстанс сейчас в какой руке (ручной выбор на странице !inv). null — автовыбор лучшего. */
  equippedWeaponId: { left: string | null; right: string | null };
  /** Старый секрет ссылки "!inv" (inv.html?t=…) — только чтобы старые ссылки переадресовать на /inv?ник. */
  viewToken: string;
  /** Рыбалка: секунда (this.elapsed), когда клюнет; null — сейчас не рыбачит. */
  fishBiteAt: number | null;
  /** Авторыбалка: сервер сам вылавливает по таймеру и забрасывает снова. */
  fishAuto: boolean;
}

/** Бот зрителя (Ф10): безголовый игрок, которым рулит сервер. */
interface Bot {
  /** До какого момента (Date.now) бот бьёт пугало по !пугало. */
  testUntil?: number;
  /** Маршрут в обход крутых склонов: к какой цели, точки, когда посчитан (this.elapsed). */
  nav?: { tx: number; tz: number; path: [number, number][]; at: number };
  /** Date.now() появления героя — «новый герой» для приоритета камеры спектатора. */
  spawnedAt: number;
  nick: string; // отображаемый
  norm: string; // нормализованный (ключ в this.bots)
  id: string; // ключ в state.players / rt: "bot:<norm>"
  state: PlayerState;
  rt: Runtime;
  target: string | null; // id моба
  /** id лежащего золотого меча, за которым бот сейчас идёт (Ф10). */
  lootTarget: string | null;
  /** Date.now(), когда бот взял текущую lootTarget — защита от «стоит у лута вечно». */
  lootSince: number;
  /** Лут, до которого бот не смог добраться/поднять за отведённое время — больше не выбираем. */
  lootSkip: Set<string>;
  /** Нормализованный ник, за которым идём между боями (!follow/!come, Ф10). null — никого. */
  followNorm: string | null;
  /**
   * Рейд на босса (!raid): идём к Багровому слизню и бьём его, забыв про
   * зону и обычных мобов. Снимается победой над боссом, гибелью героя
   * (одна попытка — один рейд) или повторным !raid.
   */
  raiding: boolean;
  /** Защита от застревания: когда и где бот был при прошлой проверке; шаг вбок до unstickUntil. */
  progAt?: number;
  progX?: number;
  progZ?: number;
  unstickUntil?: number;
  unstickX?: number;
  unstickZ?: number;
  /** !event: бот-игрока послан на активное событие мира — чистит там мобов,
   *  собирает лут, по окончании события возвращается домой сам. */
  eventing: boolean;
  /** Сейчас в Охотничьей башне (своя TowerRoom) — тело спрятано и заморожено
   *  в основном мире, tickBot() его вообще не трогает. */
  inTower: boolean;
  /** ms конца «уборочной» фазы после события — бот ещё собирает награду, потом домой (0 — не в ней). */
  eventDoneAt: number;
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
  stunCd: number; // с до следующего оглушающего удара (меч)
  stunCastT: number; // с до конца замаха оглушающего
  stunSoundDone: boolean; // звук удара уже проигран за stunSoundLead до удара
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
  /** Лагерь по выбору зрителя (!camp) — ключ ELITE_MOBS; null — автовыбор. */
  campPref: string | null;
  /** Закреплённый случайный выбор среди равных по уровню лагерей (0..1). */
  campRand: number;
  /** !рыбачить: идёт к озеру и рыбачит вместо обычного боя, пока не отменят. */
  fishing: boolean;
  /** Катакомбы: приказы зрителя (живут, пока не сменят — задержка стрима не мешает). */
  catFocus?: CatFocus;
  catPos?: CatPos;
  catMode?: CatMode;
  /** Отступает к входу зала (режим «осторожно», мало HP). */
  catRetreat?: boolean;
  /** 0 — ещё не забросил (у берега); иначе this.elapsed, когда клюнет. */
  fishBiteAt: number;
}


/** Русские имена атрибутов (чат). */
const STAT_RU: Record<StatName, string> = {
  str: "сила", agi: "ловкость", int: "интеллект", con: "телосложение", luc: "удача", wis: "мудрость",
};

/** Чат-команды атрибутов → атрибут. */
const CHAT_STATS: Record<string, StatName> = {
  "!str": "str", "!сила": "str",
  "!dex": "agi", "!agi": "agi", "!ловк": "agi", "!ловкость": "agi",
  "!int": "int", "!инт": "int", "!интеллект": "int",
  "!con": "con", "!тел": "con", "!телосложение": "con",
  "!luc": "luc", "!luck": "luc", "!удача": "luc",
  "!wis": "wis", "!мудр": "wis", "!мудрость": "wis",
};

/** Классы уникального оружия за победу в событии. */
const LEGEND_DROP = ["sword", "bow", "shield", "staff", "dagger", "spear", "hammer"] as const;

/** Оружие шести классов (для выбора класса бота). */
const BOT_CLASS_WEAPONS = ["sword", "bow", "staff", "dagger", "spear", "hammer"] as const;

/**
 * Стартовая вторая рука класса (только когда класс выбран заново через !class или у
 * нового героя): меч/посох — щит, кинжал — второй кинжал, двуручное — ничего.
 * При обычном надевании оружия щит сам не добавляется (см. shared/hands.ts).
 */
function botOffHand(cls: string): string {
  if (cls === "sword" || cls === "staff") return "shield";
  if (cls === "dagger") return "dagger";
  return "";
}

/** Чат: !class <имя> → оружие класса. */
const CLASS_ALIASES: Record<string, (typeof BOT_CLASS_WEAPONS)[number]> = {
  воин: "sword", меч: "sword", warrior: "sword", танк: "sword",
  лучник: "bow", лук: "bow", archer: "bow",
  маг: "staff", посох: "staff", mage: "staff", support: "staff", поддержка: "staff",
  ассасин: "dagger", кинжал: "dagger", кинжалы: "dagger", assassin: "dagger", убийца: "dagger",
  копейщик: "spear", копьё: "spear", копье: "spear", spear: "spear", spearman: "spear",
  боевой: "hammer", "боевой маг": "hammer", молот: "hammer", hammer: "hammer", battlemage: "hammer",
};

/** Выбрано ли у героя это умение (skill1/skill2). */
function hasSkill(p: PlayerState, k: string): boolean {
  return p.skill1 === k || p.skill2 === k;
}

/** Во сколько раз дальше бьёт бот этим оружием (копьё — длинный выпад). */
function botReachMul(cls: string): number {
  return cls === "spear" ? 2.2 : cls === "hammer" ? 1.2 : 1;
}

const TIER_RANK: Record<WeaponTier, number> = { base: 0, gold: 1, legendary: 2, ruby: 3 };

/**
 * Лучший тир класса `cls`, который герой КОГДА-ЛИБО честно поднимал —
 * `rt.owned`/`PlayerRecord.owned` копит это на весь аккаунт, а не только
 * то, что сейчас в руке или спрятано за спиной в VR (см. `stowed`). Бот
 * должен выходить с лучшим из когда-либо заработанного, а не только с тем,
 * что случайно осталось в руках на момент !stop.
 */
function bestOwnedTier(owned: readonly string[] | undefined, cls: WeaponClass): WeaponTier {
  let best: WeaponTier = "base";
  for (const key of owned ?? []) {
    const [c, t] = key.split(":") as [string, WeaponTier | undefined];
    if (c !== cls || !t || !(t in TIER_RANK)) continue;
    if (TIER_RANK[t] > TIER_RANK[best]) best = t;
  }
  return best;
}


/** Лагеря мобов по возрастанию силы (уровня их мобов) — расселение ботов. */
const CAMPS_BY_POWER = [...MOB_CAMPS].sort(
  (a, b) => ELITE_MOBS[a.type].level - ELITE_MOBS[b.type].level,
);

/**
 * Куда высадить/возродить бота. Лагерь, выбранный зрителем (!camp), — на любом
 * уровне героя. Иначе селим у самого сильного лагеря, чей уровень мобов НЕ
 * ВЫШЕ уровня бота + 3 (челлендж чуть выше бота, а не ниже). До 5 ур. —
 * обычная поляна у спавна.
 */
function botHome(level: number, pref: string | null = null, rand = 0): { x: number; z: number } {
  if (pref) {
    const pc = MOB_CAMPS.find((c) => c.type === pref);
    if (pc) return { x: pc.x, z: pc.z };
  }
  if (level < 5 || CAMPS_BY_POWER.length === 0) {
    return { x: RESPAWN.spawnX, z: RESPAWN.spawnZ };
  }
  // Иначе — самый сильный доступный уровень лагерей; если таких несколько
  // (три лагеря ур.33) — свой случайный у каждого бота (rand закреплён за ботом).
  let top = -1;
  for (const c of CAMPS_BY_POWER) {
    const lv = ELITE_MOBS[c.type].level;
    if (lv <= level + 3) top = Math.max(top, lv);
  }
  const cands = CAMPS_BY_POWER.filter((c) => ELITE_MOBS[c.type].level === top);
  const pick = cands.length ? cands[Math.min(cands.length - 1, Math.floor(rand * cands.length))] : CAMPS_BY_POWER[0];
  return { x: pick.x, z: pick.z };
}

/** Точка появления у дома бота: рядом, но с разбросом (не в куче мобов). */
function botSpawnAt(home: { x: number; z: number }): { x: number; z: number } {
  const a = Math.random() * Math.PI * 2;
  const r = 9 + Math.random() * 7;
  return { x: home.x + Math.cos(a) * r, z: home.z + Math.sin(a) * r };
}

/** Стабильный псевдослучайный сдвиг фазы 0..1 по строке — чтобы боты
 *  стрейфились не в такт друг другу (без своего поля состояния на бота). */
function strPhase(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}

/** Все варианты команды веб-инвентаря (раньше !weapons писал склад в чат). */
const INV_COMMANDS = new Set([
  "!inv", "!inventory", "!bag", "!weapons", "!weapon", "!items", "!gear", "!stash",
  "!инв", "!инвентарь", "!инвент", "!бэг", "!сумка", "!рюкзак", "!оружие", "!склад",
  "!вещи", "!шмот", "!шмотки", "!предметы", "!снаряжение", "!лут",
]);

/** Все опции элитного моба из описания ELITE_MOBS — те же, что у лагерей (ZoneSim.eliteOpts). */
function eliteMobOpts(d: (typeof ELITE_MOBS)[string]): NonNullable<Parameters<ZoneSim["spawnEventMob"]>[3]> {
  return eliteOpts(d);
}

/** Ивенты, которые админ включает/выключает командой !ивенты. */
type EventToggle = "invasion" | "hunt" | "catacombs" | "quest";
const EVENT_TOGGLES: readonly EventToggle[] = ["invasion", "hunt", "catacombs", "quest"];
const EVENT_TOGGLE_RU: Record<EventToggle, string> = { invasion: "нашествие", hunt: "охота", catacombs: "катакомбы", quest: "квест чата" };
const EVENT_TOGGLE_WORDS: Record<string, EventToggle> = {
  нашествие: "invasion", invasion: "invasion", охота: "hunt", hunt: "hunt", дракон: "hunt",
  катакомбы: "catacombs", catacombs: "catacombs", квест: "quest", quest: "quest",
};
const EVENT_ON_WORDS = ["вкл", "on", "включить", "включи"];
const EVENT_OFF_WORDS = ["выкл", "off", "выключить", "выключи"];
function isEventToggle(v: string): v is EventToggle {
  return (EVENT_TOGGLES as readonly string[]).includes(v);
}

/** Приказы ботам в катакомбах: кого бить, где стоять, как рисковать. */
type CatFocus = "auto" | "boss" | "adds" | "ranged" | "weak" | "strong";
type CatPos = "auto" | "front" | "back" | "flank";
type CatMode = "auto" | "careful" | "brave";
const CAT_FOCUS_WORDS: Record<string, CatFocus> = {
  авто: "auto", auto: "auto", босс: "boss", босса: "boss", boss: "boss", свита: "adds", свиту: "adds", мелочь: "adds", adds: "adds",
  стрелки: "ranged", стрелков: "ranged", дальних: "ranged", ranged: "ranged", слабых: "weak", слабые: "weak", weak: "weak",
  сильных: "strong", сильные: "strong", strong: "strong",
};
const CAT_POS_WORDS: Record<string, CatPos> = {
  авто: "auto", auto: "auto", вперёд: "front", вперед: "front", фронт: "front", front: "front", танк: "front",
  назад: "back", сзади: "back", тыл: "back", back: "back", фланг: "flank", сбоку: "flank", flank: "flank",
};
const CAT_MODE_WORDS: Record<string, CatMode> = {
  авто: "auto", auto: "auto", осторожно: "careful", осторожный: "careful", careful: "careful",
  агрессивно: "brave", агрессивный: "brave", смело: "brave", brave: "brave",
};
const CAT_FOCUS_RU: Record<CatFocus, string> = { auto: "сам выбирает", boss: "босс", adds: "свита", ranged: "стрелки", weak: "слабые", strong: "сильные" };
const CAT_POS_RU: Record<CatPos, string> = { auto: "сам", front: "впереди", back: "сзади", flank: "с фланга" };
const CAT_MODE_RU: Record<CatMode, string> = { auto: "обычно", careful: "осторожно", brave: "агрессивно" };

/** Позиция в сейв: за край карты не пишем, из катакомб — в лагерь (после рестарта там пусто). */
function savePos(x: number, y: number, z: number, edge: number): { x: number; y: number; z: number } {
  if (inCatRegion(x, z)) {
    const sp = hubSpawnPoint();
    return { x: sp.x, y: terrainHeight(sp.x, sp.z) + PLAYER.eyeHeight, z: sp.z };
  }
  if (inPlayArea(x, z)) return { x, y, z }; // плато рейд-босса — за краем карты, но своё
  return { x: clampAbs(x, edge), y, z: clampAbs(z, edge) };
}

/** Нормализация ника для сравнения/ключей. */
function normNick(n: string): string {
  return n.trim().toLowerCase().slice(0, 24);
}

/**
 * Боты зрителей ПЕРЕЖИВАЮТ перезапуск сервера (восстанавливаются из записей),
 * но снимаются, если хозяин не появлялся дольше BOT.ownerAbsentSec (см.
 * tickBots) — часы стартуют либо от выхода из игры с "оставить бота", либо от
 * последнего сообщения в чате, и дальше продлеваются ТОЛЬКО настоящим чатом.
 * Фарм самого бота таймер не продлевает.
 */
const RESTORE_BOTS_ON_START = true;

/**
 * Одноразовая чистка всех ботов зрителей. Поменять токен → при следующем
 * старте сервера все записи `nick:*` помечаются botActive:false (прогресс
 * сохраняется, бот просто не поднимается; зритель вернёт его через `!play`).
 */
const BOT_WIPE_TOKEN = "2026-09-11-a";

/** Сколько HP восстановит расходник: доля недостающего (healFrac) либо плоское (heal). */
function potionHeal(def: { heal: number; healFrac: number }, hp: number, maxHp: number): number {
  if (def.healFrac > 0) return Math.round(Math.max(0, maxHp - hp) * def.healFrac);
  return def.heal;
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

/** Закреплённый вручную инстанс на руку (закрепляется на странице !inv) — строка-id или null. */
function sanitizeEquipped(v: unknown): { left: string | null; right: string | null } {
  const e = v as { left?: unknown; right?: unknown } | undefined;
  return {
    left: typeof e?.left === "string" ? e.left : null,
    right: typeof e?.right === "string" ? e.right : null,
  };
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

/** Башня испытаний открыта? Временно закрыта (2026-10-01) — событие не выпадает, очередь не принимает. */
const TOWER_OPEN = false;
/** Бот по дороге подбирает всё, что лежит ближе этого (м, по горизонтали). */
const BOT_GRAB_RADIUS = 5;
/** Полуугол конуса удара копья, рад (~35° в каждую сторону). */
const SPEAR_CONE = 0.6;
/** Бот-ближник начинает замах, только довернувшись на цель ближе этого угла, рад (~45°). */
const BOT_MELEE_FACE = 0.8;

/**
 * Вампиризм оружия ближнего боя в руках: два меча/кинжала — лучший из двух
 * (как и остальные роллы, см. handsRoll). Двуручное (одно и то же в обеих руках) — один раз.
 */
function heldVamp(p: PlayerState, rt: Runtime): number {
  const l = rolledIn(p, "left", rt);
  const r = rolledIn(p, "right", rt);
  return Math.max(vampFrac(r), l && l.id !== r?.id ? vampFrac(l) : 0);
}

/**
 * Вампиризм удара ближнего боя — одно правило для игроков и ботов: от урона
 * по основной цели — полностью, от остальных целей (сплэш меча, выпад копья,
 * волна молота) — доля COMBAT.splashVampFrac.
 */
function vampHeal(p: PlayerState, vamp: number, mainDmg: number, splashDmg: number): void {
  p.hp = Math.min(p.maxHp, p.hp + (mainDmg + splashDmg * COMBAT.splashVampFrac) * vamp);
}

/** Щит в руках героя: тир и экземпляр (null — щита нет). */
function shieldOf(p: PlayerState, rt: Runtime | undefined): { tier: string; inst: WeaponInstance | null } | null {
  const hand = p.leftCls === "shield" ? "left" : p.rightCls === "shield" ? "right" : null;
  if (!hand) return null;
  return { tier: hand === "left" ? p.leftTier : p.rightTier, inst: rt ? rolledIn(p, hand, rt) : null };
}

/** Шанс блока щитом героя: тир щита + ролл Блок (0 — щита в руках нет). */
function blockChanceOf(p: PlayerState, rt: Runtime | undefined): number {
  const hand = p.leftCls === "shield" ? "left" : p.rightCls === "shield" ? "right" : null;
  if (!hand) return 0;
  const tier = hand === "left" ? p.leftTier : p.rightTier;
  return shieldBlockChance(tier, rt ? rolledIn(p, hand, rt) : null);
}

/**
 * Конкретный раскатанный инстанс оружия в руке. Если игрок закрепил
 * конкретный экземпляр через страницу !inv (и тот всё ещё в его складе и
 * совпадает с надетым классом+тиром) — берём его; иначе автовыбор
 * лучшего инстанса этого класса+тира (см. bestWeaponInstance).
 */
function rolledIn(p: PlayerState, hand: "left" | "right", rt: Runtime): WeaponInstance | null {
  const h = heldIn(p, hand);
  if (!h) return null;
  // Закреплённый за этой рукой — или за другой, если она не держит второе оружие того же класса:
  // двуручное инвентарь закрепляет за любой рукой (лук — за левой), а в руках оно числится справа.
  const other = hand === "left" ? "right" : "left";
  const ids = [rt.equippedWeaponId[hand], heldIn(p, other)?.cls === h.cls ? null : rt.equippedWeaponId[other]];
  for (const pinnedId of ids) {
    if (!pinnedId) continue;
    const pinned = rt.weapons.find((w) => w.id === pinnedId);
    if (pinned && pinned.cls === h.cls && pinned.tier === h.tier) return pinned;
  }
  return bestWeaponInstance(rt.weapons, h.cls, h.tier);
}

/**
 * Предмет во ВТОРОЙ руке от бьющего оружия — его роллы идут в удар вместе с
 * роллами бьющего (от каждого вида — лучший из двух, см. handsRoll): щит,
 * второй меч/кинжал. Двуручное (лук/посох/копьё/молот числится в обеих руках —
 * это тот же экземпляр) второй раз не считается. `attackHand` — рука бьющего оружия.
 */
function shieldRolledIn(p: PlayerState, attackHand: "left" | "right", rt: Runtime): WeaponInstance | null {
  const off = attackHand === "left" ? "right" : "left";
  if (!heldIn(p, off)) return null;
  const other = rolledIn(p, off, rt);
  const main = rolledIn(p, attackHand, rt);
  return other && other.id !== main?.id ? other : null;
}

/** Доп. множитель урона от роллов Урон (dmgFlat/dmgPct — один вид) обеих рук: лучший из двух. */
function rolledDmgMul(p: PlayerState, hand: "left" | "right", rt: Runtime): number {
  return 1 + handsRoll(rolledIn(p, hand, rt)?.affixes, shieldRolledIn(p, hand, rt)?.affixes, "dmgFlat", "dmgPct");
}

/** Доп. множитель скорости атаки/каста от ролла atkSpeedPct обеих рук: лучший из двух. */
function rolledAtkSpeedMul(p: PlayerState, hand: "left" | "right", rt: Runtime): number {
  return 1 + handsRoll(rolledIn(p, hand, rt)?.affixes, shieldRolledIn(p, hand, rt)?.affixes, "atkSpeedPct");
}

/** Доп. крит от ролла Крит на бьющем оружии и предмете в другой руке (см. shieldRolledIn): лучший из двух. */
function rolledCrit(
  p: PlayerState,
  hand: "left" | "right",
  rt: Runtime,
): { chance: number; mult: number } {
  return handsCrit(rolledIn(p, hand, rt)?.affixes, shieldRolledIn(p, hand, rt)?.affixes);
}

/** Ранг тира для сравнения апгрейдов: base < gold < legendary. */
function tierRank(t: WeaponTier | string): number {
  return t === "ruby" ? 3 : t === "legendary" ? 2 : t === "gold" ? 1 : 0;
}

/**
 * Бот наденет найденное `w` сам: тот же класс (щит — в левую), тир выше — и оружие в этой руке
 * НЕ выбрано игроком (не закреплено в инвентаре). Выбранное игроком бот не меняет — найденное уходит в склад.
 */
function botEquipUpgrade(p: PlayerState, rt: Runtime, w: { cls: WeaponClass; tier: WeaponTier }): boolean {
  const hand = w.cls === "shield" ? "left" : "right";
  if (w.cls === "shield" ? p.leftCls !== "shield" : w.cls !== p.rightCls) return false;
  if (tierRank(w.tier) <= tierRank((hand === "left" ? p.leftTier : p.rightTier) as WeaponTier)) return false;
  const inst = rolledIn(p, hand, rt);
  return !(inst && (inst.id === rt.equippedWeaponId.left || inst.id === rt.equippedWeaponId.right));
}

/**
 * Оружие тира gold/legendary, которое было в руке ДО появления склада
 * инстансов (или подобрано в обход этого пути), не имеет записи в
 * rt.weapons — если его сейчас снимут (смена оружия), деться ему некуда,
 * пропадёт безвозвратно. Перед любой сменой рук докладываем такой предмет
 * в склад "голым" (без роллов) инстансом, если там ещё нет ни одного.
 */
/** Руки героя — живой PlayerState или то же самое, собранное из сейва офлайн-героя. */
interface Hands {
  leftCls: string;
  leftTier: string;
  rightCls: string;
  rightTier: string;
}

/**
 * Надеть конкретный инстанс по общим правилам рук (shared/hands.ts): щит сам
 * не надевается, двуручное освобождает обе руки, несовместимое уходит на склад.
 * Общее для веб-инвентаря (в т.ч. для героя не в мире —
 * тогда p/rt собраны из сейва).
 */
function applyEquip(
  p: Hands,
  rt: { weapons: WeaponInstance[]; equippedWeaponId: { left: string | null; right: string | null }; owned: Set<string> },
  w: WeaponInstance,
  /** Рука, куда просили надеть. Левая учитывается для второго меча/кинжала к такому же в правой. */
  side: "left" | "right" = "right",
): void {
  const before = { ...p };
  const removed = equipHands(p, w.cls, w.tier, side);
  // Щит вместо двуручного — без оружия героя не оставляем: в правую обычный меч.
  if (!hasAttackWeapon(p)) {
    p.rightCls = "sword";
    p.rightTier = "base";
  }
  for (const s of removed) {
    preserveLegacyWeapon(rt, s === "left" ? before.leftCls : before.rightCls, s === "left" ? before.leftTier : before.rightTier);
    rt.equippedWeaponId[s] = null;
  }
  // Закрепляем экземпляр за той рукой, где он оказался.
  const at: "left" | "right" = p.leftCls === w.cls && p.leftTier === w.tier && (w.cls === "shield" || side === "left") ? "left" : "right";
  rt.equippedWeaponId[at] = w.id;
  if (!p.leftCls) rt.equippedWeaponId.left = null;
  rt.owned.add(weaponKey(w.cls, w.tier));
}

/**
 * Снять предмет с руки на склад (страница !inv, «снять»). Без оружия героя не
 * оставляем. null — получилось, иначе текст отказа.
 */
function applyUnequip(
  p: Hands,
  rt: { weapons: WeaponInstance[]; equippedWeaponId: { left: string | null; right: string | null } },
  side: "left" | "right",
): string | null {
  const before = { ...p };
  const pinned = { ...rt.equippedWeaponId };
  const err = unequipHand(p, side);
  if (err) return err;
  // Снятое — на склад (легаси без экземпляра сохраняем как экземпляр).
  preserveLegacyWeapon(rt, side === "left" ? before.leftCls : before.rightCls, side === "left" ? before.leftTier : before.rightTier);
  // Сняли правое — второе оружие из левой переехало в правую вместе с закреплением.
  if (side === "right") rt.equippedWeaponId.right = pinned.left;
  rt.equippedWeaponId.left = null;
  return null;
}

/**
 * Одна попытка заточки аффикса `idx`: лом списывается в любом случае,
 * шанс/цена/прирост — enchantInfo/ENCHANT в items.ts. Мутирует w и bag.
 */
function enchantTry(
  w: WeaponInstance,
  idx: number,
  bag: Slot[],
  weapons: WeaponInstance[],
  held: ReadonlySet<string | null | undefined>,
  /** Огранка рубинового: какое уникальное 99 сжечь (выбирает игрок). */
  fuelId?: string,
): InvActResult {
  const info = enchantInfo(w, idx);
  if (!info) return { ok: false, text: "Нет такого ролла." };
  if (info.max) return { ok: false, text: "Этот ролл уже на максимуме." };
  if (info.ruby) {
    // Огранка рубина: сгорает выбранное игроком уникальное с оценкой 99 (не избранное и не в руках), при любом исходе.
    const fi = weapons.findIndex((x) => x.id === fuelId);
    const cand = weapons[fi];
    if (!cand) return { ok: false, text: `Выбери уникальное оружие с оценкой ${RUBY.fuelQuality} — его сожжёт огранка.` };
    if (!isRubyFuel(cand)) return { ok: false, text: `Для огранки годится только уникальное с оценкой ${RUBY.fuelQuality}.` };
    if (cand.fav) return { ok: false, text: "Это оружие в избранном ★ — сними звёздочку, чтобы сжечь его в огранке." };
    if (held.has(cand.id)) return { ok: false, text: "Это оружие сейчас в руках — сначала надень другое." };
    const fuel = weapons[fi];
    weapons.splice(fi, 1);
    const up = Math.random() < info.chance;
    const before = info.points;
    if (up) enchantApply(w, idx, info.gain ?? 1);
    const label = affixLabel(w.affixes[idx]);
    const gained = affixPoints(w.affixes[idx], w) - before;
    return {
      ok: true,
      text: up ? `Огранка удалась (+${gained}): ${label}` : `Не вышло — ${instanceName(fuel)} рассыпалось`,
      enchant: { id: w.id, idx, up, gain: gained, cost: 1, label },
    };
  }
  if (!takeFromBag(bag, "scrap", info.cost)) {
    return { ok: false, text: `Не хватает лома: нужно ${info.cost}, есть ${bagCount(bag, "scrap")}.` };
  }
  const up = Math.random() < info.chance;
  const before = info.points;
  if (up) {
    const gain = ENCHANT.gainMin + Math.floor(Math.random() * (ENCHANT.gainMax - ENCHANT.gainMin + 1));
    enchantApply(w, idx, gain);
  }
  const label = affixLabel(w.affixes[idx]);
  const gained = affixPoints(w.affixes[idx], w) - before;
  return {
    ok: true,
    text: up ? `Заточка удалась: ${label}` : `Не вышло — лом сгорел (−${info.cost})`,
    enchant: { id: w.id, idx, up, gain: gained, cost: info.cost, label },
  };
}

/** Что у героя из сейва в руках (закреплённое или лучший экземпляр того же вида — как считает игра). */
function recHeldIds(rec: { weapons?: WeaponInstance[]; equippedWeaponId?: unknown; held?: unknown }): Set<string | null | undefined> {
  const weapons = rec.weapons ?? [];
  const eq = sanitizeEquipped(rec.equippedWeaponId);
  const heldRec = sanitizeHeld(rec.held);
  const inHand = (h: CarriedWeapon | null): string | undefined => (h ? bestWeaponInstance(weapons, h.cls, h.tier)?.id : undefined);
  return new Set([eq.left, eq.right, inHand(heldRec.left), inHand(heldRec.right)]);
}

function preserveLegacyWeapon(rt: { weapons: WeaponInstance[] }, cls: string, tier: string): void {
  if (tier === "base" || !isWeaponClass(cls) || !isWeaponTier(tier)) return;
  if (rt.weapons.some((w) => w.cls === cls && w.tier === tier)) return;
  rt.weapons.push(plainWeaponInstance(cls, tier));
}

/**
 * Можно ли `id` подбирать этот дроп прямо сейчас — бронь за добившим моба
 * (BAG.lootOwnerSec) не даёт чужому боту/игроку утащить трофей раньше, чем
 * до него дойдёт тот, кто его выбил (раздел 8 плана).
 */
function lootFreeFor(d: { ownerId: string | null; ownerUntil: number }, id: string): boolean {
  return !d.ownerId || d.ownerId === id || Date.now() > d.ownerUntil;
}

function readProgress(p: PlayerState): Progress {
  return { level: p.level, xp: p.xp, unspent: p.unspent, str: p.str, agi: p.agi, int: p.int, con: p.con, luc: p.luc, wis: p.wis };
}

function writeProgress(p: PlayerState, s: Progress): void {
  p.level = s.level;
  p.xp = s.xp;
  p.unspent = s.unspent;
  p.str = s.str;
  p.agi = s.agi;
  p.int = s.int;
  p.con = s.con;
  p.luc = s.luc;
  p.wis = s.wis;
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
  // Стопки одного предмета (лом/рыба/зелья) сливаем в первую — одна кучка
  // на предмет; сверх предела стопки остаток ниже срежет лимит банок.
  for (let i = 0; i < bag.length; i++) {
    const s = bag[i];
    if (!s.item || ITEMS[s.item].stack <= 1) continue;
    const cap = ITEMS[s.item].stack;
    for (let j = i + 1; j < bag.length; j++) {
      const t = bag[j];
      if (t.item !== s.item) continue;
      const put = Math.min(t.count, cap - s.count);
      s.count += put;
      t.count -= put;
      if (t.count <= 0) bag[j] = { item: null, count: 0 };
    }
  }
  // Лимит банок хп (HEAL_CARRY_MAX): лишнее у уже накопивших срезаем при
  // загрузке сейва — с конца сумки, чтобы основные стопки остались целыми.
  const have = new Map<string, number>();
  for (const s of bag) if (s.item && ITEMS[s.item].heal > 0) have.set(s.item, (have.get(s.item) ?? 0) + s.count);
  for (const [id, total] of have) {
    let over = total - HEAL_CARRY_MAX;
    for (let i = bag.length - 1; i >= 0 && over > 0; i--) {
      const s = bag[i];
      if (s.item !== id) continue;
      const cut = Math.min(over, s.count);
      s.count -= cut;
      over -= cut;
      if (s.count <= 0) bag[i] = { item: null, count: 0 };
    }
  }
  return bag;
}

/** Сколько мс герой считается «новичком» для камеры спектатора. */
const FRESH_MS = 180_000;
/** Сколько после сообщения в чате бот хозяина в приоритете у авто-камеры. */
const CHAT_CAM_MS = 180_000;
/** !focus: сколько камера держит героя и кулдаун команды на зрителя. */
const FOCUS_SHOW_MS = 10_000;
const FOCUS_COOLDOWN_MS = 10 * 60_000;
const FOCUS_COMMANDS = new Set(["!focus", "!фокус", "!покажи", "!показать", "!cam", "!камера", "!смотри"]);

interface JoinOpts {
  nick?: string;
  token?: string;
  /** Ключ невидимого спектатора для стрима (этап 17). */
  spectator?: string;
  /** Страница диктора (voice.html): только голос в игру, свой ключ CASTER_KEY. */
  caster?: string;
  /** Вход по нику (Ф10): забрать своего бота / персонажа. Без токена. */
  stream?: boolean;
  /** Пароль админ-ника (ADMIN_NICKS) — см. проверку в начале onJoin. */
  adminPass?: string;
}

/**
 * Пароль для входа под ником из ADMIN_NICKS. Только из окружения — раньше
 * ник был просто текстом в поле логина на сайте: любой посетитель мог
 * вписать "zeprogress" и получить админ-команды в чате (isAdminNick
 * сверяет только сам ник, а его никто не проверял). НЕ давать сюда
 * встроенный дефолт (в отличие от SPEC_KEY ниже) — этот файл собирается и
 * в клиентский бандл, дефолт в исходнике был бы виден в devtools каждому.
 * Пусто — вход под админ-ником просто запрещён (безопасно по умолчанию).
 */
const ADMIN_PASS = process.env.ADMIN_PASS || "";
/** Тестовый стенд (STAGING=1, см. deploy/staging): без Twitch и ботов, мир — только пока есть игроки. */
const STAGING = process.env.STAGING === "1";

/** Ключ спектатора: из окружения, иначе — встроенный (см. shared/constants). */
/** Запас дальности удара на сетевую задержку (позиции на сервере отстают), м. */
const HIT_LAG_PAD = 1;
/** На сколько секунд удар может опередить свой срок (тик сервера + разброс сети), см. tryHit. */
const HIT_BUNCH = 0.15;
/** Цифры урона игроку — только в этом квадрате вокруг него, м. */
const DMG_NUM_R = 60;
const SPEC_KEY = process.env.SPECTATOR_KEY || SPECTATOR_KEY;
/** Ключ страницы диктора voice.html (bearmood_tv) — отдельный от спектаторского. */
const CASTER_KEY = process.env.CASTER_KEY || "voice-68105a2bfa";

/**
 * Одна зона мира. Сервер авторитетен: мобы, куклы, плевки, здоровье игроков,
 * блок щитом/мечом, опыт и уровни. Клиент шлёт только транспорт и заявки
 * на удар — досягаемость, темп и урон проверяются здесь.
 */
/** Команды записи в катакомбы (чат Twitch и игры). */
const CAT_CMDS: readonly string[] = ["!катакомбы", "!кт", "!catacombs", "!dungeon", "!данж"];

export class ZoneRoom extends Room<ZoneState> {
  private sim!: ZoneSim;
  private readonly rt = new Map<string, Runtime>();
  /** sessionId, которых мы сами выгнали (kickNick) — onLeave не должен ждать
   * для них 20с реконнекта, иначе они могут отбить место обратно у новой сессии. */
  private readonly kickedSessions = new Set<string>();
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
  /** Боты на тесте у пугала (!пугало) — для них пугало считается целью. */
  private readonly scareTesters = new WeakSet<PlayerState>();
  /** Кто участвует в текущем событии: побывал в его зоне или хотя бы раз ударил моба события. */
  private readonly eventParticipants = new Set<string>();
  private eventZoneCheckAt = 0;
  /** Сколько попыток в башне началось за текущее окно события (0 — никто не приходил). */
  private towerRunsStarted = 0;
  private readonly chatSeen = new Map<string, number>(); // normNick -> ms последнего сообщения
  /** Только реальные сообщения в чате (для списка «писали за час» в обмене); в отличие от chatSeen не трогается при уходе в бота. */
  private readonly chatLast = new Map<string, number>(); // normNick -> ms
  private readonly ttsLast = new Map<string, number>(); // normNick -> ms последней озвучки
  private readonly playCd = new Map<string, number>(); // normNick -> ms последнего !play
  private infoAt = 0; // ms последнего ответа на !info (общий кулдаун)
  private bossFighting = false; // босс сейчас в бою (для баннера появления)
  private bossAnnouncedAt = 0; // ms последнего баннера «БОСС ПОЯВИЛСЯ»
  private readonly hintAt = new Map<string, number>(); // normNick -> ms последней подсказки
  /** Копится в step() до BOT.tipIntervalSec — см. maybeSayTip(). */
  private tipClock = 0;
  /** По кругу — следующий индекс в TIPS для maybeSayTip(). */
  private tipIdx = 0;

  override onCreate(): void {
    // Сетка маршрутов ботов в обход крутых склонов — считается в фоне после старта (sim/nav.ts).
    warmNav();
    // Разово: свет травы, подобранный на стенде 2026-09-28, — в общую подгонку
    // (админ-панель хранит её на сервере и перебивает дефолты клиента).
    {
      const lo = world.loadLoadout() as { glow?: Record<string, number> };
      const g = (lo.glow ??= {});
      if (g._grassTuneV !== 3) {
        Object.assign(g, { grassSunDay: 1, grassGlowDay: 1.85, grassSunNight: 3, grassGlowNight: 3, _grassTuneV: 3 });
        world.saveLoadout(lo);
        console.log("[world] свет травы обновлён по настройке со стенда");
      }
    }
    // Посохи: роллы со старого завышенного диапазона → общий, очки те же
    // (разово — migrateStaffAffixes метит инстанс). «Лут 3.0»: сила крита
    // 0.8 → 1.0 с теми же очками, старые уникальные получают врождённый
    // эффект (migrateLoot3, тоже разово). Сейвы и лут на земле.
    let staffFixed = 0;
    for (const rec of store.entries()) {
      let changed = false;
      for (const w of rec.weapons ?? []) {
        if (migrateStaffAffixes(w)) changed = true;
        if (migrateLoot(w)) changed = true;
      }
      if (changed) {
        staffFixed++;
        store.put(rec.token, { weapons: rec.weapons });
      }
    }
    for (const d of world.loadDrops()) {
      if (!d.instance) continue;
      migrateStaffAffixes(d.instance);
      migrateLoot(d.instance);
    }
    if (staffFixed) console.log(`[zone] оружие пересчитано у ${staffFixed} героев`);
    // Чистка сумок во всех сейвах: одна стопка на предмет, зелий не больше 99.
    for (const rec of store.entries()) {
      if (!Array.isArray(rec.bag)) continue;
      const bag = restoreBag(rec.bag);
      if (JSON.stringify(bag) !== JSON.stringify(rec.bag)) store.put(rec.token, { bag });
    }
    invHub.setZone({
      sync: (norm) => this.persistNick(norm),
      act: (norm, act, id, idx, fuel) => this.invAct(norm, act, id, idx, fuel),
      pcInv: (norm) => {
        const t = this.findWeaponsTarget(norm);
        return t ? this.pcInvDataFor(t.p, t.rt) : null;
      },
      chatters: (exceptNorm) => this.chatRecentNicks(exceptNorm),
    });
    // Разовая ручная отметка: эти герои прошли башню целиком до появления towerClearedAt.
    // Ставится один раз (пока отметки нет), порядок — по времени первого запуска сервера.
    for (const nick of ["flannel_"]) {
      const rec = store.get(`nick:${nick}`);
      if (rec && rec.towerClearedAt === undefined) {
        store.put(`nick:${nick}`, { towerClearedAt: Date.now(), bestTowerFloor: Math.max(rec.bestTowerFloor ?? 0, TOWER.floors) });
      }
    }
    this.setState(new ZoneState());
    // Зона — единственный постоянный мир. НЕ распускаем комнату, когда из неё
    // вышел последний клиент: иначе перезагрузка страницы спектатора (на
    // секунду 0 подключений) убивала комнату вместе со всеми ботами, а
    // спектатор возвращался уже в пустой заново созданный мир.
    this.autoDispose = false;
    // Тестовый стенд (deploy/staging): мир живёт, только пока в нём кто-то
    // есть — единственное ядро VPS делим с продом, пустой стенд не тикает.
    if (STAGING) this.autoDispose = true;
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
    this.state.dmgNumbers = pult.dmgNumbers === false ? 0 : 1;
    this.state.specMusicVol = typeof pult.specMusicVol === "number" ? pult.specMusicVol : 100;
    this.state.specSfxVol = typeof pult.specSfxVol === "number" ? pult.specSfxVol : 100;
    this.state.specEventVol = typeof pult.specEventVol === "number" ? pult.specEventVol : 100;
    this.state.ttsOn = pult.ttsOn === true ? 1 : 0;
    this.state.ttsVoice = isTtsVoice(pult.ttsVoice ?? "") ? pult.ttsVoice! : TTS_DEFAULT_VOICE;
    this.overlayCfg = { ...(pult.overlay ?? {}) };
    this.pultAuto = pult.auto !== false;
    this.pultBotsOnly = pult.botsOnly === true;
    this.state.mobsOn = pult.mobsOn === false ? 0 : 1;
    for (const k of pult.eventsOff ?? []) if (isEventToggle(k)) this.eventsOff.add(k);
    this.sim = new ZoneSim();
    this.sim.mobsEnabled = pult.mobsOn !== false;
    // Уровень убийцы (для угасания шанса золотого дропа после 15 ур., см.
    // goldDropMulForLevel) — Sim сам PlayerState не хранит, id одинаково
    // работает и для живых игроков (sessionId), и для ботов ("bot:<ник>"):
    // и те, и другие лежат в state.players.
    this.sim.getAttackerLevel = (id) => this.state.players.get(id)?.level ?? 1;
    // Рейд-босса ранят только с арены; из разрыва орбиты — полный урон, вне — доля (raidFight.hitMul).
    this.sim.raidDmgMul = (id) => {
      const p = this.state.players.get(id);
      return p ? this.raid.hitMul(id, p.head.x, p.head.z) : 0;
    };
    // Поджог огнешара — ролл посоха «Поджог» (шанс); горение от ИНТ (burnHpFracFor). Пронзание — ролл лука.
    // Один источник для игроков и ботов (роллы того, что в руках).
    this.sim.getIgnite = (id) => {
      const ch = this.heroRoll(id, "ignite");
      return ch > 0 && Math.random() < ch ? burnHpFracFor(this.state.players.get(id) ?? { int: 1 }) : 0;
    };
    this.sim.rollPierce = (id) => {
      const ch = this.heroRoll(id, "pierce");
      return ch > 0 && Math.random() < ch;
    };

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
    serverPerf.storeInfo = () => ({
      flushMs: store.lastFlush.ms,
      bytes: store.lastFlush.bytes,
      flushes: store.lastFlush.count,
    });
    serverPerf.start(() => {
      // Трафик — байты, записанные/прочитанные сокетами клиентов (монотонные счётчики ws).
      let out = 0;
      let inn = 0;
      for (const c of this.clients) {
        const sock = (c as unknown as { ref?: { _socket?: { bytesWritten?: number; bytesRead?: number } } }).ref?._socket;
        out += sock?.bytesWritten ?? 0;
        inn += sock?.bytesRead ?? 0;
      }
      return {
        clients: this.clients.length,
        players: this.state.players.size,
        mobs: this.sim.mobs.size,
        drops: this.state.drops.size,
        bolts: this.state.bolts.size,
        bytesOut: out,
        bytesIn: inn,
      };
    });

    // Чат Twitch: `!play` — бот под ником зрителя, `!stop` — убрать.
    // На тестовом стенде чат НЕ слушаем: иначе !play из чата канала спавнил бы
    // ботов и там, а с токеном бот отвечал бы в чат дважды.
    if (!STAGING) {
      this.twitch = new TwitchChat(
        process.env.TWITCH_CHANNEL || TWITCH_CHANNEL,
        (nick, text) => this.onChat(nick, text),
        // Логин и токен бота — только из окружения (deploy/stream.env на VPS).
        // Не заданы — чат читается как раньше, просто без ответов.
        { user: process.env.TWITCH_BOT_USER, token: process.env.TWITCH_OAUTH },
      );
      this.twitch.start();
    }

    // Разовая чистка ботов: при смене BOT_WIPE_TOKEN — один раз всех гасим.
    if (pult.botWipe !== BOT_WIPE_TOKEN) {
      let w = 0;
      for (const rec of store.entries()) {
        if (rec.token?.startsWith("nick:") && rec.botActive !== false) {
          store.put(rec.token, { botActive: false });
          w++;
        }
      }
      store.flush();
      world.savePult({ botWipe: BOT_WIPE_TOKEN });
      console.log(`[bot] одноразовая чистка: снято ${w} ботов (токен ${BOT_WIPE_TOKEN})`);
    }

    if (RESTORE_BOTS_ON_START && !STAGING) this.restoreBots();
    // Стенд: «чат» приходит с локальной страницы (devChat), а не из Twitch.
    if (STAGING) devChat.set((nick, text) => this.onChat(nick, text));

    this.onMessage(MSG.move, (client: Client, msg: MoveMsg) => {
      const p = this.state.players.get(client.sessionId);
      const rt = this.rt.get(client.sessionId);
      if (!p || !rt || !msg) return;
      if (msg.mode === "vr" || msg.mode === "flat") p.mode = msg.mode;
      if (msg.plat === 1 || msg.plat === 2 || msg.plat === 3) p.plat = msg.plat;
      applyXf(p.head, msg.head);
      applyXf(p.handL, msg.handL);
      applyXf(p.handR, msg.handR);
      // За край карты не пускаем даже кривого клиента; в катакомбах — стены залов.
      this.clampHero(client.sessionId, p);
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
      p.maxHp = maxHpFor(p.level, p);
      p.hp = Math.min(p.maxHp, p.hp + Math.max(0, p.maxHp - before));
      const beforeMana = p.maxMana;
      p.maxMana = maxManaFor(p.level, p);
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

      // --- массовое лечение: посох над головой + курок (как у ботов, то же время каста) ---
      // Аура исцеления (VR-жест «посох над головой» и ПК/телефон) — сразу, без каста.
      if (msg.spell === "massHealStart" || msg.spell === "massHeal") {
        this.castSkill("massHeal", client.sessionId, p, rt, NaN, NaN);
        return;
      }
      if (msg.spell === "massHealCancel") {
        rt.massHealAt = -1;
        return;
      }

      // --- лечение (небоевое) ---
      if (msg.spell === "heal") {
        const h = MAGIC.heal;
        const healHand = p.rightCls === "staff" ? "right" : "left";
        if (this.elapsed - rt.lastCast < h.cooldown / rolledAtkSpeedMul(p, healHand, rt)) return;
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
        target.hp = Math.min(
          target.maxHp,
          target.hp + healAmountFor(p.level, p, charge) * rolledDmgMul(p, healHand, rt),
        );
        // Лечение союзника в бою с боссом — вклад в общий опыт (гибридный делёж).
        if (target !== p) this.sim.bossHeal(client.sessionId, target.hp - beforeHp);
        return;
      }

      // Ролл "скорость атаки" на посохе укорачивает и кулдаун каста —
      // раньше применялся только к tryHit() (меч/лук), сюда не доходил.
      const staffHand = p.rightCls === "staff" ? "right" : "left";
      // Скорость каста (МДР) укорачивает откат огнешара — вместе с роллом «скорость атаки».
      // Плюс темп от «Боевого клича»/«Благословения» — клиент ускоряется так же (Game: atkSpeedAffix × cry).
      const castCooldown = staffCastInterval(p.level, p, rolledAtkSpeedMul(p, staffHand, rt) * this.cryTempo(rt));
      if (this.elapsed - rt.lastCast < castCooldown) return;
      // Заряд ниже минимума ИЛИ не хватило маны на минимальный старт — впустую.
      if (charge < MAGIC.firebolt.minCharge || p.mana < MAGIC.firebolt.minMana) return;

      // Мана уже списывалась на клиенте по мере накопления; сервер списывает
      // столько, сколько стоил бы этот заряд, но не больше, чем есть.
      const cost = Math.min(p.mana, (charge / 1) * MAGIC.firebolt.chargeTime * MAGIC.firebolt.manaPerSec);
      p.mana = Math.max(0, p.mana - cost);
      rt.lastCast = this.elapsed;

      const [dx, dy, dz] = unit3(msg.dx, msg.dy, msg.dz);
      // Роллы "крит" на посохе раньше тоже никуда не доходили (только tryHit
      // для меча/лука) — посоха нет в WeaponKind, поэтому kind="sword" ниже
      // просто заглушка: у неё и так нулевая база крита, важны только
      // extraChance/extraMult с конкретного инстанса.
      const staffCrit = rolledCrit(p, staffHand, rt);
      const critM = rollCritMult(
        "sword",
        Math.random,
        false,
        staffCrit.chance,
        staffCrit.mult,
        STAFF_CRIT_MULT,
        attrOf(p, "luc"),
      );
      const boltDmg =
        fireboltDamage(p.level, p, charge) *
        staffMagicTier(p[`${staffHand}Tier`]) *
        rolledDmgMul(p, staffHand, rt) *
        critM *
        this.buffMult(client.sessionId, "dmg");
      const splRad = fireboltSplashRadius(charge);
      const splFrac = MAGIC.firebolt.splashFraction;
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
        splRad,
        boltDmg * splFrac,
        critM > 1,
      );
    });

    this.onMessage(MSG.skill, (client: Client, msg: SkillMsg) => {
      const p = this.state.players.get(client.sessionId);
      const rt = this.rt.get(client.sessionId);
      if (!p || !rt || p.dead || !msg || !(msg.kind in SKILLS2)) return;
      this.castSkill(msg.kind, client.sessionId, p, rt, num(msg.x, NaN), num(msg.z, NaN));
    });

    // Выбор двух умений текущего класса (окно умений на ПК/телефоне/VR).
    this.onMessage(MSG.setSkills, (client: Client, msg: SetSkillsMsg) => {
      const p = this.state.players.get(client.sessionId);
      const rt = this.rt.get(client.sessionId);
      if (!p || !rt || !Array.isArray(msg?.skills)) return;
      const cls = classOf2(p.leftCls as Weapon2 | "", p.rightCls as Weapon2 | "");
      if (!cls) return;
      const allowed = CLASSES2[cls].skills;
      const pick: SkillId[] = [...new Set(msg.skills.filter((k: unknown): k is SkillId => allowed.includes(k as SkillId)))].slice(0, 2);
      if (pick.length === 0) return;
      p.skill1 = pick[0] ?? "";
      p.skill2 = pick[1] ?? "";
      if (rt.token) {
        const all = { ...(store.get(rt.token)?.skills ?? {}) };
        all[cls] = pick;
        store.put(rt.token, { skills: all });
      }
    });

    // Рыбалка v1 (см. план «озеро+рыбалка»): клиент шлёт заброс/подсечку,
    // сервер сам решает по своему таймеру, поймалось ли — клиентский таймер
    // чисто для ощущений, доверять ему нельзя (спам подсечки не должен ловить).
    this.onMessage(MSG.fish, (client: Client, msg: FishMsg) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || p.dead) return;
      const rt = this.rt.get(client.sessionId);
      if (!rt) return;
      if (msg?.act === "cast") {
        // Повторный заброс (сорвалась в мини-игре) — просто начинаем заново.
        if (!ZoneRoom.atShore(p)) return;
        rt.fishAuto = msg.mode === "auto";
        this.fishCast(client, p, rt);
      } else if (msg?.act === "stop") {
        this.fishStop(client, p, rt, false);
      } else if (msg?.act === "reel") {
        const biteAt = rt.fishBiteAt;
        if (biteAt === null || rt.fishAuto) return;
        rt.fishBiteAt = null;
        p.fishing = 0;
        const late = this.elapsed - biteAt;
        // Ручной режим: после поклёвки — мини-игра, на неё до FISH_MANUAL.window с.
        if (late < 0 || late > FISH_MANUAL.window) return;
        this.fishCatch(client, p);
      }
    });

    this.onMessage(MSG.useItem, (client: Client, msg: UseItemMsg) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || p.dead) return;
      const slot = Math.floor(num(msg?.slot, -1));
      if (slot < 0 || slot >= BAG.slots) return;

      const bag = readBag(p);
      const held = bag[slot];
      if (held.item === "scroll_xp" || held.item === "scroll_wind") {
        this.useScroll(client, p, slot);
        return;
      }
      if (!held.item || ITEMS[held.item].heal <= 0) return; // нечего пить
      if (p.hp >= p.maxHp) return; // полное здоровье — не тратим зря
      // Откат зелья — один на всех платформах (POTION_CD), как у ботов.
      const drt = this.rt.get(client.sessionId);
      if (drt) {
        if (this.elapsed - (drt.lastDrinkAt ?? -999) < POTION_CD) return;
        drt.lastDrinkAt = this.elapsed;
      }

      const used = takeOne(bag, slot);
      if (!used) return;
      writeBag(p, bag);
      p.hp = Math.min(
        p.maxHp,
        p.hp + potionHeal(ITEMS[used], p.hp, p.maxHp) * potionPowerFor(p),
      );

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
      if (!lootFreeFor(d, client.sessionId)) return; // чужой трофей, бронь ещё не истекла

      const feetY = p.head.y - PLAYER.eyeHeight;
      const dist = Math.hypot(d.x - p.head.x, d.y - feetY, d.z - p.head.z);
      if (dist > WEAPON_TAKE_REACH) return;

      this.sim.takeDrop(d.id);
      rt.owned.add(weaponKey(w.cls, w.tier)); // право пользоваться этим уровнем
      if (d.instance) {
        rt.weapons.push(d.instance); // конкретный раскатанный инстанс — в склад
        // В руку (не только на склад) — запоминаем, какой именно инстанс там
        // лежит: иначе последующий бросок (MSG.dropWeapon) не находит его по
        // rt.equippedWeaponId и ролит НОВЫЙ случайный лут поверх этого же —
        // дублирование при цикле "подобрал → бросил".
        const hand = msg.hand === "left" || msg.hand === "right" ? msg.hand : null;
        if (hand) rt.equippedWeaponId[hand] = d.instance.id;
      }
      this.announcePickup(p.nick, w.cls, w.tier, d.instance);
      this.clientOf(client.sessionId)?.send(MSG.picked, { item: d.item, count: 1 });
      // Соседям — анимация подбора на модельке (PickUp).
      const relay: ActRelay = { k: "pickup", id: client.sessionId, x: p.head.x, y: p.head.y, z: p.head.z };
      this.broadcast(MSG.act, relay, { except: client });
    });

    // Игрок в VR включил/выключил озвучку чата Twitch у себя.
    this.onMessage(MSG.ttsListen, (client: Client, msg: { on?: number }) => {
      const rt = this.rt.get(client.sessionId);
      if (rt) rt.ttsListen = msg?.on === 1;
    });

    // Меню на руке: действия с оружием на складе.
    this.onMessage(MSG.warehouseAct, (client: Client, msg: WarehouseActMsg) => {
      const p = this.state.players.get(client.sessionId);
      const rt = this.rt.get(client.sessionId);
      if (!p || !rt || p.dead || !msg || typeof msg.id !== "string") return;
      const w = rt.weapons.find((x) => x.id === msg.id);
      if (!w) return;
      if (msg.act === "hand") {
        const hand = w.cls === "shield" ? "left" : msg.hand === "left" ? "left" : "right";
        rt.equippedWeaponId[hand] = w.id;
        rt.owned.add(weaponKey(w.cls, w.tier));
      } else if (msg.act === "scrap") {
        if (w.fav) return; // ★ избранное не разбирается
        const scrap = this.scrapOne({ p, rt }, w);
        if (scrap > 0) {
          const bag = readBag(p);
          addToBag(bag, "scrap", scrap);
          writeBag(p, bag);
        }
      } else if (msg.act === "drop") {
        const idx = rt.weapons.indexOf(w);
        if (idx < 0) return;
        rt.weapons.splice(idx, 1);
        if (rt.equippedWeaponId.left === w.id) rt.equippedWeaponId.left = null;
        if (rt.equippedWeaponId.right === w.id) rt.equippedWeaponId.right = null;
        const edge = WORLD.size / 2 - 2;
        const x = clampAbs(p.head.x + Math.sin(rt.yaw) * 1.1, edge);
        const z = clampAbs(p.head.z + Math.cos(rt.yaw) * 1.1, edge);
        this.sim.dropInstance(w, x, z);
      } else {
        return;
      }
      this.persist(client);
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
      // Несовместимое (правила рук — shared/hands.ts) — вторую руку освобождаем.
      if (!handsValid({ leftCls: l.cls, leftTier: l.tier, rightCls: r.cls, rightTier: r.tier })) {
        l.cls = "";
        l.tier = "";
      }
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
      // Закреплённый за рукой инстанс, которого больше нет ни в руках, ни за
      // спиной (убрали в склад из окна снаряжения / при подборе другого), —
      // снимаем закрепление: иначе он пропадал и из рук, и из сумки.
      const stillHeld = (id: string | null): boolean => {
        const w = id ? rt.weapons.find((x) => x.id === id) : undefined;
        if (!w) return false;
        const same = (c: string, t: string): boolean => c === w.cls && t === w.tier;
        return (
          same(p.leftCls, p.leftTier) ||
          same(p.rightCls, p.rightTier) ||
          rt.stowed.some((st) => same(st.cls, st.tier))
        );
      };
      if (rt.equippedWeaponId.left && !stillHeld(rt.equippedWeaponId.left)) rt.equippedWeaponId.left = null;
      if (rt.equippedWeaponId.right && !stillHeld(rt.equippedWeaponId.right)) rt.equippedWeaponId.right = null;
      // Иначе rec.held в сторе (и веб-инвентарь "!inv") показывал бы то, что
      // было надето на момент последнего MSG.save, а не сейчас — обычная
      // смена оружия в игре персист не триггерила вообще.
      this.persist(client);
    });

    // Голосовой чат: сервер — только «телефонистка». Он пересылает пакет
    // адресату и подписывает отправителя; сам разговор идёт мимо сервера.
    // Время суток переводит только админ — часы общие для всей зоны.
    this.onMessage(MSG.setTime, (client: Client, msg: SetTimeMsg) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !isAdminNick(p.nick) || !msg) return;
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
      if (!p || !isAdminNick(p.nick) || !msg) return;
      if (msg.vignette !== undefined) this.state.comfortVignette = msg.vignette ? 1 : 0;
      if (msg.teleport !== undefined) this.state.teleportMove = msg.teleport ? 1 : 0;
    });

    // Общая подгонка снаряжения — только админ. Применяется всем, переживает
    // перезапуск сервера. Клиент шлёт частичный Loadout (hands/items/belt/hud/light).
    this.onMessage(MSG.setWorldLoadout, (client: Client, msg: WorldLoadoutMsg) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !isAdminNick(p.nick)) return;
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
      if (!p || !isAdminNick(p.nick)) return;
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

    // Заработанное оружие упало на землю (бросок в VR) — кладём его в мир
    // (общее для всех и переживает перезапуск). Снимаем именно тот экипированный
    // инстанс со склада и кладём НА ЗЕМЛЮ ЕГО ЖЕ (как при "drop" со склада) —
    // раньше тут ролился НОВЫЙ случайный лут, а старый инстанс оставался в
    // rt.weapons: один физический бросок давал два предмета (дублирование).
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

      const hand = msg.hand === "left" || msg.hand === "right" ? msg.hand : null;
      const wid = hand ? rt.equippedWeaponId[hand] : null;
      const w = wid ? rt.weapons.find((inst) => inst.id === wid && inst.cls === msg.cls && inst.tier === msg.tier) : undefined;
      if (w) {
        const idx = rt.weapons.indexOf(w);
        rt.weapons.splice(idx, 1);
        if (rt.equippedWeaponId.left === w.id) rt.equippedWeaponId.left = null;
        if (rt.equippedWeaponId.right === w.id) rt.equippedWeaponId.right = null;
        this.sim.dropInstance(w, x, z);
        this.persist(client);
      } else {
        // Подстраховка: не нашли конкретный инстанс (старый клиент без hand,
        // рассинхрон и т.п.) — как раньше, хотя бы не теряем предмет игроку.
        this.sim.dropWeapon(msg.cls, msg.tier, x, z);
      }
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
      if (!this.state.players.has(msg.peer) && !this.spectators.has(msg.peer) && !this.casters.has(msg.peer)) return;
      this.clientOf(msg.peer)?.send(MSG.rtc, {
        peer: client.sessionId,
        kind: msg.kind,
        data: msg.data,
        ...(this.casters.has(client.sessionId) ? { c: 1 as const } : {}),
      });
    });

    // ПК-окно снаряжения: данные о живом герое и действия (заточка, атрибуты,
    // сброс) — тем же кодом, что и страница !inv. Надеть/на лом/на землю идут
    // через MSG.warehouseAct (руки у живого игрока держит клиент).
    this.onMessage(MSG.pcInvOpen, (client: Client) => this.sendPcInv(client));
    // Чат из игры: в Twitch (от аккаунта игры, «🎮 Ник: …») и как обычное сообщение чата — команды работают.
    this.onMessage(MSG.chatSay, (client: Client, msg: { text?: unknown }) => {
      const p = this.state.players.get(client.sessionId);
      const rt = this.rt.get(client.sessionId);
      if (!p || !rt || typeof msg?.text !== "string") return;
      const text = msg.text.replace(/[\r\n]+/g, " ").trim().slice(0, 200);
      if (!text || !p.nick) return;
      if (this.elapsed - (rt.chatSayAt ?? -99) < 1.5) return; // не чаще раза в 1.5 с
      rt.chatSayAt = this.elapsed;
      this.twitch?.say(`🎮 ${p.nick}: ${text}`);
      this.onChat(p.nick, text, true);
    });
    this.onMessage(MSG.pcInvAct, (client: Client, msg: PcInvActMsg) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !msg || typeof msg.id !== "string") return;
      if (msg.act === "title") {
        const tk = `nick:${normNick(p.nick)}`;
        const have = store.get(tk)?.titles ?? [];
        if (msg.id === "" || have.includes(msg.id)) store.put(tk, { title: msg.id });
        this.sendPcInv(client);
        this.sendQuests(client);
        return;
      }
      if (msg.act !== "enchant" && msg.act !== "stat" && msg.act !== "respec" && msg.act !== "skills" && msg.act !== "fav" && msg.act !== "scrapAll" && msg.act !== "gift" && msg.act !== "giftSeen" && !(JEWEL_ACTS as readonly string[]).includes(msg.act) && !(TRADE_ACTS as readonly string[]).includes(msg.act)) return;
      const norm = normNick(p.nick);
      if (!norm) return;
      const r = this.invAct(norm, msg.act, msg.id, Math.max(0, Math.min(99, Math.floor(Number(msg.idx) || 0))), typeof msg.fuel === "string" ? msg.fuel : undefined);
      client.send(MSG.pcInvResult, r);
      this.sendPcInv(client);
    });

    this.onMessage(MSG.questOpen, (client: Client) => this.sendQuests(client));
    this.onMessage(MSG.shopOpen, (client: Client) => this.sendShop(client));
    this.onMessage(MSG.shopBuy, (client: Client, msg: ShopBuyMsg) => this.shopBuy(client, msg));
    this.onMessage(MSG.questAct, (client: Client, msg: QuestActMsg) => this.questAct(client, msg));

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
      // Диагностика зависания картинки: пишем в журнал и НЕ рассылаем дальше —
      // консоль браузер-источника OBS никто не видит, а journalctl мы читаем.
      if (msg.t === "diag") {
        if (typeof msg.text === "string") {
          console.warn(`[spec-diag] ${msg.text.slice(0, 2000)}`);
        }
        return;
      }
      if (msg.t === "free") {
        // Свободная камера: запоминаем владельца, чтобы при закрытии его окна
        // (обрыв соединения) вернуть остальных спектаторов в авто-режим.
        if (msg.on) this.freeCamOwner = client.sessionId;
        else if (this.freeCamOwner === client.sessionId) this.freeCamOwner = "";
        this.broadcast(MSG.specCmd, msg, { except: client });
        return;
      }
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
      } else if (msg.t === "forceEvent") {
        if (this.eventPhase !== "active") {
          this.eventPhase = "idle";
          this.eventPhaseAt = Date.now();
          this.eventForced = true;
        }
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
      } else if (msg.t === "dmgNumbers") {
        this.state.dmgNumbers = msg.on !== 0 ? 1 : 0;
        world.savePult({ dmgNumbers: msg.on !== 0 });
      } else if (msg.t === "musicVol") {
        this.state.specMusicVol = Math.max(0, Math.min(100, Math.round(msg.v)));
        world.savePult({ specMusicVol: this.state.specMusicVol });
      } else if (msg.t === "sfxVol") {
        this.state.specSfxVol = Math.max(0, Math.min(100, Math.round(msg.v)));
        world.savePult({ specSfxVol: this.state.specSfxVol });
      } else if (msg.t === "eventVol") {
        this.state.specEventVol = Math.max(0, Math.min(100, Math.round(msg.v)));
        world.savePult({ specEventVol: this.state.specEventVol });
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

    let hand: "left" | "right" = msg.hand === "left" ? "left" : "right";
    // Оружие «Классов 2.0» — только то, что реально в руках (двуручное — в любой руке).
    if (msg.weapon === "dagger" || msg.weapon === "spear" || msg.weapon === "hammer") {
      if (p[`${hand}Cls`] !== msg.weapon) {
        const other = hand === "left" ? "right" : "left";
        if (p[`${other}Cls`] !== msg.weapon) return;
        hand = other;
      }
    }

    // Темп: чаще, чем позволяет оружие, удары не засчитываются. Скорость
    // атаки (уровень + ловкость + ролл "скорость атаки" на предмете) укорачивает интервал.
    // Темп — ОДНА формула для всех платформ и ботов (heroAttackInterval); запас HIT_RATE_SLACK на сетевой лаг.
    const mul = rolledAtkSpeedMul(p, hand, rt) * this.cryTempo(rt);
    const dualD = isDualPair(p.leftCls, p.rightCls);
    const rate =
      msg.weapon === "throw"
        ? WEAPON_RATE.throw
        : heroAttackInterval(msg.weapon === "arrow" ? "bow" : msg.weapon, p.level, p, mul, dualD) * HIT_RATE_SLACK;
    // Не «промежуток между двумя ударами» (тик сервера и сеть сбивают удары в кучу — у быстрых атак,
    // например два меча под «Боевым кличем», пауза 0.19 с, и до трети ударов отбрасывались), а счёт:
    // удары могут прийти раньше срока на HIT_BUNCH с, но средний темп не выше одного за `rate`.
    const hitNext = (rt.hitNext ??= {});
    const due = hitNext[msg.weapon] ?? -Infinity;
    if (this.elapsed < due - HIT_BUNCH) return;
    const nextDue = Math.max(due, this.elapsed - HIT_BUNCH) + rate;

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
      hitNext[msg.weapon] = nextDue;
      rt.lastPvpAt = this.elapsed;
      trt.lastPvpAt = this.elapsed;
      const pvpCrit = rollCritMult(msg.weapon, Math.random, false, 0, 0, msg.weapon === "sword" ? SWORD_CRIT_MULT : BOW.critMult, attrOf(p, "luc"));
      const pvpDmg =
        weaponDamage(msg.weapon, p.level, p, multIn(p, hand)) *
        PVP.damageMult *
        pvpCrit;
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
    // До ПОВЕРХНОСТИ тела, а не до центра: у крупных мобов (колосс ×5.4) центр
    // был дальше досягаемости меча даже вплотную — почти все удары отбрасывались.
    // Плюс запас на сетевую задержку (позиции героя и моба на сервере отстают).
    const dist =
      Math.hypot(at.x - p.head.x, at.y - p.head.y, at.z - p.head.z) - this.sim.targetRadius(msg.target, msg.id);
    if (dist > WEAPON_REACH[msg.weapon] + HIT_LAG_PAD) return; // слишком далеко — не верим

    rt.lastHit[msg.weapon] = this.elapsed;
    hitNext[msg.weapon] = nextDue;
    if (msg.target === "dummy") {
      this.sim.hitDummy(msg.id, this.heroHitRoll(client.sessionId, p, rt, hand, msg.weapon).dmg);
      return;
    }
    const struck = msg.target === "mob" ? this.sim.mobs.get(msg.id) : undefined;
    if (!struck) return;
    const [dx, dz] = unit2(msg.dx, msg.dz);
    this.heroStrike(client.sessionId, p, rt, hand, msg.weapon, struck, dx || 0, dz || 1, client);
  }

  /** Сумма ролла `sub` на том, что у героя в руках (игрок или бот; лучший из двух рук). */
  private heroRoll(id: string, sub: AffixSub): number {
    const p = this.state.players.get(id);
    const rt = this.rt.get(id) ?? (id.startsWith("bot:") ? this.bots.get(id.slice(4))?.rt : undefined);
    if (!p || !rt) return 0;
    return handsRoll(rolledIn(p, "right", rt)?.affixes, rolledIn(p, "left", rt)?.affixes, sub);
  }

  /**
   * Урон одного удара/выстрела героя — ОДИН расчёт для игрока (любая платформа) и бота:
   * оружие и тир, роллы руки, крит (база профиля, ролл, кинжал в одной руке, своя метка,
   * гарантированный после рывка), два кинжала, баффы, удар из тени.
   */
  private heroHitRoll(
    heroId: string, p: PlayerState, rt: Runtime, hand: "left" | "right", weapon: WeaponKind, mob?: Mob,
  ): { dmg: number; critM: number } {
    // Роллы "крит" на конкретном инстансе (и на Эгиде в другой руке — см. rolledCrit) — любому оружию.
    const rc = rolledCrit(p, hand, rt);
    // Кинжал в одной руке и пустая вторая — крит чаще и больнее (ассасин).
    const soloDagger = weapon === "dagger" && (p.leftCls === "" || p.rightCls === "");
    // «Метка смерти»: удары кинжалом по своей метке критуют чаще.
    const myMark = weapon === "dagger" && !!mob && mob.markT > 0 && mob.markBy === heroId;
    const newWpn = weapon === "dagger" || weapon === "spear" || weapon === "hammer";
    const fullCrit = newWpn ? WEAPONS2[weapon as "dagger"].critMult : weapon === "sword" ? SWORD_CRIT_MULT : BOW.critMult;
    let critM = rollCritMult(
      weapon,
      Math.random,
      false,
      rc.chance + (newWpn ? WEAPONS2[weapon as "dagger"].critBase - BASE_CRIT : 0) + (soloDagger ? DAGGER.soloCrit : 0) + (myMark ? MARK.assassinCrit : 0),
      rc.mult + (soloDagger ? DAGGER.soloCritDmg : 0),
      fullCrit,
      attrOf(p, "luc"),
    );
    // «Теневой рывок»: первый удар после рывка — гарантированный крит.
    if (critM <= 1 && rt.forceCritUntil > this.elapsed && weapon !== "fist") critM = fullCrit;
    rt.forceCritUntil = -999;
    // Пара клинков (два кинжала / два меча) бьёт чаще (DUAL.tempo), но каждый удар чуть слабее.
    const dualPair = (weapon === "dagger" || weapon === "sword") && isDualPair(p.leftCls, p.rightCls);
    const dmg =
      weaponDamage(weapon, p.level, p, multIn(p, hand) * rolledDmgMul(p, hand, rt)) *
      (dualPair ? DUAL.dmg : 1) *
      critM *
      this.buffMult(heroId, "dmg") *
      (isMeleeClass(weapon) ? this.abyssStrikeMul(p, rt) : 1);
    return { dmg, critM };
  }

  /**
   * Удар героя по мобу — ОДИН путь для игрока и бота: урон (heroHitRoll) и все последствия:
   * выпад копья, волна молота, сплэш меча, яд/кровь кинжала, вампиризм, звук и вспышки.
   * `except` — клиент-игрок (у него звук уже сыграл локально). Возвращает «убил».
   */
  private heroStrike(
    heroId: string, p: PlayerState, rt: Runtime, hand: "left" | "right", weapon: WeaponKind,
    struck: Mob, dx: number, dz: number, except?: Client,
  ): boolean {
    const { dmg, critM } = this.heroHitRoll(heroId, p, rt, hand, weapon, struck);
    // Для «!follow»-телохранителя: кого сейчас бьёт цель (фокус-фаер).
    rt.lastHitMobId = struck.id;
    rt.lastHitMobAt = this.elapsed;
    // Позиция цели ДО удара: моб может умереть и исчезнуть, а сплэш считаем вокруг места удара.
    const sx = struck.x;
    const sy = struck.y;
    const sz = struck.z;
    if (critM > 1) this.critFx(sx, sy, sz, heroId);
    // Опыт, счётчик убийств и кил-фид — через общий делёж (sim.mobXpShare / sim.mobKills).
    const killed = !!this.sim.hitMob(struck.id, dmg, dx, dz, heroId, weapon === "arrow", false, false, critM > 1);
    if (weapon === "dagger") this.afterDaggerHit(heroId, p, rt, struck, dmg);
    // Пронзание (ролл лука): стрела насквозь — моб позади цели получает долю урона.
    if (weapon === "arrow" && this.sim.rollPierce(heroId)) this.sim.pierceBehind(struck.id, sx, sz, dx, dz, dmg * BOW.pierceDmg, heroId);
    // Вампиризм (ролл на оружии ближнего боя) — часть нанесённого урона возвращается как HP.
    const vamp = isMeleeClass(weapon) ? heldVamp(p, rt) : 0;
    const vamped = vamp > 0;
    if (isBladeKind(weapon)) {
      this.broadcast(MSG.act, { k: "swordHit", id: heroId, x: sx, y: sy, z: sz } satisfies ActRelay, except ? { except } : undefined);
      if (vamped) this.broadcast(MSG.act, { k: "vampHit", id: heroId, x: sx, y: sy, z: sz } satisfies ActRelay);
    }
    let splash = 0;
    if (weapon === "spear") splash += this.spearPierce(heroId, p, struck, dmg);
    if (weapon === "hammer") splash += this.hammerWave(heroId, p, hand, rt, sx, sy, sz);
    // Меч задевает соседей рядом с целью — небольшой АОЕ.
    if (weapon === "sword") {
      splash += this.sim.splashDamage(sx, sy, sz, COMBAT.swordSplashRadius, dmg * COMBAT.swordSplashFraction, struck.id, heroId);
    }
    if (vamped) vampHeal(p, vamp, dmg, splash);
    return killed;
  }

  /**
   * Копьё: выпад прошивает линию — до WEAPONS2.spear.pierce−1 мобов ЗА целью
   * (в коридоре ~1 м от линии герой→цель, в пределах досягаемости + 2 м)
   * получают долю SPEAR_PIERCE_DMG урона. Всем — полоса выпада. Возвращает урон по этим
   * остальным целям (для вампиризма от сплэша).
   */
  private spearPierce(ownerId: string, p: PlayerState, struck: { id: string; x: number; z: number }, dmg: number): number {
    // Копьё бьёт конусом перед собой (ось — на цель удара): ещё до
    // WEAPONS2.spear.pierce − 1 мобов в секторе ±SPEAR_CONE на длину выпада, ближние первыми.
    const dx = struck.x - p.head.x;
    const dz = struck.z - p.head.z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    const maxAlong = WEAPON_REACH.spear + 1;
    const cands: { id: string; d: number; ax: number; az: number }[] = [];
    for (const m of this.sim.mobs.values()) {
      if (m.dead || m.id === struck.id) continue;
      const vx = m.x - p.head.x;
      const vz = m.z - p.head.z;
      const r = this.sim.targetRadius("mob", m.id);
      const d = Math.hypot(vx, vz);
      if (d - r > maxAlong || d < 1e-3) continue;
      // Крупного моба засчитываем, если в конус попадает хоть край его тела.
      const cos = (vx * ux + vz * uz) / d;
      const slack = Math.asin(Math.min(1, r / Math.max(d, r)));
      if (cos < Math.cos(Math.min(Math.PI / 2, SPEAR_CONE + slack))) continue;
      cands.push({ id: m.id, d, ax: vx / d, az: vz / d });
    }
    cands.sort((a, b) => a.d - b.d);
    const hits = cands.slice(0, WEAPONS2.spear.pierce - 1);
    const side = dmg * SPEAR_PIERCE_DMG;
    for (const c of hits) this.sim.hitMob(c.id, side, c.ax, c.az, ownerId);
    this.broadcast(MSG.act, {
      k: "spearPierce", id: ownerId, x: p.head.x, y: p.head.y, z: p.head.z,
      x2: p.head.x + ux * maxAlong, z2: p.head.z + uz * maxAlong, r: SPEAR_CONE,
    } satisfies ActRelay);
    return side * hits.length;
  }

  /**
   * Молот: каждый удар — магическая волна вокруг цели (урон от ИНТ × тир
   * молота, по всем мобам в радиусе, включая саму цель). Возвращает весь
   * урон волны (для вампиризма от сплэша).
   */
  private hammerWave(ownerId: string, p: PlayerState, hand: "left" | "right", rt: Runtime, x: number, y: number, z: number): number {
    const radius = HAMMER.waveRadius;
    const dmg =
      HAMMER.waveMagic *
      magicPowerFor(p.level, p) *
      multIn(p, hand) *
      rolledDmgMul(p, hand, rt) *
      this.buffMult(ownerId, "dmg");
    let total = 0;
    for (const m of [...this.sim.mobs.values()]) {
      if (m.dead) continue;
      const d = Math.hypot(m.x - x, m.z - z) - this.sim.targetRadius("mob", m.id);
      if (d > radius) continue;
      this.sim.hitMob(m.id, dmg, m.x - x, m.z - z, ownerId, false, false, true);
      total += dmg;
    }
    this.broadcast(MSG.act, { k: "hammerWave", id: ownerId, x, y, z, d: radius } satisfies ActRelay);
    return total;
  }

  /** Вспышка критического выстрела в точке попадания — видят все. */
  private critFx(x: number, y: number, z: number, by: string): void {
    const relay: ActRelay = { k: "crit", id: by, x, y, z };
    this.broadcast(MSG.act, relay);
  }

  /** id игрока/бота в state.players по его состоянию. */
  private idOf(p: PlayerState): string | null {
    for (const [id, st] of this.state.players) if (st === p) return id;
    return null;
  }

  /** Темп от «Боевого клича» (+15%), «Клича сплочения» (+30%) и «Благословения» (+15%) — как на клиенте (Game.atkSpeedAffix). */
  private cryTempo(rt: Runtime): number {
    // 🧪 «Призрак бездны»: после выхода из тени — +ABYSS.haste темпа (клиент считает так же, см. Game.abyssHasteUntil).
    const haste = rt.hasteUntil > this.elapsed ? 1 + ABYSS.haste : 1;
    if (rt.cryUntil <= this.elapsed) return haste;
    return haste * (rt.cryKind === 2 ? 1 + WARCRY.rallyTempo : rt.cryKind === 1 || rt.cryKind === 3 ? 1 + WARCRY.tempo : 1);
  }

  /**
   * 🧪 Удар «из тени»: множитель первого удара после «Призрака бездны» (иначе 1).
   * Удар выводит из тени — дальше ускорение ABYSS.haste на hasteSec.
   */
  private abyssStrikeMul(p: PlayerState, rt: Runtime): number {
    if (!rt.abyssStrike || rt.abyssUntil <= this.elapsed) return 1;
    rt.abyssStrike = false;
    rt.abyssUntil = this.elapsed;
    rt.hasteUntil = this.elapsed + ABYSS.hasteSec;
    return SKILLS2.abyss.dmgMult * skillAttrMul("abyss", p);
  }

  /** 🧪 После удара кинжалом: яд «Чумного клинка» (стаки, на 5 — взрыв вокруг цели). */
  private afterDaggerHit(ownerId: string, p: PlayerState, rt: Runtime, mob: Mob, dmg: number, add = 1): void {
    if (rt.plagueUntil <= this.elapsed || mob.dead) return;
    // Стак яда; на 5 стаках сим сам взрывает яд и заражает соседей (ZoneSim.poisonBurstAt).
    const k = skillAttrMul("plague", p);
    this.sim.poisonMob(mob.id, dmg * PLAGUE.tickFrac * k, dmg * SKILLS2.plague.dmgMult * k, ownerId, add);
  }

  /** Множитель баффа победы над событием (×2 опыт/урон), пока активен. */
  private buffMult(ownerId: string, which: "xp" | "dmg"): number {
    const rt = this.rt.get(ownerId);
    if (!rt) return 1;
    const now = Date.now();
    let m = rt.eventBuffUntil > now ? (which === "xp" ? EVENT.invasion.buffXpMult : EVENT.invasion.buffDmgMult) : 1;
    // «Боевой клич»/«Благословение» — +25% урона.
    if (which === "dmg" && rt.cryUntil > this.elapsed && rt.cryKind !== 2) m *= 1 + WARCRY.dmg;
    // Свиток мудрости — бонус складывается с благословением: ×2 и ×2 → ×3.
    if (which === "xp" && rt.token && (store.get(rt.token)?.scrollXpUntil ?? 0) > now) m += SCROLL.xpMul - 1;
    return m;
  }

  private awardXp(client: Client | undefined, p: PlayerState, amount: number): void {
    const prog = readProgress(p);
    const levels = grantXp(prog, amount);
    writeProgress(p, prog);
    p.maxMana = maxManaFor(p.level, p);
    if (levels <= 0) return;
    // Новый уровень: потолок HP вырос — доливаем разницу плюс бонус.
    const beforeHp = p.maxHp;
    p.maxHp = maxHpFor(p.level, p);
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
    // Дом бота по уровню (может смениться лагерь) пересчитывает tickBot.
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

  /** Титул «Легенда» — всегда у первого места по уровню; сменился лидер — титул переходит. */
  private legendCheck(): void {
    const LEGEND = "Легенда";
    const rows = new Map<string, { level: number; xp: number }>();
    for (const rec of store.entries()) {
      if (rec.token.startsWith("nick:")) rows.set(rec.token, { level: rec.level, xp: rec.xp });
    }
    for (const [id, rt] of this.rt) {
      const p = this.state.players.get(id);
      if (p && rt.token?.startsWith("nick:")) rows.set(rt.token, { level: p.level, xp: p.xp });
    }
    let top = "";
    let best: { level: number; xp: number } | null = null;
    for (const [tk, r] of rows) {
      if (!best || r.level > best.level || (r.level === best.level && r.xp > best.xp)) {
        best = r;
        top = tk;
      }
    }
    if (!top || store.get(top)?.titles?.includes(LEGEND)) return;
    for (const rec of store.entries()) {
      if (!rec.titles?.includes(LEGEND)) continue;
      store.put(rec.token, { titles: rec.titles.filter((t) => t !== LEGEND), ...(rec.title === LEGEND ? { title: "" } : {}) });
    }
    this.grantTitle(top, LEGEND);
  }

  /** Рекорды катакомб: лучший урон героя за один забег (при равенстве — больше побед). */
  private catLeaderboard(limit: number): CatBoardRow[] {
    const rows: CatBoardRow[] = [];
    for (const rec of store.entries()) {
      if (!rec.token.startsWith("nick:") || !rec.catBestDmg || (rec.catSeason ?? 1) !== CATACOMBS.season) continue;
      rows.push({ nick: rec.nick || rec.token.slice(5), dmg: rec.catBestDmg, wins: rec.catWins ?? 0, runs: rec.catRuns ?? 0 });
    }
    return rows.sort((a, b) => b.dmg - a.dmg || b.wins - a.wins).slice(0, limit);
  }

  private broadcastLeaderboard(): void {
    this.legendCheck();
    if (this.clients.length === 0) return;
    this.broadcast(MSG.leaderboard, this.leaderboard(5));
    this.broadcast(MSG.catBoard, this.catLeaderboard(5));
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
  /**
   * Цель рейда (!raid): рейд-босс «Лунный аватар» на горе (shared/raid.ts); без него —
   * Багровый, если он включён (BOSS.enabled). undefined — нет ни того, ни другого.
   */
  private bossMob() {
    const r = this.sim.mobs.get(this.sim.raidBossId);
    if (r) return r;
    for (const m of this.sim.mobs.values()) if (m.kind === "boss") return m;
    return undefined;
  }

  /** Имя цели рейда для чата. */
  private raidName(): string {
    return this.sim.mobs.has(this.sim.raidBossId) ? ELITE_MOBS[RAID.boss].name : "Багровый слизень";
  }

  /**
   * `!raid` / `!boss` — записать героя в отряд на рейд-босса (bossMob). Отряд копится:
   * пока не набралось BOT.raidMinParty, все ждут; как набралось — общий
   * отсчёт BOT.raidDelaySec, затем весь отряд выступает разом. Повторный
   * !raid — выйти (из очереди или из рейда).
   */
  private setRaid(nick: string, norm: string): void {
    if (!this.bots.has(norm) && this.humanRaid(nick, norm)) return;
    const bot = this.bots.get(norm);
    if (!bot) {
      if (this.hintOk(norm)) this.reply(`@${nick} героя нет в мире — сначала !play.`);
      return;
    }
    // Повторный !raid — отмена (из рейда или из очереди).
    if (bot.raiding || this.raidPending.has(norm)) {
      bot.raiding = false;
      this.raidPending.delete(norm);
      if (this.raidPending.size < BOT.raidMinParty) this.raidGoAt = 0;
      this.reply(`@${nick} герой вышел из рейда.`);
      return;
    }
    const boss = this.bossMob();
    if (!boss || boss.dead) {
      this.reply(`@${nick} ${this.raidName()} сейчас повержен — вернётся позже.`);
      return;
    }
    bot.followNorm = null; // рейд важнее !follow
    bot.eventing = false; // и важнее события

    // Бой уже идёт (кто-то в рейде) — новичок присоединяется сразу.
    if ([...this.bots.values()].some((b) => b.raiding)) {
      bot.raiding = true;
      this.reply(`@${nick} присоединился к рейду: ${this.raidName()}!`);
      return;
    }

    this.raidPending.add(norm);
    const k = this.raidPending.size;
    if (k >= BOT.raidMinParty && this.raidGoAt === 0) {
      this.raidGoAt = Date.now() + BOT.raidDelaySec * 1000;
    }
    if (this.raidGoAt > 0) {
      const secs = Math.max(1, Math.ceil((this.raidGoAt - Date.now()) / 1000));
      this.reply(`@${nick} в отряде! Героев: ${k}. Выступаем через ~${secs} с — пишите !raid, идём вместе.`);
    } else {
      const need = BOT.raidMinParty - k;
      this.reply(
        `@${nick} записан в отряд на рейд: ${this.raidName()} (${k}/${BOT.raidMinParty}). ` +
          `Ещё ${need} — и через ${BOT.raidDelaySec} с идём все разом.`,
      );
    }
  }

  /** Отсчёт общего выступления отряда на босса (зовётся из step). */
  private tickRaid(): void {
    // Рейд-босс снова целый, а до того потерял ≥ raidCancelLost HP — рейд отменён у всех.
    const rb = this.sim.mobs.get(this.sim.raidBossId);
    if (rb && !rb.dead) {
      const f = rb.hp / Math.max(1, rb.maxHp);
      this.raidBossLow = Math.min(this.raidBossLow, f);
      if (f >= 1) {
        if (this.raidBossLow <= 1 - BOT.raidCancelLost) this.cancelRaidAll();
        this.raidBossLow = 1;
      }
    } else this.raidBossLow = 1;
    if (this.raidGoAt === 0) return;
    // Босс исчез/повержен, пока копились — отменяем сбор.
    const boss = this.bossMob();
    if (!boss || boss.dead) {
      this.raidPending.clear();
      this.raidGoAt = 0;
      return;
    }
    if (Date.now() < this.raidGoAt) return;

    let gone = 0;
    for (const n of this.raidPending) {
      const bot = this.bots.get(n);
      if (bot) {
        bot.raiding = true;
        bot.followNorm = null;
        gone++;
        continue;
      }
      const h = this.humanClient(n);
      if (h) {
        this.sendRaidGo(h.client, h.rt);
        gone++;
      }
    }
    this.raidPending.clear();
    this.raidGoAt = 0;
    if (gone > 0) {
      this.reply(`Отряд из ${gone} героев пошёл в рейд: ${this.raidName()}! За ним — до победы.`);
    }
  }

  /** Отмена рейда у всех: отряд и очередь распущены (босс восстановил здоровье). */
  private cancelRaidAll(): void {
    let n = this.raidPending.size;
    for (const bot of this.bots.values()) {
      if (!bot.raiding) continue;
      bot.raiding = false;
      n++;
    }
    for (const sid of this.state.players.keys()) {
      const rt = this.rt.get(sid);
      if (sid.startsWith("bot:") || !rt || rt.autoGoKind !== "raid") continue;
      rt.autoGoKind = undefined;
      this.clients.find((c) => c.sessionId === sid)?.send(MSG.autoGo, { kind: "stop", x: 0, z: 0 } satisfies AutoGoMsg);
      n++;
    }
    this.raidPending.clear();
    this.raidGoAt = 0;
    if (n > 0) this.reply(`🌙 ${this.raidName()} восстановил силы — рейд отменён. Собирайте отряд заново: !raid (нужно ${BOT.raidMinParty}).`);
  }

  /** Сколько героев (живых игроков и ботов) сейчас в мире — масштаб события. */
  private heroesInWorld(): number {
    let n = 0;
    this.state.players.forEach((p) => {
      if (!p.dead) n++;
    });
    return Math.max(1, n);
  }

  /** Сколько героев РЯДОМ с точкой (в радиусе r) — масштаб охоты на элиту. */
  private heroesNear(x: number, z: number, r: number): number {
    let n = 0;
    const r2 = r * r;
    this.state.players.forEach((p) => {
      if (p.dead) return;
      const dx = p.head.x - x;
      const dz = p.head.z - z;
      if (dx * dx + dz * dz <= r2) n++;
    });
    return Math.max(1, n);
  }

  /** Выбрать точку нашествия: на поляне, подальше от HUB, угла босса и лагерей. */
  private pickEventSpot(): { x: number; z: number } {
    for (let t = 0; t < 24; t++) {
      const a = Math.random() * Math.PI * 2;
      const r = 22 + Math.random() * 34;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r - 6;
      if (Math.hypot(x - HUB_CENTER.x, z - HUB_CENTER.z) < HUB.safeRadius + 10) continue; // не в лагере
      if (Math.hypot(x - BOSS.home[0], z - BOSS.home[1]) < 30) continue; // не у босса
      if (MOB_CAMPS.some((c) => Math.hypot(x - c.x, z - c.z) < 18)) continue; // не в чужом лагере
      return { x, z };
    }
    return { x: 8, z: -4 };
  }

  private eventSpawnWave(i: number): void {
    const wave = EVENT.invasion.waves[i];
    if (!wave) return;
    const rad = EVENT.invasion.radius;
    // Кучно у центра: смещение к эпицентру (0..0.5 радиуса, с уклоном внутрь).
    const at = (): [number, number] => {
      const a = Math.random() * Math.PI * 2;
      const r = rad * 0.5 * Math.random() * Math.random();
      return [this.eventX + Math.cos(a) * r, this.eventZ + Math.sin(a) * r];
    };
    // Кол-во мобов кратно числу героев в мире (с общим потолком на волну).
    const heroMul = this.heroesInWorld();
    let budget = EVENT.invasion.waveMobCap;
    for (const { type, count } of wave) {
      const def = type in ELITE_MOBS ? ELITE_MOBS[type] : null;
      const n = Math.min(budget, count * heroMul);
      budget -= n;
      for (let k = 0; k < n; k++) {
        const [x, z] = at();
        if (def) {
          this.sim.spawnEventMob(def.kind, x, z, {
            model: def.model, name: def.name, level: def.level, hp: def.hp,
            dmgMul: def.dmgMul, scaleMul: def.scaleMul, xp: def.xp,
            flying: def.flying, rangedArmor: def.rangedArmor,
          });
        } else {
          this.sim.spawnEventMob(type === "spitter" ? "spitter" : "slime", x, z);
        }
      }
    }
  }

  private eventName(): string {
    return this.activeEventKind === 3 ? "Башня" : this.activeEventKind === 2 ? "Охота" : "Нашествие";
  }

  private startEvent(): void {
    const spot = this.pickEventSpot();
    this.eventX = spot.x;
    this.eventZ = spot.z;
    this.eventPhase = "active";
    this.eventForced = false;
    this.eventWave = 0;
    this.eventWaveAt = 0;
    this.eventParticipants.clear();
    this.sim.eventDamagers.clear();
    this.eventZoneCheckAt = 0;
    this.towerRunsStarted = 0;
    // Тип: форс из !goevent, иначе кумулятивный ролл — башня/охота/нашествие
    // (EVENT.towerChance/huntChance, остаток — нашествие).
    if (this.forcedEventKind !== 0) {
      this.activeEventKind = this.forcedEventKind;
    } else {
      const r = Math.random();
      this.activeEventKind = r < EVENT.towerChance ? 3 : r < EVENT.towerChance + EVENT.huntChance ? 2 : 1;
    }
    // Башня временно закрыта (TOWER_OPEN) — вместо неё охота или нашествие.
    if (this.activeEventKind === 3 && !TOWER_OPEN) {
      this.activeEventKind = Math.random() < EVENT.huntChance / (1 - EVENT.towerChance) ? 2 : 1;
    }
    // Выключенный админом вид — заменяем другим (оба выключены — сюда доходит только ручной !goevent).
    if (this.forcedEventKind === 0) {
      if (this.activeEventKind === 1 && this.eventsOff.has("invasion")) this.activeEventKind = 2;
      else if (this.activeEventKind === 2 && this.eventsOff.has("hunt")) this.activeEventKind = 1;
    }
    this.forcedEventKind = 0;
    this.state.eventKind = this.activeEventKind;
    this.state.eventX = spot.x;
    this.state.eventZ = spot.z;

    if (this.activeEventKind === 3) {
      // Башня: не бой на месте, а открытое окно очереди — !event ставит героя
      // в неё, попытки идут по одной в отдельной TowerRoom (см. tickEvents).
      // Маячок/тикер должны указывать на декоративную башню на карте, а не
      // на случайную pickEventSpot() — там реально ничего не происходит.
      this.eventX = TOWER_PROP_POS.x;
      this.eventZ = TOWER_PROP_POS.z;
      this.state.eventX = TOWER_PROP_POS.x;
      this.state.eventZ = TOWER_PROP_POS.z;
      this.eventPhaseAt = Date.now() + EVENT.tower.hardTimeout * 1000;
      this.towerQueue.length = 0;
      this.towerDone.clear();
      this.towerApproaching = false;
      this.towerQueueOpenUntil = Date.now() + EVENT.tower.queueIdleClose * 1000;
      this.state.eventLeft = 0;
      this.broadcast(MSG.worldEvent, {
        phase: "start", name: "Башня", x: TOWER_PROP_POS.x, z: TOWER_PROP_POS.z,
      } satisfies WorldEventMsg);
      return;
    }

    if (this.activeEventKind === 2) {
      // Охота: один именной бугай, жирнее и злее от числа героев в мире.
      const e = ELITE_MOBS[EVENT.eliteHunt.eliteKey];
      const eh = EVENT.eliteHunt;
      // Масштаб — по героям РЯДОМ с точкой, а не по всему миру: иначе десятки
      // ботов-зевак по всей карте раздували стража до неубиваемого.
      const heroes = this.heroesNear(spot.x, spot.z, eh.scaleRadius);
      const hpMul = Math.min(eh.hpCap, 1 + (heroes - 1) * eh.hpPerHero);
      const dmgMul = Math.min(eh.dmgCap, 1 + (heroes - 1) * eh.dmgPerHero);
      this.eventPhaseAt = Date.now() + eh.hardTimeout * 1000;
      this.huntBossId = this.sim.spawnEventMob(e.kind, spot.x, spot.z, {
        ...eliteMobOpts(e),
        hp: Math.round(e.hp * hpMul),
        dmgMul: e.dmgMul * dmgMul,
      });
      this.huntDmgBase = MOB.attackDamage * e.dmgMul * dmgMul;
      const t0 = Date.now();
      this.huntAddAt = t0 + eh.addGap * 1000;
      this.huntNovaAt = t0 + eh.novaGap * 1000;
      this.huntLobAt = t0 + eh.lobGap * 1000;
      this.huntBreathAt = t0 + eh.breathGap * 1000;
      this.huntNovaFireAt = 0;
      this.huntLobFireAt = 0;
      this.huntBreathFireAt = 0;
      this.state.eventLeft = 1;
      this.broadcast(MSG.worldEvent, {
        phase: "start", name: "Охота", x: spot.x, z: spot.z,
      } satisfies WorldEventMsg);
      return;
    }

    // Нашествие: волны.
    this.eventPhaseAt = Date.now() + EVENT.hardTimeout * 1000;
    this.eventSpawnWave(0);
    this.eventWave = 1;
    this.state.eventLeft = Math.min(255, this.sim.eventMobsLeft());
    this.broadcast(MSG.worldEvent, {
      phase: "start", name: "Нашествие", x: spot.x, z: spot.z,
    } satisfies WorldEventMsg);
  }

  private endEvent(win: boolean): void {
    const tower = this.activeEventKind === 3;
    const hunt = this.activeEventKind === 2;
    // Башня не бьётся на месте — награда там персональная, за каждый забег
    // отдельно (см. onTowerRunDone), а не общая на всех при закрытии окна.
    let winLoot: LootItem[] | undefined;
    if (win && !tower) {
      const potions = hunt
        ? EVENT.eliteHunt.rewardPotions
        : Math.min(
            EVENT.invasion.rewardPotionCap,
            EVENT.invasion.rewardPotions * this.heroesInWorld(),
          );
      this.sim.dropPotions(this.eventX, this.eventZ, potions);
      winLoot = potions > 0 ? [{ id: "potion", count: potions }] : [];

      if (hunt) {
        // Охота — гарантированная легендарка случайного класса.
        // С шансом DROP_CHANCE.huntAegis — Эгида вместо случайного класса.
        const aegis = Math.random() < DROP_CHANCE.huntAegis;
        const cls = aegis ? "shield" : LEGEND_DROP[Math.floor(Math.random() * LEGEND_DROP.length)];
        const dropped = this.sim.dropWeapon(cls, "legendary", this.eventX, this.eventZ, aegis);
        if (dropped) winLoot.push({ id: dropped, count: 1, ...(aegis ? { aegis: true } : {}) });
      } else if (Math.random() < EVENT.invasion.rewardLegendaryChance) {
        const cls = LEGEND_DROP[Math.floor(Math.random() * LEGEND_DROP.length)];
        const dropped = this.sim.dropWeapon(cls, "legendary", this.eventX, this.eventZ);
        if (dropped) winLoot.push({ id: dropped, count: 1 });
      }

      // Бафф всем, кто бил мобов события: ×2 опыт и урон.
      const minutes = hunt ? EVENT.eliteHunt.buffMinutes : EVENT.invasion.buffMinutes;
      const until = Date.now() + minutes * 60_000;
      let n = 0;
      // Получают только участники: были в зоне события или били его мобов.
      const recipients = new Set<string>([...this.eventParticipants, ...this.sim.eventDamagers]);
      for (const owner of recipients) {
        const rt = this.rt.get(owner);
        if (rt && this.state.players.has(owner)) {
          rt.eventBuffUntil = until;
          if (rt.token) store.put(rt.token, { eventBuffUntil: until });
          n++;
        }
      }
      if (n > 0) {
        this.reply(
          (hunt ? `${ELITE_MOBS[EVENT.eliteHunt.eliteKey].name} повержен! ` : "Нашествие отражено! ") +
            `${n} героям — благословение на ${minutes} мин: ` +
            `×${EVENT.invasion.buffXpMult} опыта и ×${EVENT.invasion.buffDmgMult} урона.`,
        );
      }
    }
    this.huntBossId = "";
    this.huntNovaFireAt = 0;
    this.huntLobFireAt = 0;
    this.sim.eventDamagers.clear();
    this.eventParticipants.clear();
    this.sim.clearEventMobs();
    this.eventPhase = "cooldown";
    this.eventPhaseAt = Date.now() + EVENT.cooldown * 1000;
    this.state.eventKind = 0;
    this.state.eventLeft = 0;
    this.broadcast(MSG.worldEvent, {
      phase: win ? "win" : "end", name: this.eventName(), x: this.eventX, z: this.eventZ,
      loot: win ? winLoot : undefined,
    } satisfies WorldEventMsg);
  }

  /**
   * Умения Огнекрылого дракона (охота на элиту): «Удар крыльями» (волна вокруг
   * с оглушением и отбросом), «Огненное дыхание» (конус к герою) и «Огненный
   * дождь» (метки под несколькими героями). Все с телеграфом — от них можно
   * уйти; в ярости идут чаще (enrageGapMul). Урон — через hurtPlayer.
   */
  private tickHuntAttacks(
    now: number,
    boss: { x: number; y: number; z: number; raging: boolean },
    eh: typeof EVENT.eliteHunt,
  ): void {
    const gapK = boss.raging ? eh.enrageGapMul : 1;
    const hurtAround = (
      cx: number,
      cz: number,
      r: number,
      dmg: number,
      proj: boolean,
      extra: { stunSec?: number; knockback?: number } = {},
    ): void => {
      this.state.players.forEach((p, id) => {
        if (p.dead) return;
        if (Math.hypot(p.head.x - cx, p.head.z - cz) > r) return;
        this.hurtPlayer({
          target: id, dmg, fromX: cx, fromZ: cz, projectile: proj, byMob: this.huntBossId, ...extra,
        });
      });
    };
    const heroesNear = (r: number): { x: number; z: number }[] => {
      const out: { x: number; z: number }[] = [];
      this.state.players.forEach((p) => {
        if (!p.dead && Math.hypot(p.head.x - boss.x, p.head.z - boss.z) < r) out.push({ x: p.head.x, z: p.head.z });
      });
      return out;
    };
    const gy = terrainHeight(boss.x, boss.z);

    // --- Удар крыльями: купол-телеграф, потом волна с оглушением и отбросом ---
    if (now >= this.huntNovaAt && this.huntBreathFireAt === 0) {
      this.huntNovaAt = now + eh.novaGap * gapK * 1000;
      this.huntNovaFireAt = now + eh.novaDelay * 1000;
      this.addDanger(boss.x, boss.z, eh.novaRadius + 1, eh.novaDelay + 0.2);
      this.broadcast(MSG.act, {
        k: "stunBash", id: this.huntBossId, x: boss.x, y: gy, z: boss.z, d: eh.novaDelay,
      } satisfies ActRelay);
    }
    if (this.huntNovaFireAt > 0 && now >= this.huntNovaFireAt) {
      this.huntNovaFireAt = 0;
      hurtAround(boss.x, boss.z, eh.novaRadius, this.huntDmgBase * eh.novaDmgMul, false, {
        stunSec: eh.novaStun,
        knockback: eh.novaKnock,
      });
      this.broadcast(MSG.act, { k: "stunHit", id: this.huntBossId, x: boss.x, y: gy, z: boss.z } satisfies ActRelay);
    }

    // --- Огненное дыхание: конус к случайному герою рядом ---
    if (now >= this.huntBreathAt && this.huntNovaFireAt === 0) {
      const near = heroesNear(eh.breathLen + 4);
      if (near.length > 0) {
        const t = near[(Math.random() * near.length) | 0];
        const dl = Math.hypot(t.x - boss.x, t.z - boss.z) || 1;
        this.huntBreathDx = (t.x - boss.x) / dl;
        this.huntBreathDz = (t.z - boss.z) / dl;
        this.huntBreathAt = now + eh.breathGap * gapK * 1000;
        this.huntBreathFireAt = now + eh.breathDelay * 1000;
        // Конус дыхания — цепочкой кругов вдоль оси (бот выбегает вбок).
        for (const k of [0.25, 0.5, 0.75, 0.95]) {
          const dd = eh.breathLen * k;
          this.addDanger(boss.x + this.huntBreathDx * dd, boss.z + this.huntBreathDz * dd, Math.tan(eh.breathHalf) * dd + 1.4, eh.breathDelay + 0.3);
        }
        this.broadcast(MSG.act, {
          k: "breathMark", id: this.huntBossId, x: boss.x, y: gy, z: boss.z, d: eh.breathDelay,
          x2: boss.x + this.huntBreathDx * eh.breathLen, z2: boss.z + this.huntBreathDz * eh.breathLen,
        } satisfies ActRelay);
      } else {
        this.huntBreathAt = now + 1500;
      }
    }
    if (this.huntBreathFireAt > 0 && now >= this.huntBreathFireAt) {
      this.huntBreathFireAt = 0;
      const cosHalf = Math.cos(eh.breathHalf);
      this.state.players.forEach((p, id) => {
        if (p.dead) return;
        const vx = p.head.x - boss.x;
        const vz = p.head.z - boss.z;
        const d = Math.hypot(vx, vz);
        if (d > eh.breathLen || d < 0.01) return;
        if ((vx * this.huntBreathDx + vz * this.huntBreathDz) / d < cosHalf) return;
        this.hurtPlayer({
          target: id, dmg: this.huntDmgBase * eh.breathDmgMul, fromX: boss.x, fromZ: boss.z,
          projectile: true, byMob: this.huntBossId,
        });
      });
      this.broadcast(MSG.act, {
        k: "breathHit", id: this.huntBossId, x: boss.x, y: gy, z: boss.z, d: 0.6,
        x2: boss.x + this.huntBreathDx * eh.breathLen, z2: boss.z + this.huntBreathDz * eh.breathLen,
      } satisfies ActRelay);
    }

    // --- Огненный дождь: метки под несколькими героями ---
    if (now >= this.huntLobAt) {
      const near = heroesNear(28);
      if (near.length > 0) {
        for (let i = near.length - 1; i > 0; i--) {
          const j = (Math.random() * (i + 1)) | 0;
          [near[i], near[j]] = [near[j], near[i]];
        }
        this.huntLobs = near.slice(0, eh.lobTargets);
        this.huntLobAt = now + eh.lobGap * gapK * 1000;
        this.huntLobFireAt = now + eh.lobDelay * 1000;
        for (const t of this.huntLobs) {
          this.addDanger(t.x, t.z, eh.lobRadius + 0.8, eh.lobDelay + 0.2);
          this.broadcast(MSG.act, {
            k: "arrowRain", id: this.huntBossId,
            x: t.x, y: terrainHeight(t.x, t.z) + PLAYER.eyeHeight, z: t.z, d: eh.lobDelay,
          } satisfies ActRelay);
        }
      } else {
        this.huntLobAt = now + 2000; // некого бить — ждём
      }
    }
    if (this.huntLobFireAt > 0 && now >= this.huntLobFireAt) {
      this.huntLobFireAt = 0;
      for (const t of this.huntLobs) {
        const y = terrainHeight(t.x, t.z) + 0.5;
        hurtAround(t.x, t.z, eh.lobRadius, this.huntDmgBase * eh.lobDmgMul, true);
        this.broadcast(MSG.act, { k: "stunHit", id: this.huntBossId, x: t.x, y, z: t.z } satisfies ActRelay);
      }
      this.huntLobs = [];
    }
  }

  private tickEvents(): void {
    const now = Date.now();
    // Камера спектатора зафиксирована на герое башни — периодически меняем
    // ТОЛЬКО вид (из глаз / орбита), сам субъект не трогаем, пока не выйдет.
    if (this.towerCamHeroId && now >= this.towerCamAt) {
      this.towerCamAt = now + 9000;
      this.towerCamEye = !this.towerCamEye;
      const shot = (this.towerCamEye ? "eyePlayer:" : "orbitPlayer:") + this.towerCamHeroId;
      this.broadcast(MSG.specCmd, { t: "cam", shot } satisfies SpecCmd);
    }
    if (this.eventPhase === "idle") {
      if (this.eventPhaseAt === 0) {
        // первый запуск таймера
        this.eventPhaseAt =
          now + (EVENT.idleMin + Math.random() * (EVENT.idleMax - EVENT.idleMin)) * 1000;
        return;
      }
      // не начинаем событие, пока в мире вообще никого (ни игроков, ни ботов) —
      // кроме ручного запуска (eventForced).
      // Катакомбы идут (сбор или забег) — мировое событие ждёт.
      if (this.cat.busy && !this.eventForced) return;
      // Нашествие и охота выключены админом — сами не начинаются (ручной !goevent — можно).
      if (!this.eventForced && this.eventsOff.has("invasion") && this.eventsOff.has("hunt")) return;
      if (now >= this.eventPhaseAt && (this.eventForced || this.state.players.size > 0)) {
        this.startEvent();
      }
      return;
    }
    if (this.eventPhase === "active") {
      const left = this.sim.eventMobsLeft();
      this.state.eventLeft = Math.min(255, left);
      // Участие: побывал в зоне события (раз в секунду) — засчитывается наравне с ударом по мобу события.
      if (this.activeEventKind !== 3 && now >= this.eventZoneCheckAt) {
        this.eventZoneCheckAt = now + 1000;
        const zr = BOT.zoneRadius;
        this.state.players.forEach((pl, pid) => {
          if (pl.dead || this.eventParticipants.has(pid)) return;
          if (Math.hypot(pl.head.x - this.eventX, pl.head.z - this.eventZ) < zr) this.eventParticipants.add(pid);
        });
      }
      if (this.activeEventKind === 2) {
        // Охота: победа = смерть самого владыки (миньоны не в счёт).
        const boss = this.sim.mobs.get(this.huntBossId);
        if (!boss || boss.dead) {
          this.endEvent(true);
          return;
        }
        const eh = EVENT.eliteHunt;
        // Ярость ниже порога HP: быстрее двигается (Mob.enraged) + бьёт сильнее.
        if (!boss.raging && boss.hp / boss.maxHp < eh.enrageAt) {
          boss.raging = true;
          this.reply(`${boss.eliteName} впадает в ярость!`);
        }
        // Периодический призыв миньонов — «разберись с мелочью».
        if (now >= this.huntAddAt) {
          this.huntAddAt = now + eh.addGap * (boss.raging ? eh.enrageGapMul : 1) * 1000;
          for (let i = 0; i < eh.addCount; i++) {
            const adef = ELITE_MOBS[eh.addTypes[Math.floor(Math.random() * eh.addTypes.length)]];
            const a = Math.random() * Math.PI * 2;
            const r = 2 + Math.random() * 3;
            // Со ВСЕМИ механиками вида (рывок, вампиризм, уворот…), не голые цифры.
            this.sim.spawnEventMob(adef.kind, boss.x + Math.cos(a) * r, boss.z + Math.sin(a) * r, eliteMobOpts(adef));
          }
        }
        this.tickHuntAttacks(now, boss, eh);
      } else if (this.activeEventKind === 3) {
        // Башня: пока не идёт попытка — вынимаем следующего из очереди; если
        // очередь пуста и давно не было новых записей — закрываем окно.
        if (!this.towerRuns.running && !this.towerApproaching) {
          const heroId = this.towerQueue.shift();
          if (heroId) this.startTowerRun(heroId);
          else if (now >= this.towerQueueOpenUntil) {
            // «Башню прошли» — только если в неё хоть кто-то заходил; иначе окно просто закрылось.
            this.endEvent(this.towerRunsStarted > 0);
            return;
          }
        }
      } else if (left === 0) {
        // Нашествие: волна зачищена — следующая, либо победа.
        if (this.eventWave >= EVENT.invasion.waves.length) {
          this.endEvent(true);
          return;
        }
        if (this.eventWaveAt === 0) {
          this.eventWaveAt = now + EVENT.invasion.waveGap * 1000;
        } else if (now >= this.eventWaveAt) {
          this.eventSpawnWave(this.eventWave);
          this.eventWave++;
          this.eventWaveAt = 0;
        }
      }
      if (now >= this.eventPhaseAt) this.endEvent(false); // не успели — событие утихло
      return;
    }
    // cooldown
    if (now >= this.eventPhaseAt) {
      this.eventPhase = "idle";
      this.eventPhaseAt =
        now + (EVENT.idleMin + Math.random() * (EVENT.idleMax - EVENT.idleMin)) * 1000;
    }
  }


  /** `!event` — послать бота зрителя на активное событие: чистить, собирать
   *  лут, по окончании события вернуться домой. */
  /** Человек-герой (не бот) по нику: клиент, его рантайм. null — такого героя в мире нет. */
  private humanClient(norm: string): { client: Client; rt: Runtime; id: string } | null {
    let id: string | undefined;
    for (const [sid, pl] of this.state.players) {
      if (!sid.startsWith("bot:") && normNick(pl.nick) === norm) id = sid;
    }
    if (!id) return null;
    const client = [...this.clients].find((c) => c.sessionId === id);
    const rt = this.rt.get(id);
    return client && rt ? { client, rt, id } : null;
  }

  /** Команда «идти на рейд» человеку: автобой поведёт героя к арене. */
  private sendRaidGo(client: Client, rt: Runtime): void {
    rt.autoGoKind = "raid";
    client.send(MSG.autoGo, { kind: "raid", x: RAID.x, z: RAID.z } satisfies AutoGoMsg);
  }

  /**
   * `!raid` для человека-героя: та же очередь отряда, что и у ботов. Набрался отряд —
   * отсчёт, и всем записанным людям приходит команда идти (см. tickRaid). Если рейд уже
   * идёт — присоединяется сразу. Повтор — выход из очереди или из рейда.
   */
  private humanRaid(nick: string, norm: string): boolean {
    const h = this.humanClient(norm);
    if (!h) return false;
    if (h.rt.autoGoKind === "raid" || this.raidPending.has(norm)) {
      h.rt.autoGoKind = undefined;
      h.client.send(MSG.autoGo, { kind: "stop", x: 0, z: 0 } satisfies AutoGoMsg);
      this.raidPending.delete(norm);
      if (this.raidPending.size < BOT.raidMinParty) this.raidGoAt = 0;
      this.reply(`@${nick} герой вышел из рейда.`);
      return true;
    }
    const boss = this.bossMob();
    if (!boss || boss.dead) {
      this.reply(`@${nick} ${this.raidName()} сейчас повержен — вернётся позже.`);
      return true;
    }
    h.rt.autoGoKind = undefined;
    // Бой уже идёт (кто-то в рейде) — присоединяется сразу.
    if ([...this.bots.values()].some((b) => b.raiding) || [...this.rt.values()].some((r) => r.autoGoKind === "raid")) {
      this.sendRaidGo(h.client, h.rt);
      this.reply(`@${nick} присоединился к рейду: ${this.raidName()}!`);
      return true;
    }
    this.raidPending.add(norm);
    const k = this.raidPending.size;
    if (k >= BOT.raidMinParty && this.raidGoAt === 0) {
      this.raidGoAt = Date.now() + BOT.raidDelaySec * 1000;
    }
    if (this.raidGoAt > 0) {
      const secs = Math.max(1, Math.ceil((this.raidGoAt - Date.now()) / 1000));
      this.reply(`@${nick} в отряде! Героев: ${k}. Выступаем через ~${secs} с — пишите !raid, идём вместе.`);
    } else {
      const need = BOT.raidMinParty - k;
      this.reply(
        `@${nick} записан в отряд на рейд: ${this.raidName()} (${k}/${BOT.raidMinParty}). ` +
          `Ещё ${need} — и через ${BOT.raidDelaySec} с идём все разом.`,
      );
    }
    return true;
  }

  /**
   * Осколки големов в катакомбах убираем вместе с мобами зала, когда открывается проход:
   * они не в catMobs, иначе висели бы дальше. Пыль — как у других мобов катакомб.
   * Осколок — моб с общей группой (`splitGroup`): kind у него не `shard`, а вид голема (slime и т.п.).
   */
  private dismissCatShards(): void {
    for (const [id, m] of this.sim.mobs) {
      if (!(m.kind === "shard" || m.splitGroup) || !inCatRegion(m.x, m.z)) continue;
      if (!m.dead) this.broadcast(MSG.act, { k: "catDust", id: "", x: m.x, y: m.y, z: m.z, r: MOB.bodyRadius * m.scale } satisfies ActRelay);
      this.sim.mobs.delete(id);
      this.sim.catMobs.delete(id);
    }
  }

  /**
   * `!event` / `!raid` для человека-героя (не бота): сервер не двигает его персонажем, поэтому
   * шлёт клиенту команду «идти» — автобой ведёт героя к месту и бьёт там мобов. Повтор — отмена.
   * true — команда обработана (человек найден), false — такого героя в мире нет.
   */
  private humanGo(nick: string, norm: string, kind: "event" | "raid"): boolean {
    let id: string | undefined;
    for (const [sid, pl] of this.state.players) {
      if (!sid.startsWith("bot:") && normNick(pl.nick) === norm) id = sid;
    }
    if (!id) return false;
    const client = [...this.clients].find((c) => c.sessionId === id);
    const rt = this.rt.get(id);
    if (!client || !rt) return false;
    if (rt.autoGoKind === kind) {
      rt.autoGoKind = undefined;
      client.send(MSG.autoGo, { kind: "stop", x: 0, z: 0 } satisfies AutoGoMsg);
      this.reply(`@${nick} автобой отменён.`);
      return true;
    }
    let x: number;
    let z: number;
    if (kind === "raid") {
      const boss = this.bossMob();
      if (!boss || boss.dead) {
        this.reply(`@${nick} ${this.raidName()} сейчас повержен — вернётся позже.`);
        return true;
      }
      x = RAID.x;
      z = RAID.z;
    } else {
      if (this.eventPhase !== "active") {
        this.reply(`@${nick} сейчас в мире событий нет.`);
        return true;
      }
      x = this.eventX;
      z = this.eventZ;
    }
    rt.autoGoKind = kind;
    client.send(MSG.autoGo, { kind, x, z } satisfies AutoGoMsg);
    this.reply(`@${nick} ${kind === "raid" ? "идёт на рейд" : "идёт на событие"} — автобой поведёт героя сам (повтор команды — отмена).`);
    return true;
  }

  private sendBotToEvent(nick: string, norm: string): void {
    if (!this.bots.has(norm) && this.humanGo(nick, norm, "event")) return;
    const bot = this.bots.get(norm);
    if (!bot) {
      if (this.hintOk(norm)) this.reply(`@${nick} героя нет в мире — сначала !play.`);
      return;
    }
    if (this.eventPhase !== "active") {
      this.reply(`@${nick} сейчас в мире событий нет.`);
      return;
    }
    if (bot.eventing) {
      this.reply(`@${nick} герой уже там.`);
      return;
    }
    bot.eventing = true;
    bot.eventDoneAt = 0;
    bot.raiding = false;
    bot.followNorm = null;
    this.reply(
      `@${nick} герой выдвинулся на ${this.activeEventKind === 2 ? "охоту" : "нашествие"} — зачистит и вернётся.`,
    );
  }

  /** `!event` при активной башне — встать в очередь на попытку (не спатиальный джойн). */
  private joinTowerQueue(nick: string, norm: string): void {
    if (!TOWER_OPEN) {
      if (this.hintOk(norm)) this.reply(`@${nick} башня временно закрыта.`);
      return;
    }
    const bot = this.bots.get(norm);
    if (!bot) {
      if (this.hintOk(norm)) this.reply(`@${nick} героя нет в мире — сначала !play.`);
      return;
    }
    if (this.towerQueue.includes(bot.id)) {
      this.reply(`@${nick} герой уже в очереди.`);
      return;
    }
    if (this.towerDone.has(bot.id)) {
      this.reply(`@${nick} герой уже отходил в башню в этот раз — ждите следующего события.`);
      return;
    }
    this.towerQueue.push(bot.id);
    this.towerDone.add(bot.id); // бронируем место сразу — не даём встать второй раз, пока ждёт
    this.towerQueueOpenUntil = Date.now() + EVENT.tower.queueIdleClose * 1000;
    this.reply(`@${nick} герой встал в очередь на башню (№${this.towerQueue.length}).`);
  }

  /** Поднять TowerRoom для очередного героя из очереди башни. */
  private startTowerRun(heroId: string): void {
    this.towerRunsStarted++;
    if (!this.state.players.has(heroId)) return;
    // Пока камера летит к башне, забег ещё не начат (towerRuns.running=false) —
    // без этого флага tickEvents успевал вынуть из очереди следующего героя,
    // его запуск падал («попытка уже идёт») и он терялся из очереди.
    this.towerApproaching = true;
    // Камера сперва летит К декоративной башне на поляне (TOWER_PROP_POS) —
    // герой ещё виден в мире, ничего не телепортировано. Сам забег (и его
    // жёсткая привязка камеры к герою) стартует чуть погодя, см. ниже.
    this.broadcast(MSG.specCmd, { t: "cam", shot: "towerApproach" } satisfies SpecCmd);
    this.clock.setTimeout(() => this.enterTowerRun(heroId), EVENT.tower.approachSec * 1000);
  }

  /** Собственно начало забега — вызывается после короткого подлёта камеры к башне. */
  private enterTowerRun(heroId: string): void {
    this.towerApproaching = false;
    const p = this.state.players.get(heroId);
    const bot = heroId.startsWith("bot:") ? this.bots.get(heroId.slice(4)) : undefined;
    if (!p || !bot) {
      // Герой вышел из мира, пока камера летела к башне, — не оставляем
      // спектатора висеть на "подлёте" навсегда.
      this.broadcast(MSG.specCmd, { t: "cam", shot: "auto" } satisfies SpecCmd);
      return;
    }
    const nick = p.nick;
    // Прячем тело за картой и глушим обычный AI (tickBot) на время забега —
    // иначе герой одновременно дерётся в основном мире и лезет по этажам.
    bot.inTower = true;
    p.head.x = TOWER_HIDE.x;
    p.head.z = TOWER_HIDE.z;
    p.head.y = TOWER_HIDE.y;
    // Сразу выставляем этаж 1 — не ждём первого снимка (он придёт тиком
    // позже), клиент строит арену сразу по фронту towerFloor: 0 -> 1.
    p.towerFloor = 1;
    p.towerMobsLeft = 0;
    p.towerMobsTotal = 0;
    p.towerBossActive = 0;
    p.towerBossHpFrac = 0;
    // ХП героя в башне — та же полоска, что и у персонажа (p.hp/p.maxHp
    // напрямую, не отдельное поле): подхватит существующий UI "цель".
    p.maxHp = TOWER.hero.maxHp;
    p.hp = TOWER.hero.maxHp;
    // Камера спектатора — жёстко на герое до конца забега (только смена вида
    // из глаз/орбиты, не переключение на другого): иначе авто-режиссёр тут
    // же уводит взгляд на кого-то ещё, кто реально дерётся в мире. Сама смена
    // вида — в tickEvents() (см. towerCamHeroId), не одноразово здесь.
    this.towerCamHeroId = heroId;
    this.towerCamEye = true;
    this.towerCamAt = 0; // сработает следующим тиком
    // Роллы оружия героя — теми же функциями, что считают бой на поляне.
    const trt = this.rt.get(heroId);
    const trc = trt ? rolledCrit(p, "right", trt) : { chance: 0, mult: 0 };
    const towerRolled = {
      dmgMul: trt ? rolledDmgMul(p, "right", trt) : 1,
      atkSpeedMul: trt ? rolledAtkSpeedMul(p, "right", trt) : 1,
      critChance: trc.chance,
      critMult: trc.mult,
      vamp: trt ? heldVamp(p, trt) : 0,
      blockChance: blockChanceOf(p, trt),
      reflect: shieldReflect(shieldOf(p, trt)?.inst),
      physDef: shieldPhysDef(shieldOf(p, trt)?.inst),
      magDef: shieldMagDef(shieldOf(p, trt)?.inst),
      aegisHeal: isAegis(shieldOf(p, trt)?.inst) ? SHIELD.aegisHealFrac : 0,
      warriorMul: 1,
    };
    this.towerRuns
      .start(
        heroId,
        nick,
        {
          level: p.level,
          str: p.str,
          agi: p.agi,
          int: p.int,
          con: p.con,
          luc: attrOf(p, "luc"),
          wis: p.wis,
          leftCls: p.leftCls,
          leftTier: p.leftTier,
          rightCls: p.rightCls,
          rightTier: p.rightTier,
          rolled: towerRolled,
        },
        (r) => this.onTowerRunDone(heroId, nick, r),
        () => {}, // этажи в чат Twitch не пишем — они видны на трансляции
        (s) => this.onTowerSnapshot(heroId, s),
      )
      .catch((e) => {
        console.warn("[tower] не удалось создать комнату:", (e as Error).message);
        // Иначе провал тихо виснет: очередь уже сдвинута, а герой как будто
        // "зашёл и пропал" — без этого сообщения не отличить от бага.
        bot.inTower = false;
        // Вернуть тело из-за карты к башне на поляне — иначе герой так и висел спрятанным.
        p.head.x = TOWER_PROP_POS.x + 6;
        p.head.z = TOWER_PROP_POS.z + 6;
        p.head.y = terrainHeight(p.head.x, p.head.z) + PLAYER.eyeHeight;
        p.towerFloor = 0;
        p.maxHp = maxHpFor(p.level, p);
        p.hp = p.maxHp;
        this.towerCamHeroId = "";
        this.broadcast(MSG.specCmd, { t: "cam", shot: "auto" } satisfies SpecCmd);
        this.reply(`${nick}: башня не запустилась (${(e as Error).message}).`);
      });
    this.reply(`${nick} заходит в Охотничью башню!`);
  }

  /**
   * Тик боя в TowerRoom — зеркалим сводку для визуала. Позиция и ХП героя
   * идут ПРЯМО в стандартные поля PlayerState (head.x/z, hp/maxHp) — герой
   * реально бегает по арене (TOWER_HIDE + локальные координаты) той же
   * походкой/аватаром, что и на поляне, и его ХП показывает тот же UI, что
   * и у любого другого игрока (не отдельная полоска).
   */
  private onTowerSnapshot(heroId: string, s: TowerSnapshot): void {
    const p = this.state.players.get(heroId);
    if (!p) return;
    if (!this.towerRuns.running) return; // забег уже закончен — не воскрешаем арену запоздалым снапшотом
    p.head.x = TOWER_HIDE.x + s.heroX;
    p.head.z = TOWER_HIDE.z + s.heroZ;
    // Герой поворачивается лицом к цели — та же конвенция yaw->кватернион,
    // что и у ботов в основном мире (см. tickBot).
    p.head.qx = 0;
    p.head.qy = Math.sin(s.heroYaw / 2);
    p.head.qz = 0;
    p.head.qw = Math.cos(s.heroYaw / 2);
    p.hp = s.heroHp;
    p.maxHp = s.heroMaxHp;
    p.towerFloor = s.floor;
    p.towerMobsLeft = s.mobsLeft;
    p.towerTimeSec = Math.round(s.elapsedSec);
    p.towerMobsTotal = s.mobsTotal;
    p.towerBossActive = s.bossActive ? 1 : 0;
    p.towerBossHpFrac = s.bossHpFrac;
    // Замах мечом — переиспользуем обычный relay "swing": аватар героя играет
    // ту же анимацию удара, что и у любого живого игрока/бота.
    if (s.heroAtkPulse) {
      this.broadcast(MSG.act, {
        k: "swing", id: heroId, x: p.head.x, y: p.head.y, z: p.head.z,
      } satisfies ActRelay);
    }
    // Клинок дошёл до цели — звук удара (см. TowerRoom.resolveHeroSwing/BOT.attackImpact).
    // Меч вампира — отдельная вспышка ДОПОЛНИТЕЛЬНО, не вместо.
    if (s.heroSwordHit) {
      this.broadcast(MSG.act, {
        k: "swordHit", id: heroId, x: p.head.x, y: p.head.y, z: p.head.z,
      } satisfies ActRelay);
      if (s.heroVampAffix) {
        this.broadcast(MSG.act, { k: "vampHit", id: heroId, x: p.head.x, y: p.head.y, z: p.head.z } satisfies ActRelay);
      }
    }
    // Герой с луком/посохом выстрелил — та же анимация/звук, что и у ботов-стрелков/магов.
    if (s.heroRangedPulse) {
      this.broadcast(MSG.act, {
        k: "bow", id: heroId, x: p.head.x, y: p.head.y, z: p.head.z,
      } satisfies ActRelay);
    }
    // Урон/блок/уворот по герою — те же звуки/FX, что у любого игрока (см. hurtPlayer),
    // только рассылаются отсюда: hurtPlayer() рано выходит для героев в башне.
    for (const fx of s.heroHitFx) {
      this.broadcast(MSG.act, {
        k: fx.k, id: heroId, x: TOWER_HIDE.x + fx.x, y: p.head.y, z: TOWER_HIDE.z + fx.z,
      } satisfies ActRelay);
    }
    // Крит из лука / оглушающий удар воина / град стрел лучника — те же FX,
    // что и у ботов в основном мире (см. ZoneRoom.botStunBash/botArrowRain);
    // клиент рисует их чисто по k+x+z, id ему не нужен.
    for (const fx of s.heroSkillFx) {
      this.broadcast(MSG.act, {
        k: fx.k, id: heroId, x: TOWER_HIDE.x + fx.x, y: p.head.y, z: TOWER_HIDE.z + fx.z, d: fx.d,
      } satisfies ActRelay);
    }
    this.broadcast(MSG.towerMobs, {
      heroId,
      mobs: s.mobs.map((m) => ({
        x: TOWER_HIDE.x + m.x,
        z: TOWER_HIDE.z + m.z,
        yaw: m.yaw,
        hpFrac: m.hpFrac,
        boss: m.boss,
        atkPulse: m.atkPulse,
        ranged: m.ranged,
        burning: m.burning,
      })),
      heroRangedPulse: s.heroRangedPulse,
      heroWeaponKind: s.heroWeaponKind,
      heroTargetX: TOWER_HIDE.x + s.heroRangedTargetX,
      heroTargetZ: TOWER_HIDE.z + s.heroRangedTargetZ,
    } satisfies TowerMobsMsg);
  }

  /** Попытка в TowerRoom закончилась — записать результат, вернуть героя, снова ждать очередь. */
  private onTowerRunDone(heroId: string, nick: string, r: TowerRunResult): void {
    const bot = heroId.startsWith("bot:") ? this.bots.get(heroId.slice(4)) : undefined;
    if (bot) {
      bot.inTower = false;
      const back = botSpawnAt({ x: bot.homeX, z: bot.homeZ });
      bot.state.head.x = back.x;
      bot.state.head.z = back.z;
      bot.state.head.y = terrainHeight(back.x, back.z) + PLAYER.eyeHeight;
      bot.state.towerFloor = 0; // сняли арену — герой вернулся
      // ХП в башне жило в тех же полях, что и обычное (см. onTowerSnapshot) —
      // возвращаем настоящий потолок героя и лечим с дороги.
      bot.state.maxHp = maxHpFor(bot.state.level, bot.state);
      bot.state.hp = bot.state.maxHp;
    }
    if (this.towerCamHeroId === heroId) {
      this.towerCamHeroId = "";
      this.broadcast(MSG.specCmd, { t: "cam", shot: "auto" } satisfies SpecCmd);
    }
    const rt = this.rt.get(heroId);
    if (rt?.token) {
      const prev = store.get(rt.token);
      rt.weapons.push(...r.drops); // сразу доступно в бою, если герой пойдёт в башню снова
      store.put(rt.token, {
        bestTowerFloor: Math.max(prev?.bestTowerFloor ?? 0, r.floorReached),
        towerShards: (prev?.towerShards ?? 0) + r.towerShards,
        // Первое полное прохождение фиксируем временем — по нему строится порядок «каким по счёту».
        towerClearedAt: prev?.towerClearedAt ?? (r.phase === "cleared" ? Date.now() : undefined),
        bestTowerTimeSec:
          r.phase === "cleared"
            ? Math.min(prev?.bestTowerTimeSec ?? Infinity, Math.round(r.timeSec))
            : prev?.bestTowerTimeSec,
        weapons: rt.weapons,
      });
      if (r.phase === "cleared" && r.timeSec <= TITLE_GOALS.towerSec) this.grantTitle(rt.token, "Царь башни");
      for (const w of r.drops) this.announcePickup(nick, w.cls, w.tier, w);
    }
    const t = Math.max(0, Math.round(r.timeSec));
    const time = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
    const verb = r.phase === "cleared" ? `покорил башню за ${time}!` : `дошёл до этажа ${r.floorReached}.`;
    this.reply(`${nick} ${verb}`);
    this.towerQueueOpenUntil = Date.now() + EVENT.tower.queueIdleClose * 1000;
    this.broadcastLeaderboard(); // новый результат виден у спектатора сразу, не ждём след. триггера
  }

  /**
   * `!camp [моб]` — в каком лагере качается герой: по имени моба («колосс»,
   * «призрак», «спрут», «голем»…), «авто» — снова сам. Без аргумента — список.
   */
  private setCamp(nick: string, norm: string, arg: string): void {
    const bot = this.bots.get(norm);
    if (!bot) {
      if (this.hintOk(norm)) this.reply(`@${nick} героя нет в мире — сначала !play.`);
      return;
    }
    const a = arg.trim().toLowerCase();
    const cur = bot.campPref ? ELITE_MOBS[bot.campPref].name : "авто";
    if (!a) {
      // Любой лагерь — на любом уровне (длинный ответ TwitchChat.say сам режет на части).
      const list = [...new Set(CAMPS_BY_POWER.map((c) => c.type))]
        .map((t) => `${ELITE_MOBS[t].name} (${ELITE_MOBS[t].level})`)
        .join(", ");
      this.reply(`@${nick} сейчас: ${cur}. Лагеря: ${list} — !camp <моб> или !camp авто`);
      return;
    }
    const token = bot.rt.token ?? `nick:${norm}`;
    if (["авто", "auto", "сам", "случайно", "random"].includes(a)) {
      bot.campPref = null;
      store.put(token, { campPref: undefined });
      this.reply(`@${nick} лагерь — на выбор героя.`);
      return;
    }
    const type = (Object.keys(ELITE_MOBS) as string[]).find((t) => {
      const name = ELITE_MOBS[t].name.toLowerCase();
      return t.toLowerCase() === a || name.includes(a) || name.split(/\s+/).some((w) => w.startsWith(a));
    });
    if (!type || !MOB_CAMPS.some((c) => c.type === type)) {
      this.reply(`@${nick} не нашёл такой лагерь. Список: !camp`);
      return;
    }
    const def = ELITE_MOBS[type];
    bot.campPref = type;
    store.put(token, { campPref: type });
    const hard = def.level > bot.state.level + 5 ? ` (${def.level} ур. — будет тяжело)` : "";
    this.reply(`@${nick} герой идёт качаться: ${def.name}${hard}.`);
  }

  /** Ник → время (мс) последнего !focus: кулдаун на зрителя. */
  private readonly focusUsedAt = new Map<string, number>();
  private focusTimer: { clear(): void } | null = null;

  /**
   * `!focus [ник]` — камера эфира на 10 с переключается на героя (свой бот
   * по умолчанию), потом возвращается к авто-режиму. Кулдаун 10 мин на зрителя.
   */
  private focusCam(nick: string, norm: string, arg?: string): void {
    const now = Date.now();
    const last = this.focusUsedAt.get(norm) ?? 0;
    if (now - last < FOCUS_COOLDOWN_MS && !isAdminNick(norm)) {
      const min = Math.ceil((FOCUS_COOLDOWN_MS - (now - last)) / 60_000);
      this.reply(`@${nick} !focus снова можно через ${min} мин.`);
      return;
    }
    const want = normNick(arg ?? "") || norm;
    let id = "";
    if (this.bots.has(want)) id = `bot:${want}`;
    else {
      for (const [sid, p] of this.state.players) {
        if (!sid.startsWith("bot:") && normNick(p.nick) === want) id = sid;
      }
    }
    if (!id) {
      this.reply(arg ? `@${nick} героя ${arg} сейчас нет в мире.` : `@${nick} у тебя нет героя в мире — !play, чтобы создать.`);
      return;
    }
    this.focusUsedAt.set(norm, now);
    const shot = `orbitPlayer:${id}`;
    this.broadcast(MSG.specCmd, { t: "cam", shot } satisfies SpecCmd);
    this.focusTimer?.clear();
    this.focusTimer = this.clock.setTimeout(() => {
      this.focusTimer = null;
      this.broadcast(MSG.specCmd, { t: "cam", shot: "auto" } satisfies SpecCmd);
    }, FOCUS_SHOW_MS);
  }

  private setFollow(nick: string, norm: string, target: string | null): void {
    const bot = this.bots.get(norm);
    if (!bot) {
      if (this.hintOk(norm)) this.reply(`@${nick} героя нет в мире — сначала !play.`);
      return;
    }
    bot.raiding = false; // !follow/!come/!stay отменяет рейд
    bot.eventing = false; // и событие
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

  /** `!рыбачить`/`!fish` — идёт на озеро рыбачить вместо боя. Повтор — отмена. */
  private setFishing(nick: string, norm: string): void {
    const bot = this.bots.get(norm);
    if (!bot) {
      if (this.hintOk(norm)) this.reply(`@${nick} героя нет в мире — сначала !play.`);
      return;
    }
    if (bot.fishing) {
      bot.fishing = false;
      bot.fishBiteAt = 0;
      bot.state.fishing = 0;
      this.reply(`@${nick} герой закончил рыбачить.`);
      return;
    }
    bot.raiding = false;
    bot.eventing = false;
    bot.followNorm = null;
    bot.target = null;
    bot.fishing = true;
    bot.fishBiteAt = 0;
    bot.state.fishing = 1;
    this.reply(`@${nick} герой пошёл на озеро рыбачить.`);
  }

  /** `!качаться`/`!train` — снимает рыбалку/рейд/событие/follow, герой снова бьёт мобов в зоне. */
  private setTraining(nick: string, norm: string): void {
    const bot = this.bots.get(norm);
    if (!bot) {
      if (this.hintOk(norm)) this.reply(`@${nick} героя нет в мире — сначала !play.`);
      return;
    }
    bot.fishing = false;
    bot.fishBiteAt = 0;
    bot.state.fishing = 0;
    bot.raiding = false;
    bot.eventing = false;
    bot.followNorm = null;
    this.reply(`@${nick} герой пошёл качаться — бьёт мобов в зоне.`);
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

  /**
   * Выгнать живую сессию под этим ником (если есть) — заход под тем же ником
   * в новой вкладке/устройстве должен ПЕРЕХВАТИТЬ существующего персонажа, а
   * не завести отдельного несвязанного "гостя" со своим случайным снаряжением.
   * Раньше именно так и было (см. комментарий ниже, "не отбираем, просто
   * гостевой токен") — по заявке ("можно хоть сколько угодно клонов
   * создавать") это признано нежелательным.
   */
  private kickNick(norm: string): void {
    const want = `nick:${norm}`;
    for (const [id, rt] of this.rt) {
      if (id.startsWith("bot:") || rt.token !== want) continue;
      const c = this.clientOf(id);
      if (c) {
        this.kickedSessions.add(id);
        try {
          c.leave(KICK_SAME_NICK_CODE, "вошли под этим ником в другом месте");
        } catch {
          /* сокет уже мёртв */
        }
      }
    }
  }

  private onChat(nick: string, text: string, fromGame = false): void {
    const norm = normNick(nick);
    if (!norm) return;
    this.chatSeen.set(norm, Date.now());
    this.chatLast.set(norm, Date.now());
    chatLog.append(nick, text);
    this.sendChatLine({ nick, text: text.slice(0, 300) });
    // Из игры ник не подтверждён (не Twitch): коды входа в !inv и команды админов — только из Twitch.
    if (fromGame && /^\d{4}$/.test(text.trim())) return;
    if (fromGame && isAdminNick(nick)) {
      // Админский ник из игры: без админских прав — только озвучка и запись в катакомбы как у всех.
      const c0 = text.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
      if (!c0.startsWith("!")) this.voiceChat(nick, norm, text);
      else if (CAT_CMDS.includes(c0)) this.catJoinChat(nick, norm, undefined, false);
      return;
    }
    // Код входа в веб-инвентарь (4 цифры со страницы /inv?ник) — не болтовня бота.
    if (invHub.tryChatCode(norm, text)) {
      this.reply(`@${nick} инвентарь открыт — можно надевать и разбирать ✓`);
      return;
    }
    const parts = text.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();
    // Только стенд: поджечь всех мобов на 20 с (почти без урона) — проверка огня.
    // Стенд: !lvl N — выставить уровень герою этого ника (очки атрибутов — заново).
    if (STAGING && cmd === "!lvl") {
      const t = this.findWeaponsTarget(norm);
      const lvl = Math.max(1, Math.min(100, Math.floor(Number(parts[1])) || 1));
      if (t) {
        const prog = readProgress(t.p);
        prog.level = lvl;
        prog.xp = 0;
        resetAttrs(prog);
        writeProgress(t.p, prog);
        t.p.maxHp = maxHpFor(t.p.level, t.p);
        t.p.hp = t.p.maxHp;
        this.persistNick(norm);
        this.reply(`@${nick} [стенд] уровень ${lvl}, очков ${t.p.unspent}`);
      }
      return;
    }
    if (STAGING && (cmd === "!поджечь" || cmd === "!burn")) {
      for (const m of this.sim.mobs.values()) if (!m.dead) m.ignite(0.01, 20, "");
      return;
    }
    if (cmd === "!play" || cmd === "!join") this.requestBot(nick, norm);
    else if (CAT_CMDS.includes(cmd)) {
      this.catJoinChat(nick, norm, parts[1]);
    } else if (cmd === "!цель" || cmd === "!target") this.catTacticChat(nick, norm, "focus", parts[1] ?? "");
    else if (cmd === "!встать" || cmd === "!pos") this.catTacticChat(nick, norm, "pos", parts[1] ?? "");
    else if (cmd === "!режим" || cmd === "!mode") this.catTacticChat(nick, norm, "mode", parts[1] ?? "");
    else if (cmd === "!тактика" || cmd === "!tactic") this.catTacticChat(nick, norm, "show", "");
    else if (cmd === "!stop" || cmd === "!leave") {
      if (this.bots.has(norm)) {
        this.removeBot(norm);
        this.reply(`@${nick} герой ушёл из мира. !play — вернуть.`);
      }
    }
    else if (cmd === "!skin" || cmd === "!model" || cmd === "!skins") this.reskinBot(norm, parts[1]);
    else if (cmd === "!class" || cmd === "!класс") this.setBotClass(nick, norm, parts.slice(1).join(" "));
    else if (cmd === "!skills" || cmd === "!skill" || cmd === "!умения") this.setBotSkills(nick, norm, parts.slice(1));
    else if (cmd === "!ульта" || cmd === "!ult") this.castUltChat(nick, norm);
    else if (cmd === "!info" || cmd === "!help" || cmd === "!commands") this.sayInfo();
    else if (cmd === "!stats" || cmd === "!stat" || cmd === "!hero" || cmd === "!me") {
      this.sayStats(norm);
    } else if (CHAT_STATS[cmd]) {
      // В чате ловкость — !dex (запасной алиас !agi), есть и русские: !сила !ловк !инт !тел !удача !мудр.
      const stat: StatName = CHAT_STATS[cmd];
      this.spendBotPoint(norm, stat, parts[1]);
    } else if (
      cmd === "!respec" ||
      cmd === "!reroll" ||
      cmd === "!перекачать" ||
      cmd === "!сбросочки"
    ) {
      this.respecBot(norm);
    } else if (cmd === "!autostats" || cmd === "!автоочки") {
      // Вернуть боту авто-распределение очков атрибутов (снимает ручной режим).
      if (store.get(`nick:${norm}`)) {
        store.put(`nick:${norm}`, { manualAttrs: false });
        this.reply(`@${nick} герой снова сам раскидывает очки атрибутов по своему классу.`);
      } else if (this.hintOk(norm)) this.reply(`@${nick} у тебя ещё нет героя — сначала !play.`);
    } else if (cmd === "!delete" || cmd === "!reset") {
      this.deleteBot(nick, norm);
    } else if (INV_COMMANDS.has(cmd)) {
      this.sayInvLink(nick, norm);
    } else if (cmd === "!top" || cmd === "!leaders" || cmd === "!leaderboard") {
      this.sayTop();
    } else if (cmd === "!cheer" || cmd === "!defeat") {
      // !roll и !jump убраны из чата: roll теперь сам иногда играет на
      // бегу, а отдельная команда под него/jump не нужна (см. tickBot).
      this.botEmote(nick, norm, cmd.slice(1) as BotEmote);
    } else if (["!follow", "!folow", "!следовать", "!следуй", "!за", "!фоллоу"].includes(cmd)) {
      this.setFollow(nick, norm, normNick(parts[1] ?? ""));
    } else if (cmd === "!title" || cmd === "!титул" || cmd === "!титулы") {
      this.titleCmd(nick, norm, parts.slice(1).join(" ").trim());
    } else if (FOCUS_COMMANDS.has(cmd)) {
      this.focusCam(nick, norm, parts[1]);
    } else if (cmd === "!unfollow" || cmd === "!stay" || cmd === "!stayhere") {
      this.setFollow(nick, norm, null);
    } else if (cmd === "!come") {
      this.setFollow(nick, norm, normNick(ADMIN_NICK));
    } else if (cmd === "!camp" || cmd === "!кемп" || cmd === "!лагерь" || cmd === "!camps") {
      this.setCamp(nick, norm, parts.slice(1).join(" "));
    } else if (["!пугало", "!тест", "!дпс", "!dps", "!demage", "!damage", "!test", "!урон"].includes(cmd)) {
      this.botScarecrowTest(nick, norm);
    } else if (cmd === "!fish" || cmd === "!рыбачить" || cmd === "!рыбалка") {
      this.setFishing(nick, norm);
    } else if (cmd === "!train" || cmd === "!качаться" || cmd === "!качайся" || cmd === "!grind") {
      this.setTraining(nick, norm);
    } else if (cmd === "!raid" || cmd === "!boss" || cmd === "!рейд" || cmd === "!рб") {
      this.setRaid(nick, norm);
    } else if (cmd === "!квест" || cmd === "!кв" || cmd === "!quest" || cmd === "!участвую" || cmd === "!cq") {
      this.joinChatQuest(nick, norm);
    } else if (cmd === "!chatquest" && (isAdminNick(nick) || STAGING)) {
      if (this.chatQuest) this.reply(`@${nick} квест чата уже идёт.`);
      else this.startChatQuest(parts[1] === "champ" ? "champs" : "mobs");
    } else if ((cmd === "!ивенты" || cmd === "!events") && isAdminNick(nick)) {
      this.eventsCmd(nick, parts.slice(1));
    } else if (cmd === "!goevent") {
      // Запустить событие может только админ стрима. Необязательный аргумент —
      // тип: hunt/охота, invasion/нашествие, tower/башня (иначе — случайный).
      if (isAdminNick(nick)) {
        if (this.eventPhase === "active") {
          this.reply(`@${nick} событие уже идёт.`);
        } else {
          const a = (parts[1] ?? "").toLowerCase();
          this.forcedEventKind =
            a === "hunt" || a === "охота"
              ? 2
              : a === "tower" || a === "башня"
                ? 3
                : a === "invasion" || a === "нашествие"
                  ? 1
                  : 0;
          this.eventPhase = "idle";
          this.eventPhaseAt = Date.now(); // сработает следующим тиком
          this.eventForced = true;
          this.reply(`@${nick} событие вот-вот начнётся.`);
        }
      }
    } else if (cmd === "!resettower" || cmd === "!сбростопбашни") {
      if (isAdminNick(nick)) {
        store.resetTowerStats();
        this.broadcastLeaderboard();
        this.reply(`@${nick} топ «Охотничьей башни» обнулён.`);
      }
    } else if (cmd === "!stopbots" || cmd === "!выгнатьботов") {
      if (isAdminNick(nick)) {
        const n = this.bots.size;
        for (const norm2 of [...this.bots.keys()]) this.removeBot(norm2);
        this.reply(`@${nick} все боты (${n}) распущены.`);
      }
    } else if (
      cmd === "!event" || cmd === "!events" || cmd === "!ивент" || cmd === "!ив" || cmd === "!ивенты" || cmd === "!евент" ||
      cmd === "!событие" || cmd === "!invasion" || cmd === "!нашествие"
    ) {
      if (this.eventPhase === "active" && this.activeEventKind === 3) {
        this.joinTowerQueue(nick, norm);
      } else {
        this.sendBotToEvent(nick, norm);
      }
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
    const listeners = (): string[] => {
      const out: string[] = [];
      for (const [id, r] of this.rt) if (r.ttsListen && !id.startsWith("bot:")) out.push(id);
      return out;
    };
    if (!this.state.ttsOn || !ttsAvailable() || (this.spectators.size === 0 && listeners().length === 0)) return;
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
      if (!url) return;
      const cmd: SpecCmd = { t: "ttsPlay", url, nick };
      const heard = new Set(listeners());
      for (const c of this.clients) {
        if (this.spectators.has(c.sessionId)) c.send(MSG.specCmd, cmd);
        else if (heard.has(c.sessionId)) c.send(MSG.ttsPlay, { url, nick } satisfies TtsPlayMsg);
      }
    });
  }

  /**
   * Ответ в чат канала. Работает, только если в окружении задан аккаунт бота
   * (см. TwitchChat) — иначе тихо пропускается.
   */
  private reply(text: string): void {
    this.twitch?.say(text);
    this.sendChatLine({ nick: "info", text, bot: 1 });
  }

  /** Данные ПК-окна снаряжения — по живому герою этого клиента. */
  // ---- Рыбалка игрока ----

  private static atShore(p: PlayerState): boolean {
    const ld = lakeEllipseDist(p.head.x, p.head.z);
    const shoreOuter = LAKE_R_AVG + LAKE.shoreFade;
    return ld >= shoreOuter - 20 && ld <= shoreOuter + 15; // с запасом к клиентской полосе
  }

  private fishCast(client: Client, p: PlayerState, rt: Runtime): void {
    const cfg = rt.fishAuto ? FISH_AUTO : FISH_MANUAL;
    const wait = cfg.min + Math.random() * cfg.spread;
    rt.fishBiteAt = this.elapsed + wait;
    p.fishing = 1;
    client.send(MSG.fishWait, { wait, auto: rt.fishAuto } satisfies FishWaitMsg);
  }

  private fishStop(client: Client | undefined, p: PlayerState, rt: Runtime, notify: boolean): void {
    if (rt.fishBiteAt === null && !p.fishing) return;
    rt.fishBiteAt = null;
    rt.fishAuto = false;
    p.fishing = 0;
    if (notify) client?.send(MSG.fishWait, { wait: 0, stop: true } satisfies FishWaitMsg);
  }

  private fishCatch(client: Client, p: PlayerState): boolean {
    const bag = readBag(p);
    if (addToBag(bag, "fish", 1) >= 1) return false; // сумка полна
    writeBag(p, bag);
    client.send(MSG.picked, { item: "fish", count: 1 });
    this.questEvent(client.sessionId, { fish: true });
    this.bumpFeat(client.sessionId, "fishTotal", TITLE_GOALS.fish, "Мастер-рыболов");
    this.broadcast(MSG.botSay, { id: client.sessionId, text: "Поймал!" } satisfies BotSayMsg);
    return true;
  }

  /** Авторыбалка игроков: улов по таймеру; ушёл от берега/умер — удочка сматывается. */
  private tickPlayerFishing(): void {
    for (const [id, rt] of this.rt) {
      if (rt.fishBiteAt === null || id.startsWith("bot:")) continue;
      const p = this.state.players.get(id);
      const client = this.clientOf(id);
      if (!p || !client) continue;
      if (p.dead || !ZoneRoom.atShore(p)) {
        this.fishStop(client, p, rt, true);
        continue;
      }
      if (rt.fishAuto && this.elapsed >= rt.fishBiteAt) {
        if (this.fishCatch(client, p)) this.fishCast(client, p, rt);
        else this.fishStop(client, p, rt, true);
      } else if (!rt.fishAuto && this.elapsed > rt.fishBiteAt + FISH_MANUAL.window + 2) {
        // Ручной: не подсёк — рыба ушла, удочку сматываем (клиент сам покажет).
        rt.fishBiteAt = null;
        p.fishing = 0;
      }
    }
  }

  // ---- Титулы ----

  /** Выдать титул (если ещё нет) — объявить в чате; первый сразу надевается. */
  private grantTitle(token: string, name: string): void {
    const rec = store.get(token);
    if (!rec) return;
    const have = new Set(rec.titles ?? []);
    if (have.has(name)) return;
    have.add(name);
    store.put(token, { titles: [...have], ...(rec.title ? {} : { title: name }) });
    this.reply(`🏅 ${rec.nick} получает титул «${name}»!`);
  }

  /** Счётчик заслуги +1 и выдача титула, когда достиг цели. */
  private bumpFeat(ownerId: string, field: "fishTotal" | "bossKills" | "dragonTop" | "contracts", goal: number, title: string): void {
    const token = this.rt.get(ownerId)?.token;
    if (!token) return;
    const n = (store.get(token)?.[field] ?? 0) + 1;
    store.put(token, { [field]: n });
    if (n >= goal) this.grantTitle(token, title);
  }

  /** !title [название] — список полученных / надеть титул (боты и игроки). */
  private titleCmd(nick: string, norm: string, arg: string): void {
    const token = `nick:${norm}`;
    const rec = store.get(token);
    const have = rec?.titles ?? [];
    if (!arg) {
      this.reply(
        have.length
          ? `@${nick} твои титулы: ${have.join(", ")}. Надеть: !title <название>, снять: !title нет`
          : `@${nick} титулов пока нет. Их дают за большие заслуги: ${TITLES.map((t) => `${t.name} — ${t.desc}`).join("; ")}`,
      );
      return;
    }
    if (/^(нет|off|снять)$/i.test(arg)) {
      store.put(token, { title: "" });
      this.reply(`@${nick} титул снят.`);
      return;
    }
    const pick = have.find((t) => t.toLowerCase().startsWith(arg.toLowerCase()));
    if (!pick) {
      this.reply(`@${nick} такого титула у тебя нет.`);
      return;
    }
    store.put(token, { title: pick });
    this.reply(`@${nick} теперь носит титул «${pick}».`);
  }

  // ---- Квест чата (все боты вместе) ----

  private chatQuest: {
    kind: "mobs" | "champs";
    need: number;
    got: number;
    endsAt: number;
    /** norm ника → сколько внёс. */
    who: Map<string, number>;
    /** Кто записался командой !квест (norm ника) — только их боты двигают прогресс. */
    joined: Set<string>;
  } | null = null;
  private nextChatQuestAt = Date.now() + CHAT_QUEST.firstMin * 60_000;

  private startChatQuest(kind: "mobs" | "champs"): void {
    const need = this.chatQuestNeed(kind, 0);
    this.chatQuest = { kind, need, got: 0, endsAt: Date.now() + CHAT_QUEST.durSec * 1000, who: new Map(), joined: new Set() };
    this.state.cqNeed = need;
    this.state.cqGot = 0;
    this.chatQuestTitle();
    this.reply(
      `📜 Квест чата! ${kind === "mobs" ? "Убить мобов" : "Победить вожаков лагерей"} за ${CHAT_QUEST.durSec / 60} минут — ` +
        `участвуют только записавшиеся: пиши !квест (или !кв). Считаются убийства ботов участников. ` +
        `Награда каждому: опыт, свиток мудрости и ${CHAT_QUEST.tokens} ◈. Нет героя? !play`,
    );
  }

  /** Цель — от числа участников (но не меньше, чем на CHAT_QUEST.minBots). */
  private chatQuestNeed(kind: "mobs" | "champs", participants: number): number {
    const n = Math.max(CHAT_QUEST.minBots, participants);
    return kind === "mobs" ? n * CHAT_QUEST.mobsPerBot : n * CHAT_QUEST.champsPerBot;
  }

  private chatQuestTitle(): void {
    const q = this.chatQuest;
    if (!q) return;
    this.state.cqTitle =
      (q.kind === "mobs" ? `Квест чата: убить ${q.need} мобов` : `Квест чата: победить ${q.need} вожаков`) +
      ` · участников ${q.joined.size}`;
  }

  /** !квест — записаться в квест чата (нужен герой-бот в мире). */
  private joinChatQuest(nick: string, norm: string): void {
    const q = this.chatQuest;
    if (!q) {
      this.reply(`@${nick} сейчас нет квеста чата — он запускается раз в пару часов.`);
      return;
    }
    if (!this.bots.has(norm)) {
      this.reply(`@${nick} сначала создай героя — !play, потом !квест.`);
      return;
    }
    if (q.joined.has(norm)) return;
    q.joined.add(norm);
    q.need = Math.max(q.need, this.chatQuestNeed(q.kind, q.joined.size));
    this.state.cqNeed = q.need;
    this.chatQuestTitle();
    this.reply(`@${nick} в квесте чата! Твой бот идёт помогать (${q.got}/${q.need}).`);
  }

  /** Убийство ботом — вклад в квест чата. */
  private chatQuestKill(owner: string, champ: boolean): void {
    const q = this.chatQuest;
    if (!q || !owner.startsWith("bot:")) return;
    if (q.kind === "champs" && !champ) return;
    const norm = owner.slice(4);
    if (!q.joined.has(norm)) return;
    q.got++;
    q.who.set(norm, (q.who.get(norm) ?? 0) + 1);
    this.state.cqGot = Math.min(q.got, q.need);
  }

  private tickChatQuest(): void {
    const now = Date.now();
    const q = this.chatQuest;
    if (!q) {
      if (now < this.nextChatQuestAt) return;
      this.nextChatQuestAt = now + CHAT_QUEST.everyMin * 60_000;
      if (this.bots.size >= CHAT_QUEST.minBots && !this.eventsOff.has("quest")) this.startChatQuest(Math.random() < 0.65 ? "mobs" : "champs");
      return;
    }
    this.state.cqSecs = Math.max(0, Math.ceil((q.endsAt - now) / 1000));
    if (q.got < q.need && now < q.endsAt) return;
    const won = q.got >= q.need;
    this.chatQuest = null;
    this.state.cqTitle = "";
    if (!won) {
      this.reply(`Квест чата не выполнен — участники успели ${q.got} из ${q.need}. Следующий — позже!`);
      return;
    }
    const names: string[] = [];
    for (const norm of q.who.keys()) {
      const token = `nick:${norm}`;
      const rec = store.get(token);
      const cur = Math.max(now, rec?.scrollXpUntil ?? 0);
      store.put(token, {
        scrollXpUntil: Math.min(now + SCROLL.maxSec * 1000, cur + SCROLL.sec * 1000),
        tokens: (rec?.tokens ?? 0) + CHAT_QUEST.tokens,
      });
      const p = this.state.players.get(`bot:${norm}`);
      if (p) {
        const lvlXp = xpToNext(p.level);
        if (Number.isFinite(lvlXp)) this.awardXp(undefined, p, Math.round(lvlXp * questXpFrac(p.level)));
        names.push(p.nick);
      }
    }
    this.reply(
      `🎉 Квест чата выполнен (${q.need})! Награда — опыт, свиток мудрости и ${CHAT_QUEST.tokens} ◈: ` +
        `${names.slice(0, 12).join(", ")}${names.length > 12 ? ` и ещё ${names.length - 12}` : ""}`,
    );
  }

  // ---- Свитки и лавка трактирщика ----

  private useScroll(client: Client, p: PlayerState, slot: number): void {
    const rt = this.rt.get(client.sessionId);
    if (!rt?.token) return;
    const bag = readBag(p);
    const item = bag[slot]?.item;
    if (item !== "scroll_xp" && item !== "scroll_wind") return;
    const now = Date.now();
    const key = item === "scroll_xp" ? "scrollXpUntil" : "scrollWindUntil";
    const left = (store.get(rt.token)?.[key] ?? 0) - now;
    if (left > 0) {
      // Такой свиток уже действует — второй не тратим, пока не кончится.
      // Тост на всех платформах (в VR — в шлеме) идёт через итог действия ПК-окна.
      client.send(MSG.pcInvResult, { ok: false, text: `${ITEMS[item].name} уже действует — ещё ${Math.ceil(left / 60000)} мин` });
      return;
    }
    takeOne(bag, slot);
    writeBag(p, bag);
    store.put(rt.token, { [key]: now + SCROLL.sec * 1000 });
    this.broadcast(MSG.act, { k: "drink", id: client.sessionId, x: p.head.x, y: p.head.y, z: p.head.z } satisfies ActRelay, {
      except: client,
    });
  }

  private tavernNear(p: PlayerState): boolean {
    const t = HUB.zones.tavern;
    return Math.hypot(p.head.x - t.x, p.head.z - t.z) <= TAVERN_REACH;
  }

  private sendShop(client: Client, msg?: string): void {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    const norm = normNick(p.nick);
    const rt = this.rt.get(client.sessionId);
    const data: ShopData = {
      items: SHOP.map((i) => ({ id: i.id, name: i.name, desc: i.desc, price: i.price, fishCost: i.fishCost })),
      tokens: store.get(`nick:${norm}`)?.tokens ?? 0,
      fish: bagCount(readBag(p), "fish"),
      near: this.tavernNear(p),
      swaps: rt ? this.rubySwaps(p, rt) : [],
      msg,
    };
    client.send(MSG.shopData, data);
  }

  /** Рубиновое на складе, которое можно обменять: не избранное и не в руках. */
  private rubySwaps(p: PlayerState, rt: Runtime): ShopSwap[] {
    const held = this.liveHeldIds(p, rt);
    return rt.weapons
      .filter((w) => w.tier === "ruby" && !w.fav && !held.has(w.id))
      .map((w) => ({
        wid: w.id,
        name: `${instanceName(w)} · ${instanceStars(w)}`,
        targets: ATTACK_CLASSES.filter((c) => c !== w.cls).map((c) => {
          const hero = CLASS_IDS.find((id) => CLASSES2[id].main === c);
          return { cls: c, label: hero ? CLASSES2[hero].name : c };
        }),
      }));
  }

  /** Обмен рубинового на другой класс: та же оценка и число роллов; старое рубиновое уходит. */
  private rubySwap(client: Client, p: PlayerState, rt: Runtime, id: string): void {
    if (!this.tavernNear(p)) return this.sendShop(client, "Подойди к трактирщику");
    const [, wid, cls] = id.split(":");
    const idx = rt.weapons.findIndex((w) => w.id === wid);
    const w = rt.weapons[idx];
    if (!w || w.tier !== "ruby") return this.sendShop(client, "Этого рубинового уже нет на складе");
    if (w.fav) return this.sendShop(client, "Это оружие в избранном ★ — сними звёздочку, чтобы обменять");
    if (this.liveHeldIds(p, rt).has(w.id)) return this.sendShop(client, "Это оружие сейчас в руках — сначала надень другое");
    if (!isWeaponClass(cls) || cls === "shield" || cls === w.cls) return this.sendShop(client, "Такой обмен не выйдет");
    const nw = swapRubyClass(w, cls);
    rt.weapons[idx] = nw;
    this.persistNick(normNick(p.nick));
    this.syncWarehouse(client.sessionId, rt);
    this.sendShop(client, `Обмен: ${instanceName(w)} → ${instanceName(nw)} · ${instanceStars(nw)}`);
  }

  private shopBuy(client: Client, msg: ShopBuyMsg): void {
    const p = this.state.players.get(client.sessionId);
    const rt = this.rt.get(client.sessionId);
    if (!p || !rt || !msg) return;
    if (msg.id.startsWith("swap:")) return this.rubySwap(client, p, rt, msg.id);
    const item = SHOP.find((i) => i.id === msg.id);
    if (!item) return;
    const token = `nick:${normNick(p.nick)}`;
    if (!this.tavernNear(p)) return this.sendShop(client, "Подойди к трактирщику");
    const tokens = store.get(token)?.tokens ?? 0;
    if (item.fishCost) {
      // Обмен рыбы на жетон: рыба из сумки → +1 ◈.
      const bag = readBag(p);
      const have = bagCount(bag, "fish");
      if (!takeFromBag(bag, "fish", item.fishCost)) return this.sendShop(client, `Нужно ${item.fishCost} рыб, у тебя ${have}`);
      writeBag(p, bag);
      store.put(token, { tokens: tokens + 1 });
      this.sendShop(client, `Обмен: −${item.fishCost} рыб · +1 ◈ (теперь ${tokens + 1} ◈)`);
      this.sendQuests(client);
      return;
    }
    if (tokens < item.price) return this.sendShop(client, `Не хватает жетонов: нужно ${item.price} ◈`);
    let note: string;
    if (item.item) {
      const bag = readBag(p);
      if (addToBag(bag, item.item, item.count ?? 1) > 0) return this.sendShop(client, "Сумка полна");
      writeBag(p, bag);
      note = `Куплено: ${item.name}`;
    } else {
      const w = this.rollChestWeapon(p);
      rt.weapons.push(w);
      store.put(token, { weapons: rt.weapons });
      this.announcePickup(p.nick, w.cls, w.tier, w);
      note = `Из сундука: ${instanceName(w)} ${instanceStars(w)}`;
    }
    store.put(token, { tokens: tokens - item.price });
    // Что потрачено и что осталось — видно и в VR (там тост в шлеме).
    note += ` · −${item.price} ◈ (осталось ${tokens - item.price} ◈)`;
    this.sendShop(client, note);
    this.sendQuests(client);
  }

  /** Сундук: уникальное оружие класса героя (по оружию в правой руке), 3 ролла, оценка ≥ CHEST_MIN_QUALITY. */
  private rollChestWeapon(p: PlayerState, forCls?: WeaponClass): WeaponInstance {
    const cls: WeaponClass = forCls ?? (isWeaponClass(p.rightCls) && p.rightCls !== "shield" ? p.rightCls : "sword");
    let w = rollWeaponInstance(cls, "legendary");
    for (let i = 0; i < 200 && w.affixes.length < 3; i++) w = rollWeaponInstance(cls, "legendary");
    for (let i = 0; i < 400 && weaponQuality(w) < CHEST_MIN_QUALITY; i++) {
      enchantApply(w, Math.floor(Math.random() * w.affixes.length), 2);
    }
    return w;
  }

  /** Свиток в награду (бонус за задания) — случайный из двух. */
  private giveScroll(client: Client, p: PlayerState): string | null {
    const id = Math.random() < 0.5 ? "scroll_xp" : "scroll_wind";
    const bag = readBag(p);
    if (addToBag(bag, id, 1) > 0) return null;
    writeBag(p, bag);
    client.send(MSG.picked, { item: id, count: 1 });
    return ITEMS[id].name;
  }

  // ---- Доска заданий (квесты дня) ----

  /** Задания героя на сегодня (новый день — новые под текущий уровень). */
  private questBoard(p: PlayerState): { token: string; q: QuestSave } | null {
    const norm = normNick(p.nick);
    if (!norm) return null;
    const token = `nick:${norm}`;
    const rec = store.get(token);
    let q = rec?.quests;
    if (!q || q.v !== 3 || q.day !== questDay()) {
      q = makeBoard(p.level);
      store.put(token, { quests: q });
    }
    return { token, q };
  }

  private questNear(p: PlayerState): boolean {
    const b = HUB.zones.questBoard;
    return Math.hypot(p.head.x - b.x, p.head.z - b.z) <= QUEST.boardReach;
  }

  private questView(p: PlayerState, msg?: string): QuestData | null {
    const b = this.questBoard(p);
    if (!b) return null;
    const lvlXp = xpToNext(p.level);
    const view = (s: QuestSlot) => {
      const r = slotReward(s);
      return {
        kind: s.kind,
        hard: s.hard,
        target: s.target,
        title: slotTitle(s),
        got: Math.min(s.got, s.need),
        need: s.need,
        done: slotDone(s),
        claimed: s.claimed,
        reward: { xpPct: Number.isFinite(lvlXp) ? 1 : 0, tokens: r.tokens, scrap: r.scrap },
      };
    };
    return {
      slots: b.q.slots.map(view),
      offers: b.q.offers.map(view),
      picksLeft: b.q.picksLeft,
      tokens: store.get(b.token)?.tokens ?? 0,
      nextSecs: secsToNextDay(),
      near: this.questNear(p),
      dailyTaken: b.q.accepted,
      story: this.storyView(b.token, lvlXp),
      weekly: this.weeklyView(b.token, p, lvlXp),
      nearHunter: this.hunterNear(p),
      titles: store.get(b.token)?.titles ?? [],
      title: store.get(b.token)?.title ?? "",
      msg,
    };
  }

  private sendQuests(client: Client, msg?: string): void {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    const v = this.questView(p, msg);
    if (v) client.send(MSG.questData, v);
  }

  private hunterNear(p: PlayerState): boolean {
    const h = HUB.zones.hunter;
    return Math.hypot(p.head.x - h.x, p.head.z - h.z) <= QUEST.boardReach;
  }

  private storyOf(token: string): StorySave {
    return store.get(token)?.story ?? { ch: 0, got: 0 };
  }

  private storyView(token: string, lvlXp: number): QuestData["story"] {
    const st = this.storyOf(token);
    const c = STORY[st.ch];
    if (!c) return null;
    return {
      chapter: st.ch + 1,
      total: STORY.length,
      title: c.title,
      text: c.text,
      kind: c.kind,
      target: c.target,
      got: Math.min(st.got, c.need),
      need: c.need,
      done: st.got >= c.need,
      taken: !!st.taken,
      reward: {
        xpPct: Number.isFinite(lvlXp) ? 1 : 0,
        tokens: STORY_REWARD.tokens,
        potions: STORY_REWARD.potions,
        final: st.ch === STORY.length - 1,
      },
    };
  }

  /** Контракт недели (новая неделя — новый, под текущий уровень). */
  private weeklyOf(token: string, p: PlayerState): WeeklySave {
    let w = store.get(token)?.weekly;
    if (!w || w.week !== questWeek()) {
      w = makeWeekly(p.level);
      store.put(token, { weekly: w });
    }
    return w;
  }

  private weeklyView(token: string, p: PlayerState, lvlXp: number): QuestData["weekly"] {
    const w = this.weeklyOf(token, p);
    const zoneNames = w.zone.map((t) => ELITE_MOBS[t]?.name ?? t).join(", ");
    return {
      parts: [
        { label: `Мобы зоны (${zoneNames})`, got: Math.min(w.hunt, WEEKLY.hunt), need: WEEKLY.hunt },
        { label: "Вожаки лагерей (любые)", got: Math.min(w.champ, WEEKLY.champ), need: WEEKLY.champ },
        { label: "Рыба", got: Math.min(w.fish, WEEKLY.fish), need: WEEKLY.fish },
      ],
      done: weeklyDone(w),
      claimed: w.claimed,
      taken: !!w.taken,
      secsLeft: secsToNextWeek(),
      reward: { xpPct: Number.isFinite(lvlXp) ? 1 : 0, tokens: WEEKLY.reward.tokens },
    };
  }

  /**
   * Событие для заданий игрока id (боты заданий не берут): убийство моба
   * лагеря (campType, вожак?) или пойманная рыба. Двигает дневные задания,
   * главу сюжета и недельный контракт.
   */
  private questEvent(id: string, ev: { fish?: boolean; campType?: string; champ?: boolean; boss?: boolean }): void {
    if (id.startsWith("bot:")) return;
    const p = this.state.players.get(id);
    if (!p) return;
    const b = this.questBoard(p);
    if (!b) return;
    const hits = (kind: QuestKind, target: string): boolean =>
      kind === "fish"
        ? !!ev.fish
        : kind === "boss"
          ? !!ev.boss
          : !!ev.campType && target === ev.campType && (kind === "hunt" || !!ev.champ);
    let changed = false;
    for (const [i, s] of b.q.slots.entries()) {
      // Три задания дня — только после того, как взяты у доски.
      if (i < QUEST.auto && !b.q.accepted) continue;
      if (s.claimed || slotDone(s) || !hits(s.kind, s.target)) continue;
      s.got++;
      changed = true;
    }
    if (changed) store.put(b.token, { quests: b.q });
    const st = this.storyOf(b.token);
    const c = STORY[st.ch];
    if (c && st.taken && st.got < c.need && hits(c.kind, c.target)) {
      store.put(b.token, { story: { ch: st.ch, got: st.got + 1, taken: true } });
      changed = true;
    }
    const w = this.weeklyOf(b.token, p);
    if (w.taken && !w.claimed) {
      let wc = false;
      if (ev.fish && w.fish < WEEKLY.fish) (w.fish++, (wc = true));
      if (ev.campType && w.zone.includes(ev.campType) && w.hunt < WEEKLY.hunt) (w.hunt++, (wc = true));
      if (ev.champ && w.champ < WEEKLY.champ) (w.champ++, (wc = true));
      if (wc) {
        store.put(b.token, { weekly: w });
        changed = true;
      }
    }
    if (!changed) return;
    const cl = this.clientOf(id);
    if (cl) this.sendQuests(cl);
  }

  /** Опыт за задание — от текущего уровня (questXpFrac), mul — вес задания. Текст для тоста. */
  private questXp(client: Client, p: PlayerState, mul: number): string {
    const lvlXp = xpToNext(p.level);
    if (!Number.isFinite(lvlXp)) return "";
    const before = p.level;
    this.awardXp(client, p, Math.round(lvlXp * questXpFrac(p.level) * mul));
    return p.level > before ? `, опыт (+${p.level - before} ур.)` : ", опыт";
  }

  /** Сдать главу сюжета / недельный контракт Охотнику. */
  private hunterClaim(client: Client, p: PlayerState, token: string, act: "storyClaim" | "weeklyClaim"): void {
    const rt = this.rt.get(client.sessionId);
    const xp = (mul: number): string => this.questXp(client, p, mul);
    const tokens = store.get(token)?.tokens ?? 0;
    let note: string;
    if (act === "storyClaim") {
      const st = this.storyOf(token);
      const c = STORY[st.ch];
      if (!c || st.got < c.need) return;
      const bag = readBag(p);
      addToBag(bag, "potion", STORY_REWARD.potions);
      writeBag(p, bag);
      store.put(token, { story: { ch: st.ch + 1, got: 0, taken: false }, tokens: tokens + STORY_REWARD.tokens });
      note = `Глава «${c.title}» пройдена! ${STORY_REWARD.tokens} ◈, зелья ×${STORY_REWARD.potions}${xp(STORY_REWARD.xpMul)}`;
      if (st.ch === STORY.length - 1 && rt) {
        const w = this.rollChestWeapon(p);
        rt.weapons.push(w);
        store.put(token, { weapons: rt.weapons });
        this.grantTitle(token, STORY_TITLE);
        this.announcePickup(p.nick, w.cls, w.tier, w);
        note += `. Титул «${STORY_TITLE}» и ${instanceName(w)} ${instanceStars(w)}!`;
      }
    } else {
      const w = this.weeklyOf(token, p);
      if (w.claimed || !weeklyDone(w) || !rt) return;
      w.claimed = true;
      const wpn = this.rollChestWeapon(p);
      rt.weapons.push(wpn);
      store.put(token, { weekly: w, weapons: rt.weapons, tokens: tokens + WEEKLY.reward.tokens });
      this.bumpFeat(client.sessionId, "contracts", TITLE_GOALS.contracts, "Ветеран контрактов");
      this.announcePickup(p.nick, wpn.cls, wpn.tier, wpn);
      note = `Контракт недели выполнен! ${WEEKLY.reward.tokens} ◈, ${instanceName(wpn)} ${instanceStars(wpn)}${xp(WEEKLY.reward.xpMul)}`;
    }
    this.sendQuests(client, note);
  }

  private questAct(client: Client, msg: QuestActMsg): void {
    const p = this.state.players.get(client.sessionId);
    if (!p || !msg) return;
    const b = this.questBoard(p);
    if (!b) return;
    if (msg.act === "storyTake" || msg.act === "weeklyTake") {
      if (!this.hunterNear(p)) return this.sendQuests(client, "Подойди к Охотнику у выхода из лагеря");
      if (msg.act === "storyTake") {
        const st = this.storyOf(b.token);
        const c = STORY[st.ch];
        if (!c || st.taken) return;
        store.put(b.token, { story: { ch: st.ch, got: 0, taken: true } });
        return this.sendQuests(client, `Взята глава: ${c.title}`);
      }
      const w = this.weeklyOf(b.token, p);
      if (w.taken) return;
      w.taken = true;
      store.put(b.token, { weekly: w });
      return this.sendQuests(client, "Контракт недели взят");
    }
    if (msg.act === "storyClaim" || msg.act === "weeklyClaim") {
      if (!this.hunterNear(p)) return this.sendQuests(client, "Подойди к Охотнику у выхода из лагеря");
      return this.hunterClaim(client, p, b.token, msg.act);
    }
    if (!this.questNear(p)) {
      this.sendQuests(client, "Подойди к доске заданий у выхода из лагеря");
      return;
    }
    const idx = Math.floor(Number(msg.idx));
    let note: string | undefined;
    if (msg.act === "takeDaily") {
      if (b.q.accepted) return;
      b.q.accepted = true;
      note = "Задания дня взяты";
    } else if (msg.act === "take") {
      const o = b.q.offers[idx];
      if (!o || b.q.picksLeft <= 0) return;
      b.q.offers.splice(idx, 1);
      b.q.slots.push(o);
      b.q.picksLeft--;
      note = `Взято: ${slotTitle(o)}`;
    } else if (msg.act === "claim") {
      const s = b.q.slots[idx];
      if (!s || s.claimed || !slotDone(s)) return;
      const r = slotReward(s);
      const bag = readBag(p);
      if (addToBag(bag, "scrap", r.scrap) > 0) {
        this.sendQuests(client, "Сумка полна — освободи место для лома");
        return;
      }
      writeBag(p, bag);
      s.claimed = true;
      const xpNote = this.questXp(client, p, r.xpMul);
      store.put(b.token, { tokens: (store.get(b.token)?.tokens ?? 0) + r.tokens });
      note = `Задание выполнено! ${r.tokens} ◈, лом ×${r.scrap}${xpNote}`;
      const extras: string[] = [];
      if (s.hard && Math.random() < HARD_SCROLL_CHANCE) {
        const sc = this.giveScroll(client, p);
        if (sc) extras.push(sc);
      }
      // Бонус: все автоматические задания дня сданы — свиток.
      const autoN = Math.min(QUEST.auto, b.q.slots.length);
      if (!b.q.allBonus && b.q.slots.slice(0, autoN).every((x) => x.claimed)) {
        b.q.allBonus = true;
        const sc = this.giveScroll(client, p);
        if (sc) extras.push(`${sc} (бонус за все задания дня)`);
      }
      if (extras.length) note += ` + ${extras.join(", ")}`;
    } else return;
    store.put(b.token, { quests: b.q });
    this.sendQuests(client, note);
  }

  private sendPcInv(client: Client): void {
    const p = this.state.players.get(client.sessionId);
    const rt = this.rt.get(client.sessionId);
    if (!p || !rt) return;
    client.send(MSG.pcInvData, this.pcInvDataFor(p, rt));
  }

  /** Данные окна снаряжения (ПК/телефон и страница !inv) по живому герою. */
  private pcInvDataFor(p: PlayerState, rt: Runtime): PcInvData {
    const bag = readBag(p);
    const rec = store.get(`nick:${normNick(p.nick)}`);
    const affOf = (id: string | null): string => {
      const w = id ? rt.weapons.find((x) => x.id === id) : undefined;
      return heldAffixText(w);
    };
    const heldR = rolledIn(p, "right", rt)?.id ?? null;
    let heldL = rolledIn(p, "left", rt)?.id ?? null;
    if (heldL === heldR) heldL = null; // лук в обеих руках — один экземпляр
    const data: PcInvData = {
      weapons: rt.weapons.map((w) => ({
        id: w.id,
        cls: w.cls,
        tier: w.tier,
        name: instanceName(w),
        affixes: instanceLabels(w),
        effects: instanceEffects(w),
        quality: weaponQuality(w),
        scrap: scrapValue(w),
        ench: w.affixes.map((a, i) => ({ label: affixLabel(a), ...enchantInfo(w, i)! })),
        fuel: isRubyFuel(w),
        fav: !!w.fav,
      })),
      // Что реально считается в руке (закреплённое или лучший экземпляр того же вида) —
      // иначе незакреплённое надетое оружие показывалось ещё и в сумке.
      equipped: { left: heldL, right: heldR },
      potions: bagCount(bag, "potion"),
      scrap: bagCount(bag, "scrap"),
      fish: bagCount(bag, "fish"),
      scrollXp: bagCount(bag, "scroll_xp"),
      scrollWind: bagCount(bag, "scroll_wind"),
      titles: rec?.titles ?? [],
      title: rec?.title ?? "",
      attrs: { unspent: p.unspent, str: p.str, agi: p.agi, int: p.int, con: p.con, luc: p.luc, wis: p.wis },
      respecCost: RESPEC_ENABLED ? respecCostFor(rec?.respecCount ?? 0) : -1,
      skills: {
        cls: classOf2(p.leftCls as Weapon2 | "", p.rightCls as Weapon2 | "") ?? "",
        chosen: [p.skill1, p.skill2].filter(Boolean),
      },
      jewels: pcInvJewels(this.jewelsFor(rt.token ?? `nick:${normNick(p.nick)}`)),
      giftNotes: store.get(rt.token ?? `nick:${normNick(p.nick)}`)?.giftNotes ?? [],
      trade: tradeViewOf(store.get(rt.token ?? `nick:${normNick(p.nick)}`), rt.token ?? `nick:${normNick(p.nick)}`),
      chatters: this.chatRecentNicks(normNick(p.nick)),
      stats: heroStatRows({
        gb: p.gb,
        level: p.level,
        str: p.str,
        agi: p.agi,
        int: p.int,
        con: p.con ?? 1,
        luc: p.luc ?? 1,
        wis: p.wis ?? 1,
        rightCls: p.rightCls,
        rightTier: p.rightTier,
        leftCls: p.leftCls,
        leftTier: p.leftTier,
        rightAffix: affOf(heldR),
        leftAffix: affOf(heldL),
      }),
      tokens: rec?.tokens ?? 0,
    };
    return data;
  }

  /** Строка чата — в журнал игроков (спектаторам не нужна: у них свой оверлей). */
  private sendChatLine(m: ChatLineMsg): void {
    this.chatHistory.push(m);
    if (this.chatHistory.length > 30) this.chatHistory.shift();
    for (const c of this.clients) if (!this.spectators.has(c.sessionId)) c.send(MSG.chatLine, m);
  }

  /** Последние строки чата — новому игроку при входе (панель чата не пустая). */
  private readonly chatHistory: ChatLineMsg[] = [];

  /** Русское имя атрибута для чата. */
  private static statName(stat: StatName): string {
    return STAT_RU[stat];
  }

  /** Антиспам подсказок для ников без активного бота. */
  private hintOk(norm: string): boolean {
    const now = Date.now();
    if (now - (this.hintAt.get(norm) ?? 0) < BOT.statsCooldown * 1000) return false;
    this.hintAt.set(norm, now);
    return true;
  }

  /**
   * Объявление в чат о подобранном золотом/легендарном оружии — с роллами,
   * если они есть. База не объявляем (не редкость, и не дропается вообще).
   */
  private announcePickup(
    nick: string,
    cls: WeaponClass,
    tier: WeaponTier,
    instance?: WeaponInstance,
  ): void {
    if (tier === "base") return;
    const name = instance ? instanceName(instance) : weaponDef(cls, tier).name;
    const affixes = instance ? instanceLabels(instance).join(", ") : "";
    // Не в чат Twitch (засорял) — строкой в кил-фид спектатора.
    this.broadcast(MSG.pickupFeed, {
      nick,
      item: name,
      tier: tier === "ruby" || tier === "legendary" ? tier : "gold",
      aff: affixes,
    } satisfies PickupFeedMsg);
  }

  /** Живой персонаж (бот ИЛИ реально подключённый игрок) по нику — для веб-инвентаря. */
  private findWeaponsTarget(norm: string): { id: string; p: PlayerState; rt: Runtime } | null {
    const bot = this.bots.get(norm);
    if (bot) return { id: bot.id, p: bot.state, rt: bot.rt };
    for (const [id, p] of this.state.players) {
      if (normNick(p.nick) !== norm) continue;
      const rt = this.rt.get(id);
      if (rt) return { id, p, rt };
    }
    return null;
  }

  /**
   * `!inv` — ссылка на веб-инвентарь `/inv?ник`. Менять там что-то можно
   * только после кода из чата (см. invHub) — токенов в адресе больше нет.
   */
  private sayInvLink(nick: string, norm: string): void {
    if (!this.findWeaponsTarget(norm) && !store.get(`nick:${norm}`)) {
      if (this.hintOk(norm)) this.reply(`@${nick} у тебя ещё нет героя — сначала !play.`);
      return;
    }
    this.reply(`@${nick} твой инвентарь: http://zepgame.duckdns.org/inv?${encodeURIComponent(norm)}`);
  }

  /** Сохранить живого героя этого ника в store (бот или подключённый игрок). */
  /** id героя этого ника в мире: бот или живая сессия ("" — нет). */
  private heroIdOf(norm: string): string {
    const bot = this.bots.get(norm);
    if (bot) return bot.id;
    let id = "";
    this.state.players.forEach((p, pid) => {
      if (!id && !pid.startsWith("bot:") && normNick(p.nick) === norm) id = pid;
    });
    return id;
  }

  // ---------------------------------------------------------------- кольца и камни (shared/jewels.ts)

  /** Кольца/камни героя по токену записи (живой герой и сейв — одна запись). */
  private jewelsFor(token: string): JewelSave {
    return jewelsOf(store.get(token) ?? {});
  }

  /** Прибавку от надетых колец — в PlayerState.gb; потолки HP/маны пересчитать (доля HP та же). */
  private applyJewels(id: string): void {
    const p = this.state.players.get(id);
    const rt = this.rt.get(id);
    if (!p || !rt) return;
    const b = jewelBonus(this.jewelsFor(rt.token ?? `nick:${normNick(p.nick)}`));
    const g = p.gb;
    if (g.str === b.str && g.agi === b.agi && g.int === b.int && g.con === b.con && g.luc === b.luc && g.wis === b.wis && g.rings === b.rings) return;
    g.str = b.str;
    g.agi = b.agi;
    g.int = b.int;
    g.con = b.con;
    g.luc = b.luc;
    g.wis = b.wis;
    g.rings = b.rings;
    if (p.towerFloor > 0) return; // в башне свой потолок HP — вернётся с арены по maxHpFor
    const frac = p.maxHp > 0 ? p.hp / p.maxHp : 1;
    p.maxHp = maxHpFor(p.level, p);
    if (!p.dead) p.hp = Math.max(1, Math.min(p.maxHp, p.maxHp * frac));
    p.maxMana = maxManaFor(p.level, p);
    p.mana = Math.min(p.mana, p.maxMana);
  }

  /** Кольцо/камень с добитого моба — сразу в запись героя (не на землю: боты и игроки одинаково). */
  private jewelDrop(owner: string, mul: number): void {
    const d = rollJewelDrop(mul);
    if (!d.gem && !d.ring) return;
    const p = this.state.players.get(owner);
    const rt = this.rt.get(owner);
    if (!p || !rt) return;
    const token = rt.token ?? `nick:${normNick(p.nick)}`;
    if (!store.get(token)) return;
    const js = this.jewelsFor(token);
    const got: string[] = [];
    if (d.gem) {
      js.gems[d.gem] = (js.gems[d.gem] ?? 0) + 1;
      got.push(gemName(d.gem));
    }
    if (d.ring) {
      js.rings.push({ id: randomUUID().slice(0, 8), tier: d.ring, gems: Array.from({ length: RING_LOOK[d.ring].sockets }, () => null) });
      got.push(ringName({ tier: d.ring }));
      // Золотое/уникальное кольцо — строкой в кил-фид всем (как подобранное редкое оружие).
      if (d.ring !== "base") {
        this.broadcast(MSG.pickupFeed, { nick: p.nick, item: ringName({ tier: d.ring }), tier: d.ring === "legendary" ? "legendary" : "gold", aff: "" } satisfies PickupFeedMsg);
      }
    }
    store.put(token, { rings: js.rings, ringOn: js.ringOn, gems: js.gems });
    this.clientOf(owner)?.send(MSG.jewelGot, { text: got.join(", ") });
    // В забеге катакомб — и в итоговую таблицу добычи.
    if (d.gem) this.cat.noteLoot(owner, { id: "scrap", count: 1, jw: d.gem });
    if (d.ring) this.cat.noteLoot(owner, { id: "scrap", count: 1, jw: `ring:${d.ring}` });
  }

  /** Действие с кольцами/камнями (окно инвентаря на всех платформах и страница !inv). */
  private jewelAct(norm: string, act: JewelAct, id: string, idx: number, fuel?: string): InvActResult {
    const op = jewelOpFrom(act, id, idx, fuel);
    if (!op) return { ok: false, text: "Не понял действие." };
    const t = this.findWeaponsTarget(norm);
    const token = t?.rt.token ?? `nick:${norm}`;
    const rec = store.get(token);
    if (!rec) return { ok: false, text: "Героя нет — напиши !play в чате." };
    const js = jewelsOf(rec);
    const bag = t ? readBag(t.p) : restoreBag(rec.bag);
    const r = applyJewelOp(js, op, bagCount(bag, "scrap"));
    if (!r.ok) return { ok: false, text: r.text };
    const patch: Partial<PlayerRecord> = { rings: js.rings, ringOn: js.ringOn, gems: js.gems };
    if (r.scrap) {
      if (r.scrap > 0) addToBag(bag, "scrap", r.scrap);
      else takeFromBag(bag, "scrap", -r.scrap);
      if (t) writeBag(t.p, bag);
      else patch.bag = bag;
    }
    store.put(token, patch);
    if (t) {
      this.applyJewels(t.id);
      if (r.scrap) this.persistNick(norm);
    }
    return { ok: true, text: r.text };
  }

  // ---------------------------------------------------------------- подарки (server/trade.ts — основа и для обмена)

  /** Живой герой с этой записью (токен): id в state.players, или null — героя нет в мире. */
  private liveByToken(token: string): { id: string; p: PlayerState; rt: Runtime } | null {
    for (const [id, rt] of this.rt) {
      const p = this.state.players.get(id);
      // У бота токена может не быть — его запись «nick:<ник>».
      if (p && (rt.token ?? `nick:${normNick(p.nick)}`) === token) return { id, p, rt };
    }
    return null;
  }

  /** Токен записи героя по нику: живой → его запись; иначе запись зрителя «nick:…»; иначе самая свежая с этим ником. */
  private tokenByNick(nick: string): { token: string; nick: string } | null {
    const norm = normNick(nick);
    if (!norm) return null;
    const t = this.findWeaponsTarget(norm);
    if (t) return { token: t.rt.token ?? `nick:${norm}`, nick: t.p.nick };
    const rec = store.get(`nick:${norm}`);
    if (rec) return { token: rec.token, nick: rec.nick || nick };
    let best: PlayerRecord | null = null;
    for (const r of store.entries()) if (normNick(r.nick) === norm && (!best || r.updatedAt > best.updatedAt)) best = r;
    return best ? { token: best.token, nick: best.nick } : null;
  }

  /** Снимок инвентаря героя для передачи: живой — из мира (оружие — тот же массив), иначе из сохранения. */
  private openInv(token: string): InvSnap | null {
    const live = this.liveByToken(token);
    const rec = store.get(token);
    if (live) return { weapons: live.rt.weapons, heldIds: this.liveHeldIds(live.p, live.rt), bag: readBag(live.p), jewels: jewelsOf(rec ?? {}) };
    if (!rec) return null;
    return { weapons: [...(rec.weapons ?? [])], heldIds: recHeldIds(rec), bag: restoreBag(rec.bag), jewels: jewelsOf(rec) };
  }

  /** Записать снимок обратно (живому — в мир и сохранение, иначе — в сохранение). */
  private commitInv(token: string, snap: InvSnap): void {
    const j = { rings: snap.jewels.rings, ringOn: snap.jewels.ringOn, gems: snap.jewels.gems };
    const live = this.liveByToken(token);
    if (!live) {
      store.put(token, { weapons: snap.weapons, bag: snap.bag, ...j });
      return;
    }
    writeBag(live.p, snap.bag);
    store.put(token, j);
    this.applyJewels(live.id);
    this.syncWarehouse(live.id, live.rt);
    const bot = live.id.startsWith("bot:") ? this.bots.get(normNick(live.p.nick)) : undefined;
    if (bot) this.persistBot(bot);
    else {
      const c = this.clientOf(live.id);
      if (c) this.persist(c);
    }
  }

  /**
   * Подарок: предмет от героя ника `norm` — герою с ником `toNick`, сразу (получатель может быть
   * не в мире — ляжет в его сохранение). Без налога и ограничений по уровню; каждая передача — в журнал.
   */
  private giftAct(norm: string, code: string, count: number, toNick: string): InvActResult {
    const item = parseTradeItem(code, count);
    if (!item) return { ok: false, text: "Не понял, что подарить." };
    const t = this.findWeaponsTarget(norm);
    const from = { token: t?.rt.token ?? `nick:${norm}`, nick: t?.p.nick ?? store.get(`nick:${norm}`)?.nick ?? norm };
    const to = this.tokenByNick(toNick.replace(/^@/, "").trim());
    if (!to) return { ok: false, text: `Героя «${toNick}» нет — проверь ник.` };
    if (to.token === from.token) return { ok: false, text: "Себе подарить нельзя." };
    const a = this.openInv(from.token);
    const b = this.openInv(to.token);
    if (!a) return { ok: false, text: "Героя нет — напиши !play в чате." };
    if (!b) return { ok: false, text: `Героя «${toNick}» нет — проверь ник.` };
    const r = takeItems(a, [item]);
    if ("error" in r) return { ok: false, text: r.error };
    giveItems(b, r.taken);
    this.commitInv(from.token, a);
    this.commitInv(to.token, b);
    tradeLog({ kind: "gift", from, to, items: r.taken });
    const what = r.taken.map(takenName).join(", ");
    // Непрочитанное — до «Понятно» в инвентаре (последние 20).
    const notes = [...(store.get(to.token)?.giftNotes ?? []), { from: from.nick, text: what, at: Date.now() }].slice(-20);
    store.put(to.token, { giftNotes: notes });
    const rc = this.liveByToken(to.token);
    const client = rc ? this.clientOf(rc.id) : undefined;
    if (client) client.send(MSG.giftGot, { from: from.nick, text: what });
    else this.reply(`@${to.nick} тебе подарок от ${from.nick}: ${what}`);
    console.log(`[trade] подарок ${from.nick} → ${to.nick}: ${what}`);
    return { ok: true, text: `Подарено ${to.nick}: ${what}` };
  }

  // ---------------------------------------------------------------- обмен между героями (окно двух, подтверждают оба)

  /** Действия обмена: открыть, добавить или убрать свои предметы, подтвердить, отменить. */
  private tradeAct(norm: string, act: TradeAct, id: string, idx: number, fuel: string): InvActResult {
    const t = this.findWeaponsTarget(norm);
    const me = { token: t?.rt.token ?? `nick:${norm}`, nick: t?.p.nick ?? store.get(`nick:${norm}`)?.nick ?? norm };
    if (act === "tradeOpen" || act === "tradeAdd") {
      const items = parseTradeList(fuel);
      if (!items) return { ok: false, text: "Не понял, какие предметы." };
      return act === "tradeOpen" ? this.tradeOpen(me, id, items) : this.tradeAdd(me, id, items);
    }
    if (act === "tradeRemove") return this.tradeRemoveAt(me, id, idx);
    if (act === "tradeConfirm") return this.tradeConfirm(me, id);
    return this.tradeCancel(me, id);
  }

  /** Герои, писавшие в чат за последний час (без ботов и себя), свежие первыми. */
  private chatRecentNicks(exceptNorm: string): string[] {
    const windowMs = 60 * 60 * 1000;
    const now = Date.now();
    const rows: { nick: string; at: number }[] = [];
    for (const [norm, at] of this.chatLast) {
      if (now - at > windowMs) {
        this.chatLast.delete(norm);
        continue;
      }
      if (norm === exceptNorm || this.bots.has(norm)) continue;
      const rec = store.get(`nick:${norm}`);
      if (!rec) continue; // писал, но героя нет — не с кем обмениваться
      rows.push({ nick: rec.nick || norm, at });
    }
    return rows.sort((x, y) => y.at - x.at).map((r) => r.nick);
  }

  /** Копия обмена, в котором участвует герой (правки — только через putTrade). */
  private tradeFor(token: string, id: string): TradeSession | null {
    const s = (store.get(token)?.trades ?? []).find((x) => x.id === id);
    return s ? structuredClone(s) : null;
  }

  /** Записать обмен обоим участникам — каждому своя копия одного состояния. */
  private putTrade(s: TradeSession): void {
    for (const tk of [s.a.token, s.b.token]) {
      const r = store.get(tk);
      if (r) store.put(tk, { trades: [...(r.trades ?? []).filter((x) => x.id !== s.id), structuredClone(s)] });
    }
  }

  /** Убрать обмен у обоих участников. */
  private dropTrade(s: TradeSession): void {
    for (const tk of [s.a.token, s.b.token]) {
      const r = store.get(tk);
      if (r) store.put(tk, { trades: (r.trades ?? []).filter((x) => x.id !== s.id) });
    }
  }

  /** Сторона героя и сторона собеседника. */
  private tradeSides(s: TradeSession, token: string): { mine: TradeSide; theirs: TradeSide } {
    return s.a.token === token ? { mine: s.a, theirs: s.b } : { mine: s.b, theirs: s.a };
  }

  /** Подсказка тому, кто сейчас в игре (его окно обновится само). */
  private tradeNotify(token: string, text: string): void {
    const rc = this.liveByToken(token);
    const client = rc ? this.clientOf(rc.id) : undefined;
    if (client) client.send(MSG.pcInvResult, { ok: true, text });
  }

  /** Добавить предмет в сторону: одинаковые стопки складываются. */
  private addToSide(side: TradeSide, t: Taken): void {
    if (t.k === "gem") {
      const e = side.items.find((x): x is Extract<Taken, { k: "gem" }> => x.k === "gem" && x.key === t.key);
      if (e) {
        e.n += t.n;
        return;
      }
    }
    if (t.k === "bag") {
      const e = side.items.find((x): x is Extract<Taken, { k: "bag" }> => x.k === "bag" && x.item === t.item);
      if (e) {
        e.n += t.n;
        return;
      }
    }
    side.items.push(t);
  }

  /** Открыть обмен с героем по нику; свои предметы можно сразу или добавить позже. */
  private tradeOpen(me: { token: string; nick: string }, toNick: string, items: TradeItem[]): InvActResult {
    const to = this.tokenByNick(toNick.replace(/^@/, "").trim());
    if (!to) return { ok: false, text: `Героя «${toNick}» нет — проверь ник.` };
    if (to.token === me.token) return { ok: false, text: "Себе обмен не открыть." };
    if ((store.get(me.token)?.trades ?? []).some((s) => s.a.token === to.token || s.b.token === to.token)) {
      return { ok: false, text: `Обмен с ${to.nick} уже открыт — открой его в «Обмен».` };
    }
    const snap = this.openInv(me.token);
    if (!snap) return { ok: false, text: "Героя нет — напиши !play в чате." };
    const mine: Taken[] = [];
    if (items.length) {
      const r = takeItems(snap, items);
      if ("error" in r) return { ok: false, text: r.error };
      mine.push(...r.taken);
      this.commitInv(me.token, snap);
    }
    const s: TradeSession = {
      id: Math.random().toString(36).slice(2, 10),
      a: { nick: me.nick, token: me.token, items: mine, ok: false },
      b: { nick: to.nick, token: to.token, items: [], ok: false },
      at: Date.now(),
    };
    this.putTrade(s);
    this.tradeNotify(to.token, `${me.nick} открыл с тобой обмен — загляни в «Обмен»`);
    return { ok: true, text: `Обмен с ${to.nick} открыт${mine.length ? ` · в обмене: ${mine.map(takenName).join(", ")}` : ""}` };
  }

  /** Добавить свои предметы в обмен: они уходят из инвентаря; подтверждения сбрасываются. */
  private tradeAdd(me: { token: string; nick: string }, id: string, items: TradeItem[]): InvActResult {
    const s = this.tradeFor(me.token, id);
    if (!s) return { ok: false, text: "Обмен уже закрыт." };
    const snap = this.openInv(me.token);
    if (!snap) return { ok: false, text: "Героя нет — напиши !play в чате." };
    const r = takeItems(snap, items);
    if ("error" in r) return { ok: false, text: r.error };
    this.commitInv(me.token, snap);
    const { mine, theirs } = this.tradeSides(s, me.token);
    for (const t of r.taken) this.addToSide(mine, t);
    s.a.ok = false;
    s.b.ok = false;
    this.putTrade(s);
    this.tradeNotify(theirs.token, `${me.nick} изменил предложение в обмене — проверь`);
    return { ok: true, text: `В обмен: ${r.taken.map(takenName).join(", ")}` };
  }

  /** Убрать свой предмет из обмена: он возвращается в инвентарь; подтверждения сбрасываются. */
  private tradeRemoveAt(me: { token: string; nick: string }, id: string, idx: number): InvActResult {
    const s = this.tradeFor(me.token, id);
    if (!s) return { ok: false, text: "Обмен уже закрыт." };
    const { mine, theirs } = this.tradeSides(s, me.token);
    const t = mine.items[idx];
    if (!t) return { ok: false, text: "Этого предмета уже нет в обмене." };
    const snap = this.openInv(me.token);
    if (!snap) return { ok: false, text: "Героя нет — напиши !play в чате." };
    giveItems(snap, [t]);
    this.commitInv(me.token, snap);
    mine.items.splice(idx, 1);
    s.a.ok = false;
    s.b.ok = false;
    this.putTrade(s);
    this.tradeNotify(theirs.token, `${me.nick} убрал предмет из обмена`);
    return { ok: true, text: `Убрано из обмена: ${takenName(t)}` };
  }

  /** Подтвердить. Когда оба подтвердили — предметы меняются местами. */
  private tradeConfirm(me: { token: string; nick: string }, id: string): InvActResult {
    const s = this.tradeFor(me.token, id);
    if (!s) return { ok: false, text: "Обмен уже закрыт." };
    const { mine, theirs } = this.tradeSides(s, me.token);
    mine.ok = true;
    if (!theirs.ok) {
      this.putTrade(s);
      this.tradeNotify(theirs.token, `${me.nick} подтвердил обмен — подтверди и ты`);
      return { ok: true, text: `Ты подтвердил — ждём, пока подтвердит ${theirs.nick}` };
    }
    // Оба подтвердили: проверяем, что оба героя на месте, и только потом меняем.
    const snapA = this.openInv(s.a.token);
    const snapB = this.openInv(s.b.token);
    if (!snapA || !snapB) return { ok: false, text: `У ${!snapA ? s.a.nick : s.b.nick} нет героя — обмен не прошёл.` };
    const gave = mine.items.map(takenName);
    const got = theirs.items.map(takenName);
    giveItems(snapB, s.a.items);
    giveItems(snapA, s.b.items);
    this.commitInv(s.a.token, snapA);
    this.commitInv(s.b.token, snapB);
    this.dropTrade(s);
    tradeLog({ kind: "trade", from: { nick: s.a.nick, token: s.a.token }, to: { nick: s.b.nick, token: s.b.token }, items: s.a.items });
    if (s.b.items.length) tradeLog({ kind: "trade", from: { nick: s.b.nick, token: s.b.token }, to: { nick: s.a.nick, token: s.a.token }, items: s.b.items });
    this.tradeNotify(theirs.token, `Обмен с ${me.nick} выполнен`);
    return { ok: true, text: `Обмен с ${theirs.nick} выполнен: получено ${got.join(", ") || "ничего"}; отдано ${gave.join(", ") || "ничего"}` };
  }

  /** Отменить обмен: предметы каждого возвращаются ему. */
  private tradeCancel(me: { token: string; nick: string }, id: string): InvActResult {
    const s = this.tradeFor(me.token, id);
    if (!s) return { ok: false, text: "Обмен уже закрыт." };
    const { theirs } = this.tradeSides(s, me.token);
    const snapA = this.openInv(s.a.token);
    const snapB = this.openInv(s.b.token);
    if (!snapA || !snapB) return { ok: false, text: `У ${!snapA ? s.a.nick : s.b.nick} нет героя — обмен пока не отменить.` };
    giveItems(snapA, s.a.items);
    giveItems(snapB, s.b.items);
    this.commitInv(s.a.token, snapA);
    this.commitInv(s.b.token, snapB);
    this.dropTrade(s);
    this.tradeNotify(theirs.token, `${me.nick} отменил обмен — предметы вернулись`);
    return { ok: true, text: `Обмен с ${theirs.nick} отменён — предметы вернулись` };
  }

  private persistNick(norm: string): void {
    const bot = this.bots.get(norm);
    if (bot) {
      this.persistBot(bot);
      return;
    }
    const t = this.findWeaponsTarget(norm);
    const client = t ? this.clientOf(t.id) : undefined;
    if (client) this.persist(client);
  }

  /**
   * Действие с веб-страницы инвентаря. Герой в мире — меняем живое состояние
   * (как и раньше в чате), иначе правим сейв напрямую: при следующем !play
   * герой выйдет уже с этим.
   */
  private invAct(norm: string, act: InvActKind, id: string, idx: number, fuel?: string): InvActResult {
    if ((JEWEL_ACTS as readonly string[]).includes(act)) return this.jewelAct(norm, act as JewelAct, id, idx, fuel);
    if (act === "gift") return this.giftAct(norm, id, idx, fuel ?? "");
    if ((TRADE_ACTS as readonly string[]).includes(act)) return this.tradeAct(norm, act as TradeAct, id, idx, fuel ?? "");
    if (act === "giftSeen") {
      const t = this.findWeaponsTarget(norm);
      store.put(t?.rt.token ?? `nick:${norm}`, { giftNotes: [] });
      return { ok: true, text: "" };
    }
    const t = this.findWeaponsTarget(norm);
    if (act === "skills") return this.chooseSkills(norm, t?.p ?? null, id.split(","));
    if (act === "unequip") {
      // Снять с руки на склад (idx 1 — левая). Правила рук — shared/hands.ts.
      const side = idx === 1 ? "left" : "right";
      if (t) {
        const err = applyUnequip(t.p, t.rt, side);
        if (err) return { ok: false, text: err };
        this.persistNick(norm);
        return { ok: true, text: "Снято на склад" };
      }
      const token = `nick:${norm}`;
      const rec = store.get(token);
      if (!rec) return { ok: false, text: "Героя нет — напиши !play в чате." };
      const held = sanitizeHeld(rec.held);
      const hands: Hands = {
        rightCls: held.right?.cls ?? "",
        rightTier: held.right?.tier ?? "",
        leftCls: held.left?.cls ?? "",
        leftTier: held.left?.tier ?? "",
      };
      const weapons = [...(rec.weapons ?? [])];
      const equipped = sanitizeEquipped(rec.equippedWeaponId);
      const err = applyUnequip(hands, { weapons, equippedWeaponId: equipped }, side);
      if (err) return { ok: false, text: err };
      const carried = (cls: string, tier: string): CarriedWeapon | null =>
        isWeaponClass(cls) && isWeaponTier(tier) ? { cls, tier } : null;
      store.put(token, {
        weapons,
        equippedWeaponId: equipped,
        held: { left: carried(hands.leftCls, hands.leftTier), right: carried(hands.rightCls, hands.rightTier) },
      });
      return { ok: true, text: "Снято на склад (герой выйдет так при !play)" };
    }
    if (act === "title") {
      const token = `nick:${norm}`;
      const have = store.get(token)?.titles ?? [];
      if (id !== "-" && !have.includes(id)) return { ok: false, text: "Такого титула нет." };
      store.put(token, { title: id === "-" ? "" : id });
      return { ok: true, text: id === "-" ? "Титул снят" : `Титул «${id}»` };
    }
    if (act === "scroll") {
      if (id !== "scroll_xp" && id !== "scroll_wind") return { ok: false, text: "Нет такого свитка." };
      const token = `nick:${norm}`;
      const rec = store.get(token);
      if (!rec) return { ok: false, text: "Героя нет — напиши !play в чате." };
      const key = id === "scroll_xp" ? "scrollXpUntil" : "scrollWindUntil";
      const left = (rec[key] ?? 0) - Date.now();
      if (left > 0) return { ok: false, text: `${ITEMS[id].name} уже действует — ещё ${Math.ceil(left / 60000)} мин` };
      // Герой в мире — сумка в его состоянии; нет — в сохранении.
      const bag = t ? readBag(t.p) : restoreBag(rec.bag);
      const slot = bag.findIndex((s) => s.item === id && s.count > 0);
      if (slot < 0) return { ok: false, text: "Такого свитка в сумке нет." };
      takeOne(bag, slot);
      if (t) writeBag(t.p, bag);
      store.put(token, { [key]: Date.now() + SCROLL.sec * 1000, ...(t ? {} : { bag }) });
      if (t) this.persistNick(norm);
      return { ok: true, text: `${ITEMS[id].name}: действует ${SCROLL.sec / 60} мин` };
    }
    if (act === "respec") {
      const r = this.respecNick(norm);
      return { ok: r.ok, text: r.ok ? "Атрибуты сброшены" : r.text };
    }
    if (act === "stat") {
      if (!isStatName(id)) return { ok: false, text: "Нет такого атрибута." };
      const name = ZoneRoom.statName(id);
      if (t) {
        const n = this.spendStats(t.p, id, Math.max(1, idx), this.bots.has(norm));
        if (n === 0) return { ok: false, text: "Свободных очков нет — их дают за уровень." };
        this.persistNick(norm);
        store.put(`nick:${norm}`, { manualAttrs: true });
        return { ok: true, text: `${name} +${n}` };
      }
      const token = `nick:${norm}`;
      const rec = store.get(token);
      if (!rec) return { ok: false, text: "Героя нет — напиши !play в чате." };
      const prog: Progress = { level: rec.level, xp: rec.xp, unspent: rec.unspent, str: rec.str, agi: rec.agi, int: rec.int, con: rec.con ?? 1, luc: rec.luc ?? 1, wis: rec.wis ?? 1 };
      let n = 0;
      while (n < Math.max(1, idx) && spendPoint(prog, id)) n++;
      if (n === 0) return { ok: false, text: "Свободных очков нет — их дают за уровень." };
      store.put(token, { unspent: prog.unspent, str: prog.str, agi: prog.agi, int: prog.int, con: prog.con, luc: prog.luc, wis: prog.wis, manualAttrs: true });
      return { ok: true, text: `${name} +${n}` };
    }
    if (act === "fav") {
      // ★ Избранное: звёздочка у экземпляра (герой в мире — живой склад, иначе сейв).
      const list = t ? t.rt.weapons : store.get(`nick:${norm}`)?.weapons;
      const w = list?.find((x) => x.id === id);
      if (!list || !w) return { ok: false, text: "Этого предмета уже нет на складе." };
      if (w.fav) delete w.fav;
      else if (list.filter((x) => x.fav).length >= FAV_MAX) return { ok: false, text: `Избранное заполнено — ${FAV_MAX} из ${FAV_MAX}. Сначала убери что-нибудь оттуда.` };
      else w.fav = true;
      if (t) this.persistNick(norm);
      else store.put(`nick:${norm}`, { weapons: list });
      return { ok: true, text: w.fav ? `★ В избранном: ${instanceName(w)} — не разбирается` : `Убрано из избранного: ${instanceName(w)}` };
    }
    if (act === "scrapAll") {
      // Разобрать всё, кроме избранного ★ и того, что в руках (кнопка внизу инвентаря).
      if (t) {
        const held = this.liveHeldIds(t.p, t.rt);
        // Рубиновые массовой разборкой не трогаем — только поштучно.
        const targets = t.rt.weapons.filter((w) => !w.fav && w.tier !== "ruby" && !held.has(w.id));
        if (!targets.length) return { ok: false, text: "Разбирать нечего — всё в избранном или в руках." };
        let got = 0;
        for (const w of targets) got += this.scrapOne(t, w);
        const bag = readBag(t.p);
        addToBag(bag, "scrap", got);
        writeBag(t.p, bag);
        this.persistNick(norm);
        return { ok: true, text: `Разобрано ${targets.length} — лом +${got}` };
      }
      const token = `nick:${norm}`;
      const rec = store.get(token);
      if (!rec) return { ok: false, text: "Героя нет — напиши !play в чате." };
      const weapons = rec.weapons ?? [];
      const held = recHeldIds(rec);
      const targets = weapons.filter((w) => !w.fav && w.tier !== "ruby" && !held.has(w.id));
      if (!targets.length) return { ok: false, text: "Разбирать нечего — всё в избранном или в руках." };
      const bag = restoreBag(rec.bag);
      let got = 0;
      for (const w of targets) got += scrapValue(w);
      addToBag(bag, "scrap", got);
      store.put(token, { weapons: weapons.filter((w) => !targets.includes(w)), bag });
      return { ok: true, text: `Разобрано ${targets.length} — лом +${got}` };
    }
    if (act === "enchant") {
      if (t) {
        const w = t.rt.weapons.find((x) => x.id === id);
        if (!w) return { ok: false, text: "Этого предмета уже нет на складе." };
        const bag = readBag(t.p);
        const r = enchantTry(w, idx, bag, t.rt.weapons, this.liveHeldIds(t.p, t.rt), fuel);
        if (r.enchant) {
          writeBag(t.p, bag);
          this.persistNick(norm);
          if (w.tier === "ruby" && !t.id.startsWith("bot:")) this.syncWarehouse(t.id, t.rt);
        }
        return r;
      }
      const token = `nick:${norm}`;
      const rec = store.get(token);
      const w = rec?.weapons?.find((x) => x.id === id);
      if (!rec || !w) return { ok: false, text: "Этого предмета уже нет на складе." };
      const bag = restoreBag(rec.bag);
      const r = enchantTry(w, idx, bag, rec.weapons!, recHeldIds(rec), fuel);
      if (r.enchant) store.put(token, { weapons: rec.weapons, bag });
      return r;
    }
    if (t) {
      const w = t.rt.weapons.find((x) => x.id === id);
      if (!w) return { ok: false, text: "Этого предмета уже нет на складе." };
      const name = instanceName(w);
      if (act === "equip") {
        applyEquip(t.p, t.rt, w, idx === 1 ? "left" : "right");
        this.persistNick(norm);
        return { ok: true, text: `Надето: ${name}` };
      }
      if (w.id === t.rt.equippedWeaponId.left || w.id === t.rt.equippedWeaponId.right) {
        return { ok: false, text: "Это сейчас в руках — сначала надень другое." };
      }
      if (w.fav) return { ok: false, text: `«${name}» в избранном — сначала сними звёздочку.` };
      const got = this.scrapOne(t, w);
      const bag = readBag(t.p);
      addToBag(bag, "scrap", got);
      writeBag(t.p, bag);
      this.persistNick(norm);
      return { ok: true, text: `${name} → лом +${got}` };
    }
    const token = `nick:${norm}`;
    const rec = store.get(token);
    if (!rec) return { ok: false, text: "Героя нет — напиши !play в чате." };
    const weapons = [...(rec.weapons ?? [])];
    const w = weapons.find((x) => x.id === id);
    if (!w) return { ok: false, text: "Этого предмета уже нет на складе." };
    const name = instanceName(w);
    const equipped = sanitizeEquipped(rec.equippedWeaponId);
    if (act === "equip") {
      const held = sanitizeHeld(rec.held);
      const right = held.right ?? { cls: "sword", tier: "base" };
      const hands: Hands = {
        rightCls: right.cls,
        rightTier: right.tier,
        // Вторая рука — как сохранена (пустая так и остаётся: щит сам не надевается).
        leftCls: held.left?.cls ?? "",
        leftTier: held.left?.tier ?? "",
      };
      const owned = new Set(rec.owned ?? []);
      applyEquip(hands, { weapons, equippedWeaponId: equipped, owned }, w, idx === 1 ? "left" : "right");
      const carried = (cls: string, tier: string): CarriedWeapon | null =>
        isWeaponClass(cls) && isWeaponTier(tier) ? { cls, tier } : null;
      store.put(token, {
        weapons,
        equippedWeaponId: equipped,
        owned: [...owned],
        held: { left: carried(hands.leftCls, hands.leftTier), right: carried(hands.rightCls, hands.rightTier) },
      });
      return { ok: true, text: `Надето: ${name} (герой выйдет с ним при !play)` };
    }
    if (w.id === equipped.left || w.id === equipped.right) {
      return { ok: false, text: "Это сейчас в руках — сначала надень другое." };
    }
    if (w.fav) return { ok: false, text: `«${name}» в избранном — сначала сними звёздочку.` };
    const bag = restoreBag(rec.bag);
    const got = scrapValue(w);
    addToBag(bag, "scrap", got);
    store.put(token, { weapons: weapons.filter((x) => x !== w), bag });
    return { ok: true, text: `${name} → лом +${got}` };
  }

  /**
   * Убрать один инстанс из склада + снять с руки, если был надет (рука
   * падает на голую базу того же класса, как при обычном подборе апгрейда).
   * Не пишет бэг/не персистит — при массовой разборке это делает вызывающий
   * один раз на весь пакет, а не по разу на предмет.
   */
  /** Что у живого героя в руках сейчас (закреплённое и реально считающееся в руке). */
  private liveHeldIds(p: PlayerState, rt: Runtime): Set<string | null | undefined> {
    return new Set([rt.equippedWeaponId.left, rt.equippedWeaponId.right, rolledIn(p, "left", rt)?.id, rolledIn(p, "right", rt)?.id]);
  }

  private scrapOne(t: { p: PlayerState; rt: Runtime }, w: WeaponInstance): number {
    const { p, rt } = t;
    const idx = rt.weapons.indexOf(w);
    if (idx < 0) return 0;
    rt.weapons.splice(idx, 1);
    if (rt.equippedWeaponId.left === w.id) {
      rt.equippedWeaponId.left = null;
      p.leftTier = "base";
    }
    if (rt.equippedWeaponId.right === w.id) {
      rt.equippedWeaponId.right = null;
      p.rightTier = "base";
    }
    return scrapValue(w);
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
      p.unspent > 0 ? `свободных очков ${p.unspent} → !str !dex !int !con !luc !wis` : "свободных очков нет";
    this.reply(
      `@${bot.nick} ур.${p.level} · опыт ${xp} · HP ${Math.ceil(p.hp)}/${Math.round(p.maxHp)} · ` +
        `сила ${p.str} · ловкость ${p.agi} · интеллект ${p.int} · телосложение ${p.con} · удача ${p.luc} · мудрость ${p.wis} · ${points} · ${heroStatLine(p)}`,
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
    if (p.unspent < statCost(p, stat)) {
      // Без кулдауна тут был бы флуд отказами, поэтому делим его со !stats.
      const now = Date.now();
      if (now - bot.statsAt < BOT.statsCooldown * 1000) return;
      bot.statsAt = now;
      this.reply(
        p.unspent > 0
          ? `@${bot.nick} ${ZoneRoom.statName(stat)} ${p[stat]} → следующее очко стоит ${statCost(p, stat)}, свободно ${p.unspent}.`
          : `@${bot.nick} свободных очков нет — их дают за новый уровень (${ATTR2.pointsPerLevel} за уровень).`,
      );
      return;
    }

    const want = Math.max(1, Math.min(999, Math.floor(Number(arg)) || 1));
    const done = this.spendStats(p, stat, want, true);
    if (done === 0) return;
    this.persistBot(bot);
    store.put(`nick:${norm}`, { manualAttrs: true });
    const prog = readProgress(p);

    const name = ZoneRoom.statName(stat);
    this.reply(
      `@${bot.nick} ${name} ${prog[stat]}` +
        (done > 1 ? ` (+${done})` : "") +
        ` · осталось очков ${p.unspent}`,
    );
  }

  /**
   * Вложить `want` очков в `stat` живому герою: потолки HP/маны растут сразу
   * (как MSG.spend). `autoClass` — бот на базовом оружии меняет класс под
   * преобладающий атрибут (найденный апгрейд не трогаем). Возвращает, сколько вложено.
   */
  /** Раскидать свободные очки бота по шаблону класса (класс — по оружию в руках). */
  private botAutoSpend(p: PlayerState): void {
    const cls = classOf2(p.leftCls as Weapon2 | "", p.rightCls as Weapon2 | "") ?? "warrior";
    const prog = readProgress(p);
    if (autoSpend(prog, cls) === 0) return;
    writeProgress(p, prog);
    const beforeHp = p.maxHp;
    p.maxHp = maxHpFor(p.level, p);
    p.hp = Math.min(p.maxHp, p.hp + Math.max(0, p.maxHp - beforeHp));
    p.maxMana = maxManaFor(p.level, p);
  }

  private spendStats(p: PlayerState, stat: StatName, want: number, autoClass: boolean): number {
    const prog = readProgress(p);
    let done = 0;
    while (done < want && spendPoint(prog, stat)) done++;
    if (done === 0) return 0;
    writeProgress(p, prog);
    const beforeHp = p.maxHp;
    p.maxHp = maxHpFor(p.level, p);
    p.hp = Math.min(p.maxHp, p.hp + Math.max(0, p.maxHp - beforeHp));
    const beforeMana = p.maxMana;
    p.maxMana = maxManaFor(p.level, p);
    p.mana = Math.min(p.maxMana, p.mana + Math.max(0, p.maxMana - beforeMana));
    // «Классы 2.0»: класс бота больше не следует за атрибутами — его выбирают !class.
    void autoClass;
    return done;
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
    if (!bot && !store.get(`nick:${norm}`)) {
      if (this.hintOk(norm)) this.reply(`@${norm} у тебя ещё нет героя — сначала !play.`);
      return;
    }
    const nick = bot?.nick ?? norm;
    // Без кулдауна отказы (нет рыбы/нечего сбрасывать) флудили бы — делим его со !stats.
    const r = this.respecNick(norm);
    if (!r.ok && bot) {
      const now = Date.now();
      if (now - bot.statsAt < BOT.statsCooldown * 1000) return;
      bot.statsAt = now;
    }
    this.reply(`@${nick} ${r.text}`);
  }

  /**
   * Сброс вложенных очков атрибутов за жетон ◈ (respecCostFor) (чат !respec и кнопка
   * в веб-инвентаре). Герой в мире — живое состояние; иначе правим сейв.
   */
  private respecNick(norm: string): { ok: boolean; text: string } {
    if (!RESPEC_ENABLED) return { ok: false, text: "сброс атрибутов временно выключен." };
    const base = ATTR2.start;
    const token = `nick:${norm}`;
    const rec = store.get(token);
    const done = rec?.respecCount ?? 0;
    const cost = respecCostFor(done);
    const tokens = rec?.tokens ?? 0;
    const costTxt = cost === 0 ? "бесплатно" : `за ${cost} ◈`;
    // Жетоны — за задания дня (доска в лагере); платим до изменений.
    const pay = (): string | null => {
      if (cost > 0 && tokens < cost) return `сброс атрибутов стоит ${cost} ◈ (жетон заданий), у тебя ${tokens} — жетоны дают за задания на доске в лагере.`;
      return null;
    };
    const t = this.findWeaponsTarget(norm);
    if (t) {
      const p = t.p;
      const back = STAT_NAMES.some((k) => p[k] > base);
      if (!back) return { ok: false, text: "очки атрибутов ещё не вложены — сбрасывать нечего." };
      const err = pay();
      if (err) return { ok: false, text: err };
      const prog = readProgress(p);
      resetAttrs(prog);
      writeProgress(p, prog);
      // Потолки HP/маны — от новых (базовых) атрибутов. Оружие не трогаем.
      p.maxHp = maxHpFor(p.level, p);
      p.hp = Math.min(p.hp, p.maxHp);
      p.maxMana = maxManaFor(p.level, p);
      p.mana = Math.min(p.mana, p.maxMana);
      this.persistNick(norm);
      store.put(token, { respecCount: done + 1, tokens: tokens - cost, manualAttrs: true });
      return { ok: true, text: `очки атрибутов сброшены ${costTxt} · свободных очков ${p.unspent} → !str !dex !int !con !luc !wis` };
    }
    if (!rec) return { ok: false, text: "героя нет — напиши !play." };
    const back = STAT_NAMES.some((k) => (rec[k] ?? base) > base);
    if (!back) return { ok: false, text: "очки атрибутов ещё не вложены — сбрасывать нечего." };
    const err = pay();
    if (err) return { ok: false, text: err };
    const fresh = { ...rec };
    resetAttrs(fresh);
    store.put(token, { str: base, agi: base, int: base, con: base, luc: base, wis: base, unspent: fresh.unspent, respecCount: done + 1, tokens: tokens - cost, manualAttrs: true });
    return { ok: true, text: `очки атрибутов сброшены ${costTxt} · свободных очков ${fresh.unspent}` };
  }


  /** Обычная реплика в чате раз в BOT.tipIntervalSec — см. maybeSayTip(). */
  private static readonly TIPS: readonly string[] = [
    "Совет: !inv — веб-инвентарь: оружие с роллами, там же надеть или разобрать на лом (вход — кодом в чат).",
    "Совет: !inv (или !инв, !оружие, !склад) — склад героя на сайте: надеть, разобрать на лом, заточить.",
    "Совет: !follow <ник> или !come — герой встанет рядом и будет защищать тебя, если на тебя нападут.",
    "Совет: у золотого и уникального оружия бывают роллы — урон, скорость атаки, крит, вампиризм (ближний бой), блок (щит).",
    "Совет: !raid — вести героя в рейд на Лунного аватара (гора с водопадом) толпой, !event — на нашествие, !top — таблица лидеров.",
    "Совет: !class ассасин / копейщик / боевой маг / воин / лучник / маг — сменить класс героя (оружие класса — в руки).",
    "Совет: !skills — умения класса; выбрать два: !skills рывок печать (по началу названия).",
    "Совет: шесть атрибутов — !str !dex !int !con !luc !wis; цена очка растёт каждые 10 подъёмов. Бот раскидывает очки сам, пока ты не вложишь их вручную (вернуть — !autostats).",
    "Катакомбы: !катакомбы — отряд от 3 героев спускается в подземелье: волны мертвецов, два стража и Владыка Бездны, каждому — уникальное оружие. Командуй героем: !цель босс, !встать назад, !режим осторожно.",
  ];

  /** Раз во сколько-то минут — случайная подсказка в чат, если герои в мире есть. */
  private maybeSayTip(dt: number): void {
    if (this.bots.size === 0) return; // стрим скорее всего не идёт — не засорять чат
    this.tipClock += dt;
    if (this.tipClock < BOT.tipIntervalSec) return;
    this.tipClock = 0;
    // Через раз — реклама Telegram-канала (и с неё начинаем: рестарты частые, до конца списка дело не доходило).
    const n = this.tipIdx++;
    this.reply(n % 2 === 0 ? TELEGRAM.tips[(n / 2) % TELEGRAM.tips.length] : ZoneRoom.TIPS[((n - 1) / 2) % ZoneRoom.TIPS.length]);
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
        `${BOT.skins}) · !stats — его прогресс · !class — класс (воин, лучник, маг, ассасин, копейщик, боевой маг) · ` +
        "!skills — умения класса (два на выбор) · !str !dex !int !con !luc !wis — атрибуты · " +
        "!respec — вернуть все очки атрибутов (за 1 жетон ◈) · " +
        "!delete — стереть героя и начать заново · !top — таблица лидеров.",
    );
    this.reply(
      "Ещё: !focus — показать своего героя в эфире на 10 с (раз в 10 мин). !title — титулы. !raid — герой идёт в рейд на Лунного аватара (ещё !raid — выйти, пишите " +
        "вместе — идём толпой) · !event — во время нашествия герой бежит туда, " +
        "чистит и возвращается · !cheer/!defeat — эмоции · !follow <ник> / !come — " +
        "идти рядом (и защищает, если на тебя напали) — !unfollow — назад к делам · " +
        "!катакомбы — в отряд катакомб (от 3 героев, сбор 5 мин; там !цель босс|свита|стрелки|слабых, !встать вперёд|назад|фланг, !режим осторожно|агрессивно) · " +
        "!inv — веб-инвентарь (надеть/на лом) · " +
        "!camp <моб> — где качаться · " +
        "!пугало (!dps) — герой минуту бьёт пугало в лагере: над ним DPS и макс. удар · " +
        "!voice <номер|имя> — выбрать голос " +
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
    this.spawnBot(nick, norm, true);
    const p = this.bots.get(norm)?.state;
    this.reply(`@${nick} твой герой вышел в мир, ур.${p?.level ?? 1}. !stop — убрать, !skin — сменить внешность.`);
  }

  /** `fresh` — герой только что заказан командой !play (а не поднят из сейва при рестарте): камера спектатора показывает его чаще. */
  private spawnBot(nick: string, norm: string, fresh = false): void {
    // Героем уже играют живьём (например, старая сессия закрылась ПОСЛЕ входа с другого устройства) —
    // бот-двойник не нужен.
    if (this.nickIsPlayed(norm)) return;
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
      p.con = rec.con ?? 1;
      p.luc = rec.luc ?? 1;
      p.wis = rec.wis ?? 1;
    }
    // Расселение по уровню: слабых — на поляну, прокачанных — к сильным лагерям.
    const campPref = typeof rec?.campPref === "string" && ELITE_MOBS[rec.campPref] ? rec.campPref : null;
    const campRand = Math.random();
    const home = botHome(p.level, campPref, campRand);
    const sp = botSpawnAt(home);
    p.head.x = sp.x;
    p.head.z = sp.z;
    p.head.y = terrainHeight(p.head.x, p.head.z) + PLAYER.eyeHeight;
    p.maxHp = maxHpFor(p.level, p);
    p.hp = p.maxHp;
    p.maxMana = maxManaFor(p.level, p);
    p.mana = p.maxMana;
    // Оружие сохраняем (золотой меч из лута, ранее выданный лук/посох — не
    // должны сбрасываться на каждом !play).
    const savedHeld = sanitizeHeld(rec?.held);
    // Класс по преобладающей характеристике — ТОЛЬКО пока в руке база
    // (нечего терять). Раньше botWeaponFor(str,agi,int) пересчитывал класс
    // на каждом !play и РОНЯЛ на землю честно найденный апгрейд, если билд
    // сменился, — герой мог выйти без легендарки просто из-за того, что
    // вложил очки не в тот стат. Как только герой нашёл gold/legendary,
    // класс дальше выбирает сам игрок, одевая оружие — сохранённый переживает
    // выход как есть.
    const savedRight = savedHeld.right;
    // Закреплённое вручную (веб-инвентарь) — выходит именно оно,
    // а не лучший когда-либо поднятый тир этого класса.
    const pins = sanitizeEquipped(rec?.equippedWeaponId);
    const savedWeapons = Array.isArray(rec?.weapons) ? rec.weapons : [];
    const pinOf = (id: string | null): WeaponInstance | undefined => (id ? savedWeapons.find((w) => w.id === id) : undefined);
    const rawR = pinOf(pins.right);
    const rawL = pinOf(pins.left);
    // Двуручное (лук, посох, копьё, молот) инвентарь закрепляет за любой рукой — лук за левой;
    // раньше такое закрепление бот не видел и выходил с «лучшим» экземпляром, а не выбранным.
    const pinR = rawR && rawR.cls !== "shield" ? rawR : rawL && rawL.cls !== "shield" && bothHandsCls(rawL.cls) ? rawL : undefined;
    // Левая: щит или второй меч/кинжал, который держится вместе с правым.
    const pinL = rawL && rawL !== pinR && (rawL.cls === "shield" || (!!pinR && canHoldTogether(pinR.cls, rawL.cls))) ? rawL : undefined;
    // Класс бота: закреплённое оружие → что было в руках при выходе (это и выбор на ПК, и !class) →
    // класс из !class → у нового героя — случайный из шести.
    const chosen = rec?.botClass && isWeaponClass(rec.botClass) && rec.botClass !== "shield" ? rec.botClass : null;
    const rc = pinR ? pinR.cls : (savedRight?.cls ?? chosen ?? BOT_CLASS_WEAPONS[Math.floor(Math.random() * BOT_CLASS_WEAPONS.length)]);
    // Лучший тир СВОЕГО класса из всего, что герой когда-либо честно поднял
    // (rt.owned/PlayerRecord.owned — копится на весь аккаунт), а не только
    // то, что осталось в руке или спрятано за спиной в VR на момент !stop:
    // подобрал легендарку, убрал за спину поносить базовым — бот всё равно
    // должен выйти с лучшим.
    // Тир: закреплённого — его; в руках был этот класс — тот тир, что держал (выбор игрока); иначе лучший найденный.
    const rightTier = pinR ? pinR.tier : savedRight?.cls === rc ? savedRight.tier : bestOwnedTier(rec?.owned, rc);
    p.rightCls = rc;
    p.rightTier = rightTier;
    // Лук занимает обе руки — без щита; меч/посох — со щитом, лучший
    // когда-либо честно поднятый тир (та же логика, что и для правой руки).
    const leftTier = pinL ? pinL.tier : bestOwnedTier(rec?.owned, "shield");
    // Левая рука: что герой держал в ней при сохранении — как есть, и пустая тоже. Класс по умолчанию
    // (botOffHand: второй кинжал / щит) — только новому герою без сохранённых рук или если правая рука
    // сменилась. Раньше пустая левая у сохранённого героя с кинжалом в правой заполнялась сама.
    // Руки уже сохранялись: есть оружие/владения или занятая рука (у новой записи held пустой по умолчанию).
    const handsSaved = !!rec && ((rec.weapons?.length ?? 0) > 0 || (rec.owned?.length ?? 0) > 0 || !!rec.held?.right || !!rec.held?.left);
    const leftSaved = savedHeld.left?.cls ?? "";
    const off = handsSaved
      ? (canHoldTogether(rc, leftSaved) ? leftSaved : "")
      : (pinR || savedRight?.cls === rc) && canHoldTogether(rc, pinL?.cls ?? leftSaved)
        ? (pinL?.cls ?? leftSaved)
        : botOffHand(rc);
    p.leftCls = off;
    p.leftTier =
      pinL && pinL.cls === off
        ? pinL.tier
        : off === "shield"
          ? leftTier
          : off === "dagger"
            ? (savedHeld.left?.cls === "dagger" ? savedHeld.left.tier : bestOwnedTier(rec?.owned, "dagger"))
            : off === "sword"
              ? (savedHeld.left?.tier ?? "base")
              : "";
    // Сумку восстанавливаем из сейва (restoreBag — как у живого игрока) —
    // раньше тут был emptyBag() с нуля КАЖДЫЙ !play, и весь "Лом" от разборки
    // (и любые другие расходники) стирался при первом же выходе бота в мир
    // после того, как их накопили. Зелья лишь ДОБАВЛЯЕМ до стартового
    // запаса, а не пересоздаём бэг — без него первый бой может не пережить.
    const bag = restoreBag(rec?.bag);
    const potions = bag.reduce((n, s) => n + (s.item === "potion" ? s.count : 0), 0);
    if (potions < BOT.potions) addToBag(bag, "potion", BOT.potions - potions);
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
      massHealAt: -1,
      lastMassHeal: -999,
      lastSkillAt: -999,
      skillAt: {},
      ultAt: -1e9,
      forceCritUntil: -999,
      cryUntil: -999,
      cryKind: 0,
      whirlUntil: -999,
      plagueUntil: -999,
      abyssUntil: -999,
      abyssStrike: false,
      hasteUntil: -999,
      whirlKind: 0,
      skillCls: "",
      yaw: 0,
      // Раньше начиналось пустым — бот "забывал" всё, что честно поднял
      // раньше (см. bestOwnedTier выше). Тот же паттерн, что и для живого
      // игрока при джойне (ниже в этом файле).
      owned: new Set(Array.isArray(rec?.owned) ? rec.owned : []),
      stowed: [],
      overrides: {},
      kills: rec?.kills ?? 0,
      leaveBot: rec?.leaveBot === true,
      // Баффы событий и костра — из сейва: переход ПК ↔ бот их не сбрасывает.
      eventBuffUntil: rec?.eventBuffUntil ?? 0,
      campBuffUntil: rec?.campBuffUntil ?? 0,
      campWarm: 0,
      campHealFxAt: 0,
      stunnedUntil: 0,
      slowUntil: 0,
      slowFrac: 0,
      bleedUntil: 0,
      bleedDps: 0,
      bleedBy: "",
      bleedT: 0,
      lastHitMobId: null,
      lastHitMobAt: 0,
      weapons: Array.isArray(rec?.weapons) ? rec.weapons : [],
      // Закрепления — по рукам как у бота (двуручное — справа), чтобы rolledIn брал выбранный экземпляр.
      equippedWeaponId: { right: pinR?.id ?? null, left: pinL && p.leftCls === pinL.cls ? pinL.id : null },
      viewToken: typeof rec?.viewToken === "string" ? rec.viewToken : "",
      fishBiteAt: null,
      fishAuto: false,
    };
    this.rt.set(id, rt);
    this.applyJewels(id);

    this.bots.set(norm, {
      spawnedAt: fresh ? Date.now() : 0,
      nick: p.nick,
      norm,
      id,
      state: p,
      rt,
      target: null,
      lootTarget: null,
      lootSince: 0,
      lootSkip: new Set<string>(),
      followNorm: null,
      raiding: false,
      eventing: false,
      inTower: false,
      eventDoneAt: 0,
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
      stunCd: 0,
      stunCastT: 0,
      stunSoundDone: false,
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
      campPref,
      campRand,
      fishing: false,
      fishBiteAt: 0,
    });
    console.log(`[bot] + ${p.nick} ур.${p.level} — ботов ${this.bots.size}`);
  }

  // ---- Катакомбы (shared/catacombs.ts, режиссёр — rooms/catacombs.ts) ----

  /** Средний уровень пати последнего спавна — для миньонов финального босса. */
  private catLevel = 1;

  /** Что режиссёру катакомб нужно от комнаты — всё через обычные механизмы мира. */
  /** Выключенные админом ивенты (!ивенты …) — переживают перезапуск (пульт, world.json). */
  private readonly eventsOff = new Set<EventToggle>();

  /** `!ивенты [вкл|выкл] [нашествие|охота|катакомбы|квест]` — только админ. Без аргументов — что включено. */
  private eventsCmd(nick: string, args: string[]): void {
    const words = args.map((a) => a.toLowerCase());
    const on = words.find((w) => EVENT_ON_WORDS.includes(w));
    const off = words.find((w) => EVENT_OFF_WORDS.includes(w));
    const kinds = words.map((w) => EVENT_TOGGLE_WORDS[w]).filter((k): k is EventToggle => !!k);
    if (on || off) {
      const which = kinds.length ? kinds : EVENT_TOGGLES;
      for (const k of which) {
        if (off) this.eventsOff.add(k);
        else this.eventsOff.delete(k);
      }
      world.savePult({ eventsOff: [...this.eventsOff] });
    }
    const status = EVENT_TOGGLES.map((k) => `${EVENT_TOGGLE_RU[k]} ${this.eventsOff.has(k) ? "выкл" : "вкл"}`).join(", ");
    const running = off && (this.eventPhase === "active" || this.cat.busy || this.chatQuest) ? " · то, что уже идёт, доиграет" : "";
    this.reply(`@${nick} ивенты: ${status}${running}. Команды: !ивенты выкл | вкл [нашествие|охота|катакомбы|квест]`);
  }

  private catHost(): CatHost {
    return {
      now: () => Date.now(),
      heroes: () => {
        const out: ReturnType<CatHost["heroes"]> = [];
        this.state.players.forEach((p, id) => {
          if (p.towerFloor > 0) return;
          out.push({ id, x: p.head.x, z: p.head.z, level: p.level, dead: !!p.dead, bot: id.startsWith("bot:"), nick: p.nick });
        });
        return out;
      },
      setState: (c) => {
        const st = this.state;
        if (st.catPhase !== c.phase) st.catPhase = c.phase;
        if (st.catLo !== c.lo) st.catLo = c.lo;
        if (st.catHi !== c.hi) st.catHi = c.hi;
        if (st.catRoute !== c.route) st.catRoute = c.route;
        if (st.catLives !== c.lives) st.catLives = c.lives;
        if (st.catLeft !== c.left) st.catLeft = c.left;
        if (st.catParty !== c.party) st.catParty = c.party;
        if (st.catStage !== c.stage) st.catStage = c.stage;
        const fin = c.final ? 1 : 0;
        if (st.catFinal !== fin) st.catFinal = fin;
        if (st.catBoss !== c.boss) st.catBoss = c.boss;
        this.sim.catOpen = this.cat.open;
      },
      saveRecords: (ids, win) => {
        for (const id of ids) {
          const p = this.state.players.get(id);
          const token = this.rt.get(id)?.token ?? (p ? `nick:${normNick(p.nick)}` : "");
          const rec = token ? store.get(token) : undefined;
          if (!rec) continue;
          const dmg = Math.round(this.sim.catDamage.get(id) ?? 0);
          // Новый сезон рекордов — старые числа героя не в счёт.
          const cur = (rec.catSeason ?? 1) === CATACOMBS.season;
          store.put(token, {
            catBestDmg: Math.max(cur ? (rec.catBestDmg ?? 0) : 0, dmg),
            catRuns: (cur ? (rec.catRuns ?? 0) : 0) + 1,
            catWins: (cur ? (rec.catWins ?? 0) : 0) + (win ? 1 : 0),
            catSeason: CATACOMBS.season,
          });
        }
        if (this.clients.length) this.broadcast(MSG.catBoard, this.catLeaderboard(5));
      },
      xpReward: (id, share, level0) => {
        const p = this.state.players.get(id);
        if (!p) return;
        const need = xpToNext(level0);
        if (!Number.isFinite(need) || !Number.isFinite(xpToNext(p.level))) return; // максимальный уровень
        // Доля уровня на старте захода по кривой (catXpFrac: 1 ур. 1000%, 36 ур. 10%, 100 ур. 1%), без баффов.
        this.awardXp(this.clientOf(id), p, need * catXpFrac(level0) * share);
      },
      rekeyStats: (from, to) => {
        for (const m of [this.sim.catDamage, this.sim.catKills]) {
          const v = m.get(from);
          m.delete(from);
          if (v !== undefined) m.set(to, (m.get(to) ?? 0) + v);
        }
      },
      autoOn: () => !this.eventsOff.has("catacombs"),
      setThemes: (t) => {
        if (this.state.catThemes !== t) this.state.catThemes = t;
      },
      setShrine: (x, z, k) => {
        const st = this.state;
        st.catShrineX = x;
        st.catShrineZ = z;
        if (st.catShrine !== k) st.catShrine = k;
      },
      shrineBless: (sh, ids) => {
        for (const id of ids) {
          const p = this.state.players.get(id);
          const rt = this.rt.get(id);
          if (!p || !rt || p.dead) continue;
          if (sh.key === "fury" || sh.key === "haste") {
            rt.cryKind = sh.key === "fury" ? 1 : 2;
            rt.cryUntil = this.elapsed + (sh.key === "fury" ? CAT_SHRINE.buffSec : CAT_SHRINE.hasteSec);
          } else if (sh.key === "ward") {
            rt.campBuffUntil = Math.max(rt.campBuffUntil, Date.now() + CAT_SHRINE.wardSec * 1000);
          } else {
            p.hp = p.maxHp;
          }
          this.broadcast(MSG.act, { k: "catShrine", id, x: p.head.x, y: p.head.y, z: p.head.z, v: CAT_SHRINES.indexOf(sh) } satisfies ActRelay);
        }
      },
      announce: (m: CatacombMsg) => this.broadcast(MSG.catacomb, m),
      chat: (t) => this.reply(t),
      canOpen: () => this.eventPhase !== "active",
      warp: (id, x, z, fx, fz) => this.catWarp(id, x, z, fx, fz),
      sendHome: (id) => {
        const sp = hubSpawnPoint();
        this.catWarp(id, sp.x, sp.z);
      },
      report: (r, heroes) => {
        const rows: CatReportRow[] = heroes.map((h) => {
          const p = this.state.players.get(h.id);
          return {
            nick: p?.nick ?? "?",
            cls: p ? (classOf2(p.leftCls as Weapon2 | "", p.rightCls as Weapon2 | "") ?? "") : "",
            level: p?.level ?? 0,
            dmg: Math.round(this.sim.catDamage.get(h.id) ?? 0),
            kills: this.sim.catKills.get(h.id) ?? 0,
            deaths: h.deaths,
            loot: h.loot,
          };
        });
        rows.sort((a, b) => b.dmg - a.dmg);
        this.broadcast(MSG.catReport, { ...r, rows } satisfies CatReportMsg);
      },
      revive: (id) => {
        const p = this.state.players.get(id);
        const rt = this.rt.get(id);
        if (p?.dead && rt) this.respawn(id, p, rt);
      },
      spawn: (type, x, z, o) => this.catSpawn(type, x, z, o),
      alive: (id) => {
        const m = this.sim.mobs.get(id);
        return !!m && !m.dead;
      },
      clearMobs: () => {
        this.sim.clearCatMobs();
        this.dismissCatShards();
      },
      finalStart: (id) => {
        const m = this.sim.mobs.get(id);
        if (!m) return;
        const eh = EVENT.eliteHunt;
        this.huntBossId = id;
        this.huntDmgBase = MOB.attackDamage * m.dmgMul;
        const t0 = Date.now();
        this.huntAddAt = t0 + eh.addGap * 1000;
        this.huntNovaAt = t0 + eh.novaGap * 1000;
        this.huntLobAt = t0 + eh.lobGap * 1000;
        this.huntBreathAt = t0 + eh.breathGap * 1000;
        this.huntNovaFireAt = 0;
        this.huntLobFireAt = 0;
        this.huntBreathFireAt = 0;
      },
      finalTick: (id) => {
        const boss = this.sim.mobs.get(id);
        if (!boss || boss.dead) return;
        const eh = EVENT.eliteHunt;
        const now = Date.now();
        if (!boss.raging && boss.hp / boss.maxHp < eh.enrageAt) {
          boss.raging = true;
          this.broadcast(MSG.catacomb, { kind: "boss", title: `${boss.eliteName} в ярости!`, sub: "держитесь — атаки чаще", secs: 4 } satisfies CatacombMsg);
        }
        // Призыв мертвецов из теней — миньоны катакомб (с лутом, без возрождения).
        if (now >= this.huntAddAt) {
          this.huntAddAt = now + eh.addGap * (boss.raging ? eh.enrageGapMul : 1) * 1000;
          for (let i = 0; i < eh.addCount; i++) {
            const a = Math.random() * Math.PI * 2;
            const r = 3 + Math.random() * 3;
            this.catSpawn("boneWraith", boss.x + Math.cos(a) * r, boss.z + Math.sin(a) * r, { hpMul: 0.7, dmgMul: 1, partyLevel: this.catLevel });
          }
        }
        this.tickHuntAttacks(now, boss, eh);
      },
      finalStop: () => {
        this.huntBossId = "";
      },
      chest: (id, kind) => this.catChest(id, kind),
      chestFx: (x, z, final, lootMul) => {
        this.sim.dropPotions(x, z, Math.round((final ? 8 : 4) * lootMul), 5);
        this.broadcast(MSG.act, { k: "catChest", id: "", x, y: terrainHeight(x, z), z, r: final ? 1 : 0 } satisfies ActRelay);
      },
      hazard: (kind, pts, o) => {
        const H = CAT_HAZARD;
        this.strikeZone(pts, {
          v: H.kinds.indexOf(kind),
          r: o?.r ?? H.radius,
          delay: o?.delay ?? H.delay,
          dmgFrac: (o?.dmg ?? H.dmgFrac) * CATACOMBS.hazardScale * this.cat.sizeDmg,
          stun: o?.stun ?? (kind === "rockfall" ? 0.8 : 0),
          knock: o?.knock ?? (kind === "souls" ? 6 : 0),
          phys: kind === "rockfall",
          who: (pid) => this.cat.inRun(pid),
        });
      },
      stats: (rows, reset) => {
        if (reset) {
          this.sim.catDamage.clear();
          this.sim.catKills.clear();
          return;
        }
        const msg: CatStatsMsg = {
          rows: rows
            .map((r) => {
              const p = this.state.players.get(r.id);
              const rrt = this.rt.get(r.id);
              // Павший: сколько до воскрешения (жизни отряда кончились — -1, встанет в следующем зале).
              const rev = p?.dead ? (this.cat.livesLeft > 0 ? Math.max(0, Math.ceil(rrt?.respawnIn ?? 0)) : -1) : undefined;
              return { nick: p?.nick ?? "?", dmg: Math.round(this.sim.catDamage.get(r.id) ?? 0), kills: this.sim.catKills.get(r.id) ?? 0, deaths: r.deaths, dead: !!p?.dead, ...(rev !== undefined ? { rev } : {}) };
            })
            .sort((a, b) => b.dmg - a.dmg),
        };
        this.broadcast(MSG.catStats, msg);
      },
      dismissMobs: (ids) => {
        for (const id of ids) {
          const m = this.sim.mobs.get(id);
          if (!m) continue;
          if (!m.dead) this.broadcast(MSG.act, { k: "catDust", id: "", x: m.x, y: m.y, z: m.z, r: MOB.bodyRadius * m.scale } satisfies ActRelay);
          this.sim.mobs.delete(id);
          this.sim.catMobs.delete(id);
        }
        this.dismissCatShards();
      },
      mobInfo: (id) => {
        const m = this.sim.mobs.get(id);
        return m && !m.dead ? { x: m.x, z: m.z, hp: m.hp, maxHp: m.maxHp } : null;
      },
      setImmune: (id, on) => {
        const m = this.sim.mobs.get(id);
        if (!m) return;
        m.immune = on;
        this.broadcast(MSG.act, { k: "catShield", id: "", x: m.x, y: m.y, z: m.z, mobId: id, d: on ? 1 : 0 } satisfies ActRelay);
      },
      stunMob: (id, sec) => this.sim.stunMob(id, sec),
      moveMob: (id, x, z) => {
        const m = this.sim.mobs.get(id);
        if (!m) return;
        m.x = x;
        m.z = z;
      },
      enrage: (id) => {
        const m = this.sim.mobs.get(id);
        if (m && !m.dead) {
          m.raging = true;
          m.frenzy(9999);
        }
      },
      gateFx: (pts) => {
        for (const pt of pts) this.broadcast(MSG.act, { k: "catGate", id: "", x: pt.x, y: terrainHeight(pt.x, pt.z), z: pt.z, d: 1.4 } satisfies ActRelay);
      },
      bossFx: (x, z, final) => {
        this.broadcast(MSG.act, { k: "catBoss", id: "", x, y: terrainHeight(x, z), z, d: CATACOMBS.bossIntroSec, r: final ? 1 : 0 } satisfies ActRelay);
      },
    };
  }

  /**
   * Опасные зоны (телеграфы ударов по площади): боты из них выбегают, пока
   * не ударило. Пишут: опасности катакомб, атаки Владыки (волна, дыхание, дождь).
   */
  private readonly dangers: { x: number; z: number; r: number; until: number }[] = [];
  /**
   * Удар по площади с предупреждением (опасности катакомб, «Лунная слеза» рейда): круги в точках
   * (вид v: 0 обвал, 1 пламя, 2 души, 3 лунная слеза), через delay — урон (доля макс. HP) героям
   * `who` в кругах; боты из кругов убегают (addDanger).
   */
  private strikeZone(
    pts: readonly { x: number; z: number }[],
    o: { v: number; r: number; delay: number; dmgFrac: number; who: (pid: string) => boolean; stun?: number; knock?: number; phys?: boolean },
  ): void {
    const R = o.r;
    for (const pt of pts) {
      this.addDanger(pt.x, pt.z, R + 0.6, o.delay + 0.2);
      this.broadcast(MSG.act, { k: "catHazard", id: "", x: pt.x, y: terrainHeight(pt.x, pt.z), z: pt.z, d: o.delay, r: R, v: o.v } satisfies ActRelay);
    }
    this.clock.setTimeout(() => {
      for (const pt of pts) {
        this.broadcast(MSG.act, { k: "catHazardHit", id: "", x: pt.x, y: terrainHeight(pt.x, pt.z), z: pt.z, r: R, v: o.v } satisfies ActRelay);
        this.state.players.forEach((pl, pid) => {
          if (pl.dead || !o.who(pid)) return;
          if (Math.hypot(pl.head.x - pt.x, pl.head.z - pt.z) > R) return;
          this.hurtPlayer({
            target: pid, dmg: pl.maxHp * o.dmgFrac, fromX: pt.x, fromZ: pt.z, projectile: true, magic: !o.phys, phys: !!o.phys,
            ...(o.stun ? { stunSec: o.stun } : {}),
            ...(o.knock ? { knockback: o.knock } : {}),
          });
        });
      }
    }, o.delay * 1000);
  }

  /** Хост боя с рейд-боссом (server/rooms/raidFight.ts). */
  private raidHost(): RaidHost {
    return {
      now: () => this.elapsed,
      boss: () => {
        const m = this.sim.mobs.get(this.sim.raidBossId);
        return m && !m.dead ? { id: m.id, hp: m.hp, maxHp: m.maxHp } : null;
      },
      heroes: () => {
        const out: ReturnType<RaidHost["heroes"]> = [];
        this.state.players.forEach((p, id) => {
          if (p.towerFloor > 0) return;
          out.push({ id, x: p.head.x, z: p.head.z, dead: !!p.dead, bot: id.startsWith("bot:") });
        });
        return out;
      },
      setState: (s) => {
        const st = this.state.raid;
        if (st.ph !== s.ph) st.ph = s.ph;
        if (s.ph === 0 && st.on === 0) return; // боя нет — углы не шлём каждый тик
        st.ang = s.ang;
        if (st.w !== s.w) st.w = s.w;
        if (st.drift !== s.drift) st.drift = s.drift;
        if (st.edge !== s.edge) st.edge = s.edge;
        if (st.gap !== s.gap) st.gap = s.gap;
        if (st.on !== s.on) st.on = s.on;
        st.o0 = s.o[0];
        st.o1 = s.o[1];
        st.o2 = s.o[2];
        if (st.vert !== s.vert) st.vert = s.vert;
        if (st.tide !== s.tide) st.tide = s.tide;
        if (st.tear !== s.tear) st.tear = s.tear;
        if (st.pull !== s.pull) st.pull = s.pull;
        if (st.breath !== s.breath) st.breath = s.breath;
        if (st.cracks !== s.cracks) st.cracks = s.cracks;
        if (st.crackOn !== s.crackOn) st.crackOn = s.crackOn;
      },
      kill: (id, why) => {
        const p = this.state.players.get(id);
        if (!p || p.dead) return;
        this.hurtPlayer({ target: id, dmg: p.maxHp * 10, fromX: RAID.x, fromZ: RAID.z, projectile: false, dot: true, byName: why === "fall" ? "Пустота" : "Прилив" });
      },
      tear: (x, z, r, delay, dmgFrac) => this.strikeZone([{ x, z }], { v: 3, r, delay, dmgFrac, who: (pid) => this.raid.isOn(pid) }),
      shiftBot: (id, dx, dz) => {
        const p = this.state.players.get(id);
        if (!p) return;
        p.head.x += dx;
        p.head.z += dz;
      },
      announce: (title, sub) => {
        // Титры — тем, кто у арены, и зрителям эфира (не всей карте: «Прилив» раз в 20 с).
        const msg: CatacombMsg = { kind: "boss", title, sub, secs: 4 };
        for (const c of this.clients) {
          const p = this.state.players.get(c.sessionId);
          if (this.spectators.has(c.sessionId) || (p && Math.hypot(p.head.x - RAID.x, p.head.z - RAID.z) < RAID.r + 40)) c.send(MSG.catacomb, msg);
        }
      },
      chat: (text) => this.reply(text),
      fx: (k, x, z) => this.broadcast(MSG.act, { k, id: "", x, y: terrainHeight(x, z), z } satisfies ActRelay),
      healBoss: () => {
        const m = this.sim.mobs.get(this.sim.raidBossId);
        if (m && !m.dead) m.hp = m.maxHp;
      },
      hurt: (id, frac, why) => {
        const p = this.state.players.get(id);
        if (!p || p.dead) return;
        this.hurtPlayer({ target: id, dmg: p.maxHp * frac, fromX: RAID.x, fromZ: RAID.z, projectile: false, dot: true, magic: true, byName: why });
      },
      phantoms: (pts, o) => this.sim.spawnRaidPhantoms(pts, o),
      airborne: (id) => {
        const p = this.state.players.get(id);
        return !!p && p.head.y - terrainHeight(p.head.x, p.head.z) - PLAYER.eyeHeight > 0.3;
      },
      jumpBots: (ids) => {
        for (const id of ids) {
          const p = this.state.players.get(id);
          if (p && !p.dead) this.broadcast(MSG.act, { k: "jump", id, x: p.head.x, y: p.head.y, z: p.head.z } satisfies ActRelay);
        }
      },
      danger: (x, z, r, sec) => this.addDanger(x, z, r, sec),
    };
  }

  private addDanger(x: number, z: number, r: number, sec: number): void {
    this.dangers.push({ x, z, r, until: this.elapsed + sec });
  }
  /** Точка в действующей опасной зоне (кроме зоны skip). */
  private inDanger(x: number, z: number, skip?: { x: number; z: number; r: number }): boolean {
    for (const d of this.dangers) {
      if (d !== skip && this.elapsed <= d.until && Math.hypot(x - d.x, z - d.z) < d.r) return true;
    }
    return false;
  }

  /**
   * Куда выбегать боту из опасной зоны (null — он не в опасности): прочь от центра самой глубокой зоны,
   * а если там другая опасная зона или нельзя (ok: на арене рейда — не за край) — по дуге вбок.
   */
  private dangerEscape(x: number, z: number, ok?: (x: number, z: number) => boolean): { x: number; z: number } | null {
    let worstD: { x: number; z: number; r: number } | null = null;
    let worst = 0;
    for (let i = this.dangers.length - 1; i >= 0; i--) {
      const d = this.dangers[i];
      if (this.elapsed > d.until) {
        this.dangers.splice(i, 1);
        continue;
      }
      const depth = d.r - Math.hypot(x - d.x, z - d.z);
      if (depth > worst) {
        worst = depth;
        worstD = d;
      }
    }
    if (!worstD) return null;
    const d = worstD;
    const dist = Math.hypot(x - d.x, z - d.z);
    const base = dist > 0.05 ? Math.atan2(x - d.x, z - d.z) : d.x + z;
    const R = d.r + 1.2;
    let first: { x: number; z: number } | null = null;
    for (const da of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, 2.5, -2.5, Math.PI]) {
      const pt = { x: d.x + Math.sin(base + da) * R, z: d.z + Math.cos(base + da) * R };
      first ??= pt;
      if ((ok && !ok(pt.x, pt.z)) || this.inDanger(pt.x, pt.z, d)) continue;
      return pt;
    }
    return first;
  }

  /** Есть ли живой герой в отряде катакомб. */
  private catAnyAlive(): boolean {
    for (const id of this.cat.party) {
      const p = this.state.players.get(id);
      if (p && !p.dead) return true;
    }
    return false;
  }

  /** Перенос героя: бот — сервер сам (и сброс его дел), игрок — сообщение warp клиенту. */
  private catWarp(id: string, x: number, z: number, faceX?: number, faceZ?: number): void {
    const p = this.state.players.get(id);
    const rt = this.rt.get(id);
    if (!p || !rt) return;
    const y = terrainHeight(x, z) + PLAYER.eyeHeight;
    p.head.x = x;
    p.head.y = y;
    p.head.z = z;
    const yaw = faceX !== undefined && faceZ !== undefined ? Math.atan2(faceX - x, faceZ - z) : rt.yaw;
    rt.yaw = yaw;
    rt.invuln = Math.max(rt.invuln, 2);
    const bot = id.startsWith("bot:") ? this.bots.get(id.slice(4)) : undefined;
    if (bot) {
      bot.vx = 0;
      bot.vz = 0;
      bot.target = null;
      bot.nav = undefined;
      bot.eventing = false;
      bot.raiding = false;
      bot.followNorm = null;
      bot.fishing = false;
      bot.yaw = yaw;
      p.head.qx = 0;
      p.head.qy = Math.sin(yaw / 2);
      p.head.qz = 0;
      p.head.qw = Math.cos(yaw / 2);
    } else {
      this.clientOf(id)?.send(MSG.warp, { x, y, z, yaw });
    }
  }

  /** Моб катакомб: сила — под средний уровень пати (CATACOMBS.levelMin..levelMax), не возрождается, лут роняет. */
  private catSpawn(
    type: string,
    x: number,
    z: number,
    o: { hpMul: number; dmgMul: number; scaleMul?: number; name?: string; partyLevel: number; affix?: CatAffix | null },
  ): string {
    const af = o.affix;
    this.catLevel = o.partyLevel;
    const def = ELITE_MOBS[type];
    let id: string;
    if (def) {
      // Калибровка вида под отряд опорного уровня (как моб этого вида против героев levelRef)...
      const k = Math.max(CATACOMBS.levelMin, Math.min(CATACOMBS.levelMax, CATACOMBS.levelRef / def.level));
      // ...и рост вместе с героями: их HP и урон растут ~ как уровень² (CATACOMBS.levelPow).
      const lv = Math.max(0.3, Math.min(2.5, o.partyLevel / CATACOMBS.levelRef)) ** CATACOMBS.levelPow;
      const opts = eliteMobOpts(def);
      opts.hp = Math.round(def.hp * o.hpMul * k ** 1.4 * lv * (af?.hpMul ?? 1) * CATACOMBS.hpScale);
      opts.dmgMul = def.dmgMul * o.dmgMul * k ** 1.2 * lv * CATACOMBS.dmgScale;
      opts.scaleMul = (def.scaleMul ?? 1) * (o.scaleMul ?? 1) * (af?.scaleMul ?? 1);
      // Аффикс волны: поверх врождённых свойств (берём сильнейшее).
      if (af?.speedMul) opts.speedMul = Math.max(opts.speedMul ?? 1, af.speedMul);
      if (af?.lifesteal) opts.lifesteal = Math.max(opts.lifesteal ?? 0, af.lifesteal);
      if (af?.physArmor) opts.physArmor = Math.max(opts.physArmor ?? 0, af.physArmor);
      opts.level = Math.max(1, Math.round(o.partyLevel));
      // Опыта мобы катакомб не дают — он только за стражей и Владыку (CATACOMBS.xpCurve).
      opts.xp = 0;
      if (o.name) opts.name = o.name;
      id = this.sim.spawnEventMob(def.kind, x, z, opts);
    } else {
      id = this.sim.spawnEventMob(type === "spitter" ? "spitter" : "slime", x, z, { xp: 0 });
    }
    this.sim.eventMobs.delete(id);
    this.sim.catMobs.add(id);
    return id;
  }

  /** Сундук катакомб: золотое оружие класса героя (или суперприз) — сразу в склад. */
  private catChest(id: string, kind: "gold" | "final"): LootItem[] {
    const p = this.state.players.get(id);
    const rt = this.rt.get(id);
    if (!p || !rt) return [];
    const token = rt.token ?? `nick:${normNick(p.nick)}`;
    // Сундук стадии — не оружие, а жетоны ◈ (золотое оружие из катакомб убрано).
    if (kind === "gold") {
      store.put(token, { tokens: (store.get(token)?.tokens ?? 0) + CATACOMBS.stageTokens });
      return [];
    }
    // Оружие из сундука Владыки — случайного класса (не только своего).
    const cls: WeaponClass = ATTACK_CLASSES[Math.floor(Math.random() * ATTACK_CLASSES.length)];
    const w = this.rollChestWeapon(p, cls);
    rt.weapons.push(w);
    store.put(token, { weapons: rt.weapons });
    this.announcePickup(p.nick, w.cls, w.tier, w);
    const loot: LootItem[] = [];
    const wid = WEAPON_DROP[weaponKey(w.cls, w.tier)];
    if (wid) loot.push({ id: wid, count: 1 });
    if (kind === "final") {
      const scroll: ItemId = Math.random() < 0.5 ? "scroll_xp" : "scroll_wind";
      const bag = readBag(p);
      if (addToBag(bag, scroll, 1) === 0) {
        writeBag(p, bag);
        loot.push({ id: scroll, count: 1 });
      }
      store.put(token, { tokens: (store.get(token)?.tokens ?? 0) + CATACOMBS.finalTokens });
      // Редкая награда супербосса — рубиновое оружие СЛУЧАЙНОГО класса (сверх уникального).
      if (Math.random() < RUBY.dropChance) {
        const r = rollWeaponInstance(ATTACK_CLASSES[Math.floor(Math.random() * ATTACK_CLASSES.length)], "ruby");
        rt.weapons.push(r);
        store.put(token, { weapons: rt.weapons });
        this.announcePickup(p.nick, r.cls, r.tier, r);
        const rid = WEAPON_DROP[weaponKey(r.cls, r.tier)];
        if (rid) loot.push({ id: rid, count: 1 });
        this.reply(`💎 ${p.nick} получает рубиновое оружие — ${instanceName(r)}: ${instanceLabels(r).join(", ")}!`);
      }
      rt.eventBuffUntil = Date.now() + CATACOMBS.buffMinutes * 60_000;
      store.put(token, { eventBuffUntil: rt.eventBuffUntil });
    }
    if (!id.startsWith("bot:")) this.syncWarehouse(id, rt);
    return loot;
  }

  /** Стены: в катакомбах — открытые залы пати, чужой в катакомбах — домой; иначе край карты. */
  private clampHero(id: string, p: PlayerState): void {
    if (!inCatRegion(p.head.x, p.head.z)) {
      clampToPlay(p.head);
      return;
    }
    if (this.cat.inRun(id)) {
      [p.head.x, p.head.z] = catProject(p.head.x, p.head.z, this.cat.open, PLAYER.radius);
    } else {
      const sp = hubSpawnPoint();
      this.catWarp(id, sp.x, sp.z);
    }
  }

  /** Точка и радиус зоны бота в катакомбах по приказу (!встать) и отходу (осторожный режим). */
  private catTacticSpot(bot: Bot): { x: number; z: number; r: number } {
    const hallI = this.cat.anchorHall;
    const h = CAT_HALLS[hallI];
    const p = bot.state;
    // Осторожный: HP ниже 35% — к входу, пока не поднимется до 70%.
    if (bot.catMode === "careful") {
      if (p.hp < p.maxHp * 0.35) bot.catRetreat = true;
      else if (p.hp > p.maxHp * 0.7) bot.catRetreat = false;
    } else bot.catRetreat = false;
    if (bot.catRetreat) {
      const e = catEntry(hallI);
      return { x: e.x, z: e.z, r: 3 };
    }
    // Где отряд и где враг — от этого «вперёд/назад/фланг». Зона — весь зал: бот ДЕРЁТСЯ всегда,
    // позиция задаёт лишь, где стоять без цели и кого бить первым (ближних к своему месту).
    let sx = 0;
    let sz = 0;
    let w = 0;
    for (const id of this.cat.party) {
      const o = this.state.players.get(id);
      if (!o || o.dead || Math.hypot(o.head.x - h.x, o.head.z - h.z) > h.r + 1) continue;
      const k = id.startsWith("bot:") ? 1 : 3;
      sx += o.head.x * k;
      sz += o.head.z * k;
      w += k;
    }
    const px = w ? (sx / w) * 0.7 + h.x * 0.3 : h.x;
    const pz = w ? (sz / w) * 0.7 + h.z * 0.3 : h.z;
    let ex = 0;
    let ez = 0;
    let en = 0;
    const boss = this.sim.mobs.get(this.cat.bossMob);
    if (boss && !boss.dead) {
      ex = boss.x;
      ez = boss.z;
      en = 1;
    } else {
      for (const id of this.sim.catMobs) {
        const m = this.sim.mobs.get(id);
        if (!m || m.dead || Math.hypot(m.x - h.x, m.z - h.z) > h.r + 2) continue;
        ex += m.x;
        ez += m.z;
        en++;
      }
      if (en) {
        ex /= en;
        ez /= en;
      }
    }
    const R = h.r * 2;
    switch (bot.catPos ?? "auto") {
      case "front":
        return en ? { x: ex + (px - ex) * 0.25, z: ez + (pz - ez) * 0.25, r: R } : { x: h.x, z: h.z + h.r * 0.3, r: R };
      case "back": {
        // Тыл: позади отряда (от врага), держит подходы.
        const dx = en ? px - ex : 0;
        const dz = en ? pz - ez : -1;
        const l = Math.hypot(dx, dz) || 1;
        return { x: px + (dx / l) * 6, z: pz + (dz / l) * 6, r: R };
      }
      case "flank": {
        // Фланг: сбоку от врага (по направлению отряд→враг), сторона — своя у каждого.
        const side = bot.norm.charCodeAt(0) % 2 ? 1 : -1;
        const tx = en ? ex : h.x;
        const tz = en ? ez : h.z;
        const dx = tx - px;
        const dz = tz - pz;
        const l = Math.hypot(dx, dz) || 1;
        return { x: tx + (-dz / l) * 6 * side, z: tz + (dx / l) * 6 * side, r: R };
      }
      default:
        return { x: px, z: pz, r: R };
    }
  }

  /** Место бота в строю отряда (кольцо вокруг точки, по порядку в пати) — пока ждём волну. */
  private catSlot(bot: Bot, cx: number, cz: number): { x: number; z: number } {
    const ids = [...this.cat.party].filter((id) => id.startsWith("bot:")).sort();
    const i = Math.max(0, ids.indexOf(bot.id));
    const n = Math.max(1, ids.length);
    // Святилище в зале — пока волн нет, первый бот отряда бежит за благословением для всех.
    if (i === 0 && this.state.catShrine >= 0) return { x: this.state.catShrineX, z: this.state.catShrineZ };
    const a = (i / n) * Math.PI * 2 + Math.PI / 2;
    // С приказом «встать» — тесно у своей точки, иначе — кольцом вокруг центра отряда.
    const r = bot.catPos && bot.catPos !== "auto" ? 1.2 : 2.5 + n * 0.35;
    return { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r };
  }

  /** Цель по приказу (!цель): босс, свита, стрелки, слабые, сильные. null — как обычно. */
  private catFocusPick(bot: Bot, ok: (m: Mob) => boolean, spot?: { x: number; z: number }): Mob | null {
    const focus = bot.catFocus ?? (bot.catMode === "brave" ? "boss" : "auto");
    const p = bot.state;
    if (focus === "auto") return this.catAssistPick(bot, ok, spot);
    if (focus === "boss") {
      const b = this.sim.mobs.get(this.cat.bossMob);
      // Под щитом — бьём тех, кто его держит (хранителей и свиту).
      return b && !b.dead && !b.immune ? b : this.catAssistPick(bot, ok, spot);
    }
    let best: Mob | null = null;
    let bv = Infinity;
    for (const id of this.sim.catMobs) {
      const m = this.sim.mobs.get(id);
      if (!m || m.dead || !ok(m)) continue;
      const d = Math.hypot(m.x - p.head.x, m.z - p.head.z);
      let v: number;
      if (focus === "adds") {
        if (m.id === this.cat.bossMob) continue;
        v = d;
      } else if (focus === "ranged") v = d + (m.kind === "spitter" ? 0 : 1000);
      else if (focus === "weak") v = m.hp + d * 2;
      else v = -m.maxHp + d * 2;
      if (v < bv) {
        bv = v;
        best = m;
      }
    }
    return best;
  }

  /**
   * Командная цель по умолчанию: моб, который бьёт союзника (живого игрока —
   * в первую очередь, затем самого раненого), иначе — тот, кого уже бьёт
   * больше всего героев отряда (добиваем вместе), иначе ближайший.
   */
  private catAssistPick(bot: Bot, ok: (m: Mob) => boolean, spot?: { x: number; z: number }): Mob | null {
    const p = bot.state;
    // С приказом «встать» — ближние к своему месту (держит позицию), иначе — ближние к себе.
    const fromX = spot && bot.catPos && bot.catPos !== "auto" ? spot.x : p.head.x;
    const fromZ = spot && bot.catPos && bot.catPos !== "auto" ? spot.z : p.head.z;
    const focusCount = new Map<string, number>();
    for (const id of this.cat.party) {
      if (id === bot.id) continue;
      const t = id.startsWith("bot:") ? this.bots.get(id.slice(4))?.target : this.rt.get(id)?.lastHitMobId;
      if (t) focusCount.set(t, (focusCount.get(t) ?? 0) + (id.startsWith("bot:") ? 1 : 2));
    }
    let best: Mob | null = null;
    let bv = Infinity;
    for (const id of this.sim.catMobs) {
      const m = this.sim.mobs.get(id);
      if (!m || m.dead || m.immune || !ok(m)) continue;
      let v = Math.hypot(m.x - fromX, m.z - fromZ);
      const victim = m.targetId ? this.state.players.get(m.targetId) : undefined;
      if (victim && m.targetId && this.cat.party.has(m.targetId)) {
        // Бьёт союзника: защищаем — живого игрока сильнее, раненого сильнее.
        v -= (m.targetId.startsWith("bot:") ? 8 : 16) + (1 - victim.hp / Math.max(1, victim.maxHp)) * 12;
      }
      v -= (focusCount.get(m.id) ?? 0) * 5;
      if (v < bv) {
        bv = v;
        best = m;
      }
    }
    return best;
  }

  /**
   * Приказы боту в катакомбах (работают и заранее, на сборе): !цель босс|свита|стрелки|слабых|сильных|авто,
   * !встать вперёд|назад|фланг|авто, !режим осторожно|агрессивно|авто, !тактика — что сейчас.
   * Это установки, а не мгновенные команды: бот держит их, пока не сменят (стрим отстаёт на 20–60 с).
   */
  private catTacticChat(nick: string, norm: string, cmd: string, arg: string): void {
    const bot = this.bots.get(norm);
    if (!bot) {
      this.reply(`@${nick} сначала !play или !катакомбы — приказы получает твой герой.`);
      return;
    }
    const w = arg.toLowerCase();
    let said = "";
    if (cmd === "focus") {
      const f = CAT_FOCUS_WORDS[w];
      if (!f) return this.reply(`@${nick} !цель босс | свита | стрелки | слабых | сильных | авто`);
      bot.catFocus = f;
      bot.target = null;
      said = `Бью: ${CAT_FOCUS_RU[f]}!`;
    } else if (cmd === "pos") {
      const v = CAT_POS_WORDS[w];
      if (!v) return this.reply(`@${nick} !встать вперёд | назад | фланг | авто`);
      bot.catPos = v;
      said = `Встаю ${CAT_POS_RU[v]}!`;
    } else if (cmd === "mode") {
      const v = CAT_MODE_WORDS[w];
      if (!v) return this.reply(`@${nick} !режим осторожно | агрессивно | авто`);
      bot.catMode = v;
      said = v === "careful" ? "Буду осторожен." : v === "brave" ? "В атаку!" : "Как обычно.";
    }
    if (said) this.botSay(norm, said);
    this.reply(
      `@${nick} тактика: цель — ${CAT_FOCUS_RU[bot.catFocus ?? "auto"]}, позиция — ${CAT_POS_RU[bot.catPos ?? "auto"]}, ` +
        `режим — ${CAT_MODE_RU[bot.catMode ?? "auto"]}${this.cat.inRun(bot.id) ? "" : " (сработает в катакомбах)"}`,
    );
  }

  /** !катакомбы — записать героя зрителя (нет в мире — поднимаем); админ: open / go / stop. */
  private catJoinChat(nick: string, norm: string, arg?: string, admin = isAdminNick(norm)): void {
    const a = (arg ?? "").toLowerCase();
    if (admin && (a === "open" || a === "go" || a === "stop")) {
      this.cat.force(a);
      return;
    }
    let id: string | null = null;
    this.state.players.forEach((p, pid) => {
      if (!pid.startsWith("bot:") && normNick(p.nick) === norm) id = pid;
    });
    if (!id) {
      if (!this.bots.has(norm)) this.requestBot(nick, norm);
      if (this.bots.has(norm)) id = `bot:${norm}`;
    }
    if (!id) return;
    // Открыть сбор раньше расписания — только админ; остальные лишь записываются в открытый.
    const r = this.cat.join(id, nick, admin);
    if (r) this.reply(`@${nick} ${r}`);
  }

  private removeBot(norm: string): void {
    const bot = this.bots.get(norm);
    if (!bot) return;
    if (this.raidPending.delete(norm) && this.raidPending.size < BOT.raidMinParty) {
      this.raidGoAt = 0;
    }
    this.persistBot(bot);
    // Явно ушёл из мира (!stop или тайм-аут по хозяину) — после рестарта не поднимаем.
    store.put(bot.rt.token ?? `nick:${norm}`, { botActive: false });
    this.state.players.delete(bot.id);
    this.rt.delete(bot.id);
    this.bots.delete(norm);
    store.flush();
    console.log(`[bot] - ${bot.nick} — ботов ${this.bots.size}`);
    if (this.state.players.size === 0) this.wipeWorld("мир опустел");
  }

  /**
   * При старте комнаты поднимаем ботов, помеченных botActive (пережили рестарт),
   * которые были в мире до перезапуска, из сохранённых записей (`nick:*`).
   */
  private restoreBots(): void {
    let n = 0;
    // Раньше тут стояло отдельное хардкодное число (3 часа) — разъехалось с
    // BOT.ownerAbsentSec, когда тот подняли до 5 часов: бота, которого не
    // трогали 3-5 часов, сюда даже не пускало восстанавливаться, хотя по
    // задумке (см. ownerAbsentSec) он должен жить все 5. Теперь один и тот
    // же порог, никакого рассинхрона.
    const cutoff = Date.now() - BOT.ownerAbsentSec * 1000; // не поднимаем давно заброшенных
    for (const rec of store.entries()) {
      if (!rec.token?.startsWith("nick:")) continue;
      if (rec.botActive === false) continue; // явно сделал !stop
      if (rec.botActive !== true && (rec.updatedAt ?? 0) < cutoff) continue;
      const norm = normNick(rec.token.slice(5));
      if (!norm || this.bots.has(norm)) continue;
      // Таймер ухода считается от последнего сообщения хозяина в чате и переживает рестарты:
      // раньше каждый рестарт (а деплои идут по несколько раз в день) обновлял его, и герои жили вечно.
      const lastChat = rec.lastChatAt ?? Date.now(); // старые записи без метки — льготный старт с сейчас
      if (
        !STREAM_NICKS.includes(norm) &&
        Date.now() - lastChat > BOT.ownerAbsentSec * 1000
      ) {
        store.put(rec.token, { botActive: false });
        continue;
      }
      if (this.bots.size >= BOT.maxBots) {
        console.log(`[bot] восстановление остановлено на потолке ${BOT.maxBots}`);
        break;
      }
      this.spawnBot(rec.nick || norm, norm);
      this.chatSeen.set(norm, lastChat);
      n++;
    }
    if (n) console.log(`[bot] восстановлено после рестарта: ${n}`);
  }

  /**
   * `!class <класс>` — выбрать класс героя-бота: в руки — оружие класса
   * (лучший честно найденный тир), выбор сохраняется. Без аргумента — список.
   */
  private setBotClass(nick: string, norm: string, arg: string): void {
    const want = CLASS_ALIASES[arg.trim().toLowerCase()];
    const list = "воин · лучник · маг · ассасин · копейщик · боевой маг";
    if (!want) {
      if (this.hintOk(norm)) this.reply(`@${nick} классы: ${list} — напиши, например, !class ассасин`);
      return;
    }
    const token = `nick:${norm}`;
    // Новый класс — старые закрепления (оружие прежнего класса) снимаем, иначе при выходе
    // бот вернулся бы к закреплённому. Героя вне игры — сразу и руки в сейве (их бот берёт при выходе).
    const rec0 = store.get(token);
    const off0 = botOffHand(want);
    store.put(token, {
      botClass: want,
      equippedWeaponId: { left: null, right: null },
      held: {
        right: { cls: want, tier: bestOwnedTier(rec0?.owned, want) },
        left: off0 ? { cls: off0 as WeaponClass, tier: bestOwnedTier(rec0?.owned, off0 as WeaponClass) } : null,
      },
    });
    const def = CLASSES2[classOf2(botOffHand(want) as Weapon2 | "", want) ?? "warrior"];
    const bot = this.bots.get(norm);
    if (bot) {
      const p = bot.state;
      preserveLegacyWeapon(bot.rt, p.rightCls, p.rightTier);
      preserveLegacyWeapon(bot.rt, p.leftCls, p.leftTier);
      p.rightCls = want;
      p.rightTier = bestOwnedTier([...bot.rt.owned], want);
      const off = botOffHand(want);
      p.leftCls = off;
      p.leftTier = off ? bestOwnedTier([...bot.rt.owned], off as WeaponClass) : "";
      bot.rt.equippedWeaponId = { left: null, right: null };
      this.persistBot(bot);
    }
    this.reply(
      `@${nick} класс: ${def.icon} ${def.name} (${def.weapons}). Новые очки атрибутов герой раскидает под класс сам; ` +
        `вложенные раньше — !respec за 1 ◈.`,
    );
  }

  /**
   * `!skills` — умения класса героя: без аргументов — список (выбранные с ✓),
   * `!skills <умение> <умение>` — выбрать два (по началу названия: «рывок печать»).
   */
  private setBotSkills(nick: string, norm: string, args: string[]): void {
    const t = this.findWeaponsTarget(norm);
    const rec = store.get(`nick:${norm}`);
    const left = t ? t.p.leftCls : rec?.held?.left?.cls ?? "";
    const right = t ? t.p.rightCls : rec?.held?.right?.cls ?? "";
    const cls = classOf2(left as Weapon2 | "", right as Weapon2 | "");
    if (!cls) {
      if (this.hintOk(norm)) this.reply(`@${nick} у героя нет оружия — сначала !play или !class.`);
      return;
    }
    const def = CLASSES2[cls];
    const chosen = t ? [t.p.skill1, t.p.skill2] : rec?.skills?.[cls] ?? def.defaultSkills;
    const words = args.map((w) => w.toLowerCase()).filter((w) => w.length >= 3);
    if (words.length === 0) {
      if (!this.hintOk(norm)) return;
      const list = def.skills.map((k) => `${chosen.includes(k) ? "✓" : "·"} ${skillName(k, cls)}`).join(" ");
      this.reply(`@${nick} ${def.icon} ${def.name}: ${list} — выбрать два: !skills <умение> <умение>`);
      return;
    }
    const pick: SkillId[] = [];
    for (const w of words) {
      const hit = def.skills.find((k) => {
        const names = [skillName(k, cls), SKILLS2[k].name, k].map((n) => n.toLowerCase());
        return names.some((n) => n.startsWith(w) || n.split(" ").some((part) => part.startsWith(w)));
      });
      if (hit && !pick.includes(hit)) pick.push(hit);
    }
    const r = this.chooseSkills(norm, t?.p ?? null, pick);
    this.reply(`@${nick} ${r.text}`);
  }

  private persistBot(bot: Bot): void {
    const p = bot.state;
    const edge = WORLD.size / 2 - 2;
    const token = bot.rt.token ?? `nick:${bot.norm}`;
    // Запись общая с живым персонажем этого ника: то, чего у бота нет (убранное
    // за спину в VR, права на оружие, личные подгонки), НЕ затираем — раньше
    // persistBot писал stowed: [] и урезал owned до надетого, и оружие «терялось»,
    // стоило боту персистнуться между заходами игрока.
    const prev = store.get(token);
    store.put(token, {
      nick: p.nick,
      ...savePos(p.head.x, p.head.y, p.head.z, edge),
      yaw: bot.rt.yaw,
      hp: p.hp,
      // Золотое оружие бот не "покупал" — нашёл на земле (lootTarget в tickBot),
      // но право распоряжаться им то же: если зритель зайдёт за этого героя
      // сам, он должен суметь и покидать его обратно (см. MSG.dropWeapon).
      owned: [
        ...new Set([
          ...(Array.isArray(prev?.owned) ? prev!.owned : []),
          ...bot.rt.owned,
          ...(p.rightTier === "gold" || p.rightTier === "legendary" || p.rightTier === "ruby"
            ? [weaponKey(p.rightCls as WeaponClass, p.rightTier as WeaponTier)]
            : []),
          ...(p.leftCls === "shield" && p.leftTier === "legendary"
            ? [weaponKey("shield", "legendary")]
            : []),
        ]),
      ],
      stowed: sanitizeStowed(prev?.stowed),
      held: { left: heldIn(p, "left"), right: heldIn(p, "right") },
      overrides: prev?.overrides ?? {},
      skin: p.skin,
      ...readProgress(p),
      // Раньше тут всегда было [] — у бота при каждом persistBot() (подбор,
      // трата очка и т.п.) стирался весь бэг, включая "Лом" от разборки: ресурс
      // фактически не переживал следующее же случайное событие.
      bag: readBag(p).map((s) => ({ item: s.item, count: s.count })),
      kills: bot.rt.kills,
      weapons: bot.rt.weapons,
      equippedWeaponId: bot.rt.equippedWeaponId,
      eventBuffUntil: bot.rt.eventBuffUntil,
      campBuffUntil: bot.rt.campBuffUntil,
      viewToken: bot.rt.viewToken,
      botActive: true, // в мире — восстановить после рестарта
      // Последнее сообщение хозяина — на диск (persistBot идёт раз в 10 с): отсчёт ухода бота переживает рестарт.
      lastChatAt: this.chatSeen.get(bot.norm),
    });
  }

  /**
   * !рыбачить: идти к берегу озера, закинуть удочку (анимация — тот же
   * "удар", что и меч), подождать поклёвку и подсечь. Сервер — единственный
   * источник правды по таймеру (как и MSG.fish у живого игрока), но тут бот
   * сам себе и клиент, и сервер: подсекает мгновенно, как только клюнет,
   * никаких промахов по реакции — это фоновая массовка, а не соревнование.
   */
  /** Повернуть бота на курс yaw (та же конвенция yaw→кватернион, что в tickBot). */
  private faceBot(bot: Bot, yaw: number): void {
    const h = bot.state.head;
    h.qx = 0;
    h.qy = Math.sin(yaw / 2);
    h.qz = 0;
    h.qw = Math.cos(yaw / 2);
    bot.yaw = yaw; // сглаженный курс tickBot — чтобы после рыбалки не дёрнулся назад
    bot.rt.yaw = yaw;
  }

  private tickBotFishing(bot: Bot, dt: number): void {
    const p = bot.state;
    // Точная кромка эллипса В ТОМ НАПРАВЛЕНИИ, откуда бот подходит — усреднённый
    // shoreOuter (круг) не годится, озеро вытянутое, и бот вставал далеко
    // от настоящего берега почти на все подходы, кроме одного-двух.
    const dx0 = p.head.x - LAKE.x;
    const dz0 = p.head.z - LAKE.z;
    const distFromCenter = Math.hypot(dx0, dz0) || 1;
    const dirx = dx0 / distFromCenter;
    const dirz = dz0 / distFromCenter;
    const shoreR = lakeShoreDistIn(dirx, dirz) + LAKE.shoreFade;
    const shoreX = LAKE.x + dirx * shoreR;
    const shoreZ = LAKE.z + dirz * shoreR;
    const distToShore = Math.hypot(shoreX - p.head.x, shoreZ - p.head.z);
    if (distToShore > 2) {
      const dist = distToShore || 1e-6;
      const speed = moveSpeedFor(p.level, p) * (p.scrollWindSecs > 0 ? SCROLL.windMul : 1);
      const wvx = ((shoreX - p.head.x) / dist) * speed;
      const wvz = ((shoreZ - p.head.z) / dist) * speed;
      const accel = Math.min(1, dt * 6);
      bot.vx += (wvx - bot.vx) * accel;
      bot.vz += (wvz - bot.vz) * accel;
      this.botStep(p, bot, dt);
      p.head.y = terrainHeight(p.head.x, p.head.z) + PLAYER.eyeHeight; // не летел/не тонул на подходе
      this.faceBot(bot, Math.atan2(wvx, wvz)); // идёт — смотрит по ходу
      bot.fishBiteAt = 0;
      return;
    }
    // У берега — лицом к ВОДЕ (к центру озера). Раньше поворот тут не задавался
    // вовсе, и бот мог стоять к озеру спиной — как повернулся до этого.
    this.faceBot(bot, Math.atan2(LAKE.x - p.head.x, LAKE.z - p.head.z));
    // У берега — стоим (гасим набежавшую скорость подхода), но высоту всё
    // равно поддерживаем — рельеф прямо на кромке неровный.
    bot.vx *= 0.8;
    bot.vz *= 0.8;
    p.head.y = terrainHeight(p.head.x, p.head.z) + PLAYER.eyeHeight;
    if (bot.fishBiteAt === 0) {
      if (bot.swingIn <= 0 && bot.attackCd <= 0) {
        bot.attackCd = 1.5;
        bot.swingIn = 0.3;
        bot.swingTarget = null; // заброс — не бой, урона не будет (resolveBotHit тихо выйдет)
        const relay: ActRelay = { k: "swing", id: bot.id, x: p.head.x, y: p.head.y, z: p.head.z };
        this.broadcast(MSG.act, relay);
        // ~3 минуты ожидания поклёвки, небольшой случайный разброс.
        bot.fishBiteAt = this.elapsed + FISH_WAIT_MIN + Math.random() * FISH_WAIT_SPREAD;
      }
      return;
    }
    if (this.elapsed >= bot.fishBiteAt) {
      const bag = readBag(p);
      const left = addToBag(bag, "fish", 1);
      if (left < 1) {
        writeBag(p, bag);
        this.triggerEmote(bot, "cheer");
        this.broadcast(MSG.botSay, { id: bot.id, text: "Поймал!" } satisfies BotSayMsg);
        this.bumpFeat(bot.id, "fishTotal", TITLE_GOALS.fish, "Мастер-рыболов");
      }
      bot.fishBiteAt = 0;
    }
  }

  /**
   * Бот поднимает лут `d`: оружие — надевает, если это апгрейд его снаряжения
   * (иначе в склад), зелье — в сумку, если есть место. true — поднял.
   */
  private botTakeDrop(bot: Bot, d: NonNullable<ReturnType<ZoneSim["drops"]["get"]>>): boolean {
    const p = bot.state;
    // Апгрейд своего снаряжения — то, что бот реально наденет.
    const isEquipUpgrade = (w: { cls: WeaponClass; tier: WeaponTier }): boolean => botEquipUpgrade(p, bot.rt, w);
    let took = false;
    const lw = ITEMS[d.item].weapon;
    if (lw) {
      this.sim.takeDrop(d.id);
      // Одеваем ТОЛЬКО реальный апгрейд своего снаряжения. Оружие
      // чужого класса (или тира не выше текущего) просто уходит в
      // склад — бот его несёт, но не переодевается в него сам.
      const upgrade = isEquipUpgrade(lw);
      if (upgrade) {
        if (lw.cls === "shield") {
          preserveLegacyWeapon(bot.rt, p.leftCls, p.leftTier);
          // «Эгида» — в левую руку, правое оружие не трогаем.
          p.leftCls = "shield";
          p.leftTier = lw.tier;
        } else {
          preserveLegacyWeapon(bot.rt, p.rightCls, p.rightTier);
          // Апгрейд — того же класса, что в правой руке: левую руку (пустую, щит,
          // второй меч/кинжал) не трогаем.
          p.rightCls = lw.cls;
          p.rightTier = lw.tier;
        }
      }
      bot.rt.owned.add(weaponKey(lw.cls, lw.tier));
      if (d.instance) bot.rt.weapons.push(d.instance);
      this.persistBot(bot);
      this.announcePickup(bot.nick, lw.cls, lw.tier, d.instance);
      console.log(`[bot] ${bot.nick} подобрал ${lw.cls}:${lw.tier}${upgrade ? "" : " (в склад)"}`);
      took = true;
    } else {
      // бутылка зелья — в сумку
      const bag = readBag(p);
      const left = addToBag(bag, d.item, d.count);
      if (d.count - left > 0) {
        writeBag(p, bag);
        this.sim.takeDrop(d.id);
        took = true;
      }
    }
    if (took) {
      const relay: ActRelay = { k: "pickup", id: bot.id, x: p.head.x, y: p.head.y, z: p.head.z };
      this.broadcast(MSG.act, relay);
    }
    return took;
  }

  /** ИИ одного бота на кадр. */
  private tickBot(dt: number, bot: Bot): void {
    const p = bot.state;
    // Боты зрителей сами раскидывают свободные очки по шаблону своего класса —
    // пока хозяин не взялся распределять их сам (!inv / !сила … / сброс).
    if (p.unspent > 0 && !store.get(`nick:${bot.norm}`)?.manualAttrs) this.botAutoSpend(p);
    if (p.dead) {
      bot.swingIn = 0; // умер на замахе — удара не будет
      bot.swingTarget = null;
      // bot.raiding НЕ снимаем: возродится на спавне и снова пойдёт на босса,
      // пока тот не убит или пока не напишут !raid ещё раз.
      return; // возрождение — общий tickPlayers
    }
    // В Охотничьей башне — тело спрятано за картой, обычный AI тут не при делах.
    if (bot.inTower) return;
    // Оглушён спец-атакой моба (Чародей руин) — стоит столбом, ни шага, ни удара.
    if (bot.rt.stunnedUntil > this.elapsed) return;
    bot.attackCd = Math.max(0, bot.attackCd - dt);
    bot.drinkCd = Math.max(0, bot.drinkCd - dt);
    bot.healCd = Math.max(0, bot.healCd - dt);
    bot.stunCd = Math.max(0, bot.stunCd - dt);
    bot.rainCd = Math.max(0, bot.rainCd - dt);

    // Дом бота по уровню мог смениться (перерос лагерь, в т.ч. ещё ДО этого
    // деплоя — у уже прокачанных ботов дом иначе не пересчитать). Дёшево —
    // сверяем каждый тик, двигаем только при реальной смене.
    {
      const home = botHome(p.level, bot.campPref, bot.campRand);
      if (home.x !== bot.homeX || home.z !== bot.homeZ) {
        bot.homeX = home.x;
        bot.homeZ = home.z;
      }
    }


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
    this.botClassSkills(bot, dt);

    // !рыбачить — идём на озеро и рыбачим вместо обычного боя, отдельная
    // от всей остальной механики ветка (не трогает мобов/лут/зону).
    if (bot.fishing) {
      this.tickBotFishing(bot, dt);
      return;
    }

    // Зона бота — вокруг его дома (поляна у спавна или лагерь по уровню).
    // Пока бот на событии (!event) — «дом» временно смещаем в эпицентр:
    // цель по мобам, подбор лута и блуждание сами перенастраиваются туда.
    let cx = bot.homeX;
    let cz = bot.homeZ;
    if (bot.eventing) {
      if (this.state.eventKind === 0) {
        // Событие кончилось — ещё немного собираем награду в эпицентре, потом домой.
        if (bot.eventDoneAt === 0) bot.eventDoneAt = Date.now() + 20_000;
        if (Date.now() >= bot.eventDoneAt) {
          bot.eventing = false;
          bot.eventDoneAt = 0;
          bot.wanderCd = 0;
        } else {
          cx = this.state.eventX;
          cz = this.state.eventZ;
        }
      } else {
        cx = this.state.eventX;
        cz = this.state.eventZ;
        bot.eventDoneAt = 0;
      }
    }
    // Катакомбы: «дом» — текущий зал, со сдвигом по приказу зрителя (!встать) и отходом (!режим осторожно).
    let zoneR: number = BOT.zoneRadius;
    const catAnchor = this.cat.botAnchor(bot.id);
    if (catAnchor) {
      bot.eventing = false;
      bot.raiding = false;
      const spot = this.catTacticSpot(bot);
      cx = spot.x;
      cz = spot.z;
      zoneR = spot.r;
    }
    const inZone = (x: number, z: number): boolean =>
      Math.hypot(x - cx, z - cz) < zoneR;

    // Рейд (!raid): цель — босс, зона и обычные мобы побоку. Снимается, если
    // босс уже повержен или ещё не заспавнен.
    let raidBoss = bot.raiding ? this.bossMob() : undefined;
    if (raidBoss?.dead) raidBoss = undefined;
    if (bot.raiding && !raidBoss) bot.raiding = false;

    // !пугало: бот бьёт пугало в лагере (цель — только оно), пока не выйдет время.
    const testing = (bot.testUntil ?? 0) > Date.now();
    if (testing) this.scareTesters.add(p);
    else this.scareTesters.delete(p);
    const scare = testing ? this.sim.mobs.get(this.sim.scarecrowId) : undefined;

    // Цель: моб (не босс/осколок/пугало) в зоне.
    let mob = bot.target ? this.sim.mobs.get(bot.target) : undefined;
    const okMob = (m: { dead: boolean; kind: string; x: number; z: number; scarecrow?: boolean; practice?: boolean }): boolean =>
      !m.dead && m.kind !== "boss" && m.kind !== "shard" && !m.scarecrow && !m.practice && inZone(m.x, m.z);
    // Идёт событие (нашествие/охота), бот на нём: бьёт мобов ивента, пока они есть в зоне.
    const eventOnly = bot.eventing && this.state.eventKind !== 0;
    if (!mob || !okMob(mob) || (eventOnly && !this.sim.eventMobs.has(mob.id))) {
      bot.target = null;
      mob = undefined;
      // Сколько других ботов уже целятся в каждого моба — предпочитаем «своего».
      const claimed = new Map<string, number>();
      for (const other of this.bots.values()) {
        if (other === bot || !other.target) continue;
        claimed.set(other.target, (claimed.get(other.target) ?? 0) + 1);
      }
      const pickNearest = (onlyEvent: boolean): Mob | undefined => {
        let best: Mob | undefined;
        let bd = Infinity;
        for (const m of this.sim.mobs.values()) {
          if (!okMob(m) || (onlyEvent && !this.sim.eventMobs.has(m.id))) continue;
          const d = Math.hypot(m.x - p.head.x, m.z - p.head.z) + (claimed.get(m.id) ?? 0) * BOT.targetSpread;
          if (d < bd) {
            bd = d;
            best = m;
          }
        }
        return best;
      };
      // На ивенте мобов ивента нет в зоне — бьём ближайших, чтобы бот не стоял.
      mob = pickNearest(eventOnly) ?? (eventOnly ? pickNearest(false) : undefined);
      if (mob) bot.target = mob.id;
    }
    // Некого выбрать в зоне, но по боту бьёт моб рядом (вышел за радиус зоны —
    // например, погнался за героем от эпицентра события): отбиваемся, а не стоим.
    // По дороге на событие (!event) не отбиваемся — иначе стая вокруг не кончается и бот туда не доходит.
    const toEvent = bot.eventing && Math.hypot(p.head.x - cx, p.head.z - cz) > BOT.zoneRadius * 0.8;
    if (!mob && !bot.raiding && !toEvent && bot.hurtByMob && Date.now() - bot.hurtByMobAt < 5000 && !(eventOnly && !this.sim.eventMobs.has(bot.hurtByMob))) {
      const hm = this.sim.mobs.get(bot.hurtByMob);
      if (
        hm &&
        !hm.dead &&
        hm.kind !== "boss" &&
        hm.kind !== "shard" &&
        Math.hypot(hm.x - p.head.x, hm.z - p.head.z) < 14
      ) {
        mob = hm;
        bot.target = hm.id;
      }
    }

    // Катакомбы: кого бить — по приказу зрителя (!цель), отступая — никого.
    if (catAnchor) {
      if (bot.catRetreat) {
        mob = undefined;
        bot.target = null;
      } else {
        const pick = this.catFocusPick(bot, (m) => okMob(m) || m.id === this.cat.bossMob, { x: cx, z: cz });
        if (pick) {
          mob = pick;
          bot.target = pick.id;
        }
      }
    }

    // Кто вплотную (или только что ударил рядом), а цель дальше — сперва он: иначе бот бежит к
    // старой цели, упирается в тело моба (костяной призрак возник за спиной) и стоит под ударами.
    if (!raidBoss && mob && !bot.catRetreat) {
      const dCur = Math.hypot(mob.x - p.head.x, mob.z - p.head.z);
      let near: Mob | undefined;
      let nd = Infinity;
      const hm = bot.hurtByMob && Date.now() - bot.hurtByMobAt < BOT.closeThreatSec * 1000 ? this.sim.mobs.get(bot.hurtByMob) : undefined;
      for (const m of this.sim.mobs.values()) {
        if (m === mob || m.dead || m.kind === "boss" || m.kind === "shard" || m.scarecrow || m.practice) continue;
        if (eventOnly && !this.sim.eventMobs.has(m.id)) continue;
        const d = Math.hypot(m.x - p.head.x, m.z - p.head.z);
        const touching = d < MOB.bodyRadius * m.scale + PLAYER.radius + 0.8;
        if ((touching || (m === hm && d < BOT.closeThreat)) && d < nd) {
          nd = d;
          near = m;
        }
      }
      if (near && dCur > nd + 2) {
        mob = near;
        bot.target = near.id;
      }
    }

    // Рейд, но по боту лупит обычный моб / осколок босса — сперва добиваем
    // его (в радиусе raidAddRange и уже агрнут), потом снова к боссу. Делаем
    // это, подменяя цель на моба и снимая raidBoss на текущий тик: всё
    // движение/удар ниже уже умеют драться с обычным мобом.
    // Только у босса: по дороге в рейд мобов не трогаем — иначе бот, писавший !raid посреди
    // боя, так и бьёт стаю (агрнутые вокруг не кончаются) и к боссу не идёт.
    if (raidBoss && Math.hypot(raidBoss.x - p.head.x, raidBoss.z - p.head.z) < BOT.raidAddNear) {
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

    // «!follow»-телохранитель: не в рейде и есть цель для сопровождения —
    // бьём в первую очередь того, кто атакует цель, а если на неё никто не
    // напал — того, кого атакует цель сама (фокус-фаер). Приоритет выше
    // обычного «ближайший моб», но ниже активного !raid.
    if (!raidBoss && bot.followNorm) {
      let followedId: string | null = null;
      for (const [id, ps] of this.state.players) {
        if (id === bot.id) continue;
        if (normNick(ps.nick) === bot.followNorm) {
          followedId = id;
          break;
        }
      }
      if (followedId) {
        let guardId: string | null = null;
        for (const m of this.sim.mobs.values()) {
          if (m.dead || m.kind === "boss" || !m.aggro) continue;
          if (m.targetId === followedId) {
            guardId = m.id;
            break;
          }
        }
        if (!guardId) {
          const followedBot = this.bots.get(bot.followNorm);
          const followedRt = this.rt.get(followedId);
          const assistId = followedBot
            ? followedBot.target
            : followedRt && this.elapsed - followedRt.lastHitMobAt < BOT.guardAssistMemory
              ? followedRt.lastHitMobId
              : null;
          if (assistId) {
            const am = this.sim.mobs.get(assistId);
            if (am && !am.dead && am.kind !== "boss") guardId = am.id;
          }
        }
        if (guardId && guardId !== bot.target) bot.target = guardId;
        if (guardId) mob = this.sim.mobs.get(guardId);
      }
    }

    // Лут на земле — идём поднять раньше, чем добивать моба (моб подождёт).
    // Приоритет: апгрейд оружия СВОЕГО класса (gold/legendary) > бутылка зелья
    // (пока в сумке меньше BOT.potions+2 — не тащимся через полкарты за лишней).
    const wantPotion = countPotions(p) < BOT.potions + 2;
    // Апгрейд своего снаряжения — то, что бот реально наденет (не путать с
    // "любое оружие берём в склад" ниже, см. okLoot).
    const isEquipUpgrade = (w: { cls: WeaponClass; tier: WeaponTier }): boolean => botEquipUpgrade(p, bot.rt, w);
    let loot = bot.lootTarget ? this.sim.drops.get(bot.lootTarget) : undefined;
    const okLoot = (d: typeof loot): boolean => {
      if (!d || !lootFreeFor(d, bot.id)) return false; // чужой трофей — не бежим и не претендуем
      if (bot.lootSkip.has(d.id)) return false; // уже пробовали и не вышло
      const w = ITEMS[d.item].weapon;
      // Любое оружие берём — своего класса наденем, чужого просто унесём
      // в склад (потом вручную на !inv, если сменит билд, или разобрать на лом).
      if (w) return inZone(d.x, d.z);
      if (!((wantPotion || bot.eventing) && inZone(d.x, d.z) && ITEMS[d.item].heal > 0)) return false;
      // Сумка полна — поднять не выйдет: бот иначе вечно «подбирал» бы бутылку,
      // стоя на месте, пока его бьют мобы (баг на событии).
      const probe = readBag(p);
      return addToBag(probe, d.item, d.count) < d.count;
    };
    if (!okLoot(loot)) {
      bot.lootTarget = null;
      loot = undefined;
      let bestScore = -Infinity;
      for (const d of this.sim.drops.values()) {
        if (!okLoot(d)) continue;
        const w = ITEMS[d.item].weapon;
        // Апгрейд своего класса бот готов забрать через полкарты; чужого
        // класса — просто прибрать по пути, не делать ради него крюк.
        const reach = w ? (isEquipUpgrade(w) ? BOT.lootRadius * 3 : BOT.lootRadius) : BOT.lootRadius;
        const dd = Math.hypot(d.x - p.head.x, d.z - p.head.z);
        if (dd >= reach) continue;
        // апгрейд > любое другое оружие > бутылка; при прочих равных — что ближе.
        const score = (w ? (isEquipUpgrade(w) ? 2000 : 1000) : 0) - dd;
        if (score > bestScore) {
          bestScore = score;
          loot = d;
        }
      }
      if (loot) {
        bot.lootTarget = loot.id;
        bot.lootSince = Date.now();
      }
    }
    // Слишком долго идём/стоим у одного и того же лута (недоступен, застрял) —
    // бросаем его и возвращаемся к мобам.
    if (loot && Date.now() - bot.lootSince > 12_000) {
      if (bot.lootSkip.size > 40) bot.lootSkip.clear();
      bot.lootSkip.add(loot.id);
      bot.lootTarget = null;
      loot = undefined;
    }
    // Пока идём за мечом, моба не бьём — но и цель по мобу не бросаем:
    // okMob-выбор выше продолжает работать, просто движение приоритетнее.
    // В рейде цель одна — босс, всё остальное игнорируем.
    if (scare) {
      // Тест у пугала: только оно, без лута и посторонних мобов.
      mob = scare;
      bot.target = scare.id;
      loot = undefined;
    }
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

    // Каст «Прилива» на арене рейд-босса — бот бежит в разрыв, даже если пришёл не по !raid (за игроком
    // и т.п.): прилив убивает всех вне разрыва. В остальное время бьёт босса откуда стоит (вне разрыва —
    // урон RAID_FIGHT.outGap).
    const onRaidArena = this.raid.fighting && this.raid.isOn(bot.id);
    // Опасная зона (телеграф обвала/пламени, атаки Владыки) — бросаем всё и выбегаем.
    // Каст «Прилива» на рейде важнее: слеза ранит, а прилив убивает — бежим в разрыв.
    // Куда можно выбежать: на арене рейда — внутрь (не за край, в пустоту); в катакомбах — туда, где
    // можно стоять (не в стену: упёршись в неё, бот так и оставался в круге).
    const escOk = onRaidArena
      ? (x: number, z: number): boolean => Math.hypot(x - RAID.x, z - RAID.z) < this.raid.edge - 1.5
      : inCatRegion(p.head.x, p.head.z)
        ? (x: number, z: number): boolean => {
            const [qx, qz] = catProject(x, z, this.cat.open, PLAYER.radius + 0.3);
            return Math.abs(qx - x) + Math.abs(qz - z) < 0.05;
          }
        : undefined;
    // Катакомбы, режим «агрессивно»: зон умений мобов не обходит — стоит и бьёт (урон получает как обычно).
    const braveCat = bot.catMode === "brave" && this.cat.inRun(bot.id);
    const escape = braveCat || ((raidBoss || onRaidArena) && this.raid.tideCasting) ? null : this.dangerEscape(p.head.x, p.head.z, escOk);
    if (escape) mob = undefined;

    let tx: number;
    let tz: number;
    if (escape) {
      tx = escape.x;
      tz = escape.z;
    } else if (raidBoss) {
      tx = raidBoss.x;
      tz = raidBoss.z;
    } else if (loot) {
      tx = loot.x;
      tz = loot.z;
    } else if (mob) {
      tx = mob.x;
      tz = mob.z;
    } else if (bot.eventing && Math.hypot(p.head.x - cx, p.head.z - cz) > BOT.zoneRadius * 0.8) {
      // Ещё бежим к событию — прямо в эпицентр, без блужданий.
      tx = cx;
      tz = cz;
    } else if (follow) {
      tx = follow.x;
      tz = follow.z;
    } else if (catAnchor) {
      // Катакомбы, ждём волну: не бегаем по залу — встаём в строй вокруг центра отряда, каждый на своё место.
      const slot = this.catSlot(bot, cx, cz);
      tx = slot.x;
      tz = slot.z;
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
    // Куда шагать: напрямую или по маршруту в обход крутых склонов (sim/nav.ts).
    // Прицел и дистанции (удар, «стой тут») — по самой цели (dx/dz, dist).
    let [mdx, mdz] = this.botNavDir(bot, p, tx, tz, dx, dz, dist);
    // Ноги — в особую точку, прицел и удар — по-прежнему по боссу:
    // «Прилив» — в ближайший разрыв орбиты (там не гибнут), мимо кругов «Слезы»; ближний бой — у края
    //   туши, дальний — на дистанции стрельбы;
    // «Притяжение» — у центра жжёт: ждём сразу за кругом жжения, а не ныряем к боссу и обратно.
    let raidGapDist = -1;
    const fightBoss = raidBoss ?? (onRaidArena ? this.bossMob() : undefined);
    if (fightBoss && !fightBoss.dead && !escape && this.raid.fighting) {
      const edgeR = MOB.bodyRadius * fightBoss.scale * BOSS.bodyMult;
      let feet: { x: number; z: number } | null = null;
      if (this.raid.tideCasting) {
        const shooter = p.rightCls === "bow" || p.rightCls === "staff";
        const want = shooter ? edgeR + BOT.shootKeepDist * (p.rightCls === "staff" ? BOT.staffRangeMul : 1) : edgeR + PLAYER.radius + 0.9;
        const gp = this.raid.gapPoint(p.head.x, p.head.z, want, strPhase(bot.id) * 2 - 1, (x, z) => this.inDanger(x, z));
        if (gp) {
          raidGapDist = Math.hypot(gp.x - p.head.x, gp.z - p.head.z) || 1e-6;
          // К разрыву — в обход туши босса (по дуге), а не напрямик через неё.
          feet = this.raid.approach(p.head.x, p.head.z, gp, edgeR + PLAYER.radius + 1.2);
        }
      } else if (this.raid.pulling && Math.hypot(p.head.x - RAID.x, p.head.z - RAID.z) < RAID_FIGHT.pull.coreR + 3) {
        const a = raidAngle(p.head.x, p.head.z);
        const r = Math.min(this.raid.edge - 2.5, RAID_FIGHT.pull.coreR + 2.5);
        feet = { x: RAID.x + Math.sin(a) * r, z: RAID.z + Math.cos(a) * r };
        raidGapDist = Math.hypot(feet.x - p.head.x, feet.z - p.head.z) || 1e-6;
      }
      if (feet) {
        const gx = feet.x - p.head.x;
        const gz = feet.z - p.head.z;
        const gl = Math.hypot(gx, gz) || 1e-6;
        [mdx, mdz] = this.botNavDir(bot, p, feet.x, feet.z, gx / gl, gz / gl, gl);
      }
    }
    // Босс крупный (scale ~4.25): бить и останавливаться надо от его КРАЯ,
    // а не от центра — иначе бот лезет внутрь туши и мажет (см. resolveBotHit).
    // Радиус туши шире сферического хитбокса — BOSS.bodyMult (модель слизня).
    const bossR = (m: { scale: number }): number =>
      MOB.bodyRadius * m.scale * BOSS.bodyMult;
    const bossEdge = raidBoss ? bossR(raidBoss) : 0;
    // Крупный обычный моб: бот останавливается дальше от центра (см. stopAt ниже),
    // поэтому и замах должен начинаться с этой же дистанции — иначе бот стоит
    // перед големом и не бьёт (его центр дальше 1.7 м).
    const mobBodyExtra =
      mob && !raidBoss
        ? Math.max(0, PLAYER.radius + MOB.bodyRadius * mob.scale + 0.2 - BOT.attackRange * 0.7)
        : 0;
    // Копьё — длинный выпад: бот бьёт с большей дистанции.
    const attackReach = bossEdge + BOT.attackRange * botReachMul(p.rightCls) + mobBodyExtra;
    // Держимся от края туши босса: он крупный и сам скачет — иначе бот
    // оказывается внутри модели.
    const bossKeepOut = bossEdge + PLAYER.radius + 0.35;
    // Дальний бой: лучник/маг не подходит в упор — стоит на дистанции стрельбы
    // и отходит, если моб подобрался (как плевун).
    const ranged =
      (p.rightCls === "bow" || p.rightCls === "staff") && !loot && !!chasingMob;
    // Копейщик кайтит: держится у края досягаемости выпада и пятится, если моб подошёл.
    const kiter = p.rightCls === "spear" && !loot && !!mob && !raidBoss;
    const kiteBody = mob ? PLAYER.radius + MOB.bodyRadius * mob.scale + 0.2 : 0;
    const kiteHold = kiter ? Math.max(attackReach - 0.6, kiteBody) : 0;
    const kiteRetreatAt = kiteHold - 1.2;
    // Маг бьёт вдвое ближе лучника — и дистанция стрельбы, и «держись подальше».
    const rangeMul = p.rightCls === "staff" ? BOT.staffRangeMul : 1;
    const shootRange = BOT.shootRange * rangeMul;
    const shootKeep = BOT.shootKeepDist * rangeMul;
    const rangedStop = bossEdge + shootKeep;
    const stopAt = raidBoss
      ? ranged
        ? rangedStop
        : bossKeepOut + 0.4
      : loot
        ? WEAPON_TAKE_REACH * 0.85
        : ranged && mob
          ? shootKeep
          : kiter
            ? kiteHold
            : mob
            ? // Не ближе, чем граница тела моба + радиус героя: иначе симуляция
              // выталкивает моб из-под бота, и тот «бульдозерит» его назад,
              // пока бежит в упор (крупные элитные мобы, scale > 1.3).
              Math.max(BOT.attackRange * 0.7, PLAYER.radius + MOB.bodyRadius * mob.scale + 0.2)
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
    const against = sepX * mdx + sepZ * mdz;
    if (against < 0) {
      sepX -= mdx * against;
      sepZ -= mdz * against;
    }

    // Плавно разгоняемся к желаемой скорости и тормозим у цели — без рывков
    // на смене цели и у путевых точек.
    // На замахе и на эмоции (!cheer, авто-кувырок, левелап) ноги на месте: иначе модель
    // «едет» посреди анимации. Расталкивание при этом работает — соседи
    // всё равно не должны стоять внутри.
    const emoting = Date.now() < bot.emoteFreezeUntil;
    // Скорость бега — от характеристик персонажа (как у живого игрока), чуть
    // медленнее ради читаемости на стриме.
    const botSpeed =
      moveSpeedFor(p.level, p) * (p.scrollWindSecs > 0 ? SCROLL.windMul : 1) * (bot.rt.slowUntil > this.elapsed ? 1 - bot.rt.slowFrac : 1) *
      (bot.rt.abyssStrike && bot.rt.abyssUntil > this.elapsed ? 1 + ABYSS.move : 1);
    // Дальник отходит, если моб подобрался ближе shootKeepDist.
    const retreat =
      (ranged && chasingMob && dist < shootKeep - 1) || (kiter && kiteRetreatAt > kiteBody && dist < kiteRetreatAt);
    const wantSpeed = escape
      ? // Из опасной зоны — со всех ног, даже посреди замаха/эмоции.
        dist > 0.3
        ? botSpeed
        : 0
      : raidGapDist >= 0
        ? // Рейд: держимся в разрыве (он плывёт, арена несёт) — бежим и во время замаха.
          raidGapDist > 0.8
          ? botSpeed * Math.min(1, (raidGapDist - 0.8) / 1.5)
          : 0
        : bot.swingIn > 0 || emoting
          ? 0
          : retreat
            ? -botSpeed * 0.75
            : dist > stopAt
              ? botSpeed * Math.min(1, (dist - stopAt) / 1.5)
              : 0;
    // Лучник/маг на дистанции — не столбом: плавно ходит боком туда-сюда,
    // не сбивая прицел (перпендикуляр к линии на цель). Фаза своя у каждого
    // бота (по id), чтобы группа не дёргалась в такт.
    let strafeX = 0;
    let strafeZ = 0;
    if (ranged && raidGapDist < 0 && !retreat && dist <= stopAt && !emoting && bot.swingIn <= 0) {
      const s = Math.sin((this.elapsed * 0.5 + strPhase(bot.id) * 10) * Math.PI * 2);
      const strafeSpeed = botSpeed * 0.4 * s;
      strafeX = -dz * strafeSpeed;
      strafeZ = dx * strafeSpeed;
    }
    // Застрял: хочет идти, а за 3 с почти не сдвинулся (упёрся в склон/стенку пандуса, толкучка) —
    // путь заново и на секунду шаг вбок-назад.
    if (bot.unstickUntil && bot.unstickUntil > this.elapsed && !escape) {
      mdx = bot.unstickX ?? mdx;
      mdz = bot.unstickZ ?? mdz;
    } else if (wantSpeed > botSpeed * 0.5 && !p.dead) {
      if (bot.progAt === undefined || this.elapsed - bot.progAt > 3) {
        const moved = bot.progAt === undefined ? 99 : Math.hypot(p.head.x - (bot.progX ?? 0), p.head.z - (bot.progZ ?? 0));
        if (moved < 0.8) {
          bot.nav = undefined;
          const side = Math.random() < 0.5 ? 1 : -1;
          const ux = -mdz * side - mdx * 0.5;
          const uz = mdx * side - mdz * 0.5;
          const ul = Math.hypot(ux, uz) || 1;
          bot.unstickX = ux / ul;
          bot.unstickZ = uz / ul;
          bot.unstickUntil = this.elapsed + 1;
        }
        bot.progAt = this.elapsed;
        bot.progX = p.head.x;
        bot.progZ = p.head.z;
      }
    } else bot.progAt = undefined;
    // Убегая, соседей почти не расталкиваем (иначе толкают обратно в круг) и разгоняемся вдвое резче.
    const sepK = BOT.separationForce * (escape ? 0.3 : 1);
    const wvx = mdx * wantSpeed + sepX * sepK + strafeX;
    const wvz = mdz * wantSpeed + sepZ * sepK + strafeZ;
    const accel = Math.min(1, dt * (escape ? 12 : 6));
    bot.vx += (wvx - bot.vx) * accel;
    bot.vz += (wvz - bot.vz) * accel;
    this.botStep(p, bot, dt);

    // В тушу босса (и любого моба) бот своим шагом не заходит — см. botStep/botBlockedByMobs;
    // выталкивать его оттуда больше не нужно (это и было «мобы толкают героев»).

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
    const wantAim = ranged && !!chasingMob && !emoting && dist < shootRange;
    // Ближник у цели (или уже на замахе) — тоже смотрит на неё, а не по ходу:
    // иначе стоя/на шаге в сторону он бил моба боком или спиной.
    const meleeFace = !ranged && !!chasingMob && !emoting && (dist < attackReach + 1.5 || bot.swingIn > 0);
    const aimYaw = Math.atan2(dx, dz);
    // Идём — смотрим по ходу; целимся (дальник) или бьём вблизи — на моба.
    const facingYaw = wantAim || meleeFace
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
    if (wantAim || meleeFace) {
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
      const bow = p.rightCls === "bow";
      // Ролл «скорость атаки» — и у ботов (раньше учитывался только у живых игроков,
      // хотя в характеристиках показывался).
      // Посох — как у игрока (staffCastInterval: скорость каста от МДР), лук — темп от ЛОВ.
      const spdMul = rolledAtkSpeedMul(p, "right", bot.rt) * this.cryTempo(bot.rt);
      bot.attackCd = bow ? heroAttackInterval("bow", p.level, p, spdMul) : staffCastInterval(p.level, p, spdMul);
      const tgt = chasingMob;
      const ox = p.head.x;
      const oy = p.head.y - 0.25;
      const oz = p.head.z;
      // tgt.y — РЕАЛЬНАЯ высота моба (для летающих — высота полёта, не земля
      // под ними). Раньше тут стоял terrainHeight(tgt.x,tgt.z), то есть прицел
      // всегда целился в землю под летающим мобом — лучник/маг стабильно мазал.
      const aimY = tgt.y + MOB.bodyRadius * (tgt.scale ?? 1) - oy;
      const adx = tgt.x - ox;
      const adz = tgt.z - oz;
      // лёгкая компенсация проседания снаряда на дистанцию
      const ady = aimY + (bow ? 0.05 : 0.03) * Math.hypot(adx, adz);
      const mult = multIn(p, "right") * rolledDmgMul(p, "right", bot.rt);
      if (bow) {
        const botCrit = rolledCrit(p, "right", bot.rt);
        const critM = rollCritMult(
          "arrow",
          Math.random,
          false,
          botCrit.chance,
          botCrit.mult,
          BOW.critMult,
          attrOf(p, "luc"),
        );
        // Красный «X» — не сейчас, а в момент попадания стрелы (sim.critHits).
        this.sim.castBolt(
          ox, oy, oz, adx, ady, adz,
          BOT.arrowSpeed, 0.05, 0.2,
          weaponDamage("arrow", p.level, p, mult) * critM * this.buffMult(bot.id, "dmg"),
          bot.id, 2.5, 1, 0, 0, critM > 1,
        );
      } else {
        // Крит посоха у бота раньше вообще не считался (ни урон, ни эффект) —
        // в отличие от лука-бота выше и живого игрока-мага (см. MSG.cast).
        const botStaffCrit = rolledCrit(p, "right", bot.rt);
        const critM = rollCritMult(
          "sword",
          Math.random,
          false,
          botStaffCrit.chance,
          botStaffCrit.mult,
          STAFF_CRIT_MULT,
          attrOf(p, "luc"),
        );
        const bd =
          fireboltDamage(p.level, p, 0.7) *
          staffMagicTier(p.rightTier) *
          rolledDmgMul(p, "right", bot.rt) *
          critM *
          this.buffMult(bot.id, "dmg");
        this.sim.castBolt(
          ox, oy, oz, adx, ady, adz,
          BOT.boltSpeed, fireboltRadius(0.7), fireboltHitRadius(0.7),
          bd,
          bot.id, MAGIC.firebolt.life, 0,
          fireboltSplashRadius(0.7),
          bd * MAGIC.firebolt.splashFraction,
          critM > 1,
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
    // Замах — только когда уже довернулись на цель (не бить спиной).
    if (!ranged && chasingMob && !emoting && dist < attackReach && aimErr < BOT_MELEE_FACE && bot.attackCd <= 0 && bot.swingIn <= 0) {
      // Темп ближнего боя приглушён (meleeSpeedFor) — воины иначе к высоким
      // уровням машут как пропеллер. Анимация на клиенте гонится под тот же
      // множитель (RemoteAvatar тоже зовёт meleeSpeedFor).
      const atk = meleeSpeedFor(p.level, p);
      const kindB = p.rightCls === "dagger" || p.rightCls === "spear" || p.rightCls === "hammer" ? p.rightCls : "sword";
      bot.attackCd = heroAttackInterval(kindB, p.level, p, rolledAtkSpeedMul(p, "right", bot.rt) * this.cryTempo(bot.rt), isDualPair(p.leftCls, p.rightCls));
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
        this.botTakeDrop(bot, loot);
        bot.lootTarget = null;
      }
    }
    // По дороге куда угодно (событие, рейд, к хозяину) — подбираем всё, что
    // лежит рядом: оружие любого класса и зелья, пока есть место в сумке.
    if (!p.dead && p.towerFloor <= 0 && this.sim.drops.size > 0) {
      for (const d of [...this.sim.drops.values()]) {
        if (Math.hypot(d.x - p.head.x, d.z - p.head.z) > BOT_GRAB_RADIUS) continue;
        if (!lootFreeFor(d, bot.id) || bot.lootSkip.has(d.id)) continue;
        if (this.botTakeDrop(bot, d)) {
          if (bot.lootTarget === d.id) bot.lootTarget = null;
        } else {
          // Сумка полна — не пробуем этот лут каждый кадр.
          if (bot.lootSkip.size > 40) bot.lootSkip.clear();
          bot.lootSkip.add(d.id);
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
    p.hp = Math.min(
      p.maxHp,
      p.hp + potionHeal(ITEMS[used], p.hp, p.maxHp) * potionPowerFor(p),
    );
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
      BOT.attackRange * 1.4 * botReachMul(p.rightCls) +
      (mob.kind === "boss"
        ? MOB.bodyRadius * mob.scale * BOSS.bodyMult
        : Math.max(0, MOB.bodyRadius * (mob.scale - 1))); // край крупного тела, не центр
    if (Math.hypot(mob.x - p.head.x, mob.z - p.head.z) > reach) return;
    const kind: "sword" | "dagger" | "spear" | "hammer" =
      p.rightCls === "dagger" || p.rightCls === "spear" || p.rightCls === "hammer" ? p.rightCls : "sword";
    // «Призрак бездны»: удар из тени — бот возникает за спиной цели.
    if (bot.rt.abyssStrike && bot.rt.abyssUntil > this.elapsed) {
      const ax = mob.x - p.head.x;
      const az = mob.z - p.head.z;
      const al = Math.hypot(ax, az) || 1;
      const behind = this.sim.targetRadius("mob", mob.id) + JUMP_BEHIND;
      const bx = mob.x + (ax / al) * behind;
      const bz = mob.z + (az / al) * behind;
      this.broadcast(MSG.act, { k: "shadowStep", id: bot.id, x: p.head.x, y: p.head.y - PLAYER.eyeHeight, z: p.head.z, x2: bx, z2: bz, v: CLASS_IDS.indexOf("assassin") } satisfies ActRelay);
      this.placeBotAt(p, bx, bz, mob);
    }
    // Урон и все последствия — тем же путём, что у живого игрока (heroStrike).
    const killed = this.heroStrike(bot.id, p, bot.rt, "right", kind, mob, bot.swingDx, bot.swingDz);
    if (killed) bot.target = null;
  }

  /**
   * Бот с посохом — групповой лекарь. Если рядом несколько раненых союзников
   * (игроков или других ботов) — лечит всех разом вместо огнешара. Одного
   * раненого не трогает: это именно массовый хил.
   */
  /**
   * Бот с посохом — аура исцеления: включает, когда рядом ранены союзники
   * или сам просел по здоровью (откат и выбор умения проверяет castSkill).
   */
  private botGroupHeal(bot: Bot, dt: number): void {
    const p = bot.state;
    if (p.dead || p.rightCls !== "staff" || !hasSkill(p, "massHeal")) return;
    const selfLow = p.hp < p.maxHp * 0.5;
    if (!selfLow && this.woundedNear(p).length < BOT.healMinTargets) return;
    // Сам при смерти — без рандома, сразу.
    if (!selfLow && Math.random() >= BOT.skillChancePerSec * dt) return;
    if (this.castSkill("massHeal", bot.id, p, bot.rt, NaN, NaN)) this.triggerEmote(bot, "cheer");
  }

  /**
   * Бот с мечом — «Оглушающий удар»: бьёт землю, вокруг расходится волна и
   * все мобы в круге оглушены на несколько секунд. Урона почти нет — это
   * контроль. Применяет даже на одного моба (BOT.stunMinTargets = 1).
   */
  /**
   * Умения «Классов 2.0» у бота: всё выбранное, что не покрыто старыми
   * ботовыми умениями (меч — оглушение, лук — град, посох — лечение).
   * Применяет по обстановке, с тем же шансом в секунду, что и старые.
   */
  private botClassSkills(bot: Bot, dt: number): void {
    const p = bot.state;
    if (p.dead || bot.fishing) return;
    const cls = classOf2(p.leftCls as Weapon2 | "", p.rightCls as Weapon2 | "");
    if (!cls) return;
    // «Стрела жизни» — спасательная: HP ниже половины — без жребия и раньше второго умения.
    if ((p.skill1 === "lifeArrow" || p.skill2 === "lifeArrow") && p.hp < p.maxHp * 0.5) {
      const t = this.mobsInRadius(p, SKILLS2.lifeArrow.radius - 2).sort(
        (a, b) => Math.hypot(a.x - p.head.x, a.z - p.head.z) - Math.hypot(b.x - p.head.x, b.z - p.head.z),
      )[0];
      if (t && this.castSkill("lifeArrow", bot.id, p, bot.rt, t.x, t.z)) return;
    }
    // Чаще, чем у старых ботовых умений: умений из пула два, и условия у них свои — иначе откат простаивал.
    if (Math.random() >= BOT.skillChancePerSec * 3 * dt) return;
    // Лечение — своя ветка (botGroupHeal, по раненым); остальное — как у игрока, через castSkill.
    const legacy = (k: SkillId): boolean => k === "massHeal";
    const near = this.mobsInRadius(p, 11);
    if (near.length === 0) return;
    let nearest = near[0];
    let nd = Infinity;
    for (const m of near) {
      const d = Math.hypot(m.x - p.head.x, m.z - p.head.z);
      if (d < nd) {
        nd = d;
        nearest = m;
      }
    }
    for (const k of [p.skill1, p.skill2] as SkillId[]) {
      if (!k || legacy(k)) continue;
      let tx = nearest.x;
      let tz = nearest.z;
      if (k === "stunBash" && (cls === "assassin" ? nd > ASSASSIN_LEAP.range : this.mobsInRadius(p, SKILLS2.stunBash.radius).length === 0)) continue;
      if (k === "arrowRain") {
        if (cls === "assassin") {
          // Отскок с веером — когда моб подошёл вплотную: отскочить и закидать ножами.
          if (nd > 4) continue;
        } else {
          const spot = this.bestRainSpot(p);
          if (!spot) continue;
          tx = spot.x;
          tz = spot.z;
        }
      }
      if (k === "shadowStep" && (hopsBack(cls) ? nd > 4 : nd > 11)) continue;
      if (k === "crush" && nd > 8) continue;
      if (k === "cleave" && nd > SKILLS2.cleave.radius - 1) continue;
      if (k === "seal" && nd > 6) continue;
      if (k === "whirlwind" && this.mobsInRadius(p, cls === "spearman" ? 6 : 3.5).length < 1) continue;
      if (k === "warcry" && this.mobsInRadius(p, 8).length < 2) continue;
      if ((k === "mark" || k === "chain") && nd > 14) continue;
      // 🧪 Новые умения ассасина.
      if (k === "plague" && nd > 3) continue; // рывка нет — травить клинки, когда цель рядом
      if (k === "soulSteal" && nd > SOUL_STEAL.reach) continue;
      if (k === "lifeArrow" && (nd > SKILLS2.lifeArrow.radius - 2 || p.hp > p.maxHp * LIFE_ARROW.botBelow)) continue;
      if (k === "smoke" && this.mobsInRadius(p, 4).length < 2 && p.hp > p.maxHp * 0.6) continue;
      if (k === "abyss" && (nd > 3 || (p.hp > p.maxHp * 0.7 && this.mobsInRadius(p, 5).length < 3))) continue;
      if (this.castSkill(k, bot.id, p, bot.rt, tx, tz)) {
        bot.emoteFreezeUntil = Date.now() + 600;
        return;
      }
    }
  }

  /** Это тело бота зрителя (а не живого игрока)? */
  private isBotState(p: PlayerState): boolean {
    for (const b of this.bots.values()) if (this.state.players.get(b.id) === p) return true;
    return false;
  }

  /** Мобы в круге радиуса `r` вокруг точки корпуса игрока/бота. */
  private mobsInRadius(p: PlayerState, r: number): { id: string; x: number; z: number }[] {
    const out: { id: string; x: number; z: number }[] = [];
    // Пугала (главное и оба напарника — одно правило, иначе табло DPS у них разное): живому игроку
    // и боту на тесте !пугало — цели; остальных ботов не отвлекают.
    const withScare = this.scareTesters.has(p) || !this.isBotState(p);
    for (const m of this.sim.mobs.values()) {
      if (m.dead || ((m.scarecrow || m.practice) && !withScare)) continue;
      // Круг задевает тело, а не только центр (крупные мобы — ×5 по размеру).
      if (Math.hypot(m.x - p.head.x, m.z - p.head.z) > r + MOB.hitRadius * m.scale) continue;
      out.push({ id: m.id, x: m.x, z: m.z });
    }
    return out;
  }

  /** Табло пугала: «ник» / «DPS 1234 · макс. удар 567»; никто не бьёт — подсказка. */
  private scarecrowText(mobId: string): string {
    const i = this.sim.scareInfo(mobId);
    if (!i) return "Ударь меня — покажу урон\n!пугало — твой бот проверит билд";
    const nick = this.state.players.get(i.by)?.nick ?? "?";
    return `${nick}\nDPS ${Math.round(i.dps)} · макс. удар ${Math.round(i.max)}`;
  }

  /** `!пугало` / `!dps` — бот минуту бьёт пугало в лагере (над ним — DPS и макс. удар). */
  private botScarecrowTest(nick: string, norm: string): void {
    const bot = this.bots.get(norm);
    if (!bot) {
      if (this.hintOk(norm)) this.reply(`@${nick} героя нет в мире — сначала !play.`);
      return;
    }
    bot.testUntil = Date.now() + SCARECROW.botTestSec * 1000;
    bot.raiding = false;
    this.reply(`@${nick} герой идёт к пугалу в лагере и ${SCARECROW.botTestSec} с бьёт его — над пугалом DPS и макс. удар.`);
  }

  /**
   * Оглушающая волна вокруг корпуса `p` — общая для бота и игрока: урон + стан
   * всем мобам в радиусе.
   */
  // ---------------------------------------------------------------- умения «Классов 2.0»

  /**
   * Выбор двух умений класса (окно снаряжения/страница !inv). Класс — по
   * оружию в руках героя в мире, иначе по сохранённому снаряжению.
   */
  private chooseSkills(norm: string, p: PlayerState | null, ids: string[]): InvActResult {
    const token = `nick:${norm}`;
    const rec = store.get(token);
    const left = p ? p.leftCls : rec?.held?.left?.cls ?? "";
    const right = p ? p.rightCls : rec?.held?.right?.cls ?? "";
    const cls = classOf2(left as Weapon2 | "", right as Weapon2 | "");
    if (!cls) return { ok: false, text: "Возьми оружие — умения зависят от класса." };
    const allowed = CLASSES2[cls].skills;
    const pick = [...new Set(ids.filter((k): k is SkillId => allowed.includes(k as SkillId)))].slice(0, 2);
    if (pick.length === 0) return { ok: false, text: "Нужно выбрать умения своего класса." };
    if (p) {
      p.skill1 = pick[0] ?? "";
      p.skill2 = pick[1] ?? "";
    }
    const all = { ...(rec?.skills ?? {}) };
    all[cls] = pick;
    store.put(token, { skills: all });
    return { ok: true, text: `Умения: ${pick.map((k) => skillName(k, cls)).join(" и ")}` };
  }

  /** Печати на земле: лечат/защищают союзников, замедляют (и у боевого мага жгут) врагов. */
  private readonly seals: {
    x: number; z: number; r: number; until: number; owner: string; burn: number; tickT: number;
    /** Лечит союзников (маг поддержки). */
    heal: boolean;
    /** Доля урона, которую гасит союзникам в круге. */
    shield: number;
    /** Печать стража: мобы в круге бросаются на хозяина. */
    taunt: boolean;
  }[] = [];

  /** Множитель отката умений: у магов (посох/молот) — МДР ускоряет. */
  private skillCdMul(p: PlayerState): number {
    return skillCdMul2(classOf2(p.leftCls as Weapon2 | "", p.rightCls as Weapon2 | ""), p);
  }

  /** Выставить skill1/skill2 под класс оружия в руках (сохранённый выбор или по умолчанию). */
  private syncSkills(p: PlayerState, rt: Runtime): void {
    const cls = classOf2(p.leftCls as Weapon2 | "", p.rightCls as Weapon2 | "") ?? "";
    if (cls === rt.skillCls) return;
    rt.skillCls = cls;
    if (!cls) {
      p.skill1 = p.skill2 = "";
      return;
    }
    const def = CLASSES2[cls];
    const saved = rt.token ? store.get(rt.token)?.skills?.[cls] : undefined;
    const pick = (saved ?? []).filter((k): k is SkillId => def.skills.includes(k as SkillId));
    const use: SkillId[] = pick.length > 0 ? [...pick] : [...def.defaultSkills];
    // Умение могло уйти из класса (копьё: «Метка» → «Отскок») — добираем недостающее из умолчаний.
    for (const k of def.defaultSkills) if (use.length < 2 && !use.includes(k)) use.push(k);
    p.skill1 = use[0] ?? "";
    p.skill2 = use[1] ?? "";
  }

  /**
   * «Сила» умения — от оружия класса: у бойцов это удар основным оружием
   * (тир, роллы, баффы), у магов — магия (ИНТ, тир посоха/молота).
   */
  private skillPower(p: PlayerState, cls: ClassId, rt: Runtime, ownerId: string): { dmg: number; magic: boolean } {
    const buff = this.buffMult(ownerId, "dmg");
    const handOf = (c: string): "left" | "right" => (p.rightCls === c ? "right" : "left");
    switch (cls) {
      case "support": {
        const h = handOf("staff");
        return { dmg: fireboltDamage(p.level, p, 0.7) * staffMagicTier(p[`${h}Tier`]) * rolledDmgMul(p, h, rt) * 0.5 * buff, magic: true };
      }
      case "battlemage": {
        const h = handOf("hammer");
        return { dmg: 1.9 * magicPowerFor(p.level, p) * multIn(p, h) * rolledDmgMul(p, h, rt) * buff, magic: true };
      }
      case "archer": {
        const h = handOf("bow");
        return { dmg: weaponDamage("arrow", p.level, p, multIn(p, h) * rolledDmgMul(p, h, rt)) * buff, magic: false };
      }
      default: {
        const kind = cls === "assassin" ? "dagger" : cls === "spearman" ? "spear" : "sword";
        const h = handOf(kind);
        return { dmg: weaponDamage(kind, p.level, p, multIn(p, h) * rolledDmgMul(p, h, rt)) * buff, magic: false };
      }
    }
  }

  /**
   * Вытолкнуть бота из тел мобов (мобы не сдвигаются). Симуляция при
   * перекрытии двигает моба (ZoneSim: «не проходит сквозь игроков») — для
   * бота, которого ведёт сервер, правильнее подвинуть самого бота.
   */
  private botOutOfMobs(p: PlayerState, bot?: Bot, fromX = NaN, fromZ = NaN): void {
    for (const m of this.sim.mobs.values()) {
      if (m.dead) continue;
      const body = MOB.bodyRadius * m.scale * (m.kind === "boss" ? BOSS.bodyMult : 1);
      const keep = body + PLAYER.radius + 0.05;
      const dx = p.head.x - m.x;
      const dz = p.head.z - m.z;
      if (Math.abs(dx) > keep || Math.abs(dz) > keep) continue;
      const d = Math.hypot(dx, dz);
      if (d >= keep) continue;
      // Ровно в центре — выталкиваем в сторону, откуда пришёл (если известна).
      const fx = fromX - m.x;
      const fz = fromZ - m.z;
      const fl = Math.hypot(fx, fz);
      const ux = d > 1e-3 ? dx / d : fl > 1e-3 ? fx / fl : 1;
      const uz = d > 1e-3 ? dz / d : fl > 1e-3 ? fz / fl : 0;
      p.head.x = m.x + ux * keep;
      p.head.z = m.z + uz * keep;
      if (bot) {
        const inward = bot.vx * ux + bot.vz * uz;
        if (inward < 0) {
          bot.vx -= ux * inward;
          bot.vz -= uz * inward;
        }
      }
    }
  }

  /** Сколько ещё поисков пути ботам осталось в этом тике (BOT_NAV_PER_TICK). */
  private navBudget = 0;

  /**
   * Направление шага бота к цели: напрямую, если по прямой (до 40 м) нет крутого
   * подъёма, иначе — к следующей точке маршрута A* в обход (sim/nav.ts).
   * Маршрут пересчитывается раз в 2 с или когда цель сместилась больше чем на 5 м.
   */
  private botNavDir(bot: Bot, p: PlayerState, tx: number, tz: number, dx: number, dz: number, dist: number): [number, number] {
    // Цель на плато рейд-босса, а бот внизу — сперва к подножию пандуса (shared/raid raidWaypoint).
    const wp = raidWaypoint(p.head.x, p.head.z, tx, tz);
    if (wp) {
      [tx, tz] = wp;
      dist = Math.hypot(tx - p.head.x, tz - p.head.z) || 1;
      dx = (tx - p.head.x) / dist;
      dz = (tz - p.head.z) / dist;
    }
    if (dist < 3) return [dx, dz];
    let nav = bot.nav;
    if (!nav || this.elapsed - nav.at > 2 || Math.hypot(nav.tx - tx, nav.tz - tz) > 5) {
      const L = Math.min(dist, 40);
      const direct = straightOk(p.head.x, p.head.z, p.head.x + dx * L, p.head.z + dz * L);
      // Поиск пути дорогой — не больше BOT_NAV_PER_TICK за тик (иначе пики тика
      // в 100+ мс, когда много ботов перестраивают путь разом). Кто не успел —
      // идёт по старому пути (или напрямую) и пробует в следующий тик.
      if (!direct && this.navBudget <= 0) return nav?.path.length ? this.followNav(nav, p, dx, dz) : [dx, dz];
      if (!direct) this.navBudget--;
      nav = { tx, tz, at: this.elapsed, path: direct ? [] : (findPath(p.head.x, p.head.z, tx, tz) ?? []) };
      // Бот не в центре своей клетки: если до первой точки по прямой не пройти — сначала в центр клетки
      // (когда до него самого можно дойти: на границе клеток центр бывает выше по склону).
      if (nav.path.length && !straightOk(p.head.x, p.head.z, nav.path[0][0], nav.path[0][1])) {
        const c = navCellCenter(p.head.x, p.head.z);
        if (straightOk(p.head.x, p.head.z, c[0], c[1])) nav.path.unshift(c);
      }
      bot.nav = nav;
    }
    return this.followNav(nav, p, dx, dz);
  }

  /** Шаг по построенному пути бота: направление на текущую точку. */
  private followNav(nav: NonNullable<Bot["nav"]>, p: PlayerState, dx: number, dz: number): [number, number] {
    // Дошли до точки — следующая. Угол к следующей срезаем, только если к ней можно
    // пройти по прямой: путь проверен между центрами клеток, и у края горы бот,
    // срезав угол, упирался в склон и топтался на месте (лаборатория, опыт nav).
    while (nav.path.length) {
      const d = Math.hypot(nav.path[0][0] - p.head.x, nav.path[0][1] - p.head.z);
      const next = nav.path[1];
      if (d < 0.6 || (d < 1.8 && next && straightOk(p.head.x, p.head.z, next[0], next[1]))) nav.path.shift();
      else break;
    }
    if (!nav.path.length) return [dx, dz];
    const [wx, wz] = nav.path[0];
    const l = Math.hypot(wx - p.head.x, wz - p.head.z) || 1;
    return [(wx - p.head.x) / l, (wz - p.head.z) / l];
  }

  /**
   * Шаг бота по скорости: на крутой подъём не идёт — скользит вдоль склона (MAX_CLIMB);
   * в тело моба своим шагом не заходит (встаёт на край), но и моб его не выталкивает.
   */
  private botStep(p: PlayerState, bot: Bot, dt: number): void {
    const x0 = p.head.x;
    const z0 = p.head.z;
    const [sx, sz] = climbStep(p.head.x, p.head.z, bot.vx * dt, bot.vz * dt);
    if (sx === 0) bot.vx = 0;
    if (sz === 0) bot.vz = 0;
    p.head.x += sx;
    p.head.z += sz;
    this.botBlockedByMobs(p, bot, x0, z0);
    // Катакомбы: стены залов; иначе — та же граница, что у игроков (карта + пандус + плато рейда).
    if (inCatRegion(p.head.x, p.head.z)) [p.head.x, p.head.z] = catProject(p.head.x, p.head.z, this.cat.open, PLAYER.radius);
    else clampToPlay(p.head);
  }

  /**
   * Моб — препятствие для шага бота, но не толкатель: шаг ВНУТРЬ тела отменяем
   * (встаёт на край), а если моб сам оказался вплотную (прыжок, телепорт за
   * спину) — бота не выталкиваем, только глубже не пускаем. Раньше бота
   * выталкивало каждый тик — мобы «толкали» героев.
   */
  private botBlockedByMobs(p: PlayerState, bot: Bot, x0: number, z0: number): void {
    for (const m of this.sim.mobs.values()) {
      if (m.dead || m.scarecrow) continue;
      const keep = MOB.bodyRadius * m.scale * (m.kind === "boss" ? BOSS.bodyMult : 1) + PLAYER.radius + 0.05;
      const dx = p.head.x - m.x;
      const dz = p.head.z - m.z;
      if (Math.abs(dx) > keep || Math.abs(dz) > keep) continue;
      const d = Math.hypot(dx, dz);
      if (d >= keep) continue;
      const d0 = Math.hypot(x0 - m.x, z0 - m.z);
      if (d0 >= keep) {
        if (d > 1e-3) {
          p.head.x = m.x + (dx / d) * keep;
          p.head.z = m.z + (dz / d) * keep;
        } else {
          p.head.x = x0;
          p.head.z = z0;
        }
      } else if (d < d0) {
        p.head.x = x0;
        p.head.z = z0;
      }
      if (d > 1e-3) {
        const ux = dx / d;
        const uz = dz / d;
        const inward = bot.vx * ux + bot.vz * uz;
        if (inward < 0) {
          bot.vx -= ux * inward;
          bot.vz -= uz * inward;
        }
      }
    }
  }

  /** Бот после переноса умением: не внутри моба, высота — по земле. */
  /** `face` — сразу развернуть бота лицом к этой точке (прыжок за спину цели). */
  private placeBotAt(p: PlayerState, x: number, z: number, face?: { x: number; z: number }): void {
    const fromX = p.head.x;
    const fromZ = p.head.z;
    // Перенос умением — только докуда можно дойти, не забираясь на крутое (MAX_CLIMB).
    [p.head.x, p.head.z] = reachAlong(fromX, fromZ, x, z);
    this.botOutOfMobs(p, undefined, fromX, fromZ);
    if (inCatRegion(p.head.x, p.head.z)) [p.head.x, p.head.z] = catProject(p.head.x, p.head.z, this.cat.open, PLAYER.radius);
    p.head.y = terrainHeight(p.head.x, p.head.z) + PLAYER.eyeHeight;
    if (face) {
      const bot = [...this.bots.values()].find((b) => b.state === p);
      if (bot) {
        bot.yaw = Math.atan2(face.x - p.head.x, face.z - p.head.z);
        bot.rt.yaw = bot.yaw;
        p.head.qx = 0;
        p.head.qy = Math.sin(bot.yaw / 2);
        p.head.qz = 0;
        p.head.qw = Math.cos(bot.yaw / 2);
      }
    }
  }

  /** `!ульта` — ультимейт героя ника; откат ULT_COOLDOWN, проверяет сервер. */
  private castUltChat(nick: string, norm: string): void {
    const t = this.findWeaponsTarget(norm);
    if (!t || t.p.dead) {
      this.reply(`@${nick} ульта — только когда герой в мире и жив`);
      return;
    }
    const cls = classOf2(t.p.leftCls as Weapon2 | "", t.p.rightCls as Weapon2 | "");
    if (!cls) {
      this.reply(`@${nick} ульта — сначала возьми оружие класса`);
      return;
    }
    // Админ-ник (zeprogress) — ульта без отката, для проверки.
    const left = isAdminNick(nick) ? 0 : ULT_COOLDOWN - (this.elapsed - t.rt.ultAt);
    if (left > 0) {
      this.reply(`@${nick} ульта через ${Math.ceil(left / 60)} мин`);
      return;
    }
    t.rt.ultAt = this.elapsed;
    this.startUlt(t.id, t.p, t.rt, cls);
  }

  /** Замах ультимейта: кольцо на земле видно всем в зоне, по окончании — удар. */
  private startUlt(ownerId: string, p: PlayerState, rt: Runtime, cls: ClassId): void {
    const U = ULTS[cls];
    const v = CLASS_IDS.indexOf(cls);
    const feetY = p.head.y - PLAYER.eyeHeight;
    this.broadcast(MSG.act, { k: "ultWarn", id: ownerId, x: p.head.x, y: feetY, z: p.head.z, d: U.cast, r: U.radius, v } as ActRelay);
    // Бот стоит на месте и машет (cheer) весь замах: emoteFreezeUntil не даёт ему ехать.
    const bot = this.bots.get(normNick(p.nick));
    if (bot) {
      for (let t = 0; t < U.cast; t += BOT.emoteDuration.cheer) {
        this.clock.setTimeout(() => {
          const pp = this.state.players.get(ownerId);
          if (pp && !pp.dead) this.triggerEmote(bot, "cheer");
        }, t * 1000);
      }
    }
    this.clock.setTimeout(() => {
      const pp = this.state.players.get(ownerId);
      if (!pp || pp.dead) return;
      this.applyUlt(ownerId, pp, rt, cls);
    }, U.cast * 1000);
  }

  /** Удар ультимейта по кругу вокруг героя (центр — где он стоит в конце замаха). */
  private applyUlt(ownerId: string, p: PlayerState, rt: Runtime, cls: ClassId): void {
    const U = ULTS[cls];
    const v = CLASS_IDS.indexOf(cls);
    const pow = this.skillPower(p, cls, rt, ownerId);
    const cx = p.head.x;
    const cz = p.head.z;
    const feetY = p.head.y - PLAYER.eyeHeight;
    const act = (r: Omit<ActRelay, "id" | "v">): void => this.broadcast(MSG.act, { ...r, id: ownerId, v } as ActRelay);
    const inRing = (): Mob[] =>
      [...this.sim.mobs.values()].filter((m) => !m.dead && Math.hypot(m.x - cx, m.z - cz) - this.sim.targetRadius("mob", m.id) <= U.radius);
    const dirFrom = (m: Mob): [number, number] => {
      const d = Math.hypot(m.x - cx, m.z - cz) || 1;
      return [(m.x - cx) / d, (m.z - cz) / d];
    };
    const alive = (): boolean => {
      const pp = this.state.players.get(ownerId);
      return !!pp && !pp.dead;
    };
    act({ k: "ultHit", x: cx, y: feetY, z: cz, r: U.radius });
    switch (cls) {
      case "warrior":
        for (const m of inRing()) {
          const [dx, dz] = dirFrom(m);
          this.sim.hitMob(m.id, U.dmgMult * pow.dmg, dx, dz, ownerId, false, false, pow.magic);
          this.sim.stunMob(m.id, 5);
        }
        return;
      case "archer":
        for (let w = 0; w < ULT_ARCHER_WAVES; w++) {
          this.clock.setTimeout(() => {
            if (!alive()) return;
            for (const m of inRing()) {
              const [dx, dz] = dirFrom(m);
              this.sim.hitMob(m.id, U.dmgMult * pow.dmg, dx, dz, ownerId, true, false, pow.magic);
              this.sim.rootMob(m.id, 5);
            }
          }, w * 1000);
        }
        return;
      case "support":
        this.state.players.forEach((ally) => {
          if (ally.dead || ally.hp >= ally.maxHp) return;
          if (Math.hypot(ally.head.x - cx, ally.head.z - cz) > U.radius) return;
          const before = ally.hp;
          ally.hp = Math.min(ally.maxHp, ally.hp + ally.maxHp * ULT_HEAL_FRAC);
          if (ally !== p) this.sim.bossHeal(ownerId, ally.hp - before);
          act({ k: "ultHeal", x: ally.head.x, y: ally.head.y - PLAYER.eyeHeight, z: ally.head.z });
        });
        for (const m of inRing()) {
          const [dx, dz] = dirFrom(m);
          this.sim.hitMob(m.id, U.dmgMult * pow.dmg, dx, dz, ownerId, false, false, true);
          this.sim.slowMob(m.id, 6, 0.5);
          act({ k: "ultSlow", x: m.x, y: m.y, z: m.z });
        }
        return;
      case "assassin":
        for (let i = 0; i < ULT_ASSASSIN_HITS; i++) {
          this.clock.setTimeout(() => {
            if (!alive()) return;
            for (const m of inRing()) {
              const [dx, dz] = dirFrom(m);
              this.sim.hitMob(m.id, U.dmgMult * pow.dmg, dx, dz, ownerId, false, false, pow.magic, true);
            }
          }, i * ULT_ASSASSIN_STEP * 1000);
        }
        return;
      case "spearman":
        for (const m of inRing()) {
          const [dx, dz] = dirFrom(m);
          this.sim.hitMob(m.id, U.dmgMult * pow.dmg, dx, dz, ownerId, false, false, pow.magic);
        }
        // Втягивание: шесть мощных толчков к герою за 0.6 с, потом оглушение.
        for (let k = 0; k < ULT_PULL_PULSES; k++) {
          this.clock.setTimeout(() => {
            if (!alive()) return;
            for (const m of inRing()) {
              const [dx, dz] = dirFrom(m);
              this.sim.shoveMob(m.id, -dx, -dz, ULT_PULL_POWER);
            }
          }, (k + 1) * 100);
        }
        this.clock.setTimeout(() => {
          for (const m of inRing()) this.sim.stunMob(m.id, 3);
        }, (ULT_PULL_PULSES + 1) * 100);
        return;
      case "battlemage":
        for (const m of inRing()) {
          const [dx, dz] = dirFrom(m);
          this.sim.hitMob(m.id, U.dmgMult * pow.dmg, dx, dz, ownerId, false, false, true);
          this.sim.mobs.get(m.id)?.ignite((U.dmgMult * pow.dmg) / 6, ULT_BURN_SEC, ownerId);
        }
        return;
    }
  }

  /**
   * Применить умение из пула (игрок — по MSG.skill, бот — сам). Проверяет класс,
   * выбор (skill1/skill2) и откат. `tx,tz` — точка умения (NaN — перед героем).
   * true — применено.
   */
  private castSkill(kind: SkillId, ownerId: string, p: PlayerState, rt: Runtime, tx: number, tz: number): boolean {
    const cls = classOf2(p.leftCls as Weapon2 | "", p.rightCls as Weapon2 | "");
    if (!cls || !CLASSES2[cls].skills.includes(kind)) return false;
    if (p.skill1 !== kind && p.skill2 !== kind) return false;

    const sk = SKILLS2[kind];
    const cd = sk.cooldown * this.skillCdMul(p);
    if (this.elapsed - (rt.skillAt[kind] ?? -999) < cd) return false;
    rt.skillAt[kind] = this.elapsed;
    rt.lastSkillAt = this.elapsed;
    const v = CLASS_IDS.indexOf(cls);
    const feetY = p.head.y - PLAYER.eyeHeight;
    // Направление «вперёд»: к точке умения, иначе по взгляду головы.
    const fwd = (): [number, number] => {
      if (Number.isFinite(tx) && Number.isFinite(tz)) {
        const dx = tx - p.head.x;
        const dz = tz - p.head.z;
        const l = Math.hypot(dx, dz);
        if (l > 0.1) return [dx / l, dz / l];
      }
      const yaw = rt.yaw;
      return [Math.sin(yaw), Math.cos(yaw)];
    };
    const clampPoint = (maxR: number, defR: number): [number, number] => {
      const [fx, fz] = fwd();
      if (!Number.isFinite(tx) || !Number.isFinite(tz)) return [p.head.x + fx * defR, p.head.z + fz * defR];
      const dx = tx - p.head.x;
      const dz = tz - p.head.z;
      const l = Math.hypot(dx, dz);
      return l > maxR ? [p.head.x + (dx / l) * maxR, p.head.z + (dz / l) * maxR] : [tx, tz];
    };
    const pow = this.skillPower(p, cls, rt, ownerId);
    const isBot = this.bots.has(ownerId.replace(/^bot:/, ""));
    /** Мобы вокруг точки в радиусе (по краю тела). */
    const around = (x: number, z: number, r: number): Mob[] =>
      [...this.sim.mobs.values()].filter((m) => !m.dead && Math.hypot(m.x - x, m.z - z) - this.sim.targetRadius("mob", m.id) <= r);
    const dirTo = (m: Mob, x: number, z: number): [number, number] => {
      const d = Math.hypot(m.x - x, m.z - z) || 1;
      return [(m.x - x) / d, (m.z - z) / d];
    };
    const act = (r: Omit<ActRelay, "id" | "v">): void => this.broadcast(MSG.act, { ...r, id: ownerId, v } as ActRelay);

    switch (kind) {
      case "stunBash": {
        if (cls === "assassin") {
          // Смертельный прыжок: на цель до ASSASSIN_LEAP.range, удар с гарантированным критом и оглушение.
          const L = ASSASSIN_LEAP;
          const m0 = this.skillTarget(p, tx, tz, L.range, fwd());
          if (!m0) {
            rt.skillAt[kind] = -999;
            return false;
          }
          const [ax, az] = dirTo(m0, p.head.x, p.head.z);
          const behind = this.sim.targetRadius("mob", m0.id) + JUMP_BEHIND;
          const lx = m0.x + ax * behind;
          const lz = m0.z + az * behind;
          act({ k: "leap", x: p.head.x, y: feetY, z: p.head.z, x2: lx, z2: lz, d: L.time });
          this.clock.setTimeout(() => {
            const pp = this.state.players.get(ownerId);
            if (!pp || pp.dead) return;
            if (isBot) this.placeBotAt(pp, lx, lz, m0);
            if (m0.dead) return;
            this.sim.hitMob(m0.id, L.dmg * pow.dmg * WEAPONS2.dagger.critMult, ax, az, ownerId, false, false, false, true);
            this.sim.stunMob(m0.id, L.stun);
            this.critFx(m0.x, m0.y, m0.z, ownerId);
          }, L.time * 1000);
          return true;
        }
        act({ k: "stunBash", x: p.head.x, y: feetY, z: p.head.z, d: sk.castTime, r: sk.radius });
        this.clock.setTimeout(() => {
          const pp = this.state.players.get(ownerId);
          if (!pp || pp.dead) return;
          const px = pp.head.x;
          const pz = pp.head.z;
          act({ k: "stunHit", x: px, y: pp.head.y - PLAYER.eyeHeight, z: pz, r: sk.radius });
          for (const m of around(px, pz, sk.radius)) {
            const [dx, dz] = dirTo(m, px, pz);
            this.sim.hitMob(m.id, sk.dmgMult * pow.dmg, dx, dz, ownerId, false, false, pow.magic);
            if (cls === "archer") {
              // Ледяной заряд: пригвождает и отбрасывает, но не оглушает.
              this.sim.rootMob(m.id, 4);
              this.sim.shoveMob(m.id, dx, dz, 6);
            } else if (cls === "spearman") {
              this.sim.stunMob(m.id, 2);
              this.sim.slowMob(m.id, 6, 0.6);
            } else {
              this.sim.stunMob(m.id, cls === "battlemage" ? 2 : 3);
            }
          }
          if (cls === "battlemage") {
            // Громовой удар: молнии ещё по 3 мобам подальше.
            const far = around(px, pz, 8).filter((m) => Math.hypot(m.x - px, m.z - pz) > sk.radius * 0.6).slice(0, 3);
            for (const m of far) {
              act({ k: "chainHit", x: px, y: pp.head.y, z: pz, x2: m.x, z2: m.z, d: m.y + MOB.bodyRadius * m.scale, r: 0 });
              this.sim.hitMob(m.id, sk.dmgMult * pow.dmg, 0, 0, ownerId, false, false, true);
            }
          }
        }, sk.castTime * 1000);
        return true;
      }
      case "arrowRain": {
        if (cls === "assassin") {
          // Отскок с веером: отскок назад, затем три веера ножей конусом вперёд, каждый нож — кровотечение.
          const [fx, fz] = fwd();
          const hx = p.head.x - fx * ASSASSIN_FAN_HOP;
          const hz = p.head.z - fz * ASSASSIN_FAN_HOP;
          act({ k: "shadowStep", x: p.head.x, y: feetY, z: p.head.z, x2: hx, z2: hz });
          if (isBot) this.placeBotAt(p, hx, hz);
          act({ k: "fanKnives", x: p.head.x, y: feetY, z: p.head.z, x2: p.head.x + fx * FAN.range, z2: p.head.z + fz * FAN.range, d: FAN.volleys });
          for (let i = 0; i < FAN.volleys; i++) {
            this.clock.setTimeout(() => {
              const pp = this.state.players.get(ownerId);
              if (!pp || pp.dead) return;
              for (const m of around(pp.head.x, pp.head.z, FAN.range)) {
                const dx = m.x - pp.head.x;
                const dz = m.z - pp.head.z;
                const d = Math.hypot(dx, dz) || 1;
                if (Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d))) > FAN.halfAngle) continue;
                this.sim.hitMob(m.id, FAN.dmgMult * pow.dmg, dx / d, dz / d, ownerId, true);
                // Кровотечение — доля здоровья цели (как поджог мага), у босса и осколков слабее.
                const big = m.kind === "boss" || m.kind === "shard";
                this.sim.bleedMob(m.id, (m.pctHpBase * FAN.bleedHpFrac) / (big ? FAN.bossDiv : 1), FAN.bleedSec, ownerId);
              }
            }, (0.15 + i * 0.18) * 1000);
          }
          return true;
        }
        const spears = cls === "spearman";
        const radius = spears ? 5 : sk.radius;
        const [cx, cz] = clampPoint(SKILL.arrowRain.range, 12);
        act({ k: "arrowRain", x: cx, y: terrainHeight(cx, cz), z: cz, d: sk.castTime, r: radius });
        this.clock.setTimeout(() => {
          const pp = this.state.players.get(ownerId);
          if (!pp) return;
          if (cls === "archer") {
            this.arrowRainAt(cx, cz, ownerId, radius, pp, pp.rightCls === "bow" ? "right" : "left", rt);
          } else if (spears) {
            // Ливень копий: три тяжёлых копья, каждое оглушает.
            for (let i = 0; i < 3; i++) {
              this.clock.setTimeout(() => {
                this.broadcast(MSG.act, { k: "rainTick", id: ownerId, x: cx, y: terrainHeight(cx, cz), z: cz } satisfies ActRelay);
                for (const m of around(cx, cz, radius)) {
                  const [dx, dz] = dirTo(m, cx, cz);
                  this.sim.hitMob(m.id, 1.6 * pow.dmg, dx, dz, ownerId, true);
                  this.sim.stunMob(m.id, 1);
                }
              }, (0.4 + i * 0.8) * 1000);
            }
          } else {
            // Огненный дождь: волны магии, каждая поджигает.
            this.skillRainAt(cx, cz, ownerId, radius, sk.dmgMult * pow.dmg, true, true);
          }
        }, sk.castTime * 1000);
        return true;
      }
      case "shadowStep": {
        const archer = hopsBack(cls);
        const [fx, fz] = fwd();
        let ex: number;
        let ez: number;
        if (archer) {
          ex = p.head.x - fx * hopDistance(cls);
          ez = p.head.z - fz * hopDistance(cls);
        } else {
          [ex, ez] = clampPoint(11, 8);
        }
        const sx = p.head.x;
        const sz = p.head.z;
        rt.forceCritUntil = this.elapsed + 4;
        // Ассасин: рывок за спину цели (радиус тела + JUMP_BEHIND) и оглушение (бывший «Танец теней»).
        const stepTarget = cls === "assassin" ? this.skillTarget(p, tx, tz, 11, fwd()) : null;
        if (stepTarget) {
          this.sim.stunMob(stepTarget.id, ASSASSIN_STEP_STUN);
          const [ax, az] = dirTo(stepTarget, sx, sz);
          const behind = this.sim.targetRadius("mob", stepTarget.id) + JUMP_BEHIND;
          ex = stepTarget.x + ax * behind;
          ez = stepTarget.z + az * behind;
        }
        if (cls === "spearman") {
          // Ловушка копейщика: мобы вокруг стягиваются к старому месту в кучку и замедлены.
          const T = SPEAR_HOP_TRAP;
          act({ k: "seal", x: sx, y: feetY, z: sz, d: T.seconds, r: T.radius });
          for (let t = 0; t * T.pullStep < T.seconds; t++) {
            this.clock.setTimeout(() => {
              for (const m of around(sx, sz, T.radius)) {
                const d = Math.hypot(sx - m.x, sz - m.z);
                this.sim.slowMob(m.id, 1, T.slow);
                if (d < 1.2) continue;
                this.sim.shoveMob(m.id, (sx - m.x) / d, (sz - m.z) / d, Math.min(5, Math.max(2, d * 1.1)));
              }
            }, t * T.pullStep * 1000);
          }
        } else if (archer) {
          // Дымовая ловушка на старом месте: кто войдёт за 4 с — пригвождён на 3 с.
          act({ k: "seal", x: sx, y: feetY, z: sz, d: 4, r: 2.5 });
          for (let t = 0; t < 8; t++) {
            this.clock.setTimeout(() => {
              for (const m of around(sx, sz, 2.5)) this.sim.rootMob(m.id, 3);
            }, t * 500);
          }
        }
        if (!archer && !stepTarget) {
          // Рывок — за спину цели (как у игрока на клиенте), а не в её центр.
          const L = Math.hypot(ex - sx, ez - sz);
          if (L > 0.1) {
            ex += ((ex - sx) / L) * 1.4;
            ez += ((ez - sz) / L) * 1.4;
          }
        }
        if (isBot) {
          this.placeBotAt(p, ex, ez, stepTarget ?? undefined);
          ex = p.head.x;
          ez = p.head.z;
        }
        act({ k: "shadowStep", x: sx, y: feetY, z: sz, x2: ex, z2: ez });
        return true;
      }
      case "crush": {
        const [cx, cz] = clampPoint(8, 3.5);
        const cy = terrainHeight(cx, cz);
        act({ k: "crushMark", x: cx, y: cy, z: cz, d: sk.castTime, r: sk.radius });
        this.clock.setTimeout(() => {
          const pp = this.state.players.get(ownerId);
          if (!pp || pp.dead) return;
          // Бот приземляется в центр удара, но не внутрь моба — его выталкивает наружу.
          if (isBot) this.placeBotAt(pp, cx, cz);
          act({ k: "crushHit", x: cx, y: cy, z: cz, r: sk.radius });
          for (const m of around(cx, cz, sk.radius)) {
            const [dx, dz] = dirTo(m, cx, cz);
            this.sim.hitMob(m.id, sk.dmgMult * pow.dmg, dx, dz, ownerId, false, false, pow.magic);
            if (cls === "battlemage") this.sim.slowMob(m.id, 3, 0.55);
            else this.sim.stunMob(m.id, 1);
          }
          if (cls === "battlemage") {
            // Отхил бури: сам герой и союзники в круге волны.
            act({ k: "healAura", x: cx, y: cy, z: cz, d: 1.5, r: sk.radius });
            this.state.players.forEach((ally, aid) => {
              if (ally.dead || Math.hypot(ally.head.x - cx, ally.head.z - cz) > sk.radius + 1) return;
              const frac = aid === ownerId ? STORM_CRUSH.selfHeal : STORM_CRUSH.allyHeal;
              ally.hp = Math.min(ally.maxHp, ally.hp + ally.maxHp * frac);
            });
          }
        }, sk.castTime * 1000);
        return true;
      }
      case "whirlwind": {
        if (cls === "spearman") {
          // Град выпадов: серия быстрых колющих ударов конусом вперёд.
          const F = SPEAR_FLURRY;
          act({ k: "spearFlurry", x: p.head.x, y: feetY, z: p.head.z, d: F.duration, r: F.range });
          for (let i = 0; i < F.thrusts; i++) {
            this.clock.setTimeout(() => {
              const pp = this.state.players.get(ownerId);
              if (!pp || pp.dead) return;
              const [fx, fz] = fwd();
              const ox = pp.head.x;
              const oz = pp.head.z;
              for (const m of around(ox, oz, F.range)) {
                const vx = m.x - ox;
                const vz = m.z - oz;
                const d = Math.hypot(vx, vz) || 1;
                const slack = Math.asin(Math.min(1, this.sim.targetRadius("mob", m.id) / Math.max(d, 0.1)));
                if (Math.acos(Math.max(-1, Math.min(1, (vx * fx + vz * fz) / d))) > F.cone + slack) continue;
                // Каждый выпад — со своим критом (база копья, роллы «крит» на копье, удача с камнями).
                const rc = rolledCrit(pp, "right", rt);
                const critM = rollCritMult("spear", Math.random, false, rc.chance + WEAPONS2.spear.critBase - BASE_CRIT, rc.mult, WEAPONS2.spear.critMult, attrOf(pp, "luc"));
                this.sim.hitMob(m.id, F.dmg * pow.dmg * critM, vx / d, vz / d, ownerId, i === F.thrusts - 1, false, false, critM > 1);
              }
              this.broadcast(MSG.act, { k: "spearPierce", id: ownerId, x: ox, y: pp.head.y, z: oz, x2: ox + fx * F.range, z2: oz + fz * F.range, r: F.cone } satisfies ActRelay);
            }, ((F.duration / F.thrusts) * (i + 0.5)) * 1000);
          }
          return true;
        }
        const spear = false;
        const radius = spear ? WHIRL.spearRadius : sk.radius;
        const hits = spear ? WHIRL.spearHits : sk.hits;
        const mult = spear ? WHIRL.spearDmg : sk.dmgMult;
        rt.whirlUntil = this.elapsed + WHIRL.duration;
        rt.whirlKind = cls === "assassin" ? 2 : cls === "warrior" ? 1 : 0;
        act({ k: "whirl", x: p.head.x, y: feetY, z: p.head.z, d: WHIRL.duration, r: radius });
        const step = WHIRL.duration / hits;
        // Ассасин — вихрь-рывок: проносится вперёд (бота переносим по шагам; игрок летит сам — Game.castSkill).
        const [wfx, wfz] = fwd();
        for (let i = 0; i < hits; i++) {
          this.clock.setTimeout(() => {
            const pp = this.state.players.get(ownerId);
            if (!pp || pp.dead) return;
            if (cls === "assassin" && isBot) {
              const d = ASSASSIN_WHIRL_DASH / hits;
              this.placeBotAt(pp, pp.head.x + wfx * d, pp.head.z + wfz * d);
            }
            const near = around(pp.head.x, pp.head.z, radius);
            for (const m of near) {
              const [dx, dz] = dirTo(m, pp.head.x, pp.head.z);
              const critM = cls === "assassin" ? rollCritMult("dagger", Math.random, false, WEAPONS2.dagger.critBase - BASE_CRIT, 0, WEAPONS2.dagger.critMult, attrOf(pp, "luc")) : 1;
              this.sim.hitMob(m.id, mult * pow.dmg * critM, dx, dz, ownerId, false, false, pow.magic, critM > 1);
              if (spear) this.sim.shoveMob(m.id, dx, dz, 4);
              if (cls === "assassin") this.sim.slowMob(m.id, ASSASSIN_WHIRL_SLOW.sec, ASSASSIN_WHIRL_SLOW.mul);
            }
            if (cls === "battlemage") {
              // Каждый оборот — молния по соседу снаружи круга.
              const out = around(pp.head.x, pp.head.z, 7).find((m) => !near.includes(m));
              if (out) {
                act({ k: "chainHit", x: pp.head.x, y: pp.head.y, z: pp.head.z, x2: out.x, z2: out.z, d: out.y + MOB.bodyRadius * out.scale, r: 1 });
                this.sim.hitMob(out.id, mult * pow.dmg, 0, 0, ownerId, false, false, true);
              }
            }
          }, step * (i + 0.5) * 1000);
        }
        return true;
      }
      case "warcry": {
        const bless = cls === "support";
        const rally = cls === "spearman";
        const until = this.elapsed + (bless ? WARCRY.blessDuration : WARCRY.duration);
        this.state.players.forEach((ally, aid) => {
          if (ally.dead || Math.hypot(ally.head.x - p.head.x, ally.head.z - p.head.z) > sk.radius) return;
          const art = this.rt.get(aid);
          if (art) {
            art.cryUntil = Math.max(art.cryUntil, until);
            art.cryKind = rally ? 2 : bless ? 3 : 1;
          }
        });
        if (!bless && !rally) {
          for (const m of around(p.head.x, p.head.z, sk.radius)) this.sim.tauntMob(m.id, ownerId, WARCRY.aggroSec);
        }
        act({ k: "warcry", x: p.head.x, y: feetY, z: p.head.z, d: bless ? WARCRY.blessDuration : WARCRY.duration, r: sk.radius });
        return true;
      }
      case "mark": {
        const m = this.skillTarget(p, tx, tz, sk.radius, fwd());
        if (!m) {
          rt.skillAt[kind] = -999; // некого метить — откат не тратим
          return false;
        }
        this.sim.markMob(m.id, ownerId, MARK.duration, MARK.dmgMul);
        if (cls === "spearman") this.sim.slowMob(m.id, MARK.duration, 1 - MARK.slow);
        this.marks.set(m.id, { owner: ownerId, until: this.elapsed + MARK.duration });
        act({ k: "markOn", x: m.x, y: m.y, z: m.z, mobId: m.id, d: MARK.duration });
        return true;
      }
      case "massHeal": {
        // Аура исцеления: ходит за героем HEAL_AURA.duration с и каждые 0.5 с
        // понемногу лечит всех союзников в радиусе (итого — totalMul «полных лечений»).
        const h = p.rightCls === "staff" ? "right" : "left";
        const total = healAmountFor(p.level, p, BOT.healCharge) * BOT.healGroupFraction * rolledDmgMul(p, h, rt) * HEAL_AURA.totalMul;
        this.healAuras.push({ owner: ownerId, r: sk.radius, until: this.elapsed + HEAL_AURA.duration, perTick: total / (HEAL_AURA.duration * 2), tickT: 0 });
        act({ k: "healAura", x: p.head.x, y: feetY, z: p.head.z, d: HEAL_AURA.duration, r: sk.radius });
        return true;
      }
      case "chain": {
        if (cls === "support") return this.healChain(ownerId, p, pow.dmg, v);
        let cur: Mob | null = this.skillTarget(p, tx, tz, sk.radius, fwd());
        if (!cur) {
          rt.skillAt[kind] = -999;
          return false;
        }
        const archer = cls === "archer";
        const hits = archer ? 3 : sk.hits;
        const hitSet = new Set<string>();
        let fromX = p.head.x;
        let fromY = p.head.y - 0.3;
        let fromZ = p.head.z;
        let dmg = sk.dmgMult * pow.dmg * (archer ? 2 / 1.6 : 1);
        for (let i = 0; i < hits && cur; i++) {
          const m: Mob = cur;
          hitSet.add(m.id);
          const toY = m.y + MOB.bodyRadius * m.scale;
          act({ k: "chainHit", x: fromX, y: fromY, z: fromZ, x2: m.x, z2: m.z, d: toY, r: i });
          const dd = dmg;
          const dx = m.x - fromX;
          const dz = m.z - fromZ;
          this.clock.setTimeout(() => {
            this.sim.hitMob(m.id, dd, dx, dz, ownerId, false, false, true);
            if (!archer) this.sim.stunMob(m.id, 0.5);
          }, i * 90);
          dmg *= archer && i === 0 ? 0.35 : CHAIN.falloff;
          fromX = m.x;
          fromY = toY;
          fromZ = m.z;
          let next: Mob | null = null;
          let nd: number = CHAIN.jump;
          for (const o of this.sim.mobs.values()) {
            if (o.dead || hitSet.has(o.id)) continue;
            const d = Math.hypot(o.x - m.x, o.z - m.z);
            if (d < nd) {
              nd = d;
              next = o;
            }
          }
          cur = next;
        }
        return true;
      }
      case "seal": {
        const burn = cls === "battlemage" ? SEAL.burnPerSec * pow.dmg : 0;
        const guard = cls === "warrior";
        this.seals.push({
          x: p.head.x, z: p.head.z, r: sk.radius, until: this.elapsed + SEAL.duration, owner: ownerId, burn, tickT: 0,
          heal: cls === "support", shield: guard ? GUARD_SEAL.shield : cls === "support" ? SEAL.shield : 0, taunt: guard,
        });
        act({ k: "seal", x: p.head.x, y: feetY, z: p.head.z, d: SEAL.duration, r: sk.radius });
        return true;
      }
      case "plague": {
        rt.plagueUntil = this.elapsed + PLAGUE.duration;
        act({ k: "plagueOn", x: p.head.x, y: feetY, z: p.head.z, d: PLAGUE.duration });
        // 2026-10-07: рывок к цели убран по просьбе — только отравленные клинки на PLAGUE.duration.
        return true;
      }
      case "smoke": {
        const sec = SMOKE.duration * skillAttrMul("smoke", p);
        // Бомба — на моба-цель (дым вокруг него), нет цели — под собой.
        const tgt = this.skillTarget(p, tx, tz, SMOKE.range, fwd());
        const cx = tgt ? tgt.x : p.head.x;
        const cz = tgt ? tgt.z : p.head.z;
        this.sim.addSmoke(cx, cz, sk.radius, sec);
        act({ k: "smoke", x: cx, y: terrainHeight(cx, cz), z: cz, d: sec, r: sk.radius });
        return true;
      }
      case "lifeArrow": {
        // Лучник: тяжёлая стрела в цель, лечит стрелка (доля нанесённого урона + доля его макс. HP).
        const m = this.skillTarget(p, tx, tz, sk.radius, fwd());
        if (!m) {
          rt.skillAt[kind] = -999;
          return false;
        }
        const [dx, dz] = dirTo(m, p.head.x, p.head.z);
        const toY = m.y + MOB.bodyRadius * m.scale;
        act({ k: "lifeArrow", x: p.head.x, y: p.head.y - 0.3, z: p.head.z, x2: m.x, z2: m.z, d: toY });
        const hp0 = m.hp;
        this.sim.hitMob(m.id, sk.dmgMult * pow.dmg, dx, dz, ownerId, true);
        const dealt = Math.max(0, hp0 - Math.max(0, m.hp));
        const before = p.hp;
        p.hp = Math.min(p.maxHp, p.hp + dealt * LIFE_ARROW.healDmg + p.maxHp * LIFE_ARROW.healMax);
        const healed = Math.round(p.hp - before);
        if (healed > 0) this.sim.dmgHits.push({ x: p.head.x, y: p.head.y + 0.4, z: p.head.z, dmg: healed, by: ownerId, c: "heal" });
        this.broadcast(MSG.act, { k: "healHit", id: ownerId, x: p.head.x, y: p.head.y, z: p.head.z } satisfies ActRelay);
        return true;
      }
      case "soulSteal": {
        const m = this.skillTarget(p, tx, tz, SOUL_STEAL.reach, fwd());
        if (!m) {
          rt.skillAt[kind] = -999;
          return false;
        }
        const [dx, dz] = dirTo(m, p.head.x, p.head.z);
        const dmg = sk.dmgMult * pow.dmg;
        // Без рывка: удар на дистанции, герой остаётся на месте.
        this.sim.hitMob(m.id, dmg, dx, dz, ownerId);
        // Самый раненый союзник рядом (доля HP ниже SOUL_STEAL.healthy), иначе — сам.
        let ally: PlayerState = p;
        let worst: number = SOUL_STEAL.healthy;
        this.state.players.forEach((o) => {
          if (o.dead || o.maxHp <= 0 || o.towerFloor > 0) return;
          if (Math.hypot(o.head.x - p.head.x, o.head.z - p.head.z) > sk.radius) return;
          const f = o.hp / o.maxHp;
          if (f < worst) {
            worst = f;
            ally = o;
          }
        });
        const hp0 = ally.hp;
        ally.hp = Math.min(ally.maxHp, ally.hp + dmg * SOUL_STEAL.transfer * skillAttrMul("soulSteal", p));
        const healed = Math.round(ally.hp - hp0);
        if (healed > 0) this.sim.dmgHits.push({ x: ally.head.x, y: ally.head.y + 0.4, z: ally.head.z, dmg: healed, by: ownerId, c: "heal" });
        const allyId = this.idOf(ally) ?? ownerId;
        act({ k: "soulSteal", x: m.x, y: m.y + MOB.bodyRadius * m.scale, z: m.z, x2: ally.head.x, z2: ally.head.z, d: ally.head.y - 0.5 });
        this.broadcast(MSG.act, { k: "healHit", id: allyId, x: ally.head.x, y: ally.head.y, z: ally.head.z } satisfies ActRelay);
        return true;
      }
      case "cleave": {
        // Рассекающий удар (воин): широкий конус перед собой — урон, отброс, замедление.
        const [fx, fz] = fwd();
        act({ k: "spearPierce", x: p.head.x, y: p.head.y, z: p.head.z, x2: p.head.x + fx * sk.radius, z2: p.head.z + fz * sk.radius, r: CLEAVE.halfAngle });
        this.clock.setTimeout(() => {
          const pp = this.state.players.get(ownerId);
          if (!pp || pp.dead) return;
          const ox = pp.head.x;
          const oz = pp.head.z;
          act({ k: "stunHit", x: ox + fx * sk.radius * 0.5, y: pp.head.y - PLAYER.eyeHeight, z: oz + fz * sk.radius * 0.5, r: sk.radius * 0.5 });
          for (const m of around(ox, oz, sk.radius)) {
            const vx = m.x - ox;
            const vz = m.z - oz;
            const d = Math.hypot(vx, vz) || 1;
            const slack = Math.asin(Math.min(1, this.sim.targetRadius("mob", m.id) / Math.max(d, 0.1)));
            if (Math.acos(Math.max(-1, Math.min(1, (vx * fx + vz * fz) / d))) > CLEAVE.halfAngle + slack) continue;
            this.sim.hitMob(m.id, sk.dmgMult * pow.dmg, vx / d, vz / d, ownerId, false, false, pow.magic);
            this.sim.shoveMob(m.id, vx / d, vz / d, CLEAVE.shove);
            this.sim.slowMob(m.id, CLEAVE.slowSec, 1 - CLEAVE.slow);
          }
        }, sk.castTime * 1000);
        return true;
      }
      case "abyss": {
        rt.abyssUntil = this.elapsed + ABYSS.duration;
        rt.abyssStrike = true;
        rt.forceCritUntil = this.elapsed + ABYSS.duration;
        act({ k: "abyss", x: p.head.x, y: feetY, z: p.head.z, d: ABYSS.duration });
        return true;
      }
      default:
        return false;
    }
  }

  /** Цепь исцеления: светлая цепь по раненым союзникам рядом (каждый скачок слабее). */
  private healChain(ownerId: string, p: PlayerState, power: number, v: number): boolean {
    const hit = new Set<PlayerState>();
    let from = p;
    let heal = power * 2.2;
    for (let i = 0; i < 4; i++) {
      let best: PlayerState | null = null;
      let bd = i === 0 ? 14 : CHAIN.jump;
      this.state.players.forEach((ally) => {
        if (ally.dead || hit.has(ally) || ally.hp >= ally.maxHp) return;
        const d = Math.hypot(ally.head.x - from.head.x, ally.head.z - from.head.z);
        if (d < bd) {
          bd = d;
          best = ally;
        }
      });
      const target: PlayerState = best ?? (i === 0 ? p : (null as never));
      if (!target) break;
      hit.add(target);
      this.broadcast(MSG.act, {
        k: "chainHit", id: ownerId, x: from.head.x, y: from.head.y - 0.3, z: from.head.z,
        x2: target.head.x, z2: target.head.z, d: target.head.y - 0.5, r: i, v,
      } satisfies ActRelay);
      target.hp = Math.min(target.maxHp, target.hp + heal);
      this.broadcast(MSG.act, { k: "healHit", id: this.idOf(target) ?? ownerId, x: target.head.x, y: target.head.y, z: target.head.z } satisfies ActRelay);
      heal *= CHAIN.falloff;
      from = target;
      if (!best) break;
    }
    return true;
  }

  /** Ауры исцеления: ходят за хозяином и лечат союзников в радиусе. */
  private readonly healAuras: { owner: string; r: number; until: number; perTick: number; tickT: number }[] = [];

  private tickHealAuras(dt: number): void {
    for (let i = this.healAuras.length - 1; i >= 0; i--) {
      const a = this.healAuras[i];
      const o = this.state.players.get(a.owner);
      if (!o || o.dead || this.elapsed > a.until) {
        this.healAuras.splice(i, 1);
        continue;
      }
      a.tickT -= dt;
      if (a.tickT > 0) continue;
      a.tickT = 0.5;
      this.state.players.forEach((ally) => {
        if (ally.dead || ally.hp >= ally.maxHp) return;
        if (Math.hypot(ally.head.x - o.head.x, ally.head.z - o.head.z) > a.r) return;
        const before = ally.hp;
        ally.hp = Math.min(ally.maxHp, ally.hp + a.perTick);
        if (ally !== o) this.sim.bossHeal(a.owner, ally.hp - before);
      });
    }
  }

  /** Метки «Метки»: моб → кто поставил и до какого момента (сброс отката, если умер под меткой). */
  private readonly marks = new Map<string, { owner: string; until: number }>();

  /**
   * Цель умения: моб ближе всего к точке (tx,tz) (в пределах 3 м от неё), иначе
   * ближайший впереди (конус ~70°) в пределах maxR.
   */
  private skillTarget(p: PlayerState, tx: number, tz: number, maxR: number, f: [number, number]): Mob | null {
    let best: Mob | null = null;
    if (Number.isFinite(tx) && Number.isFinite(tz)) {
      let bd = 3;
      for (const m of this.sim.mobs.values()) {
        if (m.dead) continue;
        const d = Math.hypot(m.x - tx, m.z - tz) - this.sim.targetRadius("mob", m.id);
        if (d < bd && Math.hypot(m.x - p.head.x, m.z - p.head.z) <= maxR + 3) {
          bd = d;
          best = m;
        }
      }
      if (best) return best;
    }
    let bd = maxR;
    for (const m of this.sim.mobs.values()) {
      if (m.dead) continue;
      const dx = m.x - p.head.x;
      const dz = m.z - p.head.z;
      const d = Math.hypot(dx, dz);
      if (d > bd || d < 0.01 || (dx * f[0] + dz * f[1]) / d < 0.35) continue;
      bd = d;
      best = m;
    }
    return best;
  }

  /** Метки: цель умерла под меткой — откат «Метки» у поставившего сброшен. */
  private tickMarks(): void {
    for (const [id, mk] of this.marks) {
      const m = this.sim.mobs.get(id);
      const dead = !m || m.dead;
      if (dead && this.elapsed <= mk.until + 0.2) {
        const rt = this.rt.get(mk.owner);
        if (rt) rt.skillAt.mark = -999;
        const c = this.clients.find((cl) => cl.sessionId === mk.owner);
        const p = this.state.players.get(mk.owner);
        if (c && p) c.send(MSG.act, { k: "markReset", id: mk.owner, x: p.head.x, y: p.head.y, z: p.head.z } satisfies ActRelay);
      }
      if (dead || this.elapsed > mk.until) this.marks.delete(id);
    }
  }

  /** Залпы «дождя» умения (не лук): 5 волн за 3 с по кругу, мобы пригвождены. */
  private skillRainAt(cx: number, cz: number, ownerId: string, radius: number, dmg: number, magic: boolean, ignite = false): void {
    const { hits, duration } = SKILL.arrowRain;
    const step = duration / hits;
    const y = terrainHeight(cx, cz);
    for (let i = 0; i < hits; i++) {
      this.clock.setTimeout(() => {
        this.broadcast(MSG.act, { k: "rainTick", id: ownerId, x: cx, y, z: cz } satisfies ActRelay);
        for (const m of [...this.sim.mobs.values()]) {
          if (m.dead) continue;
          const dx = m.x - cx;
          const dz = m.z - cz;
          const d = Math.hypot(dx, dz);
          if (d > radius + MOB.hitRadius * m.scale) continue;
          if (ignite) m.ignite(dmg / 6, 6, ownerId);
          else this.sim.rootMob(m.id, step + 0.3);
          this.sim.hitMob(m.id, dmg, dx / (d || 1), dz / (d || 1), ownerId, true, false, magic);
        }
      }, step * (i + 0.5) * 1000);
    }
  }

  /** Стоит ли точка в какой-нибудь печати. */
  /** Сколько урона гасит самая сильная печать под точкой (0 — нет). */
  private sealShield(x: number, z: number): number {
    let best = 0;
    for (const s of this.seals) if (Math.hypot(x - s.x, z - s.z) <= s.r) best = Math.max(best, s.shield);
    return best;
  }

  /** Печати: раз в 0.5 с — лечение союзникам, замедление (и огонь) врагам. */
  private tickSeals(dt: number): void {
    for (let i = this.seals.length - 1; i >= 0; i--) {
      const s = this.seals[i];
      if (this.elapsed > s.until) {
        this.seals.splice(i, 1);
        continue;
      }
      s.tickT -= dt;
      if (s.tickT > 0) continue;
      s.tickT = 0.5;
      if (s.heal) {
        this.state.players.forEach((ally) => {
          if (ally.dead || ally.hp >= ally.maxHp) return;
          if (Math.hypot(ally.head.x - s.x, ally.head.z - s.z) > s.r) return;
          ally.hp = Math.min(ally.maxHp, ally.hp + ally.maxHp * SEAL.healFracPerSec * 0.5);
        });
      }
      for (const m of [...this.sim.mobs.values()]) {
        if (m.dead) continue;
        const dx = m.x - s.x;
        const dz = m.z - s.z;
        const d = Math.hypot(dx, dz);
        if (d - this.sim.targetRadius("mob", m.id) > s.r) continue;
        this.sim.slowMob(m.id, 0.8, 1 - SEAL.slow);
        if (s.taunt) this.sim.tauntMob(m.id, s.owner, 1);
        if (s.burn > 0) this.sim.hitMob(m.id, s.burn * 0.5, dx / (d || 1), dz / (d || 1), s.owner, false, true, true);
      }
    }
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
      // Пугало — проверка урона: град по нему, даже если оно одно (раньше бот залп по пугалу не кидал).
      if (m.scarecrow) n = Math.max(n, BOT.rainMinTargets);
      if (n > bestN) {
        bestN = n;
        best = { x: m.x, z: m.z };
      }
    }
    return bestN >= BOT.rainMinTargets ? best : null;
  }

  /**
   * Град стрел по кругу (cx,cz) — общий для бота и игрока. Область держится
   * SKILL.arrowRain.duration секунд: за это время в круг падает `hits` залпов, каждый
   * бьёт всех внутри уроном ОДНОЙ стрелы стрелка (характеристики, роллы, аффиксы, крит,
   * баффы — как обычный выстрел), а мобы всё это время пригвождены к земле.
   */
  private arrowRainAt(
    cx: number,
    cz: number,
    ownerId: string,
    radius: number,
    p: PlayerState,
    hand: "left" | "right",
    rt: Runtime,
  ): void {
    const { bowHits: hits, duration } = SKILL.arrowRain;
    const step = duration / hits;
    const y = terrainHeight(cx, cz);
    const mult = multIn(p, hand) * rolledDmgMul(p, hand, rt);
    const rc = rolledCrit(p, hand, rt);
    const t0 = this.elapsed;

    const pin = (): void => {
      const left = duration - (this.elapsed - t0) + 0.25;
      for (const m of this.sim.mobs.values()) {
        if (m.dead || Math.hypot(m.x - cx, m.z - cz) > radius + MOB.hitRadius * m.scale) continue;
        this.sim.rootMob(m.id, left);
      }
    };
    pin(); // пригвождены с первой секунды, не с первого залпа

    for (let i = 0; i < hits; i++) {
      this.clock.setTimeout(() => {
        pin();
        this.broadcast(MSG.act, { k: "rainTick", id: ownerId, x: cx, y, z: cz } satisfies ActRelay);
        const base =
          weaponDamage("arrow", p.level, p, mult) * this.buffMult(ownerId, "dmg");
        for (const m of [...this.sim.mobs.values()]) {
          if (m.dead) continue;
          const dx = m.x - cx;
          const dz = m.z - cz;
          const d = Math.hypot(dx, dz);
          if (d > radius) continue;
          // Крит — на каждую стрелу и цель отдельно.
          const critM = rollCritMult("arrow", Math.random, false, rc.chance, rc.mult, BOW.critMult, attrOf(p, "luc"));
          if (critM > 1) this.critFx(m.x, m.y, m.z, ownerId);
          this.sim.hitMob(m.id, base * critM, dx / (d || 1), dz / (d || 1), ownerId, true);
        }
      }, step * (i + 0.5) * 1000);
    }
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


  private tickBots(dt: number): void {
    // Наплыв игроков (`!play`): +2 слизня на бота, убираются когда толпа
    // расходится. Дёшево — sim ничего не делает, если число не изменилось.
    this.sim.setExtraSlimes(this.bots.size * 2);
    if (this.bots.size === 0) return;
    const nowMs = Date.now();
    // Снимаем бота, если ХОЗЯИН-ник не писал в чат канала дольше ownerAbsentSec.
    // `chatSeen` теперь пополняется ТОЛЬКО настоящими сообщениями хозяина
    // (см. onChat) — фарм самого бота таймер не двигает. Ники из STREAM_NICKS
    // (тестовые/стримерские) живут всегда.
    const absentLimit = BOT.ownerAbsentSec * 1000;
    for (const bot of [...this.bots.values()]) {
      if (
        !STREAM_NICKS.includes(bot.norm) &&
        !this.nickIsPlayed(bot.norm) &&
        nowMs - (this.chatSeen.get(bot.norm) ?? 0) > absentLimit
      ) {
        this.removeBot(bot.norm);
        continue;
      }
      this.tickBot(dt, bot);
    }
  }

  // ---- тик ----

  private step(dt: number): void {
    const perfT0 = serverPerf.now();
    this.stepInner(dt);
    serverPerf.tick(serverPerf.now() - perfT0);
  }

  /** Диагностика (server/perf.ts): время патча состояния — сериализация и отправка всем клиентам. */
  override broadcastPatch(): boolean {
    const t0 = serverPerf.now();
    const r = super.broadcastPatch();
    serverPerf.section("patch", serverPerf.now() - t0);
    return r;
  }

  private stepInner(dt: number): void {
    this.elapsed += dt;
    this.navBudget = BOT_NAV_PER_TICK;
    if (this.state.dayAuto !== 0) this.worldHour = advanceHour(this.worldHour, dt);
    // Раз в syncSeconds сверяем клиентов — между сверками они крутят часы сами.
    this.clockSync += dt;
    if (this.clockSync >= DAYCYCLE.syncSeconds) {
      this.clockSync = 0;
      this.state.hour = this.worldHour;
    }

    this.persistClock += dt;
    if (this.persistClock >= 10) {
      const perfP0 = serverPerf.now();
      this.persistClock = 0;
      this.state.players.forEach((_p, id) => {
        const c = this.clientOf(id);
        if (c) this.persist(c);
      });
      for (const bot of this.bots.values()) this.persistBot(bot);
      world.save(this.sim.saveDrops());
      this.broadcastLeaderboard();
      serverPerf.section("persist", serverPerf.now() - perfP0);
    }

    this.tickEvents();
    this.tickChatQuest();
    this.tickRaid();
    this.cat.tick();
    this.raid.tick(dt);
    const perfB0 = serverPerf.now();
    this.tickBots(dt);
    serverPerf.section("bots", serverPerf.now() - perfB0);
    this.maybeSayTip(dt);

    this.tickSeals(dt);
    this.tickHealAuras(dt);
    this.tickMarks();
    // «Боевой клич»: секунды для клиента (темп атак) и плашки баффов.
    this.state.players.forEach((p, id) => {
      const rt = this.rt.get(id);
      const left = rt ? Math.max(0, Math.ceil(rt.cryUntil - this.elapsed)) : 0;
      if (p.crySecs !== left) p.crySecs = left;
      const sec = (until: number | undefined): number => Math.max(0, Math.ceil((until ?? 0) - this.elapsed));
      const plague = sec(rt?.plagueUntil);
      if (p.plagueSecs !== plague) p.plagueSecs = plague;
      const abyss = rt?.abyssStrike ? sec(rt.abyssUntil) : 0;
      if (p.abyssSecs !== abyss) p.abyssSecs = abyss;
      const smoke = p.dead ? 0 : Math.ceil(this.sim.smokeLeft(p.head.x, p.head.z));
      if (p.smokeSecs !== smoke) p.smokeSecs = smoke;
      const kind = left > 0 ? (rt?.cryKind ?? 0) : 0;
      if (p.cryKind !== kind) p.cryKind = kind;
    });
    // Умения «Классов 2.0»: набор под класс по оружию в руках.
    this.state.players.forEach((p, id) => {
      const rt = this.rt.get(id);
      if (rt) this.syncSkills(p, rt);
    });

    // Мана восстанавливается всегда (от интеллекта).
    this.state.players.forEach((p) => {
      if (p.mana < p.maxMana) {
        p.mana = Math.min(p.maxMana, p.mana + manaRegenFor(p) * dt);
      }
    });

    // Оглушение (см. hurtPlayer: rt.stunnedUntil, "Чародей руин") — в схему,
    // чтобы соседи/спектатор видели звёздочки над героем, а не только сам
    // оглушённый ощущал заморозку управления (тот применяет её себе локально).
    this.state.players.forEach((p, id) => {
      const rt = this.rt.get(id);
      p.stunned = rt && rt.stunnedUntil > this.elapsed ? 1 : 0;
      // Текст роллов надетого инстанса — для тултипа в инвентаре (Ф14).
      if (rt) {
        const lw = rolledIn(p, "left", rt);
        const rw = rolledIn(p, "right", rt);
        p.leftAffix = heldAffixText(lw);
        p.rightAffix = heldAffixText(rw);
      }
    });

    // Мобы гоняются только за живыми и только за теми, кто ВНЕ безопасной зоны
    // лагеря (HUB). Внутри HUB игрок для ИИ мобов не существует — ни агро, ни
    // погони, ни ударов. Проверка серверная: клиент себя безопасным не объявит.
    const players: SimPlayer[] = [];
    this.state.players.forEach((p, id) => {
      if (p.dead || inHubSafeZone(p.head.x, p.head.z)) return;
      // 🧪 «Призрак бездны»: в тени мобы героя не видят. Тень кончилась без удара — всё равно ускорение.
      const prt = this.rt.get(id);
      if (prt?.abyssStrike && prt.abyssUntil <= this.elapsed) {
        prt.abyssStrike = false;
        prt.hasteUntil = this.elapsed + ABYSS.hasteSec;
      }
      if (prt && prt.abyssUntil > this.elapsed) return;
      players.push({ sessionId: id, x: p.head.x, y: p.head.y, z: p.head.z });
    });

    const perfS0 = serverPerf.now();
    const hits = this.sim.tick(dt, players);
    serverPerf.section("sim", serverPerf.now() - perfS0);

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
      s.stunned = m.stunned ? 1 : 0;
      s.pinned = m.rooted ? 1 : 0;
      s.marked = m.markT > 0 ? 1 : 0;
      s.under = m.underground ? 1 : 0;
      s.burning = Math.min(255, Math.ceil(m.burningT));
      s.bleeding = Math.min(255, Math.ceil(m.bleedT));
      s.enraged = m.enraged ? 1 : 0; // босс и разъярённый элита события
      if (m.scarecrow || m.practice) {
        const info = this.scarecrowText(m.id);
        if (s.info !== info) s.info = info;
      }
      if (m.kind === "boss") {
        s.windup = m.slamTelegraph;
        s.slamSeq = m.slamSeq;
        s.charging = m.charging ? 1 : 0;
      } else if (m.novaCaster) {
        // Чародей руин: тот же телеграф/кольцо, что у слэма босса.
        s.windup = m.novaTelegraph;
        s.slamSeq = m.novaSeq;
      }
    }
    this.state.mobs.forEach((_s, id) => {
      if (!this.sim.mobs.has(id)) this.state.mobs.delete(id);
    });
    // Визуал спец-атак мобов топ-зоны (облако спор, рывок призрака) — всем.
    for (const m of this.sim.mobs.values()) {
      if (m.fx.length === 0) continue;
      for (const f of m.fx) {
        this.broadcast(MSG.act, {
          k: f.k, id: m.id, x: f.x, y: terrainHeight(f.x, f.z), z: f.z, d: f.d, x2: f.x2, z2: f.z2, r: f.r,
        } satisfies ActRelay);
        // Круг-предупреждение полевого моба (прыжок Скалолома, Землерой, молния духа) — боты выбегают.
        if ((f.k === "leapMark" || f.k === "burrowMark" || f.k === "stormMark") && f.r) this.addDanger(f.x, f.z, f.r + 0.6, (f.d ?? 1) + 0.2);
        // Ледяной круг (ледяной демон, Лунный аватар) — тоже выбегают.
        if (f.k === "freezeMark") this.addDanger(f.x, f.z, FREEZE.radius + 0.6, (f.d ?? 1) + 0.2);
      }
      m.fx.length = 0;
    }
    // Эффекты не от конкретного моба (колючки Шипохвоста на земле).
    for (const f of this.sim.fx) {
      this.broadcast(MSG.act, { k: f.k, id: "", x: f.x, y: terrainHeight(f.x, f.z), z: f.z, d: f.d, x2: f.x2, z2: f.z2, r: f.r } satisfies ActRelay);
    }
    this.sim.fx.length = 0;
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
        s.k = b.code;
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
      const raw = k.xp * this.buffMult(k.owner, "xp");
      const xp = Number.isFinite(lvlCap) ? Math.min(raw, lvlCap) : raw;
      this.awardXp(this.clientOf(k.owner), kp, xp);
    }
    this.sim.mobXpShare.length = 0;
    // Криты снарядов — красный «X» в точке попадания стрелы.
    for (const c of this.sim.critHits) this.critFx(c.x, c.y, c.z, c.owner);
    this.sim.critHits.length = 0;
    // Числа урона у спектатора — батчем за тик, только если тумблер включён
    // (не тратим сеть/CPU зря, если никто не смотрит или выключено с пульта).
    // Герой промахнулся (моб увернулся / неуязвим) — «MISS» над героем: точка — его голова.
    for (const mm of this.sim.mobMisses) {
      const ap = this.state.players.get(mm.attacker);
      this.broadcast(MSG.act, {
        k: "miss", id: mm.attacker, x: ap ? ap.head.x : mm.x, y: ap ? ap.head.y : mm.y, z: ap ? ap.head.z : mm.z, mobId: mm.mobId,
      } satisfies ActRelay);
    }
    this.sim.mobMisses.length = 0;
    // Яд: стак — зелёное кольцо под мобом, взрыв — зелёная вспышка по кругу.
    for (const f of this.sim.poisonFx) {
      if (f.burst) this.broadcast(MSG.act, { k: "plagueBurst", id: f.by, x: f.x, y: terrainHeight(f.x, f.z), z: f.z, r: PLAGUE.burstRadius } satisfies ActRelay);
      else this.broadcast(MSG.act, { k: "poisonStack", id: f.by, x: f.x, y: f.y, z: f.z, mobId: f.mobId, r: f.stacks, d: PLAGUE.stackSec } satisfies ActRelay);
    }
    this.sim.poisonFx.length = 0;
    for (const b of this.sim.bleedTicks) this.broadcast(MSG.act, { k: "bleedTick", id: b.by, x: b.x, y: b.y, z: b.z, mobId: b.mobId } satisfies ActRelay);
    this.sim.bleedTicks.length = 0;
    if (this.sim.dmgHits.length) {
      const hits = this.sim.dmgHits;
      for (const c of this.clients) {
        if (this.spectators.has(c.sessionId)) {
          // Спектаторам — по переключателю пульта «Числа урона».
          if (this.state.dmgNumbers) c.send(MSG.dmgHits, { hits } satisfies DmgHitsMsg);
          continue;
        }
        // Игрокам — всегда (показ решает каждый в своём меню), но только рядом.
        const p = this.state.players.get(c.sessionId);
        if (!p) continue;
        const near = hits.filter((h) => Math.abs(h.x - p.head.x) < DMG_NUM_R && Math.abs(h.z - p.head.z) < DMG_NUM_R);
        if (near.length) c.send(MSG.dmgHits, { hits: near } satisfies DmgHitsMsg);
      }
      this.sim.dmgHits.length = 0;
    }
    // Добивания: счётчик kills добившему + кил-фид (кроме осколков и босса —
    // босса объявляем отдельно — ником того, кто нанёс последний удар).
    let bossKiller = "";
    for (const k of this.sim.mobKills) {
      const krt = this.rt.get(k.owner);
      if (krt) krt.kills++;
      if (k.jm > 0) this.jewelDrop(k.owner, k.jm);
      this.chatQuestKill(k.owner, k.champ);
      if (k.campType) {
        this.questEvent(k.owner, { campType: k.campType, champ: k.champ });
      }
      if (k.kind === "boss") {
        bossKiller = this.state.players.get(k.owner)?.nick ?? "";
        this.bumpFeat(k.owner, "bossKills", TITLE_GOALS.bossKills, "Гроза Багрового");
      }
      if (k.kind === "shard" || k.kind === "boss") continue;
      const kp = this.state.players.get(k.owner);
      if (!kp) continue;
      const victim = k.name || (k.kind === "spitter" ? "Плевун" : "Слизень");
      this.broadcast(MSG.killFeed, { by: kp.nick, victim });
    }
    this.sim.mobKills.length = 0;
    for (const owner of this.sim.dragonTop) this.bumpFeat(owner, "dragonTop", TITLE_GOALS.dragonTop, "Драконоборец");
    this.sim.dragonTop.length = 0;
    // Опыт с босса — гибридный делёж (поровну + за вклад, с потолком) считает
    // ZoneSim. Здесь только раздаём и режем «не больше уровня за один бой».
    if (this.sim.bossXpShare.length) {
      let topOwner = "";
      let topXp = -1;
      for (const k of this.sim.bossXpShare) {
        // Участник победы над Багровым — задание «Рейд».
        this.questEvent(k.owner, { boss: true });
        const kp = this.state.players.get(k.owner);
        if (kp) {
          const lvlCap = xpToNext(kp.level); // Infinity на максимальном уровне
          const raw = k.xp * this.buffMult(k.owner, "xp");
          const xp = Number.isFinite(lvlCap) ? Math.min(raw, lvlCap) : raw;
          this.awardXp(this.clientOf(k.owner), kp, xp);
          if (xp > topXp) {
            topXp = xp;
            topOwner = kp.nick;
          }
        }
      }
      // Объявляем добившего; нет его (добил DoT/ушёл) — самого полезного по опыту.
      if (bossKiller) topOwner = bossKiller;
      if (topOwner) this.broadcast(MSG.killFeed, { by: topOwner, victim: "Багровый" });
      const loot = this.sim.bossLoot
        .map((l) => (l.aegis ? AEGIS_NAME : l.count > 1 ? `${l.count}× ${ITEMS[l.id].short}` : ITEMS[l.id].name))
        .join(" · ");
      const lootItems: LootItem[] = this.sim.bossLoot.map((l) => ({ id: l.id, count: l.count, ...(l.aegis ? { aegis: true } : {}) }));
      this.sim.bossLoot.length = 0;
      this.broadcast(MSG.bossEvent, {
        kind: "down", by: topOwner, loot: loot || undefined,
        lootItems: lootItems.length ? lootItems : undefined,
      });
      this.bossFighting = false;
      this.sim.bossXpShare.length = 0;
    }

    this.sim.adaptBoss();
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
      s.aegis = isAegis(d.instance) ? 1 : 0;
      this.state.drops.set(d.id, s);
    }
    this.state.drops.forEach((_s, id) => {
      if (!this.sim.drops.has(id)) this.state.drops.delete(id);
    });

    this.pickupLoot();

    for (const h of hits) this.hurtPlayer(h);
    this.tickBleeds(dt);
    this.tickPlayers(dt);
    // Катакомбы: что бы ни сдвинуло бота (отброс моба, рывок умения) — за стену не выходит.
    if (this.cat.busy) {
      for (const bot of this.bots.values()) {
        const p = bot.state;
        if (p.dead || !inCatRegion(p.head.x, p.head.z) || !this.cat.inRun(bot.id)) continue;
        [p.head.x, p.head.z] = catProject(p.head.x, p.head.z, this.cat.open, PLAYER.radius);
      }
    }
  }

  /** Кровотечение героев: каждые полсекунды — урон средой (не блокируется, не уворачивается). */
  private tickBleeds(dt: number): void {
    this.state.players.forEach((p, id) => {
      const rt = this.rt.get(id);
      if (!rt || rt.bleedUntil <= this.elapsed || p.dead) return;
      rt.bleedT -= dt;
      if (rt.bleedT > 0) return;
      rt.bleedT = 0.5;
      this.hurtPlayer({ target: id, dmg: rt.bleedDps * 0.5, fromX: p.head.x, fromZ: p.head.z, projectile: false, dot: true, byMob: rt.bleedBy || undefined });
    });
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
        if (!lootFreeFor(d, id)) continue; // чужой трофей — бронь ещё не истекла
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
    // Герой в башне: его HP считает и пишет TowerRoom (onTowerSnapshot), сам он
    // спрятан высоко над картой (TOWER_HIDE) в её же X/Z — мобы основного мира
    // мерят дистанцию до цели только по x/z (без Y, см. ZoneSim.ts), поэтому
    // без этой проверки мобы у центра карты могли «доставать» героя башни и
    // рвать ему HP параллельно с боем в башне (скачки HP туда-сюда).
    if (p.towerFloor > 0) return;

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

    const blockChance = blockChanceOf(p, rt);
    // Уворот (ловкость): один предмет в руках (лук/посох — обе руки заняты
    // им одним) — вдвое подвижнее второй свободной руки (щит/второй меч).
    const oneHanded = holdsOneItem(p.leftCls, p.rightCls);
    // Яд (облако спор) — не удар: ни увернуться, ни закрыться щитом.
    // 🧪 «Пелена смерти»: моб из дыма промахивается через раз, герою в дыму — +уворот.
    const srcMob = h.byMob ? this.sim.mobs.get(h.byMob) : undefined;
    const smokeMiss = !!srcMob && this.sim.inSmoke(srcMob.x, srcMob.z) && Math.random() < SMOKE.miss;
    const smokeDodge = this.sim.inSmoke(p.head.x, p.head.z) ? SMOKE.dodge : 0;
    const dodged = !h.dot && (smokeMiss || Math.random() < dodgeChance(p, oneHanded, p.leftCls === "dagger" || p.rightCls === "dagger") + smokeDodge);
    const block = h.dot
      ? { mult: 1, by: 0 as BlockedBy }
      : dodged
        ? { mult: 0, by: 3 as BlockedBy }
        : resolveBlock(guard, ax, az, h.projectile, blockChance);
    // Разъярённый владыка события бьёт сильнее.
    let inDmg = h.dmg;
    // Багровый бьёт под уровень своих бойцов (BOSS_ADAPT) — и сгустками тоже.
    const bossM = this.bossMob();
    if (bossM && h.byMob === bossM.id) inDmg *= bossM.adaptDmgMul;
    if (h.byMob && h.byMob === this.huntBossId && this.sim.mobs.get(this.huntBossId)?.raging) {
      inDmg *= EVENT.eliteHunt.enrageDmgMul;
    }
    // Броня от силы гасит любой урон; интеллект добавляет защиту от снарядов/магии.
    // Магический удар вблизи (Костяной призрак) броню от силы проходит, режется интеллектом.
    const magicMob = !!h.magic || (!h.projectile && !!h.byMob && !!this.sim.mobs.get(h.byMob)?.magicMelee);
    let dmg = inDmg * block.mult * (magicMob ? 1 - magicResistFrac(p) : 1 - armorFrac(p));
    // Физический снаряд (копьё, шипы 40 ур.) — только броня, без маг. защиты.
    const magicShot = !!h.projectile && !h.phys;
    // Ролл щита: Физ. защита гасит физический удар, Маг. защита (круглый щит) — магию и снаряды.
    const heldShield = h.dot ? null : shieldOf(p, rt);
    if (heldShield?.inst) {
      dmg *= 1 - (magicMob || magicShot ? shieldMagDef(heldShield.inst) : shieldPhysDef(heldShield.inst));
    }
    if (magicMob && dmg > 0 && !h.dot) {
      this.broadcast(MSG.act, { k: "magicHit", id: h.target, x: p.head.x, y: p.head.y, z: p.head.z } satisfies ActRelay);
    }
    // «Тепло костра» (лагерь): входящий урон меньше на CAMPFIRE.buffDef.
    if (rt.campBuffUntil > Date.now()) dmg *= 1 - CAMPFIRE.buffDef;
    if (magicShot) dmg *= 1 - magicResistFrac(p);
    // «Печать»: стоишь в круге союзника (или своём) — входящий урон меньше.
    dmg *= 1 - this.sealShield(p.head.x, p.head.z);
    // «Благословение» мага поддержки: −15% входящего урона.
    if (rt.cryUntil > this.elapsed && rt.cryKind === 3) dmg *= 1 - WARCRY.blessDef;
    // «Вихрь» воина — −30% урона, «Танец клинков» ассасина — неуязвимость.
    if (rt.whirlUntil > this.elapsed) dmg *= rt.whirlKind === 2 ? 0 : rt.whirlKind === 1 ? 1 - WHIRL.warriorDef : 1;
    rt.sinceHurt = 0;
    if (dmg > 0) p.hp = Math.max(0, p.hp - dmg);
    // Уникальный щит — отражение: часть удара моба (до защиты) уходит
    // атакующему, и при блоке тоже. Не от яда и не при увороте. dot=true в
    // hitMob — без вздрагивания/кулдауна удара и без «зеркала» Ледяного демона.
    const shield = h.dot || dodged ? null : shieldOf(p, rt);
    const reflect = shield ? shieldReflect(shield.inst) : 0;
    if (reflect > 0 && h.byMob) {
      const src = this.sim.mobs.get(h.byMob);
      if (src && !src.dead) {
        const hp0 = src.hp;
        this.sim.hitMob(src.id, inDmg * reflect, -ax, -az, h.target, h.projectile, true);
        // Тик (dot) в hitMob цифру не показывает — отражение было незаметным: своя цифра и вспышка.
        const back = Math.round(Math.max(0, hp0 - Math.max(0, src.hp)));
        if (back > 0) {
          const my = src.y + MOB.bodyRadius * src.scale * 1.4;
          this.sim.dmgHits.push({ x: src.x, y: my, z: src.z, dmg: back, by: h.target, mob: src.id, c: "reflect" });
          this.broadcast(MSG.act, { k: "reflectHit", id: h.target, x: p.head.x, y: p.head.y - 0.6, z: p.head.z, x2: src.x, z2: src.z, d: my } satisfies ActRelay);
        }
      }
    }
    // Эгида, «Оплот»: успешный блок УДАРА ВБЛИЗИ лечит (снаряды и выстрелы — нет; 2026-10-05).
    if (shield && !h.projectile && block.by === 1 && block.mult === 0 && isAegis(shield.inst) && p.hp > 0) {
      p.hp = Math.min(p.maxHp, p.hp + p.maxHp * SHIELD.aegisHealFrac);
      this.broadcast(MSG.act, { k: "healHit", id: h.target, x: p.head.x, y: p.head.y, z: p.head.z } satisfies ActRelay);
    }
    // Вампиризм моба (Костяной призрак) — от реально прошедшего урона.
    if (h.lifesteal && h.byMob && dmg > 0) {
      const m = this.sim.mobs.get(h.byMob);
      if (m && !m.dead) m.hp = Math.min(m.maxHp, m.hp + dmg * h.lifesteal);
    }

    // Увернулся — спец-эффекты атаки (оглушение/отбрасывание) тоже мимо.
    // (Клиент живого игрока применит стан/отбрасывание сам — см. MSG.mobHit ниже.)
    // Полный блок щитом — тоже мимо.
    if (!dodged && !(block.by === 1 && block.mult === 0)) {
      if (h.stunSec) rt.stunnedUntil = this.elapsed + h.stunSec;
      if (h.slowSec) {
        rt.slowUntil = this.elapsed + h.slowSec;
        rt.slowFrac = h.slowFrac ?? 0.4;
      }
      // Кровотечение (Метатель копий): доля прошедшего урона в секунду, тикает в tickBleeds.
      if (h.bleedSec && dmg > 0) {
        const still = rt.bleedUntil > this.elapsed ? rt.bleedDps : 0;
        rt.bleedDps = Math.max(still, dmg * (h.bleedFrac ?? 0.1));
        rt.bleedUntil = this.elapsed + h.bleedSec;
        rt.bleedBy = h.byMob ?? "";
      }
      if (h.knockback && h.target.startsWith("bot:")) {
        // Живой игрок отталкивает себя сам (см. MobHitMsg.knockback) — сервер
        // не двигает его тело; бот — сервер сам, толкаем позицию напрямую.
        const dist = h.knockback * 0.35;
        // На крутой склон отбросом не закинуть (MAX_CLIMB).
        [p.head.x, p.head.z] = reachAlong(p.head.x, p.head.z, p.head.x - ax * dist, p.head.z - az * dist);
      }
    }

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
      stunSec: dodged ? undefined : h.stunSec,
      slowSec: dodged || (block.by === 1 && block.mult === 0) ? undefined : h.slowSec,
      slowFrac: h.slowFrac,
      knockback: dodged ? undefined : h.knockback,
      byMob: h.byMob,
    });

    // Соседям — звук/FX: щёлкнул щит, звякнул меч, увернулся или охнул от урона.
    const k: ActKind =
      block.by === 1 ? "blockShield" : block.by === 2 ? "blockSword" : block.by === 3 ? "dodge" : "hurt";
    // «MISS» — над тем, кто промазал: над мобом (источником удара), а не над увернувшимся;
    // для звуков блока/удара позиция — сам игрок.
    const relayX = block.by === 3 ? h.fromX : p.head.x;
    const relayZ = block.by === 3 ? h.fromZ : p.head.z;
    const relay: ActRelay = {
      k,
      id: h.target,
      x: relayX,
      y: p.head.y,
      z: relayZ,
      mobId: block.by === 3 ? h.byMob : undefined,
    };
    this.broadcast(MSG.act, relay, { except: this.clientOf(h.target) });

    if (p.hp <= 0) {
      p.dead = 1;
      // Катакомбы: воскрешение только через reviveSec (и только если кто-то из отряда жив).
      rt.respawnIn = this.cat.inRun(h.target) ? CATACOMBS.reviveSec : RESPAWN.delay;
      this.broadcast(MSG.killFeed, { by: h.byName ?? "", victim: p.nick });
    }
  }

  /**
   * Приоритет героя для авто-камеры спектатора: 3 — новичок (заказал !play
   * или зашёл в игру менее 3 минут назад), 2 — участвует в событии или идёт
   * на босса или хозяин бота писал в чат за последние 3 мин, 0 — остальные.
   */
  private camPrioOf(id: string, p: PlayerState): number {
    const bot = id.startsWith("bot:") ? this.bots.get(id.slice(4)) : undefined;
    if (bot) {
      if (bot.spawnedAt > 0 && Date.now() - bot.spawnedAt < FRESH_MS) return 3;
      if (bot.eventing || bot.raiding) return 2;
      // Хозяин недавно писал в чат Twitch — показываем его бота чаще.
      if (Date.now() - (this.chatSeen.get(bot.norm) ?? 0) < CHAT_CAM_MS) return 2;
      return 0;
    }
    const joined = this.joinedAt.get(id);
    if (joined !== undefined && Date.now() - joined < FRESH_MS) return 3;
    if (
      this.state.eventKind !== 0 &&
      Math.hypot(p.head.x - this.state.eventX, p.head.z - this.state.eventZ) < BOT.zoneRadius
    ) {
      return 2;
    }
    return 0;
  }

  /** Склад оружия — клиенту, когда изменился (инвентарь в игре показывает то же, что веб-инвентарь). */
  private syncWarehouse(id: string, rt: Runtime): void {
    if (id.startsWith("bot:")) return;
    // + оценка: после заточки роллы (и скорость атаки) меняются — список надо переслать.
    // В руке — то, что реально считается в руке (закреплённое или лучший экземпляр того же вида).
    const p = this.state.players.get(id);
    const heldR = p ? (rolledIn(p, "right", rt)?.id ?? null) : null;
    let heldL = p ? (rolledIn(p, "left", rt)?.id ?? null) : null;
    if (heldL === heldR) heldL = null;
    const sig = rt.weapons.map((w) => `${w.id}:${weaponQuality(w)}${w.fav ? "*" : ""}`).join(",") + "|" + (heldL ?? "") + "|" + (heldR ?? "");
    if (sig === rt.weaponsSig) return;
    const client = this.clientOf(id);
    if (!client) return;
    rt.weaponsSig = sig;
    client.send(MSG.weaponsList, {
      list: rt.weapons.map((w) => ({
        id: w.id,
        cls: w.cls,
        tier: w.tier,
        name: instanceName(w),
        affixes: instanceLabels(w),
        effects: instanceEffects(w),
        quality: weaponQuality(w),
        atkSpd: affixSum(w.affixes, "atkSpeedPct"),
        fav: !!w.fav,
        scrap: scrapValue(w),
      })),
      equipped: { left: heldL, right: heldR },
    } satisfies WeaponsListMsg);
  }

  /** Реген, отсчёт до возрождения. */
  private tickPlayers(dt: number): void {
    this.tickPlayerFishing();
    this.state.players.forEach((p, id) => {
      const rt = this.rt.get(id);
      if (!rt) return;
      p.camPrio = this.camPrioOf(id, p);
      this.syncWarehouse(id, rt);
      if (p.dead) {
        rt.respawnIn -= dt;
        // Катакомбы: пока живых в отряде нет — не воскрешаем (режиссёр засчитает поражение);
        // встать — значит потратить жизнь отряда (кончились — лежит до следующего зала).
        if (rt.respawnIn <= 0 && !(this.cat.inRun(id) && (!this.catAnyAlive() || !this.cat.takeLife(id)))) this.respawn(id, p, rt);
        return;
      }
      // В башне ХП считает и пишет сама TowerRoom (см. onTowerSnapshot) —
      // обычный реген тут же накинул бы очки поверх и смазал бы урон боя.
      if (id.startsWith("bot:") && this.bots.get(id.slice(4))?.inTower) return;
      if (rt.invuln > 0) rt.invuln -= dt;
      rt.sinceHurt += dt;
      const now = Date.now();
      const buffLeft = Math.max(0, rt.eventBuffUntil - now);
      p.buffSecs = Math.min(65535, Math.ceil(buffLeft / 1000));
      // Лагерь: по всей площади — бафф «Тепло костра» (таймер всегда полный)
      // и быстрый реген сразу, без паузы после урона.
      if (inHubSafeZone(p.head.x, p.head.z)) {
        rt.campWarm += dt;
        if (rt.campWarm >= CAMPFIRE.warmSec) rt.campBuffUntil = now + CAMPFIRE.buffSec * 1000;
      } else {
        rt.campWarm = 0;
      }
      p.campBuffSecs = Math.min(65535, Math.max(0, Math.ceil((rt.campBuffUntil - now) / 1000)));
      if (rt.token) {
        const rec = store.get(rt.token);
        p.title = rec?.title ?? "";
        // Заслуги до появления титулов — выдаём задним числом.
        if (rec && !rec.titles?.includes("Царь башни") && (rec.bestTowerTimeSec ?? Infinity) <= TITLE_GOALS.towerSec) {
          this.grantTitle(rt.token, "Царь башни");
        }
        p.scrollXpSecs = Math.max(0, Math.ceil(((rec?.scrollXpUntil ?? 0) - now) / 1000));
        p.scrollWindSecs = Math.max(0, Math.ceil(((rec?.scrollWindUntil ?? 0) - now) / 1000));
      }
      // Максимум HP — одна формула для игроков и ботов (уровень и ТЕЛ):
      // сменил оружие/уровень/статы — доводим и текущее HP на прибавку.
      if (p.towerFloor === 0 && !p.dead) {
        const want = maxHpFor(p.level, p);
        if (Math.abs(p.maxHp - want) > 0.5) {
          const gain = Math.max(0, want - p.maxHp);
          p.maxHp = want;
          p.hp = Math.min(want, p.hp + gain);
        }
      }
      const regenDelay = PLAYER_HP.regenDelay;
      const regenRate = PLAYER_HP.regen;
      const inCamp = inHubSafeZone(p.head.x, p.head.z);
      // Регенерация от ТЕЛ и ролла щита — доля макс. HP в секунду, работает и в бою.
      if (p.hp > 0 && p.hp < p.maxHp && p.towerFloor === 0) {
        const frac = hpRegenFrac(p) + shieldRegen(shieldOf(p, rt)?.inst);
        if (frac > 0) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * frac * dt);
      }
      if (p.hp > 0 && p.hp < p.maxHp && (inCamp || rt.sinceHurt > regenDelay)) {
        const rate = inCamp ? Math.max(regenRate * CAMPFIRE.regenMul, p.maxHp * CAMPFIRE.regenFrac) : regenRate;
        p.hp = Math.min(p.maxHp, p.hp + rate * dt);
        // Лагерь лечит — зелёные крестики на герое (раз в ~0.8 с, пока идёт реген).
        if (inCamp && now - rt.campHealFxAt > 800) {
          rt.campHealFxAt = now;
          this.broadcast(MSG.act, { k: "healHit", id, x: p.head.x, y: p.head.y, z: p.head.z } satisfies ActRelay);
        }
      }
    });
  }

  private respawn(id: string, p: PlayerState, rt: Runtime): void {
    // И боты, и живые игроки возрождаются в безопасном лагере (HUB), а не
    // в поле среди мобов — дальше бот сам добежит до места прокачки (дом
    // по уровню, может смениться лагерь — уровень мог вырасти).
    const bot = id.startsWith("bot:") ? this.bots.get(id.slice(4)) : undefined;
    if (bot) {
      const home = botHome(p.level, bot.campPref, bot.campRand);
      bot.homeX = home.x;
      bot.homeZ = home.z;
    }
    // Пати катакомб возрождается у входа в текущий зал.
    const sp = this.cat.respawnPoint(id) ?? hubSpawnPoint();
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
  /** Страницы диктора (voice.html) → таймер рассылки «кому звонить». */
  private readonly casters = new Map<string, { clear(): void }>();
  /** sessionId спектатора со свободной камерой (окно `?freecam=1`), "" — нет. */
  private freeCamOwner = "";
  /** Когда живой игрок зашёл (sessionId → Date.now()) — для приоритета камеры. */
  private readonly joinedAt = new Map<string, number>();
  /** Катакомбы (shared/catacombs.ts): сбор отряда и забег по залам в этом же мире. */
  readonly cat = new CatacombDirector(this.catHost());
  /** Бой с рейд-боссом «Лунный аватар» (server/rooms/raidFight.ts, shared/raid.ts). */
  readonly raid = new RaidFight(this.raidHost());

  /** Самая низкая доля HP рейд-босса с его последнего полного здоровья (правило отмены рейда). */
  private raidBossLow = 1;
  /** !raid копит отряд: norm-ключи записавшихся, пока не выступили. */
  private readonly raidPending = new Set<string>();
  /** ms момента общего выступления (0 — отсчёт не идёт). */
  private raidGoAt = 0;

  // ---- Динамические события (этап 14) ----
  private eventPhase: "idle" | "active" | "cooldown" = "idle";
  /** ms: когда сменить фазу (idle→active, active→cooldown по таймауту, cooldown→idle). */
  private eventPhaseAt = 0;
  private eventX = 0;
  private eventZ = 0;
  /** индекс текущей волны нашествия и ms следующего доспавна. */
  private eventWave = 0;
  private eventWaveAt = 0;
  /** true — событие запущено вручную (пульт/чат): не ждём игроков в мире. */
  private eventForced = false;
  /** Тип идущего события: 1 — нашествие мобов, 2 — охота на элиту, 3 — башня. */
  private activeEventKind: 1 | 2 | 3 = 1;
  /** Охота: id владыки (победа = его смерть), базовый урон спец-атак и таймеры. */
  private huntBossId = "";
  private huntDmgBase = 0;
  private huntAddAt = 0;
  private huntNovaAt = 0;
  private huntNovaFireAt = 0;
  private huntLobAt = 0;
  private huntLobFireAt = 0;
  private huntLobs: { x: number; z: number }[] = [];
  private huntBreathAt = 0;
  private huntBreathFireAt = 0;
  private huntBreathDx = 0;
  private huntBreathDz = 1;
  /** Форс типа из `!goevent <тип>`: 0 — случайно, 1 — нашествие, 2 — охота, 3 — башня. */
  private forcedEventKind: 0 | 1 | 2 | 3 = 0;
  /** Башня: очередь id героев (см. `!event` при activeEventKind===3) и её жизненный цикл. */
  private readonly towerQueue: string[] = [];
  private towerQueueOpenUntil = 0;
  /** Камера летит к башне для очередного героя — следующего из очереди пока не вынимаем. */
  private towerApproaching = false;
  private readonly towerRuns = new TowerRunManager();
  /** id героев, уже отстоявших/прошедших башню в ТЕКУЩЕМ окне — второй раз не пускаем. */
  private readonly towerDone = new Set<string>();
  /** Камера спектатора зафиксирована на этом герое башни ("" — не зафиксирована). */
  private towerCamHeroId = "";
  private towerCamAt = 0;
  private towerCamEye = true;

  override onJoin(client: Client, options?: JoinOpts): void {
    // Диктор (voice.html): без героя, только голос. Сам звонит всем игрокам
    // и спектаторам — список шлём раз в 3 с (новые входят, старые уходят).
    if (options?.caster !== undefined) {
      if (options.caster !== CASTER_KEY) throw new Error("диктор: неверный ключ");
      const push = (): void => {
        const ids = [...this.state.players.keys()].filter((id) => !id.startsWith("bot:"));
        client.send(MSG.casterPeers, [...ids, ...this.spectators]);
      };
      this.clock.setTimeout(push, 400);
      this.casters.set(client.sessionId, this.clock.setInterval(push, 3000));
      console.log(`[zone] + диктор ${client.sessionId}`);
      return;
    }
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
        client.send(MSG.catBoard, this.catLeaderboard(5));
        if (Object.keys(this.overlayCfg).length) {
          client.send(MSG.specCmd, { t: "overlay", patch: this.overlayCfg } satisfies SpecCmd);
        }
        client.send(MSG.specCmd, { t: "specVoice", on: this.state.specVoice } satisfies SpecCmd);
        client.send(MSG.specCmd, { t: "dmgNumbers", on: this.state.dmgNumbers } satisfies SpecCmd);
        client.send(MSG.specCmd, { t: "musicVol", v: this.state.specMusicVol } satisfies SpecCmd);
        client.send(MSG.specCmd, { t: "sfxVol", v: this.state.specSfxVol } satisfies SpecCmd);
        client.send(MSG.specCmd, { t: "eventVol", v: this.state.specEventVol } satisfies SpecCmd);
        client.send(MSG.specCmd, { t: "auto", on: this.pultAuto ? 1 : 0 } satisfies SpecCmd);
        client.send(MSG.specCmd, { t: "bots", on: this.pultBotsOnly ? 1 : 0 } satisfies SpecCmd);
      };
      this.clock.setTimeout(pushInit, 400);
      this.clock.setTimeout(pushInit, 1500);
      return;
    }

    // Ник совпадает с ADMIN_NICKS — без верного пароля в мир не пускаем
    // вообще (не "заходи гостем", а отказ), иначе легко перепутать: игрок
    // думает, что зашёл под своим обычным ником, а по факту не вошёл.
    if (isAdminNick(normNick(options?.nick ?? ""))) {
      if (!ADMIN_PASS || options?.adminPass !== ADMIN_PASS) {
        throw new Error("неверный пароль администратора");
      }
    }

    let token = options?.token?.trim();

    // Катакомбы: этот же герой (бот или другая сессия) в забеге — новое тело займёт его место.
    let catPrev = "";
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
      catPrev = this.heroIdOf(norm);
      this.removeBot(norm); // если был бот — его прогресс уходит в store под этим токеном
    } else {
      // Обычный вход (не по ссылке ?stream=1): ник — и есть личность, без
      // allowedNick(). Занят прямо сейчас (открыта другая вкладка/устройство
      // под этим же ником) — ПЕРЕХВАТЫВАЕМ: старую сессию выгоняем, новая
      // забирает того же персонажа. Раньше в этом случае тихо заводился
      // отдельный несвязанный "гость" под тем же отображаемым ником — по
      // заявке это позволяло плодить сколько угодно "клонов себя".
      const norm = normNick(options?.nick ?? "");
      // "гость" — не ник, а то, что подставляет клиент, когда поле пустое
      // (см. Login.ts). Ловить под этим именем чужой прогресс — не то же
      // самое, что «тот же ник — тот же человек»: тут никакого ника и нет.
      if (norm && norm !== "гость") {
        catPrev = this.heroIdOf(norm);
        if (this.nickIsPlayed(norm)) this.kickNick(norm);
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
      p.con = rec.con ?? 1;
      p.luc = rec.luc ?? 1;
      p.wis = rec.wis ?? 1;
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
    p.maxHp = maxHpFor(p.level, p);
    p.maxMana = maxManaFor(p.level, p);
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

    this.joinedAt.set(client.sessionId, Date.now());
    this.rt.set(client.sessionId, {
      token,
      guard: noGuard(),
      lastHit: {},
      sinceHurt: PLAYER_HP.regenDelay,
      respawnIn: 0,
      invuln: RESPAWN.invuln,
      lastPvpAt: -999,
      lastCast: -999,
      massHealAt: -1,
      lastMassHeal: -999,
      lastSkillAt: -999,
      skillAt: {},
      ultAt: -1e9,
      forceCritUntil: -999,
      cryUntil: -999,
      cryKind: 0,
      whirlUntil: -999,
      plagueUntil: -999,
      abyssUntil: -999,
      abyssStrike: false,
      hasteUntil: -999,
      whirlKind: 0,
      skillCls: "",
      yaw: rec?.yaw ?? 0,
      owned: new Set(Array.isArray(rec?.owned) ? rec.owned : []),
      stowed: sanitizeStowed(rec?.stowed),
      overrides: sanitizeOverrides(rec?.overrides),
      kills: rec?.kills ?? 0,
      leaveBot: rec?.leaveBot === true,
      // Баффы событий и костра — из сейва: переход ПК ↔ бот их не сбрасывает.
      eventBuffUntil: rec?.eventBuffUntil ?? 0,
      campBuffUntil: rec?.campBuffUntil ?? 0,
      campWarm: 0,
      campHealFxAt: 0,
      stunnedUntil: 0,
      slowUntil: 0,
      slowFrac: 0,
      bleedUntil: 0,
      bleedDps: 0,
      bleedBy: "",
      bleedT: 0,
      lastHitMobId: null,
      lastHitMobAt: 0,
      weapons: Array.isArray(rec?.weapons) ? rec.weapons : [],
      equippedWeaponId: sanitizeEquipped(rec?.equippedWeaponId),
      viewToken: typeof rec?.viewToken === "string" ? rec.viewToken : "",
      fishBiteAt: null,
      fishAuto: false,
    });
    this.applyJewels(client.sessionId);
    for (const m of this.chatHistory) client.send(MSG.chatLine, m);
    // Подарки, пришедшие без нас, — всплывашкой при входе (подробно — в инвентаре).
    {
      const notes = (token ? store.get(token)?.giftNotes : undefined) ?? [];
      if (notes.length) {
        const from = [...new Set(notes.map((n) => n.from))].join(", ");
        this.clock.setTimeout(() => client.send(MSG.giftGot, { from, text: notes.length > 1 ? `${notes.length} подарка — смотри инвентарь` : notes[0].text }), 4000);
      }
    }

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
            eventBuffUntil: 0,
          }
        : null,
    );

    if (catPrev) {
      const at = this.cat.rekey(catPrev, client.sessionId);
      if (at) this.catWarp(client.sessionId, at.x, at.z);
    }

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
      ...savePos(num(msg?.x, p.head.x), num(msg?.y, p.head.y), num(msg?.z, p.head.z), edge),
      yaw: num(msg?.yaw, rt.yaw),
      hp: p.hp,
      owned: [...rt.owned],
      stowed: rt.stowed,
      held: { left: heldIn(p, "left"), right: heldIn(p, "right") },
      overrides: rt.overrides,
      ...readProgress(p),
      bag: readBag(p).map((s) => ({ item: s.item, count: s.count })),
      kills: rt.kills,
      weapons: rt.weapons,
      equippedWeaponId: rt.equippedWeaponId,
      viewToken: rt.viewToken,
      eventBuffUntil: rt.eventBuffUntil,
      campBuffUntil: rt.campBuffUntil,
      // Даже если модель не меняли ни разу: случайная, выданная при входе
      // без сейва, должна закрепиться за ником, а не выпадать заново.
      skin: p.skin,
    };
    store.put(rt.token, patch);
  }

  override async onLeave(client: Client, consented?: boolean): Promise<void> {
    const caster = this.casters.get(client.sessionId);
    if (caster) {
      caster.clear();
      this.casters.delete(client.sessionId);
      console.log(`[zone] - диктор ${client.sessionId}`);
      return;
    }
    if (this.spectators.delete(client.sessionId)) {
      console.log(`[zone] - спектатор ${client.sessionId} — эфирных ${this.spectators.size}`);
      if (this.freeCamOwner === client.sessionId) {
        // Окно свободной камеры закрыли — спектаторы возвращаются в свой режим.
        this.freeCamOwner = "";
        this.broadcast(MSG.specCmd, { t: "free", on: 0 } satisfies SpecCmd);
      }
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
    // Исключение — сами выгнали (kickNick, зашли тем же ником в другом
    // месте): реконнект тут НЕ нужен и опасен — старая сессия могла бы
    // отбить место обратно у уже вошедшей новой.
    const wasKicked = this.kickedSessions.delete(client.sessionId);
    this.persist(client); // на случай падения сервера в это окно
    if (!consented && p && !wasKicked) {
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
    this.joinedAt.delete(client.sessionId);
    store.flush();

    // Игрок вышел из игры (ПК/телефон/VR) с отмеченным "оставить бота" —
    // персонаж продолжает жить ботом БЕЗ УСЛОВИЯ про чат (allowedNick тут не
    // нужен — это осознанный выход из самой игры, не вход по ссылке чата).
    // Часы до снятия (BOT.ownerAbsentSec) стартуют сейчас и дальше продлеваются
    // только настоящими сообщениями в чате Twitch (onChat) — заявка: "бот
    // висел N часов, а в чате время добавлялось от последнего сообщения".
    if (streamNorm && p && rt?.leaveBot && this.bots.size < BOT.maxBots && !this.nickIsPlayed(streamNorm)) {
      this.chatSeen.set(streamNorm, Date.now());
      this.spawnBot(p.nick, streamNorm);
      // Был в катакомбах — бот продолжает забег за него (место в отряде, урон, смерти).
      const bot = this.bots.get(streamNorm);
      const at = bot ? this.cat.rekey(client.sessionId, bot.id) : null;
      if (bot && at) this.catWarp(bot.id, at.x, at.z);
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
    invHub.setZone(null);
    if (STAGING) devChat.set(null);
    this.twitch?.stop();
    serverPerf.stop();
    console.log(`[zone] комната ${this.roomId} закрыта`);
  }
}
