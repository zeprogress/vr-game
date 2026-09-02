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
const FIST_ARC = 2.5;
/** Большой палец: поворот поперёк ладони (рад) и лёгкое опускание. */
const THUMB_SWING = 1.3;

interface Hand {
  side: Side;
  root: TransformNode;
  mesh: Mesh | null;
  controller: WebXRInputSource;
  curl: number;
  scratch: Float32Array | null;
  scratchN: Float32Array | null;
}

/** Позы одной кисти: покой и кулак, с нормалями и порядком обхода треугольников. */
interface HandPose {
  rest: Float32Array;
  fist: Float32Array;
  restN: Float32Array;
  fistN: Float32Array;
  indices: number[];
}

interface Glove {
  template: Mesh;
  /**
   * Левая кисть — не отражённая масштабом (−X ломает нормали и освещение),
   * а зеркальная геометрия со своим порядком обхода и пересчитанными
   * нормалями. Масштаб обеих рук положительный.
   */
  left: HandPose;
  right: HandPose;
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
    this.skin.diffuseColor = new Color3(0.5, 0.34, 0.21); // кожаная перчатка
    // Мало собственной яркости — чтобы форму кисти лепил направленный свет,
    // а не заливал ровный эмиссив (руки казались плоскими).
    this.skin.emissiveColor = new Color3(0.035, 0.024, 0.016);
    this.skin.specularColor = new Color3(0.08, 0.07, 0.06);
    this.skin.specularPower = 32;
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
      const zSpan = Math.max(1e-4, maxZ - minZ);
      const knuckleZ = minZ + zSpan * 0.62;
      const fingerLen = Math.max(1e-4, maxZ - knuckleZ);
      const kappa = FIST_ARC / fingerLen;

      // Большой палец сидит сбоку на уровне ладони (−X, середина по Z; пальцев
      // там нет). Отсекаем именно его, ладонь/мизинец не трогаем.
      const thumbXMax = minX + (maxX - minX) * 0.3;
      const thumbZLo = minZ + zSpan * 0.28;
      const thumbZHi = knuckleZ;
      const thumbPivot = { x: thumbXMax, z: (thumbZLo + thumbZHi) / 2 };

      const fist = new Float32Array(rest.length);
      for (let i = 0; i < rest.length; i += 3) {
        const x = rest[i];
        const y = rest[i + 1];
        const z = rest[i + 2];
        const s = z - knuckleZ;
        if (s > 0) {
          // Пальцы: изгиб по дуге вниз-внутрь.
          const a = kappa * s;
          const zc = knuckleZ + Math.sin(a) / kappa;
          const yc = hingeY - (1 - Math.cos(a)) / kappa;
          const dy = y - hingeY;
          fist[i] = x;
          fist[i + 1] = yc + dy * Math.cos(a);
          fist[i + 2] = zc + dy * Math.sin(a);
        } else if (x < thumbXMax && z > thumbZLo && z < thumbZHi) {
          // Большой палец: поворот поперёк ладони (вокруг Y) + вниз.
          const w = Math.min(1, (thumbXMax - x) / (thumbXMax - minX));
          const b = THUMB_SWING * w;
          const dx = x - thumbPivot.x;
          const dz = z - thumbPivot.z;
          fist[i] = thumbPivot.x + dx * Math.cos(b) + dz * Math.sin(b);
          fist[i + 1] = y - w * 0.1;
          fist[i + 2] = thumbPivot.z - dx * Math.sin(b) + dz * Math.cos(b);
        } else {
          fist[i] = x;
          fist[i + 1] = y;
          fist[i + 2] = z;
        }
      }

      // glTF из FBX иногда приходит с обратным обходом треугольников — тогда
      // ComputeNormals смотрит ВНУТРЬ, и свет на руке кажется идущим снизу.
      // Сверяем с нормалями из файла и при расхождении переворачиваем.
      const fileN = mesh.getVerticesData(VertexBuffer.NormalKind) as Float32Array | null;
      let flipN = false;
      if (fileN && fileN.length === rest.length) {
        const probe = new Float32Array(rest.length);
        VertexData.ComputeNormals(rest, indices, probe);
        let dot = 0;
        for (let i = 0; i < fileN.length; i++) dot += fileN[i] * probe[i];
        flipN = dot < 0;
      }
      const normalsFor = (pos: Float32Array, idx: number[]): Float32Array => {
        const out = new Float32Array(pos.length);
        VertexData.ComputeNormals(pos, idx, out);
        if (flipN) for (let i = 0; i < out.length; i++) out[i] = -out[i];
        return out;
      };
      // Зеркало по X + разворот обхода треугольников (иначе вывернутся наружу).
      const mirrorX = (src: Float32Array): Float32Array => {
        const out = new Float32Array(src.length);
        for (let i = 0; i < src.length; i += 3) {
          out[i] = -src[i];
          out[i + 1] = src[i + 1];
          out[i + 2] = src[i + 2];
        }
        return out;
      };
      const indicesL = indices.slice();
      for (let i = 0; i < indicesL.length; i += 3) {
        const t = indicesL[i + 1];
        indicesL[i + 1] = indicesL[i + 2];
        indicesL[i + 2] = t;
      }
      const restL = mirrorX(rest);
      const fistL = mirrorX(fist);

      this.glove = {
        template: mesh,
        right: { rest, fist, restN: normalsFor(rest, indices), fistN: normalsFor(fist, indices), indices },
        left: {
          rest: restL,
          fist: fistL,
          restN: normalsFor(restL, indicesL),
          fistN: normalsFor(fistL, indicesL),
          indices: indicesL,
        },
      };
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
      const pose = g[h.side];
      h.mesh.scaling.setAll(cfg.scale); // масштаб положительный — зеркалит геометрия

      const btn = h.controller.inputSource.gamepad?.buttons[1];
      const grip = btn ? btn.value || (btn.pressed ? 1 : 0) : 0;
      const target = Math.min(1, grip * cfg.curl); // «сгиб» — множитель силы
      h.curl += (target - h.curl) * Math.min(1, dt * 18);
      const c = h.curl;

      if (c < 0.002) {
        h.mesh.updateVerticesData(VertexBuffer.PositionKind, pose.rest, false, false);
        h.mesh.updateVerticesData(VertexBuffer.NormalKind, pose.restN, false, false);
        continue;
      }
      const p = h.scratch;
      const n = h.scratchN;
      for (let i = 0; i < pose.rest.length; i++) {
        p[i] = pose.rest[i] + (pose.fist[i] - pose.rest[i]) * c;
        n[i] = pose.restN[i] + (pose.fistN[i] - pose.restN[i]) * c;
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
    const pose = g[hand.side];
    const mesh = g.template.clone(`hand_${hand.side}_mesh`, hand.root);
    mesh.makeGeometryUnique(); // свой буфер вершин
    mesh.setIndices(pose.indices.slice()); // у левой — свой (развёрнутый) обход
    // Пере-создаём буферы позиции/нормалей как ОБНОВЛЯЕМЫЕ (у glTF они статичные,
    // и updateVerticesData по ним молча ничего не делает — рука не сжималась).
    mesh.setVerticesData(VertexBuffer.PositionKind, pose.rest.slice(), true);
    mesh.setVerticesData(VertexBuffer.NormalKind, pose.restN.slice(), true);
    mesh.setEnabled(true);
    mesh.material = this.skin;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.rotation.set(0, 0, 0);
    mesh.position.set(0, 0, 0);
    mesh.scaling.setAll(LOADOUT.hands[hand.side].scale);
    hand.mesh = mesh;
    hand.scratch = new Float32Array(pose.rest.length);
    hand.scratchN = new Float32Array(pose.rest.length);
  }
}
