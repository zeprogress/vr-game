import { Schema, type, ArraySchema, MapSchema } from "@colyseus/schema";

/** Трансформ в мире: позиция + кватернион. */
export class Xf extends Schema {
  @type("float32") x = 0;
  @type("float32") y = 0;
  @type("float32") z = 0;
  @type("float32") qx = 0;
  @type("float32") qy = 0;
  @type("float32") qz = 0;
  @type("float32") qw = 1;
}

export type PlayerMode = "flat" | "vr";

/** Ячейка сумки. Пустая — item "" и count 0. */
export class SlotState extends Schema {
  @type("string") item = "";
  @type("uint16") count = 0;
}

export class PlayerState extends Schema {
  @type("string") nick = "";
  @type("string") mode: PlayerMode = "flat";
  @type(Xf) head = new Xf();
  @type(Xf) handL = new Xf();
  @type(Xf) handR = new Xf();

  // ---- этап 7: здоровье и прогресс считает сервер ----
  @type("float32") hp = 100;
  @type("float32") maxHp = 100;
  /** 1 — лежит мёртвый, ждёт возрождения. */
  @type("uint8") dead = 0;
  @type("uint16") level = 1;
  @type("float32") xp = 0;
  @type("uint16") unspent = 0;
  @type("uint16") str = 1;
  @type("uint16") agi = 1;
  @type("uint16") int = 1;

  /** Класс меча в руках: iron | bronze | gold. */
  @type("string") swordTier = "iron";

  /** Сумка (этап 8). Длина фиксирована — BAG.slots. */
  @type([SlotState]) bag = new ArraySchema<SlotState>();
}

export type MobKind = "slime" | "spitter";

export class MobState extends Schema {
  @type("string") kind: MobKind = "slime";
  @type("float32") x = 0;
  @type("float32") y = 0;
  @type("float32") z = 0;
  @type("float32") yaw = 0;
  @type("float32") hp = 4;
  @type("float32") maxHp = 4;
  @type("uint8") dead = 0;
  @type("uint8") grounded = 1;
  /** ++ на каждый удар — клиент играет вспышку и рану. */
  @type("uint16") hurtSeq = 0;
  @type("float32") hurtDx = 0;
  @type("float32") hurtDz = 0;
}

export class DummyState extends Schema {
  @type("float32") x = 0;
  @type("float32") y = 0;
  @type("float32") z = 0;
  @type("float32") hp = 3;
  @type("uint8") dead = 0;
  @type("uint16") hurtSeq = 0;
}

/** Лут, лежащий в мире (этап 8). */
export class DropState extends Schema {
  @type("string") item = "";
  @type("uint16") count = 1;
  @type("float32") x = 0;
  @type("float32") y = 0;
  @type("float32") z = 0;
}

export class BallState extends Schema {
  @type("float32") x = 0;
  @type("float32") y = 0;
  @type("float32") z = 0;
  /** Скорость — клиент летит по ней между патчами, иначе плевок дёргается. */
  @type("float32") vx = 0;
  @type("float32") vy = 0;
  @type("float32") vz = 0;
}

/** Состояние зоны — общий контракт клиента и сервера. */
export class ZoneState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type({ map: MobState }) mobs = new MapSchema<MobState>();
  @type({ map: DummyState }) dummies = new MapSchema<DummyState>();
  @type({ map: BallState }) balls = new MapSchema<BallState>();
  @type({ map: DropState }) drops = new MapSchema<DropState>();
}
