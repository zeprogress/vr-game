import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { Node } from "@babylonjs/core/node";
import type { WebXRDefaultExperience } from "@babylonjs/core/XR/webXRDefaultExperience";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { WebXRInputSource } from "@babylonjs/core/XR/webXRInputSource";

import { LOADOUT } from "../config/loadout";

export type Side = "left" | "right";

/** Опорная поза кулака: пальцы гнутся на этот угол (рад), сила регулируется
 *  множителем `LOADOUT.hands[side].curl` в blend'е. */
const FIST_ARC = 3.0;

interface Hand {
  side: Side;
  root: TransformNode;
  mesh: Mesh | null;
  controller: WebXRInputSource;
  curl: number;
  scratch: Float32Array | null;
  scratchN: Float32Array | null;
}

interface Glove {
  template: Mesh;
  rest: Float32Array;
  fist: Float32Array;
  restN: Float32Array;
  fistN: Float32Array;
}

/**
 * Кисти на контроллерах: модель-перчатка (`public/models/Hand.glb`), сжимается
 * в кулак по grip. Скелета у модели нет — «кулак» считаем один раз изгибом
 * вершин пальцев по дуге, дальше каждый кадр линейно мешаем rest↔fist по
 * аналоговому значению grip.
 *
 * Ориентация кистей — `LOADOUT.hands` (правится на лету, пишется в файл).
 * Из консоли: `game.hands.turn("left","y")`, `game.hands.tune({scale:0.14})`.
 */
export class Hands {
  private readonly hands: Hand[] = [];
  private addObs: Observer<WebXRInputSource> | null = null;
  private removeObs: Observer<WebXRInputSource> | null = null;
  private readonly skin: StandardMaterial;
  private glove: Glove | null = null;

  constructor(private readonly scene: Scene) {
    this.skin = new StandardMaterial("handSkin", scene);
    this.skin.diffuseColor = new Color3(0.34, 0.22, 0.14); // кожаная перчатка
    this.skin.emissiveColor = new Color3(0.06, 0.04, 0.03);
    this.skin.specularColor = new Color3(0.05, 0.05, 0.05);
    void this.loadGlove();
  }

  // ---- подкрутка из консоли (всё то же есть в меню настроек) ----

  rotate(side: Side, dx: number, dy: number, dz: number): void {
    const r = LOADOUT.hands[side].rot;
    r[0] += dx;
    r[1] += dy;
    r[2] += dz;
    this.print();
  }

  turn(side: Side, axis: "x" | "y" | "z", quarters = 1): void {
    const d = (Math.PI / 2) * quarters;
    this.rotate(side, axis === "x" ? d : 0, axis === "y" ? d : 0, axis === "z" ? d : 0);
  }

  print(): void {
    console.log("hands:", JSON.stringify(LOADOUT.hands));
  }

  // ---- загрузка модели + расчёт позы кулака ----

  private async loadGlove(): Promise<void> {
    try {
      await import("@babylonjs/loaders/glTF/2.0"); // регистрирует glTF-загрузчик
      const container = await LoadAssetContainerAsync("/models/Hand.glb", this.scene);
      const inst = container.instantiateModelsToScene((n) => n, false);
      const root = inst.rootNodes[0] as Node | undefined;
      const mesh = root
        ? (root.getChildMeshes(false).find((m) => m.getTotalVertices() > 0) as Mesh | undefined)
        : undefined;
      container.removeAllFromScene?.();
      if (!mesh) return;

      // Спекаем всю иерархию трансформа (FBX −90°X + масштаб 100 + флип glTF)
      // в вершины: дальше работаем с чистой геометрией.
      mesh.setParent(null);
      mesh.bakeCurrentTransformIntoVertices();
      mesh.setEnabled(false);
      mesh.isPickable = false;

      const rest = new Float32Array(
        mesh.getVerticesData(VertexBuffer.PositionKind) as ArrayLike<number>,
      );
      const indices = mesh.getIndices() as number[];

      // Ось пальцев — Z: −Z запястье, +Z кончики. Y — толщина кисти. X — вширь.
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      let sumY = 0;
      for (let i = 0; i < rest.length; i += 3) {
        minX = Math.min(minX, rest[i]);
        maxX = Math.max(maxX, rest[i]);
        minZ = Math.min(minZ, rest[i + 2]);
        maxZ = Math.max(maxZ, rest[i + 2]);
        sumY += rest[i + 1];
      }
      const hingeY = sumY / (rest.length / 3);
      const knuckleZ = minZ + (maxZ - minZ) * 0.62;
      const fingerLen = Math.max(1e-4, maxZ - knuckleZ);
      const kappa = FIST_ARC / fingerLen;
      const spanX = Math.max(1e-4, maxX - minX);

      // Поза кулака: пальцы (z > knuckleZ) гнём по дуге вниз-внутрь; большой
      // палец / край ладони (низ по Z, край по X) поджимаем к центру.
      const fist = new Float32Array(rest.length);
      for (let i = 0; i < rest.length; i += 3) {
        const x = rest[i];
        const y = rest[i + 1];
        const z = rest[i + 2];
        const s = z - knuckleZ;
        if (s > 0) {
          const a = kappa * s;
          const zc = knuckleZ + Math.sin(a) / kappa;
          const yc = hingeY - (1 - Math.cos(a)) / kappa;
          const dy = y - hingeY;
          fist[i] = x;
          fist[i + 1] = yc + dy * Math.cos(a);
          fist[i + 2] = zc + dy * Math.sin(a);
          continue;
        }
        // Ладонь/большой палец: чем дальше от центра по X и чем ближе к
        // костяшкам по Z, тем сильнее поджимаем к центру и вниз.
        const zw = Math.max(0, (z - minZ) / (knuckleZ - minZ)); // 0 у запястья, 1 у костяшек
        const xw = Math.min(1, (Math.abs(x) / (spanX * 0.5)) ** 1.5); // 0 в центре, 1 по краю
        const w = zw * xw;
        fist[i] = x * (1 - w * 0.85);
        fist[i + 1] = y - w * 0.22;
        fist[i + 2] = z + w * 0.12; // чуть вперёд — палец ложится на кулак
      }

      const restN = new Float32Array(rest.length);
      const fistN = new Float32Array(rest.length);
      VertexData.ComputeNormals(rest, indices, restN);
      VertexData.ComputeNormals(fist, indices, fistN);

      this.glove = { template: mesh, rest, fist, restN, fistN };
      for (const h of this.hands) this.buildMesh(h);
    } catch {
      /* нет модели — руки не появятся, игра работает */
    }
  }

  // ---- жизненный цикл ----

  attach(xr: WebXRDefaultExperience): void {
    for (const c of xr.input.controllers) this.onController(c);
    this.addObs = xr.input.onControllerAddedObservable.add((c) => this.onController(c));
    this.removeObs = xr.input.onControllerRemovedObservable.add((c) => this.onRemove(c));
  }

  detach(xr: WebXRDefaultExperience): void {
    xr.input.onControllerAddedObservable.remove(this.addObs);
    xr.input.onControllerRemovedObservable.remove(this.removeObs);
    for (const h of this.hands) h.root.dispose(false, true);
    this.hands.length = 0;
  }

  /** Каждый кадр: ориентация кисти из LOADOUT + сжатие пальцев по grip. */
  update(dt: number): void {
    const g = this.glove;
    for (const h of this.hands) {
      const cfg = LOADOUT.hands[h.side];
      // Ориентация — на корень (предметы в руке идут вместе с кистью).
      h.root.rotation.set(cfg.rot[0], cfg.rot[1], cfg.rot[2]);

      if (!g || !h.mesh || !h.scratch || !h.scratchN) continue;
      const sc = cfg.scale;
      h.mesh.scaling.set(h.side === "left" ? -sc : sc, sc, sc); // размер меняется на лету

      const btn = h.controller.inputSource.gamepad?.buttons[1];
      const grip = btn ? btn.value || (btn.pressed ? 1 : 0) : 0;
      const target = Math.min(1, grip * cfg.curl); // «сгиб» — множитель силы
      h.curl += (target - h.curl) * Math.min(1, dt * 18);
      const c = h.curl;

      if (c < 0.002) {
        h.mesh.updateVerticesData(VertexBuffer.PositionKind, g.rest, false, false);
        h.mesh.updateVerticesData(VertexBuffer.NormalKind, g.restN, false, false);
        continue;
      }
      const p = h.scratch;
      const n = h.scratchN;
      for (let i = 0; i < g.rest.length; i++) {
        p[i] = g.rest[i] + (g.fist[i] - g.rest[i]) * c;
        n[i] = g.restN[i] + (g.fistN[i] - g.restN[i]) * c;
      }
      h.mesh.updateVerticesData(VertexBuffer.PositionKind, p, false, false);
      h.mesh.updateVerticesData(VertexBuffer.NormalKind, n, false, false);
    }
  }

  /** Узел кисти — к нему цепляются предметы и панель. */
  nodeFor(side: Side): TransformNode | null {
    return this.hands.find((h) => h.side === side)?.root ?? null;
  }

  private onController(c: WebXRInputSource): void {
    const anchor = c.grip ?? c.pointer;
    if (!anchor) return;
    const side: Side = c.inputSource.handedness === "left" ? "left" : "right";
    if (this.hands.some((h) => h.side === side)) return;

    const root = new TransformNode(`hand_${side}`, this.scene);
    root.parent = anchor;
    const rot = LOADOUT.hands[side].rot;
    root.rotation.set(rot[0], rot[1], rot[2]);

    const hand: Hand = {
      side,
      root,
      mesh: null,
      controller: c,
      curl: 0,
      scratch: null,
      scratchN: null,
    };
    this.hands.push(hand);
    if (this.glove) this.buildMesh(hand);
  }

  private onRemove(c: WebXRInputSource): void {
    const side: Side = c.inputSource.handedness === "left" ? "left" : "right";
    const i = this.hands.findIndex((h) => h.side === side);
    if (i >= 0) {
      this.hands[i].root.dispose(false, true);
      this.hands.splice(i, 1);
    }
  }

  private buildMesh(hand: Hand): void {
    const g = this.glove;
    if (!g || hand.mesh) return;
    const mesh = g.template.clone(`hand_${hand.side}_mesh`, hand.root);
    mesh.makeGeometryUnique(); // свой буфер вершин
    // Пере-создаём буферы позиции/нормалей как ОБНОВЛЯЕМЫЕ (у glTF они статичные,
    // и updateVerticesData по ним молча ничего не делает — рука не сжималась).
    mesh.setVerticesData(VertexBuffer.PositionKind, g.rest.slice(), true);
    mesh.setVerticesData(VertexBuffer.NormalKind, g.restN.slice(), true);
    mesh.setEnabled(true);
    mesh.material = this.skin;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.rotation.set(0, 0, 0);
    mesh.position.set(0, 0, 0);
    const sc = LOADOUT.hands[hand.side].scale;
    mesh.scaling.set(hand.side === "left" ? -sc : sc, sc, sc);
    hand.mesh = mesh;
    hand.scratch = new Float32Array(g.rest.length);
    hand.scratchN = new Float32Array(g.rest.length);
  }
}
