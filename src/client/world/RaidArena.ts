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
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { angDiff, parseCracks, RAID, RAID_FIGHT, RAID_ORBITS, type RaidCrack } from "#shared/raid";
import { MOB } from "#shared/mobs";
import { terrainHeight } from "#shared/terrain";
import { FX_RGB } from "#shared/look";
import { groundFxThrough } from "../ui/groundFx";

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
  /** Секунд до «Лунной слезы». */
  tear: number;
  /** Идёт «Притяжение». */
  pull: boolean;
  /** Секунд до «Последнего вздоха» (0 — не фаза 4). */
  breath: number;
  /** Пропасти «Раскола диска» (в осях арены) и открыты ли они. */
  cracks: RaidCrack[];
  cracksKey: string;
  crackOn: boolean;
  /** Сам босс (моб в центре арены): позиция, поворот, HP, размер; null — нет/повержен. */
  boss: { id: string; x: number; y: number; z: number; yaw: number; hp: number; maxHp: number; scale: number } | null;
}

/** Состояние моба из комнаты — то, что нужно арене от босса. */
interface MobLike {
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  dead: number;
  scale: number;
}
let bossIdCache = "";
let cracksCacheKey = "";
let cracksCache: RaidCrack[] = [];

/** Поля состояния комнаты → RaidView. */
export function raidViewOf(st: {
  raid: {
    ph: number;
    ang: number;
    edge: number;
    gap: number;
    on: number;
    o0: number;
    o1: number;
    o2: number;
    vert: number;
    tide: number;
    tear: number;
    pull: number;
    breath: number;
    cracks: string;
    crackOn: number;
  };
  mobs: { get(id: string): MobLike | undefined; forEach(cb: (m: MobLike, id: string) => void): void };
}): RaidView {
  // Босс — моб в центре арены (стоит на месте): id запоминаем, чтобы не перебирать мобов каждый кадр.
  let bm = bossIdCache ? st.mobs.get(bossIdCache) : undefined;
  if (!bm || bm.dead || Math.hypot(bm.x - RAID.x, bm.z - RAID.z) > 2) {
    bm = undefined;
    bossIdCache = "";
    st.mobs.forEach((m, id) => {
      if (!bossIdCache && !m.dead && Math.hypot(m.x - RAID.x, m.z - RAID.z) < 2) {
        bossIdCache = id;
        bm = m;
      }
    });
  }
  const R = st.raid;
  if (R.cracks !== cracksCacheKey) {
    cracksCacheKey = R.cracks;
    cracksCache = parseCracks(R.cracks);
  }
  return {
    tear: R.tear,
    pull: R.pull === 1,
    breath: R.breath,
    cracks: cracksCache,
    cracksKey: cracksCacheKey,
    crackOn: R.crackOn === 1,
    boss: bm ? { id: bossIdCache, x: bm.x, y: bm.y, z: bm.z, yaw: bm.yaw, hp: bm.hp, maxHp: bm.maxHp, scale: bm.scale } : null,
    ph: R.ph,
    ang: R.ang,
    edge: R.edge || RAID.r,
    gap: R.gap,
    on: R.on,
    o: [R.o0, R.o1, R.o2],
    vert: R.vert,
    tide: R.tide,
  };
}

const SHARDS = 28;
/** Внешний край пустоты вокруг арены, м; по нему же — купол тьмы. */
const ARENA_OUTER = RAID.r + 2.5;
const c3 = (k: keyof typeof FX_RGB): Color3 => new Color3(...FX_RGB[k]);

interface Orbit {
  node: TransformNode;
  tilt: TransformNode;
  shards: InstancedMesh[];
  /** Локальный угол каждого осколка (разрыв — у угла 0). */
  angles: number[];
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
  /** Ядро босса — пульсирует тем чаще, чем ближе атака (визуальный таймер). */
  private readonly core: Mesh;
  private readonly coreMat: StandardMaterial;
  private corePhase = 0;
  /** Пропасти «Раскола диска»: пустота + светящийся обод; крутятся с полом. */
  private crackMeshes: Mesh[] = [];
  private builtCracks = "";
  private readonly crackVoidMat: StandardMaterial;
  private readonly crackRimMat: StandardMaterial;
  /** «Притяжение»: зона жжения у центра и сходящееся кольцо. */
  private readonly pullZone: Mesh;
  private readonly pullRing: Mesh;
  private readonly pullMat: StandardMaterial;
  private pullT = 0;
  /** Вспышка «Последнего вздоха». */
  private flashT = -1;
  private t = 0;
  private idleSpin = 0;
  /** «Прилив»: пол вне разрывов (там гибнут) чернеет — 0..1, плавно. */
  private tideDark = 0;
  /**
   * Купол над ареной: изнутри — тьма вокруг (весь мир снаружи закрыт его стенками, видны только арена,
   * босс и герои внутри), снаружи не виден вовсе — включается лишь для камеры внутри купола.
   */
  private readonly dome: Mesh;

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
    this.curtainMat.alpha = 0.08;
    this.curtainMat.backFaceCulling = false;
    this.curtainMat.disableDepthWrite = true;

    // Осколки орбит — инстансы одного кристалла.
    const crystalMat = new StandardMaterial("raidCrystalMat", scene);
    crystalMat.diffuseColor = c3("moon");
    crystalMat.emissiveColor = c3("moon").scale(0.55);
    crystalMat.specularColor = new Color3(0.6, 0.6, 0.7);
    crystalMat.alpha = 0.5; // полупрозрачные (просьба 2026-10-07), как кристаллы на модели босса
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
      this.orbits.push({ node, tilt, shards, angles, wedge: [], wedgeNode });
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
    groundFxThrough(this.tideRing);
    this.tideRing.setEnabled(false);

    this.coreMat = new StandardMaterial("raidCoreMat", scene);
    this.coreMat.disableLighting = true;
    this.coreMat.emissiveColor = c3("moon");
    this.core = MeshBuilder.CreateSphere("raidCore", { diameter: 1, segments: 12 }, scene);
    this.core.material = this.coreMat;
    this.core.isPickable = false;
    this.core.setEnabled(false);

    this.crackVoidMat = new StandardMaterial("raidCrackVoidMat", scene);
    this.crackVoidMat.disableLighting = true;
    this.crackVoidMat.diffuseColor = new Color3(0, 0, 0);
    this.crackVoidMat.emissiveColor = new Color3(0.02, 0.01, 0.06);
    this.crackVoidMat.backFaceCulling = false;
    this.crackVoidMat.zOffset = -5;
    this.crackRimMat = new StandardMaterial("raidCrackRimMat", scene);
    this.crackRimMat.disableLighting = true;
    this.crackRimMat.emissiveColor = c3("arcane");

    this.pullMat = new StandardMaterial("raidPullMat", scene);
    this.pullMat.disableLighting = true;
    this.pullMat.emissiveColor = new Color3(1, 0.25, 0.35);
    this.pullMat.alpha = 0.3;
    this.pullMat.backFaceCulling = false;
    this.pullMat.zOffset = -5;
    this.pullZone = MeshBuilder.CreateDisc("raidPullZone", { radius: RAID_FIGHT.pull.coreR, tessellation: 64 }, scene);
    this.pullZone.rotation.x = Math.PI / 2;
    this.pullZone.parent = this.root;
    this.pullZone.position.y = 0.14;
    this.pullZone.material = this.pullMat;
    this.pullZone.isPickable = false;
    groundFxThrough(this.pullZone);
    this.pullZone.setEnabled(false);
    this.pullRing = MeshBuilder.CreateTorus("raidPullRing", { diameter: 2, thickness: 0.2, tessellation: 64 }, scene);
    this.pullRing.parent = this.root;
    this.pullRing.position.y = 0.3;
    this.pullRing.material = this.crackRimMat;
    this.pullRing.isPickable = false;
    groundFxThrough(this.pullRing);
    this.pullRing.setEnabled(false);

    this.rebuild(RAID.r, 0);

    const domeMat = new StandardMaterial("raidDomeMat", scene);
    domeMat.disableLighting = true;
    domeMat.diffuseColor = new Color3(0, 0, 0);
    domeMat.specularColor = new Color3(0, 0, 0);
    domeMat.emissiveColor = new Color3(0.012, 0.014, 0.03);
    domeMat.fogEnabled = false;
    // Сфера гранями внутрь, центр — на полу: нижняя половина под полом, стенки и свод закрывают мир.
    this.dome = MeshBuilder.CreateSphere("raidDome", { diameter: ARENA_OUTER * 2, segments: 24, sideOrientation: Mesh.BACKSIDE }, scene);
    this.dome.parent = this.root;
    this.dome.material = domeMat;
    this.dome.isPickable = false;
    this.dome.setEnabled(false);
    // По камере, которую сейчас рисуем (игрок, телефон, VR, эфир) — до отбора видимых мешей кадра.
    const r2 = ARENA_OUTER * ARENA_OUTER;
    scene.onBeforeCameraRenderObservable.add((cam) => {
      this.dome.setEnabled(Vector3.DistanceSquared(cam.globalPosition, this.root.position) < r2);
    });
  }

  /** Вспышка «Последнего вздоха» по всей арене. */
  flash(): void {
    this.flashT = 0;
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
    // Вспышка «Последнего вздоха» поверх.
    let flash = 0;
    if (this.flashT >= 0) {
      this.flashT += dt;
      flash = Math.max(0, 1 - this.flashT / 0.6);
      if (this.flashT > 0.6) this.flashT = -1;
    }
    const pullTint = ph > 0 && v?.pull ? 0.25 : 0;
    // «Прилив» (каст и волна): пол чернеет — там гибнут; светятся только разрывы поверх него.
    const darkTo = warn || this.tideT >= 0 ? 1 : 0;
    this.tideDark += Math.sign(darkTo - this.tideDark) * Math.min(Math.abs(darkTo - this.tideDark), dt * 2.5);
    const lit = 1 - this.tideDark;
    this.floorMat.diffuseColor.set(lit, lit, lit);
    this.floorMat.emissiveColor.set(
      (0.55 + flash + pullTint * 0.6) * lit,
      (0.58 + flash * 0.9) * lit,
      (0.68 + flash * 0.8 + pullTint) * lit,
    );
    // Перед «Последним вздохом» край арены краснеет и пульсирует.
    const bw = ph > 0 && v && v.breath > 0 && v.breath <= RAID_FIGHT.breath.warn;
    if (bw) {
      const k = 0.5 + 0.5 * Math.sin(this.t * 14);
      this.edgeMat.emissiveColor.set(1, 0.25 + 0.3 * k, 0.2 + 0.3 * k);
    } else {
      const m = FX_RGB.moon;
      this.edgeMat.emissiveColor.set(m[0], m[1], m[2]);
    }
    this.updateCore(dt, v);
    this.updateCracks(v);
    this.updatePull(dt, v);
    // Разрывы на чёрном поле «Прилива» — ярче и плотнее (там спасение).
    this.wedgeMat.alpha = 0.38 + 0.08 * Math.sin(this.t * 2.2) + pulse * 0.2 + this.tideDark * 0.35;
    this.curtainMat.alpha = 0.07 + 0.02 * Math.sin(this.t * 2.2) + pulse * 0.1;
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

  /** Ядро в груди босса: пульс чаще, когда до атаки (слеза/прилив/вздох) меньше 3 с; перед приливом — теплее. */
  private updateCore(dt: number, v: RaidView | null): void {
    const b = v?.boss;
    if (!v || v.ph === 0 || !b) {
      this.core.setEnabled(false);
      return;
    }
    this.core.setEnabled(true);
    const H = MOB.bodyRadius * 1.75 * b.scale;
    const fw = 0.1 * H;
    this.core.position.set(b.x + Math.sin(b.yaw) * fw, b.y + H * 0.56, b.z + Math.cos(b.yaw) * fw);
    const soon = Math.min(v.tear || 99, v.tide || 99, v.breath || 99);
    const rate = soon <= 3 ? 5 - soon : 1.1;
    this.corePhase += dt * rate * Math.PI * 2;
    const k = 0.5 + 0.5 * Math.sin(this.corePhase);
    const s = (0.045 + 0.03 * k) * H;
    this.core.scaling.set(s, s, s);
    const hot = (v.tide > 0 && v.tide <= 3) || (v.breath > 0 && v.breath <= 3);
    const m = FX_RGB.moon;
    if (hot) this.coreMat.emissiveColor.set(1, 0.55 + 0.3 * k, 0.4 + 0.3 * k);
    else this.coreMat.emissiveColor.set(m[0] * (0.7 + 0.5 * k), m[1] * (0.7 + 0.5 * k), m[2] * (0.8 + 0.4 * k));
  }

  /** Пропасти «Раскола диска»: пока трещины — пульсирующий обод, открылись — пустота. */
  private updateCracks(v: RaidView | null): void {
    const key = v && v.ph > 0 ? v.cracksKey : "";
    if (key !== this.builtCracks) {
      this.builtCracks = key;
      for (const m of this.crackMeshes) m.dispose();
      this.crackMeshes = [];
      for (const [i, c] of (v && v.ph > 0 ? v.cracks : []).entries()) {
        const x = Math.sin(c.a) * c.r;
        const z = Math.cos(c.a) * c.r;
        const hole = MeshBuilder.CreateDisc(`raidCrack${i}`, { radius: c.cr, tessellation: 32 }, this.scene);
        hole.rotation.x = Math.PI / 2;
        hole.position.set(x, 0.13, z);
        hole.material = this.crackVoidMat;
        const rim = MeshBuilder.CreateTorus(`raidCrackRim${i}`, { diameter: c.cr * 2, thickness: 0.18, tessellation: 40 }, this.scene);
        rim.position.set(x, 0.16, z);
        rim.material = this.crackRimMat;
        for (const m of [hole, rim]) {
          m.parent = this.spin;
          m.isPickable = false;
          this.crackMeshes.push(m);
        }
      }
    }
    const open = !!v?.crackOn;
    for (let i = 0; i < this.crackMeshes.length; i += 2) this.crackMeshes[i].setEnabled(open);
    const k = open ? 1 : 0.5 + 0.5 * Math.sin(this.t * 12);
    const a = FX_RGB.arcane;
    this.crackRimMat.emissiveColor.set(a[0] * (0.5 + k), a[1] * (0.5 + k), a[2] * (0.5 + k));
  }

  /** «Притяжение»: красная зона жжения у центра и кольцо, сходящееся к боссу. */
  private updatePull(dt: number, v: RaidView | null): void {
    const on = !!v && v.ph > 0 && v.pull;
    this.pullZone.setEnabled(on);
    this.pullRing.setEnabled(on);
    if (!on || !v) {
      this.pullT = 0;
      return;
    }
    this.pullT = (this.pullT + dt) % 1;
    const r = v.edge - (v.edge - RAID_FIGHT.pull.coreR) * this.pullT;
    this.pullRing.scaling.set(r, 1, r);
    this.pullMat.alpha = 0.22 + 0.12 * Math.sin(this.t * 8);
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
    this.voidRing = annulus(this.scene, "raidVoid", edge, ARENA_OUTER, 96);
    this.voidRing.parent = this.root;
    this.voidRing.position.y = 0.09;
    this.voidRing.material = this.voidMat;
    this.voidRing.isPickable = false;

    for (let i = 0; i < 3; i++) {
      const o = this.orbits[i];
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
    // Лучи — золотые нити (колец орбит на полу нет: 2026-10-07 убраны по просьбе — жёлтые кольца).
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
