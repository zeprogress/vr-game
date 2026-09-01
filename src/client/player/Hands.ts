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

/** Тонкая настройка посадки модели кисти. `game.hands.tune({scale:0.14})`. */
const FIT = {
  scale: Number(new URLSearchParams(location.search).get("hscale")) || 0.135,
  /** Базовый доворот модели (пальцы модели по +Z, наши — по −Z). */
  yaw: Math.PI,
  /** Насколько сгибать кончики пальцев в кулаке, рад. */
  curlMax: 2.2,
};

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

  // ---- подкрутка из консоли (пишет в живой LOADOUT) ----

  set(side: Side, x: number, y: number, z: number): void {
    LOADOUT.hands[side] = [x, y, z];
    this.print();
  }

  rotate(side: Side, dx: number, dy: number, dz: number): void {
    const r = LOADOUT.hands[side];
    this.set(side, r[0] + dx, r[1] + dy, r[2] + dz);
  }

  turn(side: Side, axis: "x" | "y" | "z", quarters = 1): void {
    const d = (Math.PI / 2) * quarters;
    this.rotate(side, axis === "x" ? d : 0, axis === "y" ? d : 0, axis === "z" ? d : 0);
  }

  tune(patch: Partial<typeof FIT>): void {
    Object.assign(FIT, patch);
    for (const h of this.hands) this.placeMesh(h);
    console.log("hand FIT:", JSON.stringify(FIT));
  }

  print(): void {
    const f = (a: [number, number, number]) => a.map((v) => v.toFixed(3)).join(", ");
    console.log(
      `hands: {\n  left: [${f(LOADOUT.hands.left)}],\n  right: [${f(LOADOUT.hands.right)}],\n}`,
    );
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

      // Ось пальцев — Z: −Z запястье, +Z кончики. Y — толщина кисти.
      let minZ = Infinity;
      let maxZ = -Infinity;
      let sumY = 0;
      for (let i = 0; i < rest.length; i += 3) {
        minZ = Math.min(minZ, rest[i + 2]);
        maxZ = Math.max(maxZ, rest[i + 2]);
        sumY += rest[i + 1];
      }
      const hingeY = sumY / (rest.length / 3);
      const knuckleZ = minZ + (maxZ - minZ) * 0.62;
      const fingerLen = Math.max(1e-4, maxZ - knuckleZ);
      const kappa = FIT.curlMax / fingerLen;

      // Поза кулака: «пальцевые» вершины (z > knuckleZ) гнём по дуге вниз-внутрь.
      const fist = new Float32Array(rest.length);
      for (let i = 0; i < rest.length; i += 3) {
        const x = rest[i];
        const y = rest[i + 1];
        const z = rest[i + 2];
        const s = z - knuckleZ;
        if (s <= 0) {
          fist[i] = x;
          fist[i + 1] = y;
          fist[i + 2] = z;
          continue;
        }
        const a = kappa * s; // угол дуги в этой точке
        const zc = knuckleZ + Math.sin(a) / kappa;
        const yc = hingeY - (1 - Math.cos(a)) / kappa;
        const dy = y - hingeY;
        fist[i] = x;
        fist[i + 1] = yc + dy * Math.cos(a);
        fist[i + 2] = zc + dy * Math.sin(a);
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
      const r = LOADOUT.hands[h.side];
      h.root.rotation.set(r[0], r[1], r[2]);

      if (!g || !h.mesh || !h.scratch || !h.scratchN) continue;
      const btn = h.controller.inputSource.gamepad?.buttons[1];
      const target = btn ? btn.value || (btn.pressed ? 1 : 0) : 0;
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
    const r = LOADOUT.hands[side];
    root.rotation.set(r[0], r[1], r[2]);

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
    mesh.makeGeometryUnique(); // свой буфер вершин — деформируем независимо
    mesh.setEnabled(true);
    mesh.material = this.skin;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    hand.mesh = mesh;
    hand.scratch = new Float32Array(g.rest.length);
    hand.scratchN = new Float32Array(g.rest.length);
    this.placeMesh(hand);
  }

  private placeMesh(hand: Hand): void {
    if (!hand.mesh) return;
    // Левая кисть — зеркало по X (Babylon сам инвертирует отсечение граней).
    hand.mesh.scaling.set(hand.side === "left" ? -FIT.scale : FIT.scale, FIT.scale, FIT.scale);
    hand.mesh.rotation.set(0, FIT.yaw, 0);
    hand.mesh.position.set(0, 0, 0);
  }
}
