import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Constants } from "@babylonjs/core/Engines/constants";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import { TransformNode as TNode } from "@babylonjs/core/Meshes/transformNode";

export type BuffShape = "shield" | "sword" | "boot" | "arrow";

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
  } else if (shape === "boot") {
    // Башмак: голенище, пятка, носок, подошва и «крылышко» скорости.
    path.moveTo(92, 30);
    path.lineTo(92, 150);
    path.quadraticCurveTo(92, 186, 130, 190);
    path.lineTo(214, 196);
    path.quadraticCurveTo(232, 200, 230, 222);
    path.lineTo(70, 222);
    path.quadraticCurveTo(58, 222, 58, 206);
    path.lineTo(58, 30);
    path.closePath();
    path.moveTo(58, 60);
    path.lineTo(92, 60);
    path.moveTo(100, 70);
    path.lineTo(150, 46);
    path.moveTo(100, 94);
    path.lineTo(160, 76);
    path.moveTo(100, 118);
    path.lineTo(148, 106);
  } else if (shape === "arrow") {
    // Стрелка вверх: наконечник и древко.
    path.moveTo(128, 18);
    path.lineTo(214, 112);
    path.lineTo(160, 112);
    path.lineTo(160, 236);
    path.lineTo(96, 236);
    path.lineTo(96, 112);
    path.lineTo(42, 112);
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

  constructor(
    scene: Scene,
    parent: TNode,
    shape: BuffShape,
    color: Color3,
    size: number,
    y: number,
    x = 0,
    z = 0,
    billboard: number = Mesh.BILLBOARDMODE_ALL,
  ) {
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
    this.plane.billboardMode = billboard;
    this.plane.parent = parent;
    this.plane.position.set(x, y, z);
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
    this.mat.alpha = 0.2 + pulse * 0.2;
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

/** Баффы по кругу: форма, цвет, размер и сдвиг по углу (доля 1/12 оборота). */
export type OrbitBuff = "sword" | "shield" | "boot" | "arrow";
const ORBIT: Record<OrbitBuff, { shape: BuffShape; color: Color3; size: number; slot: number }> = {
  /** Благословение победы (×2 опыт/урон) — красные мечи. */
  sword: { shape: "sword", color: new Color3(1, 0.25, 0.22), size: 0.5, slot: 0 },
  /** Свиток ветра — зелёные башмаки. */
  boot: { shape: "boot", color: new Color3(0.4, 1, 0.65), size: 0.4, slot: 1 },
  /** «Тепло костра» — золотые щиты. */
  shield: { shape: "shield", color: new Color3(1, 0.75, 0.25), size: 0.42, slot: 2 },
  /** Свиток мудрости — голубые стрелки вверх. */
  arrow: { shape: "arrow", color: new Color3(0.45, 0.8, 1), size: 0.42, slot: 3 },
};

/**
 * Баффы героя — светящиеся фигурки, по три каждого вида, кружат вокруг на
 * уровне пояса на общей оси (виды чередуются через 30°). Фигурки создаются
 * при первом включении бафа — у большинства аватаров их нет вовсе.
 */
export class BuffOrbitFx {
  private readonly pivot: TNode;
  private readonly groups = new Map<OrbitBuff, BuffOutlineFx[]>();
  private readonly on = new Set<OrbitBuff>();

  constructor(
    private readonly scene: Scene,
    parent: TNode,
    y: number,
    private readonly radius = 0.72,
  ) {
    this.pivot = new TNode("buff_orbit", scene);
    this.pivot.parent = parent;
    this.pivot.position.y = y;
    this.pivot.setEnabled(false);
  }

  private group(k: OrbitBuff): BuffOutlineFx[] {
    let g = this.groups.get(k);
    if (g) return g;
    const d = ORBIT[k];
    g = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + (d.slot * Math.PI) / 6;
      g.push(new BuffOutlineFx(this.scene, this.pivot, d.shape, d.color, d.size, 0, Math.cos(a) * this.radius, Math.sin(a) * this.radius, Mesh.BILLBOARDMODE_Y));
    }
    this.groups.set(k, g);
    return g;
  }

  set(active: Partial<Record<OrbitBuff, boolean>>): void {
    for (const k of Object.keys(ORBIT) as OrbitBuff[]) {
      const want = !!active[k];
      if (want === this.on.has(k)) continue;
      if (want) this.on.add(k);
      else this.on.delete(k);
      if (want || this.groups.has(k)) for (const b of this.group(k)) b.setActive(want);
    }
    this.pivot.setEnabled(this.on.size > 0);
  }

  update(dt: number): void {
    if (!this.on.size) return;
    this.pivot.rotation.y += dt * 1.6;
    for (const k of this.on) for (const b of this.groups.get(k) ?? []) b.update(dt);
  }

  dispose(): void {
    for (const g of this.groups.values()) for (const b of g) b.dispose();
    this.pivot.dispose();
  }
}
