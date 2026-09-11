import colyseus from "colyseus";

import type { TowerRunResult, TowerSnapshot } from "./TowerRoom";

const { matchMaker } = colyseus;

/**
 * Владеет ЖИЗНЕННЫМ ЦИКЛОМ одной попытки «Охотничьей башни» — не очередью
 * (та живёт в ZoneRoom, это просто массив id героев). Один экземпляр на
 * ZoneRoom; одновременно активна только одна попытка (сама очередь это и
 * гарантирует — следующего зовём только после результата предыдущего).
 */
export class TowerRunManager {
  private activeRoomId: string | null = null;
  /**
   * true с САМОЙ первой синхронной строки start() до появления activeRoomId.
   * Без этого флага `running` был false все ~1-2 тика, пока висел await
   * matchMaker.createRoom(...) — ZoneRoom.tickEvents() (тик каждые 50мс)
   * успевал выдернуть из очереди ещё героя-другого и наплодить несколько
   * башен параллельно вместо одной строго по очереди.
   */
  private starting = false;

  get running(): boolean {
    return this.starting || this.activeRoomId !== null;
  }

  /** Поднять TowerRoom для героя `heroId`/`heroNick`; `onDone` зовётся ровно раз. */
  async start(
    heroId: string,
    heroNick: string,
    onDone: (r: TowerRunResult) => void,
    onFloor?: (floor: number) => void,
    onSnapshot?: (s: TowerSnapshot) => void,
  ): Promise<void> {
    if (this.running) throw new Error("tower: попытка уже идёт");
    this.starting = true;
    try {
      const seed = (Math.random() * 0xffffffff) >>> 0;
      let done = false;
      const listing = await matchMaker.createRoom("tower_room", {
        heroId,
        heroNick,
        seed,
        onFloor,
        onSnapshot,
        onResult: (r: TowerRunResult) => {
          if (done) return; // защита от двойного вызова (finish() гарантирует один раз, но не лишнее)
          done = true;
          this.activeRoomId = null;
          onDone(r);
        },
      });
      this.activeRoomId = listing.roomId;
    } finally {
      this.starting = false;
    }
  }
}
