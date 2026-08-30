import { Schema, type, MapSchema } from "@colyseus/schema";

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

export class PlayerState extends Schema {
  @type("string") nick = "";
  @type("string") mode: PlayerMode = "flat";
  @type(Xf) head = new Xf();
  @type(Xf) handL = new Xf();
  @type(Xf) handR = new Xf();
}

/** Состояние зоны — общий контракт клиента и сервера. */
export class ZoneState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}
