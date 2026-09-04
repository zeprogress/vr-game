import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";

import { SPECTATE } from "#shared/constants";
import { CINE_PATHS, ROTATION, samplePath } from "./cine";

/**
 * Камера-погоня за ботом («из глаз бота»): сзади, чуть сверху. Высота
 * отдельно от BOT_CAM_BACK/LEAD (раньше её вообще не было — угол держали
 * ровно 45° суммой трёх констант, отсюда и «слишком высоко»).
 */
const BOT_CAM_BACK = 4.5; // м позади бота (по горизонтали)
const BOT_CAM_LEAD = 1.5; // на сколько цель взгляда впереди бота
const BOT_CAM_AIM_Y = 0.6; // высота цели над точкой корпуса бота
const BOT_CAM_UP = 4.0; // подъём самой камеры над точкой корпуса

/** Вид напротив: камера перед персонажем, смотрит ему в лицо. */
const FRONT_DIST = 10.0; // м перед персонажем
const FRONT_UP = 2.0; // подъём камеры над точкой корпуса
const FRONT_AIM_Y = 0.5; // куда смотрим (грудь/лицо)

/** Чередование кадров в режиме «только боты». */
const BOT_ROTATION = ["eyePlayer", "orbitPlayer", "frontPlayer"] as const;

/** Кого показывает камера сейчас. */
type Shot =
  | { kind: "overview" }
  | { kind: "orbitPlayer"; id: string }
  | { kind: "eyePlayer"; id: string }
  | { kind: "frontPlayer"; id: string }
  | { kind: "orbitBoss" }
  | { kind: "eyeMob"; id: string }
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
  private orbitClock = 0;
  private sinceSwitch = 999;
  private rotIdx = 0; // позиция в ROTATION (спокойная ротация)
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

  // Низкочастотный фильтр позы для кадров «из глаз».
  private readonly eyePos = new Vector3();
  private readonly eyeFwd = new Vector3(0, 0, 1);
  // Отдельный, более вязкий фильтр для кадров вокруг бота: там камера висит
  // в нескольких метрах, и доворот модели бьёт по ней с большим плечом.
  private readonly botPos = new Vector3();
  private readonly botFwd = new Vector3(0, 0, 1);

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
    if (s.kind === "orbitPlayer" || s.kind === "eyePlayer" || s.kind === "frontPlayer")
      return { type: "player", id: s.id };
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

    // Обновляем фильтр позы для кадров «из глаз».
    this.trackEye(dt, ctx);

    this.evalShot(this.shot, ctx, this.toPos, this.toTgt);

    const k = smoothstep(this.sinceSwitch / this.curBlend);
    lerpV(this.fromPos, this.toPos, k, this._p);
    lerpV(this.fromTgt, this.toTgt, k, this._t);

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
  }

  private isFightShot(s: Shot): boolean {
    return s.kind === "orbitBoss" || s.kind === "eyeMob" || s.kind === "eyePlayer";
  }

  private nextShot(ctx: DirectorCtx, fighting: boolean): Shot {
    // «Только боты» — приоритет над всем, включая бой у босса.
    if (this.botsOnly) {
      const bots = ctx.players.filter((p) => p.id.startsWith("bot:"));
      if (bots.length > 0) {
        const kind = BOT_ROTATION[this.botRotIdx % BOT_ROTATION.length];
        this.botRotIdx++;
        // Цель меняем, только когда прошли круг из трёх ракурсов — иначе
        // зритель не успевает понять, за кем смотрит.
        if (this.botRotIdx % BOT_ROTATION.length === 0) this.botPickI++;
        const id = bots[this.botPickI % bots.length].id;
        if (kind === "orbitPlayer") return { kind: "orbitPlayer", id };
        if (kind === "frontPlayer") return { kind: "frontPlayer", id };
        return { kind: "eyePlayer", id };
      }
    }
    if (fighting && ctx.boss) {
      // Ротация боя: орбита босса → из глаз босса → из глаз ближнего игрока.
      const near = this.playerNearestBoss(ctx);
      const fight: Shot[] = [
        { kind: "orbitBoss" },
        { kind: "eyeMob", id: ctx.boss.id },
      ];
      if (near) fight.push({ kind: "eyePlayer", id: near.id });
      this.fightIdx = (this.fightIdx + 1) % fight.length;
      return fight[this.fightIdx];
    }
    // Спокойная ротация: идём по ROTATION, пропуская невалидные токены.
    for (let step = 1; step <= ROTATION.length; step++) {
      const tok = ROTATION[(this.rotIdx + step) % ROTATION.length];
      const shot = this.resolveToken(tok, ctx);
      if (shot) {
        this.rotIdx = (this.rotIdx + step) % ROTATION.length;
        return shot;
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
    if (kind === "orbitBoss") return ctx.boss ? { kind: "orbitBoss" } : null;
    if (kind === "eyeBoss") {
      const b = ctx.mobs.find((m) => m.kind === "boss");
      return b ? { kind: "eyeMob", id: b.id } : null;
    }
    if (kind === "path") {
      const idx = Number(id);
      return idx >= 0 && idx < CINE_PATHS.length ? { kind: "path", idx } : null;
    }
    if (kind === "orbitPlayer" || kind === "eyePlayer" || kind === "frontPlayer") {
      let pid = id;
      if (!pid) {
        if (ctx.players.length === 0) return null;
        this.pickI = (this.pickI + 1) % ctx.players.length;
        pid = ctx.players[this.pickI].id;
      } else if (!ctx.players.some((p) => p.id === pid)) {
        return null;
      }
      if (kind === "orbitPlayer") return { kind: "orbitPlayer", id: pid };
      if (kind === "frontPlayer") return { kind: "frontPlayer", id: pid };
      return { kind: "eyePlayer", id: pid };
    }
    if (kind === "eyeMob") {
      if (id) return ctx.mobs.some((m) => m.id === id) ? { kind: "eyeMob", id } : null;
      const critters = ctx.mobs.filter((m) => m.kind === "slime" || m.kind === "spitter");
      const list = critters.length ? critters : ctx.mobs;
      if (list.length === 0) return null;
      return { kind: "eyeMob", id: list[this.pickI % list.length].id };
    }
    return null;
  }

  private shotValid(s: Shot, ctx: DirectorCtx): boolean {
    if (s.kind === "orbitPlayer" || s.kind === "eyePlayer" || s.kind === "frontPlayer") {
      return ctx.players.some((p) => p.id === s.id);
    }
    if (s.kind === "orbitBoss") return ctx.boss !== null;
    if (s.kind === "eyeMob") return ctx.mobs.some((m) => m.id === s.id);
    if (s.kind === "path") {
      return s.idx < CINE_PATHS.length && this.sinceSwitch < CINE_PATHS[s.idx].duration;
    }
    return true;
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
    if (s.kind === "eyePlayer" || s.kind === "frontPlayer")
      return ctx.players.find((p) => p.id === s.id) ?? null;
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
