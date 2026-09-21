import type { Scene } from "@babylonjs/core/scene";
import { Mesh as MeshImpl } from "@babylonjs/core/Meshes/mesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { Vector3, Matrix, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import "@babylonjs/core/Meshes/thinInstanceMesh";

import { trees as treeList } from "#shared/trees";
import { rocks as rockList } from "#shared/rocks";
import type { Terrain } from "./Terrain";
import { GrassWindPlugin, WIND } from "./GrassWind";
import { TreeImpostors, type ImpostorTree } from "./TreeImpostors";
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

/**
 * Прозрачность деревьев у камеры (спектатор). Стрим часто ведёт камеру вплотную
 * к стволу, и крона закрывает весь кадр — гасим ближние деревья, дальние не
 * трогаем. Меши деревьев делят два материала на весь лес, поэтому гасим не
 * материалом, а `mesh.visibility`: Babylon сам уводит такой меш в прозрачный
 * проход (needAlphaBlendingForMesh учитывает visibility < 1).
 */
const FADE_NEAR = 2.5; // ближе — самая прозрачная ступень
const FADE_FAR = 9; // дальше — обычное дерево

/**
 * Ступени прозрачности (ближняя → дальняя). Гасим ПОДМЕНОЙ МАТЕРИАЛА, а не
 * `mesh.visibility`: у листвы стоит transparencyMode=ALPHATEST с alphaCutOff,
 * и visibility уводила альфу под порог — лист выпадал целиком вместо того,
 * чтобы бледнеть. Ступеней мало: на весь лес восемь материалов, подмена —
 * одна ссылка на меш.
 */
const FADE_STEPS = [0.16, 0.34, 0.56, 0.78];

interface TreeInstance {
  x: number;
  z: number;
  y: number;
  kind: number;
  scale: number;
  bark: Mesh[];
  leaf: Mesh[];
  /** Индекс ступени прозрачности; -1 — обычное непрозрачное дерево. */
  step: number;
}

const treeInstances: TreeInstance[] = [];
let baseBark: StandardMaterial | null = null;
let baseLeaf: StandardMaterial | null = null;
const fadeBark: StandardMaterial[] = [];
const fadeLeaf: StandardMaterial[] = [];
let fadeOn = false;

/**
 * Полупрозрачные копии коры и листвы. Строим ДО freeze() исходников.
 */
function buildFadeMaterials(bark: StandardMaterial, leaf: StandardMaterial): void {
  if (fadeBark.length) return;
  for (const a of FADE_STEPS) {
    const b = bark.clone(`treeBarkFade${a}`);
    b.alpha = a;
    b.transparencyMode = 2; // ALPHABLEND
    b.disableDepthWrite = true;
    fadeBark.push(b);

    const l = leaf.clone(`treeLeafFade${a}`);
    l.alpha = a;
    // Смешивание вместо отсечки — иначе полупрозрачный лист уходит под
    // alphaCutOff целиком. Вырез листа (альфа текстуры) при этом сохраняется.
    l.transparencyMode = 2;
    l.useAlphaFromDiffuseTexture = true;
    l.disableDepthWrite = true;
    fadeLeaf.push(l);
  }
}

/**
 * Включить затухание ближних деревьев (зовёт спектатор). В игре не зовём:
 * там деревья обычные, и лишних материалов не появляется.
 */
export function enableTreeFade(): void {
  fadeOn = true;
}

/** Раз в кадр: гасим деревья вокруг камеры, дальние возвращаем как были. */
export function fadeTreesNear(camX: number, camZ: number): void {
  if (!fadeOn || !baseBark || !baseLeaf || fadeBark.length === 0) return;
  for (const t of treeInstances) {
    const d = Math.hypot(t.x - camX, t.z - camZ);
    let step = -1;
    if (d < FADE_FAR) {
      const k = (d - FADE_NEAR) / (FADE_FAR - FADE_NEAR);
      const c = k < 0 ? 0 : k > 1 ? 1 : k;
      step = Math.min(FADE_STEPS.length - 1, Math.floor(c * FADE_STEPS.length));
    }
    if (step === t.step) continue;
    t.step = step;
    const bm = step < 0 ? baseBark : fadeBark[step];
    const lm = step < 0 ? baseLeaf : fadeLeaf[step];
    for (const m of t.bark) m.material = bm;
    for (const m of t.leaf) m.material = lm;
  }
}

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


/**
 * Облегчённая копия листвы: листва — карточки-квады (4 вершины, 6 индексов), для
 * дальнего LOD оставляем каждую `every`-ю и увеличиваем оставшиеся на √every
 * (площадь покрытия ~та же, альфа-тест дешевле). null — меш не «карточный».
 */
function leafCardLod(src: Mesh, every: number, name: string): Mesh | null {
  const pos = src.getVerticesData(VertexBuffer.PositionKind);
  const idx = src.getIndices();
  if (!pos || !idx || pos.length % 12 !== 0) return null;
  const cards = pos.length / 12;
  if (idx.length !== cards * 6) return null;
  for (let c = 0; c < cards; c++) {
    for (let k = 0; k < 6; k++) {
      const v = idx[c * 6 + k];
      if (v < c * 4 || v > c * 4 + 3) return null; // не по порядку — не трогаем
    }
  }
  const nor = src.getVerticesData(VertexBuffer.NormalKind);
  const uv = src.getVerticesData(VertexBuffer.UVKind);
  const kept: number[] = [];
  for (let c = 0; c < cards; c += every) kept.push(c);
  const grow = Math.sqrt(every);
  const oPos = new Float32Array(kept.length * 12);
  const oNor = nor ? new Float32Array(kept.length * 12) : null;
  const oUv = uv ? new Float32Array(kept.length * 8) : null;
  const oIdx: number[] = [];
  kept.forEach((c, n) => {
    let cx = 0, cy = 0, cz = 0;
    for (let v = 0; v < 4; v++) {
      cx += pos[(c * 4 + v) * 3]; cy += pos[(c * 4 + v) * 3 + 1]; cz += pos[(c * 4 + v) * 3 + 2];
    }
    cx /= 4; cy /= 4; cz /= 4;
    for (let v = 0; v < 4; v++) {
      const si = (c * 4 + v) * 3;
      const di = (n * 4 + v) * 3;
      oPos[di] = cx + (pos[si] - cx) * grow;
      oPos[di + 1] = cy + (pos[si + 1] - cy) * grow;
      oPos[di + 2] = cz + (pos[si + 2] - cz) * grow;
      if (oNor && nor) { oNor[di] = nor[si]; oNor[di + 1] = nor[si + 1]; oNor[di + 2] = nor[si + 2]; }
      if (oUv && uv) { oUv[(n * 4 + v) * 2] = uv[(c * 4 + v) * 2]; oUv[(n * 4 + v) * 2 + 1] = uv[(c * 4 + v) * 2 + 1]; }
    }
    for (let k = 0; k < 6; k++) oIdx.push(idx[c * 6 + k] - c * 4 + n * 4);
  });
  const lod = new MeshImpl(name, src.getScene());
  const vd = new VertexData();
  vd.positions = oPos;
  if (oNor) vd.normals = oNor;
  if (oUv) vd.uvs = oUv;
  vd.indices = oIdx;
  vd.applyToMesh(lod);
  lod.material = src.material;
  lod.isPickable = false;
  return lod;
}

/** Расставить 26 деревьев из общего списка (позиции — те же, что на сервере). */
export async function loadTrees(
  scene: Scene,
  terrain: Terrain,
  lite: boolean,
  noInstances = false,
): Promise<void> {
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
    // doNotInstantiate — каждое дерево своим мешем: иначе прозрачность одного
    // (mesh.visibility у спектатора) утаскивает в прозрачный проход весь лес.
    const inst = c.instantiateModelsToScene((n) => n, false, {
      doNotInstantiate: noInstances,
    });
    const root = inst.rootNodes[0] as TransformNode | undefined;
    if (!root) return;
    root.position.set(t.x, terrain.heightAt(t.x, t.z) - 0.15, t.z);
    root.rotationQuaternion = Quaternion.RotationYawPitchRoll(t.yaw, 0, 0);
    root.scaling.setAll(TREE_SCALE * t.scale);

    const barkMeshes: Mesh[] = [];
    const leafMeshes: Mesh[] = [];
    for (const mesh of root.getChildMeshes(false) as Mesh[]) {
      const isLeaf = /leaf|leav/i.test(mesh.material?.name ?? "");
      // У инстанса материал не присваивается (setter — no-op): красим исходный меш,
      // иначе у игроков (не noInstances) деревья оставались с оригинальным тяжёлым
      // PBR из glTF, а дешёвые лёгкие материалы получал только спектатор.
      const paint = mesh.isAnInstance ? (mesh as unknown as InstancedMesh).sourceMesh : mesh;
      paint.material = isLeaf ? leaf : bark;
      (isLeaf ? leafMeshes : barkMeshes).push(mesh);
      // Ствол — тоньше (у модели раздутое основание), крона — чуть шире и ниже.
      if (isLeaf) mesh.scaling.set(1.15, 0.92, 1.15);
      else mesh.scaling.set(0.62, 1, 0.62);
      mesh.isPickable = false;
      // Сначала замораживаем (при этом bbox синхронизируется с мировой матрицей),
      // и только потом отключаем пересчёт. Раньше стояло alwaysSelectAsActiveMesh —
      // все деревья рисовались всегда, даже за спиной; теперь работает отсечение
      // по кадру. (В VR отсечением ведёт VrCull — по расстоянию.)
      mesh.freezeWorldMatrix();
      mesh.doNotSyncBoundingInfo = true;
    }
    root.freezeWorldMatrix();
    treeInstances.push({
      x: t.x,
      z: t.z,
      y: root.position.y,
      kind: i % containers.length,
      scale: root.scaling.x,
      bark: barkMeshes,
      leaf: leafMeshes,
      step: -1,
    });
  });
  // LOD листвы (только у игроков с инстансами; у спектатора — свои меши и подмена
  // материалов на прозрачность, LOD там не нужен). Инстансы берут LOD исходника.
  if (!noInstances) {
    const done = new Set<Mesh>();
    for (const t of treeInstances) {
      for (const m of t.leaf) {
        const srcM = (m.isAnInstance ? (m as unknown as InstancedMesh).sourceMesh : m) as Mesh;
        if (done.has(srcM)) continue;
        done.add(srcM);
        const near = leafCardLod(srcM, 2, `${srcM.name}_lod1`);
        const far = leafCardLod(srcM, 4, `${srcM.name}_lod2`);
        const far2 = leafCardLod(srcM, 8, `${srcM.name}_lod3`);
        if (near) srcM.addLODLevel(28, near);
        if (far) srcM.addLODLevel(50, far);
        if (far2) srcM.addLODLevel(85, far2);
      }
    }
  }
  // Дальние деревья — снимки-билборды (только у игроков; у спектатора деревья с прозрачностью).
  if (!noInstances) {
    new TreeImpostors(
      scene,
      treeInstances.map((t) => ({
        kind: t.kind,
        x: t.x,
        y: t.y,
        z: t.z,
        scale: t.scale,
        meshes: [...t.bark, ...t.leaf],
      })),
    );
  }
  baseBark = bark;
  baseLeaf = leaf;
  // Полупрозрачные копии — только там, где они нужны (спектатор), и строго
  // до freeze() исходников.
  if (noInstances) buildFadeMaterials(bark, leaf);
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
  // Один общий материал на все камни; разброс по яркости/оттенку — цветом ИНСТАНСА (instancedBuffers.color):
  // раньше у каждого камня был свой меш с одним из 6 материалов (до 23 отрисовок), теперь на вид камня —
  // один источник и все его камни в одной отрисовке (3 вместо ~20).
  const BASE = 0.33;
  const mat = new StandardMaterial("rockMat", scene);
  mat.diffuseColor = new Color3(BASE, BASE, BASE);
  mat.emissiveColor = new Color3(BASE * 0.12, BASE * 0.12, BASE * 0.12);
  mat.specularColor = new Color3(0, 0, 0);
  mat.maxSimultaneousLights = 5;
  mat.freeze();

  // Источники: геометрия камня в системе корня (трансформ узлов модели запечён в вершины).
  const protos: Mesh[][] = containers.map((c, kind) => {
    const inst = c.instantiateModelsToScene((n) => n, false);
    const root = inst.rootNodes[0] as TransformNode | undefined;
    const out: Mesh[] = [];
    if (!root) return out;
    root.position.setAll(0);
    root.rotationQuaternion = Quaternion.Identity();
    root.scaling.setAll(1);
    root.computeWorldMatrix(true);
    const geoms = root.getChildMeshes(false).filter((m) => m.getTotalVertices() > 0) as Mesh[];
    for (const m of geoms) {
      const rel = m.computeWorldMatrix(true).clone();
      m.parent = null;
      m.position.setAll(0);
      m.rotationQuaternion = null;
      m.rotation.setAll(0);
      m.scaling.setAll(1);
      m.bakeTransformIntoVertices(rel);
      m.name = `Rock_Medium_${kind + 1}`;
      m.material = mat;
      m.isPickable = false;
      m.isVisible = false; // рисуем только инстансы
      m.registerInstancedBuffer("color", 4);
      out.push(m);
    }
    root.dispose(true, false);
    return out;
  });

  const rockRecs: ImpostorTree[] = [];
  const place = (
    kind: number,
    x: number,
    z: number,
    s: number,
    yaw: number,
    tiltX: number,
    tiltZ: number,
  ): void => {
    const srcs = protos[kind % protos.length];
    if (!srcs.length) return;
    const y = terrain.heightAt(x, z) - s * 0.35; // чуть врос в землю
    const q = Quaternion.RotationYawPitchRoll(yaw, tiltX, tiltZ);
    const b = 0.22 + Math.floor(Math.random() * 6) * 0.044; // 0.22..0.44 — яркость, как у прежних 6 материалов
    const warm = (Math.floor(Math.random() * 3)) * 0.015 - 0.015;
    const color = new Color4((b + warm) / BASE, b / BASE, (b - warm * 0.5) / BASE, 1);
    const geo: Mesh[] = [];
    for (const src of srcs) {
      const inst = src.createInstance(src.name);
      inst.position.set(x, y, z);
      inst.rotationQuaternion = q.clone();
      inst.scaling.setAll(s);
      inst.instancedBuffers.color = color;
      inst.isPickable = false;
      inst.freezeWorldMatrix(); // до doNotSync: иначе bbox остаётся в начале координат
      inst.doNotSyncBoundingInfo = true;
      geo.push(inst as unknown as Mesh);
    }
    rockRecs.push({ kind: kind % containers.length, x, y, z, scale: s, meshes: geo });
  };

  // Под оружием — небольшой камень-постамент, верх ~0.7 м.
  homes.forEach((h, i) => place(i, h.x, h.z, 0.35, i * 1.7, 0, 0));

  // Разброс по карте — позиции общие с сервером (#shared/rocks).
  for (const rk of rockList()) {
    place(rk.kind, rk.x, rk.z, rk.scale, rk.yaw, rk.tilt[0], rk.tilt[1]);
  }
  // Дальние камни — снимки-билборды (как у деревьев), см. TreeImpostors.
  if (rockRecs.length) new TreeImpostors(scene, rockRecs, "rock", 0.9);
}
