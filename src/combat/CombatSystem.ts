import type { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Vector3, Matrix, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Node } from "@babylonjs/core/node";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { WebXRDefaultExperience } from "@babylonjs/core/XR/webXRDefaultExperience";
import type { WebXRInputSource } from "@babylonjs/core/XR/webXRInputSource";
import { Space } from "@babylonjs/core/Maths/math.axis";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/linesBuilder";

import { BOW, COMBAT, MELEE, SHIELD, THROW } from "../shared/constants";
import { clamp, segmentDistance } from "../shared/geometry";
import type { TuneInput } from "../input/InputSource";
import type { PlayerController } from "../player/PlayerController";
import type { Progression } from "../player/Progression";
import type { Side } from "../player/Hands";
import type { Sfx } from "../audio/Sfx";
import { createSword } from "../items/Sword";
import { createShield } from "../items/Shield";
import { createBow, type BowParts } from "../items/Bow";
import { createArrowProto, Arrow } from "./Arrow";
import type { Hittable } from "./Hittable";

const TIP = new Vector3(...COMBAT.swordTipLocal);
const TUNE_KEY = "swordTune";
const VR_TUNE_ROT = 1.6;
const VR_TUNE_POS = 0.4;
/** Локальная нормаль щита — «наружу» смотрит +Y. */
const SHIELD_NORMAL = new Vector3(0, 1, 0);

export interface EquipTune {
  pos: Vector3;
  rot: Vector3;
  scale: number;
}

/** Ключи наборов тюнинга. В VR — отдельно для левой и правой руки. */
export type TuneSlot =
  | "swordFlat"
  | "swordVRLeft"
  | "swordVRRight"
  | "bowFlat"
  | "bowVRLeft"
  | "bowVRRight"
  | "shieldFlat"
  | "shieldVRLeft"
  | "shieldVRRight";

/** Оружие, которое держат в основной руке. */
type Weapon = "" | "sword" | "bow";
type Throwable = "sword" | "bow" | "shield";

function tune(x: number, y: number, z: number, rx: number, ry: number, rz: number, sc: number): EquipTune {
  return { pos: new Vector3(x, y, z), rot: new Vector3(rx, ry, rz), scale: sc };
}

interface RestSpot {
  pos: Vector3;
  yaw: number;
  bob: boolean; // true — парит над камнем, false — лежит на земле
}

interface Flying {
  what: Throwable;
  mesh: Mesh;
  vel: Vector3;
  spinAxis: Vector3;
  spinRate: number;
  prev: Vector3;
  life: number;
  hitDone: boolean;
}

export class CombatSystem {
  private readonly sword: Mesh;
  private readonly bow: Mesh;
  private readonly shield: Mesh;
  private readonly bowParts: BowParts;
  private readonly swordRest: RestSpot;
  private readonly bowRest: RestSpot;
  private readonly shieldRest: RestSpot;
  private readonly bowString: LinesMesh;
  private readonly nockArrow: Mesh;
  private readonly arrowProto: Mesh;
  private readonly arrows: Arrow[] = [];

  readonly tunes: Record<TuneSlot, EquipTune> = {
    swordFlat: tune(0.42, -0.38, 0.85, -0.2, 0.25, -0.28, 0.55),
    swordVRRight: tune(0, 0, 0, 1, 0, 0, 1),
    swordVRLeft: tune(0, 0, 0, 1, 0, 0, 1),
    bowFlat: tune(-0.24, -0.26, 0.55, 0, Math.PI, 0, 0.8),
    bowVRRight: tune(0, 0, 0, 0, 0, 0, 1),
    bowVRLeft: tune(0, 0, 0, 0, 0, 0, 1),
    // Щит: локальный +Y смотрит «наружу», поэтому в плоском режиме
    // разворачиваем диск вперёд поворотом на 90° вокруг X.
    shieldFlat: tune(-0.34, -0.26, 0.62, Math.PI / 2, 0, 0, 0.8),
    shieldVRRight: tune(0, 0, 0, Math.PI / 2, 0, 0, 1),
    shieldVRLeft: tune(0, 0, 0, Math.PI / 2, 0, 0, 1),
  };

  /** Оружие и рука, которая его держит. */
  private held: Weapon = "";
  private heldHand: Side = "right";
  /** Рука со щитом (в плоском режиме — «левая», щит висит у камеры). */
  private shieldHand: Side | null = null;

  private prevInteract = false;
  private prevPrimary = false;
  private readonly gripPrev: Record<Side, boolean> = { left: false, right: false };

  private readonly flying: Flying[] = [];
  private justPickedUp = false; // взяли тем же нажатием E — не бросать сразу
  private windup = 0; // замах перед броском (плоский режим), 0..1
  private readonly heldPrev = new Vector3();
  private readonly heldVel = new Vector3();
  private readonly heldAngVel = new Vector3();
  private readonly heldQuatPrev = new Quaternion();
  private heldMotionInit = false;

  private swingT = 0;
  private swingHitDone = false;
  private swooshCd = 0;
  private tipTrail: { p: Vector3; dir: Vector3; age: number }[] = [];

  private draw = 0; // 0..1
  private vrNocked = false;
  private prevVrTrigger = false;

  // Рукопашная
  private readonly fistPrev: Record<Side, Vector3> = { left: new Vector3(), right: new Vector3() };
  private fistInit: Record<Side, boolean> = { left: false, right: false };
  private readonly fistCd: Record<Side, number> = { left: 0, right: 0 };
  private meleeFlatCd = 0;

  private blockCd = 0; // чтобы звук блока не тарахтел
  private bob = 0;
  private tuning = false;

  constructor(
    scene: Scene,
    private readonly player: PlayerController,
    private readonly getXR: () => WebXRDefaultExperience | null,
    private readonly targets: Hittable[],
    private readonly sfx: Sfx,
    private readonly prog: Progression,
    private readonly groundHeight: (x: number, z: number) => number,
    swordHome: Vector3,
    bowHome: Vector3,
    shieldHome: Vector3,
  ) {
    this.swordRest = { pos: swordHome.clone(), yaw: 0, bob: true };
    this.bowRest = { pos: bowHome.clone(), yaw: 0, bob: true };
    this.shieldRest = { pos: shieldHome.clone(), yaw: 0, bob: true };

    this.sword = createSword(scene);
    this.sword.position.copyFrom(swordHome);

    this.shield = createShield(scene);
    this.shield.position.copyFrom(shieldHome);

    this.bowParts = createBow(scene);
    this.bow = this.bowParts.mesh;
    this.bow.position.copyFrom(bowHome);

    const stringPts = [this.bowParts.topTip, this.bowParts.nockRest, this.bowParts.bottomTip];
    this.bowString = MeshBuilder.CreateLines("bowString", { points: stringPts, updatable: true }, scene);
    this.bowString.color = new Color3(0.85, 0.85, 0.8);
    this.bowString.parent = this.bow;
    this.bowString.isPickable = false;

    this.arrowProto = createArrowProto(scene);
    this.nockArrow = this.arrowProto.clone("nockArrow");
    this.nockArrow.parent = this.bow;
    this.nockArrow.setEnabled(false);
    this.nockLocal.copyFrom(this.bowParts.nockRest);

    for (const [home, dy] of [
      [swordHome, 0.75],
      [bowHome, 0.4],
      [shieldHome, 0.4],
    ] as const) {
      const mat = new StandardMaterial("rockMat", scene);
      mat.diffuseColor = new Color3(0.42, 0.42, 0.45);
      mat.specularColor = new Color3(0, 0, 0);
      const rock = MeshBuilder.CreateSphere("weaponRock", { diameter: 1.1, segments: 6 }, scene);
      rock.material = mat;
      rock.position.set(home.x, home.y - dy, home.z);
      rock.scaling.y = 0.5;
      rock.isPickable = false;
    }

    this.arrowCtx = {
      scene,
      targets: this.targets,
      isSolid: (m: AbstractMesh) => m.isPickable && m.checkCollisions,
      onHit: (kind) => {
        this.sfx.arrowHit(kind);
        if (kind === "flesh") this.sfx.hitThud(0.5);
      },
    };

    this.loadTuning();
  }

  // ---- тюнинг положения предметов в руке (localStorage) ----

  loadTuning(): void {
    try {
      const j = JSON.parse(localStorage.getItem(TUNE_KEY) ?? "null");
      if (!j) return;
      // Совместимость со старыми ключами { flat, vr } / { swordVR, bowVR }.
      this.applyTune(this.tunes.swordFlat, j.flat ?? j.swordFlat);
      this.applyTune(this.tunes.bowFlat, j.bowFlat);
      const swVR = j.vr ?? j.swordVR;
      this.applyTune(this.tunes.swordVRRight, j.swordVRRight ?? swVR);
      this.applyTune(this.tunes.swordVRLeft, j.swordVRLeft ?? swVR);
      this.applyTune(this.tunes.bowVRRight, j.bowVRRight ?? j.bowVR);
      this.applyTune(this.tunes.bowVRLeft, j.bowVRLeft ?? j.bowVR);
      this.applyTune(this.tunes.shieldFlat, j.shieldFlat);
      this.applyTune(this.tunes.shieldVRRight, j.shieldVRRight);
      this.applyTune(this.tunes.shieldVRLeft, j.shieldVRLeft);
    } catch {
      /* нет данных */
    }
  }

  private applyTune(t: EquipTune, d: unknown): void {
    const o = d as { pos?: number[]; rot?: number[]; scale?: number } | undefined;
    if (!o?.pos || !o.rot || o.scale === undefined) return;
    t.pos.set(o.pos[0], o.pos[1], o.pos[2]);
    t.rot.set(o.rot[0], o.rot[1], o.rot[2]);
    t.scale = o.scale;
  }

  saveTuning(): void {
    const ser = (t: EquipTune) => ({
      pos: [t.pos.x, t.pos.y, t.pos.z],
      rot: [t.rot.x, t.rot.y, t.rot.z],
      scale: t.scale,
    });
    try {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(this.tunes) as TuneSlot[]) out[k] = ser(this.tunes[k]);
      localStorage.setItem(TUNE_KEY, JSON.stringify(out));
    } catch {
      /* ignore */
    }
  }

  get vrActive(): boolean {
    return this.player.inVR;
  }

  // ---- главный цикл ----

  update(dt: number): void {
    const inp = this.player.lastInput;
    const interactEdge = inp.interact && !this.prevInteract;
    const interactReleased = !inp.interact && this.prevInteract;
    const primaryEdge = inp.primaryAction && !this.prevPrimary;
    const primaryReleased = !inp.primaryAction && this.prevPrimary;
    this.prevInteract = inp.interact;
    this.prevPrimary = inp.primaryAction;

    if (this.blockCd > 0) this.blockCd -= dt;

    if (!inp.tune) {
      if (this.player.inVR) this.handleGripsVR();
      else this.handleInteractFlat(inp.interact, interactEdge, interactReleased, dt);
    }

    this.bobIdle(dt);

    // Щит держится в руке всегда, когда взят.
    if (this.shieldHand) this.keepAnchored(this.shield, this.tunes[this.shieldSlot()], this.shieldHand);

    if (this.held === "sword") {
      this.keepAnchored(this.sword, this.tunes[this.slot()], this.heldHand);
      if (this.player.inVR) {
        if (!this.updateVRTune(inp.tune, dt)) this.updateVRSwing(dt);
      } else {
        this.updateFlatSwing(dt, primaryEdge);
      }
    } else if (this.held === "bow") {
      this.keepAnchored(this.bow, this.tunes[this.slot()], this.heldHand);
      if (this.player.inVR) this.updateVRTune(inp.tune, dt);
      this.updateBow(dt, inp.primaryAction, primaryReleased);
    } else {
      // Свободные руки — рукопашная.
      if (this.player.inVR) this.updateVRMelee(dt);
      else this.updateFlatMelee(dt, primaryEdge);
    }

    this.applyWindup();
    this.trackHeldMotion(dt);
    this.updateString();
    this.updateFlying(dt);

    for (let i = this.arrows.length - 1; i >= 0; i--) {
      if (!this.arrows[i].update(dt, this.arrowCtx)) {
        this.arrows[i].dispose();
        this.arrows.splice(i, 1);
      }
    }
  }

  // ---- защита ----

  /**
   * Урон по игроку из точки `from` с учётом щита и меча.
   * Возвращает множитель: 0 — полностью заблокировано, 1 — прошло целиком.
   * Побочно играет звук/вибрацию при удачном блоке.
   */
  absorbAttack(from: Vector3): number {
    const eye = this.player.camera.globalPosition;
    const toAtk = from.subtract(eye);
    toAtk.y = 0;
    if (toAtk.lengthSquared() < 1e-6) return 1;
    toAtk.normalize();

    // Щит — надёжная защита в широком конусе.
    if (this.shieldHand) {
      const n = Vector3.TransformNormal(SHIELD_NORMAL, this.shield.getWorldMatrix());
      n.y = 0;
      if (n.lengthSquared() > 1e-6) {
        n.normalize();
        if (Vector3.Dot(n, toAtk) > Math.cos(SHIELD.blockCone)) {
          this.onBlocked(this.shieldHand, 1);
          return SHIELD.blockedDamage;
        }
      }
    }

    // Меч — узкий конус и часть урона проходит.
    if (this.held === "sword") {
      const m = this.sword.getWorldMatrix();
      const guard = Vector3.TransformCoordinates(Vector3.ZeroReadOnly, m);
      const tip = Vector3.TransformCoordinates(TIP, m);
      const mid = guard.add(tip).scale(0.5);
      const toBlade = mid.subtract(eye);
      toBlade.y = 0;
      if (toBlade.lengthSquared() > 1e-4) {
        toBlade.normalize();
        if (Vector3.Dot(toBlade, toAtk) > Math.cos(SHIELD.swordBlockCone)) {
          this.onBlocked(this.heldHand, 0.7);
          return SHIELD.swordBlockedFraction;
        }
      }
    }

    return 1;
  }

  private onBlocked(hand: Side, strength: number): void {
    this.haptic(hand, 0.9, 110);
    if (this.blockCd <= 0) {
      this.sfx.block(strength);
      this.blockCd = 0.15;
    }
  }

  // ---- взять / бросить / метнуть ----

  /** VR: каждая рука обрабатывается отдельно по своему grip. */
  private handleGripsVR(): void {
    for (const side of ["left", "right"] as Side[]) {
      const down = this.gripDown(side);
      const was = this.gripPrev[side];
      this.gripPrev[side] = down;
      const edge = down && !was;
      const released = !down && was;

      if (this.held !== "" && this.heldHand === side) {
        if (released) this.throwHeld(this.vrThrowVelocity());
        continue;
      }
      if (this.shieldHand === side) {
        if (released) this.dropShield();
        continue;
      }
      if (edge) this.tryPickup(side);
    }
  }

  private handleInteractFlat(held: boolean, edge: boolean, released: boolean, dt: number): void {
    if (this.held) {
      if (this.justPickedUp) {
        if (released) this.justPickedUp = false;
      } else {
        if (held) this.windup = clamp(this.windup + dt / THROW.flatWindup, 0, 1);
        if (released) this.throwHeld(this.flatThrowVelocity());
      }
      return;
    }
    if (edge) {
      this.tryPickup("right");
      if (this.held || this.shieldHand) this.justPickedUp = true;
    }
  }

  /** Что можно взять этой рукой, с учётом того, что уже в руках. */
  private canPick(what: Throwable): boolean {
    if (what === "shield") return this.held !== "bow" && this.shieldHand === null;
    if (what === "bow") return this.held === "" && this.shieldHand === null;
    return this.held === ""; // меч
  }

  private tryPickup(side: Side): void {
    const p = this.player.position;
    const candidates: { what: Throwable; mesh: Mesh; d: number }[] = [
      { what: "sword", mesh: this.sword, d: 0 },
      { what: "bow", mesh: this.bow, d: 0 },
      { what: "shield", mesh: this.shield, d: 0 },
    ];
    for (const c of candidates) c.d = Vector3.Distance(p, c.mesh.getAbsolutePosition());
    candidates.sort((a, b) => a.d - b.d);

    const pick = candidates.find((c) => c.d < COMBAT.equipReach && this.canPick(c.what));
    if (!pick) return;

    // Забрать из полёта, если ловим на лету.
    for (let i = this.flying.length - 1; i >= 0; i--) {
      if (this.flying[i].what === pick.what) this.flying.splice(i, 1);
    }
    pick.mesh.rotationQuaternion = null;

    if (pick.what === "shield") {
      this.shieldHand = side;
      return;
    }

    this.held = pick.what;
    this.heldHand = side;
    this.windup = 0;
    this.heldMotionInit = false;
    this.heldVel.setAll(0);
    this.heldAngVel.setAll(0);
    if (pick.what === "sword") {
      this.swingT = 0;
      this.tipTrail.length = 0;
    } else {
      this.draw = 0;
      this.vrNocked = false;
    }
  }

  private dropShield(): void {
    if (!this.shieldHand) return;
    this.shieldHand = null;
    const gy = this.groundHeight(this.shield.absolutePosition.x, this.shield.absolutePosition.z);
    this.shield.parent = null;
    this.shield.scaling.setAll(1);
    this.shieldRest.pos.set(this.shield.position.x, gy + 0.1, this.shield.position.z);
    this.shieldRest.yaw = Math.random() * Math.PI;
    this.shieldRest.bob = false;
    this.layFlat(this.shield, this.shieldRest);
  }

  private vrThrowVelocity(): Vector3 {
    return this.heldVel.scale(THROW.velScaleVR);
  }

  private flatThrowVelocity(): Vector3 {
    const w = this.windup;
    const dir = this.player.camera.getDirection(new Vector3(0, 0, 1));
    dir.y += 0.12;
    dir.normalize();
    return dir.scale(THROW.flatMinSpeed + w * (THROW.flatMaxSpeed - THROW.flatMinSpeed));
  }

  private throwHeld(vel: Vector3): void {
    const what = this.held;
    if (what !== "sword" && what !== "bow") return;
    const mesh = what === "sword" ? this.sword : this.bow;
    const worldPos = mesh.getAbsolutePosition().clone();
    const worldRot = mesh.absoluteRotationQuaternion.clone();

    mesh.parent = null;
    mesh.scaling.setAll(1);
    mesh.rotationQuaternion = worldRot;
    mesh.position.copyFrom(worldPos);

    // Вращение — только то, что игрок сам придал рукой (VR).
    let spinRate = this.player.inVR ? this.heldAngVel.length() : 0;
    const spinAxis = spinRate > 1e-3 ? this.heldAngVel.scale(1 / spinRate) : new Vector3(1, 0, 0);
    spinRate = Math.min(spinRate, 30);

    this.flying.push({
      what,
      mesh,
      vel: vel.clone(),
      spinAxis,
      spinRate,
      prev: worldPos.clone(),
      life: 0,
      hitDone: false,
    });

    this.held = "";
    this.windup = 0;
    this.justPickedUp = false;
    this.heldMotionInit = false;
    this.sfx.swordSwing();
    if (what === "bow") {
      this.nockArrow.setEnabled(false);
      this.draw = 0;
      this.vrNocked = false;
      this.nockLocal.copyFrom(this.bowParts.nockRest);
    }
  }

  private updateFlying(dt: number): void {
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i];
      f.prev.copyFrom(f.mesh.position);
      f.vel.y -= THROW.gravity * dt;
      f.mesh.position.addInPlace(f.vel.scale(dt));
      if (f.spinRate > 0.15) f.mesh.rotate(f.spinAxis, f.spinRate * dt, Space.WORLD);
      f.life += dt;

      if (!f.hitDone) {
        const dir = f.vel.clone();
        dir.y = 0;
        if (dir.lengthSquared() > 1e-6) dir.normalize();
        for (const t of this.targets) {
          if (!t.alive) continue;
          const s = t.hitSegment();
          if (segmentDistance(f.prev, f.mesh.position, s.a, s.b) < s.radius + THROW.hitRadius) {
            t.hit(dir, THROW.damage);
            this.sfx.hitThud();
            f.hitDone = true;
            f.vel.scaleInPlace(0.2);
            f.vel.y -= 1;
            break;
          }
        }
      }

      const gy = this.groundHeight(f.mesh.position.x, f.mesh.position.z);
      if (f.mesh.position.y <= gy + 0.06 || f.life > THROW.maxLife) {
        this.settleFlying(f, gy);
        this.flying.splice(i, 1);
      }
    }
  }

  private settleFlying(f: Flying, groundY: number): void {
    const rest = this.restOf(f.what);
    rest.pos.set(f.mesh.position.x, groundY + 0.12, f.mesh.position.z);
    rest.yaw = Math.atan2(f.vel.x, f.vel.z) + Math.random() * 0.5 - 0.25;
    rest.bob = false;
    f.mesh.rotationQuaternion = null;
    this.layFlat(f.mesh, rest);
  }

  private restOf(what: Throwable): RestSpot {
    return what === "sword" ? this.swordRest : what === "bow" ? this.bowRest : this.shieldRest;
  }

  /** Сглаженные линейная и угловая скорости оружия в мире — для броска в VR. */
  private trackHeldMotion(dt: number): void {
    if (!this.held) return;
    const mesh = this.held === "sword" ? this.sword : this.bow;
    const w = mesh.getAbsolutePosition();
    const q = mesh.absoluteRotationQuaternion;

    if (this.heldMotionInit && dt > 1e-4) {
      const instV = w.subtract(this.heldPrev).scaleInPlace(1 / dt);
      this.heldVel.addInPlace(instV.subtractInPlace(this.heldVel).scaleInPlace(Math.min(1, dt / 0.045)));

      const dq = q.multiply(Quaternion.Inverse(this.heldQuatPrev));
      dq.normalize();
      const wq = clamp(dq.w, -1, 1);
      const sgn = wq < 0 ? -1 : 1;
      const sn = Math.sqrt(Math.max(0, 1 - wq * wq));
      const angle = 2 * Math.acos(Math.abs(wq));
      const instW =
        sn < 1e-5
          ? new Vector3(0, 0, 0)
          : new Vector3(dq.x, dq.y, dq.z).scaleInPlace((sgn * angle) / (sn * dt));
      this.heldAngVel.addInPlace(instW.subtractInPlace(this.heldAngVel).scaleInPlace(Math.min(1, dt / 0.05)));
    }
    this.heldPrev.copyFrom(w);
    this.heldQuatPrev.copyFrom(q);
    this.heldMotionInit = true;
  }

  /** Визуальный замах в плоском режиме. */
  private applyWindup(): void {
    if (this.player.inVR || !this.held || this.windup <= 0) return;
    const mesh = this.held === "sword" ? this.sword : this.bow;
    mesh.position.z -= this.windup * 0.35;
    mesh.position.y += this.windup * 0.12;
    mesh.rotation.x -= this.windup * 0.5;
  }

  private gripDown(hand: Side): boolean {
    return !!this.controller(hand)?.inputSource.gamepad?.buttons[1]?.pressed;
  }

  /** Рука, которой натягивают тетиву (противоположная той, что держит лук). */
  private drawHand(): Side {
    return this.heldHand === "left" ? "right" : "left";
  }

  private isFlying(what: Throwable): boolean {
    return this.flying.some((f) => f.what === what);
  }

  private layFlat(mesh: Mesh, rest: RestSpot): void {
    mesh.rotationQuaternion = null;
    mesh.position.copyFrom(rest.pos);
    mesh.rotation.set(Math.PI / 2, rest.yaw, 0);
  }

  private bobIdle(dt: number): void {
    this.bob += dt;
    if (this.held !== "sword" && !this.isFlying("sword")) this.restVisual(this.sword, this.swordRest, 0);
    if (this.held !== "bow" && !this.isFlying("bow")) this.restVisual(this.bow, this.bowRest, 1);
    if (!this.shieldHand && !this.isFlying("shield")) this.restVisual(this.shield, this.shieldRest, 2);
  }

  private restVisual(mesh: Mesh, rest: RestSpot, phase: number): void {
    if (rest.bob) {
      mesh.position.set(rest.pos.x, rest.pos.y + Math.sin(this.bob * 2 + phase) * 0.08, rest.pos.z);
      mesh.rotation.set(0, this.bob * 0.7, 0);
    } else {
      this.layFlat(mesh, rest);
    }
  }

  // ---- якорь в руке ----

  /** Набор тюнинга для оружия (в VR — с учётом руки). */
  slot(): TuneSlot {
    const kind = this.held === "bow" ? "bow" : "sword";
    if (!this.player.inVR) return `${kind}Flat` as TuneSlot;
    return `${kind}VR${this.heldHand === "left" ? "Left" : "Right"}` as TuneSlot;
  }

  private shieldSlot(): TuneSlot {
    if (!this.player.inVR) return "shieldFlat";
    return this.shieldHand === "left" ? "shieldVRLeft" : "shieldVRRight";
  }

  private keepAnchored(mesh: Mesh, t: EquipTune, hand: Side): void {
    const anchor = this.handAnchor(hand);
    if (mesh.parent !== anchor) mesh.parent = anchor;
    mesh.position.copyFrom(t.pos);
    mesh.rotation.copyFrom(t.rot);
    mesh.scaling.setAll(t.scale);
  }

  private handAnchor(hand: Side): Node {
    if (this.player.inVR) {
      const c = this.controller(hand);
      const node = c?.grip ?? c?.pointer;
      if (node) return node;
    }
    return this.player.camera;
  }

  private controller(hand: Side): WebXRInputSource | undefined {
    return this.getXR()?.input.controllers.find((c) => c.inputSource.handedness === hand);
  }

  // ---- меч ----

  private updateFlatSwing(dt: number, primaryEdge: boolean): void {
    if (primaryEdge && this.swingT <= 0) {
      this.swingT = COMBAT.swingDuration;
      this.swingHitDone = false;
      this.sfx.swordSwing();
    }
    if (this.swingT > 0) {
      this.swingT -= dt;
      const phase = 1 - Math.max(0, this.swingT) / COMBAT.swingDuration;
      const arc = Math.sin(phase * Math.PI);
      this.sword.rotation.x = this.tunes.swordFlat.rot.x - arc * 1.5;
      this.sword.rotation.z = this.tunes.swordFlat.rot.z + arc * 0.45;
      if (phase > 0.3 && !this.swingHitDone) {
        this.swingHitDone = true;
        this.tryHit();
      }
    }
  }

  private updateVRSwing(dt: number): void {
    if (this.swooshCd > 0) this.swooshCd -= dt;

    const m = this.sword.getWorldMatrix();
    const guard = Vector3.TransformCoordinates(Vector3.ZeroReadOnly, m);
    const tip = Vector3.TransformCoordinates(TIP, m);
    const dir = tip.subtract(guard).normalize();

    const prev = this.tipTrail[this.tipTrail.length - 1]?.p;
    if (prev && Vector3.Distance(tip, prev) / Math.max(dt, 1e-4) > COMBAT.vrSwingSpeed) {
      this.tryHit();
    }

    for (const s of this.tipTrail) s.age += dt;
    this.tipTrail.push({ p: tip.clone(), dir, age: 0 });
    while (this.tipTrail.length > 2 && this.tipTrail[0].age > COMBAT.swooshWindow) {
      this.tipTrail.shift();
    }

    const oldest = this.tipTrail[0];
    if (oldest.age > 0.06 && this.swooshCd <= 0) {
      const avgSpeed = Vector3.Distance(tip, oldest.p) / oldest.age;
      const sweep = Math.acos(clamp(Vector3.Dot(dir, oldest.dir), -1, 1));
      if (avgSpeed > COMBAT.vrSwooshSpeed && sweep > COMBAT.vrSwooshSweep) {
        this.sfx.swordSwing();
        this.swooshCd = COMBAT.swooshCooldown;
      }
    }
  }

  private tryHit(): void {
    const m = this.sword.getWorldMatrix();
    const guard = Vector3.TransformCoordinates(Vector3.ZeroReadOnly, m);
    const tip = Vector3.TransformCoordinates(TIP, m);
    const dir = tip.subtract(this.player.camera.globalPosition);
    dir.y = 0;
    if (dir.lengthSquared() > 1e-6) dir.normalize();

    for (const t of this.targets) {
      if (!t.alive) continue;
      const seg = t.hitSegment();
      if (segmentDistance(guard, tip, seg.a, seg.b) <= seg.radius + COMBAT.hitMargin) {
        if (t.hit(dir, this.prog.swordDamage)) {
          this.sfx.hitThud();
          // Вибрирует именно та рука, которая держит меч.
          this.haptic(this.heldHand, 0.7, 70);
        }
      }
    }
  }

  // ---- рукопашная (свободной рукой) ----

  private updateVRMelee(dt: number): void {
    for (const side of ["left", "right"] as Side[]) {
      if (this.fistCd[side] > 0) this.fistCd[side] -= dt;
      // Рука занята щитом — кулаком не бьём.
      if (this.shieldHand === side) {
        this.fistInit[side] = false;
        continue;
      }
      const node = this.controller(side)?.grip ?? this.controller(side)?.pointer;
      if (!node) {
        this.fistInit[side] = false;
        continue;
      }
      const now = node.getAbsolutePosition();
      const prev = this.fistPrev[side];
      if (this.fistInit[side] && this.fistCd[side] <= 0) {
        const speed = Vector3.Distance(now, prev) / Math.max(dt, 1e-4);
        if (speed > MELEE.vrSpeed) {
          const dir = now.subtract(prev);
          dir.y = 0;
          if (dir.lengthSquared() > 1e-6) dir.normalize();
          for (const t of this.targets) {
            if (!t.alive) continue;
            const s = t.hitSegment();
            if (segmentDistance(prev, now, s.a, s.b) <= s.radius + MELEE.reach) {
              if (t.hit(dir, MELEE.damage)) {
                this.sfx.hitThud(0.55);
                this.haptic(side, 0.6, 60);
                this.fistCd[side] = MELEE.cooldown;
              }
              break;
            }
          }
        }
      }
      prev.copyFrom(now);
      this.fistInit[side] = true;
    }
  }

  private updateFlatMelee(dt: number, primaryEdge: boolean): void {
    if (this.meleeFlatCd > 0) this.meleeFlatCd -= dt;
    if (!primaryEdge || this.meleeFlatCd > 0) return;
    this.meleeFlatCd = MELEE.cooldown;
    this.sfx.swordSwing();

    const eye = this.player.camera.globalPosition;
    const fwd = this.player.camera.getDirection(new Vector3(0, 0, 1));
    const reach = eye.add(fwd.scale(MELEE.flatReach));
    let landed = false;
    for (const t of this.targets) {
      if (!t.alive) continue;
      const s = t.hitSegment();
      if (segmentDistance(eye, reach, s.a, s.b) <= s.radius + 0.3) {
        const dir = fwd.clone();
        dir.y = 0;
        if (dir.lengthSquared() > 1e-6) dir.normalize();
        if (t.hit(dir, MELEE.damage)) landed = true;
      }
    }
    if (landed) this.sfx.hitThud(0.55);
  }

  // ---- лук ----

  private updateBow(dt: number, primaryHeld: boolean, primaryReleased: boolean): void {
    if (this.player.inVR) {
      this.updateBowVR();
      return;
    }
    if (primaryHeld) {
      if (this.draw === 0) this.sfx.bowDraw();
      this.draw = clamp(this.draw + dt / BOW.drawTimeFlat, 0, 1);
    }
    this.nockArrow.setEnabled(this.draw > 0.02);
    this.placeNockArrow(
      new Vector3(
        this.bowParts.nockRest.x,
        this.bowParts.nockRest.y,
        this.bowParts.nockRest.z + this.draw * BOW.drawPullFlat,
      ),
      new Vector3(0, 0, -1),
    );

    if (primaryReleased) {
      const power = this.draw;
      this.draw = 0;
      this.nockArrow.setEnabled(false);
      this.nockLocal.copyFrom(this.bowParts.nockRest);
      if (power >= BOW.fireThreshold) {
        const dir = this.player.camera.getDirection(new Vector3(0, 0, 1));
        const origin = this.player.camera.globalPosition.add(dir.scale(0.5));
        this.fire(origin, dir, power);
      }
    }
  }

  private updateBowVR(): void {
    const dc = this.controller(this.drawHand());
    const trigger = !!dc?.inputSource.gamepad?.buttons[0]?.pressed;
    const drawPos = (dc?.grip ?? dc?.pointer)?.getAbsolutePosition();

    const bowMat = this.bow.getWorldMatrix();
    const nockWorld = Vector3.TransformCoordinates(this.bowParts.nockRest, bowMat);

    if (trigger && drawPos) {
      if (!this.vrNocked && !this.prevVrTrigger && Vector3.Distance(drawPos, nockWorld) < BOW.grabDistVR) {
        this.vrNocked = true;
        this.sfx.bowDraw();
        this.haptic(this.drawHand(), 0.35, 40);
      }
      if (this.vrNocked) {
        const pull = Vector3.Distance(drawPos, nockWorld);
        this.draw = clamp((pull - BOW.restDrawVR) / (BOW.maxDrawVR - BOW.restDrawVR), 0, 1);
        const local = Vector3.TransformCoordinates(drawPos, Matrix.Invert(bowMat));
        this.placeNockArrow(local, local.scale(-1));
        this.nockArrow.setEnabled(true);
      }
    } else if (this.vrNocked) {
      const power = this.draw;
      this.vrNocked = false;
      this.draw = 0;
      this.nockArrow.setEnabled(false);
      this.nockLocal.copyFrom(this.bowParts.nockRest);
      const gripWorld = this.bow.getAbsolutePosition();
      if (power >= BOW.fireThreshold && drawPos) {
        const dir = gripWorld.subtract(drawPos).normalize();
        this.fire(gripWorld.add(dir.scale(0.35)), dir, power);
      }
    }
    this.prevVrTrigger = trigger;
  }

  private readonly nockLocal = new Vector3();
  private placeNockArrow(nock: Vector3, dir: Vector3): void {
    this.nockLocal.copyFrom(nock);
    const d = dir.length() > 1e-4 ? dir.normalize() : new Vector3(0, 0, -1);
    this.nockArrow.rotation.set(-Math.asin(clamp(d.y, -1, 1)), Math.atan2(d.x, d.z), 0);
    this.nockArrow.position.copyFrom(nock).addInPlace(d.scale(0.34));
  }

  private updateString(): void {
    MeshBuilder.CreateLines("bowString", {
      points: [this.bowParts.topTip, this.nockLocal, this.bowParts.bottomTip],
      instance: this.bowString,
    });
  }

  private fire(origin: Vector3, dir: Vector3, power: number): void {
    this.sfx.bowRelease(power);
    this.haptic("right", 0.6, 60);
    this.haptic("left", 0.6, 60);
    if (this.arrows.length >= 16) this.arrows.shift()?.dispose();

    const p = Math.pow(clamp(power, 0, 1), BOW.powerCurve);
    const speed = BOW.minSpeed + p * (BOW.maxSpeed - BOW.minSpeed) + this.prog.arrowSpeedBonus;
    this.arrows.push(new Arrow(this.arrowProto, origin, dir.scale(speed)));
  }

  private readonly arrowCtx: {
    scene: Scene;
    targets: Hittable[];
    isSolid: (m: AbstractMesh) => boolean;
    onHit: (kind: "flesh" | "wood", pos: Vector3) => void;
  };

  // ---- VR настройка положения в руке (сейчас выключена во вводе) ----

  private updateVRTune(tuneInput: TuneInput | null, dt: number): boolean {
    const slot = this.slot();
    if (tuneInput) {
      const t = this.tunes[slot];
      t.rot.x += -tuneInput.ly * VR_TUNE_ROT * dt;
      t.rot.y += tuneInput.lx * VR_TUNE_ROT * dt;
      t.rot.z += tuneInput.rx * VR_TUNE_ROT * dt;
      t.pos.z += -tuneInput.ry * VR_TUNE_POS * dt;
      this.tuning = true;
      return true;
    }
    if (this.tuning) {
      this.tuning = false;
      this.saveTuning();
      this.haptic(this.heldHand, 0.6, 90);
      const v = this.tunes[slot];
      const f = (n: number) => n.toFixed(3);
      console.log(
        `${slot}: pos(${f(v.pos.x)}, ${f(v.pos.y)}, ${f(v.pos.z)}) rot(${f(v.rot.x)}, ${f(v.rot.y)}, ${f(v.rot.z)})`,
      );
    }
    return false;
  }

  private haptic(hand: Side, strength: number, ms: number): void {
    const pad = this.controller(hand)?.inputSource.gamepad as
      | { hapticActuators?: { pulse?: (v: number, ms: number) => void }[] }
      | undefined;
    pad?.hapticActuators?.[0]?.pulse?.(strength, ms);
  }
}
