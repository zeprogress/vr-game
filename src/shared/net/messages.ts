import type { PlayerMode } from "./schema";

/** Сообщения клиент -> сервер. */
export const MSG = {
  /** Транспорт локального игрока (позиции головы и кистей). */
  move: "m",
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
