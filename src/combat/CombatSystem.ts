import type { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Vector3, Matrix, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Node } from "@babylonjs/core/node";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { WebXRDefaultExperience } from "@babylonjs/core/XR/webXRDefaultExperience";
import type { WebXRInputSource } from "@babylonjs/core/XR/webXRInputSource";
import { Space } from "@babylonjs/core/Maths/math.axis";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/linesBuilder";

import { BOW, COMBAT, HOLSTER, MELEE, SHIELD, THROW } from "../shared/constants";
import { LOADOUT, type Placement } from "../config/loadout";
import { clamp, closestPointOnSegment, segmentDistance } from "../shared/geometry";
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
/** Локальная нормаль щита — «наружу» смотрит +Y. */
const SHIELD_NORMAL = new Vector3(0, 1, 0);

type Slot = { pos: [number, number, number]; rot: [number, number, number]; scale: number };
/**
 * Как предмет лежит за спиной. Локальные оси спины: -Z позади игрока, +X вправо.
 * Мутабельно — можно крутить из консоли: `game.stowConfig().sword.left.pos[1] = 0.2`.
 */
export const STOW: Record<"sword" | "bow" | "shield", Record<"left" | "right", Slot>> = {
  sword: {
    left: { pos: [-0.2, 0.12, -0.13], rot: [0.4, 0, 0.55], scale: 1 },
    right: { pos: [0.2, 0.12, -0.13], rot: [0.4, 0, -0.55], scale: 1 },
  },
  bow: {
    left: { pos: [-0.14, 0.04, -0.16], rot: [0.15, 0, 1.35], scale: 1 },
    right: { pos: [0.14, 0.04, -0.16], rot: [0.15, 0, -1.35], scale: 1 },
  },
  shield: {
    left: { pos: [-0.12, 0.08, -0.17], rot: [Math.PI / 2, 0, 0], scale: 1 },
    right: { pos: [0.12, 0.08, -0.17], rot: [Math.PI / 2, 0, 0], scale: 1 },
  },
};

export type ItemKind = "sword" | "bow" | "shield";

/** Один предмет, который можно взять, бросить и метнуть. */
interface Item {
  kind: ItemKind;
  mesh: Mesh;
  /** Рука, которая держит предмет, либо null. */
  hand: Side | null;
  /** Где лежит, когда его не держат. */
  rest: { pos: Vector3; yaw: number; bob: boolean };
  /** Полётное состояние — не null, пока предмет летит. */
  flight: Flight | null;
  /** Рука, за спину которой предмет убран, либо null. */
  stow: Side | null;
}

interface Flight {
  vel: Vector3;
  spinAxis: Vector3;
  spinRate: number;
  prev: Vector3;
  life: number;
  hitDone: boolean;
}

/** Сглаженные скорости руки — по ним предмет улетает при отпускании. */
interface HandMotion {
  prev: Vector3;
  quatPrev: Quaternion;
  vel: Vector3;
  angVel: Vector3;
  init: boolean;
}

function newMotion(): HandMotion {
  return {
    prev: new Vector3(),
    quatPrev: new Quaternion(),
    vel: new Vector3(),
    angVel: new Vector3(),
    init: false,
  };
}

export class CombatSystem {
  private readonly items: Record<ItemKind, Item>;
  private readonly bowParts: BowParts;
  private readonly bowString: LinesMesh;
  private readonly nockArrow: Mesh;
  private readonly arrowProto: Mesh;
  private readonly arrows: Arrow[] = [];

  private readonly motion: Record<Side, HandMotion> = {
    left: newMotion(),
    right: newMotion(),
  };
  private readonly gripPrev: Record<Side, boolean> = { left: false, right: false };

  private prevInteract = false;
  private prevPrimary = false;
  private justPickedUp = false; // взяли тем же нажатием E — не бросать сразу
  private windup = 0; // замах перед броском (плоский режим), 0..1

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

  private blockCd = 0;
  private bob = 0;

  // Скорость руки/клинка считаем В ЛОКАЛЬНЫХ ОСЯХ ГОЛОВЫ — тогда ни ходьба
  // стиком, ни snap-turn не выглядят как замах или удар (рука движется вместе
  // с головой -> в её осях смещение почти нулевое).
  private readonly headMat = Matrix.Identity();
  private readonly headInv = Matrix.Identity();
  private readonly headQuat = new Quaternion();
  /** Небольшое окно после snap-turn — на всякий случай глушим триггеры. */
  private turnCd = 0;
  /** Узел на спине игрока: сюда крепятся убранные за спину предметы. */
  private backAnchor!: TransformNode;
  private readonly fistPrevW: Record<Side, Vector3> = { left: new Vector3(), right: new Vector3() };

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
    const sword = createSword(scene);
    const shield = createShield(scene);
    this.bowParts = createBow(scene);
    const bow = this.bowParts.mesh;

    this.items = {
      sword: this.makeItem("sword", sword, swordHome),
      bow: this.makeItem("bow", bow, bowHome),
      shield: this.makeItem("shield", shield, shieldHome),
    };
    this.backAnchor = new TransformNode("backAnchor", scene);

    const stringPts = [this.bowParts.topTip, this.bowParts.nockRest, this.bowParts.bottomTip];
    this.bowString = MeshBuilder.CreateLines("bowString", { points: stringPts, updatable: true }, scene);
    this.bowString.color = new Color3(0.85, 0.85, 0.8);
    this.bowString.parent = bow;
    this.bowString.isPickable = false;

    this.arrowProto = createArrowProto(scene);
    this.nockArrow = this.arrowProto.clone("nockArrow");
    this.nockArrow.parent = bow;
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
  }

  private makeItem(kind: ItemKind, mesh: Mesh, home: Vector3): Item {
    mesh.position.copyFrom(home);
    return { kind, mesh, hand: null, rest: { pos: home.clone(), yaw: 0, bob: true }, flight: null, stow: null };
  }

  // ---- что где ----

  private get sword(): Mesh {
    return this.items.sword.mesh;
  }
  private get bow(): Mesh {
    return this.items.bow.mesh;
  }
  private get shield(): Mesh {
    return this.items.shield.mesh;
  }

  /** Что в этой руке. */
  private inHand(hand: Side): Item | null {
    for (const k of ["sword", "bow", "shield"] as ItemKind[]) {
      if (this.items[k].hand === hand) return this.items[k];
    }
    return null;
  }

  /** Оружие (меч или лук) и рука, которая его держит. */
  private get weapon(): Item | null {
    if (this.items.sword.hand) return this.items.sword;
    if (this.items.bow.hand) return this.items.bow;
    return null;
  }
  private get held(): "" | "sword" | "bow" {
    return (this.weapon?.kind as "sword" | "bow") ?? "";
  }
  private get heldHand(): Side {
    return this.weapon?.hand ?? "right";
  }
  private get shieldHand(): Side | null {
    return this.items.shield.hand;
  }

  get vrActive(): boolean {
    return this.player.inVR;
  }

  /** Текущее положение предмета в руке из файла настроек (читается каждый кадр). */
  private placement(kind: ItemKind, hand: Side): Placement {
    const p = LOADOUT.items[kind];
    if (!this.player.inVR) return p.flat;
    return hand === "left" ? p.vrLeft : p.vrRight;
  }

  // ---- локальные оси головы ----

  private computeHead(): void {
    const cam =
      (this.player.inVR && this.getXR()?.baseExperience.camera) || this.player.camera;
    // getWorldMatrix() пересчитывает, если узел «грязный» — а он грязный:
    // player.update этим кадром уже подвинул риг/камеру.
    this.headMat.copyFrom(cam.getWorldMatrix());
    this.headMat.invertToRef(this.headInv);
    Quaternion.FromRotationMatrixToRef(this.headMat, this.headQuat);
  }

  /** Мировую точку -> в локальные оси головы. */
  private headLocal(world: Vector3): Vector3 {
    return Vector3.TransformCoordinates(world, this.headInv);
  }

  /** Локальное направление головы -> в мировое. */
  private headWorldDir(local: Vector3): Vector3 {
    return Vector3.TransformNormal(local, this.headMat);
  }

  // ---- прятать за спину ----

  private stowedKind(side: Side): ItemKind | null {
    for (const k of ["sword", "bow", "shield"] as ItemKind[]) {
      if (this.items[k].stow === side) return k;
    }
    return null;
  }

  /** Рука заведена за плечо (в локальных осях головы — позади, на уровне плеча). */
  private handAtShoulder(side: Side): boolean {
    if (!this.player.inVR) return false;
    const c = this.controller(side);
    const node = c?.grip ?? c?.pointer;
    if (!node) return false;
    const l = this.headLocal(node.getAbsolutePosition());
    return (
      l.z < -HOLSTER.behind &&
      l.y > HOLSTER.yMin &&
      l.y < HOLSTER.yMax &&
      l.length() < HOLSTER.reach
    );
  }

  private stowItem(item: Item, side: Side): void {
    item.hand = null;
    item.flight = null;
    item.stow = side;
    item.mesh.rotationQuaternion = null;
    this.resetHand(side);
    this.haptic(side, 0.4, 55);
    this.sfx.bowDraw();
    if (item.kind === "bow") {
      this.nockArrow.setEnabled(false);
      this.draw = 0;
      this.vrNocked = false;
    }
  }

  private drawItem(side: Side): void {
    const kind = this.stowedKind(side);
    if (!kind) return;
    const item = this.items[kind];
    item.stow = null;
    item.flight = null;
    item.hand = side;
    item.mesh.rotationQuaternion = null;
    this.resetHand(side);
    if (kind === "sword") {
      this.swingT = 0;
      this.tipTrail.length = 0;
    } else if (kind === "bow") {
      this.draw = 0;
      this.vrNocked = false;
    }
    this.haptic(side, 0.5, 55);
  }

  private resetHand(side: Side): void {
    this.windup = 0;
    this.motion[side].init = false;
    this.motion[side].vel.setAll(0);
    this.motion[side].angVel.setAll(0);
  }

  /** Выход из VR: убранное за спину роняем на землю (взять его нечем). */
  dropStowed(): void {
    for (const kind of ["sword", "bow", "shield"] as ItemKind[]) {
      const item = this.items[kind];
      if (!item.stow) continue;
      item.stow = null;
      const p = this.player.position;
      item.mesh.parent = null;
      item.mesh.rotationQuaternion = null;
      const gy = this.groundHeight(p.x, p.z);
      item.rest.pos.set(p.x + (Math.random() - 0.5), gy + 0.12, p.z + (Math.random() - 0.5));
      item.rest.bob = false;
      this.layFlat(item);
    }
  }

  /** Узел «спина»: центр под головой, повёрнут по рысканью взгляда. */
  private updateBackAnchor(): void {
    const head = this.player.eyePosition;
    const f = this.player.eyeForward;
    this.backAnchor.position.set(head.x, head.y - HOLSTER.backDrop, head.z);
    this.backAnchor.rotation.set(0, Math.atan2(f.x, f.z), 0);
    this.backAnchor.computeWorldMatrix(true);
  }

  private anchorStowedItems(): void {
    for (const kind of ["sword", "bow", "shield"] as ItemKind[]) {
      const item = this.items[kind];
      if (!item.stow) continue;
      const t = STOW[kind][item.stow];
      if (item.mesh.parent !== this.backAnchor) item.mesh.parent = this.backAnchor;
      item.mesh.rotationQuaternion = null;
      item.mesh.position.set(t.pos[0], t.pos[1], t.pos[2]);
      item.mesh.rotation.set(t.rot[0], t.rot[1], t.rot[2]);
      item.mesh.scaling.setAll(t.scale);
    }
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

    // Матрица головы за кадр (для локальных осей) + окно после snap-turn.
    this.computeHead();
    this.turnCd = Math.max(0, this.turnCd - dt);
    if (inp.lookYaw !== 0) this.turnCd = 0.15;

    // Q (плоский режим) — снять щит: летит так же, как оружие.
    if (inp.dropItem && this.shieldHand) {
      this.throwItem(this.items.shield, this.flatThrowVelocity(0));
    }

    if (this.player.inVR) this.handleGripsVR();
    else this.handleInteractFlat(inp.interact, interactEdge, interactReleased, dt);

    this.updateRestPoses(dt);
    this.anchorHeldItems();
    this.updateBackAnchor();
    this.anchorStowedItems();
    this.shoveWithHeldItems();

    if (this.held === "sword") {
      if (this.player.inVR) this.updateVRSwing(dt);
      else this.updateFlatSwing(dt, primaryEdge);
    } else if (this.held === "bow") {
      this.updateBow(dt, inp.primaryAction, primaryReleased);
    } else {
      // Свободные руки — рукопашная.
      if (this.player.inVR) this.updateVRMelee(dt);
      else this.updateFlatMelee(dt, primaryEdge);
    }

    this.applyWindup();
    this.trackHandMotion(dt);
    this.updateString();
    this.updateFlights(dt);

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
   * `projectile` — плевок и т.п.: меч отбивает его полностью (как щит), а не на 75%.
   * Возвращает множитель: 0 — заблокировано полностью, 1 — прошло целиком.
   */
  absorbAttack(from: Vector3, projectile = false): number {
    const eye = this.player.eyePosition;
    const toAtk = from.subtract(eye);
    toAtk.y = 0;
    if (toAtk.lengthSquared() < 1e-6) return 1;
    toAtk.normalize();

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

    if (this.held === "sword") {
      const m = this.sword.getWorldMatrix();
      const guard = Vector3.TransformCoordinates(Vector3.ZeroReadOnly, m);
      const tip = Vector3.TransformCoordinates(TIP, m);
      const mid = guard.add(tip).scale(0.5);
      const toBlade = mid.subtract(eye);
      toBlade.y = 0;
      if (toBlade.lengthSquared() > 1e-4) {
        toBlade.normalize();
        const cone = projectile ? SHIELD.swordProjectileCone : SHIELD.swordBlockCone;
        if (Vector3.Dot(toBlade, toAtk) > Math.cos(cone)) {
          this.onBlocked(this.heldHand, projectile ? 1 : 0.7);
          return projectile ? SHIELD.blockedDamage : SHIELD.swordBlockedFraction;
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

  // ---- взять / метнуть ----

  /** VR: каждая рука отдельно. За плечом grip прячет/достаёт, иначе берёт/метает. */
  private handleGripsVR(): void {
    for (const side of ["left", "right"] as Side[]) {
      const down = this.gripDown(side);
      const was = this.gripPrev[side];
      this.gripPrev[side] = down;

      const atShoulder = this.handAtShoulder(side);
      const item = this.inHand(side);
      if (item) {
        if (!down && was) {
          // Отпустил за плечом и слот свободен -> убрать за спину; иначе метнуть.
          if (atShoulder && !this.stowedKind(side)) this.stowItem(item, side);
          else this.throwItem(item, this.vrThrowVelocity(side));
        }
        continue;
      }
      if (down && !was) {
        // Нажал за плечом и там что-то лежит -> достать; иначе поднять с земли.
        if (atShoulder && this.stowedKind(side)) this.drawItem(side);
        else this.tryPickup(side);
      }
    }
  }

  private handleInteractFlat(held: boolean, edge: boolean, released: boolean, dt: number): void {
    const w = this.weapon;
    if (w) {
      if (this.justPickedUp) {
        if (released) this.justPickedUp = false;
      } else {
        if (held) this.windup = clamp(this.windup + dt / THROW.flatWindup, 0, 1);
        if (released) this.throwItem(w, this.flatThrowVelocity(this.windup));
      }
      return;
    }
    if (edge) {
      const before = this.weapon || this.items.shield.hand;
      this.tryPickup("right");
      if (!before && (this.weapon || this.items.shield.hand)) this.justPickedUp = true;
    }
  }

  /** Что можно взять этой рукой, с учётом того, что уже в руках. */
  private canPick(what: ItemKind): boolean {
    if (this.items[what].hand || this.items[what].stow) return false; // держим / за спиной
    if (what === "shield") return this.held !== "bow";
    if (what === "bow") return this.held === "" && !this.shieldHand;
    return this.held === ""; // меч
  }

  private tryPickup(side: Side): void {
    const p = this.player.position;
    const near = (["sword", "bow", "shield"] as ItemKind[])
      .map((k) => ({ k, d: Vector3.Distance(p, this.items[k].mesh.getAbsolutePosition()) }))
      .sort((a, b) => a.d - b.d)
      .find((c) => c.d < COMBAT.equipReach && this.canPick(c.k));
    if (!near) return;

    const item = this.items[near.k];
    item.flight = null; // можно поймать на лету
    item.hand = side;
    item.mesh.rotationQuaternion = null;

    this.windup = 0;
    this.motion[side].init = false;
    this.motion[side].vel.setAll(0);
    this.motion[side].angVel.setAll(0);

    if (item.kind === "sword") {
      this.swingT = 0;
      this.tipTrail.length = 0;
    } else if (item.kind === "bow") {
      this.draw = 0;
      this.vrNocked = false;
    }
  }

  private vrThrowVelocity(side: Side): Vector3 {
    // motion.vel — в осях головы; переводим в мир и добавляем ход самой головы.
    return this.headWorldDir(this.motion[side].vel).scale(THROW.velScaleVR);
  }

  private flatThrowVelocity(windup: number): Vector3 {
    const dir = this.player.camera.getDirection(new Vector3(0, 0, 1));
    dir.y += 0.12;
    dir.normalize();
    return dir.scale(THROW.flatMinSpeed + windup * (THROW.flatMaxSpeed - THROW.flatMinSpeed));
  }

  /** Общий бросок: работает одинаково для меча, лука и щита. */
  private throwItem(item: Item, vel: Vector3): void {
    const hand = item.hand;
    const mesh = item.mesh;
    const worldPos = mesh.getAbsolutePosition().clone();
    const worldRot = mesh.absoluteRotationQuaternion.clone();

    mesh.parent = null;
    mesh.scaling.setAll(1);
    mesh.rotationQuaternion = worldRot;
    mesh.position.copyFrom(worldPos);

    // Вращение — только то, что игрок сам придал рукой (VR). angVel в осях головы.
    const angVelL = hand && this.player.inVR ? this.motion[hand].angVel : null;
    const angVel = angVelL ? this.headWorldDir(angVelL) : null;
    let spinRate = angVel ? angVel.length() : 0;
    const spinAxis = spinRate > 1e-3 && angVel ? angVel.scale(1 / spinRate) : new Vector3(1, 0, 0);
    spinRate = Math.min(spinRate, 30);

    item.hand = null;
    item.flight = {
      vel: vel.clone(),
      spinAxis,
      spinRate,
      prev: worldPos.clone(),
      life: 0,
      hitDone: false,
    };

    if (hand) this.motion[hand].init = false;
    this.windup = 0;
    this.justPickedUp = false;
    this.sfx.swordSwing();

    if (item.kind === "bow") {
      this.nockArrow.setEnabled(false);
      this.draw = 0;
      this.vrNocked = false;
      this.nockLocal.copyFrom(this.bowParts.nockRest);
    }
  }

  private updateFlights(dt: number): void {
    for (const kind of ["sword", "bow", "shield"] as ItemKind[]) {
      const item = this.items[kind];
      const f = item.flight;
      if (!f) continue;
      const mesh = item.mesh;

      f.prev.copyFrom(mesh.position);
      f.vel.y -= THROW.gravity * dt;
      mesh.position.addInPlace(f.vel.scale(dt));
      if (f.spinRate > 0.15) mesh.rotate(f.spinAxis, f.spinRate * dt, Space.WORLD);
      f.life += dt;

      if (!f.hitDone) {
        const dir = f.vel.clone();
        dir.y = 0;
        if (dir.lengthSquared() > 1e-6) dir.normalize();
        for (const t of this.targets) {
          if (!t.alive) continue;
          const s = t.hitSegment();
          if (segmentDistance(f.prev, mesh.position, s.a, s.b) < s.radius + THROW.hitRadius) {
            t.hit(dir, THROW.damage, mesh.position.clone());
            this.sfx.hitThud();
            f.hitDone = true;
            f.vel.scaleInPlace(0.2);
            f.vel.y -= 1;
            break;
          }
        }
      }

      const gy = this.groundHeight(mesh.position.x, mesh.position.z);
      if (mesh.position.y <= gy + 0.06 || f.life > THROW.maxLife) {
        item.rest.pos.set(mesh.position.x, gy + 0.12, mesh.position.z);
        item.rest.yaw = Math.atan2(f.vel.x, f.vel.z) + Math.random() * 0.5 - 0.25;
        item.rest.bob = false;
        item.flight = null;
        mesh.rotationQuaternion = null;
        this.layFlat(item);
      }
    }
  }

  /** Сглаженные скорости каждой руки — для броска в VR. */
  private trackHandMotion(dt: number): void {
    for (const side of ["left", "right"] as Side[]) {
      const item = this.inHand(side);
      const m = this.motion[side];
      if (!item) {
        m.init = false;
        continue;
      }
      // Позиция и поворот — В ОСЯХ ГОЛОВЫ: ходьба/поворот игрока не вносят вклад.
      const w = this.headLocal(item.mesh.getAbsolutePosition());
      const q = Quaternion.Inverse(this.headQuat).multiply(item.mesh.absoluteRotationQuaternion);

      if (m.init && dt > 1e-4 && this.turnCd <= 0) {
        const instV = w.subtract(m.prev).scaleInPlace(1 / dt);
        m.vel.addInPlace(instV.subtractInPlace(m.vel).scaleInPlace(Math.min(1, dt / 0.045)));

        const dq = q.multiply(Quaternion.Inverse(m.quatPrev));
        dq.normalize();
        const wq = clamp(dq.w, -1, 1);
        const sgn = wq < 0 ? -1 : 1;
        const sn = Math.sqrt(Math.max(0, 1 - wq * wq));
        const angle = 2 * Math.acos(Math.abs(wq));
        const instW =
          sn < 1e-5
            ? new Vector3(0, 0, 0)
            : new Vector3(dq.x, dq.y, dq.z).scaleInPlace((sgn * angle) / (sn * dt));
        m.angVel.addInPlace(instW.subtractInPlace(m.angVel).scaleInPlace(Math.min(1, dt / 0.05)));
      }
      m.prev.copyFrom(w);
      m.quatPrev.copyFrom(q);
      m.init = true;
    }
  }

  /** Визуальный замах в плоском режиме. */
  private applyWindup(): void {
    const w = this.weapon;
    if (this.player.inVR || !w || this.windup <= 0) return;
    w.mesh.position.z -= this.windup * 0.35;
    w.mesh.position.y += this.windup * 0.12;
    w.mesh.rotation.x -= this.windup * 0.5;
  }

  private gripDown(hand: Side): boolean {
    return !!this.controller(hand)?.inputSource.gamepad?.buttons[1]?.pressed;
  }

  /** Рука, которой натягивают тетиву (противоположная той, что держит лук). */
  private drawHand(): Side {
    return this.heldHand === "left" ? "right" : "left";
  }

  private layFlat(item: Item): void {
    item.mesh.rotationQuaternion = null;
    item.mesh.position.copyFrom(item.rest.pos);
    item.mesh.rotation.set(Math.PI / 2, item.rest.yaw, 0);
  }

  /** Предметы, которые никто не держит и которые не летят, лежат/парят на месте. */
  private updateRestPoses(dt: number): void {
    this.bob += dt;
    let phase = 0;
    for (const kind of ["sword", "bow", "shield"] as ItemKind[]) {
      const item = this.items[kind];
      phase++;
      if (item.hand || item.flight || item.stow) continue;
      if (item.rest.bob) {
        item.mesh.position.set(
          item.rest.pos.x,
          item.rest.pos.y + Math.sin(this.bob * 2 + phase) * 0.08,
          item.rest.pos.z,
        );
        item.mesh.rotation.set(0, this.bob * 0.7, 0);
      } else {
        this.layFlat(item);
      }
    }
  }

  /** Прикрепляет всё, что в руках, по настройкам из loadout (каждый кадр). */
  private anchorHeldItems(): void {
    for (const kind of ["sword", "bow", "shield"] as ItemKind[]) {
      const item = this.items[kind];
      if (!item.hand) continue;
      const t = this.placement(kind, item.hand);
      const anchor = this.handAnchor(item.hand);
      if (item.mesh.parent !== anchor) item.mesh.parent = anchor;
      item.mesh.rotationQuaternion = null;
      item.mesh.position.set(t.pos[0], t.pos[1], t.pos[2]);
      item.mesh.rotation.set(t.rot[0], t.rot[1], t.rot[2]);
      item.mesh.scaling.setAll(t.scale);
    }
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

  /**
   * Предметы в руках расталкивают мобов (не урон): прислонил меч/щит —
   * моб отъезжает; скорость толчка тем выше, чем быстрее движется рука.
   */
  private shoveWithHeldItems(): void {
    for (const kind of ["sword", "bow", "shield"] as ItemKind[]) {
      const item = this.items[kind];
      if (!item.hand) continue;
      const m = item.mesh.getWorldMatrix();
      const origin = Vector3.TransformCoordinates(Vector3.ZeroReadOnly, m);
      let a = origin;
      let b = origin;
      let rad = 0.22;
      if (kind === "sword") {
        b = Vector3.TransformCoordinates(TIP, m);
        rad = 0.14;
      } else if (kind === "shield") {
        rad = SHIELD.radius + 0.05;
      }
      const handSpeed = this.player.inVR ? this.motion[item.hand].vel.length() : 2;
      const strength = Math.min(6, 1.4 + handSpeed);
      for (const t of this.targets) {
        if (!t.alive || !t.shove || !t.center) continue;
        const s = t.hitSegment();
        if (segmentDistance(a, b, s.a, s.b) < s.radius + rad) {
          const dir = t.center().subtract(this.player.eyePosition);
          dir.y = 0;
          if (dir.lengthSquared() < 1e-6) continue;
          dir.normalize();
          t.shove(dir, strength);
        }
      }
    }
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
      const base = LOADOUT.items.sword.flat.rot;
      // Клинок идёт вниз-ВПЕРЁД (локальный +Y заваливается к +Z, от игрока).
      this.sword.rotation.x = base[0] + arc * 1.5;
      this.sword.rotation.z = base[2] - arc * 0.45;
      if (phase > 0.3 && !this.swingHitDone) {
        this.swingHitDone = true;
        this.tryHit();
      }
    }
  }

  private updateVRSwing(dt: number): void {
    if (this.swooshCd > 0) this.swooshCd -= dt;

    const m = this.sword.getWorldMatrix();
    // Кончик и гарда — в осях головы: ходьба/поворот не выглядят как замах.
    const guard = this.headLocal(Vector3.TransformCoordinates(Vector3.ZeroReadOnly, m));
    const tip = this.headLocal(Vector3.TransformCoordinates(TIP, m));
    const dir = tip.subtract(guard).normalize();

    const prev = this.tipTrail[this.tipTrail.length - 1]?.p;
    if (prev && this.turnCd <= 0) {
      if (Vector3.Distance(tip, prev) / Math.max(dt, 1e-4) > COMBAT.vrSwingSpeed) this.tryHit();
    }

    for (const s of this.tipTrail) s.age += dt;
    this.tipTrail.push({ p: tip.clone(), dir, age: 0 });
    while (this.tipTrail.length > 2 && this.tipTrail[0].age > COMBAT.swooshWindow) {
      this.tipTrail.shift();
    }

    const oldest = this.tipTrail[0];
    if (oldest.age > 0.06 && this.swooshCd <= 0 && this.turnCd <= 0) {
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
    const dir = tip.subtract(this.player.eyePosition);
    dir.y = 0;
    if (dir.lengthSquared() > 1e-6) dir.normalize();

    for (const t of this.targets) {
      if (!t.alive) continue;
      const seg = t.hitSegment();
      if (segmentDistance(guard, tip, seg.a, seg.b) <= seg.radius + COMBAT.hitMargin) {
        // Точка касания = ближайшая к телу точка самого клинка (guard..tip),
        // не проекция на ось цели — тогда рана встаёт туда, где вошёл клинок.
        const mid = seg.a.add(seg.b).scale(0.5);
        const contact = closestPointOnSegment(mid, guard, tip);
        if (t.hit(dir, this.prog.swordDamage, contact)) {
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
      if (this.inHand(side)) {
        this.fistInit[side] = false;
        continue;
      }
      const node = this.controller(side)?.grip ?? this.controller(side)?.pointer;
      if (!node) {
        this.fistInit[side] = false;
        continue;
      }
      const nowW = node.getAbsolutePosition();
      const nowL = this.headLocal(nowW);
      const prevL = this.fistPrev[side];
      const prevW = this.fistPrevW[side];
      if (
        this.fistInit[side] &&
        this.fistCd[side] <= 0 &&
        this.turnCd <= 0 &&
        !this.handAtShoulder(side)
      ) {
        // Скорость кулака В ОСЯХ ГОЛОВЫ — ходьба/поворот игрока не бьют.
        const speed = Vector3.Distance(nowL, prevL) / Math.max(dt, 1e-4);
        if (speed > MELEE.vrSpeed) {
          const dir = nowW.subtract(prevW);
          dir.y = 0;
          if (dir.lengthSquared() > 1e-6) dir.normalize();
          for (const t of this.targets) {
            if (!t.alive) continue;
            const s = t.hitSegment();
            if (segmentDistance(prevW, nowW, s.a, s.b) <= s.radius + MELEE.reach) {
              if (t.hit(dir, MELEE.damage, nowW.clone())) {
                this.sfx.hitThud(0.55);
                this.haptic(side, 0.6, 60);
                this.fistCd[side] = MELEE.cooldown;
              }
              break;
            }
          }
        }
      }
      prevL.copyFrom(nowL);
      prevW.copyFrom(nowW);
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
        const mid = s.a.add(s.b).scale(0.5);
        if (t.hit(dir, MELEE.damage, closestPointOnSegment(mid, eye, reach))) landed = true;
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

  private haptic(hand: Side, strength: number, ms: number): void {
    const pad = this.controller(hand)?.inputSource.gamepad as
      | { hapticActuators?: { pulse?: (v: number, ms: number) => void }[] }
      | undefined;
    pad?.hapticActuators?.[0]?.pulse?.(strength, ms);
  }
}

// `tune` больше не используется: настройки живут в src/config/loadout.ts
export type { TuneInput };
