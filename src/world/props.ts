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

import { WORLD } from "../shared/constants";
import type { Terrain } from "./Terrain";

/** Низкополигональные деревья, расставленные по рельефу (инстансы одного меша). */
export function scatterTrees(scene: Scene, terrain: Terrain): void {
  const trunkMat = new StandardMaterial("trunkMat", scene);
  trunkMat.diffuseColor = new Color3(0.32, 0.22, 0.14);
  trunkMat.specularColor = new Color3(0, 0, 0);

  const leafMat = new StandardMaterial("leafMat", scene);
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
  if (!proto) return;
  proto.name = "treeProto";
  proto.isVisible = false;

  const reach = WORLD.size / 2 - 6;
  for (let i = 0; i < WORLD.treeCount; i++) {
    const x = (Math.random() - 0.5) * 2 * reach;
    const z = (Math.random() - 0.5) * 2 * reach;
    if (Math.sqrt(x * x + z * z) < 9) continue; // не на спавне
    const tree = proto.createInstance(`tree${i}`);
    tree.position.set(x, terrain.heightAt(x, z) - 0.1, z);
    const s = 0.8 + Math.random() * 0.9;
    tree.scaling.setAll(s);
    tree.rotation.y = Math.random() * Math.PI * 2;
    tree.checkCollisions = true;
    tree.isPickable = true;
  }
}

/** Пучки травы вокруг спавна — тысячи thin-инстансов, один драв-колл. */
export function scatterGrass(scene: Scene, terrain: Terrain): void {
  const mat = new StandardMaterial("grassBladeMat", scene);
  const bladeTex = grassBladeTexture(scene);
  bladeTex.vScale = -1; // текстура рисуется «вниз головой» — переворачиваем
  bladeTex.vOffset = 1;
  mat.diffuseTexture = bladeTex;
  mat.diffuseTexture.hasAlpha = true;
  mat.useAlphaFromDiffuseTexture = true;
  mat.transparencyMode = 1; // ALPHATEST — дёшево и без сортировки
  mat.emissiveColor = new Color3(0.12, 0.22, 0.1);
  mat.specularColor = new Color3(0, 0, 0);
  mat.backFaceCulling = false;

  // Пучок из трёх скрещённых квадов с текстурой-травинками; начало у основания.
  const W = 0.5;
  const H = 0.38;
  const parts = [0, 1, 2].map((k) => {
    const p = MeshBuilder.CreatePlane(`g${k}`, { width: W, height: H }, scene);
    p.rotation.y = (k * Math.PI) / 3;
    p.bakeCurrentTransformIntoVertices();
    p.position.y = H / 2;
    p.bakeCurrentTransformIntoVertices();
    return p;
  });
  const tuft = Mesh.MergeMeshes(parts, true, true, undefined, false, false);
  if (!tuft) return;
  tuft.name = "grassBlade";
  tuft.material = mat;
  tuft.isPickable = false;

  const R = WORLD.grassRadius;
  const matrices: Matrix[] = [];
  for (let i = 0; i < WORLD.grassCount; i++) {
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
  }
  tuft.thinInstanceAdd(matrices);
}

function quatY(rad: number): Quaternion {
  return Quaternion.RotationAxis(new Vector3(0, 1, 0), rad);
}

/** Прозрачная текстура: несколько сужающихся кверху травинок. */
function grassBladeTexture(scene: Scene): DynamicTexture {
  const S = 64;
  const tex = new DynamicTexture("grassBladeTex", { width: S, height: S }, scene, false);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, S, S);
  const blades = 5;
  for (let i = 0; i < blades; i++) {
    const bx = (i + 0.5 + (Math.random() - 0.5) * 0.5) * (S / blades);
    const w = S / blades / 2.6;
    const green = 120 + Math.floor(Math.random() * 70);
    ctx.fillStyle = `rgb(${green - 60}, ${green}, ${green - 70})`;
    ctx.beginPath();
    ctx.moveTo(bx - w, S);
    ctx.lineTo(bx + w, S);
    ctx.lineTo(bx + (Math.random() - 0.5) * w, 2);
    ctx.closePath();
    ctx.fill();
  }
  tex.update(false);
  return tex;
}
