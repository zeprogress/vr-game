import { Client, type Room } from "colyseus.js";

import type { PlayerState, ZoneState } from "#shared/net/schema";
import {
  MSG,
  type CharMsg,
  type HitMobMsg,
  type LevelUpMsg,
  type MobHitMsg,
  type MoveMsg,
  type PickedMsg,
  type RespawnMsg,
  type SaveMsg,
  type SpendMsg,
  type TakeSwordMsg,
  type UseItemMsg,
} from "#shared/net/messages";
import type { BlockedBy } from "#shared/combat";
import type { StatName } from "#shared/progression";
import type { ItemId } from "#shared/items";

const SEND_HZ = 18;
const SEND_EVERY = 1000 / SEND_HZ;

/**
 * Клиент игрового сервера: комната zone, отдача транспорта с троттлингом,
 * загрузка/сохранение персонажа по гостевому токену.
 */
export class NetClient {
  private client: Client | null = null;
  room: Room<ZoneState> | null = null;
  private lastSent = 0;

  /** Вызывается один раз при входе: персонаж с сервера или null (новый токен). */
  onChar: ((data: CharMsg) => void) | null = null;
  /** Моб/плевок ударил игрока: прошедший урон, откуда и чем отбито. */
  onMobHit: ((dmg: number, fromX: number, fromZ: number, by: BlockedBy) => void) | null = null;
  /** Сервер возродил игрока — встать в эту точку. */
  onRespawn: ((x: number, y: number, z: number) => void) | null = null;
  /** Получен новый уровень. */
  onLevelUp: ((level: number) => void) | null = null;
  /** Подобран лут. */
  onPicked: ((item: ItemId, count: number) => void) | null = null;

  get online(): boolean {
    return this.room !== null;
  }

  get sessionId(): string {
    return this.room?.sessionId ?? "";
  }

  /** `true` — успех, `false` — сервера нет (одиночный режим). */
  async connect(nick: string, token: string): Promise<boolean> {
    try {
      this.client = new Client();
      const room = await this.client.joinOrCreate<ZoneState>("zone", { nick, token });
      room.onMessage(MSG.char, (data: CharMsg) => this.onChar?.(data));
      room.onMessage(MSG.mobHit, (m: MobHitMsg) =>
        this.onMobHit?.(m.dmg, m.fromX, m.fromZ, m.by),
      );
      room.onMessage(MSG.respawn, (m: RespawnMsg) => this.onRespawn?.(m.x, m.y, m.z));
      room.onMessage(MSG.levelUp, (m: LevelUpMsg) => this.onLevelUp?.(m.level));
      room.onMessage(MSG.picked, (m: PickedMsg) => this.onPicked?.(m.item, m.count));
      // Ждём первую синхронизацию — иначе onAdd не увидит уже вошедших.
      await new Promise<void>((r) => {
        const t = setTimeout(r, 800);
        room.onStateChange.once(() => {
          clearTimeout(t);
          r();
        });
      });
      this.room = room;
      console.log(`[net] в комнате ${this.room.roomId} как ${this.room.sessionId}`);
      this.room.onLeave((code) => {
        console.log(`[net] соединение закрыто (код ${code})`);
        this.room = null;
      });
      return true;
    } catch (e) {
      console.warn("[net] сервер недоступен — одиночный режим:", (e as Error).message);
      this.client = null;
      this.room = null;
      return false;
    }
  }

  /** Отправить свой транспорт (не чаще SEND_HZ раз в секунду). */
  sendMove(now: number, msg: MoveMsg): void {
    if (!this.room || now - this.lastSent < SEND_EVERY) return;
    this.lastSent = now;
    this.room.send(MSG.move, msg);
  }

  /** Отправить снимок состояния для сохранения (вызывается осознанно). */
  sendSave(msg: SaveMsg): void {
    this.room?.send(MSG.save, msg);
  }

  /** Сообщить о попадании по мобу/кукле (урон посчитает и применит сервер). */
  sendHitMob(msg: HitMobMsg): void {
    this.room?.send(MSG.hitMob, msg);
  }

  /** Заявка потратить очко характеристики. */
  sendSpend(stat: StatName): void {
    const msg: SpendMsg = { stat };
    this.room?.send(MSG.spend, msg);
  }

  /** Заявка использовать предмет из ячейки сумки. */
  sendUseItem(slot: number): void {
    const msg: UseItemMsg = { slot };
    this.room?.send(MSG.useItem, msg);
  }

  /** Заявка взять лежащий в мире меч. */
  sendTakeSword(id: string): void {
    const msg: TakeSwordMsg = { id };
    this.room?.send(MSG.takeSword, msg);
  }

  /** Своё состояние в схеме комнаты (HP, прогресс) — null офлайн. */
  get self(): PlayerState | null {
    const id = this.room?.sessionId;
    return id ? (this.room?.state.players.get(id) ?? null) : null;
  }

  disconnect(): void {
    void this.room?.leave();
    this.room = null;
    this.client = null;
  }
}
