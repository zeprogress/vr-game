import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { Vector3, Matrix, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/core/Meshes/thinInstanceMesh";

import { WORLD } from "#shared/constants";
import { trees as treeList } from "#shared/trees";
import { rocks as rockList } from "#shared/rocks";
import type { Terrain } from "./Terrain";
import { GrassWindPlugin, WIND } from "./GrassWind";
import { LIGHT_BUDGET } from "./Fireflies";

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
/** Плотность травы относительно WORLD.grassCount. */
const GRASS_FACTOR = 1.35;
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
  m.maxSimultaneousLights = lite ? 2 : 3;
  return m;
}

function barkMaterial(scene: Scene, lite: boolean): StandardMaterial {
  const m = new StandardMaterial("treeBark", scene);
  m.diffuseColor = new Color3(0.33, 0.22, 0.14);
  m.emissiveColor = new Color3(0.08, 0.05, 0.03);
  m.specularColor = new Color3(0, 0, 0);
  m.maxSimultaneousLights = lite ? 2 : 3;
  return m;
}

/** Расставить 26 деревьев из общего списка (позиции — те же, что на сервере). */
export async function loadTrees(scene: Scene, terrain: Terrain, lite: boolean): Promise<void> {
  await import("@babylonjs/loaders/glTF/2.0");
  const containers = await Promise.all(
    TREE_KINDS.map((k) => LoadAssetContainerAsync(`/models/nature/${k}.gltf`, scene)),
  );

  const bark = barkMaterial(scene, lite);
  const leaf = leafMaterial(scene, containers[0].textures[0], lite);

  treeList().forEach((t, i) => {
    const c = containers[i % containers.length];
    const inst = c.instantiateModelsToScene((n) => n, false);
    const root = inst.rootNodes[0] as TransformNode | undefined;
    if (!root) return;
    root.position.set(t.x, terrain.heightAt(t.x, t.z) - 0.15, t.z);
    root.rotationQuaternion = Quaternion.RotationYawPitchRoll(t.yaw, 0, 0);
    // Неравномерный масштаб: уже по горизонтали (тоньше ствол и крона), выше.
    const k = TREE_SCALE * t.scale;
    root.scaling.set(k * 0.84, k * 1.08, k * 0.84);

    for (const mesh of root.getChildMeshes(false)) {
      mesh.material = /leaf|leav/i.test(mesh.material?.name ?? "") ? leaf : bark;
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
  mat.emissiveColor = new Color3(0.11, 0.2, 0.09);
  mat.specularColor = new Color3(0, 0, 0);
  mat.backFaceCulling = false;
  mat.maxSimultaneousLights = lite ? 2 : LIGHT_BUDGET;
  blade.material = mat;
  blade.isPickable = false;
  blade.name = "grassBlade";
  blade.setEnabled(true);

  const wind = new GrassWindPlugin(mat);

  const R = WORLD.grassRadius * 1.15;
  const count = Math.max(0, Math.round(WORLD.grassCount * density * GRASS_FACTOR));
  const matrices: Matrix[] = [];
  const phases: number[] = [];
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * R;
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    if (Math.hypot(x, z) < 1.5) continue;
    const y = terrain.heightAt(x, z);
    const s = 0.4 + Math.random() * 0.32; // модель ~1.3 ед. -> трава ~0.5–0.9 м, повыше
    matrices.push(
      Matrix.Compose(
        new Vector3(s, s * (0.95 + Math.random() * 0.6), s),
        Quaternion.RotationAxis(new Vector3(0, 1, 0), Math.random() * Math.PI * 2),
        new Vector3(x, y - 0.03, z),
      ),
    );
    phases.push((x * WIND.dirX + z * WIND.dirZ) * 0.55);
  }
  blade.thinInstanceAdd(matrices);
  blade.thinInstanceSetBuffer("windPhase", new Float32Array(phases), 1, true);

  return (dt: number, daylight: number) => {
    wind.scale += (daylight - wind.scale) * Math.min(1, dt * 0.6);
    wind.time += dt * WIND.speed * Math.max(wind.scale, 0.05);
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
  const mat = new StandardMaterial("natureRockMat", scene);
  mat.diffuseColor = new Color3(0.3, 0.3, 0.33);
  mat.emissiveColor = new Color3(0.04, 0.04, 0.05);
  mat.specularColor = new Color3(0, 0, 0);
  mat.maxSimultaneousLights = 3;

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
    for (const m of root.getChildMeshes(false)) {
      m.material = mat;
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
  mat.freeze();
}
