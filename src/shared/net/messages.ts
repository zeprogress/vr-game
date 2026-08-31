import type { GuardState, WeaponKind, BlockedBy } from "../combat";
import type { ItemId, WeaponClass, WeaponTier } from "../items";
import type { StatName } from "../progression";
import type { PlayerMode } from "./schema";

export const MSG = {
  /** клиент -> сервер: транспорт локального игрока (голова + кисти + защита). */
  move: "m",
  /** клиент -> сервер: позиция для сохранения (прогресс сервер знает сам). */
  save: "s",
  /** сервер -> клиент: где стоял этот токен в прошлый раз (или null). */
  char: "c",
  /** клиент -> сервер: попал по мобу/кукле (урон считает сервер). */
  hitMob: "hm",
  /** сервер -> клиент: моб ударил тебя в упор / плевком. */
  mobHit: "mh",
  /** клиент -> сервер: потратить очко характеристики. */
  spend: "sp",
  /** сервер -> клиент: ты возродился, встань сюда. */
  respawn: "rs",
  /** сервер -> клиент: получен уровень (для тоста и звука). */
  levelUp: "lu",
  /** клиент -> сервер: использовать предмет из ячейки сумки. */
  useItem: "ui",
  /** сервер -> клиент: подобран лут (для тоста и звука). */
  picked: "pk",
  /** клиент -> сервер: взять лежащее в мире оружие. */
  takeWeapon: "tw",
  /** клиент -> сервер: что теперь в руках (для расчёта урона). */
  hands: "hd",
  /** голосовой чат: сервер только пересылает пакет нужному игроку. */
  rtc: "rtc",
  /** админ -> сервер: перевести время суток всему миру. */
  setTime: "st",
  /** клиент -> сервер: сохранить настройки панели (per-token, применяются только у него). */
  loadout: "ld",
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
} as const;

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
  | "swing" // взмах мечом
  | "step" // шаг
  | "drink" // глоток зелья
  | "bow" // выстрел из лука
  | "arrowHit" // стрела во что-то воткнулась
  | "hurt" // получил урон
  | "blockShield" // блок щитом
  | "blockSword"; // блок мечом

const ACT_KINDS: readonly ActKind[] = [
  "swing",
  "step",
  "drink",
  "bow",
  "arrowHit",
  "hurt",
  "blockShield",
  "blockSword",
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
}

/** Панельные переопределения настроек — сервер хранит их по токену игрока. */
export type OverridesMsg = Record<string, unknown>;

/** Перевод мировых часов. Сервер слушает только игрока с ником ADMIN_NICK. */
export interface SetTimeMsg {
  /** Новый час (0..24). Пропущен — не трогаем. */
  hour?: number;
  /** 1 — время идёт само, 0 — стоит. Пропущен — не трогаем. */
  auto?: number;
}

/** 7 чисел: x, y, z, qx, qy, qz, qw. */
export type Xf7 = [number, number, number, number, number, number, number];

export interface MoveMsg {
  mode: PlayerMode;
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
  | (SaveMsg & { stowed?: StowedWeapon[]; held?: HeldWeapons; overrides?: OverridesMsg })
  | null;

export interface HitMobMsg {
  id: string;
  target: "mob" | "dummy";
  /** Чем ударил — урон и досягаемость сервер берёт из shared/combat. */
  weapon: WeaponKind;
  /** Какой рукой — по ней сервер берёт уровень оружия. */
  hand: "left" | "right";
  /** Горизонтальное направление удара (для отскока и раны). */
  dx: number;
  dz: number;
}

export interface MobHitMsg {
  /** Урон, который реально прошёл (после щита/меча). */
  dmg: number;
  /** Откуда прилетело — для виньетки и отталкивания. */
  fromX: number;
  fromZ: number;
  /** Чем заблокировано: 0 — ничем, 1 — щитом, 2 — мечом. */
  by: BlockedBy;
}

export interface SpendMsg {
  stat: StatName;
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
}

export interface TakeWeaponMsg {
  /** id лежащего в мире оружия. */
  id: string;
}

/** Что игрок держит. Сервер сверяет с тем, что тот честно поднял. */
export interface HandsMsg {
  left: { cls: WeaponClass; tier: WeaponTier } | null;
  right: { cls: WeaponClass; tier: WeaponTier } | null;
  /** Убранное за спину — сохраняется до следующего входа. Пропущено — пусто. */
  stowed?: StowedWeapon[];
}
