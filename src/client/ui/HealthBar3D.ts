import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

import { clamp01 } from "#shared/geometry";

/**
 * Полоска здоровья в мире: фон + заполнение.
 *
 * `billboard: true` — поворот только вокруг вертикали (BILLBOARDMODE_Y):
 * полоска всегда развёрнута к игроку, но остаётся параллельной горизонту
 * и не заваливается, когда смотришь сверху или снизу.
 */
export class HealthBar3D {
  private readonly bg: Mesh;
  private readonly fill: Mesh;
  private readonly bgMat: StandardMaterial;
  private readonly fillMat: StandardMaterial;
  private opacity = 1;

  constructor(
    scene: Scene,
    parent: Node,
    offset: Vector3,
    width = 0.8,
    billboard = true,
    fillHeight = 0.1,
  ) {
    this.bgMat = new StandardMaterial("hpBgMat", scene);
    const bgMat = this.bgMat;
    bgMat.disableLighting = true;
    bgMat.emissiveColor = new Color3(0.04, 0.04, 0.04);
    bgMat.specularColor = new Color3(0, 0, 0);
    bgMat.alpha = 0.6;

    this.bg = MeshBuilder.CreatePlane(
      "hpBg",
      { width: width + 0.06, height: fillHeight * 1.4 },
      scene,
    );
    this.bg.material = bgMat;
    this.bg.parent = parent;
    this.bg.position.copyFrom(offset);
    this.bg.isPickable = false;
    this.bg.renderingGroupId = 1;
    if (billboard) {
      // Только вокруг вертикали — полоска не заваливается вместе с обзором.
      // preserveParentRotationForBillboard=false (по умолчанию) означает, что
      // поворот родителя-моба игнорируется, и полоска смотрит строго на камеру.
      this.bg.billboardMode = Mesh.BILLBOARDMODE_Y;
    }

    this.fillMat = new StandardMaterial("hpFillMat", scene);
    this.fillMat.disableLighting = true;
    this.fillMat.emissiveColor = new Color3(0.25, 0.8, 0.3);
    this.fillMat.specularColor = new Color3(0, 0, 0);

    this.fill = MeshBuilder.CreatePlane("hpFill", { width, height: fillHeight }, scene);
    this.fill.material = this.fillMat;
    this.fill.parent = this.bg;
    this.fill.position.z = -0.01;
    this.fill.isPickable = false;
    this.fill.renderingGroupId = 1;

    this.width = width;
  }

  private readonly width: number;

  set(frac: number): void {
    const f = clamp01(frac);
    this.fill.scaling.x = Math.max(0.001, f);
    this.fill.position.x = -(this.width * (1 - f)) / 2;
    this.fillMat.emissiveColor.set(
      f > 0.5 ? 0.25 : 0.85,
      f > 0.25 ? 0.75 : 0.2,
      f > 0.5 ? 0.3 : 0.15,
    );
  }

  setVisible(v: boolean): void {
    this.setOpacity(v ? 1 : 0);
  }

  /** 0..1 — плавное появление/исчезновение. */
  setOpacity(a: number): void {
    this.opacity = clamp01(a);
    this.bgMat.alpha = 0.6 * this.opacity;
    this.fillMat.alpha = this.opacity;
    const on = this.opacity > 0.02;
    this.bg.setEnabled(on);
    this.fill.setEnabled(on);
  }

  dispose(): void {
    this.bg.dispose();
  }
}
