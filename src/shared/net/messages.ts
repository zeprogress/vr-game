import type { PlayerMode } from "./schema";

export const MSG = {
  /** клиент -> сервер: транспорт локального игрока (голова + кисти). */
  move: "m",
  /** клиент -> сервер: полное состояние для сохранения (прогресс + позиция). */
  save: "s",
  /** сервер -> клиент: загруженный персонаж по гостевому токену (или null). */
  char: "c",
} as const;

/** 7 чисел: x, y, z, qx, qy, qz, qw. */
export type Xf7 = [number, number, number, number, number, number, number];

export interface MoveMsg {
  mode: PlayerMode;
  head: Xf7;
  /** Кисти шлём только в VR; в плоском режиме — нули (клиент их не рисует). */
  handL: Xf7;
  handR: Xf7;
}

/** Сохраняемое состояние игрока. Прогресс считает клиент, сервер хранит. */
export interface SaveMsg {
  x: number;
  y: number;
  z: number;
  yaw: number;
  level: number;
  xp: number;
  unspent: number;
  str: number;
  agi: number;
  int: number;
  hp: number;
}

/** null — токен новый, сервер ещё не знает этого игрока. */
export type CharMsg = SaveMsg | null;
