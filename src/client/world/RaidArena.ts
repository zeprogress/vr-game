import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import "@babylonjs/core/Meshes/Builders/discBuilder";
import "@babylonjs/core/Meshes/Builders/torusBuilder";
import "@babylonjs/core/Meshes/Builders/tubeBuilder";
import "@babylonjs/core/Meshes/Builders/polyhedronBuilder";
import { angDiff, RAID, RAID_FIGHT, RAID_ORBITS } from "#shared/raid";
import { terrainHeight } from "#shared/terrain";
import { FX_RGB } from "#shared/look";

/** Бой с рейд-боссом для визуала — поля ZoneState raid* (см. server/rooms/raidFight.ts). */
export interface RaidView {
  /** 0 — боя нет, 1..4 — фаза. */
  ph: number;
  ang: number;
  edge: number;
  /** Полуширина разрыва, рад. */
  gap: number;
  on: number;
  o: readonly number[];
  vert: number;
  tide: number;
}

/** Поля состояния комнаты → RaidView. */
export function raidViewOf(st: {
  raidPh: number;
  raidAng: number;
  raidEdge: number;
  raidGap: number;
  raidOn: number;
  raidO0: number;
  raidO1: number;
  raidO2: number;
  raidVert: number;
  raidTide: number;
}): RaidView {
  return {
    ph: st.raidPh,
    ang: st.raidAng,
    edge: st.raidEdge || RAID.r,
    gap: st.raidGap,
    on: st.raidOn,
    o: [st.raidO0, st.raidO1, st.raidO2],
    vert: st.raidVert,
    tide: st.raidTide,
  };
}

const SHARDS = 28;
const c3 = (k: keyof typeof FX_RGB): Color3 => new Color3(...FX_RGB[k]);

interface Orbit {
  node: TransformNode;
  tilt: TransformNode;
  shards: InstancedMesh[];
  /** Локальный угол каждого осколка (разрыв — у угла 0). */
  angles: number[];
  ring: Mesh | null;
  /** Разрыв на полу: заливка, светящиеся границы и световые «шторки» по краям конуса. */
  wedge: Mesh[];
  wedgeNode: TransformNode;
}

/**
 * Арена рейд-босса «Лунный аватар» на плато: лунный пол (вращается вместе с ареной), светящийся
 * край и пустота за ним (край сужается по фазам), орбиты-кольца из кристаллов с разрывом и
 * подсвеченные разрывы на полу (бить босса можно только оттуда), пульс перед «Приливом» и волна.
 * Общий для игры и спектатора; углы — из состояния комнаты (сервер авторитетен).
 */
export class RaidArenaFx {
  private readonly root: TransformNode;
  private readonly spin: TransformNode;
  private readonly floorMat: StandardMaterial;
  private readonly voidMat: StandardMaterial;
  private readonly edgeMat: StandardMaterial;
  private readonly lineMat: StandardMaterial;
  private readonly wedgeMat: StandardMaterial;
  private readonly borderMat: StandardMaterial;
  private readonly curtainMat: StandardMaterial;
  private readonly tideMat: StandardMaterial;
  private readonly orbits: Orbit[] = [];
  private edgeRing: Mesh | null = null;
  private voidRing: Mesh | null = null;
  private readonly tideRing: Mesh;
  private builtEdge = -1;
  private builtGap = -1;
  private tideT = -1;
  private t = 0;
  private idleSpin = 0;

  constructor(private readonly scene: Scene) {
    const gy = terrainHeight(RAID.x, RAID.z);
    this.root = new TransformNode("raidArena", scene);
    this.root.position.set(RAID.x, gy, RAID.z);
    this.spin = new TransformNode("raidArenaSpin", scene);
    this.spin.parent = this.root;

    // Пол: лунный камень с кольцами орбит и лучами — вращается вместе с ареной.
    this.floorMat = new StandardMaterial("raidFloorMat", scene);
    const tex = new DynamicTexture("raidFloorTex", { width: 1024, height: 1024 }, scene, true);
    this.paintFloor(tex);
    this.floorMat.diffuseTexture = tex;
    this.floorMat.emissiveTexture = tex;
    this.floorMat.emissiveColor = new Color3(0.55, 0.58, 0.68);
    this.floorMat.specularColor = new Color3(0, 0, 0);
    this.floorMat.maxSimultaneousLights = 1;
    this.floorMat.zOffset = -2;
    const floor = MeshBuilder.CreateDisc("raidFloor", { radius: RAID.r, tessellation: 96 }, scene);
    floor.rotation.x = Math.PI / 2;
    floor.position.y = 0.06;
    floor.parent = this.spin;
    floor.material = this.floorMat;
    floor.isPickable = false;

    this.voidMat = new StandardMaterial("raidVoidMat", scene);
    this.voidMat.diffuseColor = new Color3(0, 0, 0);
    this.voidMat.specularColor = new Color3(0, 0, 0);
    this.voidMat.emissiveColor = new Color3(0.03, 0.02, 0.08);
    this.voidMat.disableLighting = true;
    this.voidMat.backFaceCulling = false;
    this.voidMat.zOffset = -3;

    this.edgeMat = new StandardMaterial("raidEdgeMat", scene);
    this.edgeMat.disableLighting = true;
    this.edgeMat.emissiveColor = c3("moon");

    this.lineMat = new StandardMaterial("raidOrbitLineMat", scene);
    this.lineMat.disableLighting = true;
    this.lineMat.emissiveColor = c3("moonGold");

    this.wedgeMat = new StandardMaterial("raidWedgeMat", scene);
    this.wedgeMat.disableLighting = true;
    this.wedgeMat.emissiveColor = c3("moonGold");
    this.wedgeMat.alpha = 0.4;
    this.wedgeMat.backFaceCulling = false;
    this.wedgeMat.zOffset = -4;
    // Границы конуса — яркие золотые нити; «шторки» — полупрозрачные световые стенки над ними.
    this.borderMat = new StandardMaterial("raidWedgeBorderMat", scene);
    this.borderMat.disableLighting = true;
    this.borderMat.emissiveColor = c3("moonGold");
    this.curtainMat = new StandardMaterial("raidWedgeCurtainMat", scene);
    this.curtainMat.disableLighting = true;
    this.curtainMat.emissiveColor = c3("moonGold");
    this.curtainMat.alpha = 0.22;
    this.curtainMat.backFaceCulling = false;
    this.curtainMat.disableDepthWrite = true;

    // Осколки орбит — инстансы одного кристалла.
    const crystalMat = new StandardMaterial("raidCrystalMat", scene);
    crystalMat.diffuseColor = c3("moon");
    crystalMat.emissiveColor = c3("moon").scale(0.55);
    crystalMat.specularColor = new Color3(0.6, 0.6, 0.7);
    const crystal = MeshBuilder.CreatePolyhedron("raidCrystal", { type: 1, size: 1 }, scene);
    crystal.material = crystalMat;
    crystal.isPickable = false;
    crystal.setEnabled(false);
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 3; i++) {
      const node = new TransformNode(`raidOrbit${i}`, scene);
      node.parent = this.root;
      node.position.y = RAID_ORBITS.y + i * 0.6;
      const tilt = new TransformNode(`raidOrbitTilt${i}`, scene);
      tilt.parent = node;
      const R = RAID_ORBITS.r[i];
      const shards: InstancedMesh[] = [];
      const angles: number[] = [];
      for (let k = 0; k < SHARDS; k++) {
        const a = ((k + 0.5) / SHARDS) * Math.PI * 2;
        const inst = crystal.createInstance(`raidShard${i}_${k}`);
        inst.parent = tilt;
        const s = 0.35 + rnd() * 0.45;
        inst.scaling.set(s * 0.7, s * 1.6, s * 0.7);
        inst.position.set(Math.sin(a) * R, (rnd() - 0.5) * 0.8, Math.cos(a) * R);
        inst.rotation.set(rnd() * 0.6, rnd() * Math.PI, rnd() * 0.6);
        inst.isPickable = false;
        shards.push(inst);
        angles.push(a);
      }
      const wedgeNode = new TransformNode(`raidWedge${i}`, scene);
      wedgeNode.parent = this.root;
      this.orbits.push({ node, tilt, shards, angles, ring: null, wedge: [], wedgeNode });
    }

    this.tideMat = new StandardMaterial("raidTideMat", scene);
    this.tideMat.disableLighting = true;
    this.tideMat.emissiveColor = c3("moon");
    this.tideMat.alpha = 0;
    this.tideRing = MeshBuilder.CreateTorus("raidTide", { diameter: 2, thickness: 0.18, tessellation: 64 }, scene);
    this.tideRing.parent = this.root;
    this.tideRing.position.y = 1.2;
    this.tideRing.material = this.tideMat;
    this.tideRing.isPickable = false;
    this.tideRing.setEnabled(false);

    this.rebuild(RAID.r, 0);
  }

  /** Волна «Прилива» от центра арены. */
  tide(): void {
    this.tideT = 0;
    this.tideRing.setEnabled(true);
  }

  update(dt: number, v: RaidView | null): void {
    this.t += dt;
    const ph = v?.ph ?? 0;
    const edge = ph > 0 && v ? v.edge : RAID.r;
    const gap = ph > 0 && v ? v.gap : 0.5;
    if (Math.abs(edge - this.builtEdge) > 0.05 || Math.abs(gap - this.builtGap) > 1e-3) this.rebuild(edge, gap);

    // Пол крутится с ареной; вне боя — едва заметно сам.
    if (ph > 0 && v) this.spin.rotation.y = v.ang;
    else this.spin.rotation.y += dt * 0.02;

    this.idleSpin += dt * 0.15;
    const n = ph > 0 && v ? v.on : 1;
    for (let i = 0; i < 3; i++) {
      const o = this.orbits[i];
      const on = i < n;
      o.node.setEnabled(on);
      o.wedgeNode.setEnabled(on && ph > 0);
      if (!on) continue;
      const a = ph > 0 && v ? v.o[i] : this.idleSpin;
      o.node.rotation.y = a;
      o.wedgeNode.rotation.y = a;
      // Орбита «на ребре» (фаза 3) — кольцо стоит почти вертикально.
      o.tilt.rotation.z = ph > 0 && v && v.vert === i ? 1.25 : 0;
      for (const s of o.shards) s.rotation.y += dt * 0.6;
    }

    // Перед «Приливом» пол и разрывы пульсируют всё чаще.
    const warn = ph > 0 && v && v.tide > 0 && v.tide <= RAID_FIGHT.tide.warn;
    const pulse = warn ? 0.5 + 0.5 * Math.sin(this.t * (10 - v.tide * 1.5)) : 0;
    this.floorMat.emissiveColor.set(0.55 + pulse * 0.4, 0.58 + pulse * 0.35, 0.68 + pulse * 0.3);
    this.wedgeMat.alpha = 0.38 + 0.08 * Math.sin(this.t * 2.2) + pulse * 0.4;
    this.curtainMat.alpha = 0.2 + 0.05 * Math.sin(this.t * 2.2) + pulse * 0.35;
    const glow = 1 + pulse * 0.6;
    const g0 = FX_RGB.moonGold;
    this.borderMat.emissiveColor.set(g0[0] * glow, g0[1] * glow, g0[2] * glow);

    if (this.tideT >= 0) {
      this.tideT += dt;
      const k = Math.min(1, this.tideT / 0.9);
      const r = 1 + k * (RAID.r - 1);
      this.tideRing.scaling.set(r, 1, r);
      this.tideMat.alpha = 0.9 * (1 - k);
      if (k >= 1) {
        this.tideT = -1;
        this.tideRing.setEnabled(false);
      }
    }
  }

  /** Край арены, пустота за ним, нити орбит и разрывы на полу — под текущие край и ширину разрыва. */
  private rebuild(edge: number, gap: number): void {
    this.builtEdge = edge;
    this.builtGap = gap;
    this.edgeRing?.dispose();
    this.edgeRing = MeshBuilder.CreateTorus("raidEdge", { diameter: edge * 2, thickness: 0.22, tessellation: 96 }, this.scene);
    this.edgeRing.parent = this.root;
    this.edgeRing.position.y = 0.15;
    this.edgeRing.material = this.edgeMat;
    this.edgeRing.isPickable = false;

    this.voidRing?.dispose();
    this.voidRing = annulus(this.scene, "raidVoid", edge, RAID.r + 2.5, 96);
    this.voidRing.parent = this.root;
    this.voidRing.position.y = 0.09;
    this.voidRing.material = this.voidMat;
    this.voidRing.isPickable = false;

    for (let i = 0; i < 3; i++) {
      const o = this.orbits[i];
      const R = RAID_ORBITS.r[i];
      o.ring?.dispose();
      const path: Vector3[] = [];
      const steps = 72;
      const a0 = gap;
      const a1 = Math.PI * 2 - gap;
      for (let k = 0; k <= steps; k++) {
        const a = a0 + ((a1 - a0) * k) / steps;
        path.push(new Vector3(Math.sin(a) * R, 0, Math.cos(a) * R));
      }
      o.ring = MeshBuilder.CreateTube(`raidOrbitLine${i}`, { path, radius: 0.045, tessellation: 5 }, this.scene);
      o.ring.parent = o.tilt;
      o.ring.material = this.lineMat;
      o.ring.isPickable = false;
      for (let k = 0; k < SHARDS; k++) o.shards[k].isVisible = Math.abs(angDiff(o.angles[k], 0)) > gap;

      for (const m of o.wedge) m.dispose();
      o.wedge = [];
      if (gap > 0) {
        const r0 = 5.5;
        const fill = wedgeMesh(this.scene, `raidGapFloor${i}`, r0, edge, gap);
        fill.position.y = 0.12;
        fill.material = this.wedgeMat;
        o.wedge.push(fill);
        // Границы: два луча по краям конуса и дуга у края арены.
        for (const sgn of [-1, 1]) {
          const a = sgn * gap;
          const path = [new Vector3(Math.sin(a) * r0, 0.16, Math.cos(a) * r0), new Vector3(Math.sin(a) * edge, 0.16, Math.cos(a) * edge)];
          const line = MeshBuilder.CreateTube(`raidGapEdge${i}${sgn}`, { path, radius: 0.09, tessellation: 5 }, this.scene);
          line.material = this.borderMat;
          o.wedge.push(line);
          const cur = curtainMesh(this.scene, `raidGapCurtain${i}${sgn}`, r0, edge, a, 3.5);
          cur.material = this.curtainMat;
          o.wedge.push(cur);
        }
        const arc: Vector3[] = [];
        for (let k = 0; k <= 16; k++) {
          const a = -gap + (2 * gap * k) / 16;
          arc.push(new Vector3(Math.sin(a) * edge, 0.16, Math.cos(a) * edge));
        }
        const arcLine = MeshBuilder.CreateTube(`raidGapArc${i}`, { path: arc, radius: 0.09, tessellation: 5 }, this.scene);
        arcLine.material = this.borderMat;
        o.wedge.push(arcLine);
        for (const m of o.wedge) {
          m.parent = o.wedgeNode;
          m.isPickable = false;
        }
      }
    }
  }

  private paintFloor(tex: DynamicTexture): void {
    const g = tex.getContext() as CanvasRenderingContext2D;
    const S = 1024;
    const c = S / 2;
    const grad = g.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0, "#e9edf7");
    grad.addColorStop(0.55, "#b9c2d8");
    grad.addColorStop(1, "#7d86a3");
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
    // Лунные «кратеры» — мягкие пятна.
    let seed = 11;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 70; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const r = 8 + rnd() * 46;
      g.fillStyle = `rgba(90,98,128,${0.08 + rnd() * 0.12})`;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    // Кольца орбит и лучи — золотые нити.
    g.strokeStyle = "rgba(255,226,160,0.75)";
    for (const R of RAID_ORBITS.r) {
      g.lineWidth = 3;
      g.beginPath();
      g.arc(c, c, (R / RAID.r) * c, 0, Math.PI * 2);
      g.stroke();
    }
    g.lineWidth = 2;
    g.strokeStyle = "rgba(255,226,160,0.35)";
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * c * 0.2, c + Math.sin(a) * c * 0.2);
      g.lineTo(c + Math.cos(a) * c * 0.98, c + Math.sin(a) * c * 0.98);
      g.stroke();
    }
    tex.update();
  }
}

/** Плоское кольцо r0..r1 (XZ), вверх. */
function annulus(scene: Scene, name: string, r0: number, r1: number, seg: number): Mesh {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k <= seg; k++) {
    const a = (k / seg) * Math.PI * 2;
    pos.push(Math.sin(a) * r0, 0, Math.cos(a) * r0, Math.sin(a) * r1, 0, Math.cos(a) * r1);
    if (k < seg) {
      const b = k * 2;
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
  }
  return fromData(scene, name, pos, idx);
}

/** Сектор пола (разрыв орбиты): от r0 до r1, углы −h..h вокруг локального +Z. */
function wedgeMesh(scene: Scene, name: string, r0: number, r1: number, h: number): Mesh {
  const pos: number[] = [];
  const idx: number[] = [];
  const seg = Math.max(4, Math.round((h * 2) / 0.06));
  for (let k = 0; k <= seg; k++) {
    const a = -h + (2 * h * k) / seg;
    pos.push(Math.sin(a) * r0, 0, Math.cos(a) * r0, Math.sin(a) * r1, 0, Math.cos(a) * r1);
    if (k < seg) {
      const b = k * 2;
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
  }
  return fromData(scene, name, pos, idx);
}

/** Вертикальная световая стенка вдоль луча угла a (r0..r1), высотой h. */
function curtainMesh(scene: Scene, name: string, r0: number, r1: number, a: number, h: number): Mesh {
  const sx = Math.sin(a);
  const cz = Math.cos(a);
  const pos = [sx * r0, 0, cz * r0, sx * r1, 0, cz * r1, sx * r0, h, cz * r0, sx * r1, h, cz * r1];
  return fromData(scene, name, pos, [0, 1, 2, 1, 3, 2]);
}

function fromData(scene: Scene, name: string, pos: number[], idx: number[]): Mesh {
  const m = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = pos;
  vd.indices = idx;
  const nrm: number[] = [];
  VertexData.ComputeNormals(pos, idx, nrm);
  vd.normals = nrm;
  vd.applyToMesh(m);
  return m;
}
