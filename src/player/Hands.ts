import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Node } from "@babylonjs/core/node";
import type { WebXRDefaultExperience } from "@babylonjs/core/XR/webXRDefaultExperience";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { WebXRInputSource } from "@babylonjs/core/XR/webXRInputSource";
import "@babylonjs/core/Meshes/Builders/boxBuilder";

export type Side = "left" | "right";

const SAVE_KEY = "handTune";

/** Ориентация кисти относительно grip-узла контроллера — отдельно для каждой руки. */
const DEFAULT_ROT: Record<Side, [number, number, number]> = {
  left: [Math.PI / 2, Math.PI / 2, Math.PI / 2],
  right: [Math.PI / 2, Math.PI / 2, Math.PI / 2],
};

interface Hand {
  side: Side;
  root: TransformNode;
  knuckles: TransformNode[];
  thumb: TransformNode;
  controller: WebXRInputSource;
  curl: number;
}

/**
 * Кисти на контроллерах: ладонь + пальцы, сжимаются в кулак по кнопке grip.
 * Ориентация настраивается для каждой руки отдельно и сохраняется:
 *   game.hands.rotate("left", 0, 1.57, 0)   // докрутить
 *   game.hands.set("right", 1.57, 0, 0)     // задать
 *   game.hands.print()                      // посмотреть текущие
 */
export class Hands {
  private readonly hands: Hand[] = [];
  private addObs: Observer<WebXRInputSource> | null = null;
  private removeObs: Observer<WebXRInputSource> | null = null;
  private readonly skin: StandardMaterial;
  private readonly rot: Record<Side, Vector3>;

  constructor(private readonly scene: Scene) {
    this.skin = new StandardMaterial("handSkin", scene);
    this.skin.diffuseColor = new Color3(0.82, 0.62, 0.5);
    this.skin.emissiveColor = new Color3(0.18, 0.12, 0.1);
    this.skin.specularColor = new Color3(0.12, 0.1, 0.1);

    this.rot = {
      left: Vector3.FromArray(DEFAULT_ROT.left),
      right: Vector3.FromArray(DEFAULT_ROT.right),
    };
    this.load();
  }

  // ---- настройка ориентации ----

  /** Задать поворот кисти (радианы). */
  set(side: Side, x: number, y: number, z: number): void {
    this.rot[side].set(x, y, z);
    this.applyRotation(side);
    this.save();
    this.print();
  }

  /** Докрутить кисть на дельту (радианы). */
  rotate(side: Side, dx: number, dy: number, dz: number): void {
    const r = this.rot[side];
    this.set(side, r.x + dx, r.y + dy, r.z + dz);
  }

  /** Повернуть на 90° по оси: "x" | "y" | "z". */
  turn(side: Side, axis: "x" | "y" | "z", quarters = 1): void {
    const d = (Math.PI / 2) * quarters;
    this.rotate(side, axis === "x" ? d : 0, axis === "y" ? d : 0, axis === "z" ? d : 0);
  }

  resetRotation(side?: Side): void {
    for (const s of side ? [side] : (["left", "right"] as Side[])) {
      this.rot[s].copyFromFloats(...DEFAULT_ROT[s]);
      this.applyRotation(s);
    }
    this.save();
    this.print();
  }

  print(): void {
    const f = (v: Vector3) => `${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)}`;
    console.log(`hands: left(${f(this.rot.left)})  right(${f(this.rot.right)})`);
  }

  private applyRotation(side: Side): void {
    const h = this.hands.find((x) => x.side === side);
    h?.root.rotation.copyFrom(this.rot[side]);
  }

  private save(): void {
    try {
      localStorage.setItem(
        SAVE_KEY,
        JSON.stringify({
          left: this.rot.left.asArray(),
          right: this.rot.right.asArray(),
        }),
      );
    } catch {
      /* ignore */
    }
  }

  private load(): void {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY) ?? "null");
      for (const s of ["left", "right"] as Side[]) {
        const a = d?.[s];
        if (Array.isArray(a) && a.length === 3) this.rot[s].set(a[0], a[1], a[2]);
      }
    } catch {
      /* ignore */
    }
  }

  // ---- жизненный цикл ----

  attach(xr: WebXRDefaultExperience): void {
    for (const c of xr.input.controllers) this.onController(c);
    this.addObs = xr.input.onControllerAddedObservable.add((c) => this.onController(c));
    this.removeObs = xr.input.onControllerRemovedObservable.add((c) => this.onRemove(c));
  }

  detach(xr: WebXRDefaultExperience): void {
    xr.input.onControllerAddedObservable.remove(this.addObs);
    xr.input.onControllerRemovedObservable.remove(this.removeObs);
    for (const h of this.hands) h.root.dispose(false, true);
    this.hands.length = 0;
  }

  /** Каждый кадр: подгоняем сжатие пальцев под аналоговое значение grip. */
  update(dt: number): void {
    for (const h of this.hands) {
      const btn = h.controller.inputSource.gamepad?.buttons[1];
      const target = btn ? btn.value || (btn.pressed ? 1 : 0) : 0;
      h.curl += (target - h.curl) * Math.min(1, dt * 18);
      const c = h.curl;
      for (const k of h.knuckles) k.rotation.x = -c * 1.6;
      h.thumb.rotation.y = (h.side === "right" ? 1 : -1) * c * 1.1;
      h.thumb.rotation.x = -c * 0.5;
    }
  }

  /** Узел кисти — к нему цепляются предметы и панель. */
  nodeFor(side: Side): TransformNode | null {
    return this.hands.find((h) => h.side === side)?.root ?? null;
  }

  private onController(c: WebXRInputSource): void {
    const anchor = c.grip ?? c.pointer;
    if (!anchor) return;
    const side: Side = c.inputSource.handedness === "left" ? "left" : "right";
    if (this.hands.some((h) => h.side === side)) return;
    this.hands.push(this.buildHand(side, anchor, c));
  }

  private onRemove(c: WebXRInputSource): void {
    const side: Side = c.inputSource.handedness === "left" ? "left" : "right";
    const i = this.hands.findIndex((h) => h.side === side);
    if (i >= 0) {
      this.hands[i].root.dispose(false, true);
      this.hands.splice(i, 1);
    }
  }

  private buildHand(side: Side, anchor: Node, controller: WebXRInputSource): Hand {
    const mirror = side === "left" ? -1 : 1;

    const root = new TransformNode(`hand_${side}`, this.scene);
    root.parent = anchor;
    root.rotation.copyFrom(this.rot[side]);

    const palm = MeshBuilder.CreateBox(
      `palm_${side}`,
      { width: 0.085, height: 0.032, depth: 0.095 },
      this.scene,
    );
    palm.material = this.skin;
    palm.parent = root;
    palm.isPickable = false;

    const knuckles: TransformNode[] = [];
    const spread = [-0.03, -0.01, 0.012, 0.033];
    for (let i = 0; i < 4; i++) {
      const k = new TransformNode(`knuckle_${side}_${i}`, this.scene);
      k.parent = palm;
      k.position.set(spread[i], 0, -0.05);
      const len = 0.055 - i * 0.004;
      const finger = MeshBuilder.CreateBox(
        `finger_${side}_${i}`,
        { width: 0.016, height: 0.016, depth: len },
        this.scene,
      );
      finger.material = this.skin;
      finger.parent = k;
      finger.position.z = -len / 2;
      finger.isPickable = false;
      knuckles.push(k);
    }

    const thumb = new TransformNode(`thumbK_${side}`, this.scene);
    thumb.parent = palm;
    thumb.position.set(0.045 * mirror, 0, 0.015);
    const thumbMesh = MeshBuilder.CreateBox(
      `thumb_${side}`,
      { width: 0.018, height: 0.018, depth: 0.045 },
      this.scene,
    );
    thumbMesh.material = this.skin;
    thumbMesh.parent = thumb;
    thumbMesh.position.set(0.01 * mirror, 0, -0.022);
    thumbMesh.isPickable = false;

    return { side, root, knuckles, thumb, controller, curl: 0 };
  }
}
