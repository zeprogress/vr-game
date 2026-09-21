import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

import { clamp01 } from "#shared/geometry";

/**
 * Полоска здоровья в мире: фон + заполнение.
 *
 * `billboard: true` — поворот только вокруг вертикали (BILLBOARDMODE_Y):
 * полоска всегда развёрнута к игроку, но остаётся параллельной горизонту
 * и не заваливается, когда смотришь сверху или снизу.
 */
const barMats = new WeakMap<Scene, StandardMaterial>();

/** Один материал на сцену: цвета берутся из вершин, прозрачность — через mesh.visibility. */
function barMaterial(scene: Scene): StandardMaterial {
  let m = barMats.get(scene);
  if (m && !m.getScene().isDisposed) return m;
  m = new StandardMaterial("hpBarMat", scene);
  m.disableLighting = true;
  m.diffuseColor = new Color3(0, 0, 0);
  m.emissiveColor = new Color3(1, 1, 1); // итог = (diffuse + emissive) · цвет вершины
  m.specularColor = new Color3(0, 0, 0);
  barMats.set(scene, m);
  return m;
}

const BG_RGBA = [0.04, 0.04, 0.04, 0.6];

export class HealthBar3D {
  /** Фон и заполнение — ОДИН меш (два квада, цвета в вершинах): раньше два меша и два материала на моба. */
  private readonly mesh: Mesh;
  private opacity = 1;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private lastQ = -1;

  constructor(
    scene: Scene,
    parent: Node,
    offset: Vector3,
    private readonly width = 0.8,
    billboard = true,
    fillHeight = 0.1,
    /** "hp" — зелёный/жёлтый/красный по доле; "mana" — синий. */
    private readonly hue: "hp" | "mana" = "hp",
  ) {
    const bw = width + 0.06;
    const bh = fillHeight * 1.4;
    // Квад 0 — фон, квад 1 — заполнение (чуть ближе к камере, z = -0.01).
    this.positions = new Float32Array([
      -bw / 2, -bh / 2, 0, bw / 2, -bh / 2, 0, bw / 2, bh / 2, 0, -bw / 2, bh / 2, 0,
      -width / 2, -fillHeight / 2, -0.01, width / 2, -fillHeight / 2, -0.01,
      width / 2, fillHeight / 2, -0.01, -width / 2, fillHeight / 2, -0.01,
    ]);
    this.colors = new Float32Array(8 * 4);
    for (let i = 0; i < 4; i++) this.colors.set(BG_RGBA, i * 4);
    const mesh = new Mesh("hpBar", scene);
    mesh.setVerticesData("position", this.positions, true);
    mesh.setVerticesData("color", this.colors, true, 4);
    mesh.setVerticesData("normal", new Float32Array(8 * 3).map((_, i) => (i % 3 === 2 ? -1 : 0)), false);
    mesh.setIndices([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    mesh.hasVertexAlpha = true;
    mesh.material = barMaterial(scene);
    mesh.parent = parent;
    mesh.position.copyFrom(offset);
    mesh.isPickable = false;
    if (billboard) {
      // Только вокруг вертикали — полоска не заваливается вместе с обзором.
      mesh.billboardMode = Mesh.BILLBOARDMODE_Y;
    }
    this.mesh = mesh;
    this.set(1);
  }

  set(frac: number): void {
    const f = clamp01(frac);
    // Пишем в буферы только при заметном изменении (шаг 1/64).
    const q = Math.round(f * 64);
    if (q === this.lastQ) return;
    this.lastQ = q;
    const w = this.width;
    const x1 = -w / 2 + w * Math.max(0.001, f);
    this.positions[15] = x1; // x правого нижнего угла заполнения (вершина 5)
    this.positions[18] = x1; // x правого верхнего угла (вершина 6)
    let r: number;
    let g: number;
    let b: number;
    if (this.hue === "mana") {
      [r, g, b] = [0.2, 0.42, 0.95];
    } else {
      r = f > 0.5 ? 0.25 : 0.85;
      g = f > 0.25 ? 0.75 : 0.2;
      b = f > 0.5 ? 0.3 : 0.15;
    }
    for (let i = 4; i < 8; i++) this.colors.set([r, g, b, 1], i * 4);
    this.mesh.updateVerticesData("position", this.positions);
    this.mesh.updateVerticesData("color", this.colors);
  }

  /** Переставить полоску (её положение правится в панели настройки). */
  moveTo(x: number, y: number, z: number): void {
    this.mesh.position.set(x, y, z);
  }

  setVisible(v: boolean): void {
    this.setOpacity(v ? 1 : 0);
  }

  /** 0..1 — плавное появление/исчезновение. */
  setOpacity(a: number): void {
    // Ступенями по 1/8, через mesh.visibility (материал общий — его alpha трогать нельзя).
    const q = Math.round(clamp01(a) * 8) / 8;
    if (q === this.opacity) return;
    this.opacity = q;
    this.mesh.visibility = q;
    this.mesh.setEnabled(q > 0.02);
  }

  dispose(): void {
    // Материал общий на сцену — не трогаем.
    this.mesh.dispose();
  }
}
