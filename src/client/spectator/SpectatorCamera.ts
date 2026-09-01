import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";

import { SPECTATE } from "#shared/constants";

/** Кого показывает камера сейчас. */
type Shot =
  | { kind: "overview" }
  | { kind: "player"; id: string }
  | { kind: "boss" };

/** Данные для режиссёра: где игроки, где живой босс и агрит ли он кого-то. */
export interface DirectorCtx {
  players: { id: string; pos: Vector3; nick: string }[];
  boss: { pos: Vector3; aggro: boolean } | null;
  /** Высота земли — камеру не пускаем под неё. */
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
 * Автономный «режиссёр» стрима (этап 17, Ф1): камера сама облетает
 * происходящее — обзор зоны, орбита вокруг каждого игрока, орбита босса
 * (в приоритете, пока он в бою). Смена шота с плавным перелётом.
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

  constructor(scene: Scene) {
    this.cam = new FreeCamera("spectatorCam", new Vector3(0, SPECTATE.overviewHeight, -SPECTATE.overviewRadius), scene);
    this.cam.minZ = 0.3;
    this.cam.maxZ = 600;
    this.cam.fov = 0.9;
    this.cam.inputs.clear(); // камерой рулим только кодом
    scene.activeCamera = this.cam;
  }

  /** Куда сейчас смотрит камера (для позиционного звука). */
  get target(): Vector3 {
    return this.curTgt;
  }

  /** Тип текущего шота — для отладочного оверлея. */
  get shotKind(): string {
    return this.shot.kind;
  }

  update(dt: number, ctx: DirectorCtx): void {
    this.orbitClock += dt;
    this.sinceSwitch += dt;

    // Босс в бою — сразу на него (если ещё не на нём).
    if (ctx.boss?.aggro && this.shot.kind !== "boss") {
      this.switchTo({ kind: "boss" });
    } else if (this.sinceSwitch >= SPECTATE.holdTime) {
      this.switchTo(this.nextShot(ctx));
    } else if (!this.shotValid(this.shot, ctx)) {
      this.switchTo(this.nextShot(ctx));
    }

    this.evalShot(this.shot, ctx, this.toPos, this.toTgt);

    const k = smoothstep(this.sinceSwitch / SPECTATE.blendTime);
    lerpV(this.fromPos, this.toPos, k, this._p);
    lerpV(this.fromTgt, this.toTgt, k, this._t);

    // Не ныряем под землю.
    const minY = ctx.groundY(this._p.x, this._p.z) + 1.5;
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
  }

  /** Следующий шот по кругу: обзор → игрок 1 → игрок 2 → … → обзор. */
  private nextShot(ctx: DirectorCtx): Shot {
    const list: Shot[] = [{ kind: "overview" }];
    for (const p of ctx.players) list.push({ kind: "player", id: p.id });
    if (ctx.boss) list.push({ kind: "boss" });
    this.cycleIdx = (this.cycleIdx + 1) % list.length;
    return list[this.cycleIdx];
  }

  private shotValid(shot: Shot, ctx: DirectorCtx): boolean {
    if (shot.kind === "player") return ctx.players.some((p) => p.id === shot.id);
    if (shot.kind === "boss") return ctx.boss !== null;
    return true;
  }

  private evalShot(shot: Shot, ctx: DirectorCtx, pos: Vector3, tgt: Vector3): void {
    if (shot.kind === "player") {
      const p = ctx.players.find((x) => x.id === shot.id);
      if (p) {
        this.orbit(p.pos, SPECTATE.orbitRadius, SPECTATE.orbitHeight, SPECTATE.orbitSpeed, pos, tgt);
        return;
      }
    }
    if (shot.kind === "boss" && ctx.boss) {
      this.orbit(
        ctx.boss.pos,
        SPECTATE.bossOrbitRadius,
        SPECTATE.bossOrbitHeight,
        SPECTATE.orbitSpeed * 0.6,
        pos,
        tgt,
      );
      tgt.y += 2;
      return;
    }
    // Обзор зоны.
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
