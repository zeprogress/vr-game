import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Constants } from "@babylonjs/core/Engines/constants";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { EVENT } from "#shared/constants";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";

/**
 * Маяк динамического события (этап 14): широкий ровный синий столб света над
 * всей зоной события (без донышек, диаметр чуть больше зоны), пульсирует
 * (то меньше, то больше). Виден издалека, к нему бегут игроки.
 */
export class EventBeacon {
  private readonly root: TransformNode;
  private readonly cone: Mesh;
  private readonly mat: StandardMaterial;
  private t = 0;
  private shown = false;
  private kind = 0;
  private groundY: (x: number, z: number) => number = () => 0;

  constructor(scene: Scene) {
    this.root = new TransformNode("eventBeacon", scene);
    this.root.setEnabled(false);

    const base = EVENT.invasion.radius * 2.6; // ровный столб, чуть шире зоны
    this.cone = MeshBuilder.CreateCylinder(
      "eventBeaconCone",
      { height: 28, diameter: base, tessellation: 24, cap: 0 /* без донышек */ },
      scene,
    );
    this.mat = new StandardMaterial("eventBeaconMat", scene);
    this.mat.emissiveColor = new Color3(0.25, 0.55, 1); // синий
    this.mat.diffuseColor = new Color3(0, 0, 0);
    this.mat.specularColor = new Color3(0, 0, 0);
    this.mat.disableLighting = true;
    this.mat.alphaMode = Constants.ALPHA_ADD;
    this.mat.alpha = 0.16;
    this.mat.backFaceCulling = false;
    this.cone.material = this.mat;
    this.cone.isPickable = false;
    this.cone.position.y = 14;
    this.cone.parent = this.root;
  }

  bindGround(fn: (x: number, z: number) => number): void {
    this.groundY = fn;
  }

  /** Включить/переставить маяк (kind 0 — спрятать; 1 — нашествие/синий, 2 — охота/янтарный). */
  set(kind: number, x: number, z: number): void {
    const on = kind > 0;
    if (on) this.root.position.set(x, this.groundY(x, z), z);
    if (on && kind !== this.kind) {
      this.kind = kind;
      this.mat.emissiveColor =
        kind === 2 ? new Color3(1, 0.62, 0.2) : new Color3(0.25, 0.55, 1);
    }
    if (on !== this.shown) {
      this.shown = on;
      this.root.setEnabled(on);
    }
  }

  update(dt: number): void {
    if (!this.shown) return;
    this.t += dt;
    // Пульс: конус то шире, то у́же; прозрачность в такт.
    const pulse = 1 + Math.sin(this.t * 2.2) * 0.28;
    this.cone.scaling.set(pulse, 1, pulse);
    this.mat.alpha = 0.1 + (0.5 + Math.sin(this.t * 2.2) * 0.5) * 0.14;
    this.cone.rotation.y += dt * 0.25;
  }

  dispose(): void {
    this.mat.dispose();
    this.root.dispose(false, true);
  }
}
