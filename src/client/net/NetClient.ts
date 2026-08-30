import { Client, type Room } from "colyseus.js";

import type { ZoneState } from "#shared/net/schema";
import {
  MSG,
  type CharMsg,
  type HitMobMsg,
  type MobHitMsg,
  type MoveMsg,
  type SaveMsg,
  type XpMsg,
} from "#shared/net/messages";

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
  /** Сервер начислил опыт (добит моб). */
  onXp: ((amount: number) => void) | null = null;
  /** Моб/плевок ударил игрока: урон и точка, откуда прилетело. */
  onMobHit: ((dmg: number, fromX: number, fromZ: number) => void) | null = null;

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
      room.onMessage(MSG.xp, (m: XpMsg) => this.onXp?.(m.amount));
      room.onMessage(MSG.mobHit, (m: MobHitMsg) => this.onMobHit?.(m.dmg, m.fromX, m.fromZ));
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

  /** Сообщить о попадании по мобу/кукле (урон применит сервер). */
  sendHitMob(msg: HitMobMsg): void {
    this.room?.send(MSG.hitMob, msg);
  }

  disconnect(): void {
    void this.room?.leave();
    this.room = null;
    this.client = null;
  }
}
