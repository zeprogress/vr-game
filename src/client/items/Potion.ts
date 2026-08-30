import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

import { ITEMS } from "#shared/items";

const LABEL_W = 128;
const LABEL_H = 64;

export interface PotionBottle {
  /** Корень: его двигают на пояс или в руку. */
  root: TransformNode;
  /** Показать число зелий в сумке. 0 — бутылочку прячем. */
  setCount(n: number): void;
  setEnabled(v: boolean): void;
  dispose(): void;
}

/**
 * Бутылочка зелья, висящая на поясе: пузатое тело, горлышко, пробка
 * и табличка с числом зелий в сумке.
 */
export function createPotion(scene: Scene): PotionBottle {
  const root = new TransformNode("potionBottle", scene);

  const tint = ITEMS.potion.tint;
  const glass = new StandardMaterial("potionGlass", scene);
  glass.diffuseColor = new Color3(tint[0], tint[1], tint[2]);
  glass.emissiveColor = new Color3(tint[0] * 0.45, tint[1] * 0.2, tint[2] * 0.25);
  glass.specularColor = new Color3(0.8, 0.8, 0.8);
  glass.specularPower = 64;
  glass.alpha = 0.85;

  const cork = new StandardMaterial("potionCork", scene);
  cork.diffuseColor = new Color3(0.42, 0.3, 0.16);
  cork.specularColor = new Color3(0, 0, 0);

  const body = MeshBuilder.CreateSphere("p_body", { diameter: 0.075, segments: 8 }, scene);
  body.scaling.y = 1.25;
  body.material = glass;
  body.parent = root;
  body.isPickable = false;

  const neck = MeshBuilder.CreateCylinder("p_neck", { height: 0.05, diameter: 0.028 }, scene);
  neck.position.y = 0.058;
  neck.material = glass;
  neck.parent = root;
  neck.isPickable = false;

  const stopper = MeshBuilder.CreateCylinder("p_cork", { height: 0.022, diameter: 0.032 }, scene);
  stopper.position.y = 0.09;
  stopper.material = cork;
  stopper.parent = root;
  stopper.isPickable = false;

  // Табличка с количеством — всегда развёрнута к лицу.
  const tex = new DynamicTexture("potionCount", { width: LABEL_W, height: LABEL_H }, scene, false);
  tex.hasAlpha = true;
  const labelMat = new StandardMaterial("potionCountMat", scene);
  labelMat.diffuseTexture = tex;
  labelMat.emissiveTexture = tex;
  labelMat.opacityTexture = tex;
  labelMat.useAlphaFromDiffuseTexture = true;
  labelMat.disableLighting = true;
  labelMat.specularColor = new Color3(0, 0, 0);
  labelMat.backFaceCulling = false;

  const label = MeshBuilder.CreatePlane(
    "p_count",
    { width: 0.07, height: 0.07 * (LABEL_H / LABEL_W) },
    scene,
  );
  label.material = labelMat;
  label.parent = root;
  label.position.y = -0.075;
  label.billboardMode = Mesh.BILLBOARDMODE_ALL;
  label.isPickable = false;
  label.renderingGroupId = 1; // не тонет в бутылочке

  let shown = -1;
  const setCount = (n: number): void => {
    if (n === shown) return;
    shown = n;
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, LABEL_W, LABEL_H);
    // Без roundRect: он есть не во всех браузерах, а в шлеме проверить негде.
    ctx.fillStyle = "rgba(12,14,20,0.8)";
    ctx.fillRect(4, 8, LABEL_W - 8, LABEL_H - 16);
    ctx.fillStyle = "#ffd8dc";
    ctx.font = "bold 40px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`×${n}`, LABEL_W / 2, LABEL_H / 2);
    tex.update(true);
  };
  setCount(0);

  return {
    root,
    setCount,
    setEnabled: (v) => root.setEnabled(v),
    dispose: () => {
      root.dispose(false, true);
      tex.dispose();
    },
  };
}
