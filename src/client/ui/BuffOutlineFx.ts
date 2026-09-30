import type { Scene } from "@babylonjs/core/scene";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Constants } from "@babylonjs/core/Engines/constants";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

export type BuffShape = "shield" | "sword";

/** Текстура очертания — одна на сцену и форму (рисуется один раз, светящимся контуром). */
const texCache = new WeakMap<Scene, Map<BuffShape, DynamicTexture>>();

function outlineTexture(scene: Scene, shape: BuffShape): DynamicTexture {
  let byShape = texCache.get(scene);
  if (!byShape) texCache.set(scene, (byShape = new Map()));
  const hit = byShape.get(shape);
  if (hit) return hit;
  const S = 256;
  const tex = new DynamicTexture(`buffOutline_${shape}`, { width: S, height: S }, scene, true);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = "#fff";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.shadowColor = "#fff";
  const path = new Path2D();
  if (shape === "shield") {
    // Геральдический щит: плоский верх, скруглённые плечи, остриё вниз.
    path.moveTo(128, 22);
    path.quadraticCurveTo(170, 40, 214, 36);
    path.quadraticCurveTo(222, 150, 128, 234);
    path.quadraticCurveTo(34, 150, 42, 36);
    path.quadraticCurveTo(86, 40, 128, 22);
    path.closePath();
    // Внутренний кант.
    path.moveTo(128, 46);
    path.quadraticCurveTo(160, 58, 192, 56);
    path.quadraticCurveTo(196, 144, 128, 206);
    path.quadraticCurveTo(60, 144, 64, 56);
    path.quadraticCurveTo(96, 58, 128, 46);
    path.closePath();
  } else {
    // Меч остриём вверх: клинок, гарда, рукоять, навершие.
    path.moveTo(128, 14);
    path.lineTo(146, 44);
    path.lineTo(146, 168);
    path.lineTo(110, 168);
    path.lineTo(110, 44);
    path.closePath();
    path.moveTo(128, 40);
    path.lineTo(128, 160);
    path.moveTo(72, 168);
    path.lineTo(184, 168);
    path.lineTo(184, 182);
    path.lineTo(72, 182);
    path.closePath();
    path.moveTo(120, 182);
    path.lineTo(120, 222);
    path.lineTo(136, 222);
    path.lineTo(136, 182);
    path.moveTo(140, 232);
    path.arc(128, 232, 12, 0, Math.PI * 2);
  }
  // Два прохода: широкое мягкое свечение + чёткий контур.
  ctx.shadowBlur = 18;
  ctx.lineWidth = 10;
  ctx.globalAlpha = 0.45;
  ctx.stroke(path);
  ctx.shadowBlur = 6;
  ctx.lineWidth = 5;
  ctx.globalAlpha = 1;
  ctx.stroke(path);
  tex.update();
  byShape.set(shape, tex);
  return tex;
}

/**
 * Бафф героя — прозрачное светящееся очертание (billboard): щит — «Тепло
 * костра» (защита), меч — благословение победы (×2 опыт и урон).
 */
export class BuffOutlineFx {
  private readonly plane: Mesh;
  private readonly mat: StandardMaterial;
  private t = Math.random() * 6;
  private on = false;

  constructor(scene: Scene, parent: TransformNode, shape: BuffShape, color: Color3, size: number, y: number, x = 0) {
    this.plane = MeshBuilder.CreatePlane(`buff_${shape}`, { size }, scene);
    this.mat = new StandardMaterial(`buffMat_${shape}`, scene);
    this.mat.emissiveTexture = outlineTexture(scene, shape);
    this.mat.opacityTexture = this.mat.emissiveTexture;
    this.mat.emissiveColor = color;
    this.mat.diffuseColor = new Color3(0, 0, 0);
    this.mat.specularColor = new Color3(0, 0, 0);
    this.mat.disableLighting = true;
    this.mat.alphaMode = Constants.ALPHA_ADD;
    this.mat.backFaceCulling = false;
    this.plane.material = this.mat;
    this.plane.isPickable = false;
    this.plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.plane.parent = parent;
    this.plane.position.set(x, y, 0);
    this.plane.setEnabled(false);
  }

  setActive(active: boolean): void {
    if (active === this.on) return;
    this.on = active;
    this.plane.setEnabled(active);
  }

  update(dt: number): void {
    if (!this.on) return;
    this.t += dt;
    const pulse = 0.5 + Math.sin(this.t * 2.6) * 0.5;
    this.mat.alpha = 0.35 + pulse * 0.35;
    this.plane.scaling.setAll(0.96 + pulse * 0.06);
  }

  dispose(): void {
    // Текстура общая на сцену — не удаляем.
    this.mat.emissiveTexture = null;
    this.mat.opacityTexture = null;
    this.mat.dispose();
    this.plane.dispose();
  }
}
