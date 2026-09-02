import type { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Vector3, Matrix, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Node } from "@babylonjs/core/node";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";

import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { WebXRDefaultExperience } from "@babylonjs/core/XR/webXRDefaultExperience";
import type { WebXRInputSource } from "@babylonjs/core/XR/webXRInputSource";
import { Space } from "@babylonjs/core/Maths/math.axis";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/tubeBuilder";

import { BELT, BOW, COMBAT, HOLSTER, MELEE, SHIELD, THROW } from "#shared/constants";
import { noGuard, type BlockedBy, type GuardState } from "#shared/combat";
import {
  DUAL_WIELD,
  WEAPON_TAKE_REACH,
  type WeaponClass,
  type WeaponTier,
} from "#shared/items";
import type { CarriedWeapon, HeldWeapons, StowedWeapon, CastMsg } from "#shared/net/messages";
import { MAGIC } from "#shared/magic";
import { STAFF_CRYSTAL_LOCAL } from "../items/Staff";
import { LOADOUT, type ItemKind as LoadoutItemKind, type Placement } from "../config/loadout";
import { clamp, closestPointOnSegment, segmentDistance } from "#shared/geometry";
import type { TuneInput } from "../input/InputSource";
import type { PlayerController } from "../player/PlayerController";
import type { Progression } from "../player/Progression";
import type { Side } from "../player/Hands";
import type { Sfx } from "../audio/Sfx";
import { createSword } from "../items/Sword";
import { createStaff } from "../items/Staff";
import { createPotion, type PotionBottle } from "../items/Potion";
import { createShield } from "../items/Shield";
import { createBow, tintBow, type BowParts } from "../items/Bow";
import { createArrowProto, tintArrows, Arrow } from "./Arrow";
import type { Hittable } from "./Hittable";

const TIP = new Vector3(...COMBAT.swordTipLocal);
/** Локальная нормаль щита — «наружу» смотрит +Y. */
const SHIELD_NORMAL = new Vector3(0, 1, 0);
/** Толщина тетивы, м. */
const BOWSTRING_RADIUS = 0.003;

type Slot = { pos: [number, number, number]; rot: [number, number, number]; scale: number };
/**
 * Как предмет лежит за спиной. Локальные оси спины: -Z позади игрока, +X вправо.
 * Мутабельно — можно крутить из консоли: `game.stowConfig().sword.left.pos[1] = 0.2`.
 */
export const STOW: Record<"sword" | "bow" | "shield" | "staff", Record<"left" | "right", Slot>> = {
  sword: {
    left: { pos: [-0.2, 0.12, -0.13], rot: [0.4, 0, 0.55], scale: 1 },
    right: { pos: [0.2, 0.12, -0.13], rot: [0.4, 0, -0.55], scale: 1 },
  },
  staff: {
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

export type ItemKind = "sword" | "bow" | "shield" | "staff";

/** Оружие ближнего боя: меч и посох машутся и бьют одинаково (посох слабее). */
const MELEE_KINDS = new Set<ItemKind>(["sword", "staff"]);
function isMelee(k: ItemKind): boolean {
  return MELEE_KINDS.has(k);
}

/** Один предмет, который можно взять, бросить и метнуть. */
interface Item {
  kind: ItemKind;
  /** Уровень предмета: base / bronze / gold. Положение в руке общее на класс. */
  tier: WeaponTier;
  mesh: Mesh;
  /** Рука, которая держит предмет, либо null. */
  hand: Side | null;
  /** Где лежит, когда его не держат. */
  rest: { pos: Vector3; yaw: number; bob: boolean };
  /** Полётное состояние — не null, пока предмет летит. */
  flight: Flight | null;
  /** Рука, за спину которой предмет убран, либо null. */
  stow: Side | null;
  /** Из какой руки метнули — по ней сервер берёт уровень оружия. */
  thrownFrom?: Side;
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
  private readonly items: Item[];
  private readonly bowParts: BowParts;
  private readonly bowString: Mesh;
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

  /** Замах считается для каждой руки отдельно — мечей может быть два. */
  private readonly swing: Record<Side, { t: number; hitDone: boolean }> = {
    left: { t: 0, hitDone: false },
    right: { t: 0, hitDone: false },
  };
  private swooshCd = 0;
  private readonly tipTrail: Record<Side, { p: Vector3; dir: Vector3; age: number }[]> = {
    left: [],
    right: [],
  };

  private draw = 0; // 0..1
  private vrNocked = false;
  private prevVrTrigger = false;

  // --- магия посоха (этап 14) ---
  /** Текущая мана игрока — Game обновляет из схемы каждый кадр. */
  mana = 30;
  /** Игра шлёт серверу каст, когда посох выстрелил. */
  onCast: ((msg: CastMsg) => void) | null = null;
  private charge = 0; // 0..1 накопленный заряд
  private castHooked = false; // вторая рука зацепилась за кристалл
  /** true — сейчас копится заряд: Game не перетирает предсказанную ману патчем. */
  get chargingMagic(): boolean {
    return this.castHooked;
  }
  /** true — в руках есть посох (для полоски маны). */
  get holdsStaff(): boolean {
    return !!this.held1("staff");
  }
  private prevCastTrigger = false;
  private chargeOrb: Mesh | null = null;

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
  /** Пояс: узел на бедре, к нему привязана бутылочка зелья. */
  private beltAnchor!: TransformNode;
  private potion!: PotionBottle;
  /** В какой руке сейчас бутылочка (null — висит на поясе). */
  private potionHand: Side | null = null;
  private potionCount = 0;
  private drinkCd = 0;
  /** Сколько зелий в сумке. Задаёт Game из инвентаря. */
  setPotionCount(n: number): void {
    this.potionCount = n;
    this.potion.setCount(n);
    if (n <= 0) this.potionHand = null;
    this.potion.setEnabled(n > 0 && this.player.inVR);
  }
  /** Игрок поднёс бутылочку ко рту. Game шлёт заявку серверу. */
  onDrinkPotion: (() => void) | null = null;
  /**
   * Заработанное оружие легло на землю. Онлайн Game отдаёт его серверу — там
   * оно становится предметом мира: видно всем и переживает перезапуск.
   * null (офлайн) — предмет просто остаётся лежать у этого игрока.
   */
  onWeaponLanded: ((cls: WeaponClass, tier: WeaponTier, x: number, z: number) => void) | null =
    null;
  /**
   * Звуковое событие для соседей по сети: взмах / выстрел / попадание стрелы.
   * `at` — мировая точка звука. null офлайн.
   */
  onSoundEvent:
    | ((kind: "swing" | "bow" | "arrowHit", x: number, y: number, z: number) => void)
    | null = null;
  /** Где лежит базовое оружие (камни у спавна) — туда возвращается лук. */
  private readonly homes: Record<ItemKind, Vector3>;

  /** Сообщить соседям про звук (взмах/выстрел/стрела). */
  private emitSound(kind: "swing" | "bow" | "arrowHit", p: Vector3): void {
    this.onSoundEvent?.(kind, p.x, p.y, p.z);
  }
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
    staffHome: Vector3,
  ) {
    this.homes = {
      sword: swordHome.clone(),
      bow: bowHome.clone(),
      shield: shieldHome.clone(),
      staff: staffHome.clone(),
    };
    const sword = createSword(scene);
    const shield = createShield(scene);
    const staff = createStaff(scene);
    this.bowParts = createBow(scene);
    const bow = this.bowParts.mesh;

    this.items = [
      this.makeItem("sword", "base", sword, swordHome),
      this.makeItem("bow", "base", bow, bowHome),
      this.makeItem("shield", "base", shield, shieldHome),
      this.makeItem("staff", "base", staff, staffHome),
    ];
    this.backAnchor = new TransformNode("backAnchor", scene);
    this.beltAnchor = new TransformNode("beltAnchor", scene);
    this.potion = createPotion(scene);
    this.potion.root.parent = this.beltAnchor;
    this.potion.root.position.set(...(LOADOUT.belt.pos as [number, number, number]));
    this.potion.setEnabled(false);

    const stringPts = [this.bowParts.topTip, this.bowParts.nockRest, this.bowParts.bottomTip];
    // Тетива — тонкая трубка, а не линия: толщину линии WebGL задать нельзя,
    // она всегда в один пиксель и на расстоянии просто пропадает.
    this.bowString = MeshBuilder.CreateTube(
      "bowString",
      { path: stringPts, radius: BOWSTRING_RADIUS, tessellation: 4, updatable: true },
      scene,
    );
    const stringMat = new StandardMaterial("bowStringMat", scene);
    stringMat.diffuseColor = new Color3(0.85, 0.85, 0.8);
    stringMat.emissiveColor = new Color3(0.25, 0.25, 0.23);
    stringMat.specularColor = new Color3(0, 0, 0);
    this.bowString.material = stringMat;
    this.bowString.parent = bow;
    this.bowString.isPickable = false;

    this.arrowProto = createArrowProto(scene);
    this.nockArrow = this.arrowProto.clone("nockArrow");
    this.nockArrow.parent = bow;
    this.nockArrow.setEnabled(false);
    this.nockLocal.copyFrom(this.bowParts.nockRest);

    // Камни под оружием теперь ставит world/nature.ts (модели из пака).

    this.arrowCtx = {
      scene,
      targets: this.targets,
      isSolid: (m: AbstractMesh) => m.isPickable && m.checkCollisions,
      onHit: (kind, pos) => {
        this.sfx.at(pos, () => {
          this.sfx.arrowHit(kind);
          if (kind === "flesh") this.sfx.hitThud(0.5);
        });
        this.emitSound("arrowHit", pos);
      },
    };
  }

  private makeItem(kind: ItemKind, tier: WeaponTier, mesh: Mesh, home: Vector3): Item {
    mesh.position.copyFrom(home);
    return {
      kind,
      tier,
      mesh,
      hand: null,
      rest: { pos: home.clone(), yaw: 0, bob: true },
      flight: null,
      stow: null,
    };
  }

  // ---- что где ----

  /** Первый предмет класса в руках (или в конкретной руке). */
  private held1(kind: ItemKind, hand?: Side): Item | null {
    return (
      this.items.find((i) => i.kind === kind && i.hand && (!hand || i.hand === hand)) ?? null
    );
  }

  /** Единственный лук: его нельзя взять в две руки, поэтому он всегда один. */
  private get bowItem(): Item {
    return this.items.find((i) => i.kind === "bow") as Item;
  }
  private get bow(): Mesh {
    return this.bowItem.mesh;
  }

  /** Что в этой руке. */
  private inHand(hand: Side): Item | null {
    return this.items.find((i) => i.hand === hand) ?? null;
  }

  /** Оружие (меч / посох / лук) в руках — для плоского режима, где рука одна. */
  private get weapon(): Item | null {
    return this.held1("sword") ?? this.held1("staff") ?? this.held1("bow");
  }
  private get held(): "" | "sword" | "bow" | "staff" {
    return (this.weapon?.kind as "sword" | "bow" | "staff") ?? "";
  }
  private get heldHand(): Side {
    return this.weapon?.hand ?? "right";
  }
  private get shieldHand(): Side | null {
    return this.held1("shield")?.hand ?? null;
  }

  get vrActive(): boolean {
    return this.player.inVR;
  }

  /** Текущее положение предмета в руке из файла настроек (читается каждый кадр). */
  private placement(kind: LoadoutItemKind, hand: Side): Placement {
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

  private stowedItem(side: Side): Item | null {
    return this.items.find((i) => i.stow === side) ?? null;
  }

  /** Мировая точка бутылочки — на поясе или в руке. */
  private potionPos(): Vector3 {
    return this.potion.root.getAbsolutePosition();
  }

  /** Свободная рука рядом с бутылочкой — можно взять. */
  private handAtPotion(side: Side): boolean {
    if (this.potionCount <= 0 || this.potionHand) return false;
    const c = this.controller(side);
    const node = c?.grip ?? c?.pointer;
    if (!node) return false;
    return Vector3.Distance(node.getAbsolutePosition(), this.potionPos()) < BELT.grabDist;
  }

  /**
   * Бутылочка в руке едет за кистью; поднёс ко рту — глоток.
   * Пустая сумка — бутылочки нет вовсе.
   */
  private updatePotion(dt: number): void {
    if (this.drinkCd > 0) this.drinkCd -= dt;

    const inVR = this.player.inVR;
    this.potion.setEnabled(this.potionCount > 0 && inVR);
    if (!inVR || this.potionCount <= 0) return;

    const hand = this.potionHand;
    if (!hand) {
      // Висит на поясе.
      if (this.potion.root.parent !== this.beltAnchor) {
        this.potion.root.parent = this.beltAnchor;
        this.potion.root.rotation.setAll(0);
      }
      const b = LOADOUT.belt.pos;
      this.potion.root.position.set(b[0], b[1], b[2]);
      return;
    }

    const c = this.controller(hand);
    const node = c?.grip ?? c?.pointer;
    if (!node) {
      this.potionHand = null;
      return;
    }
    if (this.potion.root.parent !== node) this.potion.root.parent = node;
    const pl = this.placement("potion", hand);
    this.potion.root.position.set(pl.pos[0], pl.pos[1], pl.pos[2]);
    this.potion.root.rotation.set(pl.rot[0], pl.rot[1], pl.rot[2]);
    this.potion.root.scaling.setAll(pl.scale);

    // Поднёс ко рту — пьём (глоток за раз).
    if (this.drinkCd <= 0) {
      const d = Vector3.Distance(this.potionPos(), this.player.eyePosition);
      if (d < BELT.drinkDist) {
        this.drinkCd = BELT.drinkCooldown;
        this.haptic(hand, 0.6, 90);
        this.onDrinkPotion?.();
      }
    }
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
    const item = this.stowedItem(side);
    if (!item) return;
    const kind = item.kind;
    item.stow = null;
    item.flight = null;
    item.hand = side;
    item.mesh.rotationQuaternion = null;
    this.resetHand(side);
    if (isMelee(kind)) {
      this.swing[side].t = 0;
      this.tipTrail[side].length = 0;
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

  /** Узел «спина»: центр под головой, повёрнут по рысканью взгляда. */
  private updateBackAnchor(): void {
    const head = this.player.eyePosition;
    const f = this.player.eyeForward;
    this.backAnchor.position.set(head.x, head.y - HOLSTER.backDrop, head.z);
    this.backAnchor.rotation.set(0, Math.atan2(f.x, f.z), 0);
    this.backAnchor.computeWorldMatrix(true);

    this.beltAnchor.position.set(head.x, head.y - BELT.drop, head.z);
    this.beltAnchor.rotation.copyFrom(this.backAnchor.rotation);
    this.beltAnchor.computeWorldMatrix(true);
  }

  private anchorStowedItems(): void {
    for (const item of this.items) {
      if (!item.stow) continue;
      const t = STOW[item.kind][item.stow];
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

    this.updatePotion(dt);

    // Q (плоский режим) — снять щит: летит так же, как оружие.
    if (inp.dropItem && this.shieldHand) {
      const sh = this.held1("shield");
      if (sh) this.throwItem(sh, this.flatThrowVelocity(0));
    }

    if (this.player.inVR) this.handleGripsVR();
    else this.handleInteractFlat(inp.interact, interactEdge, interactReleased, dt);

    this.updateRestPoses(dt);
    this.anchorHeldItems();
    this.updateBackAnchor();
    this.anchorStowedItems();
    this.shoveWithHeldItems();

    if (this.held === "sword" || this.held === "staff") {
      if (this.player.inVR) this.updateVRSwing(dt);
      else this.updateFlatSwing(dt, primaryEdge);
    } else if (this.held === "bow") {
      this.updateBow(dt, inp.primaryAction, primaryReleased);
    } else {
      // Свободные руки — рукопашная.
      if (this.player.inVR) this.updateVRMelee(dt);
      else this.updateFlatMelee(dt, primaryEdge);
    }

    // Магия посоха: держащая рука машет как мечом (выше), вторая — тянет
    // энергию от кристалла и кастует. Только VR.
    if (this.held === "staff" && this.player.inVR) this.updateStaffCast(dt);
    else if (this.charge !== 0 || this.castHooked) this.resetCast();

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

  private readonly guard: GuardState = noGuard();

  /**
   * Куда сейчас смотрят щит и клинок — уходит серверу в move-пакете,
   * блок решает он (этап 7). Векторы горизонтальные и единичные.
   */
  guardState(): GuardState {
    const g = this.guard;
    g.sx = g.sz = g.wx = g.wz = 0;

    const shieldItem = this.held1("shield");
    if (shieldItem) {
      const n = Vector3.TransformNormal(SHIELD_NORMAL, shieldItem.mesh.getWorldMatrix());
      const L = Math.hypot(n.x, n.z);
      if (L > 1e-4) {
        g.sx = n.x / L;
        g.sz = n.z / L;
      }
    }

    const swordItem = this.held1("sword") ?? this.held1("staff");
    if (swordItem) {
      const m = swordItem.mesh.getWorldMatrix();
      const hilt = Vector3.TransformCoordinates(Vector3.ZeroReadOnly, m);
      const tip = Vector3.TransformCoordinates(TIP, m);
      const eye = this.player.eyePosition;
      const dx = (hilt.x + tip.x) * 0.5 - eye.x;
      const dz = (hilt.z + tip.z) * 0.5 - eye.z;
      const L = Math.hypot(dx, dz);
      if (L > 1e-2) {
        g.wx = dx / L;
        g.wz = dz / L;
      }
    }
    return g;
  }

  /** Сервер сообщил, что удар отбит: звон + отдача в блокирующую руку. */
  playBlock(by: BlockedBy): void {
    if (by === 1 && this.shieldHand) this.onBlocked(this.shieldHand, 1);
    else if (by === 2 && this.heldHand) this.onBlocked(this.heldHand, 0.8);
    else if (by !== 0 && this.blockCd <= 0) {
      // Блокирующий предмет держит плоский режим (руки нет) — только звук.
      this.sfx.block(1);
      this.blockCd = 0.15;
    }
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

      // Бутылочка с пояса: берётся свободной рукой, отпускается обратно на пояс.
      if (this.potionHand === side) {
        if (!down && was) this.potionHand = null;
        continue;
      }
      if (down && !was && this.handAtPotion(side) && !this.inHand(side)) {
        this.potionHand = side;
        this.haptic(side, 0.35, 45);
        continue;
      }

      const atShoulder = this.handAtShoulder(side);
      const item = this.inHand(side);
      if (item) {
        if (!down && was) {
          // Отпустил за плечом и слот свободен -> убрать за спину; иначе метнуть.
          if (atShoulder && !this.stowedItem(side)) this.stowItem(item, side);
          else this.throwItem(item, this.vrThrowVelocity(side));
        }
        continue;
      }
      if (down && !was) {
        // Нажал за плечом и там что-то лежит -> достать; иначе поднять с земли.
        if (atShoulder && this.stowedItem(side)) this.drawItem(side);
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
      const before = this.weapon || this.shieldHand;
      this.tryPickup("right");
      if (!before && (this.weapon || this.shieldHand)) this.justPickedUp = true;
    }
  }

  /**
   * Можно ли взять этот предмет свободной рукой.
   *
   * Мечи и щиты — по одному в каждую руку; лук требует обеих, поэтому
   * второй лук взять нельзя и со щитом он не сочетается.
   */
  private canPick(item: Item): boolean {
    if (item.hand || item.stow) return false; // уже держим / за спиной
    if (this.held1("bow")) return false; // лук в руках занимает обе
    if (item.kind === "bow") {
      return !this.weapon && !this.shieldHand; // лук берут только пустыми руками
    }
    if (!DUAL_WIELD[item.kind] && this.held1(item.kind)) return false;
    return true;
  }

  /** Где лежит ближайшее оружие из мира (лут). Задаёт Game, когда онлайн. */
  nearestWorldWeapon:
    | ((pos: Vector3) => { id: string; cls: ItemKind; tier: WeaponTier; pos: Vector3 } | null)
    | null = null;
  /** Заявка серверу: беру это оружие. */
  onTakeWorldWeapon: ((id: string) => void) | null = null;
  /** Строит меш под класс и уровень (Game передаёт свои фабрики). */
  makeWeaponMesh: ((cls: ItemKind, tier: WeaponTier) => Mesh) | null = null;

  /** Рука, нанёсшая последний удар. Game берёт её для сообщения серверу. */
  lastHitHand: Side = "right";

  /** Что сейчас в руках — Game отсылает это серверу для расчёта урона. */
  handsSnapshot(): Record<Side, { cls: ItemKind; tier: WeaponTier } | null> {
    const of = (h: Side) => {
      const i = this.inHand(h);
      return i ? { cls: i.kind, tier: i.tier } : null;
    };
    return { left: of("left"), right: of("right") };
  }

  /** Что убрано за спину — Game отсылает серверу, тот хранит до следующего входа. */
  stowedSnapshot(): StowedWeapon[] {
    const out: StowedWeapon[] = [];
    for (const side of ["left", "right"] as Side[]) {
      const it = this.stowedItem(side);
      if (it) out.push({ cls: it.kind, tier: it.tier, side });
    }
    return out;
  }

  /**
   * Свободный предмет нужного класса и уровня — для восстановления снаряжения
   * после входа. Лук в игре один (к нему привязаны тетива и стрела), поэтому
   * он не создаётся заново, а перекрашивается.
   */
  private weaponForRestore(cls: WeaponClass, tier: WeaponTier): Item | null {
    const kind = cls as ItemKind;
    if (kind === "bow") {
      const bow = this.bowItem;
      if (bow.hand || bow.stow) return null; // лук уже занят
      bow.tier = tier;
      tintBow(bow.mesh, tier);
      tintArrows(tier); // золотому луку — золотые стрелы
      bow.flight = null;
      bow.mesh.rotationQuaternion = null;
      return bow;
    }
    // Меч/щит: базовый предмет переиспользуем, если он свободен; иначе — новый.
    const base = this.items.find((i) => i.kind === kind && i.tier === "base");
    if (tier === "base" && base && !base.hand && !base.stow) {
      base.flight = null;
      base.mesh.rotationQuaternion = null;
      return base;
    }
    const mesh = this.makeWeaponMesh?.(kind, tier);
    if (!mesh) return null;
    const item = this.makeItem(kind, tier, mesh, this.player.position.clone());
    this.items.push(item);
    return item;
  }

  /** Вернуть за спину оружие, которое там было при прошлом выходе. */
  restoreStowed(list: StowedWeapon[]): void {
    for (const s of list) {
      if (s.side !== "left" && s.side !== "right") continue;
      if (this.stowedItem(s.side)) continue; // плечо уже занято
      const item = this.weaponForRestore(s.cls, s.tier);
      if (!item) continue;
      item.hand = null;
      item.stow = s.side;
    }
  }

  /**
   * Вернуть в руки оружие, которое там было при прошлом выходе.
   * Если рукой взять нельзя (например, лук занимает обе), кладём за спину —
   * лучше так, чем потерять добытое.
   */
  restoreHeld(held: HeldWeapons): void {
    for (const side of ["right", "left"] as Side[]) {
      const w: CarriedWeapon | null = held[side];
      if (!w || this.inHand(side)) continue;
      const item = this.weaponForRestore(w.cls, w.tier);
      if (!item) continue;
      if (this.canPick(item)) {
        this.equip(item, side);
      } else if (!this.stowedItem(side)) {
        item.hand = null;
        item.stow = side;
      }
    }
  }

  private tryPickup(side: Side): void {
    const p = this.player.position;
    if (this.inHand(side)) return; // рука занята

    // Оружие, лежащее в мире (лут), берётся вперёд обычных предметов.
    const ws = this.nearestWorldWeapon?.(p);
    if (ws && Vector3.Distance(p, ws.pos) < WEAPON_TAKE_REACH) {
      // Лук в игре один: тетива и стрела привязаны к его мешу, поэтому
      // золотой не создаёт второй лук, а поднимает уровень этого.
      if (ws.cls === "bow") {
        const bow = this.bowItem;
        if (this.canPick(bow)) {
          bow.tier = ws.tier;
          tintBow(bow.mesh, ws.tier);
          tintArrows(ws.tier); // золотому луку — золотые стрелы
          this.onTakeWorldWeapon?.(ws.id);
          this.equip(bow, side);
          return;
        }
      } else {
        const fresh = this.makeWeaponMesh?.(ws.cls, ws.tier);
        if (fresh) {
          const item = this.makeItem(ws.cls, ws.tier, fresh, ws.pos.clone());
          if (this.canPick(item)) {
            this.items.push(item);
            this.onTakeWorldWeapon?.(ws.id);
            this.equip(item, side);
            return;
          }
          fresh.dispose();
        }
      }
    }

    const near = this.items
      .map((it) => ({ it, d: Vector3.Distance(p, it.mesh.getAbsolutePosition()) }))
      .sort((a, b) => a.d - b.d)
      .find((c) => c.d < COMBAT.equipReach && this.canPick(c.it));
    if (!near) return;
    this.equip(near.it, side);
  }

  /** Положить предмет в руку и сбросить связанное с ним состояние. */
  private equip(item: Item, side: Side): void {
    item.flight = null; // можно поймать на лету
    item.hand = side;
    item.stow = null;
    item.mesh.rotationQuaternion = null;

    this.windup = 0;
    this.motion[side].init = false;
    this.motion[side].vel.setAll(0);
    this.motion[side].angVel.setAll(0);

    if (isMelee(item.kind)) {
      this.swing[side].t = 0;
      this.tipTrail[side].length = 0;
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
    item.thrownFrom = hand ?? undefined;
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
    this.sfx.swordSwing(worldPos);
    this.emitSound("swing", worldPos);

    if (item.kind === "bow") {
      this.nockArrow.setEnabled(false);
      this.draw = 0;
      this.vrNocked = false;
      this.nockLocal.copyFrom(this.bowParts.nockRest);
    }
  }

  private updateFlights(dt: number): void {
    for (const item of this.items) {
      const f = item.flight;
      if (f) this.lastHitHand = item.thrownFrom ?? "right";
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
            t.hit(dir, "throw", mesh.position.clone());
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
        this.handOverToWorld(item);
      }
    }
  }

  /**
   * Отдать упавшее заработанное оружие миру (серверу). Базовое остаётся своим:
   * оно и так всегда доступно у камней.
   */
  private handOverToWorld(item: Item): void {
    if (item.tier === "base" || !this.onWeaponLanded) return;
    const p = item.mesh.position;
    this.onWeaponLanded(item.kind as WeaponClass, item.tier, p.x, p.z);

    if (item.kind === "bow") {
      // Лук в игре один — не удаляем, а возвращаем к базовому виду и на камень.
      item.tier = "base";
      tintBow(item.mesh, "base");
      tintArrows("base");
      item.rest.pos.copyFrom(this.homes.bow);
      item.rest.bob = true;
      item.mesh.rotationQuaternion = null;
      return;
    }
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
    item.mesh.dispose();
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
    for (const item of this.items) {
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
    for (const item of this.items) {
      if (!item.hand) continue;
      const t = this.placement(item.kind, item.hand);
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
    for (const item of this.items) {
      if (!item.hand) continue;
      const kind = item.kind;
      const m = item.mesh.getWorldMatrix();
      const origin = Vector3.TransformCoordinates(Vector3.ZeroReadOnly, m);
      let a = origin;
      let b = origin;
      let rad = 0.22;
      if (isMelee(kind)) {
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
    const item = this.held1("sword") ?? this.held1("staff");
    if (!item?.hand) return;
    const side = item.hand;
    const sw = this.swing[side];

    if (primaryEdge && sw.t <= 0) {
      sw.t = COMBAT.swingDuration;
      sw.hitDone = false;
      this.sfx.swordSwing(item.mesh.getAbsolutePosition());
    }
    if (sw.t > 0) {
      sw.t -= dt;
      const phase = 1 - Math.max(0, sw.t) / COMBAT.swingDuration;
      const arc = Math.sin(phase * Math.PI);
      const base = LOADOUT.items[item.kind].flat.rot;
      // Клинок идёт вниз-ВПЕРЁД (локальный +Y заваливается к +Z, от игрока).
      item.mesh.rotation.x = base[0] + arc * 1.5;
      item.mesh.rotation.z = base[2] - arc * 0.45;
      if (phase > 0.3 && !sw.hitDone) {
        sw.hitDone = true;
        this.tryHit(item);
      }
    }
  }

  /** Каждый меч в руке машет сам по себе — след кончика свой у каждой руки. */
  private updateVRSwing(dt: number): void {
    if (this.swooshCd > 0) this.swooshCd -= dt;
    for (const item of this.items) {
      if (item.hand && isMelee(item.kind)) this.swingOne(dt, item, item.hand);
    }
    // След руки, в которой меча/посоха уже нет, чистим — иначе «выстрелит» при взятии.
    for (const side of ["left", "right"] as Side[]) {
      const m = this.inHand(side);
      if (!m || !isMelee(m.kind)) this.tipTrail[side].length = 0;
    }
  }

  private swingOne(dt: number, item: Item, side: Side): void {
    const trail = this.tipTrail[side];
    const m = item.mesh.getWorldMatrix();
    // Кончик и гарда — в осях головы: ходьба/поворот не выглядят как замах.
    const guard = this.headLocal(Vector3.TransformCoordinates(Vector3.ZeroReadOnly, m));
    const tipWorld = Vector3.TransformCoordinates(TIP, m);
    const tip = this.headLocal(tipWorld);
    const dir = tip.subtract(guard).normalize();

    const prev = trail[trail.length - 1]?.p;
    if (prev && this.turnCd <= 0) {
      if (Vector3.Distance(tip, prev) / Math.max(dt, 1e-4) > COMBAT.vrSwingSpeed) {
        this.tryHit(item);
      }
    }

    for (const s of trail) s.age += dt;
    trail.push({ p: tip.clone(), dir, age: 0 });
    while (trail.length > 2 && trail[0].age > COMBAT.swooshWindow) trail.shift();

    const oldest = trail[0];
    if (oldest.age > 0.06 && this.swooshCd <= 0 && this.turnCd <= 0) {
      const avgSpeed = Vector3.Distance(tip, oldest.p) / oldest.age;
      const sweep = Math.acos(clamp(Vector3.Dot(dir, oldest.dir), -1, 1));
      if (avgSpeed > COMBAT.vrSwooshSpeed && sweep > COMBAT.vrSwooshSweep) {
        this.sfx.swordSwing(tipWorld); // мировая точка, не в осях головы
        this.emitSound("swing", tipWorld);
        this.swooshCd = COMBAT.swooshCooldown;
      }
    }
  }

  private tryHit(item: Item): void {
    this.lastHitHand = item.hand ?? "right";
    const m = item.mesh.getWorldMatrix();
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
        if (t.hit(dir, "sword", contact)) {
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
              this.lastHitHand = side;
              if (t.hit(dir, "fist", nowW.clone())) {
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
    const eye = this.player.camera.globalPosition;
    this.sfx.swordSwing(eye);
    this.emitSound("swing", eye);
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
        this.lastHitHand = "right";
        if (t.hit(dir, "fist", closestPointOnSegment(mid, eye, reach))) landed = true;
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

  // ---- магия посоха ----

  private readonly castCrystalW = new Vector3();
  private readonly castOriginW = new Vector3();

  private resetCast(): void {
    this.charge = 0;
    this.castHooked = false;
    this.chargeOrb?.setEnabled(false);
    this.prevCastTrigger = false;
  }

  /**
   * Каст огненного снаряда: держащей рукой посох (машет как мечом), второй
   * рукой у кристалла жмёшь триггер и «тянешь». Дальше от кристалла — быстрее
   * полетит; дольше держишь — больше заряд. Мана убывает, пока копишь;
   * кончилась — заряд замирает. Мало маны на минимум — каст не начинается.
   */
  private updateStaffCast(dt: number): void {
    const staff = this.held1("staff");
    if (!staff?.hand) return this.resetCast();
    const holdHand = staff.hand;
    const castHand: Side = holdHand === "left" ? "right" : "left";
    if (this.inHand(castHand)) return this.resetCast(); // вторая рука занята

    const cc = this.controller(castHand);
    const castNode = cc?.grip ?? cc?.pointer;
    const trigger = !!cc?.inputSource.gamepad?.buttons[0]?.pressed;
    if (!castNode) return this.resetCast();

    const m = staff.mesh.getWorldMatrix();
    Vector3.TransformCoordinatesToRef(new Vector3(...STAFF_CRYSTAL_LOCAL), m, this.castCrystalW);
    Vector3.TransformCoordinatesToRef(Vector3.ZeroReadOnly, m, this.castOriginW);
    const castPos = castNode.getAbsolutePosition();
    const dist = Vector3.Distance(castPos, this.castCrystalW);

    const fb = MAGIC.firebolt;

    if (trigger) {
      if (!this.castHooked && !this.prevCastTrigger && dist < 0.28 && this.mana >= fb.minMana) {
        this.castHooked = true;
        this.haptic(castHand, 0.4, 45);
        this.sfx.bowDraw();
      }
      if (this.castHooked) {
        // Накопление заряда, пока есть мана; мана расходуется на лету.
        if (this.mana > 0 && this.charge < 1) {
          // Заряд идёт рывком в начале и замедляется к максимуму: держать
          // до отсечки долго и невыгодно (маны много, прибавки мало).
          const rate = (1 / fb.chargeTime) * (2.2 - 1.9 * this.charge);
          this.charge = clamp(this.charge + rate * dt, 0, 1);
          this.mana = Math.max(0, this.mana - fb.manaPerSec * dt);
        }
        this.showChargeOrb(staff.mesh);
      }
    } else if (this.castHooked) {
      const charge = this.charge;
      // «Натяг» = насколько отвёл руку от кристалла (0.15..0.75 м → 0..1).
      const pull = clamp((dist - 0.15) / 0.6, 0, 1);
      this.resetCast();
      if (charge >= fb.minCharge) {
        const dir = this.castCrystalW.subtract(this.castOriginW).normalize();
        const origin = this.castCrystalW.add(dir.scale(0.05));
        this.onCast?.({
          charge,
          pull,
          ox: origin.x,
          oy: origin.y,
          oz: origin.z,
          dx: dir.x,
          dy: dir.y,
          dz: dir.z,
          hand: holdHand,
        });
        this.haptic(holdHand, 0.7, 60);
        this.haptic(castHand, 0.7, 60);
        this.sfx.at(origin, () => this.sfx.bowRelease(Math.min(1, 0.4 + charge)));
        this.emitSound("bow", origin);
      }
    }
    this.prevCastTrigger = trigger;
  }

  private showChargeOrb(staffMesh: Mesh): void {
    if (!this.chargeOrb) {
      const mat = new StandardMaterial("chargeOrbMat", staffMesh.getScene());
      mat.emissiveColor = new Color3(1, 0.55, 0.15);
      mat.diffuseColor = new Color3(0.05, 0.02, 0);
      mat.specularColor = new Color3(0, 0, 0);
      mat.disableLighting = true;
      this.chargeOrb = MeshBuilder.CreateSphere(
        "chargeOrb",
        { diameter: 1, segments: 8 },
        staffMesh.getScene(),
      );
      this.chargeOrb.material = mat;
      this.chargeOrb.isPickable = false;
    }
    this.chargeOrb.parent = staffMesh;
    this.chargeOrb.position.set(...STAFF_CRYSTAL_LOCAL);
    const r = 0.04 + this.charge * 0.22;
    const flick = 0.9 + 0.1 * Math.sin(performance.now() * 0.04);
    this.chargeOrb.scaling.setAll(r * flick);
    this.chargeOrb.setEnabled(true);
  }

  private readonly nockLocal = new Vector3();
  private placeNockArrow(nock: Vector3, dir: Vector3): void {
    this.nockLocal.copyFrom(nock);
    const d = dir.length() > 1e-4 ? dir.normalize() : new Vector3(0, 0, -1);
    this.nockArrow.rotation.set(-Math.asin(clamp(d.y, -1, 1)), Math.atan2(d.x, d.z), 0);
    this.nockArrow.position.copyFrom(nock).addInPlace(d.scale(0.34));
  }

  private updateString(): void {
    MeshBuilder.CreateTube("bowString", {
      path: [this.bowParts.topTip, this.nockLocal, this.bowParts.bottomTip],
      radius: BOWSTRING_RADIUS,
      instance: this.bowString,
    });
  }

  private fire(origin: Vector3, dir: Vector3, power: number): void {
    this.lastHitHand = this.bowItem.hand ?? "right"; // стрела «принадлежит» руке с луком
    this.sfx.bowRelease(power);
    this.emitSound("bow", origin);
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
