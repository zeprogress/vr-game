import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";

import { SPECTATE } from "#shared/constants";
import { inHubSafeZone } from "#shared/hub";
import { TOWER_PROP_POS } from "#shared/tower";
import { terrainHeight } from "#shared/terrain";
import { CINE_PATHS, ROTATION, ROTATION_IDLE, samplePath } from "./cine";

/** Подлёт камеры к декоративной башне на поляне перед стартом забега (см. EVENT.tower.approachSec). */
const TOWER_APPROACH_DUR = 2.3; // с — чуть короче approachSec на сервере, добор — на blendTime
const TOWER_APPROACH_START_DIST = 34; // м — откуда камера начинает лететь
const TOWER_APPROACH_END_DIST = 8; // м — где заканчивает, у подножья
const TOWER_APPROACH_START_UP = 16; // высота начала над землёй
const TOWER_APPROACH_END_UP = 5; // высота конца над землёй
const TOWER_APPROACH_AIM_UP = 14; // куда смотрим — повыше на саму башню

/**
 * Камера-погоня за ботом («из глаз бота»): сзади, чуть сверху. Высота
 * отдельно от BOT_CAM_BACK/LEAD (раньше её вообще не было — угол держали
 * ровно 45° суммой трёх констант, отсюда и «слишком высоко»).
 */
const BOT_CAM_BACK = 4.5; // м позади бота (по горизонтали)
const BOT_CAM_LEAD = 1.5; // на сколько цель взгляда впереди бота
const BOT_CAM_AIM_Y = 0.6; // высота цели над точкой корпуса бота
const BOT_CAM_UP = 2.0; // подъём самой камеры над точкой корпуса (ниже, по просьбе — было 4.0)

/** Вид напротив: камера перед персонажем, смотрит ему в лицо. */
const FRONT_DIST = 10.0; // м перед персонажем
const FRONT_UP = 2.0; // подъём камеры над точкой корпуса
const FRONT_AIM_Y = 0.5; // куда смотрим (грудь/лицо)

/** «Снизу»: камера у самой земли перед героем, смотрит вверх на него. */
const LOW_DIST = 3.2; // м перед персонажем
const LOW_Y = 0.35; // высота самой камеры над землёй
const LOW_AIM_Y = 1.7; // куда смотрим (грудь/лицо, а не под ноги)

/** Чередование кадров в режиме «только боты». */
const BOT_ROTATION = [
  "eyePlayer",
  "sidePlayer",
  "crowd",
  "duelPlayer",
  "orbitPlayer",
  "dronePlayer",
  "frontPlayer",
] as const;

/** Боковой трекинг: камера едет сбоку вровень с героем, держит его в кадре. */
const SIDE_DIST = 7.5; // м вбок
const SIDE_UP = 2.3; // подъём над точкой корпуса
const SIDE_AIM_Y = 1.0;
/**
 * «Воздух перед лицом» (lead room): цель взгляда сдвинута ВПЕРЁД по ходу
 * героя, поэтому сам он уезжает к заднему краю кадра, а перед ним остаётся
 * место — куда он бежит и что там впереди. Классический приём трекинг-долли.
 */
const SIDE_LEAD = 3.4; // м вперёд по направлению героя
/** Камеру чуть отодвигаем назад, чтобы герой не выпал из кадра при сдвиге цели. */
const SIDE_BACK = 1.2;

/** Низкая экшн-камера: почти у земли, вплотную позади — «бег от третьего лица». */

/**
 * «Из-за плеча»: классический TPS-кадр — вплотную сзади-сбоку на высоте
 * головы, с воздухом по ходу движения. Ближе и интимнее, чем eyePlayer.
 */

/**
 * «Дуэль»: в кадре и герой, и его ближайший противник — камера сбоку от
 * линии между ними, смотрит в середину. Если рядом никого — обычный бок.
 */
const DUEL_MAX = 14; // м: дальше моба уже не считаем противником
const DUEL_PAD = 5.5; // м запаса к дистанции камеры сверх половины разрыва
const DUEL_UP = 2.6;
/** Дуэль: вязкость слежения за противником и за самим кадром (1/с). */
const DUEL_FOE_SMOOTH = 3.2;
const DUEL_CAM_SMOOTH = 2.6;
/** Насколько ближе должен быть новый моб, чтобы дуэль сменила противника (м). */
const DUEL_SWITCH_MARGIN = 2.5;

/** «Дрон»: высоко и далеко позади героя, вид сверху-сзади в движении. */
const DRONE_BACK = 13;
const DRONE_UP = 9;
const DRONE_AIM_Y = 0.4;

/**
 * «Группа сверху»: неподвижный отвес-3/4 над центром толпы героев на поляне.
 * Без кручения — камера плавно налетает и держит группу в кадре, кадр шире
 * при большем разбросе.
 */
const CROWD_ANGLE = 0.62; // горизонтальный отступ камеры (доля от dist)
const CROWD_UP = 0.92; // высота камеры (доля от dist)
const CROWD_MIN = 17;
const CROWD_MAX = 34;
/**
 * Кадр берёт не ВСЕХ героев, а самую плотную кучку: если народ разбрёлся по
 * поляне, попытка вместить всех уводила камеру под потолок и герои
 * превращались в точки. Считаем «группой» тех, кто в этом радиусе от ядра.
 */
const CROWD_GROUP_RADIUS = 16; // м вокруг самого «окружённого» героя
/** Меньше этого в кучке — группы нет, кадр невалиден (режиссёр возьмёт другой). */
const CROWD_MIN_MEMBERS = 2;

/** Кого показывает камера сейчас. */
type Shot =
  | { kind: "overview" }
  | { kind: "orbitPlayer"; id: string }
  | { kind: "eyePlayer"; id: string }
  | { kind: "frontPlayer"; id: string }
  | { kind: "sidePlayer"; id: string }
  | { kind: "dronePlayer"; id: string }
  | { kind: "duelPlayer"; id: string }
  | { kind: "heroLow"; id: string }
  | { kind: "towerApproach" }
  | { kind: "orbitBoss" }
  | { kind: "eyeMob"; id: string }
  | { kind: "crowd" }
  | { kind: "path"; idx: number };

export interface CtxPlayer {
  id: string;
  nick: string;
  /** Точка тела, вокруг которой орбита / на которую смотрим. */
  pos: Vector3;
  /** Мировая позиция головы (глаз). */
  eye: Vector3;
  /** Направление взгляда головы (единичное). */
  forward: Vector3;
}

export interface CtxMob {
  id: string;
  kind: string;
  /** Точка «глаз» моба — чуть перед мордой и выше центра. */
  eye: Vector3;
  forward: Vector3;
}

/** Данные для режиссёра: где игроки, живые мобы и агрит ли босс. */
export interface DirectorCtx {
  players: CtxPlayer[];
  mobs: CtxMob[];
  boss: { id: string; pos: Vector3; aggro: boolean } | null;
  groundY: (x: number, z: number) => number;
}

const CENTER = new Vector3(0, 0, 0);

/** Кадры, привязанные к одному игроку/боту (общая логика выбора/валидации). */
const PLAYER_SHOTS = [
  "orbitPlayer",
  "eyePlayer",
  "frontPlayer",
  "sidePlayer",
  "dronePlayer",
  "duelPlayer",
  "heroLow",
] as const;
type PlayerShotKind = (typeof PLAYER_SHOTS)[number];
function isPlayerShotKind(k: string): k is PlayerShotKind {
  return (PLAYER_SHOTS as readonly string[]).includes(k);
}
/** «Погоня сзади» — камера сглаживается вязким фильтром botPos/botFwd. */
function usesBotFilter(k: string): boolean {
  return (
    k === "eyePlayer" ||
    k === "frontPlayer" ||
    k === "sidePlayer" ||
    k === "dronePlayer" ||
    k === "duelPlayer" ||
    k === "heroLow"
  );
}

function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function lerpV(a: Vector3, b: Vector3, k: number, out: Vector3): void {
  out.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
}

/**
 * Автономный «режиссёр» стрима (этап 17, Ф1 + Ф3).
 *
 * Чередует кадры: обзор зоны → орбита игрока → из глаз игрока → орбита
 * босса → из глаз моба. Пока босс в бою — своя ротация вокруг схватки.
 * Переходы между кадрами — плавный перелёт; кадры «из глаз» дополнительно
 * сглажены (сырой VR-трясёт зрителя), `raw` снимает сглаживание.
 */
export class SpectatorCamera {
  readonly cam: FreeCamera;
  private shot: Shot = { kind: "overview" };
  /** Момент (performance.now()) входа в кадр "подлёт к башне" — см. TOWER_APPROACH_DUR. */
  private towerApproachStart = 0;
  private orbitClock = 0;
  private sinceSwitch = 999;
  private rotIdx = 0; // позиция в ROTATION (спокойная ротация, кто-то на сервере есть)
  private idleRotIdx = 0; // позиция в ROTATION_IDLE (сервер совсем пуст)
  private fightIdx = 0; // позиция в ротации боя
  private pickI = 0; // какого игрока/моба брать для *Player / eyeMob токенов
  private readonly _pp: number[] = [0, 0, 0];
  private readonly _pl: number[] = [0, 0, 0];

  /** Авто-ротация режиссёра. Выключена — камера держит текущий кадр. */
  auto = true;
  /**
   * Режим «только боты» (Ф10): авто-ротация ходит лишь по ботам зрителей и
   * чередует из глаз → орбиту → вид напротив. Ботов нет — обычная ротация.
   */
  botsOnly = false;
  private botRotIdx = 0;
  private botPickI = 0;
  private lastCtx: DirectorCtx | null = null;

  private readonly fromPos = new Vector3();
  private readonly fromTgt = new Vector3();
  private readonly toPos = new Vector3();
  private readonly toTgt = new Vector3();
  private readonly curTgt = new Vector3(0, 2, 0);
  private readonly _p = new Vector3();
  private readonly _t = new Vector3();
  private frameDt = 0.016;

  // Низкочастотный фильтр позы для кадров «из глаз».
  private readonly eyePos = new Vector3();
  private readonly eyeFwd = new Vector3(0, 0, 1);
  // Отдельный, более вязкий фильтр для кадров вокруг бота: там камера висит
  // в нескольких метрах, и доворот модели бьёт по ней с большим плечом.
  private readonly botPos = new Vector3();
  private readonly botFwd = new Vector3(0, 0, 1);
  // Дуэльный кадр: сглаженная позиция противника + сглаженные поза/цель камеры,
  // чтобы смена ближайшего моба и рывки его позиции не дёргали картинку.
  private readonly duelFoe = new Vector3();
  private duelFoeId: string | null = null;
  private readonly duelPos = new Vector3();
  private readonly duelTgt = new Vector3();
  private duelInit = false;

  constructor(
    scene: Scene,
    private readonly raw = false,
  ) {
    this.cam = new FreeCamera(
      "spectatorCam",
      new Vector3(0, SPECTATE.overviewHeight, -SPECTATE.overviewRadius),
      scene,
    );
    this.cam.minZ = 0.2;
    this.cam.maxZ = 600;
    this.cam.fov = 0.9;
    this.cam.inputs.clear(); // камерой рулим только кодом
    scene.activeCamera = this.cam;
  }

  get target(): Vector3 {
    return this.curTgt;
  }

  get shotKind(): string {
    if (this.shot.kind === "path") {
      return `path «${CINE_PATHS[this.shot.idx]?.name ?? "?"}»`;
    }
    return this.shot.kind;
  }

  /** Кого камера показывает сейчас — для нижней плашки оверлея (Ф6). */
  get subject(): { type: "player" | "mob" | "none"; id?: string } {
    const s = this.shot;
    if (isPlayerShotKind(s.kind)) return { type: "player", id: (s as { id: string }).id };
    if (s.kind === "eyeMob") return { type: "mob", id: s.id };
    if (s.kind === "orbitBoss" && this.lastCtx?.boss) return { type: "mob", id: this.lastCtx.boss.id };
    return { type: "none" };
  }

  /** Дашборд: поставить кадр вручную (см. токены в SpecCmd). */
  forceShot(token: string): void {
    if (!this.lastCtx) return;
    if (token === "auto") {
      this.auto = true;
      return;
    }
    const shot = this.resolveToken(token, this.lastCtx);
    if (shot) {
      this.auto = false;
      this.switchTo(shot, this.lastCtx);
    }
  }

  update(dt: number, ctx: DirectorCtx): void {
    this.lastCtx = ctx;
    this.orbitClock += dt;
    this.sinceSwitch += dt;

    // В режиме «только боты» бой у босса камеру не перехватывает.
    const fighting = ctx.boss?.aggro === true && !this.botsOnly;
    const invalid = !this.shotValid(this.shot, ctx);
    // Путь идёт до конца своей длительности; остальные кадры — holdTime.
    const timedOut = this.shot.kind !== "path" && this.sinceSwitch >= SPECTATE.holdTime;

    if (this.auto && fighting && !this.isFightShot(this.shot)) {
      this.switchTo({ kind: "orbitBoss" }, ctx);
    } else if (invalid) {
      // Цель кадра пропала — переключаемся даже в ручном режиме.
      this.switchTo(this.auto ? this.nextShot(ctx, fighting) : { kind: "overview" }, ctx);
    } else if (this.auto && timedOut) {
      this.switchTo(this.nextShot(ctx, fighting), ctx);
    }

    this.frameDt = dt;
    // Обновляем фильтр позы для кадров «из глаз».
    this.trackEye(dt, ctx);

    this.evalShot(this.shot, ctx, this.toPos, this.toTgt);

    const k = smoothstep(this.sinceSwitch / this.curBlend);
    lerpV(this.fromPos, this.toPos, k, this._p);
    lerpV(this.fromTgt, this.toTgt, k, this._t);

    // Пол камеры — 1.2 м над землёй.
    const minY = ctx.groundY(this._p.x, this._p.z) + 1.2;
    if (this._p.y < minY) this._p.y = minY;

    this.cam.position.copyFrom(this._p);
    this.curTgt.copyFrom(this._t);
    this.cam.setTarget(this._t);
  }

  // ---- режиссура ----

  private curBlend: number = SPECTATE.blendTime;

  private switchTo(shot: Shot, ctx: DirectorCtx): void {
    this.fromPos.copyFrom(this.cam.position);
    this.fromTgt.copyFrom(this.curTgt);
    if (shot.kind === "towerApproach") this.towerApproachStart = performance.now();
    this.shot = shot;
    this.sinceSwitch = 0;
    this.curBlend = SPECTATE.blendTime;
    // При входе в кадр «из глаз» снимаем задержку — прыгаем сразу к живой позе.
    const live = this.liveEye(shot, ctx);
    if (live) {
      this.eyePos.copyFrom(live.eye);
      this.eyeFwd.copyFrom(live.forward);
      this.botPos.copyFrom(live.eye);
      this.botFwd.copyFrom(live.forward);
    }
    if (shot.kind !== "duelPlayer") {
      this.duelFoeId = null;
      this.duelInit = false;
    }
  }

  private isFightShot(s: Shot): boolean {
    return (
      s.kind === "orbitBoss" ||
      s.kind === "eyeMob" ||
      s.kind === "eyePlayer" ||
      s.kind === "sidePlayer"
    );
  }

  private nextShot(ctx: DirectorCtx, fighting: boolean): Shot {
    // «Только боты» — приоритет над всем, включая бой у босса.
    if (this.botsOnly) {
      const bots = ctx.players.filter((p) => p.id.startsWith("bot:"));
      if (bots.length > 0) {
        const kind = BOT_ROTATION[this.botRotIdx % BOT_ROTATION.length];
        this.botRotIdx++;
        // Цель меняем, только когда прошли круг ракурсов — иначе зритель не
        // успевает понять, за кем смотрит.
        if (this.botRotIdx % BOT_ROTATION.length === 0) this.botPickI++;
        if (kind === "crowd") {
          const shot = this.resolveToken("crowd", ctx);
          if (shot) return shot; // нет группы на поляне — падаем на ракурс ниже
        }
        const id = bots[this.botPickI % bots.length].id;
        if (isPlayerShotKind(kind)) return { kind, id } as Shot;
        return { kind: "eyePlayer", id };
      }
    }
    if (fighting && ctx.boss) {
      // Ротация боя: орбита босса → из глаз ближнего игрока.
      const near = this.playerNearestBoss(ctx);
      const fight: Shot[] = [{ kind: "orbitBoss" }];
      if (near) {
        fight.push({ kind: "eyePlayer", id: near.id });
        fight.push({ kind: "sidePlayer", id: near.id });
      }
      this.fightIdx = (this.fightIdx + 1) % fight.length;
      return fight[this.fightIdx];
    }
    // Кто-то на сервере есть (игрок или бот) — эфир на них, кинопути не
    // предлагаем вообще; сервер совсем пуст — крутим их, показывать больше
    // нечего. С пульта путь всё равно можно поставить вручную в любой момент
    // (forceShot) — это идёт мимо этой ветки.
    if (ctx.players.length > 0) {
      for (let step = 1; step <= ROTATION.length; step++) {
        const tok = ROTATION[(this.rotIdx + step) % ROTATION.length];
        const shot = this.resolveToken(tok, ctx);
        if (shot) {
          this.rotIdx = (this.rotIdx + step) % ROTATION.length;
          return shot;
        }
      }
    } else {
      for (let step = 1; step <= ROTATION_IDLE.length; step++) {
        const tok = ROTATION_IDLE[(this.idleRotIdx + step) % ROTATION_IDLE.length];
        const shot = this.resolveToken(tok, ctx);
        if (shot) {
          this.idleRotIdx = (this.idleRotIdx + step) % ROTATION_IDLE.length;
          return shot;
        }
      }
    }
    return { kind: "overview" };
  }

  /**
   * Токен → кадр, либо null если сейчас невозможен. Формы:
   *  overview · orbitBoss · path:<n> · orbitPlayer[:id] · eyePlayer[:id] · eyeMob[:id]
   * Без `:id` — авто-выбор следующей цели (для ROTATION).
   */
  private resolveToken(tok: string, ctx: DirectorCtx): Shot | null {
    // Только по первому «:» — id ботов вида `bot:<ник>` сам содержит двоеточие.
    const ci = tok.indexOf(":");
    const kind = ci < 0 ? tok : tok.slice(0, ci);
    const id = ci < 0 ? "" : tok.slice(ci + 1);
    if (kind === "overview") return { kind: "overview" };
    if (kind === "towerApproach") return { kind: "towerApproach" };
    if (kind === "crowd") return this.crowdPlayers(ctx).length > 0 ? { kind: "crowd" } : null;
    if (kind === "orbitBoss") return ctx.boss ? { kind: "orbitBoss" } : null;
    if (kind === "path") {
      const idx = Number(id);
      return idx >= 0 && idx < CINE_PATHS.length ? { kind: "path", idx } : null;
    }
    if (isPlayerShotKind(kind)) {
      let pid = id;
      if (!pid) {
        if (ctx.players.length === 0) return null;
        this.pickI = (this.pickI + 1) % ctx.players.length;
        pid = ctx.players[this.pickI].id;
      } else if (!ctx.players.some((p) => p.id === pid)) {
        return null;
      }
      return { kind, id: pid } as Shot;
    }
    if (kind === "eyeMob") {
      // Камеры «из глаз босса» больше нет нигде — ни явным id, ни авто-подбором.
      if (id) {
        const m = ctx.mobs.find((x) => x.id === id);
        return m && m.kind !== "boss" ? { kind: "eyeMob", id } : null;
      }
      const critters = ctx.mobs.filter((m) => m.kind === "slime" || m.kind === "spitter");
      if (critters.length === 0) return null;
      return { kind: "eyeMob", id: critters[this.pickI % critters.length].id };
    }
    return null;
  }

  private shotValid(s: Shot, ctx: DirectorCtx): boolean {
    if (isPlayerShotKind(s.kind)) {
      return ctx.players.some((p) => p.id === (s as { id: string }).id);
    }
    if (s.kind === "orbitBoss") return ctx.boss !== null;
    if (s.kind === "crowd") return this.crowdPlayers(ctx).length > 0;
    if (s.kind === "eyeMob") return ctx.mobs.some((m) => m.id === s.id);
    if (s.kind === "path") {
      return s.idx < CINE_PATHS.length && this.sinceSwitch < CINE_PATHS[s.idx].duration;
    }
    return true;
  }

  /**
   * Самая плотная кучка героев на поляне (вне лагеря) — для «Группы сверху».
   * Ядро — герой, вокруг которого в CROWD_GROUP_RADIUS больше всего соседей;
   * в кадр идут только они. Разбежавшихся по карте не тянем: иначе камера
   * улетала так высоко, что смотреть было не на что.
   */
  private crowdPlayers(ctx: DirectorCtx): CtxPlayer[] {
    const field = ctx.players.filter((p) => !inHubSafeZone(p.pos.x, p.pos.z));
    if (field.length < CROWD_MIN_MEMBERS) return [];
    let best: CtxPlayer[] = [];
    for (const seed of field) {
      const near = field.filter(
        (o) => Math.hypot(o.pos.x - seed.pos.x, o.pos.z - seed.pos.z) <= CROWD_GROUP_RADIUS,
      );
      if (near.length > best.length) best = near;
    }
    return best.length >= CROWD_MIN_MEMBERS ? best : [];
  }

  private playerNearestBoss(ctx: DirectorCtx): CtxPlayer | null {
    if (!ctx.boss || ctx.players.length === 0) return null;
    let best: CtxPlayer | null = null;
    let bd = Infinity;
    for (const p of ctx.players) {
      const d = Vector3.DistanceSquared(p.pos, ctx.boss.pos);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  /** Живая (несглаженная) поза «глаз» для кадра, если он такой. */
  private liveEye(s: Shot, ctx: DirectorCtx | null): { eye: Vector3; forward: Vector3 } | null {
    if (!ctx) return null;
    if (usesBotFilter(s.kind))
      return ctx.players.find((p) => p.id === (s as { id: string }).id) ?? null;
    if (s.kind === "eyeMob") return ctx.mobs.find((m) => m.id === s.id) ?? null;
    return null;
  }

  private trackEye(dt: number, ctx: DirectorCtx): void {
    const live = this.liveEye(this.shot, ctx);
    if (!live) return;
    const k = this.raw ? 1 : 1 - Math.exp(-dt * SPECTATE.eyeSmooth);
    lerpV(this.eyePos, live.eye, k, this.eyePos);
    lerpV(this.eyeFwd, live.forward, k, this.eyeFwd);

    const kp = this.raw ? 1 : 1 - Math.exp(-dt * SPECTATE.botCamPosSmooth);
    const kf = this.raw ? 1 : 1 - Math.exp(-dt * SPECTATE.botCamFwdSmooth);
    lerpV(this.botPos, live.eye, kp, this.botPos);
    lerpV(this.botFwd, live.forward, kf, this.botFwd);
  }

  private evalShot(s: Shot, ctx: DirectorCtx, pos: Vector3, tgt: Vector3): void {
    switch (s.kind) {
      case "orbitPlayer": {
        const p = ctx.players.find((x) => x.id === s.id);
        if (p) {
          this.orbit(p.pos, SPECTATE.orbitRadius, SPECTATE.orbitHeight, SPECTATE.orbitSpeed, pos, tgt);
          return;
        }
        break;
      }
      case "orbitBoss": {
        if (ctx.boss) {
          this.orbit(
            ctx.boss.pos,
            SPECTATE.bossOrbitRadius,
            SPECTATE.bossOrbitHeight,
            SPECTATE.orbitSpeed * 0.55,
            pos,
            tgt,
          );
          tgt.y += 2;
          return;
        }
        break;
      }
      case "path": {
        const path = CINE_PATHS[s.idx];
        if (path) {
          samplePath(path, this.sinceSwitch / path.duration, this._pp, this._pl);
          pos.set(this._pp[0], this._pp[1], this._pp[2]);
          tgt.set(this._pl[0], this._pl[1], this._pl[2]);
          // Страховка: сплайн (овершут Катмулла) не должен нырять к земле.
          const minY = ctx.groundY(pos.x, pos.z) + 2.5;
          if (pos.y < minY) {
            tgt.y += minY - pos.y;
            pos.y = minY;
          }
          // И не смотреть круче ~35° вниз — иначе «клевок» в землю на
          // разворотах и когда камера проходит над точкой интереса.
          const dh = Math.hypot(tgt.x - pos.x, tgt.z - pos.z);
          const maxDrop = dh * 0.7; // tan(35°) ≈ 0.7
          if (pos.y - tgt.y > maxDrop) tgt.y = pos.y - maxDrop;
          return;
        }
        break;
      }
      case "frontPlayer": {
        // Напротив: камера перед персонажем, смотрит ему в лицо (и на то,
        // что за его спиной). Направление берём горизонтальное — иначе
        // наклон головы швыряет камеру вверх-вниз.
        const fx = this.botFwd.x;
        const fz = this.botFwd.z;
        const fl = Math.hypot(fx, fz) || 1;
        pos.set(
          this.botPos.x + (fx / fl) * FRONT_DIST,
          this.botPos.y + FRONT_UP,
          this.botPos.z + (fz / fl) * FRONT_DIST,
        );
        tgt.set(this.botPos.x, this.botPos.y + FRONT_AIM_Y, this.botPos.z);
        return;
      }
      case "heroLow": {
        // Снизу: камера у земли перед героем, смотрит вверх на него —
        // драматичный низкий ракурс. Направление то же, что и у "напротив".
        const fx = this.botFwd.x;
        const fz = this.botFwd.z;
        const fl = Math.hypot(fx, fz) || 1;
        pos.set(
          this.botPos.x + (fx / fl) * LOW_DIST,
          ctx.groundY(this.botPos.x, this.botPos.z) + LOW_Y,
          this.botPos.z + (fz / fl) * LOW_DIST,
        );
        tgt.set(this.botPos.x, this.botPos.y + LOW_AIM_Y, this.botPos.z);
        return;
      }
      case "sidePlayer": {
        // Камера сбоку, вровень с героем — трекинг-долли, пока он бежит.
        const fx = this.botFwd.x;
        const fz = this.botFwd.z;
        const fl = Math.hypot(fx, fz) || 1;
        // Перпендикуляр к ходу; сторону выбираем детерминированно по id.
        const side = (s.id.charCodeAt(s.id.length - 1) & 1) === 0 ? 1 : -1;
        const px = (-fz / fl) * side;
        const pz = (fx / fl) * side;
        pos.set(
          this.botPos.x + px * SIDE_DIST - (fx / fl) * SIDE_BACK,
          this.botPos.y + SIDE_UP,
          this.botPos.z + pz * SIDE_DIST - (fz / fl) * SIDE_BACK,
        );
        // Смотрим не в героя, а вперёд него — так перед лицом остаётся воздух.
        tgt.set(
          this.botPos.x + (fx / fl) * SIDE_LEAD,
          this.botPos.y + SIDE_AIM_Y,
          this.botPos.z + (fz / fl) * SIDE_LEAD,
        );
        return;
      }
      case "duelPlayer": {
        // Двойной кадр: герой и его противник, камера сбоку от их линии.
        // Всё сглажено: и позиция противника, и сама поза камеры — иначе смена
        // ближайшего моба и рывки его координат дёргают картинку.
        const me = ctx.players.find((x) => x.id === s.id);
        const kFoe = 1 - Math.exp(-this.frameDt * DUEL_FOE_SMOOTH);
        const kCam = 1 - Math.exp(-this.frameDt * DUEL_CAM_SMOOTH);

        // Противник: держимся за текущего, пока он в силе; меняем только на
        // ЗАМЕТНО более близкого — без этого камера скачет между мобами в куче.
        let cur: CtxMob | null =
          this.duelFoeId != null ? ctx.mobs.find((m) => m.id === this.duelFoeId) ?? null : null;
        const curD = cur && me ? Vector3.Distance(cur.eye, me.pos) : Infinity;
        if (me && (!cur || curD > DUEL_MAX)) {
          let best: CtxMob | null = null;
          let bd = DUEL_MAX;
          for (const m of ctx.mobs) {
            const d = Vector3.Distance(m.eye, me.pos);
            if (d < bd) {
              bd = d;
              best = m;
            }
          }
          cur = best;
        } else if (me && cur) {
          for (const m of ctx.mobs) {
            if (m.id === cur.id) continue;
            if (Vector3.Distance(m.eye, me.pos) < curD - DUEL_SWITCH_MARGIN) {
              cur = m;
              break;
            }
          }
        }

        let rawPos: Vector3;
        let rawTgt: Vector3;
        if (!cur) {
          // Противника рядом нет — обычный бок с воздухом, чтобы кадр не сломался.
          this.duelFoeId = null;
          const fx = this.botFwd.x;
          const fz = this.botFwd.z;
          const fl = Math.hypot(fx, fz) || 1;
          const px = -fz / fl;
          const pz = fx / fl;
          rawPos = new Vector3(
            this.botPos.x + px * SIDE_DIST,
            this.botPos.y + SIDE_UP,
            this.botPos.z + pz * SIDE_DIST,
          );
          rawTgt = new Vector3(
            this.botPos.x + (fx / fl) * SIDE_LEAD,
            this.botPos.y + SIDE_AIM_Y,
            this.botPos.z + (fz / fl) * SIDE_LEAD,
          );
        } else {
          if (this.duelFoeId !== cur.id) {
            this.duelFoeId = cur.id;
            this.duelFoe.copyFrom(cur.eye); // новый противник — без наплыва
          }
          lerpV(this.duelFoe, cur.eye, kFoe, this.duelFoe);
          const mx = (this.botPos.x + this.duelFoe.x) * 0.5;
          const mz = (this.botPos.z + this.duelFoe.z) * 0.5;
          let ax = this.duelFoe.x - this.botPos.x;
          let az = this.duelFoe.z - this.botPos.z;
          const al = Math.hypot(ax, az) || 1;
          ax /= al;
          az /= al;
          const dist = al * 0.5 + DUEL_PAD;
          const side = (s.id.charCodeAt(s.id.length - 1) & 1) === 0 ? 1 : -1;
          rawPos = new Vector3(mx - az * dist * side, this.botPos.y + DUEL_UP, mz + ax * dist * side);
          rawTgt = new Vector3(mx, this.botPos.y + 0.9, mz);
        }

        if (!this.duelInit) {
          this.duelPos.copyFrom(rawPos);
          this.duelTgt.copyFrom(rawTgt);
          this.duelInit = true;
        } else {
          lerpV(this.duelPos, rawPos, kCam, this.duelPos);
          lerpV(this.duelTgt, rawTgt, kCam, this.duelTgt);
        }
        pos.copyFrom(this.duelPos);
        tgt.copyFrom(this.duelTgt);
        return;
      }
      case "dronePlayer": {
        const fx = this.botFwd.x;
        const fz = this.botFwd.z;
        const fl = Math.hypot(fx, fz) || 1;
        pos.set(
          this.botPos.x - (fx / fl) * DRONE_BACK,
          this.botPos.y + DRONE_UP,
          this.botPos.z - (fz / fl) * DRONE_BACK,
        );
        tgt.set(this.botPos.x, this.botPos.y + DRONE_AIM_Y, this.botPos.z);
        return;
      }
      case "eyePlayer": {
        if (s.id.startsWith("bot:")) {
          // Бот — не «из глаз», а погоня сзади: в кадре и сам персонаж, и
          // дорога перед ним.
          const fx = this.botFwd.x;
          const fz = this.botFwd.z;
          const fl = Math.hypot(fx, fz) || 1;
          pos.set(
            this.botPos.x - (fx / fl) * BOT_CAM_BACK,
            this.botPos.y + BOT_CAM_UP,
            this.botPos.z - (fz / fl) * BOT_CAM_BACK,
          );
          tgt.set(
            this.botPos.x + (fx / fl) * BOT_CAM_LEAD,
            this.botPos.y + BOT_CAM_AIM_Y,
            this.botPos.z + (fz / fl) * BOT_CAM_LEAD,
          );
          return;
        }
        // Живой игрок — слегка позади глаз, чтобы не влезать в меш головы (VR).
        pos.set(
          this.eyePos.x - this.eyeFwd.x * 0.15,
          this.eyePos.y - this.eyeFwd.y * 0.15 + 0.02,
          this.eyePos.z - this.eyeFwd.z * 0.15,
        );
        tgt.set(
          this.eyePos.x + this.eyeFwd.x * 20,
          this.eyePos.y + this.eyeFwd.y * 20,
          this.eyePos.z + this.eyeFwd.z * 20,
        );
        return;
      }
      case "crowd": {
        const grp = this.crowdPlayers(ctx);
        if (grp.length) {
          let gx = 0;
          let gz = 0;
          for (const p of grp) {
            gx += p.pos.x;
            gz += p.pos.z;
          }
          gx /= grp.length;
          gz /= grp.length;
          let spread = 6;
          for (const p of grp) {
            spread = Math.max(spread, Math.hypot(p.pos.x - gx, p.pos.z - gz));
          }
          const dist = Math.min(CROWD_MAX, Math.max(CROWD_MIN, spread * 1.7 + 11));
          const gy = ctx.groundY(gx, gz);
          // Неподвижное 3/4-сверху смещение — камеру плавно ведёт trackShot.
          pos.set(gx - dist * CROWD_ANGLE, gy + dist * CROWD_UP, gz - dist * CROWD_ANGLE * 0.6);
          tgt.set(gx, gy + 1.4, gz);
          return;
        }
        break;
      }
      case "eyeMob": {
        // Не буквально «из глаз», а погоня сзади-сверху: моба видно в кадре,
        // и куда он идёт — тоже. Горизонтальную составляющую взгляда берём
        // отдельно, чтобы высота камеры не зависела от наклона морды.
        const fx = this.eyeFwd.x;
        const fz = this.eyeFwd.z;
        const fl = Math.hypot(fx, fz) || 1;
        pos.set(
          this.eyePos.x - (fx / fl) * 3.6,
          this.eyePos.y + 2.6,
          this.eyePos.z - (fz / fl) * 3.6,
        );
        tgt.set(
          this.eyePos.x + (fx / fl) * 8,
          this.eyePos.y - 0.4,
          this.eyePos.z + (fz / fl) * 8,
        );
        return;
      }
      case "towerApproach": {
        // Камера летит со стороны поляны к декоративной башне (см. TowerProp.ts)
        // перед стартом забега — герой ещё виден в мире, ничего не изменилось.
        const tx = TOWER_PROP_POS.x;
        const tz = TOWER_PROP_POS.z;
        const groundY = terrainHeight(tx, tz);
        // Тот же угол, с которого у башни окна (см. TowerProp.ts: сторона к центру карты).
        const dl = Math.hypot(tx, tz) || 1;
        const dx = -tx / dl;
        const dz = -tz / dl;
        const t = Math.min(1, (performance.now() - this.towerApproachStart) / (TOWER_APPROACH_DUR * 1000));
        const k = smoothstep(t);
        const dist = TOWER_APPROACH_START_DIST + (TOWER_APPROACH_END_DIST - TOWER_APPROACH_START_DIST) * k;
        const up = TOWER_APPROACH_START_UP + (TOWER_APPROACH_END_UP - TOWER_APPROACH_START_UP) * k;
        pos.set(tx + dx * dist, groundY + up, tz + dz * dist);
        tgt.set(tx, groundY + TOWER_APPROACH_AIM_UP, tz);
        return;
      }
    }
    // Обзор зоны (и запасной вариант).
    const a = this.orbitClock * SPECTATE.overviewSpeed;
    pos.set(
      Math.cos(a) * SPECTATE.overviewRadius,
      ctx.groundY(0, 0) + SPECTATE.overviewHeight,
      Math.sin(a) * SPECTATE.overviewRadius,
    );
    tgt.copyFrom(CENTER);
    tgt.y = ctx.groundY(0, 0) + 3;
  }

  private orbit(
    focus: Vector3,
    radius: number,
    height: number,
    speed: number,
    pos: Vector3,
    tgt: Vector3,
  ): void {
    const a = this.orbitClock * speed;
    pos.set(focus.x + Math.cos(a) * radius, focus.y + height, focus.z + Math.sin(a) * radius);
    tgt.copyFrom(focus);
  }

  dispose(): void {
    this.cam.dispose();
  }
}
