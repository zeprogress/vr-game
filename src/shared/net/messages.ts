import type { SkillId } from "../classes2";
import type { GuardState, WeaponKind, BlockedBy } from "../combat";
import type { ItemId, WeaponClass, WeaponTier } from "../items";
import type { StatName } from "../progression";
import type { PlayerMode } from "./schema";
import type { HeroStatRow } from "../heroStats";

/**
 * Код закрытия комнаты, когда сервер намеренно выгоняет клиента (зашли тем
 * же ником в другом месте) — клиент не должен пытаться переподключиться.
 *
 * НАСТОЯЩАЯ НАЙДЕННАЯ ОШИБКА: раньше тут стояло 4000 — тот же код, что
 * Colyseus сам использует как `Protocol.WS_CLOSE_CONSENTED` (обычное
 * закрытие комнаты, например `room.disconnect()` на каждом деплое/рестарте
 * сервера, см. ZoneRoom.onBeforeShutdown). Клиент получал код 4000 при
 * КАЖДОМ рестарте сервера, принимал это за «меня выгнали за тот же ник» и
 * НИКОГДА не пытался переподключиться (флаг closedByUs) — ни игрок, ни
 * спектатор сами не восстанавливались, требовалась ручная перезагрузка
 * страницы. Взят код вне диапазонов, зарезервированных Colyseus
 * (4000/4002/4010/4201/4202/4210-4217, см. @colyseus/core/build/Protocol.js).
 */
export const KICK_SAME_NICK_CODE = 4099;

export const MSG = {
  /** клиент -> сервер: транспорт локального игрока (голова + кисти + защита). */
  move: "m",
  /** клиент -> сервер: позиция для сохранения (прогресс сервер знает сам). */
  save: "s",
  /** сервер -> клиент: где стоял этот токен в прошлый раз (или null). */
  char: "c",
  /** клиент -> сервер: попал по мобу/кукле (урон считает сервер). */
  hitMob: "hm",
  /** клиент -> сервер: каст огненного снаряда посохом (мана/урон/снаряд — сервер). */
  cast: "cst",
  /** клиент -> сервер: активное умение оружия (воин — оглушение, лучник — град стрел). */
  skill: "skl",
  /** клиент -> сервер: выбор двух умений текущего класса («Классы 2.0»). */
  setSkills: "sks",
  /** сервер -> клиент: моб ударил тебя в упор / плевком. */
  mobHit: "mh",
  /** клиент -> сервер: потратить очко характеристики. */
  spend: "sp",
  /** клиент -> сервер: сменить модельку персонажа (панель C, плоский режим). */
  setSkin: "sk",
  /** клиент -> сервер: оставлять ли персонажа ботом после выхода (панель C). */
  setLeaveBot: "lb",
  /** сервер -> клиент: ты возродился, встань сюда. */
  respawn: "rs",
  /** сервер -> клиент: получен уровень (для тоста и звука). */
  levelUp: "lu",
  /** сервер -> все: кто кого убил — для кил-фида спектатора (этап 17 Ф9). */
  killFeed: "kf",
  /** Кто подобрал золотое/уникальное оружие или щит — строка в кил-фиде спектатора. */
  pickupFeed: "pf",
  /** Строка чата Twitch (и ответы бота игры) — в журнал ПК-игрока. */
  chatLine: "cl",
  /** ПК-окно снаряжения: запрос данных / данные / действие / итог действия. */
  pcInvOpen: "pio",
  pcInvData: "pid",
  pcInvAct: "pia",
  pcInvResult: "pir",
  /** Доска заданий: запрос / данные (и обновление прогресса) / действие. */
  questOpen: "qo",
  questData: "qd",
  questAct: "qa",
  /** Лавка трактирщика: запрос / данные / покупка. */
  shopOpen: "so",
  shopData: "sd",
  shopBuy: "sb",
  /** сервер -> рыбаку: время до поклёвки (FishWaitMsg). */
  fishWait: "fw",
  /** сервер -> все: событие босса — появился / повержен (баннер + музыка). */
  bossEvent: "be",
  /** сервер -> все: динамическое событие мира началось/выиграно/утихло (баннер). */
  worldEvent: "we",
  /** сервер -> все: топ-5 героев (ник/уровень/убийства) — для оверлея и !top (Ф10). */
  leaderboard: "top",
  /** сервер -> клиент: склад оружия игрока (все инстансы с роллами) — для инвентаря в игре. */
  weaponsList: "wpn",
  /** клиент -> сервер: хочу слышать озвучку чата Twitch (VR-игрок, настройка в меню). */
  ttsListen: "ttsl",
  /** сервер -> клиент: проиграть озвучку сообщения чата (mp3 по url) и чьё это. */
  ttsPlay: "ttsp",
  /** клиент -> сервер: действие со складом оружия из меню (в руку / скинуть на землю / разобрать). */
  warehouseAct: "wact",
  /** сервер -> все: топ-5 по лучшему этажу Охотничьей башни — для оверлея. */
  towerBoard: "twtop",
  /** сервер -> все: живые позиции мобов текущего забега башни (мировые коорд.), для визуала. */
  towerMobs: "twmobs",
  /** сервер -> все: хозяин бота написал в чат канала — показать над ботом (Ф10). */
  botSay: "bsay",
  /** сервер -> все: бот сыграл эмоцию по команде из чата (Ф10). */
  emote: "em",
  /** клиент -> сервер: использовать предмет из ячейки сумки. */
  useItem: "ui",
  /** клиент -> сервер: рыбалка — заброс/подсечка (сервер решает, поймалось ли). */
  fish: "fsh",
  /** сервер -> клиент: подобран лут (для тоста и звука). */
  picked: "pk",
  /** клиент -> сервер: взять лежащее в мире оружие. */
  takeWeapon: "tw",
  /** клиент -> сервер: что теперь в руках (для расчёта урона). */
  hands: "hd",
  /** голосовой чат: сервер только пересылает пакет нужному игроку. */
  rtc: "rtc",
  /** Серверу → странице диктора: кому звонить (игроки + спектаторы). */
  casterPeers: "cpeers",
  /** админ -> сервер: перевести время суток всему миру. */
  setTime: "st",
  /** админ -> сервер: включить/выключить виньетку движения всем в мире. */
  comfort: "cf2",
  /** админ -> сервер: убрать весь лежащий лут со всего сервера. */
  clearWorld: "cw",
  /** клиент -> сервер: сохранить настройки панели (per-token, применяются только у него). */
  loadout: "ld",
  /** админ -> сервер: сохранить подгонку снаряжения ВСЕМ (общая, переживает перезапуск). */
  setWorldLoadout: "wld",
  /** клиент <-> сервер: включить/выключить свой флаг PvP (этап 10). */
  setPvp: "pvp",
  /** клиент -> сервер: заработанное оружие легло на землю — сделать его общим. */
  dropWeapon: "dw",
  /**
   * Звуковое событие игрока (взмах, шаг, глоток…). Клиент шлёт своё, сервер
   * пересылает остальным — чтобы рядом было слышно, что делает сосед.
   * Урон/блок/глоток сервер рассылает сам (он их считает).
   */
  act: "ac",
  /**
   * Голос через сервер: opus-пакет, когда прямое WebRTC-соединение между
   * игроками не встало. Сервер только пересылает, в содержимое не смотрит.
   */
  voice: "vc",
  /**
   * Команда стрим-дашборда спектатору (этап 17 Ф5). Сервер пересылает её
   * между спектаторскими подключениями (дашборд ⇄ рендерящий спектатор);
   * `time` применяет сам.
   */
  specCmd: "sc",
  /** рендерящий спектатор -> сервер: где сейчас камера стрима (троттлится). */
  specCam: "sp2",
  /** Числа нанесённого урона по мобам за тик — батчем, для спектатора. */
  dmgHits: "dh",
} as const;

/** Вкл/выкл (1/0) и текст отдельных элементов оверлея (этап 17 Ф6). */
export interface OverlayPatch {
  watermark?: string;
  wm?: number;
  clock?: number;
  online?: number;
  watching?: number;
  hp?: number;
  feed?: number;
  top?: number;
  /** Строка событий/обновлений сверху по центру (синие буквы). */
  ticker?: number;
}

/** Позиция и цель взгляда камеры стрима — шлёт рендерящий спектатор, троттлится. */
export interface SpecCamMsg {
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
}

/** Числа урона по мобам за тик — батчем (см. MSG.dmgHits), только для спектатора. */
export interface DmgHitsMsg {
  /** by — кто ударил (sessionId), mob — по кому: для журнала урона у ПК-игрока. */
  hits: { x: number; y: number; z: number; dmg: number; by?: string; mob?: string; c?: DmgHitColor }[];
}

/** Цвет числа урона: яд — зелёный, лечение — светло-зелёный (без поля — обычный белый). */
export type DmgHitColor = "poison" | "heal" | "bleed";
/** Кто кого убил (этап 17 Ф9). `by` пуст — убил моб/среда. Строки уже готовы к показу. */
export interface KillFeedMsg {
  by: string;
  victim: string;
}

/** Оружие на складе для ПК-окна снаряжения (с ценами заточки и лома). */
export interface PcInvWeapon {
  id: string;
  cls: WeaponClass;
  tier: WeaponTier;
  name: string;
  affixes: string[];
  /** Свойства помимо роллов (щит: блок, отражение, «Оплот»). */
  effects?: string[];
  /** Сумма очков роллов (1..33 за каждый). */
  quality: number;
  /** Сколько лома даст разборка. */
  scrap: number;
  /** По каждому аффиксу: очки, максимум ли, шанс и цена заточки. */
  ench: { label: string; points: number; max: boolean; chance: number; cost: number }[];
  /** ★ Избранное — не разбирается. */
  fav?: boolean;
}

/** Одно задание в окне/трекере. */
export interface QuestSlotView {
  kind: "hunt" | "champ" | "fish" | "boss";
  hard: boolean;
  /** Ключ ELITE_MOBS цели ("" — рыбалка) — для компаса. */
  target: string;
  title: string;
  got: number;
  need: number;
  done: boolean;
  claimed: boolean;
  /** xpPct — % уровня (0 на макс. уровне). */
  reward: { xpPct: number; tokens: number; scrap: number };
}

export interface QuestData {
  /** Активные: 3 автоматических + взятые с доски. */
  slots: QuestSlotView[];
  /** Предложения доски. */
  offers: QuestSlotView[];
  picksLeft: number;
  tokens: number;
  nextSecs: number;
  /** Герой стоит у доски (сдавать/брать можно только там). */
  near: boolean;
  /** Три задания дня взяты у доски. */
  dailyTaken: boolean;
  /** Сюжет Охотника: текущая глава (null — цепочка пройдена). */
  story: {
    chapter: number;
    total: number;
    title: string;
    text: string;
    kind: "hunt" | "champ" | "fish" | "boss";
    target: string;
    got: number;
    need: number;
    done: boolean;
    /** Глава взята у Охотника. */
    taken: boolean;
    reward: { xpPct: number; tokens: number; potions: number; final: boolean };
  } | null;
  /** Недельный контракт Охотника. */
  weekly: {
    parts: { label: string; got: number; need: number }[];
    done: boolean;
    claimed: boolean;
    taken: boolean;
    secsLeft: number;
    reward: { xpPct: number; tokens: number };
  };
  /** Герой у Охотника. */
  nearHunter: boolean;
  /** Полученные титулы и надетый (VR выбирает титул во вкладке «Задания»). */
  titles: string[];
  title: string;
  msg?: string;
}

export interface ShopData {
  items: { id: string; name: string; desc: string; price: number; fishCost?: number }[];
  tokens: number;
  /** Рыба в сумке — для обмена на жетоны. */
  fish: number;
  near: boolean;
  msg?: string;
}

export interface ShopBuyMsg {
  id: string;
}

export interface QuestActMsg {
  /** claim — сдать slots[idx]; take — взять offers[idx]; storyClaim / weeklyClaim — у Охотника. */
  act: "claim" | "take" | "takeDaily" | "storyTake" | "storyClaim" | "weeklyTake" | "weeklyClaim";
  idx: number;
}

export interface PcInvData {
  weapons: PcInvWeapon[];
  equipped: { left: string | null; right: string | null };
  potions: number;
  scrap: number;
  fish: number;
  /** Свитки из лавки трактирщика. */
  scrollXp?: number;
  /** Жетоны заданий ◈. */
  tokens?: number;
  /** Полученные титулы и надетый. */
  titles?: string[];
  title?: string;
  scrollWind?: number;
  attrs: { unspent: number; str: number; agi: number; int: number; con: number; luc: number; wis: number };
  respecCost: number;
  stats: { label: string; value: string }[];
  /** Умения: класс по оружию в руках ("" — без оружия) и выбранные два. */
  skills?: { cls: string; chosen: string[] };
}

export interface PcInvActMsg {
  /** title — надеть титул (id = название, "" — снять); fav — звёздочка «избранное» у оружия id; scrapAll — разобрать всё, кроме избранного и надетого. */
  act: "enchant" | "stat" | "respec" | "title" | "skills" | "fav" | "scrapAll";
  id: string;
  idx: number;
}

export interface PcInvResult {
  ok: boolean;
  text: string;
  enchant?: { id: string; idx: number; up: boolean; gain: number; cost: number; label: string };
}

export interface ChatLineMsg {
  nick: string;
  text: string;
  /** 1 — ответ самой игры (бот-аккаунт), а не зритель. */
  bot?: 1;
}

export interface PickupFeedMsg {
  nick: string;
  /** Название предмета. */
  item: string;
  tier: "gold" | "legendary";
  /** Роллы коротко («+12% урона, …»), может быть пусто. */
  aff: string;
}

/** Один вид добычи в баннере окончания ивента/босса — для отрисовки иконкой. */
export interface LootItem {
  id: ItemId;
  count: number;
  /** Уникальный щит — это Эгида (свой значок). */
  aegis?: boolean;
}

/** Динамическое событие мира — для баннера. */
export interface WorldEventMsg {
  phase: "start" | "win" | "end";
  /** Человекочитаемое имя события («Нашествие»). */
  name: string;
  /** Эпицентр (для стрелки/камеры). */
  x: number;
  z: number;
  /** Только для "win": что выпало (оружие/зелья) — баннер рисует иконками. */
  loot?: LootItem[];
}

/** Событие босса для баннера во весь экран. `by` — ник добившего (для "повержен"). */
export interface BossEventMsg {
  kind: "spawn" | "down";
  by?: string;
  /** Только для "down": что выпало с босса, готовой строкой («Золотой меч · 3× Зелье»). */
  loot?: string;
  /** То же самое, но структурой id+count — баннер рисует иконками. */
  lootItems?: LootItem[];
}

/** Реплика хозяина бота из чата канала — облачко над ботом (Ф10). */
export interface BotSayMsg {
  /** id в state.players, вида `bot:<ник>`. */
  id: string;
  text: string;
}

/**
 * Эмоции бота по команде из чата (Ф10). Только клипы, которые реально есть
 * в паке у всех 8 моделей: Victory/Roll/Jump/Defeat — под них подобрали
 * команды, а не наоборот (никакого "!wave" — жеста взмаха в паке нет).
 */
export type BotEmote = "cheer" | "roll" | "jump" | "defeat";

export interface EmoteMsg {
  /** id в state.players, вида `bot:<ник>`. */
  id: string;
  emote: BotEmote;
}

/** Строка таблицы лидеров (Ф10): и живые герои, и офлайн из сейва. */
export interface LeaderboardRow {
  nick: string;
  level: number;
  xp: number;
  kills: number;
}

/** Строка таблицы «Охотничья башня»: лучший этаж, до которого дошёл герой. */
export interface TowerBoardRow {
  nick: string;
  floor: number;
  shards: number;
  /** Прошёл башню целиком («покорил»). Такие идут первыми — по времени прохождения. */
  cleared?: boolean;
  /** Лучшее время полного прохождения, с (нет — покорил до появления таймера). */
  time?: number;
}

/** Живые позиции мобов текущего забега башни — мировые координаты. */
export interface TowerMobsMsg {
  heroId: string;
  mobs: {
    x: number;
    z: number;
    yaw: number;
    hpFrac: number;
    boss: boolean;
    atkPulse: boolean;
    ranged: boolean;
    burning: boolean;
  }[];
  /** true ровно на тот тик, когда дальний герой (лук/посох) выстрелил. */
  heroRangedPulse: boolean;
  heroWeaponKind: "sword" | "fist" | "bow" | "staff";
  /** Куда именно летел выстрел — мировые координаты цели в момент выстрела. */
  heroTargetX: number;
  heroTargetZ: number;
}

/** Данные о кадре камеры для вынесенного оверлея (SpecCmd "ovl"). */
export interface OvlCam {
  /** Кого смотрим: ник/имя моба или null. */
  w: string | null;
  /** Характеристики героя (таблица label/value) / инвентарь (строка) под ником. */
  ws: HeroStatRow[] | null;
  wi: string | null;
  /** Баффы героя в «смотрим» (см. OverlayCtx.watchBuffs). */
  /** Уровень и атрибуты [сил, лов, инт] героя в «смотрим». */
  wl?: number | null;
  /** Титул героя в «смотрим». */
  wt?: string | null;
  wa?: number[] | null;
  wb?: { icon: string; name: string; desc: string; secs: number; color: string }[] | null;
  /** Подпись кадра без цели. */
  sl: string;
  /** HP цели: доля, текущее, максимум, имя, босс ли — или null. */
  hp: { f: number; c: number; m: number; n: string; b: boolean } | null;
  /** id игроков, которые сейчас говорят по голосовой связи. */
  sp: string[];
}

/** Команды дашборда стрима (этап 17 Ф5). */
export type SpecCmd =
  /** Принудительно поставить кадр. `shot` — токен: overview / orbitBoss /
   *  eyeMob:<id> / orbitPlayer:<id> / eyePlayer:<id> / frontPlayer:<id> /
   *  path:<n> / auto. */
  | { t: "cam"; shot: string }
  /** Вкл/выкл авто-ротацию режиссёра. */
  | { t: "auto"; on: number }
  /** Режим «только боты»: авто-ротация ходит лишь по ботам зрителей,
   *  чередуя из глаз / орбиту / вид напротив (Ф10). */
  | { t: "bots"; on: number }
  /** Перевести часы мира (0..24). Применяет сервер. */
  | { t: "time"; hour: number }
  /** Вкл/выкл авто-ход суток. Применяет сервер. */
  | { t: "dayAuto"; on: number }
  /** Админ-панель пульта: убрать весь лежащий лут. Применяет сервер. */
  | { t: "clearLoot" }
  /** Пульт: форсировать динамическое событие сейчас. */
  | { t: "forceEvent" }
  /** Админ-панель пульта: вкл/выкл мобов (замерли на месте / снова бьются). */
  | { t: "mobsOn"; on: number }
  /** Видна ли игрокам метка камеры зрителя в мире. Применяет сервер. */
  | { t: "specVisible"; on: number }
  /** Видны ли игрокам лучи направления взгляда камеры зрителя. Применяет сервер. */
  | { t: "specRaysVisible"; on: number }
  /** Слышит ли рендерящий спектатор голосовую связь игроков (для стрима). */
  | { t: "specVoice"; on: number }
  /** Показывать ли у спектатора всплывающие числа урона по мобам. */
  | { t: "dmgNumbers"; on: number }
  /** Громкость музыки/эффектов на рендерящем спектаторе (для стрима), 0..100. Применяет сервер. */
  | { t: "musicVol"; v: number }
  | { t: "sfxVol"; v: number }
  | { t: "eventVol"; v: number }
  /** Озвучка сообщений чата на стриме: вкл/выкл (пульт). Применяет сервер. */
  | { t: "tts"; on: number }
  /** Голос озвучки чата (Fish Audio reference_id). Применяет сервер. */
  | { t: "ttsVoice"; ref: string }
  /** Сервер -> спектатор: проиграть готовый mp3 озвучки чата (url в /tts/…). */
  | { t: "ttsPlay"; url: string; nick?: string }
  /** Дашборд -> спектатор: нижняя плашка/заставка. `secs<=0`/нет — держать
   *  бесконечно, пока не скроют; пустой `title` — скрыть. */
  | { t: "card"; title: string; sub?: string; secs?: number }
  /** Дашборд -> спектатор: патч конфигурации оверлея (вкл/выкл, текст). */
  | { t: "overlay"; patch: OverlayPatch }
  /** Рендерящий спектатор -> дашбордам: какой кадр сейчас в эфире. */
  | { t: "nowShot"; shot: string }
  /** Рендерящий спектатор -> страница оверлея (overlay.html): что сейчас в кадре.
   *  Оверлей вынесен в отдельный Browser Source и сам камеры не знает. */
  | { t: "ovl"; d: OvlCam }
  /** Свободная камера (отдельное окно `?freecam=1`) -> все спектаторы: положение
   *  и угол обзора. `on: 0` — камера закрыта, спектаторы возвращаются в свой режим. */
  | { t: "free"; on: number; x?: number; y?: number; z?: number; tx?: number; ty?: number; tz?: number; fov?: number; sm?: number }
  /** Спектатор -> сервер: отчёт сторожа о зависании картинки (в журнал).
   *  Дашбордам не рассылается: это диагностика, а не команда. */
  | { t: "diag"; text: string };

/** Один opus-пакет голоса (клиент -> сервер). */
export interface VoiceMsg {
  /** Метка времени пакета (микросекунды от AudioEncoder). */
  t: number;
  /** Сжатые opus-байты (как обычный массив — так надёжно проходит через Colyseus). */
  d: number[];
}

/** То же с id говорящего (сервер -> остальным). */
export interface VoiceRelay extends VoiceMsg {
  id: string;
}

/** Что за звук произошёл у игрока. */
export type ActKind =
  | "magicHit" // магический удар моба по герою (фиолетовая вспышка)
  | "swing" // взмах мечом
  | "step" // шаг
  | "drink" // глоток зелья
  | "bow" // выстрел из лука
  | "arrowHit" // стрела во что-то воткнулась
  | "crit" // критический выстрел из лука (оранжевая вспышка + звонкий звук)
  | "hurt" // получил урон
  | "blockShield" // блок щитом
  | "blockSword" // блок мечом
  | "dodge" // увернулся от атаки (ловкость) — "MISS" над источником удара
  | "levelUp" // получен новый уровень (крестики и звук над телом)
  | "healAura" // бот-лекарь начал каст массового лечения (аура на земле)
  | "arrowRain" // бот с луком наметил град стрел (круг на земле + падающие стрелы)
  | "stunBash" // бот с мечом бьёт землю — волна оглушения по площади (телеграф)
  | "stunHit" // оглушающий удар воина ДОШЁЛ — звук в момент удара
  | "swordHit" // меч попал по цели — звук удара (сэмпл sword-hit)
  | "vampHit" // ролл Вампиризм — этот удар подпитал героя ХП, ДОПОЛНИТЕЛЬНО к swordHit, не вместо
  | "healHit" // массовое лечение (бот или игрок) дошло до этого героя — зелёные крестики на нём
  | "rainTick" // очередной залп града стрел по области (звук)
  | "pickup" // поднял оружие или предмет с земли — анимация подбора
  | "jump" // прыгнул (ПК) — клип прыжка у модели
  | "sporeMark" // Грибной колосс пометил землю — через d с там встанет ядовитое облако
  | "blinkOut" // Костяной призрак растворяется (через d с — рывок)
  | "blinkIn" // Костяной призрак возник за спиной у цели
  | "pullMark" // Небесный спрут тянет щупальце к герою (телеграф d с)
  | "pullHit" // Небесный спрут схватил и подтянул героя
  | "breathMark" // дракон: конус дыхания на земле (телеграф d с), x2/z2 — конец конуса
  | "breathHit" // дракон: огонь по конусу
  | "chargeMark" // Адский демон: полоса тарана (x→x2, телеграф d с)
  | "chargeHit" // Адский демон: таран прошёл по полосе
  | "reflectOn" // Ледяной демон: щит отражения на d с
  | "spikeMark" // Костяной вождь: круг под героем (телеграф d с)
  | "spikeHit" // Костяной вождь: шипы вырвались из земли
  | "chiefHeal" // Костяной вождь: лечит себя и соседей
  | "freezeMark" // Ледяной демон: круг под героем (телеграф d с)
  | "leapMark" // Скалолом: круг под героем, через d с прыжок (r — радиус)
  | "leapHit" // Скалолом приземлился: удар по площади (r — радиус)
  | "caltrops" // колючки Шипохвоста на земле на d с (r — радиус)
  | "freezeHit" // Ледяной демон: заморозка по области
  | "hammerWave" // молот боевого мага: магическая волна вокруг цели (d — радиус)
  | "spearPierce" // копьё прошило линию: от (x,z) до (x2,z2)
  | "leap" // «Смертельный прыжок» ассасина: из (x,z) в (x2,z2) за d с
  | "shadowStep" // «Теневой рывок»: из (x,z) в (x2,z2); v — класс (вариант эффекта)
  | "crushMark" // «Сокрушение»: прыжок в точку (x,z), удар через d с; r — радиус
  | "crushHit" // «Сокрушение» ударило о землю в (x,z)
  | "seal" // «Печать» в (x,z) на d с, радиус r; v — класс (поддержка/боевой маг)
  | "fanKnives" // «Веер кинжалов»: из (x,z) конусом к (x2,z2), d — сколько вееров
  | "spearFlurry" // «Град выпадов» копейщика: серия колющих ударов вперёд (d — длительность, r — дальность)
  | "whirl" // «Вихрь» вокруг героя id на d с, радиус r; v — класс
  | "warcry" // «Боевой клич»/«Благословение» в (x,z), радиус r; v — класс
  | "markOn" // «Метка» на мобе mobId на d с
  | "markReset" // цель умерла под меткой — откат «Метки» сброшен (только хозяину)
  | "plagueBurst" // 🧪 «Чумной клинок»: взрыв яда в (x,z), радиус r
  | "bleedTick" // кровотечение на мобе mobId: капли крови (раз в секунду)
  | "poisonStack" // 🧪 яд на мобе mobId: r — стаков (1..5), d — сколько тикает
  | "plagueOn" // 🧪 «Чумной клинок»: клинки героя id отравлены на d с
  | "smoke" // 🧪 «Пелена смерти»: дым в (x,z) на d с, радиус r
  | "soulSteal" // 🧪 «Кража душ»: из (x,y,z) моба к союзнику (x2,z2) на высоте d
  | "abyss" // 🧪 «Призрак бездны»: герой id в тени d с
  | "chainHit"; // скачок «Цепной молнии»: из (x,y,z) в (x2,z2) на высоте d; r — номер скачка

const ACT_KINDS: readonly ActKind[] = [
  "swing",
  "step",
  "drink",
  "bow",
  "arrowHit",
  "hurt",
  "blockShield",
  "blockSword",
  "jump",
  "pickup",
];

export function isActKind(v: unknown): v is ActKind {
  return typeof v === "string" && (ACT_KINDS as readonly string[]).includes(v);
}

/** Клиент -> сервер: у меня произошло звуковое событие в этой точке мира. */
export interface ActMsg {
  k: ActKind;
  x: number;
  y: number;
  z: number;
}

/** Сервер -> остальным: у игрока `id` произошло событие. */
export interface ActRelay extends ActMsg {
  id: string;
  /** Длительность, с (напр. замах stunBash) — если событие её несёт. */
  d?: number;
  /** id моба-источника (kind "dodge" — «MISS» следом за движущейся целью). */
  mobId?: string;
  /** Второй конец линии (хват щупальцами спрута: от x2/z2 к x/z). */
  x2?: number;
  z2?: number;
  /** Вариант эффекта (индекс класса в CLASS_IDS) — умение у разных классов выглядит по-своему. */
  v?: number;
  /** Радиус области, м. */
  r?: number;
}

/**
 * Заработанное оружие упало на землю. Дальше оно живёт в мире на сервере:
 * его видят все и оно переживает перезапуск.
 */
export interface DropWeaponMsg {
  cls: WeaponClass;
  tier: WeaponTier;
  x: number;
  z: number;
  /** Какая рука держала оружие — чтобы сервер снял именно этот экипированный
   * инстанс со склада (иначе бросок создавал НОВЫЙ случайный лут, а старый
   * инстанс так и оставался в инвентаре — дублирование). */
  hand?: "left" | "right";
}

/** Панельные переопределения настроек — сервер хранит их по токену игрока. */
export type OverridesMsg = Record<string, unknown>;
/** Частичный Loadout (hands/items/belt/hud/light) — общая подгонка от админа. */
export type WorldLoadoutMsg = Record<string, unknown>;

/** Перевод мировых часов. Сервер слушает только игрока с ником ADMIN_NICK. */
export interface SetTimeMsg {
  /** Новый час (0..24). Пропущен — не трогаем. */
  hour?: number;
  /** 1 — время идёт само, 0 — стоит. Пропущен — не трогаем. */
  auto?: number;
}

/**
 * Админ меняет общие настройки комфорта VR для всего мира. Присутствующие
 * поля применяются, отсутствующие — не трогаются.
 */
export interface ComfortMsg {
  /** 1 — виньетка движения разрешена, 0 — выключена всем. */
  vignette?: number;
  /** 1 — левый стик телепортирует, 0 — плавное скольжение. */
  teleport?: number;
}

/**
 * PvP-флаг. Клиент шлёт `{ on }`. Сервер отвечает `{ on }` — фактическим
 * значением после проверки; если снять флаг нельзя (недавно был бой),
 * добавляет `wait` — сколько секунд ещё ждать.
 */
export interface SetPvpMsg {
  on: number;
  wait?: number;
}

/** 7 чисел: x, y, z, qx, qy, qz, qw. */
export type Xf7 = [number, number, number, number, number, number, number];

export interface MoveMsg {
  mode: PlayerMode;
  /** Платформа: 1 — ПК, 2 — смартфон, 3 — VR (значок у ника). */
  plat?: number;
  head: Xf7;
  /** Кисти шлём только в VR; в плоском режиме — нули (клиент их не рисует). */
  handL: Xf7;
  handR: Xf7;
  /** Щит и меч в руках — сервер сам решает, блокирован ли удар. */
  guard: GuardState;
}

/** Клиент сохраняет только позицию: прогресс и HP сервер знает сам. */
export interface SaveMsg {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** Одно оружие на складе игрока: инстанс с роллами (для списка в инвентаре). */
export interface WarehouseWeapon {
  id: string;
  cls: WeaponClass;
  tier: WeaponTier;
  /** Имя экземпляра (у старых уникальных — историческое: «Меч вампира»). */
  name?: string;
  /** Свойства помимо роллов (щит: блок, отражение, «Оплот»). */
  effects?: string[];
  /** Тексты роллов («+12% урона»), первым — врождённый эффект старого уникального. */
  affixes: string[];
  /** Сумма очков роллов (1..33 за каждый) — число в скобках у названия. */
  quality: number;
  /** Ролл «скорость атаки» (доля, 0.14 = +14%) — клиент ускоряет им свой темп. */
  atkSpd?: number;
  /** ★ Избранное — не разбирается. */
  fav?: boolean;
  /** Сколько лома даст разборка (scrapValue). */
  scrap?: number;
}

/** Озвучка сообщения чата для игрока (VR). */
export interface TtsPlayMsg {
  url: string;
  nick: string;
}

/** Действие с одним оружием на складе. */
export interface WarehouseActMsg {
  id: string;
  /** hand — закрепить этот инстанс за рукой (физически берёт в руку клиент); drop — на землю; scrap — на лом. */
  act: "hand" | "drop" | "scrap";
  hand?: "left" | "right";
}

/** Склад оружия целиком + что сейчас закреплено в руках (id инстансов). */
export interface WeaponsListMsg {
  list: WarehouseWeapon[];
  equipped: { left: string | null; right: string | null };
}

/** Оружие «с собой»: класс и уровень. */
export interface CarriedWeapon {
  cls: WeaponClass;
  tier: WeaponTier;
}

/** Оружие, убранное за спину: плюс за какое плечо. */
export interface StowedWeapon extends CarriedWeapon {
  side: "left" | "right";
}

/** Что в руках. Сохраняется вместе с убранным за спину. */
export interface HeldWeapons {
  left: CarriedWeapon | null;
  right: CarriedWeapon | null;
}

/**
 * Что сервер знает про этот токен при входе: где стоял, что было в руках и
 * за спиной в прошлый раз. null — токен новый.
 */
export type CharMsg =
  | (SaveMsg & {
      stowed?: StowedWeapon[];
      held?: HeldWeapons;
      overrides?: OverridesMsg;
      leaveBot?: boolean;
    })
  | null;

export interface HitMobMsg {
  id: string;
  target: "mob" | "dummy" | "player";
  /** Чем ударил — урон и досягаемость сервер берёт из shared/combat. */
  weapon: WeaponKind;
  /** Какой рукой — по ней сервер берёт уровень оружия. */
  hand: "left" | "right";
  /** Горизонтальное направление удара (для отскока и раны). */
  dx: number;
  dz: number;
}

export interface CastMsg {
  /** Заклинание. По умолчанию — огнешар. */
  spell?: "bolt" | "heal" | "massHealStart" | "massHeal" | "massHealCancel";
  /** Лечение: sessionId союзника-цели. Пусто/свой id — лечим себя. */
  targetId?: string;
  /** Заряд 0..1 (дольше держал — больше). */
  charge: number;
  /** «Натяг» второй руки 0..1 (дальше от кристалла — быстрее снаряд). */
  pull: number;
  /** Мировая точка вылета (кристалл посоха). */
  ox: number;
  oy: number;
  oz: number;
  /** Единичное направление полёта (ось посоха). */
  dx: number;
  dy: number;
  dz: number;
  /** Какой рукой держат посох — по ней идёт опыт за убийство. */
  hand: "left" | "right";
}

export interface SkillMsg {
  /** Умение из пула «Классов 2.0» (classes2 SKILLS2): должно быть выбрано у героя (skill1/skill2). */
  kind: SkillId;
  /**
   * Точка умения: град — центр круга, сокрушение — куда прыгнуть, рывок —
   * куда приземлился (клиент двигает себя сам). Сервер ограничивает дальностью.
   */
  x?: number;
  z?: number;
}

/** Выбор двух умений текущего класса. */
export interface SetSkillsMsg {
  skills: string[];
}

export interface MobHitMsg {
  /** Урон, который реально прошёл (после щита/меча). */
  dmg: number;
  /** Откуда прилетело — для виньетки и отталкивания. */
  fromX: number;
  fromZ: number;
  /** Чем заблокировано: 0 — ничем, 1 — щитом, 2 — мечом, 3 — уворот. */
  by: BlockedBy;
  /** Оглушение (спец-атака моба), с. Нет — не оглушает. */
  stunSec?: number;
  /** «Обморожение» (Ледяной демон): замедление бега на slowSec с, доля slowFrac. */
  slowSec?: number;
  slowFrac?: number;
  /** Сила отбрасывания ОТ источника удара, м/с. Нет — не толкает. */
  knockback?: number;
  /** id моба-источника (для «MISS» уворота — следом за движущейся целью). */
  byMob?: string;
}

export interface SpendMsg {
  stat: StatName;
}

/** Смена модельки персонажа (1..BOT.skins) из панели C. Только плоский режим. */
export interface SetSkinMsg {
  skin: number;
}

/** Оставлять ли персонажа ботом после выхода (панель C). По умолчанию — нет. */
export interface SetLeaveBotMsg {
  on: number;
}

/** Куда встать после возрождения. */
export interface RespawnMsg {
  x: number;
  y: number;
  z: number;
}

export interface LevelUpMsg {
  level: number;
}

export interface UseItemMsg {
  /** Индекс ячейки сумки. */
  slot: number;
}

export interface FishMsg {
  /** cast — заброс, reel — подсечка (ручной режим), stop — смотать удочку. */
  act: "cast" | "reel" | "stop";
  /** auto — рыбачит сам (медленнее), manual — мини-игра (быстрее). */
  mode?: "auto" | "manual";
}

/** сервер -> рыбаку: через сколько секунд клюнет (по серверному таймеру); stop — рыбалка прервана. */
export interface FishWaitMsg {
  wait: number;
  auto?: boolean;
  stop?: boolean;
}

export interface PickedMsg {
  item: ItemId;
  count: number;
}

/**
 * Служебный пакет голосового чата.
 *
 * Сервер в содержимое не смотрит: его дело — доставить пакет адресату и
 * подписать, от кого он. Сам разговор идёт напрямую между игроками.
 */
export interface RtcMsg {
  /** Кому (у отправителя) / от кого (у получателя). */
  peer: string;
  kind: "offer" | "answer" | "ice";
  /** Сериализованное описание или кандидат. */
  data: string;
  /** 1 — пакет от диктора (страница voice.html): голос ровно, `?nocaster=1` глушит. */
  c?: 1;
}

export interface TakeWeaponMsg {
  /** id лежащего в мире оружия. */
  id: string;
  /** Какая рука взяла (в руку) — null/undefined, если ушло сразу на склад
   * (руки заняты). Нужно, чтобы сервер знал, какой инстанс сейчас "в руке"
   * (rt.equippedWeaponId) — иначе последующий бросок этого оружия не находит
   * его и создаёт дубликат (см. MSG.dropWeapon). */
  hand?: "left" | "right";
}

/** Что игрок держит. Сервер сверяет с тем, что тот честно поднял. */
export interface HandsMsg {
  left: { cls: WeaponClass; tier: WeaponTier } | null;
  right: { cls: WeaponClass; tier: WeaponTier } | null;
  /** Убранное за спину — сохраняется до следующего входа. Пропущено — пусто. */
  stowed?: StowedWeapon[];
}
