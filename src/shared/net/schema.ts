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
  /** Внешность бота зрителя: 0 — обычный аватар, 1..N — модель бота (Ф10). */
  @type("uint8") skin = 0;
  @type(Xf) head = new Xf();
  @type(Xf) handL = new Xf();
  @type(Xf) handR = new Xf();

  // ---- этап 7: здоровье и прогресс считает сервер ----
  @type("float32") hp = 100;
  @type("float32") maxHp = 100;
  /** 1 — лежит мёртвый, ждёт возрождения. */
  @type("uint8") dead = 0;
  /** 1 — игрок открыт для PvP. Урон между игроками идёт только если у обоих 1. */
  @type("uint8") pvp = 0;
  @type("uint16") level = 1;
  @type("float32") xp = 0;
  @type("uint16") unspent = 0;
  @type("uint16") str = 1;
  @type("uint16") agi = 1;
  @type("uint16") int = 1;
  /** Мана: запас и потолок (от интеллекта). Тратится на магию посоха. */
  @type("float32") mana = 30;
  @type("float32") maxMana = 30;
  /** Бафф победы над событием: секунд осталось (0 — нет). Клиент рисует синюю ауру, ×2 опыт/урон. */
  @type("uint16") buffSecs = 0;

  /** Что в левой руке: класс оружия и уровень ("" — пусто). */
  @type("string") leftCls = "";
  @type("string") leftTier = "";
  /** Что в правой руке. */
  @type("string") rightCls = "";
  @type("string") rightTier = "";

  /** Сумка (этап 8). Длина фиксирована — BAG.slots. */
  @type([SlotState]) bag = new ArraySchema<SlotState>();

  // ---- Охотничья башня: снимок боя в TowerRoom (отдельная комната) для
  // визуала у спектатора/игрока — сама симуляция считается там, здесь
  // только зеркало на чтение. 0 — герой сейчас не в башне. ХП героя — те же
  // hp/maxHp выше (не отдельное поле): та же полоска, что и у персонажа.
  // Позиция героя — те же head.x/y/z (реально бегает по арене).
  @type("uint8") towerFloor = 0;
  @type("uint8") towerMobsLeft = 0;
  @type("uint8") towerMobsTotal = 0;
  @type("uint8") towerBossActive = 0;
  @type("float32") towerBossHpFrac = 0;
}

export type MobKind = "slime" | "spitter" | "boss" | "shard";

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
  /** ++ на каждую атаку моба (укус слизня, плевок, слэм) — клиент играет замах. */
  @type("uint16") attackSeq = 0;
  @type("float32") hurtDx = 0;
  @type("float32") hurtDz = 0;
  /** Размер тела относительно обычного слизня (босс — крупнее, осколок — мельче). */
  @type("float32") scale = 1;
  /**
   * Имя модели из пака для этого моба (ключ MODELS на клиенте). Пусто —
   * стандартный вид (сфера/Slime.glb). Ставится один раз при создании —
   * например у усиленных мобов лагерей (пчёлы и т.п.).
   */
  @type("string") model = "";
  /** Переопределение имени в плашке (усиленные мобы лагерей). Пусто — по kind. */
  @type("string") mobName = "";
  /** Переопределение уровня в плашке. 0 — по kind. */
  @type("uint8") mobLevel = 0;
  /** Телеграф слэма босса: 0 — нет, 1 — вот-вот ударит. */
  @type("float32") windup = 0;
  /** ++ на каждый слэм — клиент рисует ударную волну. */
  @type("uint16") slamSeq = 0;
  /** 1 — босс в ярости (клиент подсвечивает). */
  @type("uint8") enraged = 0;
  /** Телеграф рывка-тарана: 1 — босс вот-вот бросится по прямой. */
  @type("uint8") charging = 0;
  /** 1 — моб оглушён (стоит столбом): клиент рисует «звёздочки» над головой. */
  @type("uint8") stunned = 0;
  /** Секунд горения (Пламенный меч) — клиент рисует тлеющее свечение. */
  @type("uint8") burning = 0;
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
  /** 1 — плевок босса (красный), иначе плевуна. */
  @type("uint8") boss = 0;
}

/** Огненный снаряд игрока (посох). */
export class BoltState extends Schema {
  @type("float32") x = 0;
  @type("float32") y = 0;
  @type("float32") z = 0;
  @type("float32") vx = 0;
  @type("float32") vy = 0;
  @type("float32") vz = 0;
  /** Радиус снаряда (от заряда) — клиент рисует пламя этого размера. */
  @type("float32") r = 0.15;
  /** 0 — огнешар (посох), 1 — стрела (лук). Клиент рисует по-разному. */
  @type("uint8") kind = 0;
}

/** Состояние зоны — общий контракт клиента и сервера. */
export class ZoneState extends Schema {
  /** Час суток (0..24) — им владеет сервер, клиенты только читают. */
  @type("float32") hour = 8;
  /** 1 — время идёт само, 0 — стоит на выставленном часе. */
  @type("uint8") dayAuto = 1;
  /** 1 — чёрная виньетка при движении разрешена; 0 — админ отключил её всем. */
  @type("uint8") comfortVignette = 1;
  /** 1 — мобы дерутся как обычно; 0 — замерли на месте (админ-панель пульта). */
  @type("uint8") mobsOn = 1;
  /** 1 — левый стик телепортирует (меньше укачивает); 0 — плавное скольжение. */
  @type("uint8") teleportMove = 0;
  /**
   * Позиция и точка взгляда рендерящего спектатора (камеры стрима) — шлёт
   * сам Spectator.ts, троттлится. Видна игрокам меткой в мире, только пока
   * specActive=1 (спектатор реально подключён) и specVisible=1 (пульт).
   */
  @type("float32") specX = 0;
  @type("float32") specY = 0;
  @type("float32") specZ = 0;
  @type("float32") specTX = 0;
  @type("float32") specTY = 0;
  @type("float32") specTZ = 0;
  /** 1 — рендерящий спектатор сейчас подключён (не пульт — у того нет камеры). */
  @type("uint8") specActive = 0;
  /** 1 — метка камеры зрителя видна игрокам (переключатель на пульте). */
  @type("uint8") specVisible = 1;
  /** 1 — у метки камеры ещё и лучи направления взгляда (отдельный переключатель). */
  @type("uint8") specRaysVisible = 1;
  /** 1 — рендерящий спектатор слышит голосовую связь игроков (пульт, для стрима). */
  @type("uint8") specVoice = 0;
  /** 1 — сообщения чата озвучиваются на стриме (пульт). */
  @type("uint8") ttsOn = 0;
  /** Голос озвучки чата — Fish Audio reference_id (пульт). */
  @type("string") ttsVoice = "";
  /**
   * Общая подгонка снаряжения (частичный Loadout, JSON-строка): руки, VR-позы
   * оружия, HUD, пояс, свет. Админ правит в панели — применяется всем.
   */
  @type("string") worldLoadout = "{}";
  /** Динамическое событие (этап 14): 0 — нет, 1 — «Нашествие». */
  @type("uint8") eventKind = 0;
  /** Эпицентр активного события в мире. */
  @type("float32") eventX = 0;
  @type("float32") eventZ = 0;
  /** Сколько врагов события осталось (для HUD-строки). */
  @type("uint8") eventLeft = 0;

  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type({ map: MobState }) mobs = new MapSchema<MobState>();
  @type({ map: DummyState }) dummies = new MapSchema<DummyState>();
  @type({ map: BallState }) balls = new MapSchema<BallState>();
  @type({ map: BoltState }) bolts = new MapSchema<BoltState>();
  @type({ map: DropState }) drops = new MapSchema<DropState>();
}
