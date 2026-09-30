import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

/**
 * Компас заданий в VR: золотая стрелка перед игроком на уровне груди,
 * лежит горизонтально и смотрит на цель; над ней — название и расстояние.
 * (На ПК/телефоне — HTML-компас QuestCompass.)
 */
export class VrCompass {
  private readonly root: TransformNode;
  private readonly arrow: TransformNode;
  private readonly tex: DynamicTexture;
  private target: { x: number; z: number; name: string } | null = null;
  private lastText = "";

  constructor(scene: Scene) {
    this.root = new TransformNode("vrCompass", scene);
    this.arrow = new TransformNode("vrCompassArrow", scene);
    this.arrow.parent = this.root;
    const mat = new StandardMaterial("vrCompassMat", scene);
    mat.diffuseColor = new Color3(0, 0, 0);
    mat.specularColor = new Color3(0, 0, 0);
    mat.emissiveColor = new Color3(1, 0.78, 0.25);
    mat.disableLighting = true;
    // Наконечник (конус вдоль +Z) и древко.
    const tip = MeshBuilder.CreateCylinder("vrCompassTip", { height: 0.09, diameterTop: 0, diameterBottom: 0.07, tessellation: 12 }, scene);
    tip.rotation.x = Math.PI / 2;
    tip.position.z = 0.06;
    const shaft = MeshBuilder.CreateCylinder("vrCompassShaft", { height: 0.08, diameter: 0.022, tessellation: 8 }, scene);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = -0.02;
    for (const m of [tip, shaft]) {
      m.material = mat;
      m.parent = this.arrow;
      m.isPickable = false;
      m.renderingGroupId = 2;
    }
    this.tex = new DynamicTexture("vrCompassTex", { width: 512, height: 96 }, scene, false);
    this.tex.hasAlpha = true;
    const lm = new StandardMaterial("vrCompassLabelMat", scene);
    lm.diffuseTexture = this.tex;
    lm.emissiveTexture = this.tex;
    lm.opacityTexture = this.tex;
    lm.disableLighting = true;
    lm.backFaceCulling = false;
    const label = MeshBuilder.CreatePlane("vrCompassLabel", { width: 0.34, height: 0.064 }, scene);
    label.material = lm;
    label.parent = this.root;
    label.position.y = 0.075;
    label.billboardMode = Mesh.BILLBOARDMODE_ALL;
    label.isPickable = false;
    label.renderingGroupId = 2;
    this.root.setEnabled(false);
  }

  set(t: { x: number; z: number; name: string } | null): void {
    this.target = t;
    this.root.setEnabled(!!t);
    this.lastText = "";
  }

  /** head — позиция головы, yaw — куда смотрит камера (рад, 0 — на +Z). */
  update(head: Vector3, yaw: number, inVR: boolean): void {
    const t = this.target;
    if (!t || !inVR) {
      this.root.setEnabled(false);
      return;
    }
    this.root.setEnabled(true);
    // Перед игроком чуть ниже глаз — видно боковым зрением, не мешает.
    this.root.position.set(head.x + Math.sin(yaw) * 0.55, head.y - 0.32, head.z + Math.cos(yaw) * 0.55);
    const dx = t.x - head.x;
    const dz = t.z - head.z;
    this.arrow.rotation.y = Math.atan2(dx, dz);
    const dist = Math.hypot(dx, dz);
    const text = dist < 6 ? `${t.name} — здесь` : `${t.name} · ${Math.round(dist)} м`;
    if (text === this.lastText) return;
    this.lastText = text;
    const ctx = this.tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 512, 96);
    ctx.font = "600 34px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(10,8,16,0.9)";
    const shown = text.length > 30 ? `${text.slice(0, 29)}…` : text;
    ctx.strokeText(shown, 256, 48);
    ctx.fillStyle = "#f1ead6";
    ctx.fillText(shown, 256, 48);
    this.tex.update(true);
  }
}
