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
import "@babylonjs/core/Meshes/Builders/discBuilder";

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
   * Сколько стаек реально светят. Точечных источников держим мало:
   * материалы по умолчанию берут не больше четырёх источников разом,
   * а солнце и небо уже занимают два.
   */
  lamps: 2,
  /** Докуда добивает свет одной стайки, м. */
  lightRange: 8,
  lightIntensity: 1.5,
  /** Радиус светового пятна на земле под стайкой, м. */
  poolRadius: 3.2,
  /** Насколько ярко пятно (0..1). */
  poolAlpha: 0.5,
  /** Скорость дрейфа стайки по округе, м/с. */
  driftSpeed: 0.45,
} as const;

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
export class Fireflies {
  private readonly groups: Group[] = [];
  private readonly lamps: PointLight[] = [];
  private readonly proto: Mesh;
  private readonly mat: StandardMaterial;
  private readonly poolProto: Mesh;
  private readonly poolMat: StandardMaterial;
  private clock = 0;
  /** Плавная доля ночи: 0 — день, 1 — глубокая ночь. */
  private night = 0;

  constructor(scene: Scene, terrain: Terrain) {
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

    // Пятно света на земле: мягкое к краям, складывается с тем, что под ним.
    this.poolMat = new StandardMaterial("fireflyPoolMat", scene);
    const glow = radialGlow(scene);
    this.poolMat.emissiveTexture = glow;
    this.poolMat.opacityTexture = glow;
    this.poolMat.diffuseColor = new Color3(0, 0, 0);
    this.poolMat.specularColor = new Color3(0, 0, 0);
    this.poolMat.emissiveColor = new Color3(1, 0.78, 0.22); // свет заметно желтее огонька
    this.poolMat.disableLighting = true;
    this.poolMat.alphaMode = Constants.ALPHA_ADD;
    this.poolMat.disableDepthWrite = true;
    this.poolMat.alpha = 0;

    this.poolProto = MeshBuilder.CreateDisc(
      "fireflyPoolProto",
      { radius: FIREFLY.poolRadius, tessellation: 20 },
      scene,
    );
    this.poolProto.rotation.x = Math.PI / 2; // кладём плашмя на землю
    this.poolProto.bakeCurrentTransformIntoVertices();
    this.poolProto.material = this.poolMat;
    this.poolProto.isPickable = false;
    this.poolProto.isVisible = false;
    this.poolProto.renderingGroupId = 0;

    const R = WORLD.grassRadius * 1.6;
    for (let g = 0; g < FIREFLY.groups; g++) {
      const a = (g / FIREFLY.groups) * Math.PI * 2 + Math.random();
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
      pool.position.set(x, terrain.heightAt(x, z) + 0.06, z);
      this.groups.push({ center, target: center.clone(), dots, phase, pool });
    }

    for (let i = 0; i < FIREFLY.lamps; i++) {
      const lamp = new PointLight(`fireflyLamp${i}`, Vector3.Zero(), scene);
      lamp.diffuse = new Color3(1, 0.78, 0.2); // свет желтее самих огоньков
      lamp.specular = new Color3(0.3, 0.22, 0.08);
      lamp.range = FIREFLY.lightRange;
      lamp.intensity = 0;
      lamp.setEnabled(false);
      this.lamps.push(lamp);
    }

    this.setVisible(false);
  }

  private setVisible(on: boolean): void {
    for (const g of this.groups) {
      for (const d of g.dots) d.setEnabled(on);
      g.pool.setEnabled(on);
    }
    for (const l of this.lamps) l.setEnabled(on);
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

      // Пятно едет за стайкой и лежит на земле, чуть подрагивая яркостью.
      g.pool.position.set(g.center.x, terrain.heightAt(g.center.x, g.center.z) + 0.06, g.center.z);

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

    // Настоящий свет достаётся ближайшим к игроку стайкам.
    const near = [...this.groups]
      .sort(
        (a, b) =>
          Vector3.DistanceSquared(a.center, playerPos) -
          Vector3.DistanceSquared(b.center, playerPos),
      )
      .slice(0, this.lamps.length);
    for (let i = 0; i < this.lamps.length; i++) {
      const g = near[i];
      if (!g) {
        this.lamps[i].intensity = 0;
        continue;
      }
      this.lamps[i].position.copyFrom(g.center);
      // Чуть мерцают — как настоящие.
      const flicker = 0.85 + 0.15 * Math.sin(this.clock * 3 + i);
      this.lamps[i].intensity = FIREFLY.lightIntensity * this.night * flicker;
    }
  }

  dispose(): void {
    for (const g of this.groups) {
      for (const d of g.dots) d.dispose();
      g.pool.dispose();
    }
    for (const l of this.lamps) l.dispose();
    this.proto.dispose();
    this.poolProto.dispose();
  }
}

/** Круглое пятно, мягко тающее к краям — заготовка для светового пятна. */
function radialGlow(scene: Scene): DynamicTexture {
  const S = 128;
  const tex = new DynamicTexture("fireflyGlow", { width: S, height: S }, scene, false);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, S, S);
  const grad = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  tex.update(true);
  return tex;
}
