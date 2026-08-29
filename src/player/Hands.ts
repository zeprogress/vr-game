import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { WebXRDefaultExperience } from "@babylonjs/core/XR/webXRDefaultExperience";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { WebXRInputSource } from "@babylonjs/core/XR/webXRInputSource";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";

/** Простые кулак + запястье на месте контроллеров. */
function createHandMesh(scene: Scene, side: "left" | "right"): Mesh {
  const skin = new StandardMaterial(`handMat_${side}`, scene);
  skin.diffuseColor = new Color3(0.82, 0.62, 0.5);
  skin.specularColor = new Color3(0.12, 0.1, 0.1);

  const fist = MeshBuilder.CreateSphere(`fist_${side}`, { diameter: 0.1, segments: 8 }, scene);
  fist.scaling.set(1, 0.82, 1.2);

  const wrist = MeshBuilder.CreateCylinder(
    `wrist_${side}`,
    { height: 0.13, diameterTop: 0.052, diameterBottom: 0.068, tessellation: 8 },
    scene,
  );
  wrist.rotation.x = Math.PI / 2; // вдоль оси Z
  wrist.position.z = 0.1; // назад, к предплечью

  const hand = Mesh.MergeMeshes([fist, wrist], true, true, undefined, false, false);
  if (!hand) throw new Error("не удалось собрать кисть");
  hand.name = `hand_${side}`;
  hand.material = skin;
  hand.isPickable = false;
  return hand;
}

/** Вешает меши кистей на контроллеры и снимает при выходе из VR. */
export class Hands {
  private readonly meshes: Mesh[] = [];
  private addObs: Observer<WebXRInputSource> | null = null;
  private removeObs: Observer<WebXRInputSource> | null = null;

  constructor(private readonly scene: Scene) {}

  attach(xr: WebXRDefaultExperience): void {
    for (const c of xr.input.controllers) this.onController(c);
    this.addObs = xr.input.onControllerAddedObservable.add((c) => this.onController(c));
    this.removeObs = xr.input.onControllerRemovedObservable.add((c) => this.onRemove(c));
  }

  detach(xr: WebXRDefaultExperience): void {
    xr.input.onControllerAddedObservable.remove(this.addObs);
    xr.input.onControllerRemovedObservable.remove(this.removeObs);
    for (const m of this.meshes) m.dispose();
    this.meshes.length = 0;
  }

  private onController(c: WebXRInputSource): void {
    const anchor = c.grip ?? c.pointer;
    if (!anchor) return;
    const side = c.inputSource.handedness === "left" ? "left" : "right";
    if (this.meshes.some((m) => m.name === `hand_${side}`)) return;
    const hand = createHandMesh(this.scene, side);
    hand.parent = anchor;
    this.meshes.push(hand);
  }

  private onRemove(c: WebXRInputSource): void {
    const side = c.inputSource.handedness === "left" ? "left" : "right";
    const i = this.meshes.findIndex((m) => m.name === `hand_${side}`);
    if (i >= 0) {
      this.meshes[i].dispose();
      this.meshes.splice(i, 1);
    }
  }
}
