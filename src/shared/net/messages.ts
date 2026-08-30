import type { GuardState, WeaponKind, BlockedBy } from "../combat";
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
} as const;

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

/** null — токен новый, сервер ещё не знает этого игрока. */
export type CharMsg = SaveMsg | null;

export interface HitMobMsg {
  id: string;
  target: "mob" | "dummy";
  /** Чем ударил — урон и досягаемость сервер берёт из shared/combat. */
  weapon: WeaponKind;
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
