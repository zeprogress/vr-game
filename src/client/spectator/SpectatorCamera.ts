import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";

import { SPECTATE } from "#shared/constants";

/** Кого показывает камера сейчас. */
type Shot =
  | { kind: "overview" }
  | { kind: "orbitPlayer"; id: string }
  | { kind: "eyePlayer"; id: string }
  | { kind: "orbitBoss" }
  | { kind: "eyeMob"; id: string };

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
  private cycleIdx = 0;

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
    return this.shot.kind;
  }

  update(dt: number, ctx: DirectorCtx): void {
    this.orbitClock += dt;
    this.sinceSwitch += dt;

    // Босс в бою — своя ротация вокруг схватки.
    const fighting = ctx.boss?.aggro === true;
    if (fighting && !this.isFightShot(this.shot)) {
      this.switchTo({ kind: "orbitBoss" });
    } else if (!this.shotValid(this.shot, ctx)) {
      this.switchTo(this.nextShot(ctx, fighting));
    } else if (this.sinceSwitch >= SPECTATE.holdTime) {
      this.switchTo(this.nextShot(ctx, fighting));
    }

    // Обновляем фильтр позы для кадров «из глаз».
    this.trackEye(dt, ctx);

    this.evalShot(this.shot, ctx, this.toPos, this.toTgt);

    const k = smoothstep(this.sinceSwitch / SPECTATE.blendTime);
    lerpV(this.fromPos, this.toPos, k, this._p);
    lerpV(this.fromTgt, this.toTgt, k, this._t);

    const minY = ctx.groundY(this._p.x, this._p.z) + 1.2;
    if (this._p.y < minY) this._p.y = minY;

    this.cam.position.copyFrom(this._p);
    this.curTgt.copyFrom(this._t);
    this.cam.setTarget(this._t);
  }

  // ---- режиссура ----

  private switchTo(shot: Shot): void {
    this.fromPos.copyFrom(this.cam.position);
    this.fromTgt.copyFrom(this.curTgt);
    this.shot = shot;
    this.sinceSwitch = 0;
    // При входе в кадр «из глаз» снимаем задержку — прыгаем сразу к живой позе.
    const live = this.liveEye(shot, null);
    if (live) {
      this.eyePos.copyFrom(live.eye);
      this.eyeFwd.copyFrom(live.forward);
    }
  }

  private isFightShot(s: Shot): boolean {
    return s.kind === "orbitBoss" || s.kind === "eyeMob" || s.kind === "eyePlayer";
  }

  private nextShot(ctx: DirectorCtx, fighting: boolean): Shot {
    const list: Shot[] = [];
    if (fighting && ctx.boss) {
      list.push({ kind: "orbitBoss" }, { kind: "eyeMob", id: ctx.boss.id });
      const p = this.playerNearestBoss(ctx);
      if (p) list.push({ kind: "eyePlayer", id: p.id });
    } else {
      list.push({ kind: "overview" });
      for (const p of ctx.players) {
        list.push({ kind: "orbitPlayer", id: p.id }, { kind: "eyePlayer", id: p.id });
      }
      if (ctx.boss) list.push({ kind: "orbitBoss" }, { kind: "eyeMob", id: ctx.boss.id });
      // Один кадр «из глаз» случайного не-боссового моба.
      const critter = ctx.mobs.find((m) => m.kind === "slime" || m.kind === "spitter");
      if (critter) list.push({ kind: "eyeMob", id: critter.id });
    }
    this.cycleIdx = (this.cycleIdx + 1) % list.length;
    return list[this.cycleIdx] ?? { kind: "overview" };
  }

  private shotValid(s: Shot, ctx: DirectorCtx): boolean {
    if (s.kind === "orbitPlayer" || s.kind === "eyePlayer") {
      return ctx.players.some((p) => p.id === s.id);
    }
    if (s.kind === "orbitBoss") return ctx.boss !== null;
    if (s.kind === "eyeMob") return ctx.mobs.some((m) => m.id === s.id);
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
    if (s.kind === "eyePlayer") return ctx.players.find((p) => p.id === s.id) ?? null;
    if (s.kind === "eyeMob") return ctx.mobs.find((m) => m.id === s.id) ?? null;
    return null;
  }

  private trackEye(dt: number, ctx: DirectorCtx): void {
    const live = this.liveEye(this.shot, ctx);
    if (!live) return;
    const k = this.raw ? 1 : 1 - Math.exp(-dt * SPECTATE.eyeSmooth);
    lerpV(this.eyePos, live.eye, k, this.eyePos);
    lerpV(this.eyeFwd, live.forward, k, this.eyeFwd);
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
      case "eyePlayer":
      case "eyeMob": {
        // Слегка позади глаз, чтобы не влезать в меш головы/тела.
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
