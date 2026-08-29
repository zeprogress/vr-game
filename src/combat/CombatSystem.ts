import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Node } from "@babylonjs/core/node";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { WebXRDefaultExperience } from "@babylonjs/core/XR/webXRDefaultExperience";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";

import { COMBAT } from "../shared/constants";
import type { TuneInput } from "../input/InputSource";
import type { PlayerController } from "../player/PlayerController";
import { createSword } from "../items/Sword";
import type { Dummy } from "./Dummy";

const TIP = new Vector3(...COMBAT.swordTipLocal);
const TUNE_KEY = "swordTune";
const VR_TUNE_ROT = 1.6; // рад/с при полном отклонении стика
const VR_TUNE_POS = 0.4; // м/с

/** Положение меча в руке. Живые значения — правятся панелью тюнинга в рантайме. */
export interface EquipTune {
  pos: Vector3;
  rot: Vector3;
  scale: number;
}

export class CombatSystem {
  private readonly sword: Mesh;
  private readonly home: Vector3;

  /** Стартовые значения = то, что было в константах. Панель тюнинга их правит. */
  readonly tuneFlat: EquipTune = {
    pos: new Vector3(0.42, -0.38, 0.85),
    rot: new Vector3(-0.2, 0.25, -0.28),
    scale: 0.55,
  };
  readonly tuneVR: EquipTune = {
    pos: new Vector3(0, 0, 0),
    rot: new Vector3(1, 0, 0),
    scale: 1,
  };

  private equipped = false;
  private prevInteract = false;
  private prevPrimary = false;

  private swingT = 0; // остаток времени взмаха (плоский режим)
  private swingHitDone = false;

  private tipPrev = new Vector3();
  private tipInit = false;
  private bob = 0;
  private tuning = false; // идёт правка положения меча в VR

  constructor(
    scene: Scene,
    private readonly player: PlayerController,
    private readonly getXR: () => WebXRDefaultExperience | null,
    private readonly dummies: Dummy[],
    swordHome: Vector3,
  ) {
    this.home = swordHome.clone();
    this.sword = createSword(scene);
    this.sword.position.copyFrom(this.home);

    const rockMat = new StandardMaterial("rockMat", scene);
    rockMat.diffuseColor = new Color3(0.42, 0.42, 0.45);
    rockMat.specularColor = new Color3(0, 0, 0);
    const rock = MeshBuilder.CreateSphere("swordRock", { diameter: 1.1, segments: 6 }, scene);
    rock.material = rockMat;
    rock.position.set(this.home.x, this.home.y - 0.75, this.home.z);
    rock.scaling.y = 0.5;
    rock.isPickable = false;

    this.loadTuning();
  }

  /** Читает сохранённые в localStorage значения в tuneFlat/tuneVR. */
  loadTuning(): void {
    try {
      const raw = localStorage.getItem(TUNE_KEY);
      if (!raw) return;
      const j = JSON.parse(raw);
      for (const [key, t] of [
        ["flat", this.tuneFlat],
        ["vr", this.tuneVR],
      ] as const) {
        const d = j?.[key];
        if (!d) continue;
        t.pos.set(d.pos[0], d.pos[1], d.pos[2]);
        t.rot.set(d.rot[0], d.rot[1], d.rot[2]);
        t.scale = d.scale;
      }
    } catch {
      /* нет данных / приватный режим */
    }
  }

  saveTuning(): void {
    const ser = (t: EquipTune) => ({
      pos: [t.pos.x, t.pos.y, t.pos.z],
      rot: [t.rot.x, t.rot.y, t.rot.z],
      scale: t.scale,
    });
    try {
      localStorage.setItem(
        TUNE_KEY,
        JSON.stringify({ flat: ser(this.tuneFlat), vr: ser(this.tuneVR) }),
      );
    } catch {
      /* ignore */
    }
  }

  update(dt: number): void {
    const inp = this.player.lastInput;

    const interactEdge = inp.interact && !this.prevInteract;
    const primaryEdge = inp.primaryAction && !this.prevPrimary;
    this.prevInteract = inp.interact;
    this.prevPrimary = inp.primaryAction;

    if (interactEdge) {
      if (this.equipped) this.drop();
      else if (Vector3.Distance(this.player.position, this.sword.getAbsolutePosition()) < COMBAT.equipReach) {
        this.equip();
      }
    }

    if (!this.equipped) {
      this.bob += dt;
      this.sword.position.set(this.home.x, this.home.y + Math.sin(this.bob * 2) * 0.08, this.home.z);
      this.sword.rotation.set(0, this.bob * 0.7, 0);
    } else {
      this.keepAnchored();
      if (this.player.inVR) {
        if (!this.updateVRTune(inp.tune, dt)) this.updateVRSwing(dt);
      } else {
        this.updateFlatSwing(dt, primaryEdge);
      }
    }

    for (const d of this.dummies) d.update(dt);
  }

  /**
   * Правка положения меча прямо в VR: зажми X на левом контроллере и крути
   * стики. Левый — наклон (тангаж/рыскание), правый X — крен, правый Y —
   * меч ближе/дальше в руке. Отпустил X — сохранилось. Возвращает true,
   * пока идёт настройка (в это время удары не считаются).
   */
  private updateVRTune(tune: TuneInput | null, dt: number): boolean {
    if (tune) {
      const t = this.tuneVR;
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
      this.hapticPulse();
      const v = this.tuneVR;
      const f = (n: number) => n.toFixed(3);
      console.log(
        `tuneVR: pos(${f(v.pos.x)}, ${f(v.pos.y)}, ${f(v.pos.z)}) rot(${f(v.rot.x)}, ${f(v.rot.y)}, ${f(v.rot.z)})`,
      );
    }
    return false;
  }

  private hapticPulse(): void {
    const right = this.getXR()?.input.controllers.find(
      (c) => c.inputSource.handedness === "right",
    );
    const pad = right?.inputSource.gamepad as
      | { hapticActuators?: { pulse?: (v: number, ms: number) => void }[] }
      | undefined;
    pad?.hapticActuators?.[0]?.pulse?.(0.6, 90);
  }

  private equip(): void {
    this.equipped = true;
    this.swingT = 0;
    this.tipInit = false;
    this.keepAnchored();
  }

  private drop(): void {
    this.equipped = false;
    this.sword.parent = null;
    this.sword.position.copyFrom(this.home);
    this.sword.rotation.setAll(0);
    this.sword.scaling.setAll(1);
  }

  get vrActive(): boolean {
    return this.player.inVR;
  }

  private activeTune(): EquipTune {
    return this.player.inVR ? this.tuneVR : this.tuneFlat;
  }

  /** Держим меч в руке (камера в плоском режиме / контроллер в VR). */
  private keepAnchored(): void {
    const anchor = this.handAnchor();
    if (this.sword.parent !== anchor) this.sword.parent = anchor;
    const t = this.activeTune();
    this.sword.position.copyFrom(t.pos);
    this.sword.rotation.copyFrom(t.rot);
    this.sword.scaling.setAll(t.scale);
  }

  private handAnchor(): Node {
    if (this.player.inVR) {
      const xr = this.getXR();
      const right = xr?.input.controllers.find((c) => c.inputSource.handedness === "right");
      const node = right?.grip ?? right?.pointer;
      if (node) return node;
    }
    return this.player.camera;
  }

  private updateFlatSwing(dt: number, primaryEdge: boolean): void {
    if (primaryEdge && this.swingT <= 0) {
      this.swingT = COMBAT.swingDuration;
      this.swingHitDone = false;
    }
    if (this.swingT > 0) {
      this.swingT -= dt;
      const phase = 1 - Math.max(0, this.swingT) / COMBAT.swingDuration; // 0..1
      const arc = Math.sin(phase * Math.PI); // 0..1..0
      this.sword.rotation.x = this.tuneFlat.rot.x - arc * 1.5;
      this.sword.rotation.z = this.tuneFlat.rot.z + arc * 0.45;
      if (phase > 0.3 && !this.swingHitDone) {
        this.swingHitDone = true;
        this.tryHit();
      }
    }
  }

  private updateVRSwing(dt: number): void {
    const tip = this.tipWorld();
    if (this.tipInit) {
      const speed = Vector3.Distance(tip, this.tipPrev) / Math.max(dt, 1e-4);
      if (speed > COMBAT.vrSwingSpeed) this.tryHit();
    }
    this.tipPrev.copyFrom(tip);
    this.tipInit = true;
  }

  private tipWorld(): Vector3 {
    return Vector3.TransformCoordinates(TIP, this.sword.getWorldMatrix());
  }

  private tryHit(): void {
    const m = this.sword.getWorldMatrix();
    const guard = Vector3.TransformCoordinates(Vector3.ZeroReadOnly, m);
    const tip = Vector3.TransformCoordinates(TIP, m);
    const dir = tip.subtract(this.player.camera.globalPosition);
    dir.y = 0;
    if (dir.lengthSquared() > 1e-6) dir.normalize();

    for (const d of this.dummies) {
      if (!d.alive) continue;
      const seg = d.hitSegment();
      if (segmentDistance(guard, tip, seg.a, seg.b) <= seg.radius + COMBAT.hitMargin) {
        d.hit(dir);
      }
    }
  }
}

/** Кратчайшее расстояние между двумя отрезками в пространстве. */
function segmentDistance(p1: Vector3, p2: Vector3, q1: Vector3, q2: Vector3): number {
  const d1 = p2.subtract(p1);
  const d2 = q2.subtract(q1);
  const r = p1.subtract(q1);
  const a = Vector3.Dot(d1, d1);
  const e = Vector3.Dot(d2, d2);
  const f = Vector3.Dot(d2, r);
  let s: number;
  let t: number;
  if (a <= 1e-8 && e <= 1e-8) return r.length();
  if (a <= 1e-8) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = Vector3.Dot(d1, r);
    if (e <= 1e-8) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = Vector3.Dot(d1, d2);
      const denom = a * e - b * b;
      s = denom > 1e-8 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  const cp1 = p1.add(d1.scale(s));
  const cp2 = q1.add(d2.scale(t));
  return Vector3.Distance(cp1, cp2);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
