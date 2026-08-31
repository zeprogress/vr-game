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
  type RtcMsg,
  type SaveMsg,
  type SpendMsg,
  type HandsMsg,
  type SetTimeMsg,
  type DropWeaponMsg,
  type TakeWeaponMsg,
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
  /** Служебный пакет голосового чата от другого игрока. */
  onRtc: ((msg: RtcMsg) => void) | null = null;
  /** Соединение с сервером потеряно (сервер перезапустился и т.п.). */
  onConnectionLost: (() => void) | null = null;
  /** Переподключились — надо заново подписаться на комнату. */
  onReconnected: ((room: Room<ZoneState>) => void) | null = null;

  /**
   * Персонаж, пришедший до того, как Game успела подписаться. В VR между
   * входом в комнату и attachNet проходит целый экран «Войти в VR», и без
   * этой заначки снаряжение с сервера просто терялось.
   */
  private pendingChar: CharMsg | undefined;

  private nick = "";
  private token = "";
  private reconnecting = false;
  private closedByUs = false;

  get online(): boolean {
    return this.room !== null;
  }

  /** Идёт попытка переподключения — не разбирать сеть, но и не считать офлайном. */
  get busyReconnecting(): boolean {
    return this.reconnecting;
  }

  get sessionId(): string {
    return this.room?.sessionId ?? "";
  }

  /** `true` — успех, `false` — сервера нет (одиночный режим). */
  async connect(nick: string, token: string): Promise<boolean> {
    this.nick = nick;
    this.token = token;
    this.closedByUs = false;
    this.client = new Client();
    // Несколько попыток: сервер мог как раз перезапускаться (деплой ~10 с).
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 2500));
      try {
        const room = await this.client.joinOrCreate<ZoneState>("zone", { nick, token });
        this.wireRoom(room);
        await firstSync(room);
        this.room = room;
        console.log(`[net] в комнате ${room.roomId} как ${room.sessionId}`);
        return true;
      } catch (e) {
        console.warn(`[net] вход не удался (попытка ${attempt + 1}):`, (e as Error).message);
      }
    }
    this.client = null;
    this.room = null;
    return false;
  }

  /** Подписки комнаты — общие для первого входа и переподключения. */
  private wireRoom(room: Room<ZoneState>): void {
    room.onMessage(MSG.char, (data: CharMsg) => {
      if (this.onChar) this.onChar(data);
      else this.pendingChar = data;
    });
    room.onMessage(MSG.mobHit, (m: MobHitMsg) => this.onMobHit?.(m.dmg, m.fromX, m.fromZ, m.by));
    room.onMessage(MSG.respawn, (m: RespawnMsg) => this.onRespawn?.(m.x, m.y, m.z));
    room.onMessage(MSG.levelUp, (m: LevelUpMsg) => this.onLevelUp?.(m.level));
    room.onMessage(MSG.picked, (m: PickedMsg) => this.onPicked?.(m.item, m.count));
    room.onMessage(MSG.rtc, (m: RtcMsg) => this.onRtc?.(m));
    room.onLeave((code) => {
      console.log(`[net] соединение закрыто (код ${code})`);
      this.room = null;
      if (!this.closedByUs) void this.reconnectLoop();
    });
  }

  /** Сервер перезапустился / связь оборвалась — пробуем зайти заново. */
  private async reconnectLoop(): Promise<void> {
    if (this.reconnecting || !this.client) return;
    this.reconnecting = true;
    this.onConnectionLost?.();
    for (let attempt = 0; attempt < 150 && !this.closedByUs; attempt++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const room = await this.client.joinOrCreate<ZoneState>("zone", {
          nick: this.nick,
          token: this.token,
        });
        this.wireRoom(room);
        await firstSync(room);
        this.room = room;
        this.reconnecting = false;
        console.log(`[net] переподключились к ${room.roomId}`);
        this.onReconnected?.(room);
        return;
      } catch {
        /* сервер ещё не поднялся — ждём дальше */
      }
    }
    this.reconnecting = false;
  }

  /** Отдать персонажа, если он пришёл раньше подписки. Звать после attachNet. */
  flushChar(): void {
    if (this.pendingChar === undefined) return;
    const data = this.pendingChar;
    this.pendingChar = undefined;
    this.onChar?.(data);
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

  /** Отправить служебный пакет голосового чата другому игроку. */
  sendRtc(msg: RtcMsg): void {
    this.room?.send(MSG.rtc, msg);
  }

  /** Заявка взять лежащее в мире оружие. */
  sendTakeWeapon(id: string): void {
    const msg: TakeWeaponMsg = { id };
    this.room?.send(MSG.takeWeapon, msg);
  }

  /** Сообщить, что теперь в руках — по этому сервер считает урон. */
  sendHands(msg: HandsMsg): void {
    this.room?.send(MSG.hands, msg);
  }

  /** Админ переводит время суток всему миру. */
  sendSetTime(hour: number, auto: number): void {
    this.room?.send(MSG.setTime, { hour, auto } satisfies SetTimeMsg);
  }

  /** Заработанное оружие легло на землю — пусть станет предметом мира. */
  sendDropWeapon(msg: DropWeaponMsg): void {
    this.room?.send(MSG.dropWeapon, msg);
  }

  /** Сохранить панельные настройки на сервере (по токену игрока). */
  sendLoadout(overrides: Record<string, unknown>): void {
    this.room?.send(MSG.loadout, overrides);
  }

  /**
   * Мировые часы с сервера — null офлайн. `hour` обновляется редко (раз в
   * DAYCYCLE.syncSeconds и на команду админа); между обновлениями клиент
   * крутит время сам от последнего значения.
   */
  get worldClock(): { hour: number; auto: number } | null {
    return this.room ? { hour: this.room.state.hour, auto: this.room.state.dayAuto } : null;
  }

  /** Своё состояние в схеме комнаты (HP, прогресс) — null офлайн. */
  get self(): PlayerState | null {
    const id = this.room?.sessionId;
    return id ? (this.room?.state.players.get(id) ?? null) : null;
  }

  disconnect(): void {
    this.closedByUs = true;
    void this.room?.leave();
    this.room = null;
    this.client = null;
  }
}

/** Ждём первую синхронизацию состояния — иначе onAdd не увидит уже вошедших. */
function firstSync(room: Room<ZoneState>): Promise<void> {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 800);
    room.onStateChange.once(() => {
      clearTimeout(t);
      resolve();
    });
  });
}
