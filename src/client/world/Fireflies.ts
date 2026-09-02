import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Constants } from "@babylonjs/core/Engines/constants";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

import { WORLD } from "#shared/constants";
import type { Terrain } from "./Terrain";

export const FIREFLY = {
  /** Сколько стаек по округе. */
  groups: 14,
  /** Огоньков в стайке. */
  perGroup: 14,
  /** Радиус, в котором огоньки вьются вокруг центра стайки, м. */
  spread: 1.5,
  /** На какой высоте над землёй висит стайка, м. */
  height: 1.1,
  /**
   * Сколько стаек реально светят.
   *
   * Материал по умолчанию берёт не больше четырёх источников разом, а солнце
   * и небо уже занимают два — поэтому тем материалам, которым важен этот свет
   * (земля, трава, деревья), потолок поднят до LIGHT_BUDGET. Каждый лишний
   * источник утяжеляет их шейдер, так что число тут — компромисс.
   */
  lamps: 5,
  /** Докуда добивает свет одной стайки, м. */
  lightRange: 11,
  lightIntensity: 1.7,
  /** Радиус светящегося ореола вокруг стайки, м. */
  poolRadius: 3.3,
  /**
   * Насколько ярко ореол (0..1). Складывается с настоящей лампой, поэтому
   * при больших значениях центр выбивается в белый.
   */
  poolAlpha: 0.12,
  /** Цвет света: один и тот же у лампы и у пятна, иначе они спорят. */
  lightColor: [1, 0.78, 0.2] as [number, number, number],
  /** С этого расстояния свет начинает разгораться, м. */
  lightFadeFrom: 18,
  /** Ближе этого светит в полную силу, м. */
  lightFadeFull: 5,
  /** Скорость дрейфа стайки по округе, м/с. */
  driftSpeed: 0.45,
} as const;

/** Сколько источников света разом должен тянуть материал: солнце + небо + лампы. */
export const LIGHT_BUDGET = FIREFLY.lamps + 2;

interface Group {
  /** Куда стайка неспешно плывёт. */
  center: Vector3;
  target: Vector3;
  dots: InstancedMesh[];
  /** Своя фаза у каждого огонька — чтобы вились вразнобой. */
  phase: number[];
  /** Световое пятно на земле — оно и создаёт свечение у дальних стаек. */
  pool: InstancedMesh;
}

/**
 * Светлячки: ночью по округе висят стайки огоньков и подсвечивают всё
 * вокруг себя, днём исчезают.
 *
 * Огоньки — аппаратные инстансы одного меша (один драв-колл на всех).
 *
 * Светятся ВСЕ стайки, но по-разному. Настоящих источников света всего пара
 * (материалы берут не больше четырёх разом, а солнце и небо уже заняли два),
 * поэтому они достаются ближайшим к игроку. Остальным светимость даёт мягкое
 * пятно на земле под стайкой — со стороны это читается как свет.
 */
/** Лампа, приписанная к стайке. Уровень тянется плавно — без вспышек. */
interface Lamp {
  light: PointLight;
  group: Group | null;
  /** 0..1, тянется к цели; смена стайки разрешена только у самого нуля. */
  level: number;
}

export class Fireflies {
  private readonly groups: Group[] = [];
  private readonly lamps: Lamp[] = [];
  private readonly proto: Mesh;
  private readonly mat: StandardMaterial;
  private readonly poolProto: Mesh;
  private readonly poolMat: StandardMaterial;
  private readonly scene: Scene;
  private clock = 0;
  /** Плавная доля ночи: 0 — день, 1 — глубокая ночь. */
  private night = 0;

  constructor(scene: Scene, terrain: Terrain, density = 1) {
    this.scene = scene;
    const groups = Math.max(0, Math.round(FIREFLY.groups * density));
    this.mat = new StandardMaterial("fireflyMat", scene);
    this.mat.emissiveColor = new Color3(1, 0.97, 0.8); // сам огонёк почти белый
    this.mat.diffuseColor = new Color3(0, 0, 0);
    this.mat.specularColor = new Color3(0, 0, 0);
    this.mat.disableLighting = true;
    this.mat.alpha = 0;

    this.proto = MeshBuilder.CreateSphere("fireflyProto", { diameter: 0.055, segments: 4 }, scene);
    this.proto.material = this.mat;
    this.proto.isPickable = false;
    this.proto.isVisible = false;

    // Светящийся ореол стайки: спрайт в воздухе с мягким радиальным пятном.
    // К камере поворачиваем сами (в update), а не billboardMode — тот в
    // спектраторе с его риг-камерами не всегда срабатывал и спрайт читался
    // белой полосой (виден с ребра).
    this.poolMat = new StandardMaterial("fireflyPoolMat", scene);
    const glow = radialGlow(scene);
    this.poolMat.emissiveTexture = glow;
    this.poolMat.opacityTexture = glow;
    this.poolMat.diffuseColor = new Color3(0, 0, 0);
    this.poolMat.specularColor = new Color3(0, 0, 0);
    this.poolMat.emissiveColor = new Color3(...FIREFLY.lightColor); // тот же цвет, что у лампы
    this.poolMat.disableLighting = true;
    this.poolMat.alphaMode = Constants.ALPHA_ADD;
    this.poolMat.disableDepthWrite = true;
    this.poolMat.backFaceCulling = false; // повернётся любой стороной — рисуем обе
    this.poolMat.alpha = 0;

    this.poolProto = MeshBuilder.CreatePlane(
      "fireflyPoolProto",
      { size: FIREFLY.poolRadius * 2 },
      scene,
    );
    this.poolProto.material = this.poolMat;
    this.poolProto.isPickable = false;
    this.poolProto.isVisible = false;
    this.poolProto.renderingGroupId = 0;

    const R = WORLD.grassRadius * 1.6;
    for (let g = 0; g < groups; g++) {
      const a = (g / Math.max(1, groups)) * Math.PI * 2 + Math.random();
      const r = 6 + Math.random() * R;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const center = new Vector3(x, terrain.heightAt(x, z) + FIREFLY.height, z);

      const dots: InstancedMesh[] = [];
      const phase: number[] = [];
      for (let i = 0; i < FIREFLY.perGroup; i++) {
        const dot = this.proto.createInstance(`firefly${g}_${i}`);
        dot.isPickable = false;
        dots.push(dot);
        phase.push(Math.random() * Math.PI * 2);
      }
      const pool = this.poolProto.createInstance(`fireflyPool${g}`);
      pool.isPickable = false;
      pool.position.copyFrom(center);
      this.groups.push({ center, target: center.clone(), dots, phase, pool });
    }

    // Нет стаек (density 0) — не заводим и точечные источники: на слабом GPU
    // каждый лишний свет в шейдере дорогой.
    const lampCount = groups === 0 ? 0 : FIREFLY.lamps;
    for (let i = 0; i < lampCount; i++) {
      const lamp = new PointLight(`fireflyLamp${i}`, Vector3.Zero(), scene);
      lamp.diffuse = new Color3(...FIREFLY.lightColor);
      lamp.specular = new Color3(
        FIREFLY.lightColor[0] * 0.3,
        FIREFLY.lightColor[1] * 0.3,
        FIREFLY.lightColor[2] * 0.3,
      );
      lamp.range = FIREFLY.lightRange;
      lamp.intensity = 0;
      lamp.setEnabled(false);
      this.lamps.push({ light: lamp, group: null, level: 0 });
    }

    this.setVisible(false);
  }

  private setVisible(on: boolean): void {
    for (const g of this.groups) {
      for (const d of g.dots) d.setEnabled(on);
      g.pool.setEnabled(on);
    }
    for (const l of this.lamps) l.light.setEnabled(on);
  }

  /** `daylight` 0..1 из DayState: 1 — день (светлячков нет), 0 — ночь. */
  update(dt: number, playerPos: Vector3, daylight: number, terrain: Terrain): void {
    // Появляются и гаснут плавно, а не щелчком на восходе.
    const wantNight = 1 - daylight;
    this.night += (wantNight - this.night) * Math.min(1, dt * 0.7);

    const on = this.night > 0.02;
    if (on !== this.proto.isEnabled()) this.setVisible(on);
    this.proto.setEnabled(false); // сам прототип не рисуем, только инстансы
    if (!on) return;

    this.clock += dt;
    this.mat.alpha = this.night;
    this.poolMat.alpha = this.night * FIREFLY.poolAlpha;

    for (const g of this.groups) {
      // Стайка неспешно плывёт к новой точке и, дойдя, выбирает следующую.
      const toTarget = g.target.subtract(g.center);
      if (toTarget.length() < 0.4) {
        const a = Math.random() * Math.PI * 2;
        const r = 3 + Math.random() * 6;
        const nx = g.center.x + Math.cos(a) * r;
        const nz = g.center.z + Math.sin(a) * r;
        g.target.set(nx, terrain.heightAt(nx, nz) + FIREFLY.height, nz);
      } else {
        toTarget.normalize().scaleInPlace(FIREFLY.driftSpeed * dt);
        g.center.addInPlace(toTarget);
      }

      // Ореол едет вместе со стайкой (в воздухе, у её центра) и сам
      // поворачивается лицом к активной камере — надёжнее billboardMode.
      g.pool.position.copyFrom(g.center);
      const cam = this.scene.activeCamera;
      if (cam) g.pool.lookAt(cam.globalPosition);

      // Огоньки вьются вокруг центра по своим орбитам.
      for (let i = 0; i < g.dots.length; i++) {
        const ph = g.phase[i];
        const t = this.clock * (0.6 + (i % 3) * 0.22) + ph;
        g.dots[i].position.set(
          g.center.x + Math.sin(t) * FIREFLY.spread * (0.4 + 0.6 * Math.sin(ph)),
          g.center.y + Math.sin(t * 1.7 + ph) * 0.35,
          g.center.z + Math.cos(t * 0.9 + ph) * FIREFLY.spread,
        );
      }
    }

    this.updateLamps(dt, playerPos);
  }

  /**
   * Настоящий свет достаётся ближайшим к игроку стайкам.
   *
   * Лампа не перескакивает на новую стайку сразу: сперва гаснет на старой и
   * только у самого нуля меняет хозяина. Иначе при ходьбе свет вспыхивал
   * разом, когда набор ближайших менялся.
   */
  private updateLamps(dt: number, playerPos: Vector3): void {
    const nearest = [...this.groups]
      .sort(
        (a, b) =>
          Vector3.DistanceSquared(a.center, playerPos) -
          Vector3.DistanceSquared(b.center, playerPos),
      )
      .slice(0, this.lamps.length);

    const k = 1 - Math.exp(-dt * 2.5); // скорость плавного перехода
    const taken = new Set(this.lamps.map((l) => l.group).filter(Boolean));

    for (const lamp of this.lamps) {
      const keeps = lamp.group !== null && nearest.includes(lamp.group);

      // Своя стайка уехала из ближайших — гасим, а не переключаемся рывком.
      if (!keeps && lamp.level < 0.02) {
        const free = nearest.find((g) => !taken.has(g));
        if (free) {
          taken.delete(lamp.group);
          lamp.group = free;
          taken.add(free);
        }
      }

      const g = lamp.group;
      const stillNear = g !== null && nearest.includes(g);
      let target = 0;
      if (g && stillNear) {
        const dist = Vector3.Distance(g.center, playerPos);
        const span = FIREFLY.lightFadeFrom - FIREFLY.lightFadeFull;
        const t = clamp01((FIREFLY.lightFadeFrom - dist) / span);
        target = t * t * (3 - 2 * t); // сглаживаем концы, чтобы не было ступеньки
      }
      lamp.level += (target - lamp.level) * k;

      if (g) lamp.light.position.copyFrom(g.center);
      const flicker = 0.85 + 0.15 * Math.sin(this.clock * 3 + this.lamps.indexOf(lamp));
      lamp.light.intensity = FIREFLY.lightIntensity * this.night * flicker * lamp.level;
    }
  }

  dispose(): void {
    for (const g of this.groups) {
      for (const d of g.dots) d.dispose();
      g.pool.dispose();
    }
    for (const l of this.lamps) l.light.dispose();
    this.proto.dispose();
    this.poolProto.dispose();
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Круглое пятно, плавно тающее к краям. Прозрачность падает по степени
 * расстояния и набирается многими остановками — иначе у края видно кольцо
 * или резкий обрыв.
 */
function radialGlow(scene: Scene): DynamicTexture {
  const S = 256;
  const tex = new DynamicTexture("fireflyGlow", { width: S, height: S }, scene, false);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, S, S);
  const grad = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  const STOPS = 24;
  for (let i = 0; i <= STOPS; i++) {
    const r = i / STOPS;
    const a = Math.pow(1 - r, 2.4); // мягкий, чуть более наполненный к центру спад
    grad.addColorStop(r, `rgba(255,255,255,${a.toFixed(4)})`);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  tex.update(true);
  return tex;
}
