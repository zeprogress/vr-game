import type { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Constants } from "@babylonjs/core/Engines/constants";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/Builders/discBuilder";

/**
 * Маяк динамического события (этап 14): высокий полупрозрачный столб света +
 * кольцо по земле в эпицентре. Виден издалека — к нему бегут игроки.
 */
export class EventBeacon {
  private readonly root: TransformNode;
  private readonly colMat: StandardMaterial;
  private readonly ringMat: StandardMaterial;
  private readonly ring: import("@babylonjs/core/Meshes/mesh").Mesh;
  private t = 0;
  private shown = false;
  private groundY: (x: number, z: number) => number = () => 0;

  constructor(scene: Scene) {
    this.root = new TransformNode("eventBeacon", scene);
    this.root.setEnabled(false);

    const col = MeshBuilder.CreateCylinder(
      "eventBeaconCol",
      { height: 60, diameterTop: 3.4, diameterBottom: 1.6, tessellation: 18 },
      scene,
    );
    this.colMat = new StandardMaterial("eventBeaconColMat", scene);
    this.colMat.emissiveColor = new Color3(1, 0.45, 0.15);
    this.colMat.diffuseColor = new Color3(0, 0, 0);
    this.colMat.specularColor = new Color3(0, 0, 0);
    this.colMat.disableLighting = true;
    this.colMat.alphaMode = Constants.ALPHA_ADD;
    this.colMat.alpha = 0.18;
    this.colMat.backFaceCulling = false;
    col.material = this.colMat;
    col.isPickable = false;
    col.position.y = 30;
    col.parent = this.root;

    this.ring = MeshBuilder.CreateDisc("eventBeaconRing", { radius: 1, tessellation: 40 }, scene);
    this.ringMat = new StandardMaterial("eventBeaconRingMat", scene);
    this.ringMat.emissiveColor = new Color3(1, 0.5, 0.18);
    this.ringMat.diffuseColor = new Color3(0, 0, 0);
    this.ringMat.specularColor = new Color3(0, 0, 0);
    this.ringMat.disableLighting = true;
    this.ringMat.alphaMode = Constants.ALPHA_ADD;
    this.ringMat.alpha = 0.4;
    this.ring.material = this.ringMat;
    this.ring.rotation.x = Math.PI / 2;
    this.ring.isPickable = false;
    this.ring.parent = this.root;
  }

  bindGround(fn: (x: number, z: number) => number): void {
    this.groundY = fn;
  }

  /** Включить/переставить маяк (kind 0 — спрятать). */
  set(kind: number, x: number, z: number): void {
    const on = kind > 0;
    if (on) {
      this.root.position.set(x, this.groundY(x, z), z);
    }
    if (on !== this.shown) {
      this.shown = on;
      this.root.setEnabled(on);
    }
  }

  update(dt: number): void {
    if (!this.shown) return;
    this.t += dt;
    const pulse = 0.8 + Math.sin(this.t * 3) * 0.2;
    this.colMat.alpha = 0.12 + pulse * 0.1;
    this.ring.scaling.setAll(9 + Math.sin(this.t * 2) * 1.2);
    this.ringMat.alpha = 0.25 + pulse * 0.2;
    this.ring.rotation.y += dt * 0.5;
  }

  dispose(): void {
    this.colMat.dispose();
    this.ringMat.dispose();
    this.root.dispose(false, true);
  }
}
