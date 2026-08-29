import type { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Vector3, Matrix } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Node } from "@babylonjs/core/node";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { WebXRDefaultExperience } from "@babylonjs/core/XR/webXRDefaultExperience";
import type { WebXRInputSource } from "@babylonjs/core/XR/webXRInputSource";
import { Ray } from "@babylonjs/core/Culling/ray";
import "@babylonjs/core/Culling/ray";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/linesBuilder";

import { BOW, COMBAT } from "../shared/constants";
import { clamp, segmentDistance } from "../shared/geometry";
import type { TuneInput } from "../input/InputSource";
import type { PlayerController } from "../player/PlayerController";
import type { Sfx } from "../audio/Sfx";
import { createSword } from "../items/Sword";
import { createBow, type BowParts } from "../items/Bow";
import { createArrowProto, Arrow } from "./Arrow";
import type { Hittable } from "./Hittable";

const TIP = new Vector3(...COMBAT.swordTipLocal);
const TUNE_KEY = "swordTune";
const VR_TUNE_ROT = 1.6;
const VR_TUNE_POS = 0.4;

export interface EquipTune {
  pos: Vector3;
  rot: Vector3;
  scale: number;
}

/** Ключи наборов для панели тюнинга. В VR — отдельно для левой и правой руки. */
export type TuneSlot =
  | "swordFlat"
  | "swordVRLeft"
  | "swordVRRight"
  | "bowFlat"
  | "bowVRLeft"
  | "bowVRRight";

type Held = "" | "sword" | "bow";

function tune(x: number, y: number, z: number, rx: number, ry: number, rz: number, sc: number): EquipTune {
  return { pos: new Vector3(x, y, z), rot: new Vector3(rx, ry, rz), scale: sc };
}

interface RestSpot {
  pos: Vector3;
  yaw: number;
  bob: boolean; // true — парит над камнем, false — лежит на земле
}

export class CombatSystem {
  private readonly sword: Mesh;
  private readonly bow: Mesh;
  private readonly bowParts: BowParts;
  private readonly swordRest: RestSpot;
  private readonly bowRest: RestSpot;
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
  };

  private held: Held = "";
  private heldHand: "left" | "right" = "right";
  private prevInteract = false;
  private prevPrimary = false;

  private swingT = 0;
  private swingHitDone = false;
  private swooshCd = 0;
  /** След клинка за окно: положение кончика, направление клинка, возраст. */
  private tipTrail: { p: Vector3; dir: Vector3; age: number }[] = [];

  private draw = 0; // 0..1
  private vrNocked = false;
  private prevVrTrigger = false;

  private bob = 0;
  private tuning = false;

  constructor(
    private readonly scene: Scene,
    private readonly player: PlayerController,
    private readonly getXR: () => WebXRDefaultExperience | null,
    private readonly targets: Hittable[],
    private readonly sfx: Sfx,
    swordHome: Vector3,
    bowHome: Vector3,
  ) {
    this.swordRest = { pos: swordHome.clone(), yaw: 0, bob: true };
    this.bowRest = { pos: bowHome.clone(), yaw: 0, bob: true };

    this.sword = createSword(scene);
    this.sword.position.copyFrom(swordHome);

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

  // ---- тюнинг положения оружия в руке (localStorage) ----

  loadTuning(): void {
    try {
      const j = JSON.parse(localStorage.getItem(TUNE_KEY) ?? "null");
      if (!j) return;
      // Совместимость: старые ключи { flat, vr } / { swordVR, bowVR } без руки.
      this.applyTune(this.tunes.swordFlat, j.flat ?? j.swordFlat);
      this.applyTune(this.tunes.bowFlat, j.bowFlat);
      const swVR = j.vr ?? j.swordVR;
      const bwVR = j.bowVR;
      this.applyTune(this.tunes.swordVRRight, j.swordVRRight ?? swVR);
      this.applyTune(this.tunes.swordVRLeft, j.swordVRLeft ?? swVR);
      this.applyTune(this.tunes.bowVRRight, j.bowVRRight ?? bwVR);
      this.applyTune(this.tunes.bowVRLeft, j.bowVRLeft ?? bwVR);
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
    const primaryEdge = inp.primaryAction && !this.prevPrimary;
    const primaryReleased = !inp.primaryAction && this.prevPrimary;
    this.prevInteract = inp.interact;
    this.prevPrimary = inp.primaryAction;

    if (interactEdge && !inp.tune) this.toggleEquip();

    this.bobIdle(dt);

    if (this.held === "sword") {
      this.keepAnchored(this.sword, this.tunes[this.slot()]);
      if (this.player.inVR) {
        if (!this.updateVRTune(inp.tune, dt)) this.updateVRSwing(dt);
      } else {
        this.updateFlatSwing(dt, primaryEdge);
      }
    } else if (this.held === "bow") {
      this.keepAnchored(this.bow, this.tunes[this.slot()]);
      if (this.player.inVR) this.updateVRTune(inp.tune, dt);
      this.updateBow(dt, inp.primaryAction, primaryReleased);
    }

    this.updateString();

    for (let i = this.arrows.length - 1; i >= 0; i--) {
      if (!this.arrows[i].update(dt, this.arrowCtx)) {
        this.arrows[i].dispose();
        this.arrows.splice(i, 1);
      }
    }
  }

  private toggleEquip(): void {
    if (this.held) {
      this.dropOnGround(this.held);
      this.held = "";
      return;
    }
    // В VR берём оружие той рукой, чей grip нажали.
    if (this.player.inVR) {
      const lg = this.gripDown("left");
      const rg = this.gripDown("right");
      if (lg && !rg) this.heldHand = "left";
      else if (rg && !lg) this.heldHand = "right";
      // обе / ни одной — оставляем прежнюю руку
    }
    const p = this.player.position;
    const dSword = Vector3.Distance(p, this.sword.getAbsolutePosition());
    const dBow = Vector3.Distance(p, this.bow.getAbsolutePosition());
    if (dSword < BOW.equipReach && dSword <= dBow) {
      this.held = "sword";
      this.swingT = 0;
      this.tipTrail.length = 0;
    } else if (dBow < BOW.equipReach) {
      this.held = "bow";
      this.draw = 0;
      this.vrNocked = false;
    }
  }

  private gripDown(hand: "left" | "right"): boolean {
    return !!this.controller(hand)?.inputSource.gamepad?.buttons[1]?.pressed;
  }

  /** Рука, которой натягивают тетиву (противоположная той, что держит лук). */
  private drawHand(): "left" | "right" {
    return this.heldHand === "left" ? "right" : "left";
  }

  /** Бросить оружие — падает на землю перед игроком и лежит там. */
  private dropOnGround(what: Held): void {
    const mesh = what === "sword" ? this.sword : this.bow;
    const rest = what === "sword" ? this.swordRest : this.bowRest;

    const fwd = this.player.camera.getDirection(new Vector3(0, 0, 1));
    fwd.y = 0;
    if (fwd.lengthSquared() < 1e-4) fwd.set(0, 0, 1);
    fwd.normalize();
    const drop = this.player.position.add(fwd.scale(0.9));
    const hit = this.scene.pickWithRay(
      new Ray(new Vector3(drop.x, drop.y + 3, drop.z), Vector3.Down(), 40),
      (m: AbstractMesh) => m.isPickable && m.checkCollisions && m !== mesh,
    );
    const groundY = hit?.pickedPoint?.y ?? this.player.position.y - 1.7;

    rest.pos.set(drop.x, groundY + 0.12, drop.z);
    rest.yaw = Math.atan2(fwd.x, fwd.z) + Math.random() * 0.6 - 0.3;
    rest.bob = false;

    mesh.parent = null;
    mesh.scaling.setAll(1);
    this.layFlat(mesh, rest);

    if (what === "bow") {
      this.nockArrow.setEnabled(false);
      this.draw = 0;
      this.vrNocked = false;
      this.nockLocal.copyFrom(this.bowParts.nockRest);
    }
  }

  private layFlat(mesh: Mesh, rest: RestSpot): void {
    mesh.position.copyFrom(rest.pos);
    mesh.rotation.set(Math.PI / 2, rest.yaw, 0); // клинок / плечи лука горизонтально
  }

  private bobIdle(dt: number): void {
    this.bob += dt;
    if (this.held !== "sword") this.restVisual(this.sword, this.swordRest, 0);
    if (this.held !== "bow") this.restVisual(this.bow, this.bowRest, 1);
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

  /** Какой набор тюнинга сейчас активен (в VR — с учётом руки). */
  slot(): TuneSlot {
    const kind = this.held === "bow" ? "bow" : "sword";
    if (!this.player.inVR) return `${kind}Flat` as TuneSlot;
    return `${kind}VR${this.heldHand === "left" ? "Left" : "Right"}` as TuneSlot;
  }

  private keepAnchored(mesh: Mesh, t: { pos: Vector3; rot: Vector3; scale: number }): void {
    const anchor = this.handAnchor();
    if (mesh.parent !== anchor) mesh.parent = anchor;
    mesh.position.copyFrom(t.pos);
    mesh.rotation.copyFrom(t.rot);
    mesh.scaling.setAll(t.scale);
  }

  private handAnchor(): Node {
    if (this.player.inVR) {
      const c = this.controller(this.heldHand);
      const node = c?.grip ?? c?.pointer;
      if (node) return node;
    }
    return this.player.camera;
  }

  private controller(hand: "left" | "right"): WebXRInputSource | undefined {
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

    // Мгновенная скорость — только для засчитывания удара по кукле.
    const prev = this.tipTrail[this.tipTrail.length - 1]?.p;
    if (prev && Vector3.Distance(tip, prev) / Math.max(dt, 1e-4) > COMBAT.vrSwingSpeed) {
      this.tryHit();
    }

    for (const s of this.tipTrail) s.age += dt;
    this.tipTrail.push({ p: tip.clone(), dir, age: 0 });
    while (this.tipTrail.length > 2 && this.tipTrail[0].age > COMBAT.swooshWindow) {
      this.tipTrail.shift();
    }

    // Свист — только настоящий взмах: кончик БЫСТРО прошёл дугу, и клинок
    // при этом заметно повернулся (не просто перенос меча / ходьба).
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
        if (t.hit(dir)) {
          this.sfx.hitThud();
          this.haptic("right", 0.7, 70);
        }
      }
    }
  }

  // ---- лук ----

  private updateBow(dt: number, primaryHeld: boolean, primaryReleased: boolean): void {
    if (this.player.inVR) {
      this.updateBowVR();
      return;
    }
    // Плоский режим: держим ЛКМ — натягиваем, сила растёт со временем.
    if (primaryHeld) {
      if (this.draw === 0) this.sfx.bowDraw();
      this.draw = clamp(this.draw + dt / BOW.drawTimeFlat, 0, 1);
    }
    this.nockArrow.setEnabled(this.draw > 0.02);
    this.placeNockArrow(
      new Vector3(this.bowParts.nockRest.x, this.bowParts.nockRest.y, this.bowParts.nockRest.z + this.draw * BOW.drawPullFlat),
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
        this.placeNockArrow(local, local.scale(-1)); // стрела смотрит от руки к луку
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

  /**
   * Ставит наглядную стрелу так, чтобы её ХВОСТ был в точке натяга `nock`
   * (локально), а сама она смотрела в направлении `dir`. Прото: наконечник по +Z,
   * длина 0.7, центр в нуле.
   */
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
    if (this.arrows.length >= 16) {
      this.arrows.shift()?.dispose();
    }
    // Кривая: слабый натяг стреляет заметно слабее полного.
    const p = Math.pow(clamp(power, 0, 1), BOW.powerCurve);
    const speed = BOW.minSpeed + p * (BOW.maxSpeed - BOW.minSpeed);
    this.arrows.push(new Arrow(this.arrowProto, origin, dir.scale(speed)));
  }

  private readonly arrowCtx: {
    scene: Scene;
    targets: Hittable[];
    isSolid: (m: AbstractMesh) => boolean;
    onHit: (kind: "flesh" | "wood", pos: Vector3) => void;
  };

  // ---- VR настройка оружия в руке (кнопка X на левом) ----

  private updateVRTune(tune: TuneInput | null, dt: number): boolean {
    const slot = this.slot();
    if (tune) {
      const t = this.tunes[slot];
      t.rot.x += -tune.ly * VR_TUNE_ROT * dt;
      t.rot.y += tune.lx * VR_TUNE_ROT * dt;
      t.rot.z += tune.rx * VR_TUNE_ROT * dt;
      t.pos.z += -tune.ry * VR_TUNE_POS * dt;
      this.tuning = true;
      return true;
    }
    if (this.tuning) {
      this.tuning = false;
      this.saveTuning();
      this.haptic("right", 0.6, 90);
      const v = this.tunes[slot];
      const f = (n: number) => n.toFixed(3);
      console.log(
        `${slot}: pos(${f(v.pos.x)}, ${f(v.pos.y)}, ${f(v.pos.z)}) rot(${f(v.rot.x)}, ${f(v.rot.y)}, ${f(v.rot.z)})`,
      );
    }
    return false;
  }

  private haptic(hand: "left" | "right", strength: number, ms: number): void {
    const pad = this.controller(hand)?.inputSource.gamepad as
      | { hapticActuators?: { pulse?: (v: number, ms: number) => void }[] }
      | undefined;
    pad?.hapticActuators?.[0]?.pulse?.(strength, ms);
  }
}
