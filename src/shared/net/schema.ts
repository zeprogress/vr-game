import { Schema, type } from "@colyseus/schema";

/**
 * Состояние зоны — общий контракт клиента и сервера.
 * Этап 4b: только счётчик тиков (пустая схема ломает рефлексию колизеуса).
 * Игроки (MapSchema<PlayerState>) добавятся на 4d.
 */
export class ZoneState extends Schema {
  @type("uint32") tick = 0;
}
