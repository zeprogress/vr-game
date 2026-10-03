import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Constants } from "@babylonjs/core/Engines/constants";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/Builders/discBuilder";
import "@babylonjs/core/Meshes/Builders/torusBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import "@babylonjs/core/Meshes/Builders/polyhedronBuilder";

import {
  CAT_CEIL,
  CAT_CORRIDOR_HALF,
  CAT_FLOOR_Y,
  CAT_HALLS,
  CAT_PHASE,
  CAT_PORTAL,
  catCorridor,
  inCatRegion,
} from "#shared/catacombs";
import { terrainHeight } from "#shared/terrain";
import { makeFireMaterial } from "./FireShader";

/** Что о катакомбах знает клиент (из RoomState). */
export interface CatView {
  phase: number;
  lo: number;
  hi: number;
  left: number;
  party: number;
  final: boolean;
}

/** Каменная плитка: тёмные плиты с швами (процедурно, без файлов). */
function stoneTexture(scene: Scene, name: string, base: [number, number, number], tiles: number): DynamicTexture {
  const S = 256;
  const tex = new DynamicTexture(name, { width: S, height: S }, scene, true);
  const g = tex.getContext() as unknown as CanvasRenderingContext2D;
  const c = (k: number): string => `rgb(${Math.round(base[0] * k)},${Math.round(base[1] * k)},${Math.round(base[2] * k)})`;
  g.fillStyle = c(0.55);
  g.fillRect(0, 0, S, S);
  const n = tiles;
  const step = S / n;
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < n; y++) {
    const off = y % 2 ? step / 2 : 0;
    for (let x = -1; x < n; x++) {
      g.fillStyle = c(0.8 + rnd() * 0.45);
      g.fillRect(x * step + off + 2, y * step + 2, step - 4, step - 4);
      // трещинки и пятна
      g.fillStyle = c(0.5 + rnd() * 0.2);
      for (let k = 0; k < 3; k++) g.fillRect(x * step + off + rnd() * step, y * step + rnd() * step, 2 + rnd() * 6, 1 + rnd() * 3);
    }
  }
  tex.update();
  tex.wrapU = 1;
  tex.wrapV = 1;
  return tex;
}

/** Радиальное свечение (ореол факела/портала). */
function glowTexture(scene: Scene): DynamicTexture {
  const tex = new DynamicTexture("catGlow", { width: 128, height: 128 }, scene, false);
  const g = tex.getContext() as unknown as CanvasRenderingContext2D;
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.35, "rgba(255,255,255,0.45)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  tex.update();
  tex.hasAlpha = true;
  return tex;
}

/**
 * Катакомбы на клиенте: цепочка подземных залов (пол, стены с проёмами,
 * своды, колонны, факелы, руны, решётки, алтарь) и портал сбора в лагере.
 * Строится лениво — при первом сборе/забеге или когда камера рядом; свет
 * залов включается, только когда камера внутри (на поляне — ни одного
 * лишнего источника, бюджет Quest).
 */
export class CatacombsFx {
  private built = false;
  private root: TransformNode | null = null;
  private readonly lights: PointLight[] = [];
  private readonly fireMats: ShaderMaterial[] = [];
  private readonly gates: { mesh: Mesh; i: number; y: number }[] = [];
  private runeMat: StandardMaterial | null = null;
  private crystal: Mesh | null = null;
  private crystalMat: StandardMaterial | null = null;
  private beam: Mesh | null = null;
  private time = 0;
  // портал в лагере
  private portal: TransformNode | null = null;
  private portalMat: StandardMaterial | null = null;
  private portalLabel: DynamicTexture | null = null;
  private portalSig = "";

  constructor(private readonly scene: Scene) {}

  /** Камера внутри подземелья (для музыки/света снаружи). */
  static inside(x: number, z: number): boolean {
    return inCatRegion(x, z);
  }

  update(dt: number, v: CatView | null, cam: { x: number; z: number }): void {
    this.time += dt;
    const inside = inCatRegion(cam.x, cam.z);
    const active = !!v && v.phase >= CAT_PHASE.run;
    if (!this.built && (inside || active)) this.build();
    if (this.root) this.root.setEnabled(inside || active);
    if (this.built) {
      const lit = inside;
      for (const l of this.lights) if (l.isEnabled() !== lit) l.setEnabled(lit);
      if (lit || active) this.animate(dt, v);
    }
    this.updatePortal(dt, v);
  }

  private animate(dt: number, v: CatView | null): void {
    const t = this.time;
    for (const m of this.fireMats) m.setFloat("uTime", t);
    // Решётки: открыт путь lo..hi — коридоры с lo по hi−1 подняты.
    const lo = v?.lo ?? 0;
    const hi = v?.hi ?? 0;
    for (const g of this.gates) {
      const open = g.i >= lo && g.i < hi;
      const want = open ? CAT_CEIL - 0.4 : g.y;
      const y = g.mesh.position.y;
      g.mesh.position.y = y + (want - y) * Math.min(1, dt * (open ? 0.9 : 3));
    }
    if (this.runeMat) {
      const k = 0.55 + 0.45 * Math.sin(t * 1.7);
      const fin = v?.final ? 1.6 : 1;
      this.runeMat.emissiveColor.set(0.35 * k * fin, 0.08 * k, 0.6 * k * fin);
    }
    if (this.crystal && this.crystalMat) {
      this.crystal.rotation.y += dt * (v?.final ? 2.2 : 0.6);
      this.crystal.position.y = CAT_FLOOR_Y + 2.6 + Math.sin(t * 1.3) * 0.15;
      const k = v?.final ? 1 : 0.5 + 0.2 * Math.sin(t * 2);
      this.crystalMat.emissiveColor.set(0.7 * k, 0.2 * k, 1 * k);
    }
    if (this.beam) {
      this.beam.setEnabled(!!v?.final);
      this.beam.scaling.x = this.beam.scaling.z = 1 + 0.15 * Math.sin(t * 6);
    }
    for (let i = 0; i < this.lights.length; i++) {
      this.lights[i].intensity = 1.25 + 0.18 * Math.sin(t * 9 + i * 1.7) + 0.08 * Math.sin(t * 23 + i);
    }
  }

  private build(): void {
    this.built = true;
    const scene = this.scene;
    const root = new TransformNode("catacombs", scene);
    this.root = root;
    const floorTex = stoneTexture(scene, "catFloorTex", [120, 112, 104], 6);
    const wallTex = stoneTexture(scene, "catWallTex", [96, 90, 86], 5);
    const mat = (name: string, tex: DynamicTexture | null, dif: [number, number, number], emi: [number, number, number], u = 1, vv = 1): StandardMaterial => {
      const m = new StandardMaterial(name, scene);
      if (tex) {
        const t = tex.clone();
        t.uScale = u;
        t.vScale = vv;
        m.diffuseTexture = t;
      }
      m.diffuseColor = new Color3(...dif);
      m.emissiveColor = new Color3(...emi);
      m.specularColor = new Color3(0.04, 0.04, 0.04);
      return m;
    };
    const floorMat = mat("catFloor", floorTex, [0.75, 0.72, 0.7], [0.05, 0.045, 0.05], 6, 6);
    const wallMat = mat("catWall", wallTex, [0.6, 0.57, 0.55], [0.04, 0.035, 0.04], 10, 2);
    const ceilMat = mat("catCeil", wallTex, [0.25, 0.23, 0.24], [0.015, 0.012, 0.018], 6, 6);
    const pillarMat = mat("catPillar", wallTex, [0.7, 0.66, 0.62], [0.05, 0.04, 0.04], 1, 3);
    const ironMat = mat("catIron", null, [0.12, 0.11, 0.1], [0.02, 0.015, 0.012]);
    const runeMat = new StandardMaterial("catRune", scene);
    runeMat.diffuseColor = new Color3(0, 0, 0);
    runeMat.emissiveColor = new Color3(0.35, 0.08, 0.6);
    runeMat.disableLighting = true;
    runeMat.alpha = 0.85;
    this.runeMat = runeMat;

    const walls: Mesh[] = [];
    const pillars: Mesh[] = [];
    const floors: Mesh[] = [];
    const ceils: Mesh[] = [];
    const irons: Mesh[] = [];
    const H = CAT_CEIL;
    const y0 = CAT_FLOOR_Y;

    const torchAt = (x: number, z: number, faceX: number, faceZ: number): void => {
      // Кронштейн + чаша.
      const b = MeshBuilder.CreateBox("catSconce", { width: 0.25, height: 0.5, depth: 0.25 }, scene);
      b.position.set(x, y0 + 3, z);
      irons.push(b);
      const fl = new TransformNode("catTorch", scene);
      fl.parent = root;
      fl.position.set(x + faceX * 0.15, y0 + 3.35, z + faceZ * 0.15);
      for (let i = 0; i < 2; i++) {
        const pl = MeshBuilder.CreatePlane("catFlame", { width: 0.55, height: 0.9 }, scene);
        pl.rotation.y = i * Math.PI * 0.5;
        pl.position.y = 0.3;
        const fm = makeFireMaterial(scene, `catFire${this.fireMats.length}`, false);
        this.fireMats.push(fm);
        pl.material = fm;
        pl.parent = fl;
        pl.isPickable = false;
      }
    };

    CAT_HALLS.forEach((h, hi) => {
      // Пол и свод.
      const f = MeshBuilder.CreateDisc("catHallFloor", { radius: h.r + 0.6, tessellation: 56 }, scene);
      f.rotation.x = Math.PI / 2;
      f.position.set(h.x, y0 + 0.02, h.z);
      floors.push(f);
      const c = MeshBuilder.CreateDisc("catHallCeil", { radius: h.r + 1, tessellation: 40 }, scene);
      c.rotation.x = -Math.PI / 2;
      c.position.set(h.x, y0 + H, h.z);
      ceils.push(c);
      // Стена — кольцо блоков, с проёмами под коридоры (юг — вход, север — выход).
      const segs = 40;
      for (let i = 0; i < segs; i++) {
        const a = (i + 0.5) / segs * Math.PI * 2;
        const sx = Math.sin(a);
        const sz = Math.cos(a);
        const wx = h.x + sx * (h.r + 0.6);
        const wz = h.z + sz * (h.r + 0.6);
        const gapN = hi < CAT_HALLS.length - 1 && Math.abs(wx - h.x) < CAT_CORRIDOR_HALF + 0.3 && sz > 0;
        const gapS = hi > 0 && Math.abs(wx - h.x) < CAT_CORRIDOR_HALF + 0.3 && sz < 0;
        if (gapN || gapS) continue;
        const w = MeshBuilder.CreateBox("catWallSeg", { width: ((h.r + 0.6) * Math.PI * 2) / segs + 0.3, height: H, depth: 1.2 }, scene);
        w.position.set(wx, y0 + H / 2, wz);
        w.rotation.y = a;
        walls.push(w);
      }
      // Колонны по кругу.
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        const pr = h.r - 2.6;
        const col = MeshBuilder.CreateCylinder("catPillar", { height: H, diameter: 1.2, tessellation: 10 }, scene);
        col.position.set(h.x + Math.sin(a) * pr, y0 + H / 2, h.z + Math.cos(a) * pr);
        pillars.push(col);
        const base = MeshBuilder.CreateBox("catPillarBase", { width: 1.6, height: 0.5, depth: 1.6 }, scene);
        base.position.set(col.position.x, y0 + 0.25, col.position.z);
        pillars.push(base);
      }
      // Факелы на стенах.
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.52;
        const sx = Math.sin(a);
        const sz = Math.cos(a);
        torchAt(h.x + sx * (h.r - 0.1), h.z + sz * (h.r - 0.1), -sx, -sz);
      }
      // Кольцо рун на полу.
      const rune = MeshBuilder.CreateTorus("catRune", { diameter: h.r * 1.15, thickness: 0.18, tessellation: 64 }, scene);
      rune.position.set(h.x, y0 + 0.05, h.z);
      rune.scaling.y = 0.05;
      rune.material = runeMat;
      rune.parent = root;
      rune.isPickable = false;
      // Саркофаги у северной стены (оттуда встают стражи).
      if (hi > 0 && hi < CAT_HALLS.length - 1) {
        for (const dx of [-3.2, 3.2]) {
          const s = MeshBuilder.CreateBox("catSarc", { width: 1.3, height: 0.9, depth: 2.6 }, scene);
          s.position.set(h.x + dx, y0 + 0.45, h.z + h.r * 0.62);
          pillars.push(s);
        }
      }
      // Свет зала.
      const L = new PointLight(`catLight${hi}`, new Vector3(h.x, y0 + H - 2, h.z), scene);
      L.diffuse = new Color3(1, 0.6, 0.32);
      L.specular = new Color3(0.1, 0.06, 0.03);
      L.range = h.r * 2.2;
      L.intensity = 1.25;
      L.setEnabled(false);
      this.lights.push(L);
    });

    // Коридоры: пол, стены, свод, решётка на входе.
    for (let i = 0; i < CAT_HALLS.length - 1; i++) {
      const c = catCorridor(i);
      const len = c.z1 - c.z0;
      const cz = (c.z0 + c.z1) / 2;
      const f = MeshBuilder.CreateBox("catCorFloor", { width: CAT_CORRIDOR_HALF * 2 + 0.4, height: 0.1, depth: len }, scene);
      f.position.set(0, y0 - 0.03, cz);
      floors.push(f);
      for (const side of [-1, 1]) {
        const w = MeshBuilder.CreateBox("catCorWall", { width: 1, height: H * 0.7, depth: len }, scene);
        w.position.set(side * (CAT_CORRIDOR_HALF + 0.5), y0 + H * 0.35, cz);
        walls.push(w);
        torchAt(side * (CAT_CORRIDOR_HALF - 0.1), cz, -side, 0);
      }
      const top = MeshBuilder.CreateBox("catCorTop", { width: CAT_CORRIDOR_HALF * 2 + 2, height: 0.6, depth: len }, scene);
      top.position.set(0, y0 + H * 0.7, cz);
      ceils.push(top);
      // Решётка — на выходе из зала i (поднимается, когда путь открыт).
      const bars: Mesh[] = [];
      for (let b = -4; b <= 4; b++) {
        const bar = MeshBuilder.CreateBox("catBar", { width: 0.14, height: H * 0.7, depth: 0.14 }, scene);
        bar.position.set(b * (CAT_CORRIDOR_HALF / 4.2), 0, 0);
        bars.push(bar);
      }
      for (const hy of [-0.25, 0.1, 0.4]) {
        const cross = MeshBuilder.CreateBox("catBarX", { width: CAT_CORRIDOR_HALF * 2, height: 0.16, depth: 0.16 }, scene);
        cross.position.set(0, hy * H * 0.7, 0);
        bars.push(cross);
      }
      const gate = Mesh.MergeMeshes(bars, true, true) as Mesh;
      gate.name = `catGate${i}`;
      gate.material = ironMat;
      const gy = y0 + H * 0.35;
      gate.position.set(0, gy, c.z0 + 2.2);
      gate.parent = root;
      gate.isPickable = false;
      this.gates.push({ mesh: gate, i, y: gy });
    }

    // Алтарь в последнем зале: постамент, кристалл, луч во время битвы с Владыкой.
    const last = CAT_HALLS[CAT_HALLS.length - 1];
    const ped = MeshBuilder.CreateCylinder("catAltar", { height: 1.2, diameterTop: 2.4, diameterBottom: 3.2, tessellation: 8 }, scene);
    ped.position.set(last.x, y0 + 0.6, last.z + last.r * 0.25);
    pillars.push(ped);
    const cm = new StandardMaterial("catCrystal", scene);
    cm.diffuseColor = new Color3(0.2, 0.05, 0.3);
    cm.emissiveColor = new Color3(0.5, 0.15, 0.8);
    cm.alpha = 0.9;
    this.crystalMat = cm;
    const cr = MeshBuilder.CreatePolyhedron("catCrystalMesh", { type: 1, size: 0.7 }, scene);
    cr.scaling.y = 1.8;
    cr.position.set(ped.position.x, y0 + 2.6, ped.position.z);
    cr.material = cm;
    cr.parent = root;
    cr.isPickable = false;
    this.crystal = cr;
    const bm = new StandardMaterial("catBeam", scene);
    bm.diffuseColor = new Color3(0, 0, 0);
    bm.emissiveColor = new Color3(0.6, 0.15, 1);
    bm.disableLighting = true;
    bm.alpha = 0.35;
    bm.alphaMode = Constants.ALPHA_ADD;
    bm.disableDepthWrite = true;
    const beam = MeshBuilder.CreateCylinder("catBeamMesh", { height: H, diameter: 1.6, tessellation: 16 }, scene);
    beam.position.set(ped.position.x, y0 + H / 2, ped.position.z);
    beam.material = bm;
    beam.parent = root;
    beam.isPickable = false;
    beam.setEnabled(false);
    this.beam = beam;

    const merge = (list: Mesh[], name: string, m: StandardMaterial): void => {
      const mm = Mesh.MergeMeshes(list, true, true) as Mesh | null;
      if (!mm) return;
      mm.name = name;
      mm.material = m;
      mm.parent = root;
      mm.isPickable = false;
      mm.freezeWorldMatrix();
    };
    merge(floors, "catFloors", floorMat);
    merge(walls, "catWalls", wallMat);
    merge(ceils, "catCeils", ceilMat);
    merge(pillars, "catPillars", pillarMat);
    merge(irons, "catIrons", ironMat);
    root.setEnabled(false);
  }

  /** Портал сбора в лагере: светящийся круг, столб и табличка «отряд N · m:ss» — только во время сбора. */
  private updatePortal(dt: number, v: CatView | null): void {
    const on = !!v && v.phase === CAT_PHASE.gather;
    if (!on && !this.portal) return;
    if (!this.portal) this.buildPortal();
    const root = this.portal!;
    root.setEnabled(on);
    if (!on) return;
    if (this.portalSpin) this.portalSpin.rotation.y += dt * 0.6;
    if (this.portalMat) {
      const k = 0.7 + 0.3 * Math.sin(this.time * 3);
      this.portalMat.emissiveColor.set(0.55 * k, 0.15 * k, 0.95 * k);
    }
    const left = v!.left;
    const sig = `${v!.party}|${left}`;
    if (sig !== this.portalSig && this.portalLabel) {
      this.portalSig = sig;
      const g = this.portalLabel.getContext() as unknown as CanvasRenderingContext2D;
      g.clearRect(0, 0, 512, 160);
      g.fillStyle = "rgba(20,8,30,0.75)";
      g.fillRect(0, 0, 512, 160);
      g.fillStyle = "#e6c8ff";
      g.font = "bold 46px system-ui, sans-serif";
      g.textAlign = "center";
      g.fillText("☠ КАТАКОМБЫ", 256, 58);
      g.font = "34px system-ui, sans-serif";
      g.fillStyle = "#ffffff";
      g.fillText(`отряд ${v!.party} · спуск ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`, 256, 112);
      g.font = "24px system-ui, sans-serif";
      g.fillStyle = "#bfa9d6";
      g.fillText("встань в круг — войти", 256, 148);
      this.portalLabel.update();
    }
  }

  private buildPortal(): void {
    const scene = this.scene;
    const root = new TransformNode("catPortal", scene);
    const y = terrainHeight(CAT_PORTAL.x, CAT_PORTAL.z);
    root.position.set(CAT_PORTAL.x, y, CAT_PORTAL.z);
    const m = new StandardMaterial("catPortalMat", scene);
    m.diffuseColor = new Color3(0, 0, 0);
    m.emissiveColor = new Color3(0.55, 0.15, 0.95);
    m.disableLighting = true;
    this.portalMat = m;
    const ring = MeshBuilder.CreateTorus("catPortalRing", { diameter: 4.4, thickness: 0.22, tessellation: 48 }, scene);
    ring.position.y = 0.12;
    ring.material = m;
    ring.parent = root;
    const glow = new StandardMaterial("catPortalGlow", scene);
    const gt = glowTexture(scene);
    glow.emissiveTexture = gt;
    glow.opacityTexture = gt;
    glow.emissiveColor = new Color3(0.6, 0.2, 1);
    glow.diffuseColor = new Color3(0, 0, 0);
    glow.disableLighting = true;
    glow.alphaMode = Constants.ALPHA_ADD;
    glow.disableDepthWrite = true;
    const disc = MeshBuilder.CreateDisc("catPortalDisc", { radius: 2.3, tessellation: 40 }, scene);
    disc.rotation.x = Math.PI / 2;
    disc.position.y = 0.06;
    disc.material = glow;
    disc.parent = root;
    const pillar = MeshBuilder.CreateCylinder("catPortalBeam", { height: 7, diameterTop: 0.5, diameterBottom: 3.6, tessellation: 24 }, scene);
    pillar.position.y = 3.5;
    const pm = glow.clone("catPortalBeamMat");
    pm.alpha = 0.35;
    pillar.material = pm;
    pillar.parent = root;
    // Табличка — отдельно от вращения круга.
    const lab = new DynamicTexture("catPortalLabel", { width: 512, height: 160 }, scene, false);
    lab.hasAlpha = true;
    this.portalLabel = lab;
    const lm = new StandardMaterial("catPortalLabelMat", scene);
    lm.diffuseTexture = lab;
    lm.emissiveColor = new Color3(1, 1, 1);
    lm.disableLighting = true;
    lm.useAlphaFromDiffuseTexture = true;
    lm.backFaceCulling = false;
    const plane = MeshBuilder.CreatePlane("catPortalLabelPlane", { width: 3.2, height: 1 }, scene);
    plane.material = lm;
    plane.billboardMode = Mesh.BILLBOARDMODE_Y;
    plane.position.set(CAT_PORTAL.x, y + 3.6, CAT_PORTAL.z);
    const holder = new TransformNode("catPortalHolder", scene);
    plane.parent = holder;
    root.parent = holder;
    root.position.set(CAT_PORTAL.x, y, CAT_PORTAL.z);
    for (const mm of [ring, disc, pillar, plane]) mm.isPickable = false;
    this.portal = holder as unknown as TransformNode;
    // Вращаем только круг (root), табличка стоит.
    this.portalSpin = root;
  }
  private portalSpin: TransformNode | null = null;
}
