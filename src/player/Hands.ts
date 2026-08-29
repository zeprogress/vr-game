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

type Side = "left" | "right";

/** Локальная поправка ориентации кисти относительно grip-узла контроллера. */
const HAND_ROT = new Vector3(-0.5, 0, 0);

interface Hand {
  side: Side;
  root: TransformNode;
  knuckles: TransformNode[]; // 4 пальца
  thumb: TransformNode;
  controller: WebXRInputSource;
  curl: number; // сглаженное 0..1
}

/** Кисти на контроллерах: ладонь + пальцы, сжимаются в кулак по кнопке grip. */
export class Hands {
  private readonly hands: Hand[] = [];
  private addObs: Observer<WebXRInputSource> | null = null;
  private removeObs: Observer<WebXRInputSource> | null = null;
  private readonly skin: StandardMaterial;

  constructor(private readonly scene: Scene) {
    this.skin = new StandardMaterial("handSkin", scene);
    this.skin.diffuseColor = new Color3(0.82, 0.62, 0.5);
    this.skin.specularColor = new Color3(0.12, 0.1, 0.1);
  }

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
      const pad = h.controller.inputSource.gamepad;
      const btn = pad?.buttons[1];
      const target = btn ? (btn.value || (btn.pressed ? 1 : 0)) : 0;
      h.curl += (target - h.curl) * Math.min(1, dt * 18);
      const c = h.curl;
      for (const k of h.knuckles) k.rotation.x = -c * 1.6;
      h.thumb.rotation.y = (h.side === "right" ? 1 : -1) * c * 1.1;
      h.thumb.rotation.x = -c * 0.5;
    }
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
    root.rotation.copyFrom(HAND_ROT);

    const palm = MeshBuilder.CreateBox(`palm_${side}`, { width: 0.085, height: 0.03, depth: 0.095 }, this.scene);
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
      const finger = MeshBuilder.CreateBox(`finger_${side}_${i}`, { width: 0.016, height: 0.016, depth: len }, this.scene);
      finger.material = this.skin;
      finger.parent = k;
      finger.position.z = -len / 2;
      finger.isPickable = false;
      knuckles.push(k);
    }

    const thumb = new TransformNode(`thumbK_${side}`, this.scene);
    thumb.parent = palm;
    thumb.position.set(0.045 * mirror, 0, 0.015);
    const thumbMesh = MeshBuilder.CreateBox(`thumb_${side}`, { width: 0.018, height: 0.018, depth: 0.045 }, this.scene);
    thumbMesh.material = this.skin;
    thumbMesh.parent = thumb;
    thumbMesh.position.set(0.01 * mirror, 0, -0.022);
    thumbMesh.isPickable = false;

    return { side, root, knuckles, thumb, controller, curl: 0 };
  }
}
