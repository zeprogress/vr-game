import type { Scene } from "@babylonjs/core/scene";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { FresnelParameters } from "@babylonjs/core/Materials/fresnelParameters";
import "@babylonjs/core/Materials/material.detailMapConfiguration";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import type { Light } from "@babylonjs/core/Lights/light";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import "@babylonjs/loaders/glTF/2.0";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/Builders/discBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import "@babylonjs/core/Meshes/Builders/torusBuilder";

import {
  DUN_BOSS_GATE,
  DUN_FALLS,
  DUN_HALF,
  DUN_LAKE,
  DUN_PORTAL,
  DUN_SPOTS,
  DUN_VOID_H,
  DUN_X,
  DUN_Y0,
  DUN_Z,
  dunFloorLocal,
  inDunRegion,
} from "#shared/dungeon";
import { type DunGeoMat, dunGeometry } from "#shared/dungeonGeo";
import { type DunLight, dunDress, dunLights } from "#shared/dungeonDress";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import "@babylonjs/core/Particles/particleSystemComponent";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { makeFireMaterial } from "./FireShader";
import { terrainHeight } from "#shared/terrain";
import { LAYER, groundLayer } from "../engine/renderLayers";

/**
 * Подземелье «Глубинный храм»: полы, обрывы, потолки и стены построек — из shared/dungeonGeo (общие
 * бесшовные материалы: плиты, скала, гранит), модули набора (скалы, колонны, арки, мосты, лестницы) —
 * из public/models/dungeon/DungeonKit.glb по расстановке shared/dungeonDress. Всё разбито на куски по
 * зонам: рисуются только зоны рядом с камерой, модули — инстансами, вблизи LOD0, дальше — LOD1.
 * Строится лениво при первом входе; портал у лагеря — всегда.
 */

/** Какие текстуры у материала геометрии / модуля (public/textures/dungeon/<имя>_c|_n.jpg). */
const TEX_OF: Record<string, string> = {
  floorStone: "ruinfloor", floorRock: "cavefloor", cliff: "rock", ceiling: "rock", dome: "rock", masonry: "masonry", wood: "wood",
  cloth: "cloth", bone: "masonry",
  rock: "rock", metal: "metal",
};
/** Настоящих источников света в подземелье одновременно (переезжают к ближайшим огням и кристаллам). */
const LIGHT_SLOTS = 4;
/** Модули из тёсаного камня (гранит), остальные — скала. */
const MASONRY_KIT = new Set(["Column", "Arch", "Wall", "Stairs", "BridgeSeg", "Statue"]);
/** Материал модуля набора по его виду (не по имени материала glTF — заглушки ненадёжны). */
const KIT_MAT: Record<string, "wood" | "metal" | "cloth" | "bone"> = {
  Brazier: "metal", Sconce: "metal", MineCart: "metal", Cage: "metal",
  Barrel: "wood", Crate: "wood", Chest: "wood", Banner: "cloth", Bones: "bone",
};
/** Зона рисуется, пока камера ближе этого к её краю (м); модули — LOD0 ближе LOD_NEAR. */
const ZONE_DRAW = 140;
const LOD_NEAR = 45;
/** Дальний план (из открытых залов видно всю пещеру): полы, стены и крупные модули в LOD1, без мелочи. */
const FAR_DRAW = 420;
/** Мелочь — не рисуется на дальнем плане. */
const SMALL_KIT = new Set(["Rubble", "Stalagmite", "Stalactite", "RockOutcrop", "Stairs", "Wall"]);

/** Кусок зоны: её меши (геометрия + модули), рамка, переключатель LOD. */
interface ZoneChunk {
  id: string;
  min: [number, number, number];
  max: [number, number, number];
  geo: Mesh[];
  lod0: Mesh[];
  lod1: Mesh[];
  /** LOD1 крупных модулей — их рисуем и на дальнем плане. */
  lod1Big: Set<Mesh>;
  /** 0 — скрыта, 1 — дальний план, 2 — LOD1, 3 — LOD0. */
  level: number;
}

function flatMat(scene: Scene, name: string, rgb: readonly [number, number, number], emissive = 0.3): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = new Color3(rgb[0], rgb[1], rgb[2]);
  m.emissiveColor = new Color3(rgb[0] * emissive, rgb[1] * emissive, rgb[2] * emissive);
  m.specularColor = new Color3(0.04, 0.04, 0.04);
  return m;
}

function labelPlane(scene: Scene, name: string, text: string, w: number): Mesh {
  const tex = new DynamicTexture(`${name}Tex`, { width: 512, height: 96 }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = "rgba(10,12,20,0.6)";
  ctx.fillRect(0, 0, 512, 96);
  ctx.fillStyle = "#e9e2ff";
  ctx.font = "bold 44px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(text, 256, 63);
  tex.update();
  tex.hasAlpha = true;
  const m = new StandardMaterial(`${name}Mat`, scene);
  m.diffuseTexture = tex;
  m.emissiveTexture = tex;
  m.disableLighting = true;
  m.useAlphaFromDiffuseTexture = true;
  m.backFaceCulling = false;
  const p = MeshBuilder.CreatePlane(name, { width: w, height: w * (96 / 512) }, scene);
  p.material = m;
  p.billboardMode = Mesh.BILLBOARDMODE_Y;
  p.isPickable = false;
  return p;
}

export class DungeonFx {
  private root: TransformNode | null = null;
  private readonly chunks = new Map<string, ZoneChunk>();
  private readonly mats = new Map<string, StandardMaterial>();
  private kitLoading = false;
  /** Свет пещеры: холодный общий (видны проходы и враги и на телефоне). */
  private amb: HemisphericLight | null = null;
  /** Солнце и небо мира, погашенные, пока камера в подземелье: свет → исходная яркость. */
  private readonly dimmed = new Map<Light, number>();
  private savedFog: { mode: number; start: number; end: number; color: Color3 } | null = null;
  private fogObs: Observer<Scene> | null = null;
  /**
   * Настоящих источников света — всегда LIGHT_SLOTS (предел WebGPU и цена освещения): каждые 0.25 с они
   * переезжают к ближайшим жаровням/кристаллам из dunLights(), смена — плавным угасанием и разгоранием.
   */
  private readonly slots: { l: PointLight; src: DunLight | null; want: DunLight | null; k: number }[] = [];
  private pickAt = 0;
  private fireMat: ShaderMaterial | null = null;
  /** Вода: рябь бежит (смещение карты нормалей), водопады — бегущие вниз струи, у основания брызги. */
  private waterBump: Texture | null = null;
  private fallTex: Texture[] = [];
  private readonly mistTex: Texture[] = [];
  private readonly sprays: { ps: ParticleSystem; x: number; y: number; z: number; on: boolean }[] = [];
  private portalMats: StandardMaterial[] = [];
  private time = 0;

  constructor(private readonly scene: Scene) {
    this.buildCampPortal();
  }

  /** Камера в подземелье. */
  static inside(x: number, z: number): boolean {
    return inDunRegion(x, z);
  }

  update(dt: number, cam: { x: number; y?: number; z: number }): void {
    this.time += dt;
    const inside = inDunRegion(cam.x, cam.z);
    if (inside && !this.root) this.build();
    if (this.root && this.root.isEnabled() !== inside) this.root.setEnabled(inside);
    if (inside) this.cullChunks(cam.x - DUN_X, (cam.y ?? DUN_Y0 + 40) - DUN_Y0, cam.z - DUN_Z);
    this.atmosphere(inside);
    if (inside && this.root) this.tickLights(dt, cam.x - DUN_X, (cam.y ?? DUN_Y0 + 40) - DUN_Y0, cam.z - DUN_Z);
    if (this.fireMat) this.fireMat.setFloat("uTime", this.time);
    const pulse = 0.75 + 0.25 * Math.sin(this.time * 2.4);
    for (const m of this.portalMats) m.emissiveColor.set(0.55 * pulse, 0.35 * pulse, 1.0 * pulse);
    if (inside) this.tickWater(dt, cam.x - DUN_X, (cam.y ?? DUN_Y0 + 40) - DUN_Y0, cam.z - DUN_Z);
  }

  /**
   * Атмосфера пещеры, пока камера внизу: солнце и небо мира гаснут (каждый кадр — мир их сам выставляет),
   * горит холодный общий свет, синий туман по глубине; на выходе всё возвращается.
   */
  private atmosphere(inside: boolean): void {
    const scene = this.scene;
    if (inside) {
      if (!this.amb) {
        this.amb = new HemisphericLight("dunAmbient", new Vector3(0, 1, 0), scene);
        this.amb.diffuse = new Color3(0.42, 0.52, 0.78);
        this.amb.groundColor = new Color3(0.02, 0.025, 0.04);
        this.amb.specular = new Color3(0.1, 0.12, 0.16);
      }
      this.amb.intensity = 0.95;
      for (const l of scene.lights) {
        if (l === this.amb) continue;
        const cls = l.getClassName();
        if (cls !== "DirectionalLight" && cls !== "HemisphericLight") continue;
        if (!this.dimmed.has(l)) this.dimmed.set(l, l.intensity);
        l.intensity = 0;
      }
      if (!this.savedFog) {
        this.savedFog = { mode: scene.fogMode, start: scene.fogStart, end: scene.fogEnd, color: scene.fogColor.clone() };
        // перед каждым кадром — небо мира в том же кадре могло выставить свой светлый дневной туман
        this.fogObs = scene.onBeforeRenderObservable.add(() => this.applyFog());
      }
      this.applyFog();
    } else if (this.savedFog || this.dimmed.size) {
      if (this.amb) this.amb.intensity = 0;
      for (const sl of this.slots) sl.l.intensity = 0;
      for (const sp of this.sprays) if (sp.on) {
        sp.on = false;
        sp.ps.stop();
      }
      for (const [l, v] of this.dimmed) l.intensity = v;
      this.dimmed.clear();
      if (this.fogObs) {
        scene.onBeforeRenderObservable.remove(this.fogObs);
        this.fogObs = null;
      }
      if (this.savedFog) {
        scene.fogMode = this.savedFog.mode;
        scene.fogStart = this.savedFog.start;
        scene.fogEnd = this.savedFog.end;
        scene.fogColor.copyFrom(this.savedFog.color);
        this.savedFog = null;
      }
    }
  }

  /** Дымка подземелья: тёмная, слегка синеватая, даль уходит во тьму. */
  private applyFog(): void {
    const scene = this.scene;
    scene.fogMode = 3; // LINEAR
    scene.fogStart = 8;
    scene.fogEnd = 150;
    scene.fogColor.set(0.025, 0.045, 0.085);
  }

  /** Переезжающие источники света: ближайшие к камере жаровни и кристаллы, плавная смена. */
  private tickLights(dt: number, x: number, y: number, z: number): void {
    const scene = this.scene;
    if (!this.slots.length) {
      for (let i = 0; i < LIGHT_SLOTS; i++) {
        const l = new PointLight(`dunLight${i}`, new Vector3(0, -1000, 0), scene);
        l.parent = this.root;
        l.intensity = 0;
        this.slots.push({ l, src: null, want: null, k: 0 });
      }
    }
    this.pickAt -= dt;
    if (this.pickAt <= 0) {
      this.pickAt = 0.25;
      const ranked = dunLights()
        .map((s) => {
          const d = Math.hypot(s.p[0] - x, (s.p[1] - y) * 0.7, s.p[2] - z);
          return { s, score: d < s.range * 2.2 ? s.power / (1 + (d / s.range) ** 2) : 0 };
        })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, LIGHT_SLOTS)
        .map((r) => r.s);
      const free = this.slots.filter((sl) => !sl.want || !ranked.includes(sl.want));
      for (const sl of free) sl.want = null;
      for (const s of ranked) {
        if (this.slots.some((sl) => sl.want === s)) continue;
        const sl = free.shift();
        if (sl) sl.want = s;
      }
    }
    for (const sl of this.slots) {
      // смена источника: угаснуть → переехать → разгореться (без вспышек — комфорт VR)
      if (sl.src !== sl.want) {
        sl.k = Math.max(0, sl.k - dt * 3);
        if (sl.k === 0) {
          sl.src = sl.want;
          if (sl.src) {
            sl.l.position.set(sl.src.p[0], sl.src.p[1], sl.src.p[2]);
            sl.l.diffuse.set(sl.src.color[0], sl.src.color[1], sl.src.color[2]);
            sl.l.specular.set(sl.src.color[0] * 0.4, sl.src.color[1] * 0.4, sl.src.color[2] * 0.4);
            sl.l.range = sl.src.range;
          }
        }
      } else if (sl.src) sl.k = Math.min(1, sl.k + dt * 2);
      const warm = sl.src && sl.src.color[0] > sl.src.color[2];
      const flick = warm ? 0.9 + 0.07 * Math.sin(this.time * 13 + sl.l.position.x) + 0.03 * Math.sin(this.time * 31) : 1;
      sl.l.intensity = sl.src ? sl.k * (warm ? 2.2 : 1.6) * flick : 0;
    }
  }

  /** Огонь жаровен: скрещённые плоскости шейдера костра (один материал), по меш-у на зону; пятна света на полу. */
  private buildFires(root: TransformNode): void {
    const scene = this.scene;
    this.fireMat = makeFireMaterial(scene, "dunFire", false);
    const byZone = new Map<string, Mesh[]>();
    const pools = new Map<string, Mesh[]>();
    const poolMat = new StandardMaterial("dunFirePool", scene);
    const tex = new DynamicTexture("dunFirePoolTex", { width: 128, height: 128 }, scene, false);
    const g = tex.getContext() as CanvasRenderingContext2D;
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, "rgba(255,170,90,0.55)");
    grd.addColorStop(0.5, "rgba(255,110,40,0.18)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    tex.update();
    tex.hasAlpha = true;
    poolMat.diffuseTexture = tex;
    poolMat.emissiveTexture = tex;
    poolMat.useAlphaFromDiffuseTexture = true;
    poolMat.disableLighting = true;
    poolMat.alphaMode = 1; // ADD
    poolMat.disableDepthWrite = true;
    for (const s of dunLights()) {
      if (!s.flame) continue; // кристаллы — без пламени
      for (let i = 0; i < 2; i++) {
        const pl = MeshBuilder.CreatePlane("dunFlame", { width: 0.9 * s.flame, height: 1.25 * s.flame }, scene);
        pl.position.set(s.p[0], s.p[1] - 0.05, s.p[2]);
        pl.rotation.y = i * (Math.PI / 2) + 0.4;
        pl.bakeCurrentTransformIntoVertices();
        const list = byZone.get(s.zone) ?? [];
        list.push(pl);
        byZone.set(s.zone, list);
      }
      if (s.floor === undefined) continue;
      const pool = MeshBuilder.CreateGround("dunPool", { width: 9, height: 9 }, scene);
      pool.position.set(s.p[0], s.floor + 0.06, s.p[2]);
      pool.bakeCurrentTransformIntoVertices();
      const pl2 = pools.get(s.zone) ?? [];
      pl2.push(pool);
      pools.set(s.zone, pl2);
    }
    for (const [zone, list] of byZone) {
      const m = Mesh.MergeMeshes(list, true, true);
      if (!m) continue;
      m.name = `dunFire_${zone}`;
      m.material = this.fireMat;
      m.parent = root;
      m.isPickable = false;
      this.chunk(zone).geo.push(m);
    }
    for (const [zone, list] of pools) {
      const m = Mesh.MergeMeshes(list, true, true);
      if (!m) continue;
      m.name = `dunFirePool_${zone}`;
      m.material = poolMat;
      m.parent = root;
      m.isPickable = false;
      this.chunk(zone).geo.push(m);
    }
  }

  /**
   * Водопады: изогнутая пелена из двух слоёв (ядро и рваная кромка) с бегущими вниз струями, пена у
   * основания; брызги — частицы, только когда камера рядом. Дымка: слой над бездной и над озером.
   */
  private buildWater(root: TransformNode): void {
    const scene = this.scene;
    const streak = (name: string, dense: number): DynamicTexture => {
      const t = new DynamicTexture(name, { width: 128, height: 512 }, scene, true);
      const g = t.getContext() as CanvasRenderingContext2D;
      g.clearRect(0, 0, 128, 512);
      let seed = 7 + dense * 13;
      const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let k = 0; k < 70 * dense; k++) {
        const x = rnd() * 128;
        const y = rnd() * 512;
        const w = 1 + rnd() * 5;
        const h = 60 + rnd() * 260;
        const a = 0.15 + rnd() * 0.5;
        const grd = g.createLinearGradient(0, y, 0, y + h);
        grd.addColorStop(0, `rgba(210,235,255,0)`);
        grd.addColorStop(0.5, `rgba(225,242,255,${a})`);
        grd.addColorStop(1, `rgba(210,235,255,0)`);
        g.fillStyle = grd;
        // бесшовно по вертикали: рисуем и с переносом
        g.fillRect(x, y, w, h);
        g.fillRect(x, y - 512, w, h);
      }
      t.update();
      t.hasAlpha = true;
      t.wrapU = Texture.WRAP_ADDRESSMODE;
      t.wrapV = Texture.WRAP_ADDRESSMODE;
      return t;
    };
    const soft = (name: string, rgba: string): DynamicTexture => {
      const t = new DynamicTexture(name, { width: 64, height: 64 }, scene, false);
      const g = t.getContext() as CanvasRenderingContext2D;
      const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, rgba);
      grd.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 64);
      t.update();
      t.hasAlpha = true;
      return t;
    };
    const fallMat = (name: string, tex: Texture, alpha: number): StandardMaterial => {
      const m = new StandardMaterial(name, scene);
      m.disableLighting = true;
      m.emissiveTexture = tex;
      m.opacityTexture = tex;
      m.emissiveColor = new Color3(0.75, 0.88, 1);
      m.alpha = alpha;
      m.backFaceCulling = false;
      m.disableDepthWrite = true;
      return m;
    };
    const coreTex = streak("dunFallCore", 3);
    const edgeTex = streak("dunFallEdge", 1);
    this.fallTex = [coreTex, edgeTex];
    const spray = soft("dunSpray", "rgba(220,238,255,0.55)");
    for (const [i, f] of DUN_FALLS.entries()) {
      const H = f.top - f.bottom;
      // лист: колонки по ширине × ряды по высоте; выгнут вперёд, у верха отходит от стены (струя падает дугой)
      const sheet = (name: string, wMul: number, depth: number, mat: StandardMaterial): void => {
        const cols = 10;
        const rows = 24;
        const pos: number[] = [];
        const uv: number[] = [];
        const idx: number[] = [];
        const w = f.w * wMul;
        for (let r = 0; r <= rows; r++) {
          const t = r / rows; // 0 — низ, 1 — верх
          for (let c = 0; c <= cols; c++) {
            const sx = c / cols - 0.5;
            const bulge = Math.cos(sx * Math.PI) * 0.6 + depth;
            const out = (1 - t) * (1 - t) * 0;
            const lip = Math.pow(t, 6) * 2.2; // у кромки обрыва — дуга от стены
            pos.push(sx * w * (1 + (1 - t) * 0.35), f.bottom + H * t, bulge + lip + out);
            uv.push(c / cols, (t * H) / 18);
          }
        }
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++) {
            const a = r * (cols + 1) + c;
            const b = a + cols + 1;
            idx.push(a, b, a + 1, a + 1, b, b + 1);
          }
        const vd = new VertexData();
        vd.positions = pos;
        vd.indices = idx;
        vd.uvs = uv;
        const m = new Mesh(name, scene);
        vd.applyToMesh(m);
        m.material = mat;
        m.parent = root;
        m.position.set(f.u, 0, f.v);
        m.rotation.y = f.yaw; // локальная +z — от стены наружу
        m.isPickable = false;
      };
      sheet(`dunFall${i}`, 1, 0, fallMat(`dunFallM${i}`, coreTex, 0.95));
      sheet(`dunFallEdge${i}`, 1.35, 0.5, fallMat(`dunFallE${i}`, edgeTex, 0.5));
      // пена у основания (у озера) и брызги
      const dir = { x: Math.sin(f.yaw), z: Math.cos(f.yaw) };
      const bx = f.u + dir.x * 2;
      const bz = f.v + dir.z * 2;
      if (f.bottom > DUN_VOID_H + 1) {
        const foam = MeshBuilder.CreateGround(`dunFoam${i}`, { width: f.w * 3, height: f.w * 3 }, scene);
        const fm = new StandardMaterial(`dunFoamM${i}`, scene);
        fm.disableLighting = true;
        fm.emissiveTexture = spray;
        fm.opacityTexture = spray;
        fm.emissiveColor = new Color3(0.85, 0.93, 1);
        fm.disableDepthWrite = true;
        foam.material = fm;
        foam.position.set(bx, f.bottom + 0.15, bz);
        foam.parent = root;
        foam.isPickable = false;
      }
      const ps = new ParticleSystem(`dunSpray${i}`, 140, scene);
      ps.renderingGroupId = LAYER.world; // частицы — мир (по умолчанию группа 0 = земля)
      ps.particleTexture = spray;
      ps.minSize = 3;
      ps.maxSize = 9;
      ps.minLifeTime = 2.5;
      ps.maxLifeTime = 5;
      ps.emitRate = 28;
      ps.color1 = new Color4(0.75, 0.88, 1, 0.22);
      ps.color2 = new Color4(0.6, 0.78, 1, 0.12);
      ps.colorDead = new Color4(0.5, 0.7, 1, 0);
      ps.minEmitPower = 0.6;
      ps.maxEmitPower = 2.2;
      ps.gravity = new Vector3(0, 0.6, 0);
      ps.blendMode = ParticleSystem.BLENDMODE_ADD;
      ps.minEmitBox = new Vector3(-f.w * 0.6, 0, -1.5);
      ps.maxEmitBox = new Vector3(f.w * 0.6, 2, 1.5);
      ps.direction1 = new Vector3(-1, 1, -1);
      ps.direction2 = new Vector3(1, 2, 1);
      const sy = Math.max(f.bottom, DUN_VOID_H + 6);
      ps.emitter = new Vector3(DUN_X + bx, DUN_Y0 + sy, DUN_Z + bz);
      this.sprays.push({ ps, x: bx, y: sy, z: bz, on: false });
    }
    // дымка: над бездной (стелется в глубине) и над озером
    const mistLayer = (name: string, size: number, x: number, y: number, z: number, alpha: number, black = false): void => {
      const t = new DynamicTexture(`${name}Tex`, { width: 256, height: 256 }, scene, true);
      const g = t.getContext() as CanvasRenderingContext2D;
      g.clearRect(0, 0, 256, 256);
      let seed = name.length * 31 + 5;
      const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let k = 0; k < 90; k++) {
        const cx = rnd() * 256;
        const cy = rnd() * 256;
        const r = 18 + rnd() * 50;
        for (const [ox, oy] of [[0, 0], [256, 0], [-256, 0], [0, 256], [0, -256]]) {
          const grd = g.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, r);
          grd.addColorStop(0, black ? `rgba(0,0,0,${0.35 + rnd() * 0.3})` : `rgba(170,200,255,${0.1 + rnd() * 0.12})`);
          grd.addColorStop(1, black ? "rgba(0,0,0,0)" : "rgba(170,200,255,0)");
          g.fillStyle = grd;
          g.fillRect(cx + ox - r, cy + oy - r, r * 2, r * 2);
        }
      }
      t.update();
      t.hasAlpha = true;
      t.uScale = size / 60;
      t.vScale = size / 60;
      this.mistTex.push(t);
      const m = new StandardMaterial(`${name}Mat`, scene);
      m.disableLighting = true;
      m.emissiveTexture = t;
      m.opacityTexture = t;
      m.emissiveColor = black ? new Color3(0, 0, 0) : new Color3(0.55, 0.7, 1);
      m.alpha = alpha;
      if (black) {
        // чёрный туман бездны: сплошная подложка + рваные клубы — взгляд вниз тонет во тьме
        m.emissiveTexture = null;
        m.diffuseColor = new Color3(0, 0, 0);
        m.fogEnabled = false;
      }
      m.backFaceCulling = false;
      m.disableDepthWrite = true;
      const p = MeshBuilder.CreateGround(name, { width: size, height: size }, scene);
      p.material = m;
      p.position.set(x, y, z);
      p.parent = root;
      p.isPickable = false;
    };
    // бездна: чёрные слои стопкой — чем глубже, тем плотнее тьма
    for (const [k, y, a] of [[0, DUN_VOID_H + 4, 0.95], [1, DUN_VOID_H + 12, 0.8], [2, DUN_VOID_H + 21, 0.6], [3, DUN_VOID_H + 30, 0.4], [4, DUN_VOID_H + 38, 0.22]] as const) {
      mistLayer(`dunAbyssDark${k}`, DUN_HALF * 2 + 60, k * 17, y, k * 11, a, true);
    }
    let lx0 = Infinity;
    let lx1 = -Infinity;
    let lz0 = Infinity;
    let lz1 = -Infinity;
    for (const [u, v] of DUN_LAKE.pts) {
      lx0 = Math.min(lx0, u);
      lx1 = Math.max(lx1, u);
      lz0 = Math.min(lz0, v);
      lz1 = Math.max(lz1, v);
    }
    mistLayer("dunMistLake", Math.max(lx1 - lx0, lz1 - lz0), (lx0 + lx1) / 2, DUN_LAKE.h + 2.5, (lz0 + lz1) / 2, 0.25);
  }

  /** Бег ряби, струй водопадов, дымки; брызги — только у водопадов рядом с камерой. */
  private tickWater(dt: number, x: number, y: number, z: number): void {
    if (this.waterBump) {
      this.waterBump.uOffset = (this.waterBump.uOffset + dt * 0.012) % 1;
      this.waterBump.vOffset = (this.waterBump.vOffset + dt * 0.008) % 1;
    }
    if (this.fallTex[0]) this.fallTex[0].vOffset = (this.fallTex[0].vOffset + dt * 0.9) % 1;
    if (this.fallTex[1]) this.fallTex[1].vOffset = (this.fallTex[1].vOffset + dt * 0.65) % 1;
    for (const [i, t] of this.mistTex.entries()) t.uOffset = (t.uOffset + dt * (0.003 + i * 0.002)) % 1;
    for (const sp of this.sprays) {
      const near = Math.hypot(sp.x - x, sp.y - y, sp.z - z) < 140;
      if (near !== sp.on) {
        sp.on = near;
        if (near) sp.ps.start();
        else sp.ps.stop();
      }
    }
  }

  /** Портал у лагеря: кольцо, светящийся диск, подпись. */
  private buildCampPortal(): void {
    const y = terrainHeight(DUN_PORTAL.x, DUN_PORTAL.z);
    const node = new TransformNode("dunCampPortal", this.scene);
    node.position.set(DUN_PORTAL.x, y, DUN_PORTAL.z);
    this.portalInto(node, "dunCampPortal", "Глубинный храм");
  }

  private portalInto(parent: TransformNode, name: string, title: string | null): void {
    const scene = this.scene;
    const ringMat = flatMat(scene, `${name}Ring`, [0.35, 0.3, 0.45], 0.2);
    const ring = MeshBuilder.CreateTorus(`${name}Ring`, { diameter: 3.6, thickness: 0.35, tessellation: 32 }, scene);
    ring.material = ringMat;
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 2.1;
    ring.parent = parent;
    const glow = new StandardMaterial(`${name}Glow`, scene);
    glow.disableLighting = true;
    glow.emissiveColor = new Color3(0.55, 0.35, 1);
    glow.alpha = 0.55;
    glow.backFaceCulling = false;
    this.portalMats.push(glow);
    const disc = MeshBuilder.CreateDisc(`${name}Disc`, { radius: 1.6, tessellation: 32 }, scene);
    disc.material = glow;
    disc.position.y = 2.1;
    disc.billboardMode = Mesh.BILLBOARDMODE_Y;
    disc.parent = parent;
    const pad = MeshBuilder.CreateDisc(`${name}Pad`, { radius: DUN_PORTAL.r, tessellation: 32 }, scene);
    pad.material = glow;
    pad.rotation.x = Math.PI / 2;
    pad.position.y = 0.06;
    pad.parent = parent;
    for (const m of [ring, disc, pad]) m.isPickable = false;
    if (title) {
      const l = labelPlane(scene, `${name}Label`, title, 6);
      l.position.y = 4.6;
      l.parent = parent;
    }
  }

  private build(): void {
    const scene = this.scene;
    const root = new TransformNode("dungeon", scene);
    root.position.set(DUN_X, DUN_Y0, DUN_Z);
    this.root = root;

    // Полы, обрывы, потолки, стены построек, вода — по кускам «зона × материал».
    for (const part of dunGeometry()) {
      const m = this.customMesh(`dunGeo_${part.zone}_${part.mat}${part.walk ? "_walk" : ""}`, part.pos, part.idx, part.uv, part.col);
      m.material = this.geoMat(part.mat);
      // Полы и ходовые поверхности (лестницы, мосты, помосты) — слой земли: круги эффектов поверх;
      // стены, обрывы, своды — мир.
      if (part.walk || part.mat === "floorStone" || part.mat === "floorRock") groundLayer(m);
      m.parent = root;
      m.isPickable = false;
      m.freezeWorldMatrix();
      this.chunk(part.zone).geo.push(m);
      this.grow(part.zone, part.pos);
    }

    // Дно бездны (тёмная скала).
    const abyss = MeshBuilder.CreateGround("dunAbyss", { width: DUN_HALF * 2, height: DUN_HALF * 2 }, scene);
    abyss.material = flatMat(scene, "dunAbyssMat", [0, 0, 0], 0);
    abyss.position.y = DUN_VOID_H;
    abyss.parent = root;

    this.buildWater(root);

    // Храм: фасад с открытой аркой над входом в неф (площадь G → неф V), статуи у входа.
    const stone = this.geoMat("masonry");
    const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number): Mesh => {
      const b = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d, wrap: true }, scene);
      b.material = stone;
      b.position.set(x, y, z);
      b.parent = root;
      b.isPickable = false;
      return b;
    };
    for (const sx of [-1, 1]) box(`dunTempleWing${sx}`, 18, 30, 6, sx * 19, 56 + 15, 77);
    box("dunTempleLintel", 20, 16, 6, 0, 56 + 14 + 8, 77);

    // Ворота святилища — прямо перед залом босса: стена с проёмом, перемычка, две распахнутые створки
    // (внутрь зала, вдоль стены) и пара статуй-стражей в конце нефа.
    {
      const g = DUN_BOSS_GATE;
      const half = g.w / 2;
      const wallV = g.v - 2;
      for (const sx of [-1, 1]) {
        box(`dunGateWing${sx}`, 20, 34, 4, g.u + sx * (half + 10), 56 + 17, wallV);
        const leaf = MeshBuilder.CreateBox(`dunGateLeaf${sx}`, { width: half, height: g.h, depth: 0.6 }, scene);
        leaf.material = this.geoMat("wood");
        const du = -sx * 0.34;
        const dv = 0.94;
        leaf.rotation.y = Math.atan2(-dv, du); // локальная ось x створки → (du, dv)
        leaf.position.set(g.u + sx * half + du * (half / 2), 56 + g.h / 2, g.v + dv * (half / 2));
        leaf.parent = root;
      }
      box("dunGateLintel", g.w, 34 - g.h, 4, g.u, 56 + g.h + (34 - g.h) / 2, wallV);
    }

    // Порталы назад, сундуки-метки.
    for (const [i, q] of DUN_SPOTS.portals.entries()) {
      const n = new TransformNode(`dunBackPortal${i}`, scene);
      n.parent = root;
      n.position.set(q.u, dunFloorLocal(q.u, q.v) ?? 0, q.v);
      this.portalInto(n, `dunBackPortal${i}`, "В лагерь");
    }

    // Оболочка пещеры: коробка изнутри — закрывает небо и мир снаружи.
    const shell = MeshBuilder.CreateBox("dunShell", { width: DUN_HALF * 2 + 60, depth: DUN_HALF * 2 + 60, height: 180, sideOrientation: Mesh.BACKSIDE }, scene);
    shell.material = flatMat(scene, "dunShellMat", [0.02, 0.025, 0.04], 0.6);
    shell.position.y = DUN_VOID_H - 5 + 90;
    shell.parent = root;
    shell.isPickable = false;

    root.setEnabled(false);
    this.buildFires(root);
    void this.loadKit();
  }

  /** Модули набора: GLB → меши в осях игры → по зонам инстансы LOD0/LOD1. */
  private async loadKit(): Promise<void> {
    if (this.kitLoading || !this.root) return;
    this.kitLoading = true;
    const scene = this.scene;
    const c = await LoadAssetContainerAsync("/models/dungeon/DungeonKit.glb", scene).catch((e) => {
      console.warn("[dungeon] набор не загрузился", e);
      return null;
    });
    if (!c || !this.root) return;
    c.addAllToScene();
    // Исходные меши: снять с корня glTF (поворот осей) и запечь — вершины в осях игры, лицо модуля в +Z.
    const src = new Map<string, Mesh>();
    for (const m of c.meshes) {
      if (!(m instanceof Mesh) || !m.getTotalVertices()) continue;
      m.computeWorldMatrix(true);
      m.setParent(null);
      m.bakeCurrentTransformIntoVertices();
      // Материал — по виду модуля (имена материалов glTF-заглушек не надёжны). Альфа цвета вершин — 1,
      // но меш с ней считается прозрачным и рисуется не в своём проходе — отключаем.
      const kind = m.name.split("_")[0];
      m.material = kind === "Crystal" ? this.crystalMat() : this.geoMat(KIT_MAT[kind] ?? (MASONRY_KIT.has(kind) ? "masonry" : "kitRock"));
      m.hasVertexAlpha = false;
      src.set(m.name, m);
    }
    // Расстановка → матрицы по (зона, модуль).
    const groups = new Map<string, Matrix[]>();
    for (const pc of dunDress()) {
      const key = `${pc.zone}|${pc.k}`;
      let list = groups.get(key);
      if (!list) groups.set(key, (list = []));
      const [fx, fy, fz] = pc.f;
      let [ux, uy, uz] = pc.up;
      // правая ось = up × f; up — переортогонализовать: up = f × right
      let rx = uy * fz - uz * fy;
      let ry = uz * fx - ux * fz;
      let rz = ux * fy - uy * fx;
      const rl = Math.hypot(rx, ry, rz) || 1;
      rx /= rl;
      ry /= rl;
      rz /= rl;
      ux = fy * rz - fz * ry;
      uy = fz * rx - fx * rz;
      uz = fx * ry - fy * rx;
      const [sx, sy, sz] = pc.s;
      list.push(Matrix.FromValues(rx * sx, ry * sx, rz * sx, 0, ux * sy, uy * sy, uz * sy, 0, fx * sz, fy * sz, fz * sz, 0, pc.p[0], pc.p[1], pc.p[2], 1));
      this.grow(pc.zone, [pc.p[0] - 12, pc.p[1] - 2, pc.p[2] - 12, pc.p[0] + 12, pc.p[1] + 24 * sy, pc.p[2] + 12]);
    }
    for (const [key, list] of groups) {
      const [zone, k] = key.split("|");
      const ch = this.chunk(zone);
      const buf = new Float32Array(list.length * 16);
      list.forEach((m, i) => m.copyToArray(buf, i * 16));
      for (const lod of [0, 1] as const) {
        const s = src.get(`${k}_LOD${lod}`);
        if (!s) continue;
        const m = s.clone(`dun_${zone}_${k}_L${lod}`, null, true, false);
        // Буферы thin instances Babylon кладёт в ГЕОМЕТРИЮ: у клонов с общей геометрией все зоны рисовались
        // бы матрицами той, что записала буфер последней. Своя копия геометрии на кусок зоны.
        m.makeGeometryUnique();
        m.parent = this.root;
        m.isPickable = false;
        m.thinInstanceSetBuffer("matrix", buf, 16, true);
        m.thinInstanceRefreshBoundingInfo(false);
        m.setEnabled(false);
        (lod === 0 ? ch.lod0 : ch.lod1).push(m);
        if (lod === 1 && !SMALL_KIT.has(k.split("_")[0])) ch.lod1Big.add(m);
      }
    }
    for (const s of src.values()) s.setEnabled(false);
    for (const n of c.transformNodes) n.dispose();
    for (const ch of this.chunks.values()) ch.level = -1; // пересчитать видимость в cullChunks
  }

  private chunk(id: string): ZoneChunk {
    let ch = this.chunks.get(id);
    if (!ch) {
      ch = { id, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], geo: [], lod0: [], lod1: [], lod1Big: new Set(), level: -1 };
      this.chunks.set(id, ch);
    }
    return ch;
  }

  /** Расширить рамку зоны: pos — плоский массив xyz (геометрия) или [minx,miny,minz,maxx,maxy,maxz]. */
  private grow(id: string, pos: number[]): void {
    const ch = this.chunk(id);
    for (let i = 0; i + 2 < pos.length; i += 3) {
      for (let a = 0; a < 3; a++) {
        if (pos[i + a] < ch.min[a]) ch.min[a] = pos[i + a];
        if (pos[i + a] > ch.max[a]) ch.max[a] = pos[i + a];
      }
    }
  }

  /** Видимость зон по расстоянию камеры до их рамок: вблизи LOD0, дальше LOD1, на дальнем плане — крупное. */
  private cullChunks(x: number, y: number, z: number): void {
    for (const ch of this.chunks.values()) {
      const dx = Math.max(ch.min[0] - x, 0, x - ch.max[0]);
      const dy = Math.max(ch.min[1] - y, 0, y - ch.max[1]);
      const dz = Math.max(ch.min[2] - z, 0, z - ch.max[2]);
      const d = Math.hypot(dx, dy * 0.5, dz);
      // стены всей пещеры — всегда дальний план (они огромные и далеко)
      const level = ch.id === "DOME" ? 1 : d < LOD_NEAR ? 3 : d < ZONE_DRAW ? 2 : d < FAR_DRAW ? 1 : 0;
      if (level === ch.level) continue;
      ch.level = level;
      for (const m of ch.geo) m.setEnabled(level > 0);
      for (const m of ch.lod0) m.setEnabled(level === 3);
      for (const m of ch.lod1) m.setEnabled(level === 2 || (level === 1 && ch.lod1Big.has(m)));
    }
  }

  /** Общий материал: текстуры набора, цвета вершин (затенение, мох) из модулей. */
  /** Кристаллы: холодное свечение (не зависит от света), низ темнее — по цвету вершин. */
  private crystalMat(): StandardMaterial {
    let m = this.mats.get("crystal");
    if (m) return m;
    m = new StandardMaterial("dunMat_crystal", this.scene);
    m.disableLighting = true;
    m.emissiveColor = new Color3(0.32, 0.62, 1.0);
    m.diffuseColor = new Color3(0, 0, 0);
    m.backFaceCulling = false;
    this.mats.set("crystal", m);
    return m;
  }

  private geoMat(key: DunGeoMat | "kitRock" | "metal" | "cloth" | "bone"): StandardMaterial {
    let m = this.mats.get(key);
    if (m) return m;
    const scene = this.scene;
    m = new StandardMaterial(`dunMat_${key}`, scene);
    m.maxSimultaneousLights = 6;
    m.backFaceCulling = false;
    m.twoSidedLighting = true;
    if (key === "water") {
      // тёмная глубокая вода: рябь картой нормалей (бежит в tickWater), яркие блики от огня и кристаллов,
      // слабое холодное свечение глубины
      m.diffuseColor = new Color3(0.004, 0.015, 0.025);
      m.emissiveColor = new Color3(0, 0, 0);
      m.specularColor = new Color3(1, 1, 1);
      m.specularPower = 220;
      m.alpha = 0.96;
      // «отражение» без отражений: под скользящим углом вода светлеет холодным (свод и дымка в ней)
      m.emissiveFresnelParameters = new FresnelParameters();
      m.emissiveFresnelParameters.leftColor = new Color3(0.1, 0.2, 0.34);
      m.emissiveFresnelParameters.rightColor = new Color3(0, 0.01, 0.02);
      m.emissiveFresnelParameters.power = 2.2;
      // отражение без зеркала: нарисованная «пещера» (тёмный свод, синие пятна кристаллов, тёплые
      // точки огня) — рябь карты нормалей дробит её в блики, как на концепте
      const env = new DynamicTexture("dunWaterEnv", { width: 512, height: 256 }, scene, true);
      const g = env.getContext() as CanvasRenderingContext2D;
      const sky = g.createLinearGradient(0, 0, 0, 256);
      sky.addColorStop(0, "#020611");
      sky.addColorStop(0.45, "#0a2350");
      sky.addColorStop(0.55, "#123a7a");
      sky.addColorStop(1, "#02050c");
      g.fillStyle = sky;
      g.fillRect(0, 0, 512, 256);
      let sd = 99;
      const rnd = (): number => ((sd = (sd * 16807) % 2147483647) / 2147483647);
      const blob = (x: number, y: number, r: number, c: string): void => {
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, c);
        gr.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = gr;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      };
      for (let k = 0; k < 26; k++) blob(rnd() * 512, 70 + rnd() * 110, 8 + rnd() * 26, `rgba(${60 + rnd() * 60},${150 + rnd() * 80},255,0.9)`);
      for (let k = 0; k < 14; k++) blob(rnd() * 512, 105 + rnd() * 40, 3 + rnd() * 6, "rgba(255,170,70,0.95)");
      env.update();
      env.coordinatesMode = Texture.EQUIRECTANGULAR_MODE;
      m.reflectionTexture = env;
      m.reflectionFresnelParameters = new FresnelParameters();
      m.reflectionFresnelParameters.leftColor = new Color3(1, 1, 1);
      m.reflectionFresnelParameters.rightColor = new Color3(0.25, 0.25, 0.25);
      m.reflectionFresnelParameters.power = 1.6;
      const b = new Texture("/textures/dungeon/water_n.jpg", scene);
      // крупная спокойная рябь: повтор ~13 м
      b.uScale = 0.6;
      b.vScale = 0.6;
      b.level = 0.8;
      m.bumpTexture = b;
      this.waterBump = b;
    } else {
      const t = TEX_OF[key === "kitRock" ? "rock" : key] ?? "rock";
      const dif = new Texture(`/textures/dungeon/${t}_c.jpg`, scene);
      const nrm = new Texture(`/textures/dungeon/${t}_n.jpg`, scene);
      m.diffuseTexture = dif;
      m.bumpTexture = nrm;
      nrm.level = 1.7;
      // влажный камень: слабый холодный блик
      // влажный камень пещеры: узкий холодный блик на гранях (камень, а не матовая штукатурка)
      m.specularColor = t === "rock" ? new Color3(0.32, 0.35, 0.4) : t === "flagstone" || t === "masonry" ? new Color3(0.16, 0.17, 0.19) : new Color3(0.06, 0.06, 0.07);
      m.specularPower = t === "rock" ? 38 : 30;
      // Пока свет подземелья — общий свет мира (этап 5 заменит): чуть своего свечения, чтобы ночью видно.
      // своего свечения у камня нет: светят огонь, кристаллы и слабый общий свет пещеры
      m.emissiveColor = new Color3(0, 0, 0);
      // Детальная карта: мелкий рельеф камня с шагом ~1 м — для взгляда вплотную (скала и кладка).
      if (t === "rock" || t === "masonry" || t === "cavefloor" || t === "ruinfloor") {
        const det = new Texture("/textures/dungeon/rock_detail.png", scene);
        const T = t === "rock" ? 4 : 3;
        det.uScale = T;
        det.vScale = T;
        m.detailMap.texture = det;
        m.detailMap.isEnabled = true;
        m.detailMap.diffuseBlendLevel = 0.35;
        m.detailMap.bumpLevel = 0.8;
      }
      if (key === "ceiling") m.diffuseColor = new Color3(0.6, 0.6, 0.65);
      if (key === "dome") m.diffuseColor = new Color3(0.55, 0.6, 0.7);
      if (key === "bone") m.diffuseColor = new Color3(2.4, 2.2, 1.8); // кость: светлее гранитной текстуры
      if (key === "metal") {
        m.specularColor = new Color3(0.45, 0.42, 0.4);
        m.specularPower = 48;
      }
    }
    this.mats.set(key, m);
    return m;
  }

  private customMesh(name: string, positions: number[], indices: number[], uvs?: number[], rgb?: number[]): Mesh {
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.normals = normals;
    if (uvs) vd.uvs = uvs;
    if (rgb && rgb.length) {
      const c = new Array((rgb.length / 3) * 4);
      for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
        c[j] = rgb[i];
        c[j + 1] = rgb[i + 1];
        c[j + 2] = rgb[i + 2];
        c[j + 3] = 1;
      }
      vd.colors = c;
    }
    const m = new Mesh(name, this.scene);
    vd.applyToMesh(m);
    m.hasVertexAlpha = false;
    return m;
  }
}
