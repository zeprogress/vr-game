import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
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
  m.backFaceCulling = false;
  barMats.set(scene, m);
  return m;
}

/**
 * Полоски над мобами — ВСЕ в одном меше на сцену (одна отрисовка вместо меша на моба).
 * Вершины пишутся в мировых координатах раз за кадр: разворот к камере вокруг вертикали считаем здесь же.
 */
const MAX_BARS = 96;
class BarBatch {
  private readonly mesh: Mesh;
  private readonly pos = new Float32Array(MAX_BARS * 8 * 3);
  private readonly col = new Float32Array(MAX_BARS * 8 * 4);
  readonly bars: HealthBar3D[] = [];
  private lastN = 0;
  private readonly v = new Vector3();

  constructor(private readonly scene: Scene) {
    const mesh = new Mesh("hpBars", scene);
    const idx: number[] = [];
    for (let i = 0; i < MAX_BARS * 2; i++) idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    const vd = new VertexData();
    vd.positions = this.pos;
    vd.colors = this.col;
    vd.indices = idx;
    vd.normals = new Float32Array(MAX_BARS * 8 * 3).map((_, i) => (i % 3 === 2 ? -1 : 0));
    vd.applyToMesh(mesh, true);
    mesh.hasVertexAlpha = true;
    mesh.material = barMaterial(scene);
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.setEnabled(false);
    this.mesh = mesh;
    scene.onBeforeRenderObservable.add(() => this.flush());
  }

  private flush(): void {
    const cam = this.scene.activeCamera;
    let n = 0;
    if (cam) {
      const cp = cam.globalPosition;
      for (const b of this.bars) {
        if (n >= MAX_BARS) break;
        if (b.opacity <= 0.02) continue;
        b.writeQuads(this.pos, this.col, n * 8, cp, this.v);
        n++;
      }
    }
    if (n === 0 && this.lastN === 0) return;
    // Хвост, освободившийся с прошлого кадра, — в нулевую площадь.
    for (let i = n * 8; i < this.lastN * 8; i++) {
      this.pos[i * 3] = this.pos[i * 3 + 1] = this.pos[i * 3 + 2] = 0;
    }
    this.lastN = n;
    this.mesh.setEnabled(n > 0);
    this.mesh.updateVerticesData("position", this.pos);
    this.mesh.updateVerticesData("color", this.col);
  }
}
const barBatches = new WeakMap<Scene, BarBatch>();
function batchOf(scene: Scene): BarBatch {
  let b = barBatches.get(scene);
  if (!b || scene.isDisposed) {
    b = new BarBatch(scene);
    barBatches.set(scene, b);
  }
  return b;
}

const BG_RGBA = [0.04, 0.04, 0.04, 0.6];

export class HealthBar3D {
  /** Фон и заполнение — ОДИН меш (два квада, цвета в вершинах): раньше два меша и два материала на моба. */
  private readonly mesh: Mesh | null;
  private opacityV = 1;
  /** Точка привязки — в системе координат родителя (только для полосок в общем меше). */
  private readonly offset: Vector3;
  private readonly parent: Node;
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
    this.parent = parent;
    this.offset = offset.clone();
    if (billboard) {
      // Мобы: отдельного меша нет — полоска пишется в общий (BarBatch), разворот к камере считается там.
      this.mesh = null;
      batchOf(scene).bars.push(this);
    } else {
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
      this.mesh = mesh;
    }
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
    if (this.mesh) {
      this.mesh.updateVerticesData("position", this.positions);
      this.mesh.updateVerticesData("color", this.colors);
    }
  }

  get opacity(): number {
    return this.opacityV;
  }

  /** Записать 8 вершин в мировых координатах в общий буфер (слот `at` — номер вершины). */
  writeQuads(pos: Float32Array, col: Float32Array, at: number, cam: Vector3, tmp: Vector3): void {
    const wm = this.parent.computeWorldMatrix();
    Vector3.TransformCoordinatesToRef(this.offset, wm, tmp);
    const cx = tmp.x;
    const cy = tmp.y;
    const cz = tmp.z;
    // К камере — только по горизонтали (разворот вокруг вертикали).
    let tx = cam.x - cx;
    let tz = cam.z - cz;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    // right = toCam × up
    const rx = -tz;
    const rz = tx;
    for (let i = 0; i < 8; i++) {
      const x = this.positions[i * 3];
      const y = this.positions[i * 3 + 1];
      const z = -this.positions[i * 3 + 2];
      const o = (at + i) * 3;
      pos[o] = cx + rx * x + tx * z;
      pos[o + 1] = cy + y;
      pos[o + 2] = cz + rz * x + tz * z;
      const c = (at + i) * 4;
      col[c] = this.colors[i * 4];
      col[c + 1] = this.colors[i * 4 + 1];
      col[c + 2] = this.colors[i * 4 + 2];
      col[c + 3] = this.colors[i * 4 + 3] * this.opacityV;
    }
  }

  /** Переставить полоску (её положение правится в панели настройки). */
  moveTo(x: number, y: number, z: number): void {
    this.offset.set(x, y, z);
    this.mesh?.position.set(x, y, z);
  }

  setVisible(v: boolean): void {
    this.setOpacity(v ? 1 : 0);
  }

  /** 0..1 — плавное появление/исчезновение. */
  setOpacity(a: number): void {
    // Ступенями по 1/8, через mesh.visibility (материал общий — его alpha трогать нельзя).
    const q = Math.round(clamp01(a) * 8) / 8;
    if (q === this.opacityV) return;
    this.opacityV = q;
    if (this.mesh) {
      this.mesh.visibility = q;
      this.mesh.setEnabled(q > 0.02);
    }
  }

  dispose(): void {
    // Материал общий на сцену — не трогаем.
    if (this.mesh) this.mesh.dispose();
    else {
      const list = batchOf(this.parent.getScene()).bars;
      const i = list.indexOf(this);
      if (i >= 0) list.splice(i, 1);
    }
  }
}
