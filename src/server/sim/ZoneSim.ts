import { RING, RING_LEVEL_GATE } from "#shared/jewels";
import { QUEST } from "#shared/quests";
import { AFFIX, BOW, COMBAT, DROP_CHANCE, EVENT, WEAPON_DROP_MUL, UNIQUE_DROP_MUL, goldDropMulForLevel, WORLD, PLAYER } from "#shared/constants";
import { BOSS_CFG, SLIME_CFG, SPITTER_CFG } from "#shared/mobs";
import { RAID } from "#shared/raid";
import { BOSS, ELITE_MOBS, MAGE_NOVA, SPORE, BLINK, PULL, CHARGE, REFLECT, SPIKES, CHIEF_HEAL, FREEZE, WEB, LEAP, BURROW, STORM, CLONES, PARRY, SCARECROW, PACK_FRENZY, SHOTS, type MobShot, type EliteMobDef, BOSS_ADAPT, MAGE_SPELL, MOB, FLYER_HIT_BONUS, MOB_CAMPS, SHARD, SHARD_CFG, SPITTER, ICE_GIANT, MOB_SWING } from "#shared/mobs";
import { DUN_MOB_CAMPS, DUN_X, DUN_Z, dunFloorLocal, dunProject, dunWorld, inDunRegion } from "#shared/dungeon";
import { ARMOR_DROP, ARMOR_PARTS, armorBaseLevelMul, armorGoldDropChance, armorLegendaryDropChance, armorLevelMul, ARMOR_LEVEL_GATE, levelFadeMul, rollArmor, type ArmorInstance } from "#shared/armor";
import { climbStep, terrainHeight, enableTerrainHeightCache } from "#shared/terrain";
import { PLAGUE } from "#shared/classes2";
import { catProject, inCatRegion } from "#shared/catacombs";
import type { DmgHitColor } from "#shared/net/messages";

// Сервер: высоты рельефа — из кеша плиток (точная формула съедала ~⅓ CPU).
enableTerrainHeightCache();
import { lowMobDropMul, maxHpFor, scaleCount, weaponDmgFromLevel } from "#shared/progression";

/** Стартовые атрибуты — эталон «голого» героя для адаптивного урона. */
const START_ATTRS = { str: 1, agi: 1, int: 1, con: 1, luc: 1, wis: 1 };
import { HUB, HUB_CENTER } from "#shared/hub";
import { trees } from "#shared/trees";
import { rocks } from "#shared/rocks";
import {
  BAG,
  isItemId,
  ITEMS,
  rollLoot,
  rollAegisInstance,
  rollWeaponInstance,
  weaponKey,
  type ItemId,
  type WeaponClass,
  type WeaponInstance,
  type WeaponTier,
} from "#shared/items";
import type { MobKind } from "#shared/net/schema";
import { segDist } from "./math";
import { LavaSkills, type LavaCtx, type LavaEvent, type LavaFxKind } from "./lavaSkills";

/** Потолок здоровья для эффектов «% от HP цели» (см. Mob.pctHpBase). */
const PCT_HP_CAP = 10_000;
/** Вклад в бой «свежий» (с): по нему делится опыт за обычного моба и засчитываются квесты охоты и вожаков. */
const CONTRIB_RECENCY = 20;

/** Каким предметом каждое оружие лежит в мире. */
export const WEAPON_DROP: Partial<Record<string, ItemId>> = {
  "sword:gold": "gold_sword",
  "bow:gold": "gold_bow",
  "staff:gold": "gold_staff",
  "sword:legendary": "leg_sword",
  "bow:legendary": "leg_bow",
  "shield:legendary": "leg_shield",
  "shield:gold": "gold_shield",
  "staff:legendary": "leg_staff",
  "dagger:gold": "gold_dagger",
  "spear:gold": "gold_spear",
  "hammer:gold": "gold_hammer",
  "dagger:legendary": "leg_dagger",
  "spear:legendary": "leg_spear",
  "hammer:legendary": "leg_hammer",
  "sword:ruby": "ruby_sword",
  "bow:ruby": "ruby_bow",
  "staff:ruby": "ruby_staff",
  "dagger:ruby": "ruby_dagger",
  "spear:ruby": "ruby_spear",
  "hammer:ruby": "ruby_hammer",
  "shield:ruby": "ruby_shield",
  "sword:craft": "craft_sword",
  "bow:craft": "craft_bow",
  "staff:craft": "craft_staff",
  "dagger:craft": "craft_dagger",
  "spear:craft": "craft_spear",
  "hammer:craft": "craft_hammer",
};
const GOLD_CLASSES: readonly WeaponClass[] = ["sword", "bow", "staff", "shield", "dagger", "spear", "hammer"];
const LEGENDARY_CLASSES: readonly WeaponClass[] = ["sword", "bow", "staff", "shield", "dagger", "spear", "hammer"];
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

/** Препятствия (стволы + крупные камни) — общие с клиентом, один раз. */
const OBSTACLES: { x: number; z: number; r: number }[] = [
  ...trees().map((t) => ({ x: t.x, z: t.z, r: t.r })),
  ...rocks()
    .filter((rk) => rk.solid)
    .map((rk) => ({ x: rk.x, z: rk.z, r: rk.r })),
];

/** Насколько далеко вперёд моб смотрит, выбирая куда прыгнуть. */
const TREE_LOOKAHEAD = 3.5;
/** Вожак лагеря возрождается реже обычных мобов, с. */
const CHAMP_RESPAWN = 120;

/**
 * Выталкивает точку спавна моба за пределы лагеря (HUB): в безопасной зоне
 * мобов быть не должно. Толкаем радиально от центра лагеря.
 */
function awayFromHub(x: number, z: number): [number, number] {
  const dx = x - HUB_CENTER.x;
  const dz = z - HUB_CENTER.z;
  const d = Math.hypot(dx, dz);
  if (d >= HUB.mobExclusionRadius) return [x, z];
  const k = d < 1e-3 ? 1 : HUB.mobExclusionRadius / d;
  return [HUB_CENTER.x + dx * k * 1.05, HUB_CENTER.z + dz * k * 1.05];
}

/**
 * Отклоняет намеченное направление прыжка в сторону от ствола на пути.
 *
 * Без этого моб бьётся в дерево и стоит: выталкивание не даёт залезть внутрь,
 * но и обойти само не помогает. Здесь моб заранее берёт по касательной —
 * с той стороны, к которой ствол и так ближе, так что крюк выходит короткий.
 */
function steerAroundTrees(
  x: number,
  z: number,
  dx: number,
  dz: number,
): [number, number] {
  const clr = MOB.bodyRadius + 0.35; // запас, чтобы не тереться боком о ствол
  let hit: { along: number; perp: number; wide: number } | null = null;
  for (const t of OBSTACLES) {
    const rx = t.x - x;
    const rz = t.z - z;
    const along = rx * dx + rz * dz; // вдоль хода
    if (along <= 0 || along > TREE_LOOKAHEAD) continue;
    const perp = rx * -dz + rz * dx; // влево от хода
    const wide = t.r + clr;
    if (Math.abs(perp) >= wide) continue;
    if (!hit || along < hit.along) hit = { along, perp, wide };
  }
  if (!hit) return [dx, dz];

  // Уходим в сторону, противоположную стволу; чем он ближе к оси хода, тем круче.
  const side = hit.perp >= 0 ? -1 : 1;
  const force = 1 - Math.abs(hit.perp) / hit.wide;
  const nx = -dz * side;
  const nz = dx * side;
  const sx = dx + nx * (0.6 + force);
  const sz = dz + nz * (0.6 + force);
  const len = Math.hypot(sx, sz);
  return len > 1e-4 ? [sx / len, sz / len] : [dx, dz];
}

/** Середина торса куклы над её основанием (см. клиентский Dummy). */
const DUMMY_CENTER_Y = 1.5;

let seq = 1;
const nid = (): string => `e${seq++}`;

export interface SimPlayer {
  sessionId: string;
  /** голова/глаза */
  x: number;
  y: number;
  z: number;
  /** 🧪 «Стрела-призрак»: обычные мобы героя не видят и не бьют (боссы — видят, см. seesGhosts). */
  ghost?: boolean;
}

/** Видит ли моб «призрака» (🧪 «Стрела-призрак»): только боссы — Багровый, боссы событий и катакомб, рейд-босс. */
export function seesGhosts(m: { kind: string; bossFight: boolean; anchored: boolean }): boolean {
  return m.kind === "boss" || m.bossFight || m.anchored;
}

/** Вклад одного участника в бой с боссом. */
interface BossContrib {
  dmg: number;
  heal: number;
  taken: number;
  /** sim-время (сек) последнего вклада — для окна давности. */
  last: number;
}

/** Событие «моб/плевок ударил игрока» — комната разошлёт его. */
export interface PlayerHit {
  target: string;
  dmg: number;
  fromX: number;
  fromZ: number;
  /** true — снаряд (плевок): мечом отбивается полностью, а не на 75%. */
  projectile: boolean;
  /** Ник атакующего игрока (PvP) — для кил-фида; нет — урон от моба/среды. */
  byName?: string;
  /** id моба-источника урона (плевун, слизень) — бот по нему переключается. */
  byMob?: string;
  /** Оглушение цели на N секунд (спец-атака моба). Нет — не оглушает. */
  stunSec?: number;
  /** Замедление цели на N секунд (Ледяной демон) и его доля (0.45 — медленнее на 45%). */
  slowSec?: number;
  slowFrac?: number;
  /** Корень (паутина): герой не может бежать rootSec секунд, бить и умения — может. */
  rootSec?: number;
  /** Паутина (паук): +1 стак на попадание; замедление считает сервер по числу стаков. */
  webStack?: boolean;
  /** «Обморожение» Ледяного гиганта: сколько стаков кладёт попадание (ICE_GIANT.frost, считает комната). */
  frost?: number;
  /** Сила отбрасывания ОТ источника удара, м/с (спец-атака моба). */
  knockback?: number;
  /** Урон средой (ядовитое облако): щит/меч/уворот не спасают. */
  dot?: boolean;
  /** Физический снаряд (копьё, шипы): гасит броня и Физ. защита щита, а не маг. защита. */
  phys?: boolean;
  /** Кровотечение: секунд и доля урона попадания в секунду (Метатель копий). */
  bleedSec?: number;
  bleedFrac?: number;
  /** Доля РЕАЛЬНО нанесённого урона, которую моб-источник (byMob) лечит себе. */
  lifesteal?: number;
  /** Магический урон: броня от силы не гасит, защищает интеллект. */
  magic?: boolean;
}

/** Событие моба для визуала у клиентов (ZoneRoom рассылает как MSG.act). */
export interface MobFx {
  k: LavaFxKind | "sporeMark" | "blinkOut" | "blinkIn" | "pullMark" | "pullHit" | "chargeMark" | "chargeHit" | "reflectOn" | "spikeMark" | "spikeHit" | "chiefHeal" | "freezeMark" | "freezeHit" | "leapMark" | "leapHit" | "caltrops" | "burrowDive" | "burrowTrail" | "burrowMark" | "burrowHit" | "stormMark" | "stormHit" | "stormJump" | "ninjaSmoke" | "parryOn" | "parryHit" | "pierceShot"
    | "giantSlam" | "giantSlamHit" | "giantThrowMark" | "giantThrowFly" | "giantThrowHit" | "giantFissure" | "giantFissureGo" | "giantFury";
  /** Радиус области, м (прыжок Скалолома, колючки). */
  r?: number;
  x: number;
  z: number;
  /** Второй конец (хват щупальцами: от спрута x2/z2 к цели x/z). */
  x2?: number;
  z2?: number;
  /** Длительность (телеграф и т.п.), с. */
  d?: number;
}

/**
 * Общая на пару осколков голема (см. Mob.splitGroup, ZoneSim.splitGolem):
 * пока хоть один жив — просто мобы как мобы (сами не возрождаются, см.
 * ZoneSim.hitMob). Когда умер последний — на месте гибели встаёт свежий
 * целый голем (та же точка спавна и полные характеристики — opts).
 */
interface GolemSplitGroup {
  remaining: number;
  kind: MobKind;
  /** Настоящее место спавна голема в лагере, НЕ точка, где погиб осколок. */
  homeX: number;
  homeZ: number;
  reviveSec: number;
  opts: ConstructorParameters<typeof Mob>[3];
}

/**
 * Прыжок моба в погоне: полёт, с (по замеру ~11 тиков), и доля горизонтальной скорости, которую раньше
 * моб терял на земле между прыжками (скольжение). Скорость прыжка домножается на
 * (полёт + доля·пауза) / (полёт + пауза) — средняя скорость погони не меняется, пауз больше нет.
 */
const HOP_FLIGHT_SEC = 0.55;
const HOP_GLIDE = 0.25;
/** Кольцо, на котором ходок-прыгун ждёт готовности LEAP (между LEAP.minDist и LEAP.maxDist). */
const LEAP_WAIT_RING = (LEAP.minDist + LEAP.maxDist) / 2;
/** Землерой под землёй кружит внутри своей метки: радиус, м, и скорость, м/с. */
const BURROW_CIRCLE_R = 1;
const BURROW_CIRCLE_V = 2;

/** Подземелье: перенос моба к полу дальше этого, м — это уже прыжок через провал; такой шаг отменяется. */
const DUN_SNAP_MAX = 3;

/** Канал яда на мобе: стаки, урон в секунду за стак, сколько ещё тикает, чей; взрыв и показ цифр. */
interface PoisonCh {
  stacks: number;
  dps: number;
  t: number;
  by: string;
  burst: number;
  burstCd: number;
  shown: number;
  showT: number;
}
const newPoison = (): PoisonCh => ({ stacks: 0, dps: 0, t: 0, by: "", burst: 0, burstCd: 0, shown: 0, showT: 0 });

export class Mob {
  readonly id = nid();
  /** Это осколок голема из пары — см. GolemSplitGroup. undefined — обычный моб. */
  splitGroup?: GolemSplitGroup;
  x: number;
  y: number;
  z: number;
  yaw = 0;
  /** Куда моб смотрит в покое (сейчас задаётся только боссу — в сторону поляны). */
  restYaw = 0;
  faceRest = false;
  vx = 0;
  vy = 0;
  vz = 0;
  hp: number;
  /** Не readonly: Багровый слизень меняет его под бойцов (ZoneSim.adaptBoss). */
  maxHp: number;
  dead = false;
  private deadT = 0;
  private respawnIn = 0;
  /** Тело лежит, но не возрождается (катакомбы: его уберёт ZoneSim после смерти — см. CAT_CORPSE_LINGER_S). */
  keepDead(): void {
    this.respawnIn = Number.POSITIVE_INFINITY;
  }
  grounded = true;
  /** Открытые залы катакомб, если моб там (таран не уводит его за стены); иначе null. Выставляет симуляция. */
  catHalls: readonly number[] | null = null;
  /** Куда лениво бредём вне боя. По приходе выбираем новую точку у дома. */
  private wanderX = 0;
  private wanderZ = 0;
  private attackCd = 0;
  /** Ближний удар в замахе: до удара, с; цель и урон — что ударить (см. MOB.strikeDelay). */
  private strikeT = 0;
  private strikeTo: string | null = null;
  private strikeDmg = 0;
  /** От замаха до урона ближнего удара, с (EliteMobDef.strikeDelay; иначе MOB.strikeDelay). */
  private readonly strikeDelay: number;
  /**
   * Лавовый монстр (LAVA): приёмы Стража и Мага. Моб стоит, пока клип приёма идёт; события — урон, оглушение,
   * эффекты (MobFx) и клип (swing). Оглушение посреди замаха срывает приём (внутри LavaSkills).
   */
  private tickLava(dt: number, players: SimPlayer[], hits: PlayerHit[]): void {
    if (!this.lava) return;
    const c: LavaCtx = {
      x: this.x, z: this.z, yaw: this.yaw, hpFrac: this.hp / this.maxHp, aggroed: this.aggroed,
      stunned: this.stunnedT > 0,
      heroes: players.map((p) => ({ id: p.sessionId, x: p.x, z: p.z })),
      base: MOB.attackDamage * this.dmgMul,
    };
    for (const ev of this.lava.tick(dt, c)) this.applyLava(ev, hits);
  }

  private applyLava(ev: LavaEvent, hits: PlayerHit[]): void {
    if (ev.t === "swing") this.swing(ev.k);
    else if (ev.t === "fx") this.fx.push({ k: ev.fx.k, x: ev.fx.x, z: ev.fx.z, r: ev.fx.r, x2: ev.fx.x2, z2: ev.fx.z2, d: ev.fx.d });
    else
      hits.push({
        target: ev.target, dmg: ev.dmg, fromX: ev.fromX, fromZ: ev.fromZ, projectile: false, byMob: this.id,
        stunSec: ev.stunSec, slowSec: ev.slowSec, slowFrac: ev.slowFrac, knockback: ev.knockback, dot: ev.dot,
      });
  }

  /** Ледяной гигант (ICE_GIANT): умения и их таймеры. */
  readonly iceGiant: boolean;
  private giantAuraT = 0;
  /** Сколько ещё стоит на месте, доигрывая клип умения (раскол, бросок, разлом, рёв). */
  private giantCastT = 0;
  private giantYaw = 0;
  /** Последний удар вблизи — левой (чередование клипов Attack / Attack2). */
  private giantLeft = false;
  /** Пауза между умениями, чтобы между ними он ещё и бил когтями. */
  private giantGapT = 3;
  private giantSlamCd = 6;
  private giantSlamT = 0;
  private giantThrowCd = 4;
  private giantThrowT = 0;
  private giantFlyT = 0;
  private giantThrowX = 0;
  private giantThrowZ = 0;
  private giantFissureCd = 5;
  private giantFissureT = 0;
  /** Бегущий разлом: начало, направление, пройдено (м; <0 — не бежит) и кого уже задел. */
  private giantFisX = 0;
  private giantFisZ = 0;
  private giantFisDx = 0;
  private giantFisDz = 1;
  private giantFisRun = -1;
  private readonly giantFisHit = new Set<string>();
  /** «Ледяная ярость» включилась (один раз за жизнь). */
  giantFury = false;
  /**
   * Дракон «Охоты на элиту»: здоровье — удары (EVENT.eliteHunt.hits), каждое попадание (не тик) — минус одно;
   * настоящий урон копится в dmgLog — по нему комната считает DPS и фазы.
   */
  hitCounter = false;
  /** Удары не растут от числа бьющих (нашествие: гиганты — фикс. 100 ударов); у дракона охоты — растут. */
  hitsFixed = false;
  /** Лом за убийство моба (попадает в mobKills → сумка убийцы). */
  readonly scrapN: number;
  /** Делится ли лом между участниками; участники, которых посчитали при смерти (scrapParts). */
  readonly scrapShared: boolean;
  scrapParts: string[] | null = null;
  /** Фаза дракона охоты (1..4), 0 — не он. */
  huntPhase = 0;
  /** Кто уже бил дракона охоты: каждый новый бьющий добавляет EVENT.eliteHunt.hitsPerHero ударов. */
  readonly hitters = new Set<string>();
  private readonly dmgLog: { t: number; d: number }[] = [];

  /** Запомнить урон по счётчику ударов (мс — Date.now()). */
  noteDamage(d: number, now: number, windowSec: number): void {
    this.dmgLog.push({ t: now, d });
    this.pruneDmg(now, windowSec);
  }

  /** Общий урон в секунду по мобу за последние windowSec с (все герои). */
  dpsAt(now: number, windowSec: number): number {
    this.pruneDmg(now, windowSec);
    let sum = 0;
    for (const e of this.dmgLog) sum += e.d;
    return sum / windowSec;
  }

  private pruneDmg(now: number, windowSec: number): void {
    const from = now - windowSec * 1000;
    while (this.dmgLog.length && this.dmgLog[0].t < from) this.dmgLog.shift();
  }
  /** Наледь от упавших глыб: замедляет, пока стоишь (переживает смерть гиганта до истечения). */
  private readonly icePatches: { x: number; z: number; t: number; tickT: number }[] = [];
  /** Плевун: сколько уже пятится и сколько ещё нельзя пятиться. */
  private retreatT = 0;
  private restT = 0;
  private retreatSide = Math.random() < 0.5 ? 1 : -1;
  private hurtCd = 0;
  private aggroed = false;
  private outOfRange = 0;
  /** true, пока моб бежит домой напрямик после того, как погоня увела его за wanderRadius. */
  private returningHome = false;
  /** sessionId игрока/бота, за которым сейчас гонится (null — никого не преследует). Для «!follow»-телохранителя. */
  targetId: string | null = null;
  hurtSeq = 0;
  /** ++ на каждую атаку (укус, плевок, слэм) — клиент играет замах моба. */
  attackSeq = 0;
  /** Вид последнего замаха (MOB_SWING): укус по умолчанию, у босса — свой клип. */
  attackKind = 0;
  hurtDx = 0;
  hurtDz = 0;
  /** Точка спавна (не текущая позиция) — публично для ZoneSim.splitGolem. */
  readonly homeX: number;
  readonly homeZ: number;
  readonly ranged: boolean;
  readonly xp: number;
  readonly scale: number;
  /**
   * Вклад участников боя с боссом (для гибридного дележа опыта):
   * урон боссу, лечение союзников, полученный от босса урон + метка времени
   * последнего вклада (окно давности отсекает «бил час назад» и залипшие
   * записи ботов).
   */
  readonly contrib = new Map<string, BossContrib>();

  /** Записать вклад в бой с боссом. */
  bump(owner: string, field: "dmg" | "heal" | "taken", amount: number, now: number): void {
    if (!owner || amount <= 0) return;
    let c = this.contrib.get(owner);
    if (!c) {
      c = { dmg: 0, heal: 0, taken: 0, last: 0 };
      this.contrib.set(owner, c);
    }
    c[field] += amount;
    c.last = now;
  }

  // --- босс ---
  private slamCd: number = BOSS.slamCooldown;
  /** Время до слэма, пока > 0 — телеграф (босс стоит). */
  private slamWindupT = 0;
  slamSeq = 0;
  /** Рывок-таран: замах, полёт, куда летим и был ли уже удар за этот рывок. */
  private lungeCd = 0; // первый рывок — сразу по агро
  private lungeWindupT = 0;
  private lungeT = 0;
  private lungeDirX = 0;
  private lungeDirZ = 1;
  private lungeHit = false;
  /** Плевок босса: кулдаун очереди, сколько сгустков осталось и пауза между ними. */
  private shootCd: number = BOSS.shootCooldown;
  private shootQueue = 0;
  private shootGap = 0;
  private splitsDone = 0;
  /** ZoneSim прочтёт и сбросит: босс пересёк порог HP — выбросить осколки. */
  pendingSplit = false;
  /** Осколки не возрождаются — их убирают из симуляции насовсем. */
  get permanent(): boolean {
    return this.kind !== "shard";
  }
  /** Принудительная ярость (элита события ниже порога HP) — ставит комната. */
  raging = false;
  /** Неуязвим (щит стадии босса катакомб) — hitMob не снимает HP. */
  immune = false;
  get enraged(): boolean {
    if (this.dead) return false;
    if (this.raging) return true;
    return this.kind === "boss" && this.hp / this.maxHp < BOSS.enrageAt;
  }
  /** Готовность слэма/рывка 0..1 (для телеграфа на клиенте). */
  get slamTelegraph(): number {
    if (this.slamWindupT > 0) return 1 - this.slamWindupT / BOSS.slamWindup;
    if (this.lungeWindupT > 0) return 1 - this.lungeWindupT / BOSS.lungeWindup;
    return 0;
  }
  /** 1 — босс копит или выполняет рывок-таран (клиент вытягивает тело). */
  get charging(): boolean {
    return this.lungeWindupT > 0 || this.lungeT > 0;
  }

  /** Множитель урона усиленного («элитного») моба из лагеря. 1 — обычный. */
  readonly dmgMul: number;
  /** Броня против дальнего боя (0..1): доля урона стрел/магии, которую съедает панцирь. */
  readonly rangedArmor: number;
  /** Физическая броня (0..1): доля урона меча/стрел, магию не режет. */
  readonly physArmor: number;
  /** Магическая броня (0..1): доля урона магии (огнешар, молнии, яд), которую съедает моб. */
  readonly magicArmor: number;
  /** Множитель урона магии (>1 — уязвим). */
  readonly magicVulnMul: number;
  /** Множитель урона крита (>1 — уязвим). */
  readonly critVulnMul: number;
  /** true — дальняя атака моба взрывается по площади (Чародей руин). */
  readonly spellAoe: boolean;
  /** true — периодическое заклинание по площади вокруг себя (Чародей руин). */
  readonly novaCaster: boolean;
  /** Ниже этой доли HP — сам себе выставляет `raging = true` (см. tick()). undefined — никогда. */
  readonly enrageAt: number | undefined;
  /** Раскол (Голем-крушитель) — см. EliteMobDef.splitAt и комментарий там же. */
  readonly splitAt: number | undefined;
  readonly splitCount: number;
  readonly splitScaleMul: number;
  readonly splitHpFrac: number;
  readonly splitDmgMul: number;
  readonly splitSpeedMul: number;
  readonly splitXp: number;
  readonly splitChildXp: number;
  readonly splitReviveSec: number;
  /** Множитель скорости движения — 1 обычно, у осколков голема выше. */
  readonly speedMul: number;
  private splitDone = false;
  /**
   * true один раз (первый вызов после пересечения порога) — проверяем
   * СРАЗУ по факту урона (`hpBefore` — HP до этого попадания), а не на
   * следующем тике: иначе при переборе (один удар сразу и ниже splitAt, и
   * в 0 HP) флаг просто не успевал бы выставиться до обработки смерти, и
   * голем умирал бы как обычный моб, минуя раскол.
   */
  checkSplitThreshold(hpBefore: number): boolean {
    if (this.splitAt === undefined || this.splitDone) return false;
    if (hpBefore / this.maxHp > this.splitAt && this.hp / this.maxHp <= this.splitAt) {
      this.splitDone = true;
      return true;
    }
    return false;
  }
  /** Спец-механики топ-зоны 33 ур. — см. EliteMobDef.sporeCaster/blinker. */
  readonly sporeCaster: boolean;
  readonly blinker: boolean;
  readonly lifesteal: number;
  readonly meleeReach: number;
  readonly atkCooldown: number;
  readonly dodge: number;
  readonly regen: number;
  readonly puller: boolean;
  private pullCd = 3;
  /** 36 ур.: таран / щит отражения / костяные шипы (см. CHARGE, REFLECT, SPIKES). */
  readonly charger: boolean;
  readonly reflector: boolean;
  readonly spiker: boolean;
  readonly healer: boolean;
  readonly freezer: boolean;
  /** Паук: плюётся паутинным сгустком (WEB, корень на попадание). */
  readonly webber: boolean;
  /** Магический удар без белой вспышки над героем (паук). */
  readonly quietMagic: boolean;
  /** 40 ур.: свой физический снаряд (Метатель копий, Шипохвост) — см. ZoneSim.shoot. */
  readonly shot: MobShot | null;
  /** 40 ур. Скалолом: прыжок на героя (LEAP) и ярость стаи (PACK_FRENZY). */
  readonly leaper: boolean;
  /** Перезарядка прыжка (EliteMobDef.leapCooldown; без него — LEAP.cooldown). */
  private readonly leapCooldown: number;
  /** Ходит по земле без скачков (EliteMobDef.walksOnly): плавный ход, без пачек прыжков. */
  readonly walksOnly: boolean;
  readonly packFrenzy: boolean;
  private leapCd = 3;
  private leapWindupT = 0;
  private leapAirT = 0;
  private leapX = 0;
  private leapZ = 0;
  /** Ярость стаи: секунд осталось (пока > 0 — raging). */
  private frenzyT = 0;
  /** 45 ур. — см. EliteMobDef.burrower/stormCaller/cloner. */
  readonly burrower: boolean;
  readonly stormCaller: boolean;
  readonly cloner: boolean;
  /** Теневая стойка (PARRY): >0 — сколько ещё стоять в ней; hitMob отбивает удары. */
  readonly parrier: boolean;
  parryT = 0;
  private parryCd = 3;
  /** Когда (elapsed) этот герой последний раз получил контрудар — не чаще PARRY.counterGap. */
  readonly parryHitAt = new Map<string, number>();
  /** Не двигается вовсе (рейд-босс): только поворот к цели и атаки. */
  readonly anchored: boolean;
  /** Теневая копия ниндзя: id настоящего ("" — не копия). */
  readonly cloneOf: string;
  private burrowCd = 4;
  /** 0 — на земле, 1 — ныряет, 2 — ползёт под землёй, 3 — круг под героем (сейчас вынырнет). */
  private burrowPhase = 0;
  private burrowT = 0;
  private burrowTrailT = 0;
  private burrowTarget: string | null = null;
  private burrowX = 0;
  private burrowZ = 0;
  /** Центр метки телеграфа (под землёй моб кружит у него) и угол круга. */
  private burrowCx = 0;
  private burrowCz = 0;
  private burrowAng = 0;
  private stormCd = 3;
  private stormT = 0;
  private stormX = 0;
  private stormZ = 0;
  /** Сколько порогов CLONES.at уже пройдено (ZoneSim.hitMob). */
  cloneStep = 0;
  /** Под землёй — модель прячется (MobState.under). */
  get underground(): boolean {
    return this.burrowPhase >= 2;
  }
  /** Пугало лагеря (SCARECROW): бессмертное, неподвижное, не бьёт. */
  readonly scarecrow: boolean;
  /** Тренировочное пугало-напарник (по бокам от главного): бессмертное, стоит, но, в отличие от главного, попадает под АОЕ и Пронзание. */
  readonly practice: boolean;
  private healCd = 6;
  /** ZoneSim прочтёт и сбросит: вождь лечит соседей (ему видны все мобы). */
  healReq = false;
  private freezeCd = 4;
  private freezeWindupT = 0;
  private freezeX = 0;
  private webCd = 4;
  private freezeZ = 0;
  private chargeCd = 3;
  private chargeWindupT = 0;
  private chargeFromX = 0;
  private chargeFromZ = 0;
  private chargeToX = 0;
  private chargeToZ = 0;
  private reflectCd = 4;
  /** >0 — щит отражения держится (ZoneSim.hitMob отражает урон). */
  reflectT = 0;
  private spikeCd = 4;
  private spikeWindupT = 0;
  private readonly spikeSpots: { x: number; z: number }[] = [];
  private pullWindupT = 0;
  private pullTarget: string | null = null;
  /** Адаптация Багрового (BOSS_ADAPT): под какой уровень сейчас настроен и множитель его урона. */
  adaptLevel: number = BOSS_ADAPT.baseLevel;
  adaptDmgMul = 1;
  private sporeCd = 2;
  private sporeWindupT = 0;
  private sporeX = 0;
  private sporeZ = 0;
  /** Живые ядовитые облака этого моба (переживают его смерть до истечения). */
  private readonly sporeZones: { x: number; z: number; t: number; tickT: number }[] = [];
  private blinkCd = 2;
  private blinkFadeT = 0;
  private blinkTarget: string | null = null;
  /** Очередь визуальных событий — ZoneRoom забирает каждый тик (drainFx). */
  readonly fx: MobFx[] = [];
  /** Лавовый монстр (LAVA): Страж или Маг — приёмы; у остальных null. */
  readonly lava: LavaSkills | null;
  private novaCd = 0;
  private novaWindupT = 0;
  /** ++ на каждую посадку заклинания — клиент рисует ударную волну. */
  novaSeq = 0;

  /** База эффектов «% от макс. HP цели» (поджог мага): у Пугала — SCARECROW.refHp, а не его 10 млн. */
  /**
   * От какого здоровья считать эффекты «% от HP цели» (поджог мага, кровотечение
   * веера). С потолком PCT_HP_CAP: иначе стражи и боссы катакомб с сотнями тысяч
   * HP таяли от процентов быстрее, чем от ударов.
   */
  get pctHpBase(): number {
    return this.scarecrow || this.practice ? SCARECROW.refHp : Math.min(this.maxHp, PCT_HP_CAP);
  }

  /** Прогресс телеграфа заклинания 0..1 (0 — только начал, 1 — вот-вот ударит). */
  get novaTelegraph(): number {
    if (this.novaWindupT > 0) return 1 - this.novaWindupT / MAGE_NOVA.windup;
    return 0;
  }
  /** Модель из пака для этого моба (ключ MODELS на клиенте). Пусто — стандарт. */
  readonly model: string;
  /** Переопределение имени/уровня в плашке (усиленные мобы). Пусто/0 — по kind. */
  readonly eliteName: string;
  /** Босс (рейд, охота, катакомбы): обычная броня с него не падает — золото и уникальное падают как у элиты. */
  readonly bossFight: boolean;
  /** Множитель шанса колец (жнец ×10); см. ELITE_MOBS.ringMul. */
  readonly ringMul: number;
  /** Множитель радиуса расталкивания толпы (separateMobs); см. ELITE_MOBS.sepMul. */
  readonly sepMul: number;
  readonly eliteLevel: number;
  /** Опыт за убийство — фиксированный (EliteMobDef.xpFixed): поле xp, а не кривая по уровню. */
  readonly xpFixed: boolean;
  readonly campType: string;
  readonly champ: boolean;
  private readonly respawnSec: number;
  /** true — моб парит и не прыгает (пчела). */
  readonly flying: boolean;
  /** Подъём хитбокса над корнем, м (см. MobDef.visLift). */
  readonly liftM: number;
  /** Удар вблизи — магия (EliteMobDef.magicMelee). */
  readonly magicMelee: boolean;
  /** Каждый N-й удар вблизи физический (EliteMobDef.physEvery). */
  readonly physEvery: number;
  private strikeN = 0;
  private strikePhys = false;
  /** Фаза покачивания в полёте (жужжание). */
  private flyBob = Math.random() * 6.28;

  /** Расстояние между центрами моба и героя при касании тел (как в столкновениях tick). */
  private contactDist(): number {
    return PLAYER.radius + MOB.bodyRadius * this.scale * (this.kind === "boss" ? BOSS.bodyMult : 1);
  }

  /**
   * Дальность ближнего удара по центру моба. Не короче касания тел: у крупного тела (голем, кактороо)
   * meleeReach меньше контакта, и кольцо кружения у контакта было бы дальше удара — моб кружил и не бил.
   */
  private hitReach(): number {
    return Math.max(this.meleeReach, this.contactDist() + 0.1);
  }

  /**
   * Кольцо кружения дальника у героя (непрерывный ход): 0.7 удара, но не ближе контакта тел;
   * удар (meleeReach) должен достать. Крупное тело (контакт дальше удара) — кольцо у контакта.
   */
  private combatRing(): number {
    const contact = this.contactDist();
    return Math.max(contact + 0.02, Math.min(this.meleeReach * 0.7, this.meleeReach - 0.05));
  }

  /**
   * Моб сейчас в телеграфе умения (споры, шаг призрака, щупальце, рывок, заморозка, гроза). Якорные
   * (рейд-босс и его копии) в это время не бьют вблизи и не стреляют — их поведение сохранено как есть.
   */
  private get castingNow(): boolean {
    return this.sporeWindupT > 0 || this.blinkFadeT > 0 || this.pullWindupT > 0 || this.chargeWindupT > 0 || this.freezeWindupT > 0 || this.leapWindupT > 0 || this.stormT > 0;
  }

  /**
   * Кружить вокруг цели (непрерывный ход дальника): тангенс в сторону retreatSide плюс поправка
   * к дистанции ring (±band). Никогда не ноль — моб в бою не стоит.
   */
  private orbitDir(dx: number, dz: number, dist: number, ring: number, band: number): [number, number] {
    const rad = Math.max(-1, Math.min(1, (dist - ring) / band));
    const x = dx * rad - dz * this.retreatSide;
    const z = dz * rad + dx * this.retreatSide;
    const l = Math.hypot(x, z) || 1;
    return [x / l, z / l];
  }

  /** Ход дальника в бою: далеко — прямо к цели, у кольца — кружить. */
  private combatDir(dx: number, dz: number, dist: number, ring: number, band: number): [number, number] {
    if (dist > ring + 2 * band) return [dx, dz];
    return this.orbitDir(dx, dz, dist, ring, band);
  }

  /**
   * Дистанция, с которой ближний моб стоит у героя: внутри дальности удара (hitReach), чтобы бить с места.
   * Не кольцо кружения: зазор кольца мог выйти за удар, и моб стоял бы и не бил.
   */
  private standDist(): number {
    return this.hitReach() - 0.05;
  }

  /** Ближний моб (не дальник и не босс) у героя на дистанции удара: стоит и бьёт, не кружит. */
  private standsAtHero(dist: number): boolean {
    return !this.ranged && this.kind !== "boss" && dist <= this.standDist();
  }

  /** Ход ближнего к герою: идёт, пока не дойдёт до stop, дальше стоит. */
  private meleeStep(dx: number, dz: number, dist: number, stop: number): [number, number] {
    return dist <= stop ? [0, 0] : [dx, dz];
  }

  /**
   * Бродит у дома; если погоня увела далеко — домой. Без пауз: у точки сразу выбирает новую.
   * Выставляет returningHome.
   */
  private wanderDir(wr: number): [number, number] {
    const homeDist = Math.hypot(this.x - this.homeX, this.z - this.homeZ);
    this.returningHome = homeDist > wr;
    let wdx: number;
    let wdz: number;
    if (this.returningHome) {
      wdx = this.homeX - this.x;
      wdz = this.homeZ - this.z;
    } else {
      wdx = this.wanderX - this.x;
      wdz = this.wanderZ - this.z;
      if (Math.hypot(wdx, wdz) < 1.5) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * wr;
        this.wanderX = this.homeX + Math.cos(a) * r;
        this.wanderZ = this.homeZ + Math.sin(a) * r;
        wdx = this.wanderX - this.x;
        wdz = this.wanderZ - this.z;
      }
    }
    const wl = Math.hypot(wdx, wdz) || 1;
    return [wdx / wl, wdz / wl];
  }

  /**
   * Куда идёт ходок без скачков (walksOnly). В погоне — к герою и стоит на дистанции удара (бьёт с места).
   * Прыгун, ждущий готовности LEAP, стоит на дистанции прыжка. Без погони — бродит без пауз.
   */
  private walkDir(chasing: boolean, dist: number, dx: number, dz: number): [number, number] {
    if (this.giantCastT > 0 || this.lava?.casting) return [0, 0]; // Ледяной гигант доигрывает умение; лавовый приём — стоит
    if (chasing) {
      // Стрелок (webber): встаёт на дистанции выстрела и плюётся сгустками; подошёл герой вплотную — бьёт вблизи.
      if (this.ranged) {
        if (dist <= this.standDist() + 0.5) return this.meleeStep(dx, dz, dist, this.standDist());
        return this.meleeStep(dx, dz, dist, WEB.range * 0.8);
      }
      // Прыгун перед прыжком стоит на дистанции LEAP (дальше minDist, ближе maxDist), иначе прыжка не будет:
      // дальше — подходит, ближе minDist+1 — идёт к удару (не пятится).
      if (this.leaper && this.leapCd < 1.5 && dist >= LEAP.minDist + 1) {
        // Жнец не пятится: ближе минимальной дистанции прыжка он не отходит, а подходит к удару (см. ниже),
        // прыжок ждёт, пока герой сам отойдёт дальше minDist.
        return this.meleeStep(dx, dz, dist, LEAP_WAIT_RING + 2.5);
      }
      return this.meleeStep(dx, dz, dist, this.standDist());
    }
    return this.wanderDir(MOB.wanderRadius);
  }

  /** Замах: ++ attackSeq (клиент проигрывает клип) и вид удара; без вида — укус. */
  swing(kind = 0): void {
    this.attackKind = kind;
    this.attackSeq = (this.attackSeq + 1) & 0xffff;
  }

  /** Умение босса из комнаты (дракон катакомб, server/rooms/dragonFight.ts): стоит лицом к yaw sec с, когтями не бьёт. */
  castLock(yaw: number, sec: number): void {
    this.giantCastT = Math.max(this.giantCastT, sec);
    this.giantYaw = yaw;
  }

  /** Ледяной гигант доигрывает клип умения: стоит на месте и когтями не бьёт. */
  get giantCasting(): boolean {
    return this.giantCastT > 0;
  }

  /** Сорвать замах умения гиганта (оглушили, ярость). Летящая глыба и бегущий разлом — уже не остановить. */
  private cancelGiantCast(): void {
    this.giantSlamT = 0;
    this.giantThrowT = 0;
    this.giantFissureT = 0;
    this.giantCastT = 0;
  }

  /**
   * Ледяной гигант (ICE_GIANT): аура «Стужа», «Ледяная ярость», умения — раскол (толпа вокруг), глыба и разлом
   * (по дальним). Умения не накладываются: пока доигрывается клип одного, гигант стоит и когтями не бьёт.
   */
  private tickGiant(
    dt: number, players: SimPlayer[], hits: PlayerHit[], chasing: boolean, np: SimPlayer | null, busy: boolean,
  ): void {
    const G = ICE_GIANT;
    const base = MOB.attackDamage * this.dmgMul;
    const cdK = this.giantFury ? G.fury.cdMul : 1;
    const cdRnd = (): number => cdK * (0.85 + Math.random() * 0.3);
    // «Ледяная ярость»: на пороге HP ревёт (стоит) — дальше аура шире и умения чаще.
    if (!this.giantFury && this.hp / this.maxHp < G.fury.at) {
      this.giantFury = true;
      this.cancelGiantCast();
      this.giantCastT = G.fury.roarSec;
      this.giantYaw = this.yaw;
      this.swing(MOB_SWING.roar);
      this.fx.push({ k: "giantFury", x: this.x, z: this.z, d: G.fury.roarSec });
    }
    // «Стужа»: в бою раз в tick — замедление всем в радиусе (урона нет).
    this.giantAuraT -= dt;
    if (this.giantAuraT <= 0) {
      this.giantAuraT += G.aura.tick;
      if (this.aggroed) {
        const r = G.aura.radius * (this.giantFury ? G.fury.auraMul : 1);
        for (const p of players) {
          if (Math.hypot(p.x - this.x, p.z - this.z) > r) continue;
          hits.push({
            target: p.sessionId, dmg: 0, fromX: this.x, fromZ: this.z, projectile: false, byMob: this.id,
            dot: true, slowSec: G.aura.slowSec, slowFrac: G.aura.slowFrac,
          });
        }
      }
    }
    if (this.giantSlamCd > 0) this.giantSlamCd -= dt;
    if (this.giantThrowCd > 0) this.giantThrowCd -= dt;
    if (this.giantFissureCd > 0) this.giantFissureCd -= dt;
    if (this.giantGapT > 0) this.giantGapT -= dt;
    if (this.giantCastT > 0) this.giantCastT -= dt;
    // Оглушили посреди замаха — умение сорвано (контрплей воину).
    if (busy && (this.giantSlamT > 0 || this.giantThrowT > 0 || this.giantFissureT > 0)) this.cancelGiantCast();

    // «Ледяной раскол»: двумя руками оземь — удар по кругу вокруг себя, отброс, 2 стака.
    if (this.giantSlamT > 0) {
      this.giantSlamT -= dt;
      if (this.giantSlamT <= 0) {
        this.fx.push({ k: "giantSlamHit", x: this.x, z: this.z, r: G.slam.radius });
        for (const p of players) {
          if (Math.hypot(p.x - this.x, p.z - this.z) > G.slam.radius) continue;
          hits.push({
            target: p.sessionId, dmg: base * G.slam.dmgMul, fromX: this.x, fromZ: this.z, projectile: false, byMob: this.id,
            knockback: G.slam.knockback, frost: G.slam.stacks,
          });
        }
      }
    }
    // «Ледяная глыба»: замах → бросок (глыба летит flight с) → удар по кругу и наледь на земле.
    if (this.giantThrowT > 0) {
      this.giantThrowT -= dt;
      if (this.giantThrowT <= 0) {
        this.giantFlyT = G.throw.flight;
        this.fx.push({ k: "giantThrowFly", x: this.giantThrowX, z: this.giantThrowZ, x2: this.x, z2: this.z, d: G.throw.flight });
      }
    } else if (this.giantFlyT > 0) {
      this.giantFlyT -= dt;
      if (this.giantFlyT <= 0) {
        const tx = this.giantThrowX;
        const tz = this.giantThrowZ;
        this.fx.push({ k: "giantThrowHit", x: tx, z: tz, r: G.throw.patchR, d: G.throw.patchSec });
        this.icePatches.push({ x: tx, z: tz, t: G.throw.patchSec, tickT: 0.3 });
        for (const p of players) {
          if (Math.hypot(p.x - tx, p.z - tz) > G.throw.radius) continue;
          hits.push({
            target: p.sessionId, dmg: base * G.throw.dmgMul, fromX: tx, fromZ: tz, projectile: false, phys: true, byMob: this.id,
            frost: G.throw.stacks,
          });
        }
      }
    }
    // «Ледяной разлом»: замах → гряда шипов бежит по прямой со скоростью speed; задевает каждого раз.
    if (this.giantFissureT > 0) {
      this.giantFissureT -= dt;
      if (this.giantFissureT <= 0) {
        this.giantFisRun = 0;
        this.giantFisHit.clear();
        this.fx.push({
          k: "giantFissureGo", x: this.giantFisX, z: this.giantFisZ,
          x2: this.giantFisX + this.giantFisDx * G.fissure.len, z2: this.giantFisZ + this.giantFisDz * G.fissure.len,
          d: G.fissure.len / G.fissure.speed, r: G.fissure.halfWidth,
        });
      }
    }
    if (this.giantFisRun >= 0) {
      const from = this.giantFisRun;
      this.giantFisRun = Math.min(G.fissure.len, from + G.fissure.speed * dt);
      for (const p of players) {
        if (this.giantFisHit.has(p.sessionId)) continue;
        const rx = p.x - this.giantFisX;
        const rz = p.z - this.giantFisZ;
        const along = rx * this.giantFisDx + rz * this.giantFisDz;
        if (along < from - 0.6 || along > this.giantFisRun) continue;
        if (Math.abs(rx * this.giantFisDz - rz * this.giantFisDx) > G.fissure.halfWidth + PLAYER.radius) continue;
        this.giantFisHit.add(p.sessionId);
        hits.push({
          target: p.sessionId, dmg: base * G.fissure.dmgMul, fromX: p.x - this.giantFisDx, fromZ: p.z - this.giantFisDz,
          projectile: false, byMob: this.id, stunSec: G.fissure.stunSec, frost: G.fissure.stacks,
        });
      }
      if (this.giantFisRun >= G.fissure.len) this.giantFisRun = -1;
    }

    // Новое умение: только в погоне, не оглушён, клип прошлого доигран и выдержана пауза.
    if (!chasing || !np || busy || this.giantCastT > 0 || this.giantGapT > 0) return;
    let near = 0;
    let far: SimPlayer | null = null;
    let farD = 0;
    for (const p of players) {
      const d = Math.hypot(p.x - this.x, p.z - this.z);
      if (d < G.slam.radius * 0.8) near++;
      if (d > farD && d <= G.throw.maxDist) {
        farD = d;
        far = p;
      }
    }
    const start = (kind: number, clip: number, yaw: number): void => {
      this.giantCastT = clip - 0.25;
      this.giantGapT = G.gap + clip;
      this.giantYaw = yaw;
      this.swing(kind);
    };
    if (this.giantSlamCd <= 0 && near >= (this.giantFury ? 1 : G.slam.minHeroes)) {
      this.giantSlamT = G.slam.windup;
      this.giantSlamCd = G.slam.cooldown * cdRnd();
      start(MOB_SWING.slam, G.clipSec.slam, this.yaw);
      this.fx.push({ k: "giantSlam", x: this.x, z: this.z, r: G.slam.radius, d: G.slam.windup });
      return;
    }
    if (!far || farD < 1e-3) return;
    const fx = (far.x - this.x) / farD;
    const fz = (far.z - this.z) / farD;
    if (this.giantThrowCd <= 0 && farD >= G.throw.minDist) {
      this.giantThrowT = G.throw.windup;
      this.giantThrowCd = G.throw.cooldown * cdRnd();
      this.giantThrowX = far.x;
      this.giantThrowZ = far.z;
      start(MOB_SWING.throw, G.clipSec.throw, Math.atan2(fx, fz));
      this.fx.push({ k: "giantThrowMark", x: far.x, z: far.z, r: G.throw.radius, d: G.throw.windup + G.throw.flight });
      return;
    }
    if (this.giantFissureCd <= 0 && farD >= G.fissure.minDist && farD <= G.fissure.maxDist) {
      const off = MOB.bodyRadius * this.scale * 0.6;
      this.giantFisDx = fx;
      this.giantFisDz = fz;
      this.giantFisX = this.x + fx * off;
      this.giantFisZ = this.z + fz * off;
      this.giantFissureT = G.fissure.windup;
      this.giantFissureCd = G.fissure.cooldown * cdRnd();
      start(MOB_SWING.fissure, G.clipSec.fissure, Math.atan2(fx, fz));
      this.fx.push({
        k: "giantFissure", x: this.giantFisX, z: this.giantFisZ,
        x2: this.giantFisX + fx * G.fissure.len, z2: this.giantFisZ + fz * G.fissure.len, d: G.fissure.windup, r: G.fissure.halfWidth,
      });
    }
  }

  constructor(
    readonly kind: MobKind,
    hx: number,
    hz: number,
    /** Усиленный моб лагеря — множители и вид поверх базового моба этого kind. */
    opts: {
      model?: string;
      name?: string;
      boss?: boolean;
      level?: number;
      hp?: number;
      dmgMul?: number;
      xp?: number;
      /** Опыт за убийство фиксированный (поле xp): см. EliteMobDef.xpFixed. */
      xpFixed?: boolean;
      /** Лом за убийство (по умолчанию 1; ледяной гигант — 100 в подземелье, 5 в нашествии). */
      scrap?: number;
      /** Лом делится поровну между всеми, кто бил моба (а не только добившему). */
      scrapShared?: boolean;
      scaleMul?: number;
      flying?: boolean;
      visLift?: number;
      magicMelee?: boolean;
      physEvery?: number;
      rangedArmor?: number;
      physArmor?: number;
      magicArmor?: number;
      magicVulnMul?: number;
      critVulnMul?: number;
      spellAoe?: boolean;
      novaCaster?: boolean;
      enrageAt?: number;
      splitAt?: number;
      splitCount?: number;
      splitScaleMul?: number;
      splitHpFrac?: number;
      splitDmgMul?: number;
      splitSpeedMul?: number;
      splitXp?: number;
      splitChildXp?: number;
      splitReviveSec?: number;
      /** Множитель скорости движения — 1 обычно, у осколков голема выше. */
      speedMul?: number;
      sporeCaster?: boolean;
      blinker?: boolean;
      lifesteal?: number;
      meleeReach?: number;
      attackCooldown?: number;
      dodge?: number;
      regen?: number;
      puller?: boolean;
      charger?: boolean;
      reflector?: boolean;
      spiker?: boolean;
      healer?: boolean;
      freezer?: boolean;
      webber?: boolean;
      quietMagic?: boolean;
      shot?: MobShot;
      leaper?: boolean;
      leapCooldown?: number;
      ringMul?: number;
      sepMul?: number;
      walksOnly?: boolean;
      packFrenzy?: boolean;
      burrower?: boolean;
      stormCaller?: boolean;
      cloner?: boolean;
      parry?: boolean;
      anchored?: boolean;
      /** Теневая копия ниндзя: id настоящего (погиб он — копия рассеивается). */
      cloneOf?: string;
      scarecrow?: boolean;
      practice?: boolean;
      /** Ключ ELITE_MOBS лагеря, откуда моб (для заданий доски). */
      campType?: string;
      /** Вожак лагеря (задание «Вожак»): сильнее, крупнее, реже возрождается. */
      champ?: boolean;
      respawnSec?: number;
      iceGiant?: boolean;
      /** Лавовый монстр: роль (Страж — удар о землю и ярость, Маг — метки и кольцо). */
      lavaRole?: "guard" | "mage";
      strikeDelay?: number;
    } = {},
  ) {
    this.iceGiant = opts.iceGiant ?? false;
    this.lava = opts.lavaRole ? new LavaSkills(opts.lavaRole) : null;
    this.strikeDelay = opts.strikeDelay ?? MOB.strikeDelay;
    this.campType = opts.campType ?? "";
    this.champ = opts.champ ?? false;
    this.respawnSec = opts.respawnSec ?? MOB.respawn;
    this.model = opts.model ?? "";
    this.eliteName = opts.name ?? "";
    this.bossFight = opts.boss ?? false;
    this.ringMul = opts.ringMul ?? 1;
    this.sepMul = opts.sepMul ?? 1;
    this.eliteLevel = opts.level ?? 0;
    this.xpFixed = opts.xpFixed ?? false;
    this.flying = opts.flying ?? false;
    this.magicMelee = opts.magicMelee ?? false;
    this.physEvery = opts.physEvery ?? 0;
    this.homeX = hx;
    this.homeZ = hz;
    this.x = hx;
    this.z = hz;
    this.wanderX = hx;
    this.wanderZ = hz;
    this.y = terrainHeight(hx, hz);
    const cfg =
      kind === "spitter"
        ? SPITTER_CFG
        : kind === "boss"
          ? BOSS_CFG
          : kind === "shard"
            ? SHARD_CFG
            : SLIME_CFG;
    this.hp = opts.hp ?? cfg.hp;
    this.maxHp = this.hp;
    this.ranged = cfg.ranged;
    this.xp = opts.xp ?? cfg.xp;
    this.dmgMul = opts.dmgMul ?? 1;
    this.rangedArmor = Math.max(0, Math.min(0.95, opts.rangedArmor ?? 0));
    this.physArmor = Math.max(0, Math.min(0.95, opts.physArmor ?? 0));
    this.magicArmor = Math.max(0, Math.min(0.95, opts.magicArmor ?? 0));
    this.magicVulnMul = Math.max(0, opts.magicVulnMul ?? 1);
    this.critVulnMul = Math.max(0, opts.critVulnMul ?? 1);
    this.spellAoe = opts.spellAoe ?? false;
    this.novaCaster = opts.novaCaster ?? false;
    this.enrageAt = opts.enrageAt;
    this.splitAt = opts.splitAt;
    this.splitCount = opts.splitCount ?? 0;
    this.splitScaleMul = opts.splitScaleMul ?? 0.5;
    this.splitHpFrac = opts.splitHpFrac ?? 0.15;
    this.splitDmgMul = opts.splitDmgMul ?? 0.5;
    this.splitSpeedMul = opts.splitSpeedMul ?? 1;
    this.splitXp = opts.splitXp ?? 0;
    this.splitChildXp = opts.splitChildXp ?? 0;
    this.splitReviveSec = opts.splitReviveSec ?? MOB.respawn;
    this.speedMul = opts.speedMul ?? 1;
    this.sporeCaster = opts.sporeCaster ?? false;
    this.blinker = opts.blinker ?? false;
    this.lifesteal = opts.lifesteal ?? 0;
    this.meleeReach = opts.meleeReach ?? MOB.attackRange;
    this.atkCooldown = opts.attackCooldown ?? MOB.attackCooldown;
    this.dodge = opts.dodge ?? 0;
    this.regen = opts.regen ?? 0;
    this.scrapN = opts.scrap ?? 1;
    this.scrapShared = opts.scrapShared ?? false;
    this.puller = opts.puller ?? false;
    this.charger = opts.charger ?? false;
    this.reflector = opts.reflector ?? false;
    this.spiker = opts.spiker ?? false;
    this.healer = opts.healer ?? false;
    this.freezer = opts.freezer ?? false;
    this.webber = opts.webber ?? false;
    this.quietMagic = opts.quietMagic ?? false;
    // Плюющийся паук держит дистанцию (как плевун) и в ближний бой не лезет.
    if (this.webber) this.ranged = true;
    this.shot = opts.shot ?? null;
    this.leaper = opts.leaper ?? false;
    this.leapCooldown = opts.leapCooldown ?? LEAP.cooldown;
    this.walksOnly = opts.walksOnly ?? false;
    this.packFrenzy = opts.packFrenzy ?? false;
    this.burrower = opts.burrower ?? false;
    this.stormCaller = opts.stormCaller ?? false;
    this.cloner = opts.cloner ?? false;
    this.parrier = opts.parry ?? false;
    this.anchored = opts.anchored ?? false;
    this.cloneOf = opts.cloneOf ?? "";
    this.scarecrow = opts.scarecrow ?? false;
    this.practice = opts.practice ?? false;
    const base = kind === "boss" ? BOSS.scale : kind === "shard" ? SHARD.scale : 1;
    this.scale = base * (opts.scaleMul ?? 1);
    this.liftM = (opts.visLift ?? 0) * MOB.bodyRadius * 2 * this.scale;
  }

  get aggro(): boolean {
    return this.aggroed;
  }

  /** Ярость стаи (Скалолом): сородич погиб рядом — быстрее и больнее на `sec` секунд. */
  frenzy(sec: number): void {
    if (this.dead || !this.packFrenzy) return;
    this.frenzyT = Math.max(this.frenzyT, sec);
    this.raging = true;
  }

  /** Промах тоже злит моба (иначе увернувшийся «не замечал» стрелка). */
  forceAggroIfIdle(): void {
    this.aggroed = true;
    this.outOfRange = 0;
  }

  forceAggro(): void {
    this.aggroed = true;
    this.outOfRange = 0;
    this.y = terrainHeight(this.x, this.z) + 1.5;
    this.grounded = false;
  }

  /** true — моб убит этим ударом. */
  /** Секунд, пока моб пригвождён к земле (град стрел) — не может двигаться. */
  private rootedT = 0;
  get rooted(): boolean {
    return this.rootedT > 0;
  }

  /** Пригвоздить к земле на `sec` секунд: моб стоит, но бить не перестаёт. */
  root(sec: number): void {
    if (this.dead || this.kind === "boss") return; // босса не пришпилить
    this.rootedT = Math.max(this.rootedT, sec);
  }

  /** Секунд оглушения — моб не двигается И не атакует (оглушающий удар воина). */
  private stunnedT = 0;
  get stunned(): boolean {
    return this.stunnedT > 0;
  }
  /** Оглушить на `sec` секунд. Босс — иммунен (стан-локать нельзя). */
  stun(sec: number): void {
    if (this.dead || this.kind === "boss") return;
    this.stunnedT = Math.max(this.stunnedT, sec);
  }

  /**
   * Угроза: сколько урона каждый герой нанёс мобу за последние ~30 с (затухает). Моб переключается на того,
   * кто бьёт больше всех; агр от умений (taunt) — главнее, его не трогаем.
   */
  readonly threat = new Map<string, number>();
  addThreat(by: string, dmg: number): void {
    if (this.dead || dmg <= 0) return;
    this.threat.set(by, (this.threat.get(by) ?? 0) + dmg);
  }
  /** «Боевой клич»: кого моб обязан атаковать и сколько ещё секунд. */
  private tauntId = "";
  private tauntT = 0;
  taunt(id: string, sec: number): void {
    if (this.dead) return;
    this.tauntId = id;
    this.tauntT = sec;
    this.aggroed = true;
  }
  /** «Метка»: секунд осталось, множитель входящего урона и кто поставил. */
  markT = 0;
  markMul = 1;
  markBy = "";
  /** «Уязвимость» (молот): секунд осталось и множитель урона от молота. */
  vulnT = 0;
  vulnMul = 1;
  vuln(sec: number, mul: number): void {
    if (this.dead) return;
    this.vulnT = sec;
    this.vulnMul = mul;
  }
  mark(by: string, sec: number, mul: number): void {
    if (this.dead) return;
    this.markT = sec;
    this.markMul = mul;
    this.markBy = by;
  }

  /**
   * «Обморожение» от холодного ролла оружия — те же правила, что у Ледяного гиганта (ICE_GIANT.frost): каждый стак —
   * ещё perStack замедления, живёт stackSec с после последнего; на maxStacks — «Ледяная глыба»: моб вмерзает на
   * freezeSec (стан), потом immuneSec стаки не копятся. Боссы не вмерзают — стаки держатся на maxStacks−1.
   */
  private frostN = 0;
  private frostT = 0;
  private frostImmuneT = 0;
  chill(): { k: "stack" | "encase"; n: number } | null {
    if (this.dead || this.frostImmuneT > 0) return null;
    const F = ICE_GIANT.frost;
    if (this.frostT <= 0) this.frostN = 0;
    if (this.frostN + 1 >= F.maxStacks && this.kind !== "boss") {
      this.frostN = 0;
      this.frostT = 0;
      this.frostImmuneT = F.freezeSec + F.immuneSec;
      this.stun(F.freezeSec);
      return { k: "encase", n: F.maxStacks };
    }
    this.frostN = Math.min(F.maxStacks - 1, this.frostN + 1);
    this.frostT = F.stackSec;
    this.slow(F.stackSec, 1 - F.perStack * this.frostN);
    return { k: "stack", n: this.frostN };
  }
  /** Стаки «Обморожения» тают, если по мобу давно не били холодом; после глыбы — пауза. */
  tickFrost(dt: number): void {
    if (this.frostT > 0) {
      this.frostT -= dt;
      if (this.frostT <= 0) this.frostN = 0;
    }
    if (this.frostImmuneT > 0) this.frostImmuneT -= dt;
  }

  /** Замедление («Печать»): секунд осталось и доля скорости/темпа атак (0.6 — на 40% медленнее). */
  private slowT = 0;
  private slowMul = 1;
  slow(sec: number, mul: number): void {
    if (this.dead) return;
    this.slowT = Math.max(this.slowT, sec);
    this.slowMul = Math.min(this.slowT > 0 && this.slowMul < 1 ? this.slowMul : 1, mul);
  }
  /** Замедлен сейчас (для «По оглушённым» колец). */
  get slowed(): boolean {
    return this.slowT > 0 && this.slowMul < 1;
  }
  /** Текущий множитель скорости от замедления (1 — нет). */
  private get slowK(): number {
    return this.slowT > 0 ? this.slowMul : 1;
  }

  /**
   * Два яда, стаки не складываются: «Чумной клинок» (фиолетовый) и яд аффикса «Ядовитое жало» (зелёный, крафт).
   * У каждого — свои стаки, урон за стак, взрыв при максимуме и перезарядка взрыва.
   */
  plague: PoisonCh = newPoison();
  venom: PoisonCh = newPoison();
  /** Кровотечение (веер ножей): урон в секунду, сколько ещё, чей; накопитель для красного числа. */
  bleedDps = 0;
  bleedT = 0;
  bleedBy = "";
  bleedShown = 0;
  bleedShowT = 0;

  /** Горение от Пламенного меча: DoT `dps` на `sec` секунд, опыт — тому, кто поджёг. */
  burningT = 0;
  burnDps = 0;
  burnBy = "";
  ignite(dps: number, sec: number, by: string): void {
    if (this.dead || this.kind === "boss" || this.kind === "shard") return;
    this.burningT = Math.max(this.burningT, sec);
    this.burnDps = Math.max(this.burnDps, dps);
    this.burnBy = by;
  }

  /** Стягивание (воин): моб за sec с идёт в точку (x,z) — ход задаёт сам, без толчков; босса не тянет. */
  pullT = 0;
  pullX = 0;
  pullZ = 0;
  pullTo(x: number, z: number, sec: number): void {
    if (this.dead || this.kind === "boss" || this.iceGiant || this.scarecrow || this.practice) return; // гиганта тоже не тянуть
    this.pullX = x;
    this.pullZ = z;
    this.pullT = sec;
  }

  /** Отбросить моба: сильный импульс от источника (рассекающий удар и т.п.). */
  shove(dx: number, dz: number, power: number): void {
    if (this.dead || this.kind === "boss" || this.iceGiant || this.scarecrow || this.practice) return; // босса, гиганта и пугало с места не сдвинуть
    this.vx += dx * power;
    this.vz += dz * power;
    this.vy += power * 0.35;
    this.grounded = false;
  }

  applyHit(dmg: number, dx: number, dz: number, dot = false): boolean {
    if (this.dead) return false;
    // Урон проходит ВСЕГДА. Окно 0.2 с — только для вздрагивания (анимация/звук
    // на клиенте): раньше удар в это окно пропадал целиком — чужие удары, сплэш,
    // волна молота, умения (лаборатория баланса: в группе терялось до 80% ударов).
    // Темп ударов игрока сервер и так ограничивает (WEAPON_RATE в tryHit).
    const flinch = !dot && this.hurtCd <= 0;
    if (flinch) this.hurtCd = 0.2;
    const before = this.hp / this.maxHp;
    this.hp -= dmg;
    this.aggroed = true;
    this.outOfRange = 0;
    // Босс пересёк порог доли HP — пора выбросить осколки.
    if (this.kind === "boss") {
      const after = this.hp / this.maxHp;
      while (this.splitsDone < BOSS.splitAt.length && after <= BOSS.splitAt[this.splitsDone]) {
        this.splitsDone++;
        if (before > BOSS.splitAt[this.splitsDone - 1]) this.pendingSplit = true;
      }
    }
    // Обычный удар НЕ толкает моба — ни воин, ни кто-либо. Отбрасывание есть
    // только у замах-скиллов через shove(). Направление удара запоминаем для
    // вздрагивания на клиенте. У DoT вздрагивания/звука нет — только урон.
    if (flinch) {
      this.hurtSeq = (this.hurtSeq + 1) & 0xffff;
      this.hurtDx = dx;
      this.hurtDz = dz;
    }
    if (this.hp <= 0 && (this.scarecrow || this.practice)) this.hp = this.maxHp; // пугало не умирает
    if (this.hp <= 0) {
      this.dead = true;
      this.deadT = 0;
      this.slamWindupT = 0;
      this.lungeWindupT = 0;
      this.lungeT = 0;
      this.burningT = 0;
      this.burnDps = 0;
      this.plague.stacks = 0;
      this.plague.t = 0;
      this.venom.stacks = 0;
      this.venom.t = 0;
      this.bleedT = 0;
      this.raging = false;
      this.respawnIn = this.kind === "boss" ? BOSS.respawn : this.respawnSec;
      return true;
    }
    return false;
  }

  tick(
    dt: number,
    players: SimPlayer[],
    hits: PlayerHit[],
    spit: (mob: Mob, target: SimPlayer, web?: boolean) => void,
  ): void {
    if (this.hurtCd > 0) this.hurtCd -= dt;
    // Пугало: стоит столбом, не бьёт, здоровье всегда полное (урон считает ZoneSim.scare).
    if (this.scarecrow || this.practice) {
      this.vx = this.vy = this.vz = 0;
      this.x = this.homeX;
      this.z = this.homeZ;
      this.y = terrainHeight(this.x, this.z);
      this.grounded = true;
      this.hp = this.maxHp;
      this.stunnedT = this.rootedT = 0;
      // Метка (+урон от всех) и замедление спадают и на пугале — раньше тик выходил раньше их отсчёта,
      // и метка лучника висела на пугале вечно (его табло показывало на треть больше соседей).
      if (this.markT > 0) {
        this.markT -= dt;
        if (this.markT <= 0) this.markMul = 1;
      }
      if (this.vulnT > 0) {
        this.vulnT -= dt;
        if (this.vulnT <= 0) this.vulnMul = 1;
      }
      if (this.slowT > 0) {
        this.slowT -= dt;
        if (this.slowT <= 0) this.slowMul = 1;
      }
      this.tickFrost(dt);
      return;
    }
    // Где моб стоял до своего шага в этом тике — чтобы герой не толкал моба (см. «не проходит сквозь игроков»).
    const x0 = this.x;
    const z0 = this.z;
    if (this.tauntT > 0) this.tauntT -= dt;
    if (this.markT > 0) {
      this.markT -= dt;
      if (this.markT <= 0) this.markMul = 1;
    }
    if (this.vulnT > 0) {
      this.vulnT -= dt;
      if (this.vulnT <= 0) this.vulnMul = 1;
    }
    if (this.slowT > 0) {
      this.slowT -= dt;
      if (this.slowT <= 0) this.slowMul = 1;
    }
    this.tickFrost(dt);
    // Замедленный моб и бьёт реже.
    if (this.attackCd > 0) this.attackCd -= dt * this.slowK;
    // Ядовитые облака живут своей жизнью — и после смерти колосса тоже.
    for (let i = this.sporeZones.length - 1; i >= 0; i--) {
      const zn = this.sporeZones[i];
      zn.t -= dt;
      zn.tickT -= dt;
      if (zn.tickT <= 0) {
        zn.tickT += SPORE.tick;
        for (const p of players) {
          if (Math.hypot(p.x - zn.x, p.z - zn.z) > SPORE.radius) continue;
          hits.push({
            target: p.sessionId,
            dmg: SPORE.tickDmg,
            fromX: zn.x,
            fromZ: zn.z,
            projectile: false,
            byMob: this.id,
            dot: true,
            magic: true, // споры — магия: броня от силы не гасит, режет интеллект
          });
        }
      }
      if (zn.t <= 0) this.sporeZones.splice(i, 1);
    }
    // Наледь Ледяного гиганта: стоишь на ней — бег медленнее (урона нет); живёт и после его смерти.
    for (let i = this.icePatches.length - 1; i >= 0; i--) {
      const ip = this.icePatches[i];
      ip.t -= dt;
      ip.tickT -= dt;
      if (ip.tickT <= 0) {
        ip.tickT += 0.5;
        for (const p of players) {
          if (Math.hypot(p.x - ip.x, p.z - ip.z) > ICE_GIANT.throw.patchR) continue;
          hits.push({
            target: p.sessionId, dmg: 0, fromX: ip.x, fromZ: ip.z, projectile: false, byMob: this.id, dot: true,
            slowSec: 0.7, slowFrac: ICE_GIANT.throw.patchSlow,
          });
        }
      }
      if (ip.t <= 0) this.icePatches.splice(i, 1);
    }
    if (this.stunnedT > 0) this.stunnedT = Math.max(0, this.stunnedT - dt);
    // Плевун: отход выдыхается, потом пауза, в которую его можно догнать.
    if (this.restT > 0) {
      this.restT -= dt;
      if (this.restT <= 0) this.retreatSide = Math.random() < 0.5 ? 1 : -1;
    } else if (this.retreatT > 0) {
      // Копится только пока он реально пятится (см. ниже), само по себе тает.
      this.retreatT -= dt * 0.35;
      if (this.retreatT < 0) this.retreatT = 0;
    }

    if (this.regen > 0 && !this.dead && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * this.regen * dt);
    }
    // Угроза затухает (половина за 30 с): старый урон перестаёт определять цель.
    if (this.threat.size) {
      const k = Math.pow(0.5, dt / 30);
      for (const [id, v] of this.threat) {
        const nv = v * k;
        if (nv < 1) this.threat.delete(id);
        else this.threat.set(id, nv);
      }
    }
    if (this.dead) {
      this.deadT += dt;
      this.y -= dt * 0.6;
      this.respawnIn -= dt;
      if (this.respawnIn <= 0) this.respawn();
      return;
    }

    // ближайший игрок. Босс не гонится за теми, кто ушёл далеко от его угла
    // (иначе рейд-боты, погибнув и возродившись на спавне, утаскивали его
    // через всю карту).
    // Пока агрит — тянется за игроком далеко (chaseLeash), может выйти из угла.
    // Вне боя круг маленький: не уходит на поляну сам.
    const bossLeash =
      this.kind === "boss"
        ? this.aggroed
          ? BOSS.chaseLeash
          : BOSS.aggroRange + BOSS.wanderRadius
        : Infinity;
    let np: SimPlayer | null = null;
    let best = Infinity;
    // Угроза: тот, кто нанёс больше всех (в радиусе поводка). Текущую цель держим, пока её урон не меньше 80% лучшего.
    let topP: SimPlayer | null = null;
    let topT = 0;
    let curP: SimPlayer | null = null;
    for (const p of players) {
      if ((p.x - this.homeX) ** 2 + (p.z - this.homeZ) ** 2 > bossLeash * bossLeash) continue;
      const d = (p.x - this.x) ** 2 + (p.z - this.z) ** 2;
      if (d < best) {
        best = d;
        np = p;
      }
      const t = this.threat.get(p.sessionId) ?? 0;
      if (t > topT) {
        topT = t;
        topP = p;
      }
      if (p.sessionId === this.targetId) curP = p;
    }
    if (topP && (!curP || (this.threat.get(curP.sessionId) ?? 0) < topT * 0.8)) {
      np = topP;
      best = (topP.x - this.x) ** 2 + (topP.z - this.z) ** 2;
    } else if (curP && topP) {
      np = curP;
      best = (curP.x - this.x) ** 2 + (curP.z - this.z) ** 2;
    }
    // «Боевой клич»: провокатор рядом — бьём его, кто бы ни был ближе.
    if (this.tauntT > 0 && this.tauntId) {
      const tp = players.find((p) => p.sessionId === this.tauntId);
      if (tp) {
        np = tp;
        best = (tp.x - this.x) ** 2 + (tp.z - this.z) ** 2;
        this.aggroed = true;
      }
    }
    const dist = np ? Math.sqrt(best) : Infinity;
    let dx = 0;
    let dz = 1;
    if (np && dist > 1e-3) {
      dx = (np.x - this.x) / dist;
      dz = (np.z - this.z) / dist;
    }

    const isBoss = this.kind === "boss";
    // Ледяной гигант огромный (тело ≈6.6 м): агр — от края тела, а не от центра, иначе он «не видел» героя в 10 м от себя.
    const aggroRange = (isBoss
      ? BOSS.aggroRange
      : this.ranged
        ? SPITTER.aggroRange
        : MOB.aggroRange) + (this.iceGiant ? MOB.bodyRadius * this.scale : 0);
    if (dist < aggroRange || (this.kind === "shard" && np)) {
      this.aggroed = true;
      this.outOfRange = 0;
    } else if (this.aggroed && dist > aggroRange * 1.4) {
      this.outOfRange += dt;
      if (this.outOfRange > MOB.leash) this.aggroed = false;
    } else {
      this.outOfRange = 0;
    }
    // Обычный моб (не босс — у того свой жёсткий поводок ниже) слишком
    // далеко утащен от точки спавна: бросает погоню НЕМЕДЛЕННО, не дожидаясь
    // таймера MOB.leash, и дальше бежит домой (см. ветку возврата в
    // праздношатании ниже).
    if (!isBoss && this.aggroed) {
      const homeDist = Math.hypot(this.x - this.homeX, this.z - this.homeZ);
      if (homeDist > MOB.leashDistance) this.aggroed = false;
    }
    // Герой скрыт (тень «Призрака бездны», умер, ушёл в безопасную зону) — моб его не видит: угроза и погоня
    // сбрасываются, иначе он шёл бы по инерции туда, где герой был, и держал бы его как цель после тени.
    if (np === null && this.aggroed && this.kind !== "boss") {
      this.aggroed = false;
      this.vx = 0;
      this.vz = 0;
    }
    const chasing = this.aggroed && np !== null;
    this.targetId = chasing ? (np?.sessionId ?? null) : null;

    // Чародей руин: заклинание по площади вокруг себя — телеграф, потом урон
    // + оглушение и отбрасывание всех игроков/ботов в радиусе.
    if (this.novaCaster) {
      if (this.novaCd > 0) this.novaCd -= dt;
      if (this.novaWindupT > 0) {
        this.novaWindupT -= dt;
        if (this.novaWindupT <= 0) {
          this.swing();
          this.novaSeq = (this.novaSeq + 1) & 0xffff;
          this.novaCd = MAGE_NOVA.cooldown;
          for (const p of players) {
            const ndx = p.x - this.x;
            const ndz = p.z - this.z;
            const nd = Math.hypot(ndx, ndz);
            if (nd > MAGE_NOVA.radius) continue;
            hits.push({
              target: p.sessionId,
              dmg: MAGE_NOVA.damage,
              fromX: this.x,
              fromZ: this.z,
              projectile: false,
              byMob: this.id,
              stunSec: MAGE_NOVA.stunSec,
              knockback: MAGE_NOVA.knockback,
            });
          }
        }
      } else if (chasing && this.novaCd <= 0 && dist < MAGE_NOVA.radius * 1.3) {
        this.novaWindupT = MAGE_NOVA.windup;
      }
    }

    const busy = this.stunnedT > 0 || this.rootedT > 0;
    const rage45 = this.enraged ? BOSS.rageDamageMult : 1;
    if (this.iceGiant) this.tickGiant(dt, players, hits, chasing, np, busy);
    if (this.lava) this.tickLava(dt, players, hits);
    else if (this.giantCastT > 0) this.giantCastT -= dt; // умение из комнаты (castLock) — доигрывает клип
    // 45 ур. Землерой: ныряет, под землёй неуязвим и ползёт к герою, круг под ним — и выныривает.
    if (this.burrower) {
      if (this.burrowCd > 0) this.burrowCd -= dt;
      if (this.burrowPhase > 0) {
        this.burrowT -= dt;
        if (this.burrowPhase === 1 && this.burrowT <= 0) {
          this.burrowPhase = 2;
          this.burrowT = BURROW.maxTravel;
          this.immune = true;
        }
        // Фаза 1 (ныряет): моб не стоит — идёт по земле дальше (обычное движение ниже); под землёй — ниже.
        if (this.burrowPhase >= 2) {
          this.vx = this.vz = 0;
          if (this.burrowPhase === 2) {
            const t = players.find((p) => p.sessionId === this.burrowTarget);
            if (t) {
              this.burrowX = t.x;
              this.burrowZ = t.z;
            }
            const bdx = this.burrowX - this.x;
            const bdz = this.burrowZ - this.z;
            const bd = Math.hypot(bdx, bdz);
            const stepLen = BURROW.speed * dt;
            if (bd > stepLen) {
              this.x += (bdx / bd) * stepLen;
              this.z += (bdz / bd) * stepLen;
            } else {
              this.x = this.burrowX;
              this.z = this.burrowZ;
            }
            this.y = terrainHeight(this.x, this.z);
            this.burrowTrailT -= dt;
            if (this.burrowTrailT <= 0) {
              this.burrowTrailT = 0.25;
              this.fx.push({ k: "burrowTrail", x: this.x, z: this.z });
            }
            if (bd <= 0.6 || this.burrowT <= 0) {
              // Метка легла здесь: под ней моб кружит невидимый и выныривает в её центре.
              this.burrowPhase = 3;
              this.burrowT = BURROW.telegraph;
              this.burrowCx = this.x;
              this.burrowCz = this.z;
              this.burrowAng = 0;
              this.fx.push({ k: "burrowMark", x: this.x, z: this.z, d: BURROW.telegraph, r: BURROW.radius });
            }
          } else if (this.burrowT > 0) {
            // Фаза 3 (телеграф): под землёй идёт по кругу внутри метки — путь есть, метка на месте.
            this.burrowAng += (BURROW_CIRCLE_V / BURROW_CIRCLE_R) * dt;
            this.x = this.burrowCx + Math.cos(this.burrowAng) * BURROW_CIRCLE_R;
            this.z = this.burrowCz + Math.sin(this.burrowAng) * BURROW_CIRCLE_R;
            this.y = terrainHeight(this.x, this.z);
          } else {
            // Выныривает в центре метки: удар по кругу, оглушение, отброс.
            this.x = this.burrowCx;
            this.z = this.burrowCz;
            this.y = terrainHeight(this.x, this.z);
            this.burrowPhase = 0;
            this.immune = false;
            this.burrowCd = BURROW.cooldown * (0.85 + Math.random() * 0.3);
            this.swing();
            this.attackCd = this.atkCooldown;
            this.vy = MOB.hopUp * 0.8;
            this.grounded = false;
            this.fx.push({ k: "burrowHit", x: this.x, z: this.z, r: BURROW.radius });
            for (const p of players) {
              if (Math.hypot(p.x - this.x, p.z - this.z) > BURROW.radius) continue;
              hits.push({
                target: p.sessionId,
                dmg: MOB.attackDamage * this.dmgMul * BURROW.dmgMul * rage45,
                fromX: this.x,
                fromZ: this.z,
                projectile: false,
                byMob: this.id,
                knockback: BURROW.knockback,
                stunSec: BURROW.stunSec,
              });
            }
          }
        }
        if (this.burrowPhase >= 2) return; // под землёй — ни шагов, ни ударов
      } else if (chasing && np && !busy && this.burrowCd <= 0 && dist > BURROW.minDist && dist < BURROW.maxDist) {
        this.burrowPhase = 1;
        this.burrowT = BURROW.dive;
        this.burrowTarget = np.sessionId;
        this.fx.push({ k: "burrowDive", x: this.x, z: this.z, d: BURROW.dive });
        return;
      }
    }
    // 45 ур. Грозовой дух: круг под героем; кто в нём к удару — молния, и она перескакивает на соседей.
    if (this.stormCaller) {
      if (this.stormCd > 0) this.stormCd -= dt;
      if (this.stormT > 0) {
        this.stormT -= dt;
        if (busy) this.stormT = 0; // сбили — молнии нет
        else if (this.stormT <= 0) {
          this.swing();
          this.stormCd = STORM.cooldown * (0.85 + Math.random() * 0.3);
          this.fx.push({ k: "stormHit", x: this.stormX, z: this.stormZ, r: STORM.markR });
          const struck = new Set<string>();
          let cur: SimPlayer | null = null;
          let cd = STORM.markR;
          for (const p of players) {
            const d = Math.hypot(p.x - this.stormX, p.z - this.stormZ);
            if (d <= cd) (cd = d), (cur = p);
          }
          let fx0 = this.stormX;
          let fz0 = this.stormZ;
          let mul = STORM.dmgMul;
          for (let j = 0; cur && j <= STORM.jumps; j++) {
            const c: SimPlayer = cur;
            struck.add(c.sessionId);
            hits.push({
              target: c.sessionId,
              dmg: MOB.attackDamage * this.dmgMul * mul * rage45,
              fromX: fx0,
              fromZ: fz0,
              projectile: false,
              magic: true,
              byMob: this.id,
            });
            if (j > 0) this.fx.push({ k: "stormJump", x: fx0, z: fz0, x2: c.x, z2: c.z });
            fx0 = c.x;
            fz0 = c.z;
            mul *= STORM.jumpMul;
            let next: SimPlayer | null = null;
            let nd = STORM.jumpR;
            for (const p of players) {
              if (struck.has(p.sessionId)) continue;
              const d = Math.hypot(p.x - c.x, p.z - c.z);
              if (d <= nd) (nd = d), (next = p);
            }
            cur = next;
          }
        }
      } else if (chasing && np && !busy && this.stormCd <= 0 && dist < STORM.range) {
        this.stormT = STORM.telegraph;
        this.stormX = np.x;
        this.stormZ = np.z;
        this.fx.push({ k: "stormMark", x: np.x, z: np.z, d: STORM.telegraph, r: STORM.markR });
      }
    }
    // Грибной колосс: метит землю под героем, через телеграф — облако спор.
    if (this.sporeCaster) {
      if (this.sporeCd > 0) this.sporeCd -= dt;
      if (this.sporeWindupT > 0) {
        this.sporeWindupT -= dt;
        if (this.sporeWindupT <= 0) {
          this.swing();
          this.sporeZones.push({ x: this.sporeX, z: this.sporeZ, t: SPORE.duration, tickT: 0 });
        }
      } else if (chasing && np && !busy && this.sporeCd <= 0 && dist < SPORE.range) {
        this.sporeX = np.x;
        this.sporeZ = np.z;
        this.sporeWindupT = SPORE.windup;
        this.sporeCd = SPORE.cooldown * (0.85 + Math.random() * 0.3);
        this.fx.push({ k: "sporeMark", x: np.x, z: np.z, d: SPORE.windup });
      }
    }
    // Костяной призрак: растворяется и возникает за спиной у цели, сразу бьёт.
    if (this.blinker) {
      if (this.blinkCd > 0) this.blinkCd -= dt;
      if (this.blinkFadeT > 0) {
        this.blinkFadeT -= dt;
        if (this.blinkFadeT <= 0) {
          const t = players.find((p) => p.sessionId === this.blinkTarget) ?? null;
          this.blinkTarget = null;
          if (t) {
            let ux = t.x - this.x;
            let uz = t.z - this.z;
            const ul = Math.hypot(ux, uz) || 1;
            ux /= ul;
            uz /= ul;
            // За краем тела (+ радиус героя): возникнув ВНУТРИ коллизии, призрак «запирал» ботов —
            // шаг к мобу им запрещён, и они стояли на месте (2026-10-05).
            const behind = Math.max(BLINK.behind, MOB.bodyRadius * this.scale + PLAYER.radius + 0.35);
            this.x = t.x + ux * behind;
            this.z = t.z + uz * behind;
            this.vx = 0;
            this.vz = 0;
            this.y = terrainHeight(this.x, this.z) + 1.35;
            this.yaw = Math.atan2(-ux, -uz);
            this.fx.push({ k: "blinkIn", x: this.x, z: this.z });
            this.attackCd = this.atkCooldown;
            this.swing();
            hits.push({
              target: t.sessionId,
              dmg: MOB.attackDamage * this.dmgMul * BLINK.strikeMul,
              fromX: this.x,
              fromZ: this.z,
              projectile: false,
              byMob: this.id,
              lifesteal: this.lifesteal || undefined,
            });
          }
        }
      } else if (chasing && np && !busy && this.blinkCd <= 0 && dist > BLINK.minDist && dist < BLINK.maxDist) {
        this.blinkFadeT = BLINK.fade;
        this.blinkTarget = np.sessionId;
        this.blinkCd = BLINK.cooldown * (0.8 + Math.random() * 0.4);
        this.fx.push({ k: "blinkOut", x: this.x, z: this.z, d: BLINK.fade });
      }
    }
    // Небесный спрут: щупальце тянется к дальнему герою, потом рывок к себе.
    if (this.puller) {
      if (this.pullCd > 0) this.pullCd -= dt;
      if (this.pullWindupT > 0) {
        this.pullWindupT -= dt;
        if (this.pullWindupT <= 0) {
          const t = players.find((p) => p.sessionId === this.pullTarget) ?? null;
          this.pullTarget = null;
          const d = t ? Math.hypot(t.x - this.x, t.z - this.z) : 0;
          // Убежал за дальность хвата, пока щупальце тянулось, — вырвался.
          if (t && d <= PULL.maxDist + PULL.escape) {
            this.swing();
            this.fx.push({ k: "pullHit", x: t.x, z: t.z, x2: this.x, z2: this.z });
            // Отрицательное отбрасывание = притяжение к источнику: у ботов
            // сервер сдвигает на |k|·0.35 м (см. hurtPlayer), игрок — импульсом.
            hits.push({
              target: t.sessionId,
              dmg: MOB.attackDamage * this.dmgMul * PULL.strikeMul,
              fromX: this.x,
              fromZ: this.z,
              projectile: false,
              byMob: this.id,
              stunSec: PULL.stunSec,
              knockback: -Math.max(0, d - PULL.landAt) / 0.35,
            });
            this.attackCd = this.atkCooldown;
          }
        }
      } else if (chasing && np && !busy && this.pullCd <= 0) {
        // Цель — самый ДАЛЬНИЙ герой в полосе хвата (ближнего и так бьёт).
        let far: SimPlayer | null = null;
        let fd = 0;
        for (const p of players) {
          const d = Math.hypot(p.x - this.x, p.z - this.z);
          if (d > PULL.minDist && d < PULL.maxDist && d > fd) {
            fd = d;
            far = p;
          }
        }
        if (far) {
          this.pullWindupT = PULL.windup;
          this.pullTarget = far.sessionId;
          this.pullCd = PULL.cooldown * (0.85 + Math.random() * 0.3);
          this.fx.push({ k: "pullMark", x: far.x, z: far.z, x2: this.x, z2: this.z, d: PULL.windup });
        }
      }
    }

    // Адский демон: полоса к герою, телеграф — и таран по ней.
    if (this.charger) {
      if (this.chargeCd > 0) this.chargeCd -= dt;
      if (this.chargeWindupT > 0) {
        this.chargeWindupT -= dt;
        if (this.chargeWindupT <= 0) {
          const ax = this.chargeFromX;
          const az = this.chargeFromZ;
          const lx = this.chargeToX - ax;
          const lz = this.chargeToZ - az;
          const len2 = lx * lx + lz * lz || 1;
          for (const p of players) {
            const t = Math.max(0, Math.min(1, ((p.x - ax) * lx + (p.z - az) * lz) / len2));
            const off = Math.hypot(p.x - (ax + lx * t), p.z - (az + lz * t));
            if (off > CHARGE.halfWidth) continue;
            hits.push({
              target: p.sessionId,
              dmg: MOB.attackDamage * this.dmgMul * CHARGE.strikeMul,
              fromX: ax + lx * t,
              fromZ: az + lz * t,
              projectile: false,
              byMob: this.id,
              stunSec: CHARGE.stunSec,
              knockback: CHARGE.knockback,
            });
          }
          this.x = this.chargeToX;
          this.z = this.chargeToZ;
          this.vx = 0;
          this.vz = 0;
          this.y = terrainHeight(this.x, this.z);
          this.yaw = Math.atan2(lx, lz);
          this.attackCd = this.atkCooldown;
          this.swing();
          this.fx.push({ k: "chargeHit", x: ax, z: az, x2: this.x, z2: this.z });
        }
      } else if (chasing && np && !busy && this.chargeCd <= 0 && dist > CHARGE.minDist && dist < CHARGE.maxDist) {
        const ux = (np.x - this.x) / dist;
        const uz = (np.z - this.z) / dist;
        let tx = np.x + ux * CHARGE.overshoot;
        let tz = np.z + uz * CHARGE.overshoot;
        // Не вылетать за край мира.
        const lim = WORLD.playHalf - 4;
        tx = Math.max(-lim, Math.min(lim, tx));
        tz = Math.max(-lim, Math.min(lim, tz));
        // В катакомбах конец тарана — в открытых залах (за стеной высота уже не пол).
        if (this.catHalls) [tx, tz] = catProject(tx, tz, this.catHalls, MOB.bodyRadius * this.scale * 0.8);
        this.chargeFromX = this.x;
        this.chargeFromZ = this.z;
        this.chargeToX = tx;
        this.chargeToZ = tz;
        this.chargeWindupT = CHARGE.windup;
        this.chargeCd = CHARGE.cooldown * (0.85 + Math.random() * 0.3);
        this.fx.push({ k: "chargeMark", x: this.x, z: this.z, x2: tx, z2: tz, d: CHARGE.windup });
      }
    }
    // Теневой ниндзя: стойка — стоит на месте (отбивает и контратакует ZoneSim.hitMob).
    if (this.parrier) {
      if (this.parryT > 0) this.parryT = Math.max(0, this.parryT - dt);
      if (this.parryCd > 0) this.parryCd -= dt;
      if (chasing && this.parryT <= 0 && this.parryCd <= 0 && dist < PARRY.reach) {
        this.parryT = PARRY.duration;
        this.parryCd = PARRY.cooldown * (0.85 + Math.random() * 0.3);
        // Стойка не пригвождает: ниндзя (как и все) движется, а отбивание — parryT (см. hitMob).
        this.fx.push({ k: "parryOn", x: this.x, z: this.z, d: PARRY.duration });
      }
    }
    // Ледяной демон: щит отражения (сам урон отражает ZoneSim.hitMob).
    if (this.reflector) {
      if (this.reflectT > 0) this.reflectT = Math.max(0, this.reflectT - dt);
      if (this.reflectCd > 0) this.reflectCd -= dt;
      if (chasing && this.reflectT <= 0 && this.reflectCd <= 0) {
        this.reflectT = REFLECT.duration;
        this.reflectCd = REFLECT.cooldown * (0.85 + Math.random() * 0.3);
        this.fx.push({ k: "reflectOn", x: this.x, z: this.z, d: REFLECT.duration });
      }
    }
    // Костяной вождь: метит землю под ближними героями — через телеграф шипы.
    if (this.spiker) {
      if (this.spikeCd > 0) this.spikeCd -= dt;
      if (this.spikeWindupT > 0) {
        this.spikeWindupT -= dt;
        if (this.spikeWindupT <= 0) {
          this.swing();
          for (const sp of this.spikeSpots) {
            this.fx.push({ k: "spikeHit", x: sp.x, z: sp.z });
            for (const p of players) {
              if (Math.hypot(p.x - sp.x, p.z - sp.z) > SPIKES.radius) continue;
              hits.push({
                target: p.sessionId,
                dmg: MOB.attackDamage * this.dmgMul * SPIKES.strikeMul,
                fromX: sp.x,
                fromZ: sp.z,
                projectile: false,
                byMob: this.id,
                slowSec: SPIKES.slowSec,
                slowFrac: SPIKES.slowFrac,
              });
            }
          }
          this.spikeSpots.length = 0;
        }
      } else if (chasing && np && !busy && this.spikeCd <= 0) {
        const near = players
          .map((p) => ({ p, d: Math.hypot(p.x - this.x, p.z - this.z) }))
          .filter((e) => e.d < SPIKES.range)
          .sort((u, v) => u.d - v.d)
          .slice(0, SPIKES.maxTargets);
        if (near.length) {
          this.spikeWindupT = SPIKES.windup;
          this.spikeCd = SPIKES.cooldown * (0.85 + Math.random() * 0.3);
          for (const { p } of near) {
            this.spikeSpots.push({ x: p.x, z: p.z });
            this.fx.push({ k: "spikeMark", x: p.x, z: p.z, d: SPIKES.windup });
          }
        }
      }
    }

    // Костяной вождь: лечение себя и соседей (сам хил — в ZoneSim.tick).
    if (this.healer) {
      if (this.healCd > 0) this.healCd -= dt;
      if (chasing && !busy && this.healCd <= 0) {
        this.healCd = CHIEF_HEAL.cooldown * (0.85 + Math.random() * 0.3);
        this.healReq = true;
        this.fx.push({ k: "chiefHeal", x: this.x, z: this.z });
      }
    }
    // Ледяной демон: круг под героем — через телеграф всех в нём вмораживает.
    if (this.freezer) {
      if (this.freezeCd > 0) this.freezeCd -= dt;
      if (this.freezeWindupT > 0) {
        this.freezeWindupT -= dt;
        if (this.freezeWindupT <= 0) {
          this.swing();
          this.fx.push({ k: "freezeHit", x: this.freezeX, z: this.freezeZ });
          for (const p of players) {
            if (Math.hypot(p.x - this.freezeX, p.z - this.freezeZ) > FREEZE.radius) continue;
            hits.push({
              target: p.sessionId,
              dmg: MOB.attackDamage * this.dmgMul * FREEZE.strikeMul,
              fromX: this.freezeX,
              fromZ: this.freezeZ,
              projectile: false,
              byMob: this.id,
              slowSec: FREEZE.slowSec,
              slowFrac: FREEZE.slowFrac,
            });
          }
        }
      } else if (chasing && np && !busy && this.freezeCd <= 0 && dist < FREEZE.range) {
        this.freezeX = np.x;
        this.freezeZ = np.z;
        this.freezeWindupT = FREEZE.windup;
        this.freezeCd = FREEZE.cooldown * (0.85 + Math.random() * 0.3);
        this.fx.push({ k: "freezeMark", x: np.x, z: np.z, d: FREEZE.windup });
      }
    }
    // Паук: паутинный сгусток издалека — на попадание герой «в корне» (WEB). Укус — вблизи.
    if (this.webber) {
      if (this.webCd > 0) this.webCd -= dt;
      if (chasing && np && !busy && this.webCd <= 0 && dist >= WEB.minRange && dist < WEB.range) {
        this.webCd = WEB.cooldown * (0.85 + Math.random() * 0.3);
        spit(this, np, true);
      }
    }

    // 40 ур. Скалолом: прыжок на героя — круг-предупреждение, бросок, удар по площади.
    if (this.leaper) {
      if (this.leapCd > 0) this.leapCd -= dt;
      if (this.leapWindupT > 0) {
        this.leapWindupT -= dt;
        if (this.stunnedT > 0 || this.rootedT > 0) this.leapWindupT = 0; // сбили — прыжка нет
        else if (this.leapWindupT <= 0) {
          // Бросок: долететь в точку за LEAP.air (баллистика под MOB.gravity).
          const T = LEAP.air;
          this.vx = (this.leapX - this.x) / T;
          this.vz = (this.leapZ - this.z) / T;
          this.vy = (MOB.gravity * T) / 2 + (terrainHeight(this.leapX, this.leapZ) - this.y) / T;
          this.grounded = false;
          this.leapAirT = T;
        }
      } else if (this.leapAirT > 0) {
        this.leapAirT -= dt;
        if (this.leapAirT <= 0) {
          this.fx.push({ k: "leapHit", x: this.leapX, z: this.leapZ, r: LEAP.radius });
          const rageMul = this.enraged ? BOSS.rageDamageMult : 1;
          for (const p of players) {
            if (Math.hypot(p.x - this.leapX, p.z - this.leapZ) > LEAP.radius) continue;
            hits.push({
              target: p.sessionId,
              dmg: MOB.attackDamage * this.dmgMul * LEAP.dmgMul * rageMul,
              fromX: this.leapX,
              fromZ: this.leapZ,
              projectile: false,
              byMob: this.id,
              knockback: LEAP.knockback,
              stunSec: LEAP.stunSec,
            });
          }
        }
      } else if (chasing && np && !busy && this.leapCd <= 0 && dist > LEAP.minDist && dist < LEAP.maxDist) {
        this.leapX = np.x;
        this.leapZ = np.z;
        this.leapWindupT = LEAP.windup;
        this.leapCd = this.leapCooldown * (0.85 + Math.random() * 0.3);
        this.fx.push({ k: "leapMark", x: np.x, z: np.z, d: LEAP.windup + LEAP.air, r: LEAP.radius });
      }
    }
    // Ярость стаи гаснет сама.
    if (this.frenzyT > 0) {
      this.frenzyT -= dt;
      if (this.frenzyT <= 0) this.raging = false;
    }

    // Телеграфы и замахи движение не останавливают: моб идёт и бьёт на ходу. Точки ударов фиксируются
    // при старте каста там, где это задано самим умением (круг, линия, метка), а не где моб окажется.

    // Босс без погони у своего угла смотрит в сторону поляны (оттуда приходят герои), даже когда
    // бродит по углу. В погоне и при замахе/рывке это отключено.
    const bossFacingMeadow =
      this.faceRest &&
      this.grounded &&
      this.slamWindupT <= 0 &&
      this.lungeWindupT <= 0 &&
      this.lungeT <= 0 &&
      this.shootQueue === 0 &&
      !chasing &&
      (this.x - this.homeX) ** 2 + (this.z - this.homeZ) ** 2 < (BOSS.wanderRadius + 4) ** 2;

    // Лагерный элитный моб (см. EliteMobDef.enrageAt) сам себе включает ярость
    // ниже порога HP — раньше это умел только внешний контроллер события
    // (ZoneRoom для eliteHunt-босса); теперь любой моб с enrageAt делает это
    // самостоятельно, без спец-кода снаружи.
    if (this.enrageAt !== undefined && !this.raging && this.hp / this.maxHp < this.enrageAt) {
      this.raging = true;
    }


    const rage = this.enraged ? BOSS.rageSpeedMult : 1;
    const rageRate = this.enraged ? BOSS.rageRateMult : 1;
    const rageDmg = this.enraged ? BOSS.rageDamageMult : 1;
    const hopSpeed =
      (isBoss ? BOSS.hopSpeed : this.kind === "shard" ? SHARD.hopSpeed : MOB.hopSpeed) *
      rage *
      this.speedMul *
      (this.lava?.speedMul ?? 1) *
      this.slowK;
    const hopInterval =
      (isBoss ? BOSS.hopInterval : this.kind === "shard" ? SHARD.hopInterval : MOB.hopInterval) /
      rage;

    // Босс копит слэм: подошёл близко — замахивается (стоит на месте),
    // на исходе телеграфа бьёт по площади вокруг себя.
    if (isBoss) {
      if (this.slamCd > 0) this.slamCd -= dt;
      if (this.slamWindupT > 0) {
        this.slamWindupT -= dt; // замах на ходу: босс идёт, слэм бьёт по месту, где он в этот миг
        if (this.slamWindupT <= 0) {
          this.slamSeq = (this.slamSeq + 1) & 0xffff;
          this.swing();
          this.slamCd = BOSS.slamCooldown / rageRate;
          this.vy = MOB.hopUp * 0.6;
          this.grounded = false;
          for (const p of players) {
            if (Math.hypot(p.x - this.x, p.z - this.z) > BOSS.slamRadius) continue;
            hits.push({
              target: p.sessionId,
              dmg: BOSS.slamDamage * rageDmg,
              fromX: this.x,
              fromZ: this.z,
              byMob: this.id,
              projectile: false,
            });
          }
        }
      } else if (
        chasing &&
        this.grounded &&
        this.slamCd <= 0 &&
        dist < BOSS.slamRange &&
        this.lungeT <= 0 &&
        this.lungeWindupT <= 0
      ) {
        this.slamWindupT = BOSS.slamWindup;
      }

      // Рывок-таран: летит в самого ДАЛЁКОГО игрока в пределах агро — так
      // достаёт того, кто держит дистанцию, пока второй вяжет боем вблизи.
      // Разгоняется и проносится по прямой. Один удар за рывок; не толкает.
      let lungeTgt: SimPlayer | null = null;
      let lungeFar = -1;
      for (const p of players) {
        const d = Math.hypot(p.x - this.x, p.z - this.z);
        if (d <= BOSS.aggroRange && d > lungeFar) {
          lungeFar = d;
          lungeTgt = p;
        }
      }
      if (this.lungeCd > 0) this.lungeCd -= dt;
      if (this.lungeWindupT > 0) {
        this.lungeWindupT -= dt; // таран копит на ходу: направление обновляется, моб не стоит
        if (lungeTgt && lungeFar > 1e-3) {
          this.lungeDirX = (lungeTgt.x - this.x) / lungeFar;
          this.lungeDirZ = (lungeTgt.z - this.z) / lungeFar;
        }
        if (this.lungeWindupT <= 0) {
          this.lungeT = BOSS.lungeDuration;
          this.lungeHit = false;
          this.lungeCd = BOSS.lungeCooldown / rageRate;
        }
      } else if (this.lungeT > 0) {
        this.lungeT -= dt;
        this.vx = this.lungeDirX * BOSS.lungeSpeed * rage;
        this.vz = this.lungeDirZ * BOSS.lungeSpeed * rage;
        if (!this.lungeHit) {
          for (const p of players) {
            if (Math.hypot(p.x - this.x, p.z - this.z) > BOSS.slamRadius * 0.7 + PLAYER.radius) {
              continue;
            }
            hits.push({
              target: p.sessionId,
              dmg: BOSS.lungeDamage * rageDmg,
              fromX: this.x,
              fromZ: this.z,
              byMob: this.id,
              projectile: false,
            });
            this.swing();
            this.lungeHit = true;
          }
        }
      } else if (
        this.aggroed &&
        lungeTgt &&
        this.grounded &&
        this.slamWindupT <= 0 &&
        this.lungeCd <= 0 &&
        lungeFar > BOSS.slamRange * 1.15
      ) {
        this.lungeWindupT = BOSS.lungeWindup;
        this.lungeDirX = (lungeTgt.x - this.x) / lungeFar;
        this.lungeDirZ = (lungeTgt.z - this.z) / lungeFar;
      }

      // Плевок: изредка очередь слизистых сгустков в игрока на средней
      // дистанции. Работает и во время замаха/рывка — босс многозадачен.
      if (this.shootCd > 0) this.shootCd -= dt;
      if (this.shootGap > 0) this.shootGap -= dt;
      // Цель плевка — тот, кто в полосе средних дистанций (обычно дальний).
      const shootTgt =
        lungeTgt &&
        lungeFar > BOSS.shootRange[0] &&
        lungeFar < BOSS.shootRange[1]
          ? lungeTgt
          : null;
      if (this.shootQueue === 0 && this.shootCd <= 0 && shootTgt) {
        this.shootQueue = BOSS.shootBurst;
        this.shootCd = BOSS.shootCooldown / rageRate;
        this.shootGap = 0;
      }
      if (this.shootQueue > 0 && this.shootGap <= 0) {
        const t = shootTgt ?? lungeTgt ?? np;
        if (t) {
          const tl = Math.hypot(t.x - this.x, t.z - this.z) || 1;
          const nx = (t.x - this.x) / tl;
          const nz = (t.z - this.z) / tl;
          const j = (Math.random() - 0.5) * BOSS.shootSpread;
          // Смещаем цель вбок перпендикулярно направлению на неё.
          spit(this, { ...t, x: t.x - nz * j, z: t.z + nx * j });
          this.shootQueue--;
          this.shootGap = BOSS.shootGap;
        } else {
          this.shootQueue = 0;
        }
      }
    }

    if (this.pullT > 0) {
      // Стягивание: тянет по прямой и приходит ровно за pullT (крутой склон не задерживает — это рывок,
      // не ходьба); на землю ставим сами. Скорость по climbStep не идёт — шаг уже сделан здесь.
      const rem = this.pullT;
      const k = Math.min(1, dt / rem);
      this.x += (this.pullX - this.x) * k;
      this.z += (this.pullZ - this.z) * k;
      this.pullT = rem - dt;
      if (this.pullT <= 0) {
        this.pullT = 0;
        this.x = this.pullX;
        this.z = this.pullZ;
      }
      this.vx = 0;
      this.vz = 0;
      this.y = terrainHeight(this.x, this.z) + 0.02;
      this.vy = 0;
      this.grounded = true;
    } else if (this.anchored || this.rootedT > 0 || this.stunnedT > 0) {
      // Якорные (рейд-босс и его копии) стоят всегда; пригвождён (град стрел от героев) или оглушён (удар воина): с места не двигается.
      this.rootedT = Math.max(0, this.rootedT - dt);
      this.vx = 0;
      this.vz = 0;
      // Оглушённый летун застывает в воздухе; пригвождённый — падает как все.
      if (this.stunnedT > 0 && this.flying) this.vy = 0;
      else this.vy -= MOB.gravity * dt;
    } else if (this.walksOnly && this.grounded && this.lungeT <= 0) {
      // Ходок (Скалолом, Владыка Бездны): идёт по земле, ноги всегда на земле — без пачек прыжков
      // (прыжок leaper — отдельная механика ниже). В погоне — бег, у героя стоит и бьёт; без погони — неспешный шаг.
      const [tx, tz] = this.walkDir(chasing, dist, dx, dz);
      const spd = chasing || this.returningHome ? hopSpeed : MOB.idleHopSpeed * 0.5;
      const [sx, sz] = steerAroundTrees(this.x, this.z, tx, tz);
      const acc = Math.min(1, dt * 4);
      this.vx += (sx * spd - this.vx) * acc;
      this.vz += (sz * spd - this.vz) * acc;
      this.vy = 0;
      // Чуть над землёй: иначе общий снап ниже гасит скорость (vx *= 0.25 при касании земли).
      this.y = terrainHeight(this.x, this.z) + 0.02;
      this.grounded = true;
      if (Math.hypot(this.vx, this.vz) > 0.15) this.yaw = Math.atan2(this.vx, this.vz);
    } else if (this.flying) {
      // Пчела: парит на высоте, не прыгает — плавно рулит к цели / точке блуждания.
      let tx = 0;
      let tz = 0;
      if (chasing) {
        // В погоне: ближний подлетает и висит у своей дистанции удара (у контакта тел — для крупных) и бьёт;
        // дальник кружит, как прежде.
        this.returningHome = false;
        [tx, tz] = this.ranged
          ? this.combatDir(dx, dz, dist, this.combatRing(), 0.4)
          : this.meleeStep(dx, dz, dist, this.standDist());
      } else {
        // Улетела погоней далеко от дома — сперва летит напрямик домой на
        // боевой скорости, а не лениво дрейфует к случайной точке рядом.
        const homeDist = Math.hypot(this.x - this.homeX, this.z - this.homeZ);
        const returning = homeDist > MOB.wanderRadius;
        let wdx: number, wdz: number;
        if (returning) {
          wdx = this.homeX - this.x;
          wdz = this.homeZ - this.z;
        } else {
          wdx = this.wanderX - this.x;
          wdz = this.wanderZ - this.z;
          if (Math.hypot(wdx, wdz) < 1.2) {
            const a = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()) * MOB.wanderRadius;
            this.wanderX = this.homeX + Math.cos(a) * r;
            this.wanderZ = this.homeZ + Math.sin(a) * r;
            wdx = this.wanderX - this.x;
            wdz = this.wanderZ - this.z;
          }
        }
        const wl = Math.hypot(wdx, wdz) || 1;
        tx = wdx / wl;
        tz = wdz / wl;
        this.returningHome = returning;
      }
      const spd = chasing ? hopSpeed : this.returningHome ? hopSpeed : MOB.idleHopSpeed * 1.2;
      const [sx, sz] = tx !== 0 || tz !== 0 ? steerAroundTrees(this.x, this.z, tx, tz) : [0, 0];
      const acc = Math.min(1, dt * 4);
      this.vx += (sx * spd - this.vx) * acc;
      this.vz += (sz * spd - this.vz) * acc;
      this.x += this.vx * dt;
      this.z += this.vz * dt;
      this.flyBob += dt * 9;
      this.y = terrainHeight(this.x, this.z) + 1.35 + Math.sin(this.flyBob) * 0.12;
      this.vy = 0;
      this.grounded = true; // клиент: без прыжков/приземлений
      if (!bossFacingMeadow && Math.hypot(this.vx, this.vz) > 0.15) this.yaw = Math.atan2(this.vx, this.vz);
    } else if (this.grounded && this.lungeT <= 0) {
      if (chasing && this.standsAtHero(dist)) {
        // Ближний бой: дошёл до кольца удара — стоит у героя и бьёт, а не прыгает по кругу.
        this.vx = 0;
        this.vz = 0;
        this.vy = 0;
        this.y = terrainHeight(this.x, this.z) + 0.02;
        this.grounded = true;
      } else if (chasing) {
        // Погоня без пауз: следующий прыжок — сразу после приземления. Горизонтальная скорость прыжка
        // подобрана так, чтобы средняя скорость погони не изменилась (см. HOP_GLIDE у констант).
        const hopK = (HOP_FLIGHT_SEC + HOP_GLIDE * hopInterval) / (HOP_FLIGHT_SEC + hopInterval);
        let spd = hopSpeed * hopK;
        let hx = 0;
        let hz = 0;
        if (this.ranged) {
          let retreating = false;
          if (dist < SPITTER.keepDistance && this.restT <= 0) {
            // Отход по диагонали, а не строго назад: так он кружит, а не
            // убегает по прямой от преследователя.
            hx = -dx * 0.75 - dz * this.retreatSide * 0.66;
            hz = -dz * 0.75 + dx * this.retreatSide * 0.66;
            retreating = true;
            this.retreatT += hopInterval;
            if (this.retreatT >= SPITTER.retreatBurst) {
              this.retreatT = 0;
              this.restT = SPITTER.retreatRest;
            }
          } else if (dist < SPITTER.keepDistance) {
            // Выдохся — только вбок, дистанцию больше не набирает.
            hx = -dz * this.retreatSide;
            hz = dx * this.retreatSide;
          } else if (dist > (this.shot?.range ?? SPITTER.fireRange)) {
            hx = dx;
            hz = dz;
          } else {
            const s = Math.random() < 0.5 ? 1 : -1;
            hx = -dz * s;
            hz = dx * s;
          }
          if (retreating) spd *= SPITTER.retreatSpeed;
        } else {
          // Ближний бой: прыгает прямо к герою; у кольца удара остановится и будет бить (см. standsAtHero).
          [hx, hz] = [dx, dz];
        }
        [hx, hz] = steerAroundTrees(this.x, this.z, hx, hz);
        this.vx = hx * spd;
        this.vz = hz * spd;
        this.vy = MOB.hopUp;
        this.grounded = false;
      } else {
        // Без погони — неспешный шаг по земле, без прыжков: моб не стоит, но и не скачет без нужды.
        // Далеко от дома — возвращается быстрее, бродит у дома — медленнее.
        const [wx, wz] = this.wanderDir(isBoss ? BOSS.wanderRadius : MOB.wanderRadius);
        const [hx, hz] = steerAroundTrees(this.x, this.z, wx, wz);
        const spd = this.returningHome ? MOB.idleHopSpeed : MOB.idleHopSpeed * 0.3;
        const acc = Math.min(1, dt * 4);
        this.vx += (hx * spd - this.vx) * acc;
        this.vz += (hz * spd - this.vz) * acc;
        this.vy = 0;
        // Чуть над землёй: иначе общий снап ниже гасит скорость (vx *= 0.25 при касании земли).
        this.y = terrainHeight(this.x, this.z) + 0.02;
        this.grounded = true;
        if (!this.faceRest) this.yaw = Math.atan2(hx, hz);
      }
    } else {
      this.vy -= MOB.gravity * dt;
    }

    // Летающий уже проинтегрировал x/z и выставил y выше — не трогаем.
    // Но пригвождённый летун падает как обычный моб, поэтому и он сюда идёт.
    if (!this.flying || this.rootedT > 0) {
      // На крутой подъём (круче MAX_CLIMB) не забраться ни мобу, ни боссу — скользит вдоль склона.
      const [sx, sz] = climbStep(this.x, this.z, this.vx * dt, this.vz * dt);
      if (sx === 0) this.vx = 0;
      if (sz === 0) this.vz = 0;
      this.x += sx;
      this.y += this.vy * dt;
      this.z += sz;
    }

    // Босс не покидает свой угол: жёсткий поводок к дому (в бою всё равно
    // может гоняться в пределах арены, но не убегать через всю карту).
    if (this.kind === "boss") {
      const hdx = this.x - this.homeX;
      const hdz = this.z - this.homeZ;
      const hd = Math.hypot(hdx, hdz);
      // Жёсткая стена — всегда chaseLeash. Домой вне боя босс возвращается сам
      // (idle-скачки нацелены в точку у дома), без телепорта-рывка к углу.
      const maxHd = BOSS.chaseLeash;
      if (hd > maxHd) {
        this.x = this.homeX + (hdx / hd) * maxHd;
        this.z = this.homeZ + (hdz / hd) * maxHd;
        this.vx *= 0.3;
        this.vz *= 0.3;
      }
    }

    if (!this.flying || this.rootedT > 0) {
      const gy = terrainHeight(this.x, this.z);
      if (this.y <= gy) {
        this.y = gy;
        this.vy = 0;
        this.vx *= 0.25;
        this.vz *= 0.25;
        this.grounded = true;
      }
    }

    // не проходит сквозь стволы деревьев
    for (const t of OBSTACLES) {
      const tx = this.x - t.x;
      const tz = this.z - t.z;
      const clr = t.r + MOB.bodyRadius * this.scale;
      const td = Math.hypot(tx, tz);
      if (td > 1e-4 && td < clr) {
        const push = (clr - td) / td;
        this.x += tx * push;
        this.z += tz * push;
        // Гасим скорость внутрь ствола, иначе моб упрётся и будет дрожать.
        const inward = (this.vx * tx + this.vz * tz) / td;
        if (inward < 0) {
          this.vx -= (tx / td) * inward;
          this.vz -= (tz / td) * inward;
        }
      }
    }

    // Герой — препятствие, но не толкатель: моб САМ в героя не заходит (его шаг
    // внутрь отменяем — встаёт на край), а если герой сам зашёл в моба — моба не
    // отталкиваем (раньше герои двигали мобов и даже боссов, просто идя на них).
    const bodyR =
      this.kind === "boss" ? MOB.bodyRadius * this.scale * BOSS.bodyMult : MOB.bodyRadius * this.scale;
    for (const p of players) {
      const clr = PLAYER.radius + bodyR;
      const gx = this.x - p.x;
      const gz = this.z - p.z;
      const gd = Math.hypot(gx, gz);
      if (gd >= clr) continue;
      const d0 = Math.hypot(x0 - p.x, z0 - p.z);
      if (d0 >= clr) {
        // Сам дошёл до героя — останавливаем на краю.
        if (gd > 1e-4) {
          this.x = p.x + (gx / gd) * clr;
          this.z = p.z + (gz / gd) * clr;
        } else {
          this.x = x0;
          this.z = z0;
        }
      } else if (gd < d0) {
        // Уже вплотную (герой зашёл в моба) — глубже не лезет, но и не отъезжает.
        this.x = x0;
        this.z = z0;
      }
      if (gd > 1e-4) {
        const inward = (this.vx * gx + this.vz * gz) / gd;
        if (inward < 0) {
          this.vx -= (gx / gd) * inward;
          this.vz -= (gz / gd) * inward;
        }
      }
    }

    if (chasing && !bossFacingMeadow) this.yaw = Math.atan2(dx, dz);
    if (this.giantCastT > 0) this.yaw = this.giantYaw; // раскол, бросок, разлом — лицом к цели умения
    if (bossFacingMeadow) {
      let dyaw = this.restYaw - this.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      this.yaw += dyaw * Math.min(1, dt * 1.5);
    }

    // Удар из замаха: урон — в момент удара, если цель всё ещё рядом (иначе промах).
    if (this.strikeT > 0) {
      this.strikeT -= dt;
      if (this.strikeT <= 0) {
        this.strikeT = 0;
        const tp = this.strikeTo ? players.find((q) => q.sessionId === this.strikeTo) : undefined;
        this.strikeTo = null;
        if (this.iceGiant && !this.dead) {
          // «Ледяной размах»: когти по дуге перед собой — все герои в ней, каждому стак «Обморожения».
          const fx = Math.sin(this.yaw);
          const fz = Math.cos(this.yaw);
          const reach = this.hitReach() + 0.6;
          const cosHalf = Math.cos(ICE_GIANT.cleaveHalf);
          for (const q of players) {
            const qx = q.x - this.x;
            const qz = q.z - this.z;
            const qd = Math.hypot(qx, qz);
            if (qd > reach || (qd > 1e-3 && (qx * fx + qz * fz) / qd < cosHalf)) continue;
            hits.push({
              target: q.sessionId, dmg: this.strikeDmg, fromX: this.x, fromZ: this.z, projectile: false, byMob: this.id, frost: 1,
            });
          }
        } else if (tp && !this.dead && Math.hypot(tp.x - this.x, tp.z - this.z) < this.hitReach() + 0.6) {
          hits.push({
            target: tp.sessionId,
            dmg: this.strikeDmg,
            fromX: this.x,
            fromZ: this.z,
            projectile: false,
            byMob: this.id,
            lifesteal: this.lifesteal || undefined,
            phys: this.strikePhys || undefined,
          });
        }
      }
    }
    if (chasing && np && !isBoss && this.stunnedT <= 0 && !(this.anchored && this.castingNow)) {
      if (this.ranged) {
        if (dist < (this.shot?.range ?? SPITTER.fireRange) && this.attackCd <= 0) {
          this.attackCd = this.shot?.cooldown ?? SPITTER.fireCooldown;
          this.swing();
          spit(this, np);
        }
      } else if (dist < this.hitReach() && this.attackCd <= 0 && !this.giantCasting && !this.lava?.casting) {
        this.attackCd = this.atkCooldown;
        // Ледяной гигант чередует лапы: правой (Attack) и левой (Attack2).
        if (this.iceGiant) this.giantLeft = !this.giantLeft;
        this.swing(this.iceGiant && this.giantLeft ? MOB_SWING.swipe2 : 0);
        // Урон — не сейчас, а в момент удара на экране (после замаха); см. MOB.strikeDelay.
        this.strikeT = this.strikeDelay;
        this.strikeTo = np.sessionId;
        this.strikeDmg = MOB.attackDamage * this.dmgMul * rageDmg;
        this.strikePhys = this.physEvery > 0 && ++this.strikeN % this.physEvery === 0;
        // Отскок после замаха — не у гиганта: тяжёлый, с места не сдвигается (иначе герой у его ног отталкивает его шаг за шагом).
        if (!this.iceGiant) {
          this.vx -= dx * 2;
          this.vz -= dz * 2;
        }
      }
    }
  }

  private respawn(): void {
    this.threat.clear(); // после возрождения старая угроза не тянет к прежнему обидчику
    const a = Math.random() * Math.PI * 2;
    const r = 3 + Math.random() * MOB.wanderRadius;
    this.x = this.homeX + Math.cos(a) * r;
    this.z = this.homeZ + Math.sin(a) * r;
    this.wanderX = this.x;
    this.wanderZ = this.z;
    this.y = terrainHeight(this.x, this.z) + 5;
    this.slamCd = BOSS.slamCooldown;
    this.slamWindupT = 0;
    this.lungeCd = 0;
    this.lungeWindupT = 0;
    this.lungeT = 0;
    this.shootCd = BOSS.shootCooldown;
    this.shootQueue = 0;
    this.shootGap = 0;
    this.splitsDone = 0;
    this.contrib.clear();
    this.hp = this.maxHp;
    this.dead = false;
    this.aggroed = false;
    this.outOfRange = 0;
    this.burningT = 0;
    this.burnDps = 0;
    this.burnBy = "";
    this.plague.stacks = 0;
    this.plague.t = 0;
    this.venom.stacks = 0;
    this.venom.t = 0;
    this.bleedT = 0;
    this.stunnedT = 0;
    this.rootedT = 0;
    this.raging = false;
    this.frenzyT = 0;
    this.leapWindupT = 0;
    this.leapAirT = 0;
    this.burrowPhase = 0;
    this.immune = false;
    this.stormT = 0;
    this.cloneStep = 0;
    if (this.iceGiant) {
      this.giantFury = false;
      this.cancelGiantCast();
      this.giantFlyT = 0;
      this.giantFisRun = -1;
      this.giantGapT = 3;
      this.giantSlamCd = 6;
      this.giantThrowCd = 4;
      this.giantFissureCd = 5;
    }
    this.vx = this.vy = this.vz = 0;
    this.grounded = false;
    if (this.faceRest) this.yaw = this.restYaw;
  }
}

/** Лут, лежащий на земле. Тает через BAG.dropLife секунд. */
class Drop {
  readonly id = nid();
  life = 0;
  /** Кто добил моба (sessionId/bot id) — временная бронь трофея, см. ownerUntil. */
  ownerId: string | null = null;
  /** Date.now() (мс), до которого трофей закреплён за ownerId — как и другие похожие таймеры (см. BOT.raidAddMemory). */
  ownerUntil = 0;

  constructor(
    readonly item: ItemId,
    readonly count: number,
    readonly x: number,
    readonly y: number,
    readonly z: number,
    /** Для оружия — конкретный раскатанный инстанс (аффиксы). У расходников — undefined. */
    readonly instance?: WeaponInstance,
    /** Для брони (shared/armor.ts) — лежащая часть. */
    readonly armor?: ArmorInstance,
  ) {}

  /** true — пора убрать. Оружие лежит 10 минут (BAG.weaponDropLife), броня 5 (BAG.armorDropLife), остальное — 3 (BAG.dropLife). */
  tick(dt: number): boolean {
    this.life += dt;
    const max = this.armor ? BAG.armorDropLife : ITEMS[this.item].weapon ? BAG.weaponDropLife : BAG.dropLife;
    return this.life > max;
  }
}

/** Лут на земле в виде простых данных — для сохранения между запусками. */
export interface DropSave {
  item: ItemId;
  count: number;
  x: number;
  y: number;
  z: number;
  life: number;
  instance?: WeaponInstance;
  armor?: ArmorInstance;
}

class Dummy {
  readonly id = nid();
  hp = COMBAT.dummyHp;
  dead = false;
  private respawnIn = 0;
  hurtSeq = 0;

  constructor(
    readonly x: number,
    readonly y: number,
    readonly z: number,
  ) {}

  applyHit(dmg: number): boolean {
    if (this.dead) return false;
    this.hp -= dmg;
    this.hurtSeq = (this.hurtSeq + 1) & 0xffff;
    if (this.hp <= 0) {
      this.dead = true;
      this.respawnIn = COMBAT.dummyRespawn;
      return true;
    }
    return false;
  }

  tick(dt: number): void {
    if (!this.dead) return;
    this.respawnIn -= dt;
    if (this.respawnIn <= 0) {
      this.dead = false;
      this.hp = COMBAT.dummyHp;
    }
  }
}

/** Физический снаряд моба 40 ур. (копьё, шип) — поверх обычного плевка. */
interface BallExtra {
  /** Код вида для клиента (BallState.k, см. SHOTS). */
  code: number;
  grav: number;
  radius: number;
  /** Урон — множитель поверх SPITTER.ballDamage·dmgMul. */
  dmgMul: number;
  pierce?: boolean;
  bleed?: { sec: number; frac: number };
  /** Паутинный сгусток: на попадание герой «в корне» на root с. (WEB). */
  root?: number;
  /** Паутинный сгусток: +1 стак паутины на попадание (WEB). */
  webStack?: boolean;
  caltrops?: MobShot["caltrops"];
}

class Ball {
  readonly id = nid();
  private life = 0;
  /** Пробивающий снаряд: кого уже задел (каждого — один раз). */
  private hitIds: Set<string> | null = null;

  constructor(
    public x: number,
    public y: number,
    public z: number,
    public vx: number,
    public vy: number,
    public vz: number,
    public boss = false,
    /** id моба, который выстрелил (для переключения цели бота). */
    public owner = "",
    /** Множитель урона плевка усиленного моба. */
    public dmgMul = 1,
    /** Чародей руин: заряд взрывается по площади вокруг прямой цели. 0 — обычный плевок. */
    public aoeRadius = 0,
    public aoeFrac = 0,
    /** Физический снаряд 40 ур.; null — обычный плевок. */
    public extra: BallExtra | null = null,
  ) {}

  /** Вид для клиента (BallState.k): 0 — плевок, 1 — плевок босса, дальше — SHOTS.code. */
  get code(): number {
    return this.extra?.code ?? (this.boss ? 1 : 0);
  }

  /** true — шарик надо удалить. `onLand` — упал на землю, никого не задев. */
  tick(dt: number, players: SimPlayer[], hits: PlayerHit[], onLand?: (b: Ball) => void): boolean {
    const px = this.x;
    const py = this.y;
    const pz = this.z;
    this.vy -= (this.extra?.grav ?? SPITTER.ballGravity) * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;
    this.life += dt;
    if (this.life > SPITTER.ballMaxLife) return true;
    if (this.y <= terrainHeight(this.x, this.z)) {
      onLand?.(this);
      return true;
    }

    const ex = this.extra;
    for (const p of players) {
      if (this.hitIds?.has(p.sessionId)) continue;
      const feetY = p.y - PLAYER.eyeHeight;
      const d = segDist(
        px, py, pz, this.x, this.y, this.z,
        p.x, feetY, p.z, p.x, p.y, p.z,
      );
      if (d < (ex?.radius ?? SPITTER.ballRadius) + PLAYER.radius) {
        // «Откуда» — точка ВВЕРХ по траектории, а не текущая позиция шара:
        // на скорости плевок за тик пролетает мимо игрока, и направление
        // "от игрока к шару" могло указывать вбок/назад — блок щитом мимо.
        const vh = Math.hypot(this.vx, this.vz) || 1;
        hits.push({
          target: p.sessionId,
          dmg: SPITTER.ballDamage * this.dmgMul * (ex?.dmgMul ?? 1),
          fromX: this.x - (this.vx / vh) * 4,
          fromZ: this.z - (this.vz / vh) * 4,
          projectile: true,
          byMob: this.owner || undefined,
          ...(ex ? { phys: true } : {}),
          ...(ex?.bleed ? { bleedSec: ex.bleed.sec, bleedFrac: ex.bleed.frac } : {}),
          ...(ex?.root ? { rootSec: ex.root } : {}),
          ...(ex?.webStack ? { webStack: true } : {}),
        });
        // Копьё пробивает: летит дальше, этого героя больше не задевает.
        if (ex?.pierce) {
          (this.hitIds ??= new Set()).add(p.sessionId);
          continue;
        }
        // Чародей руин: доля урона — по площади вокруг прямой цели, спадает к краю.
        if (this.aoeRadius > 0 && this.aoeFrac > 0) {
          for (const p2 of players) {
            if (p2.sessionId === p.sessionId) continue;
            const dd = Math.hypot(p2.x - this.x, p2.z - this.z);
            if (dd >= this.aoeRadius) continue;
            const k = 1 - dd / this.aoeRadius;
            const aoeDmg = SPITTER.ballDamage * this.dmgMul * this.aoeFrac * k;
            if (aoeDmg <= 0.01) continue;
            hits.push({
              target: p2.sessionId,
              dmg: aoeDmg,
              fromX: this.x,
              fromZ: this.z,
              projectile: true,
              byMob: this.owner || undefined,
            });
          }
        }
        return true;
      }
    }
    return false;
  }
}

/**
 * Огненный снаряд игрока (посох). Летит по прямой с лёгкой гравитацией,
 * бьёт мобов и кукол; урон и радиус уже посчитаны при касте.
 */
class Bolt {
  readonly id = nid();
  life = 0;
  constructor(
    public x: number,
    public y: number,
    public z: number,
    public vx: number,
    public vy: number,
    public vz: number,
    public readonly radius: number,
    public readonly hitRadius: number,
    public readonly dmg: number,
    public readonly owner: string,
    public readonly maxLife: number,
    /** 0 — огнешар, 1 — стрела (меньше гравитации, свой вид на клиенте). */
    public readonly kind: number = 0,
    /** АОЕ в точке попадания: радиус (м) и урон в эпицентре. 0 — без сплэша. */
    public readonly splashR: number = 0,
    public readonly splashDmg: number = 0,
    /** Крит: при попадании комната покажет красный «X» в точке. */
    public readonly crit: boolean = false,
  ) {}
}

/** Авторитетная симуляция зоны: мобы, куклы, плевки, снаряды игроков. */
/** Опции моба по описанию ELITE_MOBS — ОДНО место для лагерей, событий и катакомб (раньше два списка расходились). */
export function eliteOpts(d: EliteMobDef): NonNullable<ConstructorParameters<typeof Mob>[3]> {
  return {
    model: d.model, name: d.name, level: d.level, hp: d.hp, dmgMul: d.dmgMul, scaleMul: d.scaleMul, xp: d.xp, ringMul: d.ringMul, sepMul: d.sepMul,
    xpFixed: d.xpFixed, flying: d.flying, visLift: d.visLift, magicMelee: d.magicMelee, physEvery: d.physEvery, rangedArmor: d.rangedArmor, physArmor: d.physArmor, magicArmor: d.magicArmor,
    magicVulnMul: d.magicVulnMul, critVulnMul: d.critVulnMul, spellAoe: d.spellAoe, novaCaster: d.novaCaster, enrageAt: d.enrageAt,
    splitAt: d.splitAt, splitCount: d.splitCount, splitScaleMul: d.splitScaleMul, splitHpFrac: d.splitHpFrac, splitDmgMul: d.splitDmgMul,
    splitSpeedMul: d.splitSpeedMul, splitReviveSec: d.splitReviveSec, splitXp: d.splitXp, splitChildXp: d.splitChildXp,
    sporeCaster: d.sporeCaster, blinker: d.blinker, lifesteal: d.lifesteal, meleeReach: d.meleeReach, attackCooldown: d.attackCooldown,
    speedMul: d.speedMul, dodge: d.dodge, regen: d.regen, puller: d.puller, charger: d.charger, reflector: d.reflector,
    spiker: d.spiker, healer: d.healer, freezer: d.freezer, webber: d.web === true && Math.random() < WEB.share, quietMagic: d.quietMagic, shot: d.shot, leaper: d.leaper, leapCooldown: d.leapCooldown, walksOnly: d.walksOnly, packFrenzy: d.packFrenzy,
    burrower: d.burrower, stormCaller: d.stormCaller, cloner: d.cloner, parry: d.parry, anchored: d.anchored,
    iceGiant: d.iceGiant, lavaRole: d.lavaGuard ? "guard" : d.lavaMage ? "mage" : undefined,
    strikeDelay: d.strikeDelay, respawnSec: d.respawnSec, scrap: d.scrap,
  };
}

/** Катакомбы: сколько секунд тело моба лежит в мире после смерти — клиент проигрывает клип смерти, потом убираем. */
const CAT_CORPSE_LINGER_S = 2;

/** Точка цифр/вспышки попадания по мобу — середина тела (у всех, и у летающих, и у наземных). */
function hitMarkY(m: { y: number; scale: number }): number {
  return m.y + MOB.bodyRadius * m.scale * 1.4;
}

export class ZoneSim {
  /** Админ-панель пульта: false — мобы замирают на месте (не тикают вовсе). */
  mobsEnabled = true;
  readonly mobs = new Map<string, Mob>();
  readonly dummies = new Map<string, Dummy>();
  readonly balls = new Map<string, Ball>();
  readonly bolts = new Map<string, Bolt>();
  /** 🧪 «Метка охотника»: владельцы стрел лука, попавших в моба под СВОЕЙ меткой; разбирает ZoneRoom (markFocusHit). */
  readonly markedArrowHits: string[] = [];
  readonly drops = new Map<string, Drop>();
  private boss!: Mob;
  /** sim-время в секундах (для окна давности вклада в бой с боссом). */
  private elapsed = 0;
  /** Слизни, доспавненные под наплыв игроков (`!play`). Убираются, когда толпа расходится. */
  private readonly extraSlimes = new Map<string, Mob>();
  /** Мобы активного динамического события (этап 14): не возрождаются, при
   *  смерти сразу удаляются, считаются для HUD-строки. */
  readonly eventMobs = new Set<string>();
  /** Сколько мобов события появилось за всё событие (для доли «половина стадии»: убито из появившихся). */
  eventSpawned = 0;
  /** Мобы катакомб (shared/catacombs.ts): не возрождаются, лут роняют, ходят только по открытым залам. */
  readonly catMobs = new Set<string>();
  /** Тела мобов катакомб после смерти: id → сколько секунд ещё лежат (см. CAT_CORPSE_LINGER_S). */
  private readonly lingerDead = new Map<string, number>();
  /** Катакомбы: убрать всех мобов катакомб и отложенные возвращения их големов (у решётки и в конце забега). */
  clearCatMobs(): void {
    for (const id of this.catMobs) this.mobs.delete(id);
    this.catMobs.clear();
    for (let i = this.pendingRevivals.length - 1; i >= 0; i--) {
      const r = this.pendingRevivals[i];
      if (inCatRegion(r.homeX, r.homeZ)) this.pendingRevivals.splice(i, 1);
    }
  }
  /** Статистика забега катакомб: урон по их мобам и убийства по героям (сбрасывает режиссёр). */
  readonly catDamage = new Map<string, number>();
  readonly catKills = new Map<string, number>();
  /** Открытые залы катакомб (шаги catLo..catHi маршрута) — для удержания мобов в стенах. */
  catOpen: readonly number[] = [0];
  /** Кто нанёс урон мобам события — участники (для баффа за победу). */
  readonly eventDamagers = new Set<string>();
  /** Кто больше всех бил убитого дракона охоты — ZoneRoom забирает (титулы). */
  readonly dragonTop: string[] = [];
  /**
   * Уровень героя по его id (sessionId живого игрока или "bot:<ник>") — Sim
   * сам уровней не хранит (это PlayerState в ZoneRoom), комната подставляет
   * реальный лукап при onCreate. Нужен для угасания шанса золотого дропа
   * после 15 уровня (см. spawnLoot, goldDropMulForLevel).
   */
  getAttackerLevel: (id: string) => number = () => 1;
  /**
   * Поджог огнешара бойца `id`: 0 — не поджёг (нет ролла «Поджог» или не выпал шанс), иначе доля
   * макс. HP цели в секунду (от его ИНТ, burnHpFracFor). Решает комната по роллам посоха.
   */
  getIgnite: (id: string) => number = () => 0;
  /** Пронзание: выпало ли стреле бойца `id` пройти насквозь (ролл лука «Пронзание»). Решает комната. */
  rollPierce: (id: string) => boolean = () => false;
  /** Попадание героя по мобу (не тик): комната применяет особые роллы крафта (Холод, Яд). */
  onHeroHit: ((attacker: string, mobId: string, dealt: number) => void) | null = null;

  /**
   * Пронзание: ближайший моб ПОЗАДИ цели — в конусе ±BOW.pierceHalfAngle от направления выстрела
   * (край тела в счёт), не дальше BOW.pierceRange м — получает `dmg`; след стрелы — эффект pierceShot.
   * Один путь для стрел игроков (heroStrike) и ботов (tickBolt).
   */
  pierceBehind(struckId: string, x: number, z: number, dirX: number, dirZ: number, dmg: number, owner: string): boolean {
    const tan = Math.tan(BOW.pierceHalfAngle);
    let best: Mob | null = null;
    let bd = Infinity;
    // Пугала: стрела в пугало пронзает следующее пугало (главное и напарники — одинаково); стрела в
    // настоящего моба пугала не задевает.
    const struck = this.mobs.get(struckId);
    const intoScare = !!struck && (struck.scarecrow || struck.practice);
    for (const m of this.mobs.values()) {
      if (m.dead || m.id === struckId) continue;
      if ((m.scarecrow || m.practice) !== intoScare && (m.scarecrow || m.practice)) continue;
      const vx = m.x - x;
      const vz = m.z - z;
      const t = vx * dirX + vz * dirZ;
      if (t <= 0) continue;
      const d = Math.hypot(vx, vz);
      if (d > BOW.pierceRange + MOB.bodyRadius * m.scale) continue;
      const side = Math.abs(vx * dirZ - vz * dirX);
      if (side > t * tan + MOB.bodyRadius * m.scale) continue;
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    if (!best) return false;
    const len = Math.hypot(best.x - x, best.z - z) || 1;
    this.fx.push({ k: "pierceShot", x, z, x2: best.x, z2: best.z });
    this.hitMob(best.id, dmg, (best.x - x) / len, (best.z - z) / len, owner, true);
    return true;
  }
  /** Целые големы, ждущие своей очереди вернуться (см. splitGolem, tick). */
  private readonly pendingRevivals: {
    at: number;
    kind: MobKind;
    homeX: number;
    homeZ: number;
    opts: ConstructorParameters<typeof Mob>[3];
  }[] = [];

  constructor() {
    for (let i = 0; i < MOB.count; i++) {
      const a = (i / MOB.count) * Math.PI * 2 + 0.4;
      const r = 22 + Math.random() * 12;
      const [x, z] = awayFromHub(Math.cos(a) * r, Math.sin(a) * r - 4);
      const m = new Mob("slime", x, z);
      this.mobs.set(m.id, m);
    }
    const [rMin, rMax] = SPITTER.spawnRadius;
    for (let i = 0; i < SPITTER.count; i++) {
      const a = (i / SPITTER.count) * Math.PI * 2 + 1.1;
      const r = rMin + Math.random() * (rMax - rMin);
      const [x, z] = awayFromHub(Math.cos(a) * r, Math.sin(a) * r - 4);
      const m = new Mob("spitter", x, z);
      this.mobs.set(m.id, m);
    }
    // Лагеря усиленных мобов по свободным местам карты и в начальных залах подземелья.
    const dunCamps: (typeof MOB_CAMPS)[number][] = DUN_MOB_CAMPS.map((d) => {
      const w = dunWorld(d.u, d.v);
      // Вожак есть и в подземелье: первый моб каждой группы (как в лагерях мира).
      return { x: w.x, z: w.z, type: d.type, count: d.count, spread: d.spread, noChamp: d.noChamp, ring: d.ring, dmgMul: d.dmgMul, atkMul: d.atkMul, shareScrap: d.shareScrap };
    });
    for (const camp of [...MOB_CAMPS, ...dunCamps]) {
      const def = ELITE_MOBS[camp.type];
      for (let i = 0; i < camp.count; i++) {
        // jitter — кольцо «неровное»: сдвиг по углу (доля шага между соседями)
        // и по радиусу, чтобы мобы не стояли идеальным кругом.
        const j = camp.jitter ?? 0;
        const a = ((i + (Math.random() - 0.5) * j) / camp.count) * Math.PI * 2 + camp.x;
        const r = camp.ring !== undefined
          ? camp.spread * (camp.ring * (1 + (Math.random() - 0.5) * j) + (Math.random() - 0.5) * 0.1)
          : camp.spread * (0.35 + Math.random() * 0.65);
        const [x, z] = awayFromHub(camp.x + Math.cos(a) * r, camp.z + Math.sin(a) * r);
        // Первый моб каждого лагеря — вожак (цель задания «Вожак» с доски).
        const champ = i === 0 && !camp.noChamp ? QUEST.champ : null;
        const m = new Mob(def.kind, x, z, {
          ...eliteOpts(def),
          campType: camp.type,
          champ: !!champ,
          respawnSec: champ ? CHAMP_RESPAWN : def.respawnSec,
          name: champ ? `Вожак — ${def.name}` : def.name,
          hp: def.hp * (champ?.hpMul ?? 1) * (def.champHpMul ?? 1),
          dmgMul: def.dmgMul * (champ?.dmgMul ?? 1) * (camp.dmgMul ?? 1),
          attackCooldown: (def.attackCooldown ?? MOB.attackCooldown) / (camp.atkMul ?? 1),
          scrapShared: camp.shareScrap === true,
          scaleMul: (def.scaleMul ?? 1) * (champ ? (def.champScaleMul ?? champ.scaleMul) : 1),
          xp: def.xp * (champ?.xpMul ?? 1),
        });
        this.mobs.set(m.id, m);
      }
    }

    // Босс — в дальнем углу, лицом к поляне (центр мира).
    this.boss = new Mob("boss", BOSS.home[0], BOSS.home[1]);
    this.boss.restYaw = Math.atan2(-BOSS.home[0], -BOSS.home[1]);
    this.boss.yaw = this.boss.restYaw;
    this.boss.faceRest = true;
    // 2026-10-07: Багровый выключен на время теста рейд-босса (объект есть — его ждут адаптация/лечение, — но в мире его нет).
    if (BOSS.enabled) this.mobs.set(this.boss.id, this.boss);
    // Рейд-босс «Лунный аватар» — в центре арены на плато горы (shared/raid.ts), стоит на месте.
    {
      const def = ELITE_MOBS[RAID.boss];
      const m = new Mob(def.kind, RAID.x, RAID.z, { ...eliteOpts(def), respawnSec: RAID.respawnSec, boss: true });
      m.restYaw = Math.atan2(-RAID.x, -RAID.z);
      m.yaw = m.restYaw;
      this.raidBossId = m.id;
      this.mobs.set(m.id, m);
    }
    // Пугало — проверка билдов (урон по нему считает scare, см. scareInfo).
    {
      const sc = HUB.training.scarecrow;
      const m = new Mob("slime", sc.x, sc.z, {
        model: "scarecrow", name: "Пугало", level: 0, hp: SCARECROW.hp, scaleMul: SCARECROW.scale, xp: 0, scarecrow: true,
      });
      m.restYaw = Math.atan2(HUB_CENTER.x - sc.x, HUB_CENTER.z - sc.z);
      m.yaw = m.restYaw;
      this.scarecrowId = m.id;
      this.mobs.set(m.id, m);
      // Два пугала-напарника рядом — проверять умения по площади и Пронзание.
      for (const off of HUB.training.practice) {
        const p = new Mob("slime", sc.x + off.dx, sc.z + off.dz, {
          model: "scarecrow", name: "Пугало", level: 0, hp: SCARECROW.hp, scaleMul: SCARECROW.scale, xp: 0, practice: true,
        });
        p.restYaw = m.restYaw;
        p.yaw = p.restYaw;
        this.mobs.set(p.id, p);
      }
    }
    // Чучела — на тренировочной площадке лагеря (HUB).
    for (const t of HUB.training.dummies) {
      const d = new Dummy(t.x, terrainHeight(t.x, t.z), t.z);
      this.dummies.set(d.id, d);
    }
  }

  /**
   * Держать `n` дополнительных слизней на поляне (ZoneRoom зовёт с числом,
   * пропорциональным толпе `!play`-ботов). Меньше — лишних убираем (мёртвых в
   * первую очередь), больше — доспавниваем у случайных точек поляны.
   */
  setExtraSlimes(n: number): void {
    n = Math.max(0, Math.min(40, Math.floor(n)));
    while (this.extraSlimes.size > n) {
      // сперва мёртвые/деспавненные, иначе любой
      let victim: string | undefined;
      for (const [id, m] of this.extraSlimes) {
        if (m.dead) { victim = id; break; }
        victim ??= id;
      }
      if (!victim) break;
      this.extraSlimes.delete(victim);
      this.mobs.delete(victim);
    }
    while (this.extraSlimes.size < n) {
      const a = Math.random() * Math.PI * 2;
      const r = 18 + Math.random() * 16;
      const [x, z] = awayFromHub(Math.cos(a) * r, Math.sin(a) * r - 4);
      const m = new Mob("slime", x, z);
      this.mobs.set(m.id, m);
      this.extraSlimes.set(m.id, m);
    }
  }

  /** Заспавнить моба события в точке (x,z) с разбросом; агрит сразу. Вернёт id. */
  spawnEventMob(
    kind: MobKind,
    x: number,
    z: number,
    opts: ConstructorParameters<typeof Mob>[3] = {},
  ): string {
    const m = new Mob(kind, x, z, opts);
    m.forceAggro();
    this.mobs.set(m.id, m);
    this.eventMobs.add(m.id);
    this.eventSpawned++;
    return m.id;
  }

  /** Сколько живых мобов события осталось. */
  eventMobsLeft(): number {
    let n = 0;
    for (const id of this.eventMobs) {
      const m = this.mobs.get(id);
      if (m && !m.dead) n++;
    }
    return n;
  }

  /** Снять всех мобов события (событие утихло/зачищено). */
  clearEventMobs(): void {
    for (const id of this.eventMobs) this.mobs.delete(id);
    this.eventMobs.clear();
  }

  /** Россыпь зелий в точке (награда за событие). */
  /** Награда за событие — зелья РАЗБРОСАНЫ по площадке (spread — радиус, м). */
  dropPotions(x: number, z: number, count: number, spread = 6): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = spread * (0.35 + Math.random() * 0.65);
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      const d = new Drop("potion", 1, px, terrainHeight(px, pz) + BAG.dropHeight, pz);
      this.drops.set(d.id, d);
    }
  }

  /** id пугала лагеря (SCARECROW). */
  scarecrowId = "";
  /** id рейд-босса (Лунный аватар, shared/raid.ts) — цель !raid. */
  raidBossId = "";
  /** Доля урона атакующего по рейд-боссу (ставит ZoneRoom по бою raidFight): 0 — «MISS»; null — полный всегда. */
  raidDmgMul: ((attacker: string) => number) | null = null;
  /**
   * Добыча обычного моба — сразу в инвентарь убийцы (ставит ZoneRoom). Возвращает, сколько НЕ влезло:
   * остаток падает на землю. Не задано, босс и катакомбы — всё падает на землю, как раньше.
   */
  lootSink: ((owner: string, loot: { id: ItemId; count: number; instance?: WeaponInstance; armor?: ArmorInstance }) => number) | null = null;
  /** Бьёт ли владелец молотом (для уязвимости «Цепной молнии»). */
  hammerHit: ((owner: string) => boolean) | null = null;
  /** Текущая сессия урона по пугалу: кто бьёт, когда начал/последний удар, сумма, самый сильный удар. */
  private readonly scares = new Map<string, { by: string; start: number; last: number; total: number; max: number }>();
  /** Табло пугала: кто бьёт, урон в секунду, самый сильный удар (null — давно никто не бил). */
  /** Табло своего пугала (у каждого — своя сессия: главное и напарники). */
  scareInfo(mobId: string = this.scarecrowId): { by: string; dps: number; max: number } | null {
    const s = this.scares.get(mobId);
    if (!s || this.elapsed - s.last > SCARECROW.idleSec) return null;
    // Время — от первого удара до сейчас (минимум 1 с), пока бой идёт.
    const t = Math.max(1, Math.min(this.elapsed, s.last + 1) - s.start);
    return { by: s.by, dps: s.total / t, max: s.max };
  }

  /** Эффекты не от конкретного моба (колючки на земле и т.п.) — ZoneRoom разошлёт и очистит. */
  readonly fx: MobFx[] = [];
  /** Колючки Шипохвоста на земле. */
  private readonly caltrops: { x: number; z: number; t: number; tickT: number; r: number; slowSec: number; slowFrac: number; dmg: number; owner: string }[] = [];

  /**
   * Выстрел моба 40 ур. своим снарядом (MobShot): копьё — одно и пробивает,
   * шипы — веером. Прицел — в грудь цели с поправкой на гравитацию вида.
   */
  private shoot(mob: Mob, target: SimPlayer): void {
    const s = mob.shot!;
    const k = SHOTS[s.kind];
    const n = Math.max(1, s.count ?? 1);
    const mx = mob.x;
    const my = mob.y + MOB.bodyRadius * mob.scale;
    const mz = mob.z;
    const L = Math.hypot(target.x - mx, target.z - mz) || 1;
    const t = L / s.speed;
    const vy = (target.y - 0.4 + 0.5 * k.grav * t * t - my) / t;
    const yaw0 = Math.atan2(target.x - mx, target.z - mz);
    const spread = s.spread ?? 0;
    for (let i = 0; i < n; i++) {
      if (this.balls.size >= SPITTER.maxBalls) {
        const first = this.balls.keys().next().value as string | undefined;
        if (first) this.balls.delete(first);
      }
      const yaw = n > 1 ? yaw0 - spread + (2 * spread * i) / (n - 1) : yaw0;
      const b = new Ball(mx, my, mz, Math.sin(yaw) * s.speed, vy, Math.cos(yaw) * s.speed, false, mob.id, mob.dmgMul, 0, 0, {
        code: k.code,
        grav: k.grav,
        radius: k.radius,
        dmgMul: s.dmg,
        pierce: s.pierce,
        bleed: s.bleed,
        caltrops: s.caltrops,
      });
      this.balls.set(b.id, b);
    }
  }

  /** Снаряд упал мимо: шипы остаются колючками. */
  private readonly onBallLand = (b: Ball): void => {
    const c = b.extra?.caltrops;
    if (!c) return;
    if (this.caltrops.length >= 60) this.caltrops.shift();
    this.caltrops.push({
      x: b.x, z: b.z, t: c.sec, tickT: 0, r: c.radius, slowSec: c.slowSec, slowFrac: c.slowFrac,
      dmg: SPITTER.ballDamage * b.dmgMul * b.extra!.dmgMul * c.dmgFrac, owner: b.owner,
    });
    this.fx.push({ k: "caltrops", x: b.x, z: b.z, d: c.sec, r: c.radius });
  };

  /** Колючки: каждые полсекунды — укол и замедление тем, кто в них стоит. */
  private tickCaltrops(dt: number, players: SimPlayer[], hits: PlayerHit[]): void {
    for (let i = this.caltrops.length - 1; i >= 0; i--) {
      const c = this.caltrops[i];
      c.t -= dt;
      if (c.t <= 0) {
        this.caltrops.splice(i, 1);
        continue;
      }
      c.tickT -= dt;
      if (c.tickT > 0) continue;
      c.tickT = 0.5;
      for (const p of players) {
        if (Math.hypot(p.x - c.x, p.z - c.z) > c.r) continue;
        hits.push({
          target: p.sessionId, dmg: c.dmg, fromX: c.x, fromZ: c.z, projectile: false, dot: true, phys: true,
          byMob: c.owner || undefined, slowSec: c.slowSec, slowFrac: c.slowFrac,
        });
      }
    }
  }

  tick(dt: number, players: SimPlayer[]): PlayerHit[] {
    // Угроза только к тем, кого сейчас видят: скрытые (тень, безопасная зона) забываются.
    if (this.mobs.size) {
      const visible = new Set(players.map((p) => p.sessionId));
      for (const m of this.mobs.values()) for (const id of [...m.threat.keys()]) if (!visible.has(id)) m.threat.delete(id);
    }
    const hits: PlayerHit[] = [];
    const spit = (mob: Mob, target: SimPlayer, web = false): void => {
      // «Пелена смерти»: из дыма не стреляют, и в героя, стоящего в дыму, — тоже (не видят цель).
      if (this.inSmoke(mob.x, mob.z) || this.inSmoke(target.x, target.z)) return;
      if (mob.shot) {
        this.shoot(mob, target);
        return;
      }
      if (this.balls.size >= SPITTER.maxBalls) {
        const first = this.balls.keys().next().value as string | undefined;
        if (first) this.balls.delete(first);
      }
      const mx = mob.x;
      const my = mob.y + MOB.bodyRadius;
      const mz = mob.z;
      const aimX = target.x;
      const aimZ = target.z;
      let aimY = target.y - 0.4;
      const L = Math.hypot(aimX - mx, aimZ - mz);
      const t = L / SPITTER.ballSpeed;
      aimY += 0.5 * SPITTER.ballGravity * t * t;
      let dx = aimX - mx;
      let dy = aimY - my;
      let dz = aimZ - mz;
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl;
      dy /= dl;
      dz /= dl;
      const b = new Ball(
        mx,
        my,
        mz,
        dx * SPITTER.ballSpeed,
        dy * SPITTER.ballSpeed,
        dz * SPITTER.ballSpeed,
        mob.kind === "boss",
        mob.id,
        mob.dmgMul,
        mob.spellAoe ? MAGE_SPELL.splashRadius : 0,
        mob.spellAoe ? MAGE_SPELL.splashFrac : 0,
        web ? { code: SHOTS.web.code, grav: SHOTS.web.grav, radius: SHOTS.web.radius, dmgMul: WEB.dmgMul, root: WEB.rootSec, webStack: true } : null,
      );
      this.balls.set(b.id, b);
    };

    this.elapsed += dt;
    // Целые големы, дождавшиеся своей очереди (см. splitGolem) — вернуть на
    // их собственное место спавна в лагере, не туда, где погиб осколок.
    for (let i = this.pendingRevivals.length - 1; i >= 0; i--) {
      const r = this.pendingRevivals[i];
      if (this.elapsed < r.at) continue;
      this.pendingRevivals.splice(i, 1);
      const revived = new Mob(r.kind, r.homeX, r.homeZ, r.opts);
      this.mobs.set(revived.id, revived);
    }
    // Тела катакомб уходят из мира, когда клиент уже проиграл смерть.
    for (const [id, left] of this.lingerDead) {
      if (left - dt <= 0) {
        this.lingerDead.delete(id);
        this.mobs.delete(id);
      } else this.lingerDead.set(id, left - dt);
    }
    // Катакомбы: моб знает открытые залы (таран и рывок не уводят его за стены).
    for (const m of this.mobs.values()) m.catHalls = this.catMobs.has(m.id) ? this.catOpen : null;
    // 🧪 «Стрела-призрак»: обычным мобам и их снарядам — герои без призраков, боссам — все.
    const seen = players.some((p) => p.ghost) ? players.filter((p) => !p.ghost) : players;
    if (this.mobsEnabled) for (const m of this.mobs.values()) m.tick(dt, seesGhosts(m) ? players : seen, hits, spit);
    // Упавший моб: сорвался с уступа подземелья и застрял в провале — ниже поверхности больше чем на 50 м
    // и не на полу (ни вне подземелья, ни в его зале/коридоре). Такой моб не виден игрокам и не возвращается —
    // отправляем его домой, в свой лагерь.
    for (const m of this.mobs.values()) {
      if (m.dead || m.y > -50 || this.catMobs.has(m.id)) continue;
      if (inDunRegion(m.x, m.z) && dunFloorLocal(m.x - DUN_X, m.z - DUN_Z, MOB.bodyRadius * m.scale) !== null) continue;
      m.x = m.homeX;
      m.z = m.homeZ;
      m.y = terrainHeight(m.x, m.z) + 5;
      m.vx = m.vy = m.vz = 0;
    }
    // Подземелье: мобы не уходят за ограду (край моста, уступа, стена провала) — та же граница, что у героев.
    for (const m of this.mobs.values()) {
      if (m.dead || !inDunRegion(m.x, m.z)) continue;
      const ox = m.x;
      const oz = m.z;
      const [px, pz] = dunProject(m.x, m.z, MOB.bodyRadius * m.scale, m.y);
      // Перенос дальше DUN_SNAP_MAX — это не «подтянуть к краю», а прыжок через провал в соседний зал:
      // моб, шагнувший в пустоту по прямой (погоня, возврат домой), остаётся на месте, а не оказывается за пропастью.
      if (Math.hypot(px - ox, pz - oz) > DUN_SNAP_MAX && dunFloorLocal(ox - DUN_X, oz - DUN_Z, 0.4) !== null) {
        m.vx = 0;
        m.vz = 0;
        continue;
      }
      m.x = px;
      m.z = pz;
      if (m.x === ox && m.z === oz) continue;
      // Скорость наружу за ограду гасим, иначе моб упирался бы в край и дрожал.
      const nx = ox - m.x;
      const nz = oz - m.z;
      const nl = Math.hypot(nx, nz) || 1;
      const out = (m.vx * nx + m.vz * nz) / nl;
      if (out > 0) {
        m.vx -= (nx / nl) * out;
        m.vz -= (nz / nl) * out;
      }
      // Высота — по полу в точке, куда моба вернули (как у катакомб).
      const want = terrainHeight(m.x, m.z);
      if (Math.abs(m.y - want) > 4) {
        m.y = want;
        m.vy = 0;
        m.grounded = true;
      }
    }
    // Катакомбы: стены — моб не выходит из открытых залов/коридоров.
    if (this.catMobs.size) {
      for (const id of this.catMobs) {
        const m = this.mobs.get(id);
        if (!m || m.dead) continue;
        [m.x, m.z] = catProject(m.x, m.z, this.catOpen, MOB.bodyRadius * m.scale * 0.8);
        // Высота — по полу в точке, куда моба вернули. Если за тик он стоял за стеной (или за краем
        // подземелья), его высота считалась по поверхности: без этого он висел бы у потолка.
        const want = terrainHeight(m.x, m.z) + (m.flying ? 1.35 : 0);
        if (Math.abs(m.y - want) > 4) {
          m.y = want;
          if (!m.flying) {
            m.vy = 0;
            m.grounded = true;
          }
        }
      }
    }
    // Отражённый щитом Ледяного демона урон (накоплен в hitMob).
    if (this.reflectHits.length) {
      hits.push(...this.reflectHits);
      this.reflectHits.length = 0;
    }
    // Лечение Костяного вождя: себя и мобов вокруг.
    for (const m of this.mobs.values()) {
      if (!m.healReq) continue;
      m.healReq = false;
      for (const o of this.mobs.values()) {
        if (o.dead || Math.hypot(o.x - m.x, o.z - m.z) > CHIEF_HEAL.radius) continue;
        o.hp = Math.min(o.maxHp, o.hp + o.maxHp * CHIEF_HEAL.frac);
      }
    }
    // Теневые копии: настоящего ниндзя нет (погиб/исчез) — рассеиваются в дым.
    for (const [id, m] of this.mobs) {
      if (!m.cloneOf) continue;
      const parent = this.mobs.get(m.cloneOf);
      if (parent && !parent.dead) continue;
      this.fx.push({ k: "ninjaSmoke", x: m.x, z: m.z });
      this.mobs.delete(id);
    }
    this.tickBurning(dt);
    this.separateMobs(players);
    for (const d of this.dummies.values()) d.tick(dt);
    for (const [id, b] of this.balls) if (b.tick(dt, seen, hits, this.onBallLand)) this.balls.delete(id);
    this.tickCaltrops(dt, seen, hits);
    for (const [id, bo] of this.bolts) if (this.tickBolt(bo, dt)) this.bolts.delete(id);
    for (const [id, d] of this.drops) if (d.tick(dt)) this.drops.delete(id);
    // Полученный от босса урон — тоже вклад в бой (танк/приманка).
    const boss = this.boss;
    if (boss && !boss.dead) {
      for (const h of hits) {
        if (h.byMob === boss.id) boss.bump(h.target, "taken", h.dmg, this.elapsed);
      }
    }
    return hits;
  }

  /**
   * Мобы не влезают друг в друга: раздвигаем пересекающиеся тела после хода.
   * Босс «тяжёлый» — мелочь расступается перед ним, сам он не сдвигается.
   * Только позиция (не скорость): скорость крутит логика прыжков, а тут нужен
   * лишь запрет на наложение — иначе стая пчёл слипается в один комок.
   */
  private separateMobs(players: SimPlayer[]): void {
    const list: Mob[] = [];
    // Пугала (тренировка и напарники) — насквозь: ни толкать, ни толкаться не должны.
    for (const m of this.mobs.values()) if (!m.dead && !m.scarecrow && !m.practice) list.push(m);
    const bodyR = (m: Mob): number =>
      MOB.bodyRadius * m.scale * m.sepMul * (m.kind === "boss" ? BOSS.bodyMult : 1);
    // Толпа не вдавливает моба в героя: герой — препятствие (см. Mob.tick), сдвиг глубже в него не делаем.
    const intoHero = (m: Mob, nx: number, nz: number): boolean => {
      const r = PLAYER.radius + bodyR(m);
      for (const p of players) {
        const dn = Math.hypot(nx - p.x, nz - p.z);
        if (dn < r && dn < Math.hypot(m.x - p.x, m.z - p.z)) return true;
      }
      return false;
    };
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const ar = bodyR(a);
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const clr = ar + bodyR(b);
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        if (dx > clr || dx < -clr || dz > clr || dz < -clr) continue;
        const d2 = dx * dx + dz * dz;
        if (d2 >= clr * clr) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-4) {
          // Ровно друг в друге — расталкиваем по детерминированной оси.
          const ang = (i * 2.399963 + j) % (Math.PI * 2);
          dx = Math.cos(ang);
          dz = Math.sin(ang);
          d = 1e-4;
        } else {
          dx /= d;
          dz /= d;
        }
        const over = clr - d;
        const aBoss = a.kind === "boss" || a.scarecrow;
        const bBoss = b.kind === "boss" || b.scarecrow;
        // Доля коррекции: тяжёлый (босс) стоит, лёгкий уходит на всю глубину.
        const wa = aBoss === bBoss ? 0.5 : aBoss ? 0 : 1;
        const wb = 1 - wa;
        // Толпа не выдавливает моба на крутой склон (MAX_CLIMB).
        if (wa > 0) {
          const [sx, sz] = a.flying ? [-dx * over * wa, -dz * over * wa] : climbStep(a.x, a.z, -dx * over * wa, -dz * over * wa);
          if (!intoHero(a, a.x + sx, a.z + sz)) {
            a.x += sx;
            a.z += sz;
          }
        }
        if (wb > 0) {
          const [sx, sz] = b.flying ? [dx * over * wb, dz * over * wb] : climbStep(b.x, b.z, dx * over * wb, dz * over * wb);
          if (!intoHero(b, b.x + sx, b.z + sz)) {
            b.x += sx;
            b.z += sz;
          }
        }
      }
    }
  }

  /** Запустить огненный снаряд игрока. */
  castBolt(
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
    speed: number,
    radius: number,
    hitRadius: number,
    dmg: number,
    owner: string,
    life: number,
    kind = 0,
    splashR = 0,
    splashDmg = 0,
    crit = false,
  ): void {
    if (this.bolts.size >= 24) {
      const first = this.bolts.keys().next().value as string | undefined;
      if (first) this.bolts.delete(first);
    }
    const dl = Math.hypot(dx, dy, dz) || 1;
    const b = new Bolt(
      x, y, z,
      (dx / dl) * speed, (dy / dl) * speed, (dz / dl) * speed,
      radius, hitRadius, dmg, owner, life, kind, splashR, splashDmg, crit,
    );
    this.bolts.set(b.id, b);
  }

  /** true — снаряд отработал, удалить. */
  private tickBolt(b: Bolt, dt: number): boolean {
    const px = b.x;
    const py = b.y;
    const pz = b.z;
    b.vy -= SPITTER.ballGravity * (b.kind === 1 ? 0.5 : 0.35) * dt; // стрела чуть проседает
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    b.life += dt;
    if (b.life > b.maxLife) return true;
    if (b.y <= terrainHeight(b.x, b.z)) {
      // Огнешар в землю — всё равно рвётся: можно бить по ногам толпы.
      this.splashDamage(b.x, b.y, b.z, b.splashR, b.splashDmg, "", b.owner, true, b.kind === 0);
      return true;
    }

    for (const m of this.mobs.values()) {
      if (m.dead) continue;
      const r = b.hitRadius + MOB.bodyRadius * m.scale + (m.flying ? FLYER_HIT_BONUS : 0);
      const d = segDist(px, py, pz, b.x, b.y, b.z, m.x, m.y + m.liftM, m.z, m.x, m.y + m.liftM + MOB.bodyRadius * m.scale, m.z);
      if (d < r) {
        const vh = Math.hypot(b.vx, b.vz) || 1;
        if (b.crit) this.critHits.push({ x: m.x, y: m.y, z: m.z, owner: b.owner });
        const magic = b.kind === 0; // 0 — огнешар (магия), 1 — стрела (физика)
        this.hitMob(m.id, b.dmg, b.vx / vh, b.vz / vh, b.owner, true, false, magic, b.crit);
        if (b.kind === 1 && m.markT > 0 && m.markBy === b.owner) this.markedArrowHits.push(b.owner);
        // Поджог — ролл посоха «Поджог» (раньше врождённый): горит и прямая цель, и задетые АОЕ (ниже).
        // ДпС — от МАКСИМАЛЬНОГО HP цели, не от урона удара (см. AFFIX.fire).
        if (magic) {
          const f = this.getIgnite(b.owner);
          if (f > 0) m.ignite(m.pctHpBase * f, AFFIX.fire.burnSec, b.owner);
        }
        // Пронзание (ролл лука): стрела летит дальше — моб позади цели получает долю урона.
        if (b.kind === 1 && this.rollPierce(b.owner)) this.pierceBehind(m.id, m.x, m.z, b.vx / vh, b.vz / vh, b.dmg * BOW.pierceDmg, b.owner);
        // Соседям — доля урона, спадающая к краю (прямая цель уже получила своё).
        this.splashDamage(b.x, b.y, b.z, b.splashR, b.splashDmg, m.id, b.owner, true, magic);
        return true;
      }
    }
    for (const d of this.dummies.values()) {
      if (d.dead) continue;
      const dist = segDist(px, py, pz, b.x, b.y, b.z, d.x, d.y, d.z, d.x, d.y + 0.9, d.z);
      if (dist < b.hitRadius + 0.5) {
        this.hitDummy(d.id, b.dmg);
        return true;
      }
    }
    return false;
  }

  /**
   * Опыт за добитых мобов, поделённый между всеми, кто нанёс урон (босс —
   * гибридно, обычные мобы — пропорционально урону). Комната разошлёт.
   */
  readonly bossXpShare: { owner: string; frac: number; lvl: number }[] = [];
  /** Доля убийства моба (с вкладом) и его уровень: опыт игроку считает комната по его уровню (killXp). */
  readonly mobXpShare: { owner: string; frac: number; lvl: number; fixed?: number }[] = [];
  /** Криты снарядов за тик: где показать красный «X». Комната разошлёт и очистит. */
  readonly critHits: { x: number; y: number; z: number; owner: string }[] = [];
  /** Числа урона у спектатора (?dmgNumbers) — комната сама решает, слать ли (см. state.dmgNumbers). */
  readonly dmgHits: { x: number; y: number; z: number; dmg: number; by?: string; mob?: string; c?: DmgHitColor }[] = [];
  /** Моб увернулся от удара героя (или неуязвим) — ZoneRoom покажет «MISS» над промахнувшимся героем. */
  /** Отражённый щитом урон — уходит в hits на следующем тике. */
  private readonly reflectHits: PlayerHit[] = [];
  readonly mobMisses: { mobId: string; attacker: string; x: number; y: number; z: number }[] = [];
  /** Добивания за тик: кто и кого добил (для счётчика kills и кил-фида). */
  /** jm — множитель шанса колец/камней (shared/jewels.ts RING): 0 — не роняет (фантомы, осколки); jl — уровень моба для золотого/уникального кольца. */
  readonly mobKills: { owner: string; kind: MobKind; name: string; campType: string; champ: boolean; jm: number; jr: number; jl: number; sc: number; /** Кто бил (делёжка лома), null — не делится. */ pt: string[] | null; quest: string[] }[] = [];

  /** Множитель шанса колец/камней с моба: фантомы/осколки — 0, боссы — RING.bossMul, элита — RING.eliteMul. */
  private jewelMul(m: Mob): number {
    if (m.cloneOf || m.kind === "shard" || m.scarecrow || m.practice) return 0;
    if (m.kind === "boss" || m.id === this.raidBossId) return RING.bossMul;
    return m.eliteName ? RING.eliteMul : 1;
  }

  /** Уровень моба для золотого и уникального кольца (RING_LEVEL_GATE). У Багрового (kind boss) уровня нет — без гейта, как и его броня. */
  private jewelLevel(m: Mob): number {
    return m.kind === "boss" ? RING_LEVEL_GATE.full : m.eliteLevel;
  }

  /** Урон по мобу. Возвращает kind добитого моба (null — не убит). */
  /** Тик горения (врождённый поджог мага): DoT по всем тлеющим мобам, опыт — поджёгшему. */
  private tickBurning(dt: number): void {
    for (const m of this.mobs.values()) {
      for (const [ch, venom] of [[m.plague, false], [m.venom, true]] as const) {
        if (ch.burstCd > 0) ch.burstCd -= dt;
        if (m.dead || ch.stacks <= 0) continue;
        ch.t -= dt;
        const hp0 = m.hp;
        const x = m.x;
        const y = hitMarkY(m);
        const z = m.z;
        // Яд — магический урон: физическая броня моба на него не действует, магическая уязвимость — действует.
        this.hitMob(m.id, ch.dps * ch.stacks * dt, 0, 0, ch.by, false, true, true);
        ch.shown += Math.max(0, hp0 - (m.dead ? 0 : m.hp));
        ch.showT += dt;
        if (ch.t <= 0) ch.stacks = 0;
        if (ch.shown >= 1 && (ch.showT >= 1 || m.dead || ch.stacks === 0)) {
          this.dmgHits.push({ x, y, z, dmg: Math.round(ch.shown), by: ch.by || undefined, mob: m.id, c: venom ? "venom" : "poison" });
          ch.shown = 0;
          ch.showT = 0;
        }
      }
    }
    for (const m of this.mobs.values()) {
      if (m.dead || m.bleedT <= 0) continue;
      m.bleedT -= dt;
      const hp0 = m.hp;
      const x = m.x;
      const y = hitMarkY(m);
      const z = m.z;
      this.hitMob(m.id, m.bleedDps * dt, 0, 0, m.bleedBy, false, true);
      m.bleedShown += Math.max(0, hp0 - (m.dead ? 0 : m.hp));
      m.bleedShowT += dt;
      if (m.bleedShowT >= 1 || m.dead || m.bleedT <= 0) {
        if (m.bleedShown >= 1) this.dmgHits.push({ x, y, z, dmg: Math.round(m.bleedShown), by: m.bleedBy || undefined, mob: m.id, c: "bleed" });
        this.bleedTicks.push({ x, y: m.y, z, mobId: m.id, by: m.bleedBy });
        m.bleedShown = 0;
        m.bleedShowT = 0;
      }
    }
    for (let i = this.smokes.length - 1; i >= 0; i--) if (this.elapsed > this.smokes[i].until) this.smokes.splice(i, 1);
    for (const m of this.mobs.values()) {
      if (m.dead || m.burningT <= 0) continue;
      m.burningT = Math.max(0, m.burningT - dt);
      const tick = m.burnDps * dt;
      if (tick > 0) this.hitMob(m.id, tick, 0, 0, m.burnBy, false, true);
      if (m.burningT <= 0) {
        m.burnDps = 0;
        m.burnBy = "";
      }
    }
  }

  hitMob(
    id: string,
    dmg: number,
    dx: number,
    dz: number,
    attacker = "",
    /** true — попадание ДАЛЬНЕГО боя (стрела/огнешар/град): учитываем rangedArmor. */
    rangedHit = false,
    /** true — тик горения: без кулдауна удара, без вздрагивания/звука. */
    dot = false,
    /** true — урон магией (огнешар/АОЕ): physArmor не действует, magicVulnMul и magicArmor — действуют. */
    magic = false,
    /** true — крит (сейчас только лук): учитываем critVulnMul. */
    crit = false,
    /** Пробивание (кольца, урон умений): доля брони моба (физ., маг., от дальних), которую удар не замечает. */
    pen = 0,
  ): MobKind | null {
    const m = this.mobs.get(id);
    if (!m) return null;
    // Неуязвим (щит Владыки Бездны в катакомбах): удары — «MISS», урона нет.
    if (m.immune && !m.dead) {
      if (!dot) this.mobMisses.push({ mobId: m.id, attacker, x: m.x, y: m.y + MOB.bodyRadius * m.scale * 2 + 1.2, z: m.z });
      return null;
    }
    // Рейд-босс: ранить можно только с арены (иначе «MISS»), из разрыва орбиты — полный урон, вне — доля
    // (server/rooms/raidFight.ts hitMul).
    if (m.id === this.raidBossId && this.raidDmgMul && !m.dead) {
      const mul = this.raidDmgMul(attacker);
      if (mul <= 0) {
        if (!dot) this.mobMisses.push({ mobId: m.id, attacker, x: m.x, y: m.y + MOB.bodyRadius * m.scale * 2 + 1.2, z: m.z });
        return null;
      }
      dmg *= mul;
    }
    // Теневой ниндзя в стойке: удар отбит («MISS»), ударившему — контрудар (не чаще counterGap).
    if (m.parryT > 0 && !dot && !m.dead && attacker) {
      this.mobMisses.push({ mobId: m.id, attacker, x: m.x, y: m.y + MOB.bodyRadius * m.scale * 2 + 1.2, z: m.z });
      const last = m.parryHitAt.get(attacker) ?? -99;
      if (this.elapsed - last >= PARRY.counterGap) {
        m.parryHitAt.set(attacker, this.elapsed);
        this.reflectHits.push({ target: attacker, dmg: MOB.attackDamage * m.dmgMul * PARRY.counterMul, fromX: m.x, fromZ: m.z, projectile: false, byMob: m.id });
        this.fx.push({ k: "parryHit", x: m.x, z: m.z });
      }
      return null;
    }
    if (!dot && m.dodge > 0 && !m.dead && Math.random() < m.dodge) {
      m.forceAggroIfIdle();
      this.mobMisses.push({ mobId: m.id, attacker, x: m.x, y: m.y + MOB.bodyRadius * m.scale * 2 + 1.2, z: m.z });
      return null;
    }
    const armorK = 1 - Math.max(0, Math.min(1, pen));
    if (rangedHit && m.rangedArmor > 0) dmg *= 1 - m.rangedArmor * armorK;
    if (!magic && m.physArmor > 0) dmg *= 1 - m.physArmor * armorK;
    if (magic && m.magicVulnMul !== 1) dmg *= m.magicVulnMul;
    if (magic && m.magicArmor > 0) dmg *= 1 - m.magicArmor * armorK;
    if (crit && m.critVulnMul !== 1) dmg *= m.critVulnMul;
    if (m.markT > 0) dmg *= m.markMul; // «Метка»: +25% урона от всех атакующих
    if (m.vulnT > 0 && attacker && this.hammerHit?.(attacker)) dmg *= m.vulnMul; // «Цепная молния»: по молоту — больше
    // Вклад считаем по ФАКТИЧЕСКИ снятому HP: оверкилл сверх остатка не должен раздувать долю.
    // Дракон охоты (hitCounter): здоровье — удары, попадание снимает одно; вклад, цифры и DPS — по урону.
    if (m.hitCounter && attacker && !m.dead && !m.hitters.has(attacker)) {
      // Новый бьющий — дракону ещё доля ударов (первый бьющий — уже в запасе при появлении).
      if (m.hitters.size > 0 && !m.hitsFixed) {
        m.maxHp += EVENT.eliteHunt.hitsPerHero;
        m.hp += EVENT.eliteHunt.hitsPerHero;
      }
      m.hitters.add(attacker);
    }
    const hpBefore = m.hp;
    const killed = m.applyHit(m.hitCounter ? (dot ? 0 : 1) : dmg, dx, dz, dot);
    const dealt = m.hitCounter ? (hpBefore > 0 ? Math.max(0, dmg) : 0) : Math.max(0, hpBefore - m.hp);
    if (m.hitCounter && dealt > 0) m.noteDamage(dealt, Date.now(), EVENT.eliteHunt.dpsWindow);
    if (attacker) m.addThreat(attacker, dealt);
    // Пугало: копим сессию урона бойца (новый боец или пауза дольше idleSec — заново).
    // У каждого пугала (главного и напарников) — своё табло DPS.
    if ((m.scarecrow || m.practice) && attacker && dealt > 0) {
      const s = this.scares.get(m.id);
      if (!s || s.by !== attacker || this.elapsed - s.last > SCARECROW.idleSec) {
        this.scares.set(m.id, { by: attacker, start: this.elapsed, last: this.elapsed, total: dealt, max: dealt });
      } else {
        s.total += dealt;
        s.max = Math.max(s.max, dealt);
        s.last = this.elapsed;
      }
    }
    // Ярость стаи (Скалолом): гибель сородича злит соседей того же лагеря.
    if (killed && m.packFrenzy && m.campType) {
      for (const o of this.mobs.values()) {
        if (o !== m && !o.dead && o.campType === m.campType && Math.hypot(o.x - m.x, o.z - m.z) < PACK_FRENZY.radius) o.frenzy(PACK_FRENZY.sec);
      }
    }
    // Щит Ледяного демона: часть снятого урона летит обратно в атакующего.
    if (m.reflectT > 0 && attacker && dealt > 0 && !dot) {
      this.reflectHits.push({
        target: attacker,
        dmg: dealt * REFLECT.frac,
        fromX: m.x,
        fromZ: m.z,
        projectile: false,
        byMob: m.id,
      });
    }
    if (attacker && dealt > 0 && this.catMobs.has(id)) this.catDamage.set(attacker, (this.catDamage.get(attacker) ?? 0) + dealt);
    if (attacker && dealt > 0) {
      m.bump(attacker, "dmg", dealt, this.elapsed);
      // Участников лома берём до того, как опыт поделит и очистит вклад (splitXpPool).
      if (killed && m.scrapShared) m.scrapParts = this.contribParts(m);
      if (this.eventMobs.has(id)) this.eventDamagers.add(attacker);
      if (!dot && !m.dead) this.onHeroHit?.(attacker, id, dealt);
    }
    if (dealt > 0 && !dot) {
      this.dmgHits.push({
        x: m.x,
        y: hitMarkY(m),
        z: m.z,
        dmg: Math.round(dealt),
        by: attacker || undefined,
        mob: id,
      });
    }

    if (m.kind === "boss" && m.pendingSplit) {
      m.pendingSplit = false;
      this.spawnShards(m);
    }

    // Проверяем СРАЗУ по факту этого удара (hpBefore), не на следующем тике —
    // иначе при переборе (один удар и ниже порога, и в 0 HP разом) раскол не
    // успевал бы сработать до обработки смерти (см. Mob.checkSplitThreshold).
    if (m.checkSplitThreshold(hpBefore)) {
      // Голем «побеждён» раколом: кольца, лом, задания и счёт — сразу (осколки сами наград не дают; раньше — только вожак).
      if (attacker) this.mobKills.push({ owner: attacker, kind: m.kind, name: m.eliteName, campType: m.campType, champ: m.champ, jm: this.jewelMul(m), jr: m.ringMul, jl: this.jewelLevel(m), sc: m.scrapN, pt: m.scrapParts, quest: this.questCredit(m, attacker) });
      this.splitGolem(m);
      return null;
    }

    // 45 ур. Теневой ниндзя: на пороге здоровья — дым и теневые копии (сами копии не размножаются).
    if (!killed && m.cloner && !m.cloneOf && m.cloneStep < CLONES.at.length && m.hp / m.maxHp <= CLONES.at[m.cloneStep]) {
      m.cloneStep++;
      this.spawnClones(m);
    }

    if (!killed) return null;
    const kind = m.kind;
    const quest = this.questCredit(m, attacker || null);

    if (this.catMobs.has(m.id)) {
      // Катакомбы: не возрождается, но лут роняет как обычный (награда по пути).
      this.catMobs.delete(m.id);
      // Тело лежит ещё CAT_CORPSE_LINGER_S — иначе клиент не видит смерть и моб просто пропадает.
      m.keepDead();
      this.lingerDead.set(m.id, CAT_CORPSE_LINGER_S);
      if (attacker) this.catKills.set(attacker, (this.catKills.get(attacker) ?? 0) + 1);
      this.spawnLoot(m, attacker);
      this.splitMobXp(m);
      if (attacker) this.mobKills.push({ owner: attacker, kind, name: m.eliteName, campType: m.campType, champ: m.champ, jm: this.jewelMul(m), jr: m.ringMul, jl: this.jewelLevel(m), sc: m.scrapN, pt: m.scrapParts, quest });
      return kind;
    }
    if (kind === "shard" || this.eventMobs.has(m.id) || m.cloneOf) {
      this.eventMobs.delete(m.id);
      this.mobs.delete(m.id); // осколки и мобы события не возрождаются
      if (kind !== "shard") this.splitMobXp(m);
      if (attacker && kind !== "shard") {
        this.mobKills.push({ owner: attacker, kind, name: m.eliteName, campType: m.campType, champ: m.champ, jm: this.jewelMul(m), jr: m.ringMul, jl: this.jewelLevel(m), sc: m.scrapN, pt: m.scrapParts, quest });
      }
      return kind;
    } else {
      const rolled = this.spawnLoot(m, attacker);
      if (kind === "boss") {
        this.bossLoot.length = 0;
        this.bossLoot.push(...rolled);
      }
    }
    if (kind === "boss") {
      // Босс пал — осколки осыпаются.
      for (const [sid, s] of this.mobs) if (s.kind === "shard") this.mobs.delete(sid);
      this.splitBossXp(m);
    } else {
      this.splitMobXp(m);
    }
    if (attacker) {
      this.mobKills.push({ owner: attacker, kind, name: m.eliteName, campType: m.campType, champ: m.champ, jm: this.jewelMul(m), jr: m.ringMul, jl: this.jewelLevel(m), sc: m.scrapN, pt: m.scrapParts, quest });
    }
    // Осколок голема сам НЕ возрождается (иначе за игровую сессию все
    // големы лагеря необратимо усыхали бы до вечных мелких копий — баг,
    // который и просили починить): убираем из мира насовсем, а когда
    // умрёт последний осколок пары — на её месте встаёт целый голем.
    if (m.splitGroup) {
      this.mobs.delete(m.id);
      const g = m.splitGroup;
      if (--g.remaining <= 0) {
        this.pendingRevivals.push({
          at: this.elapsed + g.reviveSec,
          kind: g.kind,
          homeX: g.homeX,
          homeZ: g.homeZ,
          opts: g.opts,
        });
      }
    }
    return kind;
  }

  /** Отбросить моба по id (рассекающий удар бота и т.п.). */
  pullMob(id: string, x: number, z: number, sec: number): void {
    this.mobs.get(id)?.pullTo(x, z, sec);
  }

  shoveMob(id: string, dx: number, dz: number, power: number): void {
    this.mobs.get(id)?.shove(dx, dz, power);
  }

  /** Пригвоздить моба к земле по id (град стрел). */
  rootMob(id: string, sec: number): void {
    this.mobs.get(id)?.root(sec);
  }

  /** «Боевой клич»: моб `sec` секунд атакует только `by`. */
  tauntMob(id: string, by: string, sec: number): void {
    this.mobs.get(id)?.taunt(by, sec);
  }
  /** «Метка»: моб `sec` секунд получает урон × `mul`. */
  vulnMob(id: string, sec: number, mul: number): void {
    this.mobs.get(id)?.vuln(sec, mul);
  }

  markMob(id: string, by: string, sec: number, mul: number): void {
    this.mobs.get(id)?.mark(by, sec, mul);
  }

  /**
   * «Чумной клинок»: +1 стак яда (тикает stackSec, обновляется каждым ударом),
   * `dps` — урон в секунду за стак (берётся максимальный). Возвращает число
   * стаков; на maxStacks стаки сброшены — вызывающий взрывает яд.
   */
  poisonMob(id: string, dps: number, burst: number, by: string, add = 1, venom = false): number {
    const m = this.mobs.get(id);
    if (!m || m.dead) return 0;
    const ch = venom ? m.venom : m.plague;
    const fresh = ch.stacks === 0;
    ch.stacks = Math.min(PLAGUE.maxStacks, ch.stacks + add);
    ch.dps = fresh ? dps : Math.max(ch.dps, dps);
    ch.burst = fresh ? burst : Math.max(ch.burst, burst);
    ch.t = PLAGUE.stackSec;
    ch.by = by;
    this.poisonFx.push({ x: m.x, y: m.y, z: m.z, mobId: m.id, by, stacks: ch.stacks, burst: false, venom });
    if (ch.stacks >= PLAGUE.maxStacks && ch.burstCd <= 0) this.poisonBurstAt(m, venom);
    return ch.stacks;
  }

  /** Взрыв яда: урон вокруг и заражение соседей (+PLAGUE.spread стаков того же канала, цепочкой). Стаки не сгорают. */
  private poisonBurstAt(m: Mob, venom: boolean): void {
    const ch = venom ? m.venom : m.plague;
    ch.burstCd = PLAGUE.burstCd;
    const by = ch.by;
    const dmg = ch.burst;
    // h — середина тела моба над землёй (полу-высота хитбокса), чтобы вспышка была в модели, а не у ног.
    this.poisonFx.push({ x: m.x, y: m.y, z: m.z, mobId: m.id, by, stacks: ch.stacks, burst: true, h: MOB.bodyRadius * m.scale, venom });
    const near = [...this.mobs.values()].filter((o) => !o.dead && Math.hypot(o.x - m.x, o.z - m.z) <= PLAGUE.burstRadius + MOB.bodyRadius * o.scale);
    for (const o of near) {
      const hp0 = o.hp;
      this.hitMob(o.id, dmg, 0, 0, by, false, true, true);
      const dealt = Math.round(Math.max(0, hp0 - (o.dead ? 0 : o.hp)));
      if (dealt > 0) this.dmgHits.push({ x: o.x, y: hitMarkY(o), z: o.z, dmg: dealt, by: by || undefined, mob: o.id, c: venom ? "venom" : "poison" });
    }
    for (const o of near) if (o !== m && !o.dead) this.poisonMob(o.id, ch.dps, dmg, by, PLAGUE.spread, venom);
  }
  /** События яда за тик (стак/взрыв) — комната рассылает act poisonStack / plagueBurst. */
  readonly poisonFx: { x: number; y: number; z: number; mobId: string; by: string; stacks: number; burst: boolean; h?: number; venom: boolean }[] = [];

  /** Кровотечение (веер ножей): `dps` на `sec` с, берётся сильнейшее; не горение — свой эффект и красные цифры. */
  bleedMob(id: string, dps: number, sec: number, by: string): void {
    const m = this.mobs.get(id);
    if (!m || m.dead) return;
    m.bleedDps = m.bleedT > 0 ? Math.max(m.bleedDps, dps) : dps;
    m.bleedT = Math.max(m.bleedT, sec);
    m.bleedBy = by;
  }
  /** Капли крови за тик (раз в секунду на кровоточащего моба) — комната рассылает act "bleedTick". */
  readonly bleedTicks: { x: number; y: number; z: number; mobId: string; by: string }[] = [];

  /** Дым «Пелены смерти»: круги на земле до `until` (сек. симуляции). */
  readonly smokes: { x: number; z: number; r: number; until: number }[] = [];
  addSmoke(x: number, z: number, r: number, sec: number): void {
    this.smokes.push({ x, z, r, until: this.elapsed + sec });
  }
  /** Сколько секунд ещё держится дым в точке (0 — дыма нет): для плашки баффа. */
  smokeLeft(x: number, z: number): number {
    let left = 0;
    for (const s of this.smokes) if (Math.hypot(x - s.x, z - s.z) <= s.r) left = Math.max(left, s.until - this.elapsed);
    return left;
  }
  inSmoke(x: number, z: number): boolean {
    for (const s of this.smokes) if (this.elapsed <= s.until && Math.hypot(x - s.x, z - s.z) <= s.r) return true;
    return false;
  }

  /** Замедлить моба («Печать»): на `sec` секунд, скорость и темп атак × `mul`. */
  slowMob(id: string, sec: number, mul: number): void {
    this.mobs.get(id)?.slow(sec, mul);
  }

  /** Холодный ролл попал в моба: стак «Обморожения» или «Ледяная глыба» (Mob.chill); null — нет (мёртв или пауза). */
  chillMob(id: string): { k: "stack" | "encase"; n: number } | null {
    return this.mobs.get(id)?.chill() ?? null;
  }

  /** Оглушить моба по id (оглушающий удар воина). */
  stunMob(id: string, sec: number): void {
    this.mobs.get(id)?.stun(sec);
  }

  /**
   * Небольшой АОЕ вокруг точки (`x`,`y`,`z`): всем живым мобам в радиусе, кроме
   * `skipId` (прямая цель — свой урон уже получила), доля урона, спадающая от
   * эпицентра к краю. Урон идёт от `owner` — значит и опыт делится как обычно.
   */
  splashDamage(
    x: number,
    y: number,
    z: number,
    radius: number,
    dmg: number,
    skipId: string,
    owner: string,
    /** true — АОЕ от огнешара (дальний бой): броня мобов учитывается. */
    rangedHit = false,
    /** true — урон магией: physArmor не действует, magicVulnMul — действует. */
    magic = false,
  ): number {
    if (radius <= 0 || dmg <= 0) return 0;
    let total = 0;
    // Копия списка: hitMob может удалить моба (осколки) прямо в цикле.
    for (const m of [...this.mobs.values()]) {
      if (m.dead || m.id === skipId) continue;
      const dx = m.x - x;
      const dz = m.z - z;
      const body = MOB.bodyRadius * m.scale;
      const dy = m.y + body * 0.5 - y;
      const d = Math.hypot(dx, dz, dy) - body; // от края туши, не от центра
      if (d >= radius) continue;
      const k = 1 - Math.max(0, d) / radius; // спад к краю
      const hit = dmg * k;
      if (hit <= 0.01) continue;
      const hl = Math.hypot(dx, dz) || 1;
      this.hitMob(m.id, hit, dx / hl, dz / hl, owner, rangedHit, false, magic);
      total += hit;
      // Врождённый поджог мага (см. tickBolt) — распространяется и на всех,
      // кого задело АОЕ, не только на прямую цель. ДпС — от максимального
      // HP каждой конкретной цели (см. AFFIX.fire), не от доли АОЕ-урона.
      if (magic) {
        const f = this.getIgnite(owner);
        if (f > 0) m.ignite(m.pctHpBase * f, AFFIX.fire.burnSec, owner);
      }
    }
    return total;
  }

  /**
   * Кому засчитать квест за смерть моба: добившему и всем, кто нанёс ему урон за последние
   * CONTRIB_RECENCY с (тот же круг, что делит опыт). Вызывать ДО делёжа опыта — он чистит вклад.
   */
  private questCredit(m: Mob, killer: string | null): string[] {
    const out: string[] = killer ? [killer] : [];
    for (const [owner, c] of m.contrib) {
      if (owner === killer || c.dmg <= 0 || this.elapsed - c.last > CONTRIB_RECENCY) continue;
      out.push(owner);
    }
    return out;
  }

  /**
   * Опыт делится между добившими урон пропорционально урону (недавнему) —
   * общий алгоритм для обычной смерти моба (пул = m.xp) и раскола голема
   * (пул = m.splitXp, см. splitGolem). Уровневый потолок накладывает комната.
   */
  /** Кто бил моба за последние CONTRIB_RECENCY с — тот, кому делится лом. */
  private contribParts(m: Mob): string[] {
    const out: string[] = [];
    for (const [owner, c] of m.contrib) if (this.elapsed - c.last <= CONTRIB_RECENCY && c.dmg > 0) out.push(owner);
    return out;
  }

  private splitXpPool(m: Mob, pool: number): void {
    const RECENCY = CONTRIB_RECENCY;
    let total = 0;
    const parts: [string, number][] = [];
    for (const [owner, c] of m.contrib) {
      if (this.elapsed - c.last > RECENCY || c.dmg <= 0) continue;
      parts.push([owner, c.dmg]);
      total += c.dmg;
    }
    m.contrib.clear();
    // Дракон охоты на элиту: кто нанёс больше всех урона (титул «Драконоборец»).
    if (m.eliteName && m.eliteName === ELITE_MOBS.worldElite.name && parts.length) {
      this.dragonTop.push(parts.reduce((a, b) => (b[1] > a[1] ? b : a))[0]);
    }
    if (total <= 0 || pool <= 0) return;
    // Опыт — доля одного убийства (killXp), делится по вкладу; уровень моба — для соразмерности.
    for (const [owner, d] of parts) {
      this.mobXpShare.push({ owner, frac: d / total, lvl: m.eliteLevel, fixed: m.xpFixed ? m.xp : undefined });
    }
  }

  private splitMobXp(m: Mob): void {
    this.splitXpPool(m, m.xp);
  }

  /**
   * Голем-крушитель на EliteMobDef.splitAt доле HP не умирает — пропадает и
   * на его месте появляются splitCount мелких копий (доля размера/HP/урона
   * от родителя — EliteMobDef.splitScaleMul/splitHpFrac/splitDmgMul).
   * Раскол засчитывается как отдельная добыча: участникам сразу выдаётся
   * splitXp, а каждый осколок при СВОЕЙ смерти обычным путём даёт
   * m.xp = splitChildXp (уже не долю от родителя, а фиксированное число).
   */
  /** Ниндзя уходит в дым: сам — на scatter м в сторону, рядом count теневых копий (без опыта и лута). */
  private spawnClones(m: Mob): void {
    this.fx.push({ k: "ninjaSmoke", x: m.x, z: m.z });
    const a0 = Math.random() * Math.PI * 2;
    m.x += Math.cos(a0) * CLONES.scatter * 0.6;
    m.z += Math.sin(a0) * CLONES.scatter * 0.6;
    m.y = terrainHeight(m.x, m.z);
    this.fx.push({ k: "ninjaSmoke", x: m.x, z: m.z });
    for (let i = 0; i < CLONES.count; i++) {
      const a = a0 + ((i + 1) / (CLONES.count + 1)) * Math.PI * 2;
      const x = m.x + Math.cos(a) * CLONES.scatter;
      const z = m.z + Math.sin(a) * CLONES.scatter;
      const c = new Mob(m.kind, x, z, {
        model: m.model,
        name: m.eliteName,
        level: m.eliteLevel,
        hp: Math.max(1, Math.round(m.maxHp * CLONES.hpFrac)),
        dmgMul: m.dmgMul * CLONES.dmgMul,
        scaleMul: m.scale,
        speedMul: m.speedMul,
        xp: 0,
        dodge: m.dodge,
        attackCooldown: m.atkCooldown,
        meleeReach: m.meleeReach,
        cloneOf: m.id,
      });
      c.forceAggro();
      this.mobs.set(c.id, c);
      this.fx.push({ k: "ninjaSmoke", x: c.x, z: c.z });
    }
  }

  /**
   * «Зеркальный плач» рейд-босса: фантомы-копии в точках — стоят (anchored), стреляют, без опыта и лута;
   * погиб босс — рассеиваются (как тени ниндзя, cloneOf). hp/dmg/scale — доли от босса.
   */
  spawnRaidPhantoms(pts: readonly { x: number; z: number }[], o: { hp: number; dmg: number; scale: number }): void {
    const b = this.mobs.get(this.raidBossId);
    if (!b || b.dead) return;
    for (const pt of pts) {
      const c = new Mob(b.kind, pt.x, pt.z, {
        model: b.model,
        name: "Фантом аватара",
        level: b.eliteLevel,
        hp: Math.max(1, Math.round(b.maxHp * o.hp)),
        dmgMul: b.dmgMul * o.dmg,
        scaleMul: b.scale * o.scale,
        xp: 0,
        anchored: true,
        cloneOf: b.id,
      });
      c.forceAggro();
      this.mobs.set(c.id, c);
      this.fx.push({ k: "ninjaSmoke", x: pt.x, z: pt.z });
    }
  }

  private splitGolem(m: Mob): void {
    // Полный комплект для возрождения ЦЕЛОГО голема, когда умрут оба
    // осколка (см. GolemSplitGroup, hitMob) — характеристики родителя, ДО
    // уменьшения под осколки.
    const group: GolemSplitGroup = {
      remaining: m.splitCount,
      kind: m.kind,
      // Настоящее место спавна в лагере — НЕ текущая позиция (голем мог
      // отойти в погоне за героем далеко от своего места).
      homeX: m.homeX,
      homeZ: m.homeZ,
      reviveSec: m.splitReviveSec,
      opts: {
        campType: m.campType,
        champ: m.champ,
        respawnSec: m.champ ? CHAMP_RESPAWN : undefined,
        model: m.model,
        name: m.eliteName,
        level: m.eliteLevel,
        hp: m.maxHp,
        dmgMul: m.dmgMul,
        scaleMul: m.scale,
        speedMul: m.speedMul,
        xp: m.xp,
        flying: m.flying,
        rangedArmor: m.rangedArmor,
        physArmor: m.physArmor,
        magicArmor: m.magicArmor,
        magicVulnMul: m.magicVulnMul,
        critVulnMul: m.critVulnMul,
        splitAt: m.splitAt,
        splitCount: m.splitCount,
        splitScaleMul: m.splitScaleMul,
        splitHpFrac: m.splitHpFrac,
        splitDmgMul: m.splitDmgMul,
        splitSpeedMul: m.splitSpeedMul,
        splitXp: m.splitXp,
        splitChildXp: m.splitChildXp,
        splitReviveSec: m.splitReviveSec,
      },
    };
    // Катакомбы: осколки — тоже мобы катакомб (стены, уборка у решётки). Они не возрождают целого голема
    // (их смерть идёт веткой катакомб, без учёта группы) — иначе голем в зале множился бы без конца.
    const wasCat = this.catMobs.has(m.id);
    this.mobs.delete(m.id);
    this.catMobs.delete(m.id); // родитель катакомб уходит целиком — иначе висел бы призраком в учёте
    this.splitXpPool(m, m.splitXp);
    for (let i = 0; i < m.splitCount; i++) {
      const a = (i / m.splitCount) * Math.PI * 2 + Math.random() * 0.6;
      const x = m.x + Math.cos(a) * 1.3;
      const z = m.z + Math.sin(a) * 1.3;
      const child = new Mob(m.kind, x, z, {
        campType: m.campType,
        model: m.model,
        // Другое имя, не как у родителя — по просьбе (совпадение имён у
        // живого голема и его же осколков подозревали в путанице логики).
        name: "Осколок голема",
        level: m.eliteLevel,
        hp: Math.max(1, Math.round(m.maxHp * m.splitHpFrac)),
        dmgMul: m.dmgMul * m.splitDmgMul,
        scaleMul: m.scale * m.splitScaleMul,
        speedMul: m.speedMul * m.splitSpeedMul,
        xp: m.splitChildXp,
        flying: m.flying,
        rangedArmor: m.rangedArmor,
        physArmor: m.physArmor,
        magicArmor: m.magicArmor,
        magicVulnMul: m.magicVulnMul,
        critVulnMul: m.critVulnMul,
      });
      child.splitGroup = group;
      child.forceAggro();
      this.mobs.set(child.id, child);
      if (wasCat) this.catMobs.add(child.id);
    }
  }

  /**
   * Гибридный делёж опыта с босса: половина пула — ПОРОВНУ между всеми
   * участниками боя, половина — ЗА ВКЛАД (урон + лечение союзников +
   * ½ полученного урона, сглажено √). Ни один не получает больше `cap` —
   * срезанное перераспределяется остальным. Уровневый потолок (не больше
   * ~уровня за раз) накладывает уже комната по `PlayerState.level`.
   */
  private splitBossXp(m: Mob): void {
    const RECENCY = 90; // с — вклад «протух», если давно ничего не делал
    const CAP_FRAC = 0.4; // не больше 40% пула в одни руки
    const EQUAL_FRAC = 0.5; // доля пула, что делится поровну

    const elig: { owner: string; score: number }[] = [];
    for (const [owner, c] of m.contrib) {
      if (this.elapsed - c.last > RECENCY) continue;
      // Допуск: заметный урон ЛИБО хоть как-то держал бой (танк/хилер).
      const meaningful = c.dmg >= m.maxHp * 0.03 || c.taken > 0 || c.heal > 0;
      if (!meaningful) continue;
      const raw = c.dmg + c.heal + c.taken * 0.5;
      elig.push({ owner, score: Math.sqrt(Math.max(0, raw)) });
    }
    if (elig.length === 0) {
      m.contrib.clear();
      return;
    }

    const pool = m.xp;
    const cap = pool * CAP_FRAC;
    const equalEach = (pool * EQUAL_FRAC) / elig.length;
    const perfPool = pool * (1 - EQUAL_FRAC);
    let scoreSum = 0;
    for (const e of elig) scoreSum += e.score;
    if (scoreSum <= 0) scoreSum = 1;

    const award = new Map<string, number>();
    for (const e of elig) {
      award.set(e.owner, Math.min(cap, equalEach + perfPool * (e.score / scoreSum)));
    }
    // Перераспределить срезанное потолком (один проход — достаточно).
    let given = 0;
    for (const v of award.values()) given += v;
    let leftover = pool - given;
    if (leftover > 0.01) {
      const room = elig.filter((e) => (award.get(e.owner) ?? 0) < cap - 0.01);
      let rSum = 0;
      for (const e of room) rSum += e.score;
      if (rSum > 0) {
        for (const e of room) {
          const cur = award.get(e.owner) ?? 0;
          award.set(e.owner, Math.min(cap, cur + leftover * (e.score / rSum)));
        }
      }
    }

    // Пул выше — только для долей вклада. Сам опыт — каждому по ЕГО уровню:
    // ~xpElites элитных мобов его уровня × (доля × число бойцов), т.е. в
    // среднем одинаково на человека при любом составе (HP босса и так растёт
    // с числом бойцов). Долю зажимаем, чтобы и «хилер» получил своё.
    const n = elig.length;
    for (const [owner, xp] of award) {
      if (xp <= 0) continue;
      const share = Math.max(0.4, Math.min(1.8, (xp / pool) * n));
      this.bossXpShare.push({ owner, frac: share, lvl: this.getAttackerLevel(owner) });
    }
    m.contrib.clear();
  }

  private adaptAt = 0;
  /**
   * Подстройка Багрового под бойцов (BOSS_ADAPT): раз в секунду смотрит, кто
   * бил/получал от него за окно, и меняет макс. HP (доля текущего HP
   * сохраняется) и множитель урона. Никого — остаётся как был настроен.
   */
  adaptBoss(): void {
    const m = this.boss;
    if (!m || m.dead || this.elapsed - this.adaptAt < 1) return;
    this.adaptAt = this.elapsed;
    let n = 0;
    let lvlSum = 0;
    for (const [owner, c] of m.contrib) {
      if (this.elapsed - c.last > BOSS_ADAPT.windowSec) continue;
      n++;
      lvlSum += this.getAttackerLevel(owner);
    }
    if (n === 0) return;
    const L = Math.max(1, Math.round(lvlSum / n));
    const base = BOSS_ADAPT.baseLevel;
    const hpMul = weaponDmgFromLevel(L) / weaponDmgFromLevel(base);
    const target = Math.round(BOSS.hp * hpMul * (1 + BOSS_ADAPT.hpPerExtra * (n - 1)));
    if (target !== m.maxHp) {
      const frac = m.hp / m.maxHp;
      m.maxHp = target;
      m.hp = Math.max(1, frac * target);
    }
    m.adaptLevel = L;
    m.adaptDmgMul = maxHpFor(L, START_ATTRS) / maxHpFor(base, START_ATTRS);
  }

  /** Комната зовёт при удачном лечении союзника в бою с боссом. */
  bossHeal(owner: string, amount: number): void {
    if (this.boss && !this.boss.dead && this.boss.aggro) {
      this.boss.bump(owner, "heal", amount, this.elapsed);
    }
  }

  /** Выбросить осколки вокруг босса. */
  private spawnShards(boss: Mob): void {
    for (let i = 0; i < BOSS.splitCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = new Mob("shard", boss.x + Math.cos(a) * 1.6, boss.z + Math.sin(a) * 1.6);
      s.forceAggro();
      this.mobs.set(s.id, s);
    }
  }

  /** Разыграть и разложить добычу вокруг убитого моба. */
  /** Что выпало с последнего убитого босса — комната читает и объявляет. */
  readonly bossLoot: { id: ItemId; count: number; aegis?: boolean; armor?: ArmorInstance }[] = [];

  private spawnLoot(m: Mob, attacker = ""): { id: ItemId; count: number; aegis?: boolean; armor?: ArmorInstance }[] {
    // aegis — уникальный щит из этого списка падает Эгидой.
    const rolled: { id: ItemId; count: number; aegis?: boolean; armor?: ArmorInstance }[] = rollLoot(m.kind, Math.random);
    // Оружие — отдельный ролл поверх таблицы LOOT (та знает только про
    // зелья + фиксированные 40%/класс у босса). Элитные лагерные мобы
    // делят MobKind с обычными (slime/spitter), поэтому щедрость дропа
    // различаем по Mob.eliteName, а не по kind — см. DROP_CHANCE.
    // Мини-боссы и боссы (bossFight) — золотого оружия из таблицы тоже не берём.
    if (m.bossFight) for (let i = rolled.length - 1; i >= 0; i--) if (ITEMS[rolled[i].id].weapon?.tier === "gold") rolled.splice(i, 1);
    if (m.kind === "boss") {
      // Лут под уровень бойцов: золото высокоуровневым срезается (как у обычных
      // мобов, goldDropMulForLevel), часть срезанного становится уникальным.
      const goldMul = goldDropMulForLevel(m.adaptLevel);
      for (let i = rolled.length - 1; i >= 0; i--) {
        const w = ITEMS[rolled[i].id].weapon;
        if (!w || w.tier !== "gold" || Math.random() < goldMul) continue;
        if (Math.random() < BOSS_ADAPT.goldToLegendary * UNIQUE_DROP_MUL) {
          const item = WEAPON_DROP[weaponKey(pick(LEGENDARY_CLASSES), "legendary")];
          if (item) rolled[i] = { id: item, count: 1 };
          else rolled.splice(i, 1);
        } else {
          rolled.splice(i, 1);
        }
      }
      // Золотого оружия у боссов не бывает: уникальное — только по своим шансам ниже.
      for (let i = rolled.length - 1; i >= 0; i--) if (ITEMS[rolled[i].id].weapon?.tier === "gold") rolled.splice(i, 1);
      if (Math.random() < DROP_CHANCE.bossAegis * UNIQUE_DROP_MUL) {
        const item = WEAPON_DROP[weaponKey("shield", "legendary")];
        if (item) rolled.push({ id: item, count: 1, aegis: true });
      }
      if (Math.random() < DROP_CHANCE.bossLegendary * UNIQUE_DROP_MUL) {
        const cls = pick(LEGENDARY_CLASSES);
        const item = WEAPON_DROP[weaponKey(cls, "legendary")];
        if (item) rolled.push({ id: item, count: 1 });
      }
    } else if (m.kind !== "shard") {
      const elite = m.eliteName !== "";
      // Золото — по уровню моба: с 1-го полный шанс, к 53-му падает до нуля.
      const goldMul = levelFadeMul(m.eliteLevel, 1, 53);
      // Вожак — шанс оружия выше в QUEST.champ.dropMul раз (уникальное — только у вожаков лагерей).
      const champMul = m.champ ? QUEST.champ.dropMul : 1;
      // В катакомбах золотого оружия из мобов нет (только легендарное у элитных).
      // У боссов и мини-боссов (bossFight) золотого оружия нет — только уникальное.
      const goldChance = inCatRegion(m.x, m.z) || m.bossFight ? 0 : (elite ? DROP_CHANCE.eliteGold : DROP_CHANCE.regularGold) * goldMul * champMul * WEAPON_DROP_MUL;
      const own = Object.values(ELITE_MOBS).find((d) => d.model === m.model)?.legendaryChance;
      // Уникальное — наоборот: с 1-го уровня моба ноль, к 53-му — как есть (ARMOR_LEVEL_GATE.legendary).
      const legendaryChance = elite && m.model ? (own ?? DROP_CHANCE.eliteLegendary) * champMul * UNIQUE_DROP_MUL * armorLevelMul(m.eliteLevel, ARMOR_LEVEL_GATE.legendary) : 0;
      const tier: WeaponTier | null =
        legendaryChance > 0 && Math.random() < legendaryChance
          ? "legendary"
          : Math.random() < goldChance
            ? "gold"
            : null;
      if (tier) {
        const cls = pick(tier === "legendary" ? LEGENDARY_CLASSES : GOLD_CLASSES);
        const item = WEAPON_DROP[weaponKey(cls, tier)];
        if (item) rolled.push({ id: item, count: 1 });
      }
    }
    // Броня: обычная и золотая часть — отдельные шансы. Не угасают с уровнем героя и не зависят от катакомб.
    if (m.kind !== "shard") {
      const kind = m.kind === "boss" ? "boss" : m.eliteName !== "" ? "elite" : "regular";
      const champMul = m.kind !== "boss" && m.champ ? QUEST.champ.dropMul : 1;
      if (kind === "boss") {
        // Золотой части у босса нет (только уникальная ниже).
        // Уникальная часть — отдельный шанс (вдвое реже золотой), тоже вместо обычной.
        if (Math.random() < armorLegendaryDropChance("boss")) {
          const part = ARMOR_PARTS[Math.floor(Math.random() * ARMOR_PARTS.length)];
          rolled.push({ id: "armor", count: 1, armor: rollArmor(part, nid(), Math.random, "legendary") });
        }
      } else {
        // Обычный и элитный моб: обычная и золотая часть — два независимых шанса; золото реже в ARMOR_GOLD.dropDiv раз.
        // Обычная часть: на 1-м уровне как есть, к 53-му падает до нуля (armorBaseLevelMul).
        if (!m.bossFight && Math.random() < ARMOR_DROP[kind] * champMul * armorBaseLevelMul(m.eliteLevel)) {
          const part = ARMOR_PARTS[Math.floor(Math.random() * ARMOR_PARTS.length)];
          rolled.push({ id: "armor", count: 1, armor: rollArmor(part, nid()) });
        }
        // Золотая — с 1-го уровня растёт линейно, к 53-му — как было (ARMOR_LEVEL_GATE).
        if (!m.bossFight && Math.random() < armorGoldDropChance(kind) * champMul * armorLevelMul(m.eliteLevel, ARMOR_LEVEL_GATE.gold)) {
          const part = ARMOR_PARTS[Math.floor(Math.random() * ARMOR_PARTS.length)];
          rolled.push({ id: "armor", count: 1, armor: rollArmor(part, nid(), Math.random, "gold") });
        }
        // Уникальная часть растёт с уровнем моба: с 1-го уровня — ноль, к 53-му — как было (ARMOR_LEVEL_GATE).
        if (Math.random() < armorLegendaryDropChance(kind) * champMul * armorLevelMul(m.eliteLevel, ARMOR_LEVEL_GATE.legendary)) {
          const part = ARMOR_PARTS[Math.floor(Math.random() * ARMOR_PARTS.length)];
          rolled.push({ id: "armor", count: 1, armor: rollArmor(part, nid(), Math.random, "legendary") });
        }
      }
    }
    // Штраф за моба ниже героя (lowMobDropMul): штучное — шансом, стопки — количеством. Боссы — без штрафа.
    const pen = attacker && m.kind !== "boss" && !m.bossFight ? lowMobDropMul(this.getAttackerLevel(attacker), m.eliteLevel) : 1;
    if (pen < 1) {
      for (let i = rolled.length - 1; i >= 0; i--) {
        const r = rolled[i];
        const n = ITEMS[r.id].stack > 1 ? scaleCount(r.count, pen) : Math.random() < pen ? r.count : 0;
        if (n > 0) r.count = n;
        else rolled.splice(i, 1);
      }
    }
    // Обычный моб убит игроком: добыча сразу в его инвентарь, на землю — только остаток (что не влезло).
    const sink = attacker && m.kind !== "boss" && !inCatRegion(m.x, m.z) ? this.lootSink : null;
    for (const { id, count, aegis, armor } of rolled) {
      const w = ITEMS[id].weapon;
      const instance = w ? (aegis ? rollAegisInstance() : rollWeaponInstance(w.cls, w.tier)) : undefined;
      const left = sink ? sink(attacker, { id, count, instance, armor }) : count;
      if (left <= 0) continue;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * BAG.dropSpread;
      const x = m.x + Math.cos(a) * r;
      const z = m.z + Math.sin(a) * r;
      const d = new Drop(id, left, x, terrainHeight(x, z) + BAG.dropHeight, z, instance, armor);
      // Бронь за добившим — иначе чужой бот-зритель рядом утащит трофей
      // быстрее, чем игрок успеет подойти (раздел 8 плана).
      if (attacker) {
        d.ownerId = attacker;
        d.ownerUntil = Date.now() + BAG.lootOwnerSec * 1000;
      }
      this.drops.set(d.id, d);
    }
    return rolled;
  }

  /** Положить оружие на землю. Базовое не роняем — оно всегда доступно. */
  /** Возвращает id реально упавшего предмета (для баннера с иконкой) или null. */
  dropWeapon(cls: WeaponClass, tier: WeaponTier, x: number, z: number, aegis = false): ItemId | null {
    if (tier === "base") return null;
    const item = WEAPON_DROP[weaponKey(cls, tier)];
    if (!item) return null;
    const instance = aegis ? rollAegisInstance() : rollWeaponInstance(cls, tier);
    const d = new Drop(item, 1, x, terrainHeight(x, z) + BAG.dropHeight, z, instance);
    this.drops.set(d.id, d);
    return item;
  }

  /** Положить на землю конкретный инстанс (со всеми роллами) — «скинуть со склада». */
  /** Броня с игрока на землю (надетую сначала снимают). */
  dropArmor(inst: ArmorInstance, x: number, z: number): void {
    const d = new Drop("armor", 1, x, terrainHeight(x, z) + BAG.dropHeight, z, undefined, inst);
    this.drops.set(d.id, d);
  }

  dropInstance(inst: WeaponInstance, x: number, z: number): ItemId | null {
    if (inst.tier === "base") return null;
    delete inst.fav; // звёздочка — личная пометка хозяина, на земле её нет
    const item = WEAPON_DROP[weaponKey(inst.cls, inst.tier)];
    if (!item) return null;
    const d = new Drop(item, 1, x, terrainHeight(x, z) + BAG.dropHeight, z, inst);
    this.drops.set(d.id, d);
    return item;
  }

  /** Весь лут на земле — чтобы записать его перед остановкой сервера. */
  saveDrops(): DropSave[] {
    return [...this.drops.values()].map((d) => ({
      item: d.item,
      count: d.count,
      x: d.x,
      y: d.y,
      z: d.z,
      life: d.life,
      instance: d.instance,
      armor: d.armor,
    }));
  }

  /** Вернуть лут в мир после перезапуска. */
  restoreDrops(list: DropSave[]): void {
    for (const s of list) {
      if (!s || !isItemId(s.item)) continue;
      const count = Math.floor(Number(s.count));
      if (!Number.isFinite(count) || count <= 0) continue;
      const d = new Drop(s.item, count, Number(s.x), Number(s.y), Number(s.z), s.instance, s.armor);
      if (!Number.isFinite(d.x) || !Number.isFinite(d.y) || !Number.isFinite(d.z)) continue;
      d.life = Number.isFinite(s.life) ? Number(s.life) : 0;
      this.drops.set(d.id, d);
    }
  }

  /** Убрать весь лежащий лут. Возвращает, сколько предметов было. */
  clearDrops(): number {
    const n = this.drops.size;
    this.drops.clear();
    return n;
  }

  /** Забрать лут из мира. null — его уже нет (успел другой игрок). */
  takeDrop(id: string): Drop | null {
    const d = this.drops.get(id);
    if (!d) return null;
    this.drops.delete(id);
    return d;
  }

  hitDummy(id: string, dmg: number): void {
    this.dummies.get(id)?.applyHit(dmg);
  }

  /**
   * Центр тела цели в мире — сервер меряет по нему досягаемость удара.
   * null — цели нет или она уже мертва.
   */
  /** Радиус тела цели (м) — дальность удара меряем до поверхности, а не до центра. */
  targetRadius(target: "mob" | "dummy", id: string): number {
    if (target === "dummy") return 0;
    const m = this.mobs.get(id);
    return m ? MOB.hitRadius * m.scale : 0;
  }

  targetCenter(target: "mob" | "dummy", id: string): { x: number; y: number; z: number } | null {
    if (target === "dummy") {
      const d = this.dummies.get(id);
      if (!d || d.dead) return null;
      return { x: d.x, y: d.y + DUMMY_CENTER_Y, z: d.z };
    }
    const m = this.mobs.get(id);
    if (!m || m.dead) return null;
    return { x: m.x, y: m.y + m.liftM + MOB.bodyRadius * m.scale, z: m.z };
  }
}
