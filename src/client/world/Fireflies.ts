import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";

import { WORLD } from "#shared/constants";
import type { Terrain } from "./Terrain";

export const FIREFLY = {
  /** Сколько стаек по округе. */
  groups: 6,
  /** Огоньков в стайке. */
  perGroup: 7,
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
  lightRange: 7,
  lightIntensity: 0.9,
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
}

/**
 * Светлячки: ночью по округе висят стайки огоньков и подсвечивают всё
 * вокруг себя, днём исчезают.
 *
 * Огоньки — аппаратные инстансы одного меша (один драв-колл на всех).
 * Светят при этом не все: настоящих источников света всего пара, и они
 * переезжают к тем стайкам, что ближе к игроку.
 */
export class Fireflies {
  private readonly groups: Group[] = [];
  private readonly lamps: PointLight[] = [];
  private readonly proto: Mesh;
  private readonly mat: StandardMaterial;
  private clock = 0;
  /** Плавная доля ночи: 0 — день, 1 — глубокая ночь. */
  private night = 0;

  constructor(scene: Scene, terrain: Terrain) {
    this.mat = new StandardMaterial("fireflyMat", scene);
    this.mat.emissiveColor = new Color3(0.85, 0.95, 0.45);
    this.mat.diffuseColor = new Color3(0, 0, 0);
    this.mat.specularColor = new Color3(0, 0, 0);
    this.mat.disableLighting = true;
    this.mat.alpha = 0;

    this.proto = MeshBuilder.CreateSphere("fireflyProto", { diameter: 0.07, segments: 4 }, scene);
    this.proto.material = this.mat;
    this.proto.isPickable = false;
    this.proto.isVisible = false;

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
      this.groups.push({ center, target: center.clone(), dots, phase });
    }

    for (let i = 0; i < FIREFLY.lamps; i++) {
      const lamp = new PointLight(`fireflyLamp${i}`, Vector3.Zero(), scene);
      lamp.diffuse = new Color3(0.8, 0.95, 0.5);
      lamp.specular = new Color3(0.2, 0.25, 0.1);
      lamp.range = FIREFLY.lightRange;
      lamp.intensity = 0;
      lamp.setEnabled(false);
      this.lamps.push(lamp);
    }

    this.setVisible(false);
  }

  private setVisible(on: boolean): void {
    for (const g of this.groups) for (const d of g.dots) d.setEnabled(on);
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
    for (const g of this.groups) for (const d of g.dots) d.dispose();
    for (const l of this.lamps) l.dispose();
    this.proto.dispose();
  }
}
