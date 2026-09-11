import colyseus from "colyseus";

import type { TowerRunResult } from "./TowerRoom";

const { matchMaker } = colyseus;

/**
 * Владеет ЖИЗНЕННЫМ ЦИКЛОМ одной попытки «Охотничьей башни» — не очередью
 * (та живёт в ZoneRoom, это просто массив id героев). Один экземпляр на
 * ZoneRoom; одновременно активна только одна попытка (сама очередь это и
 * гарантирует — следующего зовём только после результата предыдущего).
 */
export class TowerRunManager {
  private activeRoomId: string | null = null;

  get running(): boolean {
    return this.activeRoomId !== null;
  }

  /** Поднять TowerRoom для героя `heroId`/`heroNick`; `onDone` зовётся ровно раз. */
  async start(heroId: string, heroNick: string, onDone: (r: TowerRunResult) => void): Promise<void> {
    if (this.running) throw new Error("tower: попытка уже идёт");
    const seed = (Math.random() * 0xffffffff) >>> 0;
    let done = false;
    const listing = await matchMaker.createRoom("tower_room", {
      heroId,
      heroNick,
      seed,
      onResult: (r: TowerRunResult) => {
        if (done) return; // защита от двойного вызова (finish() гарантирует один раз, но не лишнее)
        done = true;
        this.activeRoomId = null;
        onDone(r);
      },
    });
    this.activeRoomId = listing.roomId;
  }
}
