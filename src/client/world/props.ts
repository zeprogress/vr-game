import type { Scene } from "@babylonjs/core/scene";
import { Vector3, Matrix, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import "@babylonjs/core/Meshes/thinInstanceMesh";

import { WORLD } from "#shared/constants";
import { trees as treeList } from "#shared/trees";
import type { Terrain } from "./Terrain";
import { GrassWindPlugin, WIND } from "./GrassWind";
import { LIGHT_BUDGET } from "./Fireflies";

/** Круг ствола на плоскости — по нему игрока выталкивает наружу. */
export interface Obstacle {
  x: number;
  z: number;
  r: number;
}

/**
 * Низкополигональные деревья (инстансы одного меша).
 *
 * Места берём из общего списка, а не из Math.random: тот же лес должен быть
 * и на сервере (мобы обходят стволы), и у всех игроков.
 */
export function scatterTrees(scene: Scene, terrain: Terrain): Obstacle[] {
  const trunkMat = new StandardMaterial("trunkMat", scene);
  trunkMat.maxSimultaneousLights = LIGHT_BUDGET;
  trunkMat.diffuseColor = new Color3(0.32, 0.22, 0.14);
  trunkMat.specularColor = new Color3(0, 0, 0);

  const leafMat = new StandardMaterial("leafMat", scene);
  leafMat.maxSimultaneousLights = LIGHT_BUDGET;
  leafMat.diffuseColor = new Color3(0.2, 0.45, 0.2);
  leafMat.specularColor = new Color3(0, 0, 0);

  const trunk = MeshBuilder.CreateCylinder("t_trunk", { height: 2.4, diameterTop: 0.25, diameterBottom: 0.4 }, scene);
  trunk.position.y = 1.2;
  trunk.material = trunkMat;

  const crown = MeshBuilder.CreateSphere("t_crown", { diameter: 2.6, segments: 5 }, scene);
  crown.position.y = 3.1;
  crown.material = leafMat;
  const crown2 = MeshBuilder.CreateSphere("t_crown2", { diameter: 2, segments: 5 }, scene);
  crown2.position.set(0.5, 4, 0.3);
  crown2.material = leafMat;

  const proto = Mesh.MergeMeshes([trunk, crown, crown2], true, true, undefined, false, true);
  if (!proto) return [];
  proto.name = "treeProto";
  proto.isVisible = false;

  const trunks: Obstacle[] = [];
  treeList().forEach((t, i) => {
    const tree = proto.createInstance(`tree${i}`);
    tree.position.set(t.x, terrain.heightAt(t.x, t.z) - 0.1, t.z);
    tree.scaling.setAll(t.scale);
    tree.rotation.y = t.yaw;
    tree.checkCollisions = true;
    tree.isPickable = true;
    trunks.push({ x: t.x, z: t.z, r: t.r });
  });
  return trunks;
}

/**
 * Пучки травы вокруг спавна — тысячи thin-инстансов, один драв-колл.
 * Возвращает функцию, которую надо звать каждый кадр: она двигает ветер.
 * `daylight` 0..1 — ночью ветер стихает и трава замирает.
 */
export function scatterGrass(
  scene: Scene,
  terrain: Terrain,
  density = 1,
): (dt: number, daylight: number) => void {
  const mat = new StandardMaterial("grassBladeMat", scene);
  mat.maxSimultaneousLights = LIGHT_BUDGET; // трава вокруг стайки должна светлеть
  const bladeTex = grassBladeTexture(scene);
  bladeTex.vScale = -1; // текстура рисуется «вниз головой» — переворачиваем
  bladeTex.vOffset = 1;
  mat.diffuseTexture = bladeTex;
  mat.diffuseTexture.hasAlpha = true;
  mat.useAlphaFromDiffuseTexture = true;
  mat.transparencyMode = 1; // ALPHATEST — дёшево и без сортировки
  // С мип-уровнями края травинок к горизонту усредняются и при обычном
  // пороге просто исчезают, поэтому порог ниже — дальняя трава не лысеет.
  mat.alphaCutOff = 0.25;
  // Травинки стоят вертикально и ловят меньше света сверху, чем земля,
  // поэтому своей яркости им нужно больше — иначе они темнее земли.
  mat.emissiveColor = new Color3(0.11, 0.2, 0.09);
  mat.specularColor = new Color3(0, 0, 0);
  mat.backFaceCulling = false;

  // Пучок из трёх скрещённых квадов с текстурой-травинками; начало у основания.
  const W = 0.5;
  const H = 0.46; // повыше — тонкие травинки читаются лучше
  const parts = [0, 1, 2].map((k) => {
    const p = MeshBuilder.CreatePlane(`g${k}`, { width: W, height: H }, scene);
    p.rotation.y = (k * Math.PI) / 3;
    p.bakeCurrentTransformIntoVertices();
    p.position.y = H / 2;
    p.bakeCurrentTransformIntoVertices();
    return p;
  });
  const tuft = Mesh.MergeMeshes(parts, true, true, undefined, false, false);
  if (!tuft) return () => {};
  tuft.name = "grassBlade";
  tuft.material = mat;
  tuft.isPickable = false;

  const wind = new GrassWindPlugin(mat);

  const R = WORLD.grassRadius;
  const count = Math.max(0, Math.round(WORLD.grassCount * density));
  const matrices: Matrix[] = [];
  const phases: number[] = [];
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * R;
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    if (Math.hypot(x, z) < 1.5) continue;
    const y = terrain.heightAt(x, z);
    const s = 0.7 + Math.random() * 0.9;
    matrices.push(
      Matrix.Compose(
        new Vector3(s, s * (0.8 + Math.random() * 0.6), s),
        quatY(Math.random() * Math.PI * 2),
        new Vector3(x, y, z),
      ),
    );
    // Фаза — это расстояние вдоль ветра. Без случайности: тогда волна
    // катится по полю, а не каждый пучок дёргается сам по себе.
    phases.push((x * WIND.dirX + z * WIND.dirZ) * 0.55);
  }
  tuft.thinInstanceAdd(matrices);
  tuft.thinInstanceSetBuffer("windPhase", new Float32Array(phases), 1, true);

  return (dt: number, daylight: number) => {
    // Плавно, а не рывком: ветер стихает к ночи и поднимается к утру.
    wind.scale += (daylight - wind.scale) * Math.min(1, dt * 0.6);
    wind.time += dt * WIND.speed * Math.max(wind.scale, 0.05);
  };
}

function quatY(rad: number): Quaternion {
  return Quaternion.RotationAxis(new Vector3(0, 1, 0), rad);
}

/** Прозрачная текстура: несколько сужающихся кверху травинок. */
function grassBladeTexture(scene: Scene): DynamicTexture {
  const S = 128; // вдвое крупнее: травинки тонкие, на 64 они рвались
  const tex = new DynamicTexture("grassBladeTex", { width: S, height: S }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, S, S);
  const blades = 7; // больше и тоньше, чем было
  for (let i = 0; i < blades; i++) {
    const bx = (i + 0.5 + (Math.random() - 0.5) * 0.5) * (S / blades);
    const w = S / blades / 4.5; // втрое тоньше прежнего
    const green = 125 + Math.floor(Math.random() * 55);
    ctx.fillStyle = `rgb(${green - 50}, ${green}, ${green - 55})`;
    ctx.beginPath();
    ctx.moveTo(bx - w, S);
    ctx.lineTo(bx + w, S);
    ctx.lineTo(bx + (Math.random() - 0.5) * w, 2);
    ctx.closePath();
    ctx.fill();
  }
  tex.update(false); // update перестраивает и мип-уровни
  return tex;
}
