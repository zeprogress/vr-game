import type { Scene } from "@babylonjs/core/scene";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { Node } from "@babylonjs/core/node";

/** Та же геометрия сжатого кулака, что и `FIST_ARC`/`THUMB_SWING` в player/Hands.ts. */
const FIST_ARC = 2.5;
const THUMB_SWING = 1.3;

/**
 * Перчатки для камеры спектатора «из глаз» у VR-игрока/бота (см.
 * Spectator.ts `updateEyeVisibility`). Своя, урезанная копия загрузки
 * `Hand.glb` из player/Hands.ts: та рассчитана на локальные VR-контроллеры
 * (анимирует сжатие по grip каждый кадр), тут руки чужие и всегда «держат
 * оружие» — хватает ОДНОЙ, один раз запечённой позы кулака, без рантайм-блендинга.
 */
export interface EyeGloves {
  /** Показать перчатки на костях кулаков этого бота (null — рука пуста, не показываем). */
  show(fistL: TransformNode | null, fistR: TransformNode | null): void;
  hide(): void;
}

let cache: Promise<{ left: Mesh; right: Mesh } | null> | null = null;

/** Печёт позу кулака из rest-геометрии — портировано из player/Hands.ts loadGlove(). */
function fistPose(rest: Float32Array, indices: number[]): { pos: Float32Array; idx: number[] } {
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
  const thumbXMax = minX + (maxX - minX) * 0.3;
  const thumbZLo = minZ + zSpan * 0.28;
  const thumbZHi = knuckleZ;
  const thumbPivot = { x: thumbXMax, z: (thumbZLo + thumbZHi) / 2 };

  const pos = new Float32Array(rest.length);
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
      pos[i] = x;
      pos[i + 1] = yc + dy * Math.cos(a);
      pos[i + 2] = zc + dy * Math.sin(a);
    } else if (x < thumbXMax && z > thumbZLo && z < thumbZHi) {
      const w = Math.min(1, (thumbXMax - x) / (thumbXMax - minX));
      const b = THUMB_SWING * w;
      const dx = x - thumbPivot.x;
      const dz = z - thumbPivot.z;
      pos[i] = thumbPivot.x + dx * Math.cos(b) + dz * Math.sin(b);
      pos[i + 1] = y - w * 0.1;
      pos[i + 2] = thumbPivot.z - dx * Math.sin(b) + dz * Math.cos(b);
    } else {
      pos[i] = x;
      pos[i + 1] = y;
      pos[i + 2] = z;
    }
  }
  return { pos, idx: indices };
}

async function loadTemplates(scene: Scene): Promise<{ left: Mesh; right: Mesh } | null> {
  try {
    await import("@babylonjs/loaders/glTF/2.0");
    const container = await LoadAssetContainerAsync("/models/Hand.glb", scene);
    for (const g of container.animationGroups) g.stop();
    const inst = container.instantiateModelsToScene((n) => n, false);
    const root = inst.rootNodes[0] as Node | undefined;
    const mesh = root
      ? (root.getChildMeshes(false).find((m) => m.getTotalVertices() > 0) as Mesh | undefined)
      : undefined;
    container.removeAllFromScene?.();
    if (!mesh) return null;

    mesh.setParent(null);
    mesh.bakeCurrentTransformIntoVertices();
    mesh.setEnabled(false);
    mesh.isPickable = false;

    const rest = new Float32Array(mesh.getVerticesData(VertexBuffer.PositionKind) as ArrayLike<number>);
    const indices = mesh.getIndices() as number[];
    const { pos: fistR, idx: idxR } = fistPose(rest, indices);

    const fileN = mesh.getVerticesData(VertexBuffer.NormalKind) as Float32Array | null;
    let flipN = false;
    if (fileN && fileN.length === rest.length) {
      const probe = new Float32Array(rest.length);
      VertexData.ComputeNormals(fistR, idxR, probe);
      let dot = 0;
      for (let i = 0; i < fileN.length; i++) dot += fileN[i] * probe[i];
      flipN = dot < 0;
    }
    const normalsFor = (p: Float32Array, idx: number[]): Float32Array => {
      const out = new Float32Array(p.length);
      VertexData.ComputeNormals(p, idx, out);
      if (flipN) for (let i = 0; i < out.length; i++) out[i] = -out[i];
      return out;
    };

    const mirrorX = (src: Float32Array): Float32Array => {
      const out = new Float32Array(src.length);
      for (let i = 0; i < src.length; i += 3) {
        out[i] = -src[i];
        out[i + 1] = src[i + 1];
        out[i + 2] = src[i + 2];
      }
      return out;
    };
    const idxL = idxR.slice();
    for (let i = 0; i < idxL.length; i += 3) {
      const t = idxL[i + 1];
      idxL[i + 1] = idxL[i + 2];
      idxL[i + 2] = t;
    }
    const fistL = mirrorX(fistR);

    const mat = new StandardMaterial("eyeGloveMat", scene);
    mat.diffuseColor = new Color3(0.5, 0.34, 0.21); // та же кожа, что у player/Hands.ts
    mat.emissiveColor = new Color3(0.035, 0.024, 0.016);
    mat.specularColor = new Color3(0.08, 0.07, 0.06);
    mat.specularPower = 32;
    mat.maxSimultaneousLights = 1;

    const build = (name: string, pos: Float32Array, idx: number[]): Mesh => {
      const m = new Mesh(name, scene);
      const vd = new VertexData();
      vd.positions = pos;
      vd.indices = idx;
      vd.normals = normalsFor(pos, idx);
      vd.applyToMesh(m, false);
      m.material = mat;
      m.isPickable = false;
      m.setEnabled(false);
      return m;
    };
    const right = build("eyeGloveR", fistR, idxR);
    const left = build("eyeGloveL", fistL, idxL);
    mesh.dispose();
    return { left, right };
  } catch (e) {
    console.warn("[eyeGloves] не удалось загрузить Hand.glb:", (e as Error).message);
    return null;
  }
}

export function createEyeGloves(scene: Scene): EyeGloves {
  if (!cache) cache = loadTemplates(scene);

  let left: Mesh | null = null;
  let right: Mesh | null = null;
  void cache.then((t) => {
    if (!t) return;
    left = t.left.clone("eyeGloveL_inst");
    right = t.right.clone("eyeGloveR_inst");
    if (left) {
      left.isPickable = false;
      left.setEnabled(false);
    }
    if (right) {
      right.isPickable = false;
      right.setEnabled(false);
    }
  });

  const seat = (m: Mesh, fist: TransformNode): void => {
    m.parent = fist;
    m.position.set(0, 0, 0);
    m.rotation.set(0, 0, 0);
    m.scaling.setAll(1);
    m.setEnabled(true);
  };

  return {
    show(fistL, fistR) {
      if (left) {
        if (fistL) seat(left, fistL);
        else left.setEnabled(false);
      }
      if (right) {
        if (fistR) seat(right, fistR);
        else right.setEnabled(false);
      }
    },
    hide() {
      left?.setEnabled(false);
      right?.setEnabled(false);
    },
  };
}
