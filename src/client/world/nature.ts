import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { Vector3, Matrix, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import "@babylonjs/core/Meshes/thinInstanceMesh";

import { trees as treeList } from "#shared/trees";
import { rocks as rockList } from "#shared/rocks";
import type { Terrain } from "./Terrain";
import { GrassWindPlugin, WIND } from "./GrassWind";
import { LIGHT_BUDGET } from "./Fireflies";
import { computeGrassLayout } from "./grassLayout";

/**
 * Деревья и трава из внешнего пака (Stylized Nature MegaKit, CC0-ish).
 * Модели textured (листья/трава — alpha-cut), кора перекрашена в плоский цвет.
 * glTF-загрузчик тяжёлый — модуль подгружается лениво из Zone.
 */

const TREE_KINDS = [
  "CommonTree_1",
  "CommonTree_2",
  "CommonTree_3",
  "CommonTree_4",
  "CommonTree_5",
];
/** Множитель к размеру дерева поверх scale из общего списка. */
const TREE_SCALE = 1.15;

const ROCK_KINDS = ["Rock_Medium_1", "Rock_Medium_2", "Rock_Medium_3"];

function leafMaterial(scene: Scene, tex: BaseTexture | undefined, lite: boolean): StandardMaterial {
  const m = new StandardMaterial("treeLeaf", scene);
  if (tex) {
    tex.hasAlpha = true;
    m.diffuseTexture = tex;
    m.useAlphaFromDiffuseTexture = true;
    m.transparencyMode = 1; // ALPHATEST — дёшево, без сортировки
    m.alphaCutOff = 0.28;
  }
  m.diffuseColor = new Color3(0.72, 0.82, 0.6);
  m.emissiveColor = new Color3(0.12, 0.18, 0.09); // листва вертикальная — ей нужно больше своей яркости
  m.specularColor = new Color3(0, 0, 0);
  m.backFaceCulling = false;
  m.maxSimultaneousLights = lite ? 2 : 5;
  return m;
}

function barkMaterial(scene: Scene, lite: boolean): StandardMaterial {
  const m = new StandardMaterial("treeBark", scene);
  m.diffuseColor = new Color3(0.3, 0.2, 0.13);
  // Почти без собственной яркости: верхушки стволов не должны «светиться»
  // ночью. Днём их лепит солнце, ночью пусть уходят в темноту.
  m.emissiveColor = new Color3(0.02, 0.013, 0.008);
  m.specularColor = new Color3(0, 0, 0);
  m.maxSimultaneousLights = lite ? 2 : 5;
  return m;
}

/** Расставить 26 деревьев из общего списка (позиции — те же, что на сервере). */
export async function loadTrees(scene: Scene, terrain: Terrain, lite: boolean): Promise<void> {
  await import("@babylonjs/loaders/glTF/2.0");
  // По одному, с отловом: в шлеме бывает, что один файл не доехал —
  // пусть не роняет весь лес, а просто станет меньше видов деревьев.
  const settled = await Promise.all(
    TREE_KINDS.map((k) =>
      LoadAssetContainerAsync(`/models/nature/${k}.gltf`, scene).catch((e) => {
        console.warn(`[nature] дерево ${k} не загрузилось`, e);
        return null;
      }),
    ),
  );
  const containers = settled.filter((c): c is NonNullable<typeof c> => c !== null);
  if (containers.length === 0) return;

  const bark = barkMaterial(scene, lite);
  const leaf = leafMaterial(scene, containers[0].textures[0], lite);

  treeList().forEach((t, i) => {
    const c = containers[i % containers.length];
    const inst = c.instantiateModelsToScene((n) => n, false);
    const root = inst.rootNodes[0] as TransformNode | undefined;
    if (!root) return;
    root.position.set(t.x, terrain.heightAt(t.x, t.z) - 0.15, t.z);
    root.rotationQuaternion = Quaternion.RotationYawPitchRoll(t.yaw, 0, 0);
    root.scaling.setAll(TREE_SCALE * t.scale);

    for (const mesh of root.getChildMeshes(false)) {
      const isLeaf = /leaf|leav/i.test(mesh.material?.name ?? "");
      mesh.material = isLeaf ? leaf : bark;
      // Ствол — тоньше (у модели раздутое основание), крона — чуть шире и ниже.
      if (isLeaf) mesh.scaling.set(1.15, 0.92, 1.15);
      else mesh.scaling.set(0.62, 1, 0.62);
      mesh.isPickable = false;
      mesh.doNotSyncBoundingInfo = true;
      mesh.alwaysSelectAsActiveMesh = true; // дерево статично — bbox не считаем
      mesh.freezeWorldMatrix();
    }
    root.freezeWorldMatrix();
  });
  bark.freeze();
  leaf.freeze();
}

/** Трава thin-инстансами. Возвращает тик ветра (dt, daylight). */
export async function loadGrass(
  scene: Scene,
  terrain: Terrain,
  density: number,
  lite: boolean,
): Promise<(dt: number, daylight: number) => void> {
  if (density <= 0) return () => {};
  await import("@babylonjs/loaders/glTF/2.0");
  const container = await LoadAssetContainerAsync("/models/nature/Grass_Common_Short.gltf", scene);
  const inst = container.instantiateModelsToScene((n) => n, false);
  const root = inst.rootNodes[0] as TransformNode | undefined;
  const blade = root
    ?.getChildMeshes(false)
    .find((m) => m.getTotalVertices() > 0) as Mesh | undefined;
  if (!blade) return () => {};

  // Спекаем трансформ узла (FBX) в вершины: thin-инстансам нужен чистый меш,
  // низ пучка на y = 0 (ветер гнёт по высоте вершины).
  blade.setParent(null);
  blade.bakeCurrentTransformIntoVertices();

  // В модель запечён сильный AO у корней (вершинные цвета) — почти чёрный.
  // Приподнимаем нижний край градиента, кончики оставляем как есть.
  const vcol = blade.getVerticesData(VertexBuffer.ColorKind);
  if (vcol) {
    for (let i = 0; i < vcol.length; i += 4) {
      vcol[i] = 0.42 + vcol[i] * 0.48;
      vcol[i + 1] = 0.42 + vcol[i + 1] * 0.48;
      vcol[i + 2] = 0.42 + vcol[i + 2] * 0.48;
    }
    blade.setVerticesData(VertexBuffer.ColorKind, vcol, false);
  }

  const mat = new StandardMaterial("grassMat", scene);
  const tex = container.textures[0];
  if (tex) {
    tex.hasAlpha = true;
    mat.diffuseTexture = tex;
    mat.useAlphaFromDiffuseTexture = true;
    mat.transparencyMode = 1;
    mat.alphaCutOff = 0.3;
  }
  mat.diffuseColor = new Color3(0.5, 0.72, 0.38);
  // Собственная яркость травы (вертикальные травинки ловят меньше света сверху).
  // Днём — полная, ночью гаснет почти в ноль: иначе трава «светится» в темноте
  // и лужицы света от светлячков в ней тонут. Модулируется в тике ниже.
  const emiDay = new Color3(0.11, 0.2, 0.09);
  mat.emissiveColor = emiDay.clone();
  mat.specularColor = new Color3(0, 0, 0);
  mat.backFaceCulling = false;
  mat.maxSimultaneousLights = lite ? 2 : LIGHT_BUDGET;
  blade.material = mat;
  blade.useVertexColors = true; // приподнятый AO-градиент из вершин (см. выше)
  blade.isPickable = false;
  blade.name = "grassBlade";
  blade.setEnabled(true);

  const wind = new GrassWindPlugin(mat);

  // Раскладка (позиции клякс и травинок) — общая с Terrain.ts (AO под травой,
  // см. bakeAo): чистая функция одного зерна, поэтому оба места получают
  // одну и ту же карту независимо друг от друга.
  const layout = computeGrassLayout(density);
  const matrices: Matrix[] = [];
  const phases: number[] = [];
  const colors: number[] = [];
  const up = new Vector3(0, 1, 0);

  for (const bl of layout.blades) {
    const y = terrain.heightAt(bl.x, bl.z);
    matrices.push(
      Matrix.Compose(
        new Vector3(bl.s, bl.s * bl.heightMul, bl.s),
        Quaternion.RotationAxis(up, bl.yaw),
        new Vector3(bl.x, y - 0.03, bl.z),
      ),
    );
    phases.push((bl.x * WIND.dirX + bl.z * WIND.dirZ) * 0.55);
    colors.push(bl.b + bl.warm * 0.7, bl.b + bl.warm * 0.15, bl.b - bl.warm * 0.5, 1);
  }

  blade.thinInstanceAdd(matrices);
  blade.thinInstanceSetBuffer("windPhase", new Float32Array(phases), 1, true);
  blade.thinInstanceSetBuffer("color", new Float32Array(colors), 4, true);

  return (dt: number, daylight: number) => {
    wind.scale += (daylight - wind.scale) * Math.min(1, dt * 0.6);
    wind.time += dt * WIND.speed * Math.max(wind.scale, 0.05);
    // Гасим собственную яркость к ночи (остаток чуть больше — трава ночью
    // не должна проваливаться в полную черноту).
    const k = 0.2 + 0.8 * daylight;
    mat.emissiveColor.copyFromFloats(emiDay.r * k, emiDay.g * k, emiDay.b * k);
  };
}

/**
 * Камни из пака: по одному под каждой точкой стартового оружия + разбросаны по
 * карте (позиции из `#shared/rocks`). Крупные — с коллизией (см. props.ts).
 */
export async function loadRocks(
  scene: Scene,
  terrain: Terrain,
  homes: Vector3[],
): Promise<void> {
  await import("@babylonjs/loaders/glTF/2.0");
  const containers = await Promise.all(
    ROCK_KINDS.map((k) => LoadAssetContainerAsync(`/models/nature/${k}.gltf`, scene)),
  );
  // Небольшой пул материалов с разбросом по яркости/оттенку — камни не однотонные.
  const mats = Array.from({ length: 6 }, (_, i) => {
    const m = new StandardMaterial(`rockMat${i}`, scene);
    const b = 0.22 + (i / 5) * 0.22; // 0.22..0.44 — только яркость
    const warm = (i % 3) * 0.015 - 0.015; // −0.015..+0.015, чуть тёплый/холодный
    m.diffuseColor = new Color3(b + warm, b, b - warm * 0.5);
    m.emissiveColor = new Color3(b * 0.12, b * 0.12, b * 0.12);
    m.specularColor = new Color3(0, 0, 0);
    m.maxSimultaneousLights = 5;
    m.freeze();
    return m;
  });

  const place = (
    kind: number,
    x: number,
    z: number,
    s: number,
    yaw: number,
    tiltX: number,
    tiltZ: number,
  ): void => {
    const inst = containers[kind % containers.length].instantiateModelsToScene((n) => n, false);
    const root = inst.rootNodes[0] as TransformNode | undefined;
    if (!root) return;
    root.position.set(x, terrain.heightAt(x, z) - s * 0.35, z); // чуть врос в землю
    root.rotationQuaternion = Quaternion.RotationYawPitchRoll(yaw, tiltX, tiltZ);
    root.scaling.setAll(s);
    const rm = mats[Math.floor(Math.random() * mats.length)];
    for (const m of root.getChildMeshes(false)) {
      m.material = rm;
      m.isPickable = false;
      m.doNotSyncBoundingInfo = true;
      m.alwaysSelectAsActiveMesh = true;
      m.freezeWorldMatrix();
    }
    root.freezeWorldMatrix();
  };

  // Под оружием — небольшой камень-постамент, верх ~0.7 м.
  homes.forEach((h, i) => place(i, h.x, h.z, 0.35, i * 1.7, 0, 0));

  // Разброс по карте — позиции общие с сервером (#shared/rocks).
  for (const rk of rockList()) {
    place(rk.kind, rk.x, rk.z, rk.scale, rk.yaw, rk.tilt[0], rk.tilt[1]);
  }
}
